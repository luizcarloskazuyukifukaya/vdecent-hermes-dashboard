# Support Board Write Actions — Design

Date: 2026-08-23

## Purpose

The `/support-dev` and `/support-pro` Board views mirror the Hermes-native `vdecent-support-dev`
and `vdecent-support-prod` kanban boards — the coordinator's and its sub-agents' own operational
workspace — but are purely read-only today (`TaskBoard` has no interactive affordances; the
underlying API routes are `GET`-only). Operator investigation of a real blocked task
(`t_e5e364f8`) found a concrete case where the read-only design is actively a gap: the
underlying incident was already fixed, but the task stayed stuck in "blocked" because a Hermes
worker crashed without calling `kanban_complete`/`kanban_block` — an orphaned task a human could
have closed directly, once they could see why it was blocked and confirm the fix. This adds a
scoped write path: view a task's block reason/comments, then Comment / Unblock / Mark Done.

This explicitly does **not** include Block, Archive, or Reassign (operator decision) — those
remain agent-only decisions on this board, unlike the Bug Fix board's full six-action set.

Also explicitly out of scope for this round: any mechanism for the coordinator to *proactively*
notify a human (e.g. via its Telegram gateway) when a task needs attention. That would be a
change to the coordinator's own Hermes skill/config, which lives on `vdecentserver0` — outside
this repo and outside what this session's environment (a separate dev workstation) can reach or
verify. Skipped for now, per operator decision; a human checking the board periodically remains
the workflow.

## Background: verified during design

- `TaskBoard` (`src/components/task-board.tsx`) already accepts an optional `onSelectTask`
  callback (added for an earlier feature, currently unused by `support-team-page.tsx`) — clicking
  a card fires it. No structural change needed here; just wire it up.
- `dispatchAndPoll(url, body)` (`src/lib/bug-backlog-dispatch.ts`) is fully generic — it POSTs to
  any URL, gets back `{requestId}`, and polls `GET /api/hermes/requests/[id]` until done/failed.
  Despite its filename, nothing in it is Bug-Fix-specific; it's reused as-is, no duplication.
- `hermes-bridge/bridge.mjs`'s `runRequest()` kanban-action handler is already board-agnostic —
  it takes `board` straight from the `AgentRequest` row. No bridge-side changes needed; only new
  Next.js routes that create `AgentRequest` rows with `board: "vdecent-support-dev"` or
  `"vdecent-support-prod"` instead of the hardcoded `"vdecent-bug-backlog"`.
- The existing Bug Fix action/detail routes (`src/app/api/bug-backlog/tickets/[taskId]/{action,detail}/route.ts`)
  are the direct model for this — same `kanban.<action>` dispatch pattern, same `kanban.show`
  detail pattern — just re-parameterized by `env` instead of a single hardcoded board, and with a
  narrower `ACTIONS` set.

## What changes

### 1. Two new routes, parameterized by environment

`src/app/api/support-team/[env]/tasks/[taskId]/detail/route.ts` — `POST`, mirrors the Bug Fix
detail route exactly except the board is derived from `env`:

```ts
const BOARD: Record<"dev" | "pro", string> = { dev: "vdecent-support-dev", pro: "vdecent-support-prod" };
```

`src/app/api/support-team/[env]/tasks/[taskId]/action/route.ts` — `POST`, mirrors the Bug Fix
action route except:
- `ACTIONS = new Set(["comment", "unblock", "complete"])` (not the full six).
- Board resolved the same way as above.
- Invalid `env` (not `dev`/`pro`) → 400, matching the existing `isVDecentEnv` guard used by
  `.../chat/route.ts`.

### 2. New component: `src/components/support-task-detail-panel.tsx`

A trimmed adaptation of `TicketDetailPanel` — same modal shell, same `loadDetail()`/`runAction()`
pattern via `dispatchAndPoll`, but:
- Calls the new `/api/support-team/${env}/tasks/${taskId}/{detail,action}` routes instead of the
  bug-backlog ones.
- Footer only renders Comment (always) + Mark Done (when `status !== "done"`) + Unblock (when
  `status === "blocked"`) — no Block/Archive/Reassign UI at all.

### 3. Wire into `support-team-page.tsx`'s Board view

Add `selectedTask` state; pass `onSelectTask={setSelectedTask}` to `<TaskBoard>` in the `"board"`
view; render `<SupportTaskDetailPanel taskId={selectedTask.id} env={env} onClose={...}
onChanged={loadBoard} />` when a task is selected. `onChanged` re-runs the existing `loadBoard()`
so the board reflects the action immediately (matching Bug Fix's pattern).

## What does NOT change

- `TaskBoard` itself — already supports this via the existing `onSelectTask` prop.
- The Bug Fix board's own routes/component — untouched, no shared code beyond the already-generic
  `dispatchAndPoll`.
- `hermes-bridge/bridge.mjs` — no changes; it's already board-agnostic.
- No Block/Archive/Reassign actions, on either Support board.
- No proactive human notification (Telegram/gateway) — explicitly deferred.

## Out of scope

- Coordinator-initiated proactive notification via its Telegram gateway (requires agent-side
  skill changes outside this repo — deferred per operator decision).
- Any change to the Bug Fix board.
