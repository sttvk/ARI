import type {
  BrainstormBoard,
  BrainstormBoardSummary,
  BrainstormEdge,
  BrainstormNode,
  BrainstormColor,
} from '@/modules/brainstorm/types'

export type {
  BrainstormBoard,
  BrainstormBoardSummary,
  BrainstormEdge,
  BrainstormNode,
  BrainstormColor,
}

export type EditOperation =
  | {
      type: 'add_node'
      temp_id: string
      text: string
      parent_id: string | null
      color: BrainstormColor | null
    }
  | { type: 'update_node'; id: string; text: string }
  | { type: 'delete_node'; id: string }
  | { type: 'add_edge'; source: string; target: string }
  | { type: 'delete_edge'; source: string; target: string }

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface EditRequest {
  board_id: string
  messages: ConversationMessage[]
}

/**
 * Server's response. AI either asks a question, or applies operations to the
 * board. The apply branch optionally carries a `message` — a short narrative
 * from the AI summarizing what was built and suggesting next adjustments.
 */
export type EditResponse =
  | {
      status: 'ask'
      question: string
      meta: { duration_ms: number }
    }
  | {
      status: 'apply'
      operations_applied: EditOperation[]
      board: {
        nodes: BrainstormNode[]
        edges: BrainstormEdge[]
      }
      message: string | null
      meta: {
        duration_ms: number
        operation_count: number
      }
    }

export interface CreateBoardRequest {
  name: string
}
