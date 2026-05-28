import { z } from 'zod'
import '@/lib/openapi/registry'

const BRAINSTORM_COLOR = z.enum([
  'slate', 'red', 'orange', 'amber', 'green',
  'teal', 'sky', 'blue', 'violet', 'pink',
])

export const EditOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add_node'),
    temp_id: z.string().min(1).max(16),
    text: z.string().min(1).max(200),
    parent_id: z.string().nullable(),
    color: BRAINSTORM_COLOR.nullable(),
  }),
  z.object({
    type: z.literal('update_node'),
    id: z.string().uuid(),
    text: z.string().min(1).max(200),
  }),
  z.object({
    type: z.literal('delete_node'),
    id: z.string().uuid(),
  }),
  z.object({
    type: z.literal('add_edge'),
    source: z.string().min(1),
    target: z.string().min(1),
  }),
  z.object({
    type: z.literal('delete_edge'),
    source: z.string().uuid(),
    target: z.string().uuid(),
  }),
]).openapi('BrainstormAIEditOperation')

/**
 * Shape the LLM is constrained to via structured outputs.
 *
 * Two-way discriminated union:
 *   - ask   → needs more info; emit one question
 *   - apply → generate or edit. Optionally include a `message` summarizing
 *             what was built and suggesting next-step adjustments. The
 *             diagram itself is the artifact the user reacts to.
 */
export const LLMResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ask'),
    question: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal('apply'),
    operations: z.array(EditOperationSchema).max(80),
    // Nullable (not optional) for Anthropic structured outputs compliance —
    // every field must be required or nullable.
    message: z.string().max(800).nullable(),
  }),
]).openapi('BrainstormAILLMResponse')

export const ConversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
}).openapi('BrainstormAIConversationMessage')

export const EditRequestSchema = z.object({
  board_id: z.string().uuid(),
  messages: z.array(ConversationMessageSchema).min(1).max(40),
}).openapi('BrainstormAIEditRequest')

export const NodeSchema = z.object({
  id: z.string().uuid(),
  board_id: z.string().uuid(),
  user_id: z.string(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  color: z.string(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
}).openapi('BrainstormAINode')

export const EdgeSchema = z.object({
  id: z.string().uuid(),
  board_id: z.string().uuid(),
  user_id: z.string(),
  source_node_id: z.string().uuid(),
  target_node_id: z.string().uuid(),
  created_at: z.string(),
}).openapi('BrainstormAIEdge')

export const EditResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ask'),
    question: z.string(),
    meta: z.object({ duration_ms: z.number() }),
  }),
  z.object({
    status: z.literal('apply'),
    operations_applied: z.array(EditOperationSchema),
    board: z.object({
      nodes: z.array(NodeSchema),
      edges: z.array(EdgeSchema),
    }),
    message: z.string().nullable(),
    meta: z.object({
      duration_ms: z.number(),
      operation_count: z.number(),
    }),
  }),
]).openapi('BrainstormAIEditResponse')

export const CreateBoardSchema = z.object({
  name: z.string().min(1).max(200),
}).openapi('BrainstormAICreateBoard')

export const BoardCreateResponseSchema = z.object({
  board: z.object({
    id: z.string().uuid(),
    name: z.string(),
    created_at: z.string(),
    updated_at: z.string().nullable(),
  }),
}).openapi('BrainstormAIBoardCreateResponse')
