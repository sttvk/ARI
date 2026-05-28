/**
 * POST /api/modules/brainstorm-ai/edit
 *
 * Accepts { board_id, messages[] } — a running user/assistant conversation —
 * and asks Claude to either ask one clarifying question OR emit a batch of
 * edit operations. The DB is only touched on the apply branch.
 *
 * Structured output is enforced via Anthropic's `output_config.format` with
 * a hand-written JSON Schema (kept in sync with LLMResponseSchema in
 * `lib/validation.ts`). We don't use the SDK's `zodOutputFormat` helper —
 * @anthropic-ai/sdk's Zod helper requires Zod v4 (`toJSONSchema` accesses
 * `.def`), but this project pins Zod v3 (which uses `_def`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'

import { getAuthenticatedUser } from '@/lib/auth-helpers'
import { toSnakeCase } from '@/lib/api-helpers'
import { registry } from '@/lib/openapi/registry'
import { DEFAULT_SECURITY, ErrorResponseSchema, InternalServerErrorResponse } from '@/lib/openapi/common'
import {
  brainstormBoards,
  brainstormEdges,
  brainstormNodes,
} from '@/lib/db/schema'

import {
  EditRequestSchema,
  EditResponseSchema,
  LLMResponseSchema,
} from '@/modules/brainstorm-ai/lib/validation'
import { buildSystemPrompt } from '@/modules/brainstorm-ai/lib/prompt'
import { applyOperations } from '@/modules/brainstorm-ai/lib/apply-ops'
import type { EditOperation } from '@/modules/brainstorm-ai/types'

const BRAINSTORM_COLORS = [
  'slate', 'red', 'orange', 'amber', 'green',
  'teal', 'sky', 'blue', 'violet', 'pink',
] as const

// Mirrors LLMResponseSchema in `lib/validation.ts`.
// Anthropic structured outputs require: every object has
// `additionalProperties: false`, every property listed in `required`, and
// nullable expressed as `type: ["x","null"]` or `anyOf: [..., {type:"null"}]`.
const editResponseJsonSchema = {
  anyOf: [
    // ASK — model needs more specifics
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'question'],
      properties: {
        type: { type: 'string', enum: ['ask'] },
        question: { type: 'string' },
      },
    },
    // APPLY — build or modify the board, optionally with a follow-up message
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'operations', 'message'],
      properties: {
        type: { type: 'string', enum: ['apply'] },
        message: { type: ['string', 'null'] },
        operations: {
          type: 'array',
          items: {
            anyOf: [
              // add_node
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'temp_id', 'text', 'parent_id', 'color'],
                properties: {
                  type: { type: 'string', enum: ['add_node'] },
                  temp_id: { type: 'string' },
                  text: { type: 'string' },
                  parent_id: { type: ['string', 'null'] },
                  color: {
                    anyOf: [
                      { type: 'string', enum: [...BRAINSTORM_COLORS] },
                      { type: 'null' },
                    ],
                  },
                },
              },
              // update_node
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'id', 'text'],
                properties: {
                  type: { type: 'string', enum: ['update_node'] },
                  id: { type: 'string' },
                  text: { type: 'string' },
                },
              },
              // delete_node
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'id'],
                properties: {
                  type: { type: 'string', enum: ['delete_node'] },
                  id: { type: 'string' },
                },
              },
              // add_edge
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'source', 'target'],
                properties: {
                  type: { type: 'string', enum: ['add_edge'] },
                  source: { type: 'string' },
                  target: { type: 'string' },
                },
              },
              // delete_edge
              {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'source', 'target'],
                properties: {
                  type: { type: 'string', enum: ['delete_edge'] },
                  source: { type: 'string' },
                  target: { type: 'string' },
                },
              },
            ],
          },
        },
      },
    },
  ],
} as const

registry.registerPath({
  method: 'post',
  path: '/api/modules/brainstorm-ai/edit',
  operationId: 'brainstormAIEdit',
  summary: 'Send a conversation turn to the Brainstorm-AI editor (Claude). May return a clarifying question or applied operations.',
  tags: ['brainstorm-ai'],
  security: DEFAULT_SECURITY,
  request: { body: { content: { 'application/json': { schema: EditRequestSchema } } } },
  responses: {
    200: {
      description: 'Either a clarifying question (status="ask") or operations applied + fresh board (status="apply")',
      content: { 'application/json': { schema: EditResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Board not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

export async function POST(request: NextRequest) {
  const startedAt = Date.now()

  try {
    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) {
      return NextResponse.json({ error: 'Unauthorized - Valid authentication required' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }
    const parsedBody = EditRequestSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsedBody.error.issues }, { status: 400 })
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('POST /api/modules/brainstorm-ai/edit error: ANTHROPIC_API_KEY is not configured')
      return NextResponse.json({ error: 'AI service is not configured' }, { status: 500 })
    }

    const { board_id: boardId, messages } = parsedBody.data

    // ── Confirm the board exists and belongs to the user ─────────────────
    const boardRows = await withRLS((db) =>
      db
        .select({ id: brainstormBoards.id })
        .from(brainstormBoards)
        .where(and(eq(brainstormBoards.id, boardId), eq(brainstormBoards.userId, user.id)))
        .limit(1),
    )
    if (boardRows.length === 0) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    // ── Load current state ───────────────────────────────────────────────
    const [nodesRaw, edgesRaw] = await Promise.all([
      withRLS((db) =>
        db
          .select()
          .from(brainstormNodes)
          .where(eq(brainstormNodes.boardId, boardId))
          .orderBy(asc(brainstormNodes.createdAt)),
      ),
      withRLS((db) =>
        db
          .select()
          .from(brainstormEdges)
          .where(eq(brainstormEdges.boardId, boardId))
          .orderBy(asc(brainstormEdges.createdAt)),
      ),
    ])

    const currentNodes = (toSnakeCase(nodesRaw.map((n) => ({ ...n, x: Number(n.x), y: Number(n.y) }))) as Array<Record<string, unknown>>)
    const currentEdges = (toSnakeCase(edgesRaw) as Array<Record<string, unknown>>)

    const systemPrompt = buildSystemPrompt({
      nodes: currentNodes as never,
      edges: currentEdges as never,
    })

    // ── Ask Claude ───────────────────────────────────────────────────────
    //
    // Two settings here unlock the model's natural reasoning:
    //   • thinking: adaptive — model decides when/how much to think per turn.
    //     Without this it produces output tokens immediately and can't
    //     reason about your request first.
    //   • effort: xhigh — Opus 4.7's sweet spot for agentic / design work.
    //     Per the Claude API skill, this is what Claude Code uses by default
    //     and is recommended whenever quality matters more than latency.
    //
    // max_tokens stays at 16K so the SDK doesn't refuse the non-streaming
    // request (worst-case duration over 10 minutes triggers an error).
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      output_config: {
        format: { type: 'json_schema', schema: editResponseJsonSchema as unknown as Record<string, unknown> },
        effort: 'xhigh',
      },
    })

    // Anthropic returns structured output as a normal text content block whose
    // body is the JSON literal. Concatenate every text block defensively.
    const rawText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(rawText)
    } catch {
      console.error('POST /api/modules/brainstorm-ai/edit error: model returned non-JSON output:', rawText.slice(0, 500))
      return NextResponse.json({ error: 'AI returned malformed output' }, { status: 502 })
    }

    const validated = LLMResponseSchema.safeParse(parsedJson)
    if (!validated.success) {
      console.error('POST /api/modules/brainstorm-ai/edit error: model output failed schema validation:', validated.error.issues)
      return NextResponse.json({ error: 'AI output did not match expected shape' }, { status: 502 })
    }

    // ── Branch on response type ──────────────────────────────────────────

    if (validated.data.type === 'ask') {
      return NextResponse.json({
        status: 'ask',
        question: validated.data.question,
        meta: { duration_ms: Date.now() - startedAt },
      })
    }

    // type === 'apply' — write to DB
    const operations: EditOperation[] = validated.data.operations as EditOperation[]
    const aiMessage: string | null = validated.data.message ?? null

    if (operations.length === 0) {
      return NextResponse.json({
        status: 'apply',
        operations_applied: [],
        board: { nodes: currentNodes, edges: currentEdges },
        message: aiMessage,
        meta: { duration_ms: Date.now() - startedAt, operation_count: 0 },
      })
    }

    const applied = await withRLS((db) => applyOperations(db, operations, boardId, user.id))

    await withRLS((db) =>
      db
        .update(brainstormBoards)
        .set({ updatedAt: new Date().toISOString() })
        .where(and(eq(brainstormBoards.id, boardId), eq(brainstormBoards.userId, user.id))),
    )

    const [newNodesRaw, newEdgesRaw] = await Promise.all([
      withRLS((db) =>
        db
          .select()
          .from(brainstormNodes)
          .where(eq(brainstormNodes.boardId, boardId))
          .orderBy(asc(brainstormNodes.createdAt)),
      ),
      withRLS((db) =>
        db
          .select()
          .from(brainstormEdges)
          .where(eq(brainstormEdges.boardId, boardId))
          .orderBy(asc(brainstormEdges.createdAt)),
      ),
    ])

    return NextResponse.json({
      status: 'apply',
      operations_applied: toSnakeCase(applied),
      board: {
        nodes: toSnakeCase(newNodesRaw.map((n) => ({ ...n, x: Number(n.x), y: Number(n.y) }))),
        edges: toSnakeCase(newEdgesRaw),
      },
      message: aiMessage,
      meta: {
        duration_ms: Date.now() - startedAt,
        operation_count: applied.length,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    console.error('POST /api/modules/brainstorm-ai/edit error:', message, stack)

    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: 'Anthropic rate limit hit. Wait a moment and retry.' },
        { status: 429 },
      )
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: 'Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.local and restart the dev server.' },
        { status: 401 },
      )
    }
    if (error instanceof Anthropic.APIError && /credit|balance|billing/i.test(message)) {
      return NextResponse.json(
        { error: 'Anthropic credit balance is too low. Top up at console.anthropic.com/settings/billing.' },
        { status: 402 },
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
