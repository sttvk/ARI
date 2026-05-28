# Brainstorm AI — a hackathon module for ARI

Type what you want to diagram in plain English. The AI asks clarifying
questions when the request is genuinely ambiguous, builds the diagram, and
invites you to iterate. Works for mind maps, system designs, comparisons,
plans, journeys — anything that has structure.

Built as a custom module for the [ARI](https://ari.software) open-source
productivity OS. Drops into ARI's existing brainstorming canvas and adds a
conversational AI layer on top.

---

## What it does

- **Conversational design** — type your idea, the AI clarifies what it
  needs, then builds the diagram.
- **Iterative refinement** — after generation, the AI suggests next
  adjustments in a pill above the input ("want me to add a budget
  breakdown or stretch it to 4 days?"). Type a follow-up and it extends
  the diagram in place.
- **Smart structure** — the model picks the right shape for your topic
  (tree for plans, DAG for systems, matrix for comparisons, network for
  concept maps) without being told.
- **Real-world judgment** — knows a 3-day trip fits ~6 stops, that a 1M
  DAU system needs different scaffolding than 1K DAU, that a 6-month
  study plan looks different from a 2-week one.
- **Full manual editing alongside** — drag nodes, rename, recolor,
  connect with new edges, delete — every original Brainstorm capability
  works at the same time as the AI flow.
- **Auto-layout** — clean left-to-right layout for trees, top-to-bottom
  for system flows, via dagre. No positioning required.

---

## Quick start

You need a working [ARI install](https://ari.software/docs) and an
Anthropic API key (https://console.anthropic.com/settings/keys — new
accounts get free credit).

```bash
# Install the two extra packages the module needs
pnpm add @anthropic-ai/sdk dagre @types/dagre

# Add your key to .env.local at the ARI root
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env.local

# Start (or restart) ARI
./ari start
```

Then browse to: **http://localhost:3000/brainstorm-ai**

---

## How to use it

Sign in, click **New board**, name it, open it. The canvas appears with
a floating prompt bar at the bottom. Type what you want.

### Manual editing always works

You can drag any node, click to rename it, cycle its color, connect it
to others, or delete it. There's a toolbar (top-left of the canvas) with:

- **Add idea** — drop a blank node
- **Auto-layout** — re-tidy the diagram with dagre
- **Save** — persist your manual changes
- **Lock / Unlock** — prevent accidental edits while presenting

---

## Built on ARI

This module sits in `modules-custom/brainstorm-ai/` and depends on ARI's
core Brainstorm module — they share the same database tables, so boards
created here are also visible in `/brainstorm`.

ARI is Apache 2.0 licensed by Panthera Ventures Inc. See [LICENSE](LICENSE)
for the full terms. This repository is a derivative work for hackathon
purposes; all upstream code, design, and platform architecture remain
the property of the ARI team.
