# Bug Fix Board & Sidebar Reorganization — Design

Date: 2026-08-22

## Purpose

Two independent changes, bundled because the second one is what the sidebar reorg makes room
for:

1. **Sidebar reorganization** into three groups (Overview / Operation / System), matching a
   clearer mental model of what each page is for.
2. **A new "Bug fix" page**, backed by a real, already-in-use Hermes kanban board
   (`vdecent-bug-backlog`, display name "V-Decent Bug Backlog") that today has zero UI at all —
   it's operated purely via the `hermes kanban` CLI. Unlike the read-only Support Team boards,
   this page needs real write capability: humans file bug/feature tickets, comment on them, and
   manage their status, since — per operator clarification — this board is for a to-be-determined
   DevOps team's work, with the V-Decent Support coordinators limited to creating and viewing
   tickets (escalating from support incidents), not doing the fix work themselves.

## Background: the board is real and already working (verified live during design)

`vdecent-bug-backlog` already exists on `vdecentserver0` with one completed ticket, created by a
human/coordinator escalation from a support incident (`Source incident: t_0e6fa680
(vdecent-support-dev)`), picked up autonomously by `vdecent-dev-coordinator` via Hermes's own
kanban dispatcher (nothing to do with this dashboard), worked through two comments, and shipped a
real fix to `vdecent-app-manager` (commit `2914d7e`, tag `v3.3.1`, 211 backend tests). This
confirms: the dashboard's job is purely to be a good human-facing window onto this board — Hermes
already handles dispatching agent work the moment a ticket exists with the right shape; the
dashboard never needs to orchestrate that.

The CLI's relevant subcommands (`hermes kanban --help`, verified live): `create`, `comment`,
`block`, `unblock`, `archive`, `reassign`, `show` (with `--json`, returning body + comments +
result + events). None of `kind: "kanban"` (the one kanban-related `AgentRequest` kind that
already exists in `hermes-bridge/bridge.mjs`) is called from any frontend code today — it's dead
code, safe to replace rather than preserve for compatibility.

## 1. Sidebar reorganization

`src/components/sidebar.tsx`'s `navGroups` (and `src/components/command-palette.tsx`'s `NAV`,
kept in sync per this repo's established convention) become:

```
Overview
  Dashboard        /
  V-Decent Dev      /vdecent-dev
  V-Decent Pro      /vdecent-pro

Operation
  Support · Dev     /support-dev
  Support · Pro     /support-pro
  Tasks              /tasks

System
  Hermes             /hermes
  Memory Wiki         /memory-wiki
  Bug fix              /bug-fix
  Ideas                /ideas
```

No items removed or renamed beyond the group they sit in; "Bug fix" is the only new entry,
pointing at the new page below.

## 2. Data layer

**`HermesTask`** gains one nullable column:

```prisma
body String?   // the kanban task's opening post / description
```

`hermes-bridge/bridge.mjs`'s `mirrorKanban()` upsert already has every other field the kanban
JSON provides — `body` is simply added to both the `INSERT` column list and the `ON CONFLICT`
update, sourced from `t.body`.

**`hermes-bridge/bridge.mjs`'s `KANBAN_BOARDS`** gains `"vdecent-bug-backlog"`, so it's mirrored
into `HermesTask` on the existing 30s cycle alongside `default`, `vdecent-support-dev`, and
`vdecent-support-prod`. No new infrastructure — the bridge already has visibility into every
board via the same shared kanban SQLite file.

**`AgentRequest`** gains one nullable column, parallel to the existing `profile` column but for
kanban operations instead of chat:

```prisma
board String?   // e.g. "vdecent-bug-backlog"; which kanban board this request targets
```

## 3. Bridge: `kanban.*` request kinds

`runRequest()`'s existing bare `kind === "kanban"` branch (dead code, no caller) is replaced by
six board-aware kinds. Each builds its CLI args from `r.board` and a JSON-encoded `r.prompt`
(matching the existing `cron.*` kinds' convention of using `prompt` as a structured payload for
anything beyond a single string):

| kind | prompt shape | CLI invocation |
|---|---|---|
| `kanban.create` | n/a — uses `r.title` (ticket title) and `r.prompt` (plain text body, not JSON, matching how `chat`/`oneshot` already use `prompt`) | `kanban --board <board> create --json <title> --body <body>` |
| `kanban.comment` | `{taskId, text}` | `kanban --board <board> comment <taskId> <text>` |
| `kanban.block` | `{taskId, reason?}` | `kanban --board <board> block <taskId> [<reason>]` |
| `kanban.unblock` | `{taskId, reason?}` | `kanban --board <board> unblock <taskId> [--reason <reason>]` |
| `kanban.archive` | `{taskId}` | `kanban --board <board> archive <taskId>` |
| `kanban.reassign` | `{taskId, profile}` | `kanban --board <board> reassign <taskId> <profile> --reclaim` |
| `kanban.show` | `{taskId}` | `kanban --board <board> show <taskId> --json` |

