/**
 * Brainstorm-AI boards endpoints.
 *
 * GET  /api/modules/brainstorm-ai/boards — list this user's boards
 * POST /api/modules/brainstorm-ai/boards — create a new empty board
 *
 * Boards live in the same `brainstorm_boards` table as the canonical
 * Brainstorm module, so anything created here is also editable in the
 * standard Brainstorm canvas.
 */

import { NextRequest, NextResponse } from 'next/server'
import { desc, inArray } from 'drizzle-orm'

import { getAuthenticatedUser } from '@/lib/auth-helpers'
import { toSnakeCase } from '@/lib/api-helpers'
import { registry } from '@/lib/openapi/registry'
import { DEFAULT_SECURITY, ErrorResponseSchema, InternalServerErrorResponse } from '@/lib/openapi/common'
import { brainstormBoards, brainstormNodes } from '@/lib/db/schema'

import {
  CreateBoardSchema,
  BoardCreateResponseSchema,
} from '@/modules/brainstorm-ai/lib/validation'
import { z } from 'zod'

const BoardListResponseSchema = z.object({
  boards: z.array(
    z.object({
      id: z.string().uuid(),
      user_id: z.string(),
      name: z.string(),
      node_count: z.number().int().nonnegative(),
      created_at: z.string().nullable(),
      updated_at: z.string().nullable(),
    }),
  ),
}).openapi('BrainstormAIBoardListResponse')

registry.registerPath({
  method: 'get',
  path: '/api/modules/brainstorm-ai/boards',
  operationId: 'brainstormAIListBoards',
  summary: "List the user's brainstorm boards (shared with the Brainstorm module)",
  tags: ['brainstorm-ai'],
  security: DEFAULT_SECURITY,
  responses: {
    200: {
      description: 'Boards (most recently updated first)',
      content: { 'application/json': { schema: BoardListResponseSchema } },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/modules/brainstorm-ai/boards',
  operationId: 'brainstormAICreateBoard',
  summary: 'Create a new (empty) brainstorm board for AI editing',
  tags: ['brainstorm-ai'],
  security: DEFAULT_SECURITY,
  request: { body: { content: { 'application/json': { schema: CreateBoardSchema } } } },
  responses: {
    201: {
      description: 'Created board',
      content: { 'application/json': { schema: BoardCreateResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    500: InternalServerErrorResponse,
  },
})

export async function GET(_request: NextRequest) {
  try {
    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) {
      return NextResponse.json({ error: 'Unauthorized - Valid authentication required' }, { status: 401 })
    }

    const boards = await withRLS((db) =>
      db.select().from(brainstormBoards).orderBy(desc(brainstormBoards.updatedAt)),
    )

    if (boards.length === 0) {
      return NextResponse.json({ boards: [] })
    }

    const boardIds = boards.map((b) => b.id)
    const nodes = await withRLS((db) =>
      db
        .select({ boardId: brainstormNodes.boardId })
        .from(brainstormNodes)
        .where(inArray(brainstormNodes.boardId, boardIds)),
    )

    const counts = new Map<string, number>()
    for (const n of nodes) counts.set(n.boardId, (counts.get(n.boardId) ?? 0) + 1)

    const summaries = boards.map((b) => ({ ...b, nodeCount: counts.get(b.id) ?? 0 }))

    return NextResponse.json({ boards: toSnakeCase(summaries) })
  } catch (error) {
    console.error('GET /api/modules/brainstorm-ai/boards error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, withRLS } = await getAuthenticatedUser()
    if (!user || !withRLS) {
      return NextResponse.json({ error: 'Unauthorized - Valid authentication required' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }
    const parseResult = CreateBoardSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Validation failed', details: parseResult.error.issues }, { status: 400 })
    }

    const [created] = await withRLS((db) =>
      db
        .insert(brainstormBoards)
        .values({ userId: user.id, name: parseResult.data.name.trim() })
        .returning(),
    )

    return NextResponse.json({ board: toSnakeCase(created) }, { status: 201 })
  } catch (error) {
    console.error('POST /api/modules/brainstorm-ai/boards error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
