'use client'

import { useEffect, useState } from 'react'
import { useModuleEnabled } from '@/lib/modules/module-hooks'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Loader2, Plus, Trash2, Network, ArrowLeft, Sparkles } from 'lucide-react'
import {
  useBrainstormBoard,
  useBrainstormBoards,
  useCreateBrainstormBoard,
  useDeleteBrainstormBoard,
} from '@/modules/brainstorm/hooks/use-brainstorm'
import BrainstormAICanvas from '../components/canvas'

/**
 * Brainstorm-AI page.
 *
 * Mirrors the structure of `modules-core/brainstorm/app/page.tsx`:
 *   - Board list with cards (count of ideas per board)
 *   - "New board" inline create flow
 *   - Selected board renders the canvas
 *   - Optional random quote from the Quotes module at the top
 *
 * Since brainstorm-ai shares the `brainstorm_boards/nodes/edges` tables with
 * the regular Brainstorm module, we reuse those hooks directly. Boards created
 * here are visible (and editable) in the regular Brainstorm canvas too.
 */
export default function BrainstormAIPage() {
  const { toast } = useToast()
  const { enabled: quotesEnabled, loading: quotesLoading } = useModuleEnabled('quotes')
  const [randomQuote, setRandomQuote] = useState<{ quote: string; author?: string } | null>(null)

  const { data: boards = [], isLoading: boardsLoading } = useBrainstormBoards()
  const createBoard = useCreateBrainstormBoard()
  const deleteBoard = useDeleteBrainstormBoard()

  const [selectedId, setSelectedId] = useState<string>('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [nameError, setNameError] = useState('')

  const { data: currentBoard, isLoading: boardLoading } = useBrainstormBoard(selectedId)

  // Random quote from the Quotes module, if enabled.
  useEffect(() => {
    if (!quotesEnabled || quotesLoading) return
    let cancelled = false
    fetch('/api/modules/quotes/quotes')
      .then((res) => (res.ok ? res.json() : []))
      .then((quotes) => {
        if (!cancelled && Array.isArray(quotes) && quotes.length > 0) {
          setRandomQuote(quotes[Math.floor(Math.random() * quotes.length)])
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [quotesEnabled, quotesLoading])

  const handleCreate = () => {
    const trimmed = newName.trim()
    if (!trimmed) {
      setNameError('Board name is required')
      return
    }
    if (trimmed.length > 200) {
      setNameError('Board name must be 200 characters or less')
      return
    }
    setNameError('')
    createBoard.mutate(
      { name: trimmed },
      {
        onSuccess: (board) => {
          setSelectedId(board.id)
          setCreating(false)
          setNewName('')
        },
        onError: (err) => {
          toast({ variant: 'destructive', title: 'Failed to create board', description: err.message })
        },
      },
    )
  }

  const handleDelete = () => {
    if (!selectedId) return
    if (!confirm('Delete this board and all its ideas?')) return
    const id = selectedId
    deleteBoard.mutate(id, {
      onSuccess: () => {
        setSelectedId('')
      },
      onError: (err) => {
        toast({ variant: 'destructive', title: 'Failed to delete board', description: err.message })
      },
    })
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-4xl font-medium flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-violet-500" />
            Brainstorm AI
          </h1>
          {quotesEnabled && randomQuote && (
            <p className="text-sm text-[#aa2020] mt-1">{randomQuote.quote}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedId && (
            <Button variant="outline" onClick={() => setSelectedId('')}>
              <ArrowLeft className="w-4 h-4 mr-1" /> All boards
            </Button>
          )}
          <Button onClick={() => { setCreating(true); setNewName(''); setNameError('') }}>
            <Plus className="w-4 h-4 mr-1" /> New board
          </Button>
          {selectedId && (
            <Button variant="outline" onClick={handleDelete} disabled={deleteBoard.isPending}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {creating && (
        <Card>
          <CardContent className="p-4 flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Input
                autoFocus
                value={newName}
                onChange={(e) => { setNewName(e.target.value); if (nameError) setNameError('') }}
                placeholder="Board name"
                className={nameError ? 'border-red-500 focus-visible:ring-red-500' : ''}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
              />
              {nameError && <p className="text-xs text-red-500">{nameError}</p>}
            </div>
            <Button onClick={handleCreate} disabled={createBoard.isPending}>
              {createBoard.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </Button>
            <Button variant="ghost" onClick={() => { setCreating(false); setNameError('') }}>Cancel</Button>
          </CardContent>
        </Card>
      )}

      {boardsLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : boards.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Network className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="mb-4">No boards yet. Create one to start brainstorming with AI.</p>
            <Button onClick={() => { setCreating(true); setNewName('') }}>
              <Plus className="w-4 h-4 mr-1" /> New board
            </Button>
          </CardContent>
        </Card>
      ) : !selectedId ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {boards.map((b) => (
            <Card
              key={b.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedId(b.id)}
            >
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
                    <Sparkles className="w-5 h-5 text-violet-600 dark:text-violet-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-base truncate">{b.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {b.node_count} {b.node_count === 1 ? 'idea' : 'ideas'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : boardLoading || !currentBoard ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        // Key on board.id only — switching boards remounts, but data refreshes
        // (e.g. after AI apply) update inside the canvas via its data-aware
        // useMemo. This way the conversation pill persists across AI turns
        // and the user can refine iteratively without losing context.
        <BrainstormAICanvas key={currentBoard.id} board={currentBoard} />
      )}
    </div>
  )
}
