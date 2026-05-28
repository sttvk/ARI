'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { EditRequest, EditResponse } from '@/modules/brainstorm-ai/types'

/**
 * Conversational AI edit mutation. POSTs the full message history to the edit
 * endpoint. The response is a discriminated union:
 *   - `{status:'ask', question}` — model wants more info; do NOT invalidate.
 *   - `{status:'apply', ...}` — DB changed; invalidate the board cache so both
 *     the Brainstorm and Brainstorm-AI canvases refetch.
 */
export function useBrainstormAIEdit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: EditRequest): Promise<EditResponse> => {
      const res = await fetch('/api/modules/brainstorm-ai/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const details = Array.isArray(err.details)
          ? err.details.map((item: any) => item.message).join(', ')
          : undefined
        throw new Error(details || err.error || 'Failed to apply edits')
      }
      return res.json()
    },
    onSuccess: (data, variables) => {
      // Only invalidate when the DB actually changed — `ask` turns don't touch it.
      if (data.status === 'apply') {
        queryClient.invalidateQueries({ queryKey: ['brainstorm-board', variables.board_id] })
        queryClient.invalidateQueries({ queryKey: ['brainstorm-ai-boards'] })
        queryClient.invalidateQueries({ queryKey: ['brainstorm-boards'] })
      }
    },
  })
}
