/**
 * Brainstorm-AI canvas layout helper.
 *
 * Children of a parent node are spread radially around the parent so the AI
 * doesn't pile every new node on top of {0,0}. The angle for any one child is
 * computed from its index inside its sibling group so the same call always
 * yields the same coordinates given the same inputs.
 */

const RING_RADIUS = 220
const NODE_SPREAD = 40 // degrees between siblings

export function positionNewNode(
  parent: { x: number; y: number } | null,
  siblingCount: number,
  siblingIndex: number,
): { x: number; y: number } {
  if (!parent) return { x: 0, y: 0 }

  // Center the fan around the parent: sibling 0 sits at -((n-1)/2) * spread.
  const total = Math.max(1, siblingCount)
  const offset = (siblingIndex - (total - 1) / 2) * NODE_SPREAD
  const angleDeg = offset
  const angleRad = (angleDeg * Math.PI) / 180

  return {
    x: parent.x + RING_RADIUS * Math.cos(angleRad),
    y: parent.y + RING_RADIUS * Math.sin(angleRad),
  }
}
