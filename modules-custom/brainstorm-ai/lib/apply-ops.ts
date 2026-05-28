/**
 * Applies a batch of AI-emitted edit operations against the Brainstorm tables.
 *
 * Strategy:
 *   1. Walk `add_node` ops first. Group by parent_id so siblings can be spread
 *      radially around their parent (see `positionNewNode`). As each node is
 *      inserted, record its UUID against the AI-supplied `temp_id` in
 *      `tempIdMap`.
 *   2. Walk the remaining ops (update / delete / edges). Edge endpoints may
 *      reference either an existing UUID or a temp_id from step 1 — both are
 *      resolved through `tempIdMap`.
 *
 * `add_edge` uses ON CONFLICT DO NOTHING because the table has a unique
 * (board_id, source_node_id, target_node_id) constraint; the AI sometimes
 * emits a redundant edge and we'd rather silently drop it than 500.
 *
 * Bad references (unknown temp_ids, missing UUIDs, self-loops) are logged and
 * skipped — never thrown — so a single bad op never poisons the whole batch.
 */

import { and, eq, inArray } from 'drizzle-orm'
import type { DrizzleDb } from '@/lib/db'
import { brainstormNodes, brainstormEdges } from '@/lib/db/schema'
import type { EditOperation } from '@/modules/brainstorm-ai/types'
import { positionNewNode } from './layout'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export async function applyOperations(
  db: DrizzleDb,
  ops: EditOperation[],
  boardId: string,
  userId: string,
): Promise<EditOperation[]> {
  // No structural pre-filter — the AI commits to an edge policy as part of
  // its `propose` turn, and the user approves it before any operations are
  // generated. Trust the proposal. For DAG/network structures, cross-edges
  // between new nodes are exactly what's wanted.
  const applied: EditOperation[] = []
  const tempIdMap = new Map<string, string>()

  // ── Pass 1: add_node ──────────────────────────────────────────────────
  const addOps = ops.filter((o): o is Extract<EditOperation, { type: 'add_node' }> => o.type === 'add_node')

  // Resolve which existing parents we'll need so we can fetch their positions
  // and current child counts in one go.
  const existingParentIds = new Set<string>()
  for (const op of addOps) {
    if (op.parent_id && isUuid(op.parent_id)) existingParentIds.add(op.parent_id)
  }

  const parentRows = existingParentIds.size > 0
    ? await db
        .select({ id: brainstormNodes.id, x: brainstormNodes.x, y: brainstormNodes.y, color: brainstormNodes.color })
        .from(brainstormNodes)
        .where(and(eq(brainstormNodes.boardId, boardId), inArray(brainstormNodes.id, Array.from(existingParentIds))))
    : []

  const parentById = new Map(parentRows.map((r) => [r.id, { x: Number(r.x), y: Number(r.y), color: r.color as string }]))

  // Existing sibling counts per parent — so AI-added nodes don't overlap
  // children added by the human earlier.
  const existingChildCountByParent = new Map<string, number>()
  if (existingParentIds.size > 0) {
    const childRows = await db
      .select({ source: brainstormEdges.sourceNodeId })
      .from(brainstormEdges)
      .where(and(eq(brainstormEdges.boardId, boardId), inArray(brainstormEdges.sourceNodeId, Array.from(existingParentIds))))
    for (const r of childRows) {
      existingChildCountByParent.set(r.source, (existingChildCountByParent.get(r.source) ?? 0) + 1)
    }
  }

  // Track in-batch sibling positions: for a given parent (uuid OR temp_id),
  // how many children have we already placed this batch?
  const batchChildIndexByParent = new Map<string, number>()

  // We must process add_nodes in source order so that parent-temp-id refs
  // resolve before children that reference them.
  for (const op of addOps) {
    let parentUuid: string | null = null
    let parentPos: { x: number; y: number } | null = null
    let inheritedColor: string | undefined

    if (op.parent_id == null) {
      parentPos = null
    } else if (isUuid(op.parent_id)) {
      const row = parentById.get(op.parent_id)
      if (!row) {
        console.warn(`[brainstorm-ai] add_node references unknown parent UUID ${op.parent_id}; skipping`)
        continue
      }
      parentUuid = op.parent_id
      parentPos = { x: row.x, y: row.y }
      inheritedColor = row.color
    } else {
      // parent_id is a temp_id from earlier in this batch
      const resolved = tempIdMap.get(op.parent_id)
      if (!resolved) {
        console.warn(`[brainstorm-ai] add_node references unknown temp parent ${op.parent_id}; skipping`)
        continue
      }
      parentUuid = resolved
      // pull position from what we just inserted
      const justInserted = parentById.get(resolved)
      parentPos = justInserted ? { x: justInserted.x, y: justInserted.y } : { x: 0, y: 0 }
      inheritedColor = justInserted?.color
    }

    const parentKey = parentUuid ?? '__root__'
    const existingCount = parentUuid ? (existingChildCountByParent.get(parentUuid) ?? 0) : 0
    const batchIndex = batchChildIndexByParent.get(parentKey) ?? 0
    const siblingIndex = existingCount + batchIndex
    const siblingCount = Math.max(siblingIndex + 1, existingCount + (addOps.filter((o) => o.parent_id === op.parent_id).length))
    batchChildIndexByParent.set(parentKey, batchIndex + 1)

    const { x, y } = positionNewNode(parentPos, siblingCount, siblingIndex)
    const color = op.color ?? inheritedColor ?? 'slate'

    try {
      const [row] = await db
        .insert(brainstormNodes)
        .values({ boardId, userId, text: op.text, x, y, color })
        .returning()

      if (!row) {
        console.warn(`[brainstorm-ai] add_node insert returned no row (temp_id=${op.temp_id})`)
        continue
      }

      tempIdMap.set(op.temp_id, row.id)
      // Make the freshly-inserted node available as a parent for later ops
      parentById.set(row.id, { x: Number(row.x), y: Number(row.y), color: row.color as string })

      // Auto-link to parent so the tree stays connected.
      if (parentUuid) {
        try {
          await db
            .insert(brainstormEdges)
            .values({ boardId, userId, sourceNodeId: parentUuid, targetNodeId: row.id })
            .onConflictDoNothing()
        } catch (edgeErr) {
          console.warn('[brainstorm-ai] auto-edge insert failed:', edgeErr)
        }
      }

      applied.push(op)
    } catch (err) {
      console.warn(`[brainstorm-ai] add_node failed (temp_id=${op.temp_id}):`, err)
    }
  }

  // ── Pass 2: update_node / delete_node / add_edge / delete_edge ────────
  const resolve = (ref: string): string | null => {
    if (isUuid(ref)) return ref
    return tempIdMap.get(ref) ?? null
  }

  for (const op of ops) {
    if (op.type === 'add_node') continue

    try {
      if (op.type === 'update_node') {
        const target = resolve(op.id)
        if (!target) {
          console.warn(`[brainstorm-ai] update_node unknown id ${op.id}; skipping`)
          continue
        }
        const result = await db
          .update(brainstormNodes)
          .set({ text: op.text })
          .where(and(eq(brainstormNodes.id, target), eq(brainstormNodes.userId, userId), eq(brainstormNodes.boardId, boardId)))
          .returning({ id: brainstormNodes.id })
        if (result.length === 0) {
          console.warn(`[brainstorm-ai] update_node ${target} matched no row; skipping`)
          continue
        }
        applied.push(op)
      } else if (op.type === 'delete_node') {
        const target = resolve(op.id)
        if (!target) {
          console.warn(`[brainstorm-ai] delete_node unknown id ${op.id}; skipping`)
          continue
        }
        // Edges cascade via FK
        const result = await db
          .delete(brainstormNodes)
          .where(and(eq(brainstormNodes.id, target), eq(brainstormNodes.userId, userId), eq(brainstormNodes.boardId, boardId)))
          .returning({ id: brainstormNodes.id })
        if (result.length === 0) {
          console.warn(`[brainstorm-ai] delete_node ${target} matched no row; skipping`)
          continue
        }
        applied.push(op)
      } else if (op.type === 'add_edge') {
        const src = resolve(op.source)
        const tgt = resolve(op.target)
        if (!src || !tgt) {
          console.warn(`[brainstorm-ai] add_edge unresolved endpoints (${op.source} -> ${op.target}); skipping`)
          continue
        }
        if (src === tgt) {
          console.warn(`[brainstorm-ai] add_edge self-loop on ${src}; skipping`)
          continue
        }
        await db
          .insert(brainstormEdges)
          .values({ boardId, userId, sourceNodeId: src, targetNodeId: tgt })
          .onConflictDoNothing()
        applied.push(op)
      } else if (op.type === 'delete_edge') {
        const src = resolve(op.source)
        const tgt = resolve(op.target)
        if (!src || !tgt) {
          console.warn(`[brainstorm-ai] delete_edge unresolved endpoints (${op.source} -> ${op.target}); skipping`)
          continue
        }
        await db
          .delete(brainstormEdges)
          .where(
            and(
              eq(brainstormEdges.boardId, boardId),
              eq(brainstormEdges.userId, userId),
              eq(brainstormEdges.sourceNodeId, src),
              eq(brainstormEdges.targetNodeId, tgt),
            ),
          )
        applied.push(op)
      }
    } catch (err) {
      console.warn(`[brainstorm-ai] op failed (${op.type}):`, err)
    }
  }

  return applied
}
