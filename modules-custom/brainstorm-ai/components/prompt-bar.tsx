'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Loader2, Send, Sparkles } from 'lucide-react'

export type AIMessageKind = 'question' | 'suggestion'

interface PromptBarProps {
  onSubmit: (prompt: string) => Promise<void>
  isPending: boolean
  /** Latest AI message text. Null = nothing to show. */
  aiMessage?: string | null
  /** Drives placeholder + CTA label. */
  aiMessageKind?: AIMessageKind | null
}

export default function PromptBar({
  onSubmit,
  isPending,
  aiMessage,
  aiMessageKind,
}: PromptBarProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // When a new AI message arrives, focus the input so the user can respond.
  useEffect(() => {
    if (aiMessage && inputRef.current) {
      inputRef.current.focus()
    }
  }, [aiMessage])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || isPending) return
    try {
      await onSubmit(trimmed)
      setValue('')
    } catch {
      // caller surfaces the error via toast; keep input populated for retry
    }
  }

  const placeholder = !aiMessage
    ? 'Tell the canvas what to do…'
    : aiMessageKind === 'question'
      ? 'Type your answer…'
      : 'Type a follow-up to adjust the diagram…'

  const ctaLabel = !aiMessage
    ? 'Send'
    : aiMessageKind === 'question'
      ? 'Answer'
      : 'Reply'

  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 w-[640px] max-w-[92vw]">
      {aiMessage && (
        <div className="w-full backdrop-blur-md bg-background/80 border border-border/60 rounded-2xl shadow-xl px-4 py-3 flex items-start gap-3 max-h-[40vh] overflow-y-auto">
          <div className="h-7 w-7 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300" />
          </div>
          <p className="flex-1 text-sm text-foreground leading-snug whitespace-pre-line">
            {aiMessage}
          </p>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="w-full backdrop-blur-md bg-background/70 border border-border/60 rounded-full shadow-xl p-2 flex items-center gap-2"
      >
        <div className="pl-3 pr-1 text-muted-foreground shrink-0">
          <Sparkles className="h-4 w-4" />
        </div>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={isPending}
          className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-0"
        />
        <Button
          type="submit"
          size="sm"
          disabled={isPending || value.trim().length === 0}
          className="rounded-full shrink-0"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Send className="h-4 w-4 mr-1" />
              {ctaLabel}
            </>
          )}
        </Button>
      </form>
    </div>
  )
}