`kanban.reassign` always passes `--reclaim` (the CLI says it's "required if task is running";
passing it unconditionally is the simplest UI). This needs a live check during implementation's
deploy/verify step — reassigning a non-running ticket with `--reclaim` present — to confirm it's
a safe no-op rather than an error; if it isn't, dropping the flag for non-running tickets is a
small follow-up, not a blocker to shipping the rest.

`kanban.show` exists because comments aren't mirrored into Postgres — mirroring the full comment
thread would need its own table and sync logic for something only needed on-demand when a human
opens a ticket's detail view. `show` is a fast local SQLite read (not an LLM call), so it
resolves in roughly one bridge poll cycle (~5s), not the multi-minute budget chat needs.

All six reuse the existing `AgentRequest` queue + `GET /api/hermes/requests/:id` poll pattern
already proven for live chat — no new communication channel between the dashboard and the bridge.

## 4. API routes

- **`GET /api/bug-backlog/tickets`** — reads `HermesTask WHERE board = 'vdecent-bug-backlog'`
  from the mirror (same pattern as `/api/support-team/[env]/tasks`).
- **`POST /api/bug-backlog/tickets`** — body `{title, body}` (no environment field, per operator
  decision — this is a flat backlog, matching how the one real example ticket stored environment
  context in its description text, not a structured field). Creates a `kanban.create`
  `AgentRequest`. Returns `{requestId}`.
- **`POST /api/bug-backlog/tickets/[id]/action`** — body `{action: "comment"|"block"|"unblock"|
  "archive"|"reassign", ...fields}`. One consolidated route dispatching the matching `kanban.*`
  kind server-side, rather than five near-identical route files. Returns `{requestId}`.
- **`POST /api/bug-backlog/tickets/[id]/detail`** — dispatches `kanban.show`. Returns
  `{requestId}`; the frontend polls the standard `GET /api/hermes/requests/:id` and parses
  `result` as JSON (the CLI's own `--json` output) to get body/comments/result/events.

## 5. Frontend: `/bug-fix` page

- **List view** reuses `TaskBoard` (`src/components/task-board.tsx`) — column grouping and
  styling are already generic. It gains one new optional prop, `onSelectTask?: (task: Task) =>
  void`; when provided, cards get `cursor-pointer` and an `onClick`. Every other consumer
  (`/hermes`, `/support-dev`, `/support-pro`) doesn't pass it, so they stay exactly as read-only
  as they are today — this mirrors the `onSelectAgent` addition made to `SupportOfficeView` in the
  prior increment, for the same reason (opt-in interactivity without disturbing existing
  read-only callers).
- **"New ticket" button** opens a form: title + description. On submit, `POST
  /api/bug-backlog/tickets`, then polls for completion the same way live chat does (a short
  "creating…" state, since `kanban.create` resolves in one poll cycle, not minutes).
- **Ticket detail panel** (opened by clicking a card): dispatches `kanban.show` on open, renders
  body/status/assignee/result/comments once it resolves. Includes:
  - A comment box (`action: "comment"`).
  - Block / Unblock / Archive buttons (`action: "block"|"unblock"|"archive"`), gated to make
    sense for the ticket's current status (e.g. no "Archive" on an already-archived ticket).
  - A free-text reassign field, not a hardcoded profile dropdown — there's no DevOps-team profile
    to list yet (explicitly TBD per the operator), so free-text keeps this open rather than
    baking in a guess at future org structure.

## Out of scope

- Any change to how the coordinator or a future DevOps team actually works a ticket — that's
  entirely Hermes-side (kanban dispatch, profile SOUL.md/tools), unaffected by this dashboard.
- An environment (dev/prod) field on tickets — explicitly decided against; flat backlog.
- A structured/dropdown reassign target — free-text until a DevOps-team profile concept exists.
- Mirroring comments into Postgres for the list view — comments are fetched live, on-demand, only
  when a ticket's detail panel is opened.
- Any change to `TaskBoard`'s existing read-only usage on `/hermes`, `/support-dev`,
  `/support-pro` — the new `onSelectTask` prop is additive and optional.
