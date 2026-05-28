'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BrainstormBoard,
  BrainstormBoardSummary,
} from '@/modules/brainstorm/types'
import type { CreateBoardRequest } from '@/modules/brainstorm-ai/types'

/**
 * Hooks for the Brainstorm AI module.
 *
 * Brainstorm AI shares the same database tables as the Brainstorm module, so
 * we hit the existing `/api/modules/brainstorm/boards/[id]` endpoint when we
 * need to read a single board's full state (nodes + edges). This keeps both
 * modules in sync: any cache invalidation under the `['brainstorm-board', id]`
 * key will refresh both UIs.
 *
 * For listing and creating boards we use the dedicated Brainstorm AI endpoints
 * so this module can have its own visibility / naming defaults.
 */

const aiBoardsKey = ['brainstorm-ai-boards']
const sharedBoardKey = (id: string) => ['brainstorm-board', id]

async function readJsonError(res: Response, fallback: string) {
  const err = await res.json().catch(() => ({}))
  const details = Array.isArray(err.details)
    ? err.details.map((item: any) => item.message).join(', ')
    : undefined
  throw new Error(details || err.error || fallback)
}

export function useBrainstormAIBoards() {
  return useQuery({
    queryKey: aiBoardsKey,
    queryFn: async (): Promise<BrainstormBoardSummary[]> => {
      const res = await fetch('/api/modules/brainstorm-ai/boards')
      if (!res.ok) await readJsonError(res, 'Failed to fetch boards')
      const data = await res.json()
      return data.boards || []
    },
  })
}

export function useCreateBrainstormAIBoard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateBoardRequest): Promise<BrainstormBoardSummary> => {
      const res = await fetch('/api/modules/brainstorm-ai/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) await readJsonError(res, 'Failed to create board')
      const data = await res.json()
      return data.board
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiBoardsKey })
    },
  })
}

export function useBrainstormAIBoard(boardId: string | null) {
  return useQuery({
    queryKey: sharedBoardKey(boardId ?? ''),
    enabled: Boolean(boardId),
    queryFn: async (): Promise<BrainstormBoard> => {
      const res = await fetch(`/api/modules/brainstorm/boards/${boardId}`)
      if (!res.ok) await readJsonError(res, 'Failed to fetch board')
      const data = await res.json()
      return data.board
    },
  })
}
