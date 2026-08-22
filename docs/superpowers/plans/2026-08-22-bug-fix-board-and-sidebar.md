# Bug Fix Board & Sidebar Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real, write-capable `/bug-fix` page backed by the already-in-use `vdecent-bug-backlog` Hermes kanban board (view, create, comment, block/unblock/archive, reassign), and regroup the sidebar/command-palette navigation into Overview/Operation/System.

**Architecture:** Extends the existing `AgentRequest` → `hermes-bridge` → `hermes` CLI dispatch pattern (already proven for chat) with six new board-aware `kanban.*` request kinds, replacing the one unused legacy `kind: "kanban"` branch. `HermesTask` gains a `body` column so the list view can mirror descriptions; full detail (including comments, which aren't mirrored) is fetched live on-demand via `hermes kanban show --json` — a fast local SQLite read, not an LLM call, so it resolves in about one bridge poll cycle. `TaskBoard` gains one optional prop so the new page can make cards clickable without touching its three existing read-only consumers.

**Tech Stack:** Next.js 16 (App Router, TypeScript, client components), Prisma, `hermes-bridge/bridge.mjs` (plain Node).

## Global Constraints

- No test framework exists in this repo — verification is `npx tsc`, `node --check` for the bridge script, `npx prisma validate` for schema changes, plus a final live check against the deployed app.
- This repo uses `prisma db push --accept-data-loss` on every container boot, not migration files — schema changes are plain edits to `prisma/schema.prisma`.
- Dynamic API route params use the Next 16 async signature: `{ params }: { params: Promise<{ ... }> }`, then `const { ... } = await params;`.
- The Bug Fix board has no environment (dev/prod) field on tickets — it's a flat backlog, by operator decision.
- `hermes kanban show --json`'s response shape (verified live during design): top-level keys `task`, `comments` (an array, NOT nested under `task`), `events`, `runs`, etc. Each comment is `{ author: string, body: string, created_at: number }` — note the field is `body`, not `text`. Get this wrong and the comment thread silently renders empty.
- `kanban.reassign` always passes `--reclaim` — this needs a live check during Task 10 to confirm it's a safe no-op on a non-running ticket, not an error.
- Design spec: `docs/superpowers/specs/2026-08-22-bug-fix-board-and-sidebar-design.md`.

---

### Task 1: Schema — `HermesTask.body`, `AgentRequest.board`

**Files:**
- Modify: `prisma/schema.prisma:474-490` (`HermesTask`)
- Modify: `prisma/schema.prisma:439-459` (`AgentRequest`)

**Interfaces:**
- Produces (used by Tasks 2-5): `HermesTask.body` (nullable `String`, the kanban task's description); `AgentRequest.board` (nullable `String`, e.g. `"vdecent-bug-backlog"` — which kanban board a `kanban.*` request targets, parallel to the existing `profile` column used for chat).

- [ ] **Step 1: Add `body` to `HermesTask`**

Current (`prisma/schema.prisma:474-490`):

```prisma
model HermesTask {
  id                String    @id                   // Hermes task id
  board             String    @default("default")
  title             String
  assignee          String?
  status            String    @default("todo")
  priority          Int?
  result            String?
  kanbanCreatedAt   DateTime?
  kanbanStartedAt   DateTime?
  kanbanCompletedAt DateTime?
  updatedAt         DateTime  @default(now())
  syncedAt          DateTime  @updatedAt

  @@index([board])
  @@index([status])
}
```

Replace with:

```prisma
model HermesTask {
  id                String    @id                   // Hermes task id
  board             String    @default("default")
  title             String
  assignee          String?
  status            String    @default("todo")
  priority          Int?
  result            String?
  body              String?                          // kanban task's opening post / description
  kanbanCreatedAt   DateTime?
  kanbanStartedAt   DateTime?
  kanbanCompletedAt DateTime?
  updatedAt         DateTime  @default(now())
  syncedAt          DateTime  @updatedAt

  @@index([board])
  @@index([status])
}
```

- [ ] **Step 2: Add `board` to `AgentRequest`**

Current (`prisma/schema.prisma:439-459`):

```prisma
model AgentRequest {
  id            String    @id @default(cuid())
  origin        String    @default("web")     // "web" | "hermes"
  kind          String    @default("oneshot") // "oneshot" | "kanban" | "chat"
  title         String
  prompt        String?
  profile       String?   // e.g. "vdecent-dev-coordinator"; null = default profile
  sideEffecting Boolean   @default(false)
  status        String    @default("queued")  // queued | awaiting_approval | approved | running | done | failed | rejected
  result        String?
  error         String?
  hermesTaskId  String?
  decidedAt     DateTime?
  startedAt     DateTime?
  finishedAt    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([status])
  @@index([createdAt])
}
```

Replace with:

```prisma
model AgentRequest {
  id            String    @id @default(cuid())
  origin        String    @default("web")     // "web" | "hermes"
  kind          String    @default("oneshot") // "oneshot" | "kanban.*" | "chat" | "cron.*" | ...
  title         String
  prompt        String?
  profile       String?   // e.g. "vdecent-dev-coordinator"; null = default profile
  board         String?   // e.g. "vdecent-bug-backlog"; which kanban board a kanban.* request targets
  sideEffecting Boolean   @default(false)
  status        String    @default("queued")  // queued | awaiting_approval | approved | running | done | failed | rejected
  result        String?
  error         String?
  hermesTaskId  String?
  decidedAt     DateTime?
  startedAt     DateTime?
  finishedAt    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([status])
  @@index([createdAt])
}
```

- [ ] **Step 3: Validate and regenerate**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Run: `npx prisma generate`
Expected: completes without error; the generated client now has `HermesTask.body` and `AgentRequest.board`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat: add HermesTask.body and AgentRequest.board columns

body mirrors a kanban task's description (needed for the Bug Fix
board's list view); board identifies which kanban board a kanban.*
AgentRequest targets, parallel to the existing profile column used
for chat.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 2: Bridge — mirror `vdecent-bug-backlog`, mirror `body`, `kanban.*` request kinds

**Files:**
- Modify: `hermes-bridge/bridge.mjs` (three edits: `KANBAN_BOARDS`, `mirrorKanban()`'s upsert, `runRequest()`'s kanban branch)

**Interfaces:**
- Consumes: `AgentRequest.board` (Task 1).
- Produces: `HermesTask` rows for `board = 'vdecent-bug-backlog'` with `body` populated; six new `AgentRequest.kind` values (`kanban.create`, `kanban.comment`, `kanban.block`, `kanban.unblock`, `kanban.archive`, `kanban.reassign`, `kanban.show` — seven, not six, counting `show`) that Tasks 3-5's routes will create.

- [ ] **Step 1: Mirror the new board**

Current:

```js
const KANBAN_BOARDS = [BOARD, "vdecent-support-dev", "vdecent-support-prod"];
```

Replace with:

```js
const KANBAN_BOARDS = [BOARD, "vdecent-support-dev", "vdecent-support-prod", "vdecent-bug-backlog"];
```

- [ ] **Step 2: Mirror `body` in `mirrorKanban()`'s upsert**

Current:

```js
    await q(
      `INSERT INTO "HermesTask" (id, board, title, assignee, status, priority, result, "kanbanCreatedAt", "kanbanStartedAt", "kanbanCompletedAt", "updatedAt", "syncedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, assignee=EXCLUDED.assignee, status=EXCLUDED.status,
         priority=EXCLUDED.priority, result=EXCLUDED.result,
         "kanbanCreatedAt"=EXCLUDED."kanbanCreatedAt", "kanbanStartedAt"=EXCLUDED."kanbanStartedAt",
         "kanbanCompletedAt"=EXCLUDED."kanbanCompletedAt", "syncedAt"=now()`,
      [id, board, String(t.title ?? "untitled").slice(0, 300), t.assignee ?? null,
       String(t.status ?? "todo"), t.priority != null ? Number(t.priority) : null,
       t.result ? String(t.result).slice(0, 2000) : null,
       toDate(t.created_at), toDate(t.started_at), toDate(t.completed_at)]
    );
```

Replace with:

```js
    await q(
      `INSERT INTO "HermesTask" (id, board, title, assignee, status, priority, result, body, "kanbanCreatedAt", "kanbanStartedAt", "kanbanCompletedAt", "updatedAt", "syncedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, assignee=EXCLUDED.assignee, status=EXCLUDED.status,
         priority=EXCLUDED.priority, result=EXCLUDED.result, body=EXCLUDED.body,
         "kanbanCreatedAt"=EXCLUDED."kanbanCreatedAt", "kanbanStartedAt"=EXCLUDED."kanbanStartedAt",
         "kanbanCompletedAt"=EXCLUDED."kanbanCompletedAt", "syncedAt"=now()`,
      [id, board, String(t.title ?? "untitled").slice(0, 300), t.assignee ?? null,
       String(t.status ?? "todo"), t.priority != null ? Number(t.priority) : null,
       t.result ? String(t.result).slice(0, 2000) : null,
       t.body ? String(t.body).slice(0, 4000) : null,
       toDate(t.created_at), toDate(t.started_at), toDate(t.completed_at)]
    );
```

- [ ] **Step 3: Replace the legacy `kind === "kanban"` branch with `kanban.*` dispatch**

Current (`runRequest()`):

```js
    } else if (r.kind === "kanban") {
      result = (await hermes(["kanban", "--board", BOARD, "create", "--json", r.title], { timeout: 20000 })).trim();
    } else if (r.kind.startsWith("cron.")) {
```

Replace with:

```js
    } else if (r.kind.startsWith("kanban.")) {
      const op = r.kind.split(".")[1];
      const board = r.board || BOARD;
      let argv;
      if (op === "create") {
        argv = ["kanban", "--board", board, "create", "--json", r.title];
        if (r.prompt) argv.push("--body", r.prompt);
      } else {
        const a = JSON.parse(r.prompt || "{}");
        argv =
          op === "comment"  ? ["kanban", "--board", board, "comment", a.taskId, a.text]
          : op === "block"    ? ["kanban", "--board", board, "block", a.taskId, ...(a.reason ? [a.reason] : [])]
          : op === "unblock"  ? ["kanban", "--board", board, "unblock", a.taskId, ...(a.reason ? ["--reason", a.reason] : [])]
          : op === "archive"  ? ["kanban", "--board", board, "archive", a.taskId]
          : op === "reassign" ? ["kanban", "--board", board, "reassign", a.taskId, a.profile, "--reclaim"]
          : op === "show"     ? ["kanban", "--board", board, "show", a.taskId, "--json"]
          : null;
      }
      if (!argv) throw new Error(`unknown kanban op ${op}`);
      result = (await hermes(argv, { timeout: 20000 })).trim();
      if (op !== "show") await mirrorKanban(board);
    } else if (r.kind.startsWith("cron.")) {
```

(`mirrorKanban(board)` after any write op refreshes the Postgres mirror immediately, rather than
waiting up to 30s for the next scheduled cycle — the same pattern `cron.*` already uses with
`mirrorCrons()`.)

- [ ] **Step 4: Verify the script is syntactically valid**

Run: `node --check hermes-bridge/bridge.mjs`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add hermes-bridge/bridge.mjs
git commit -m "$(cat <<'EOF'
feat: mirror vdecent-bug-backlog and add kanban.* request kinds

Replaces the unused legacy kind:"kanban" (hardcoded to the default
board, create-only) with seven board-aware kinds — create, comment,
block, unblock, archive, reassign, show — covering the Bug Fix
board's full read/write surface. Also mirrors task body so the list
view can show descriptions.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 3: API — list and create tickets

**Files:**
- Create: `src/app/api/bug-backlog/tickets/route.ts`

**Interfaces:**
- Produces (used by Task 7): `GET /api/bug-backlog/tickets` → `{ tasks: Task[], counts, total, lastSync }` (same shape as the existing `/api/support-team/[env]/tasks`, consumed by `TaskBoard`). `POST /api/bug-backlog/tickets` with `{ title, body }` → `{ requestId }`.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Task } from "@/components/task-board";

const BOARD = "vdecent-bug-backlog";

export async function GET() {
  const rows = await prisma.hermesTask.findMany({
    where: { board: BOARD },
    orderBy: [{ status: "asc" }, { priority: "desc" }],
  });

  const tasks: Task[] = rows.map((t) => ({
    id: t.id,
    board: t.board,
    title: t.title,
    assignee: t.assignee,
    status: t.status,
    priority: t.priority,
    result: t.result,
    syncedAt: t.syncedAt.toISOString(),
  }));

  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;

  const lastSync = rows.length
    ? rows.reduce((max, r) => (r.syncedAt > max ? r.syncedAt : max), rows[0].syncedAt).toISOString()
    : null;

  return NextResponse.json({ tasks, counts, total: tasks.length, lastSync });
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const title = (b.title || "").toString().trim();
  const body = (b.body || "").toString().trim();
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind: "kanban.create",
      title: title.slice(0, 200),
      prompt: body || null,
      board: BOARD,
      sideEffecting: false,
      status: "queued",
    },
  });
  return NextResponse.json({ requestId: row.id });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/bug-backlog/tickets/route.ts
git commit -m "$(cat <<'EOF'
feat: add list/create route for the Bug Fix board

GET returns the mirrored vdecent-bug-backlog tasks in TaskBoard's
existing shape; POST queues a kanban.create AgentRequest.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 4: API — comment / block / unblock / archive / reassign

**Files:**
- Create: `src/app/api/bug-backlog/tickets/[taskId]/action/route.ts`

**Interfaces:**
- Produces (used by Task 8): `POST /api/bug-backlog/tickets/:taskId/action` with `{ action: "comment"|"block"|"unblock"|"archive"|"reassign", ...fields }` → `{ requestId }`, or `{ error }` (400) for an invalid action or missing required field.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const BOARD = "vdecent-bug-backlog";
const ACTIONS = new Set(["comment", "block", "unblock", "archive", "reassign"]);

export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const b = await req.json().catch(() => ({}));
  const action = (b.action || "").toString();
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  const payload: Record<string, unknown> = { taskId };
  let title = "";

  if (action === "comment") {
    const text = (b.text || "").toString().trim();
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
    payload.text = text;
    title = `Comment on ${taskId}`;
  } else if (action === "block" || action === "unblock") {
    const reason = (b.reason || "").toString().trim();
    if (reason) payload.reason = reason;
    title = `${action === "block" ? "Block" : "Unblock"} ${taskId}`;
  } else if (action === "archive") {
    title = `Archive ${taskId}`;
  } else if (action === "reassign") {
    const profile = (b.profile || "").toString().trim();
    if (!profile) return NextResponse.json({ error: "profile required" }, { status: 400 });
    payload.profile = profile;
    title = `Reassign ${taskId} to ${profile}`;
  }

  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind: `kanban.${action}`,
      title: title.slice(0, 200),
      prompt: JSON.stringify(payload),
      board: BOARD,
      sideEffecting: false,
      status: "queued",
    },
  });
  return NextResponse.json({ requestId: row.id });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/bug-backlog/tickets/\[taskId\]/action/route.ts
git commit -m "$(cat <<'EOF'
feat: add ticket action route (comment/block/unblock/archive/reassign)

One consolidated route dispatching the matching kanban.* AgentRequest
kind per action, rather than five near-identical route files.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 5: API — on-demand full ticket detail

**Files:**
- Create: `src/app/api/bug-backlog/tickets/[taskId]/detail/route.ts`

**Interfaces:**
- Produces (used by Task 8): `POST /api/bug-backlog/tickets/:taskId/detail` → `{ requestId }`. Polling that request's result (via the existing `GET /api/hermes/requests/:id`) yields a JSON string matching `hermes kanban show --json`'s shape: `{ task: { id, title, body, status, assignee, result, ... }, comments: [{ author, body, created_at }], ... }`.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const BOARD = "vdecent-bug-backlog";

export async function POST(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind: "kanban.show",
      title: `Show ${taskId}`,
      prompt: JSON.stringify({ taskId }),
      board: BOARD,
      sideEffecting: false,
      status: "queued",
    },
  });
  return NextResponse.json({ requestId: row.id });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/bug-backlog/tickets/\[taskId\]/detail/route.ts
git commit -m "$(cat <<'EOF'
feat: add on-demand full ticket detail route

Dispatches kanban.show, which returns body + comments + result —
none of which (except body) are mirrored into Postgres, since
they're only needed when a human opens a ticket's detail view.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 6: `TaskBoard` — optional click-to-select

**Files:**
- Modify: `src/components/task-board.tsx`

**Interfaces:**
- Produces (used by Task 7/8): `TaskBoard`'s new optional prop `onSelectTask?: (task: Task) => void`. When omitted (every existing consumer — `/hermes`, `/support-dev`, `/support-pro`), behavior is byte-identical to today.

- [ ] **Step 1: Add the prop to the function signature**

Current:

```tsx
export function TaskBoard({
  tasks,
  total,
  lastSync,
  label = "Task board",
  title = "Hermes kanban",
  emptyTitle = "No tasks on the board",
  emptyHint = "Dispatched work and synced kanban cards will show up here.",
}: {
  tasks: Task[];
  total: number;
  lastSync: string | null;
  label?: string;
  title?: string;
  emptyTitle?: string;
  emptyHint?: string;
}) {
```

Replace with:

```tsx
export function TaskBoard({
  tasks,
  total,
  lastSync,
  label = "Task board",
  title = "Hermes kanban",
  emptyTitle = "No tasks on the board",
  emptyHint = "Dispatched work and synced kanban cards will show up here.",
  onSelectTask,
}: {
  tasks: Task[];
  total: number;
  lastSync: string | null;
  label?: string;
  title?: string;
  emptyTitle?: string;
  emptyHint?: string;
  onSelectTask?: (task: Task) => void;
}) {
```

- [ ] **Step 2: Wire the click handler onto each card**

Current:

```tsx
                      <div
                        key={t.id}
                        className="panel p-3.5"
                        style={{
                          borderLeft: `2px solid color-mix(in srgb, ${
                            tone === "neutral" ? "var(--text-3)" : `var(--${tone})`
                          } 55%, transparent)`,
                        }}
                      >
```

Replace with:

```tsx
                      <div
                        key={t.id}
                        className={`panel p-3.5 ${onSelectTask ? "cursor-pointer panel-interactive" : ""}`}
                        style={{
                          borderLeft: `2px solid color-mix(in srgb, ${
                            tone === "neutral" ? "var(--text-3)" : `var(--${tone})`
                          } 55%, transparent)`,
                        }}
                        onClick={onSelectTask ? () => onSelectTask(t) : undefined}
                      >
```

- [ ] **Step 3: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/task-board.tsx
git commit -m "$(cat <<'EOF'
feat: add optional click-to-select to TaskBoard cards

onSelectTask is opt-in — every existing read-only consumer
(/hermes, /support-dev, /support-pro) doesn't pass it and stays
exactly as non-interactive as before.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 7: Frontend — list view, new-ticket modal, `/bug-fix` page shell

**Files:**
- Create: `src/lib/bug-backlog-dispatch.ts`
- Create: `src/components/new-ticket-modal.tsx`
- Create: `src/components/bug-fix-page.tsx`
- Create: `src/app/bug-fix/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/bug-backlog/tickets` (Task 3), `TaskBoard` (Task 6).
- Produces (used by Task 8): `dispatchAndPoll(url: string, body: unknown): Promise<string>` — shared dispatch+poll helper reused by the ticket-detail panel; `NewTicketModal({ onClose, onCreated })`; `BugFixPage` — the page will be extended in Task 8 to add the detail panel. Clicking a card does nothing yet after this task (that's Task 8) — this task only ships list + create.

- [ ] **Step 1: Shared dispatch+poll helper**

`src/lib/bug-backlog-dispatch.ts` (new file):

```ts
export async function dispatchAndPoll(url: string, body: unknown): Promise<string> {
  const createRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!createRes.ok) {
    const d = await createRes.json().catch(() => ({}));
    throw new Error(d.error || "request failed");
  }
  const { requestId } = (await createRes.json()) as { requestId: string };

  // Kanban ops are fast local CLI reads/writes, not LLM calls — 60s is
  // generous, but keep the same tolerant network-retry shape as live chat.
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const pollRes = await fetch(`/api/hermes/requests/${requestId}`);
      if (!pollRes.ok) continue;
      const { request } = (await pollRes.json()) as {
        request: { status: string; result: string | null; error: string | null };
      };
      if (request.status === "done") return request.result || "";
      if (request.status === "failed" || request.status === "rejected") {
        throw new Error(request.error || "request failed");
      }
    } catch (err) {
      if (err instanceof TypeError || err instanceof SyntaxError) continue;
      throw err;
    }
  }
  throw new Error("timed out waiting for a response");
}
```

- [ ] **Step 2: New-ticket modal**

`src/components/new-ticket-modal.tsx` (new file):

```tsx
"use client";

import { useState } from "react";
import { dispatchAndPoll } from "@/lib/bug-backlog-dispatch";

export function NewTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const t = title.trim();
    if (!t || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await dispatchAndPoll("/api/bug-backlog/tickets", { title: t, body: body.trim() });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="elevated w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="text-[14px] font-semibold text-[var(--text)]">New bug ticket</div>
          <button onClick={onClose} className="ml-auto text-[var(--text-3)] hover:text-[var(--text)] transition-colors text-xl leading-none">×</button>
        </div>
        <div className="p-4 space-y-3">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full rounded-[var(--r-md)] px-3.5 py-2 text-[13px] text-[var(--text)] focus:outline-none"
            style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
          />
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Description"
            rows={5}
            className="w-full rounded-[var(--r-md)] px-3.5 py-2 text-[13px] text-[var(--text)] focus:outline-none resize-none"
            style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
          />
          {error && <p className="text-[12px]" style={{ color: "var(--down)" }}>{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-3" style={{ borderTop: "1px solid var(--line)" }}>
          <button onClick={onClose} className="px-4 py-2 text-[13px] text-[var(--text-2)]">Cancel</button>
          <button onClick={submit} disabled={!title.trim() || submitting} className="btn-primary px-4 py-2 text-[13px]">
            {submitting ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Page shell (list + create only)**

`src/components/bug-fix-page.tsx` (new file):

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { TaskBoard, type Task } from "@/components/task-board";
import { NewTicketModal } from "@/components/new-ticket-modal";

interface BoardData {
  tasks: Task[];
  total: number;
  lastSync: string | null;
}

const EMPTY_BOARD: BoardData = { tasks: [], total: 0, lastSync: null };

export function BugFixPage() {
  const [board, setBoard] = useState<BoardData>(EMPTY_BOARD);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bug-backlog/tickets");
      const data = await res.json();
      if (data && Array.isArray(data.tasks)) setBoard(data);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="relative z-10 w-full mx-auto text-[var(--text)] p-8 pb-16 space-y-8">
      <div className="hq-rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-2.5">V-Decent Bug Backlog</div>
          <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">Bug fix</h1>
          <p className="text-[13px] text-[var(--text-3)] mt-3">File and track bugs and feature requests for V-Decent infrastructure.</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary px-4 py-2 text-[13px]">New ticket</button>
      </div>

      {showNew && (
        <NewTicketModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}

      <TaskBoard
        tasks={board.tasks}
        total={board.total}
        lastSync={board.lastSync}
        label="Bug backlog"
        title="V-Decent Bug Backlog"
        emptyTitle="No open tickets"
        emptyHint="File a bug or feature request to get started."
      />
    </div>
  );
}
```

- [ ] **Step 4: Page route**

`src/app/bug-fix/page.tsx` (new file):

```tsx
import { BugFixPage } from "@/components/bug-fix-page";

export default function Page() {
  return <BugFixPage />;
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bug-backlog-dispatch.ts src/components/new-ticket-modal.tsx src/components/bug-fix-page.tsx src/app/bug-fix/page.tsx
git commit -m "$(cat <<'EOF'
feat: add the Bug Fix board page (list + create)

/bug-fix renders the mirrored vdecent-bug-backlog board via
TaskBoard and a "New ticket" modal. Clicking a card does nothing yet
— the detail panel (view/comment/status actions) is the next task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 8: Frontend — ticket detail panel (comment, block/unblock/archive, reassign)

**Files:**
- Create: `src/components/ticket-detail-panel.tsx`
- Modify: `src/components/bug-fix-page.tsx`

**Interfaces:**
- Consumes: `POST /api/bug-backlog/tickets/:taskId/detail` (Task 5), `POST /api/bug-backlog/tickets/:taskId/action` (Task 4), `dispatchAndPoll` (Task 7), `TaskBoard`'s `onSelectTask` (Task 6).

- [ ] **Step 1: The detail panel component**

`src/components/ticket-detail-panel.tsx` (new file):

```tsx
"use client";

import { useEffect, useState } from "react";
import { dispatchAndPoll } from "@/lib/bug-backlog-dispatch";

interface Comment {
  author: string;
  body: string;
  created_at?: number;
}

interface TicketDetail {
  id: string;
  title: string;
  body: string | null;
  status: string;
  assignee: string | null;
  result: string | null;
  comments: Comment[];
}

export function TicketDetailPanel({
  taskId, onClose, onChanged,
}: {
  taskId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [reassignTo, setReassignTo] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadDetail() {
    setLoading(true);
    setError(null);
    try {
      const raw = await dispatchAndPoll(`/api/bug-backlog/tickets/${taskId}/detail`, {});
      const parsed = JSON.parse(raw) as {
        task: { id: string; title: string; body: string | null; status: string; assignee: string | null; result: string | null };
        comments?: Comment[];
      };
      setDetail({
        id: parsed.task.id,
        title: parsed.task.title,
        body: parsed.task.body,
        status: parsed.task.status,
        assignee: parsed.task.assignee,
        result: parsed.task.result,
        comments: parsed.comments ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ticket");
    }
    setLoading(false);
  }

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function runAction(action: string, fields: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await dispatchAndPoll(`/api/bug-backlog/tickets/${taskId}/action`, { action, ...fields });
      await loadDetail();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
    setBusy(false);
  }

  function submitComment() {
    const text = comment.trim();
    if (!text) return;
    setComment("");
    runAction("comment", { text });
  }

  function submitReassign() {
    const profile = reassignTo.trim();
    if (!profile) return;
    setReassignTo("");
    runAction("reassign", { profile });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="elevated w-full max-w-2xl overflow-hidden max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="text-[14px] font-semibold text-[var(--text)] truncate">{detail?.title ?? taskId}</div>
          <button onClick={onClose} className="ml-auto text-[var(--text-3)] hover:text-[var(--text)] transition-colors text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && !detail && <p className="text-[13px] text-[var(--text-3)]">Loading…</p>}
          {error && <p className="text-[12px]" style={{ color: "var(--down)" }}>{error}</p>}

          {detail && (
            <>
              <div className="flex items-center gap-3 text-[12px] text-[var(--text-3)]">
                <span>Status: {detail.status}</span>
                {detail.assignee && <span>Assignee: {detail.assignee}</span>}
              </div>

              {detail.body && (
                <p className="text-[13px] text-[var(--text-2)] leading-relaxed whitespace-pre-wrap">{detail.body}</p>
              )}

              {detail.result && (
                <div className="rounded-[var(--r-md)] p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}>
                  <div className="eyebrow mb-1.5">Result</div>
                  <p className="text-[13px] text-[var(--text-2)] whitespace-pre-wrap">{detail.result}</p>
                </div>
              )}

              <div>
                <div className="eyebrow mb-2">Comments</div>
                <div className="space-y-2.5">
                  {detail.comments.length === 0 && <p className="text-[12px] text-[var(--text-3)]">No comments yet</p>}
                  {detail.comments.map((c, i) => (
                    <div key={i} className="rounded-[var(--r-md)] p-2.5" style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}>
                      <div className="text-[11px] text-[var(--text-3)] mb-1">{c.author}</div>
                      <p className="text-[12.5px] text-[var(--text-2)] whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-3 space-y-2.5" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="flex gap-2">
            <input
              value={comment}
              onChange={e => setComment(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && submitComment()}
              placeholder="Add a comment…"
              className="flex-1 rounded-full px-4 py-2 text-[13px] text-[var(--text)] focus:outline-none"
              style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
            />
            <button onClick={submitComment} disabled={!comment.trim() || busy} className="btn-primary px-4 py-2 text-[13px]">Send</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {detail?.status !== "blocked" && (
              <button onClick={() => runAction("block")} disabled={busy}
                className="px-3 py-1.5 rounded-full text-[12px] text-[var(--text-2)]" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
                Block
              </button>
            )}
            {detail?.status === "blocked" && (
              <button onClick={() => runAction("unblock")} disabled={busy}
                className="px-3 py-1.5 rounded-full text-[12px] text-[var(--text-2)]" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
                Unblock
              </button>
            )}
            {detail?.status !== "archived" && (
              <button onClick={() => runAction("archive")} disabled={busy}
                className="px-3 py-1.5 rounded-full text-[12px] text-[var(--text-2)]" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
                Archive
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <input
                value={reassignTo}
                onChange={e => setReassignTo(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submitReassign()}
                placeholder="Reassign to profile…"
                className="w-44 rounded-full px-3 py-1.5 text-[12px] text-[var(--text)] focus:outline-none"
                style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
              />
              <button onClick={submitReassign} disabled={!reassignTo.trim() || busy}
                className="px-3 py-1.5 rounded-full text-[12px] text-[var(--text-2)]" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
                Reassign
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `bug-fix-page.tsx`**

Current top of `src/components/bug-fix-page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { TaskBoard, type Task } from "@/components/task-board";
import { NewTicketModal } from "@/components/new-ticket-modal";
```

Replace with:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { TaskBoard, type Task } from "@/components/task-board";
import { NewTicketModal } from "@/components/new-ticket-modal";
import { TicketDetailPanel } from "@/components/ticket-detail-panel";
```

Then find:

```tsx
  const [board, setBoard] = useState<BoardData>(EMPTY_BOARD);
  const [showNew, setShowNew] = useState(false);
```

Replace with:

```tsx
  const [board, setBoard] = useState<BoardData>(EMPTY_BOARD);
  const [showNew, setShowNew] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
```

Then find:

```tsx
      {showNew && (
        <NewTicketModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}

      <TaskBoard
        tasks={board.tasks}
        total={board.total}
        lastSync={board.lastSync}
        label="Bug backlog"
        title="V-Decent Bug Backlog"
        emptyTitle="No open tickets"
        emptyHint="File a bug or feature request to get started."
      />
```

Replace with:

```tsx
      {showNew && (
        <NewTicketModal
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}

      {selectedTaskId && (
        <TicketDetailPanel
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
          onChanged={load}
        />
      )}

      <TaskBoard
        tasks={board.tasks}
        total={board.total}
        lastSync={board.lastSync}
        label="Bug backlog"
        title="V-Decent Bug Backlog"
        emptyTitle="No open tickets"
        emptyHint="File a bug or feature request to get started."
        onSelectTask={(t) => setSelectedTaskId(t.id)}
      />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ticket-detail-panel.tsx src/components/bug-fix-page.tsx
git commit -m "$(cat <<'EOF'
feat: add ticket detail panel with comment and status actions

Clicking a card now opens body/status/assignee/result/comments
(fetched live via kanban.show) plus a comment box, block/unblock/
archive buttons gated to the ticket's current status, and a
free-text reassign field.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 9: Sidebar & command-palette reorganization

**Files:**
- Modify: `src/components/sidebar.tsx`
- Modify: `src/components/command-palette.tsx`

**Interfaces:** None — navigation data only.

- [ ] **Step 1: Add the `Bug` icon import to `sidebar.tsx`**

Current:

```tsx
import {
  Home,
  Radio,
  ShieldAlert,
  Lightbulb,
  ClipboardList,
  Cpu,
  BookOpen,
  GitBranch,
  Server,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
```

Replace with:

```tsx
import {
  Home,
  Radio,
  ShieldAlert,
  Lightbulb,
  ClipboardList,
  Cpu,
  BookOpen,
  Bug,
  GitBranch,
  Server,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
```

- [ ] **Step 2: Regroup `navGroups`**

Current:

```tsx
const navGroups = [
  {
    name: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: Home },
      { href: "/hermes", label: "Hermes", icon: Cpu },
      { href: "/tasks", label: "Tasks", icon: ClipboardList },
    ],
  },
  {
    name: "Data",
    items: [
      { href: "/vdecent-dev", label: "V-Decent Dev", icon: GitBranch },
      { href: "/vdecent-pro", label: "V-Decent Pro", icon: Server },
    ],
  },
  {
    name: "System",
    items: [
      { href: "/support-dev", label: "Support · Dev", icon: Radio },
      { href: "/support-pro", label: "Support · Pro", icon: ShieldAlert },
      { href: "/memory-wiki", label: "Memory Wiki", icon: BookOpen },
      { href: "/ideas", label: "Ideas", icon: Lightbulb },
    ],
  },
];
```

Replace with:

```tsx
const navGroups = [
  {
    name: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: Home },
      { href: "/vdecent-dev", label: "V-Decent Dev", icon: GitBranch },
      { href: "/vdecent-pro", label: "V-Decent Pro", icon: Server },
    ],
  },
  {
    name: "Operation",
    items: [
      { href: "/support-dev", label: "Support · Dev", icon: Radio },
      { href: "/support-pro", label: "Support · Pro", icon: ShieldAlert },
      { href: "/tasks", label: "Tasks", icon: ClipboardList },
    ],
  },
  {
    name: "System",
    items: [
      { href: "/hermes", label: "Hermes", icon: Cpu },
      { href: "/memory-wiki", label: "Memory Wiki", icon: BookOpen },
      { href: "/bug-fix", label: "Bug fix", icon: Bug },
      { href: "/ideas", label: "Ideas", icon: Lightbulb },
    ],
  },
];
```

(`mobileTabsRaw` is unchanged — out of scope, not part of the requested regroup.)

- [ ] **Step 3: Add the `Bug` icon import to `command-palette.tsx`**

Current:

```tsx
import {
  LayoutDashboard,
  GitBranch,
  Server,
  Radio,
  ShieldAlert,
  Lightbulb,
  ListChecks,
  Sparkles,
  CornerDownLeft,
  Search,
  Check,
  type LucideIcon,
} from "lucide-react";
```

Replace with:

```tsx
import {
  LayoutDashboard,
  GitBranch,
  Server,
  Radio,
  ShieldAlert,
  Lightbulb,
  ListChecks,
  Sparkles,
  Bug,
  CornerDownLeft,
  Search,
  Check,
  type LucideIcon,
} from "lucide-react";
```

- [ ] **Step 4: Reorder `NAV` and add Bug fix**

Current:

```tsx
const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "V-Decent Dev", href: "/vdecent-dev", icon: GitBranch },
  { label: "V-Decent Pro", href: "/vdecent-pro", icon: Server },
  { label: "Support · Dev", href: "/support-dev", icon: Radio },
  { label: "Support · Pro", href: "/support-pro", icon: ShieldAlert },
  { label: "Ideas", href: "/ideas", icon: Lightbulb },
  { label: "Tasks", href: "/tasks", icon: ListChecks },
  { label: "Hermes", href: "/hermes", icon: Sparkles },
];
```

Replace with:

```tsx
const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "V-Decent Dev", href: "/vdecent-dev", icon: GitBranch },
  { label: "V-Decent Pro", href: "/vdecent-pro", icon: Server },
  { label: "Support · Dev", href: "/support-dev", icon: Radio },
  { label: "Support · Pro", href: "/support-pro", icon: ShieldAlert },
  { label: "Tasks", href: "/tasks", icon: ListChecks },
  { label: "Hermes", href: "/hermes", icon: Sparkles },
  { label: "Bug fix", href: "/bug-fix", icon: Bug },
  { label: "Ideas", href: "/ideas", icon: Lightbulb },
];
```

- [ ] **Step 5: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar.tsx src/components/command-palette.tsx
git commit -m "$(cat <<'EOF'
feat: regroup sidebar/command-palette nav into Overview/Operation/System

V-Decent Dev/Pro move into Overview; Support Dev/Pro + Tasks form a
new Operation group; System becomes Hermes/Memory Wiki/Bug fix/Ideas.
No items removed, Bug fix is the only new entry.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 10: Deploy and verify live

**Files:** none (Coolify deployment + live verification only).

**Interfaces:**
- Consumes: all prior tasks' committed code, pushed to `main`.

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Trigger a deploy and wait for it to finish**

```bash
source ~/.bashrc
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/deploy?uuid=ezghadjtwn2fd9u6dlmfohcn"
```

Poll `GET https://coolify.v-decent.org/api/v1/deployments/{deployment_uuid}` until `status` is
`finished`. Retry once on the known transient DNS blip; escalate if it fails twice or for any
other reason. On success, `prisma db push --accept-data-loss` runs automatically on boot, adding
`HermesTask.body` and `AgentRequest.board`.

- [ ] **Step 3: Confirm the bridge picked up the new board**

```bash
ssh -o ConnectTimeout=10 vdecentserver0 "docker ps --filter name=hermes-bridge --format '{{.Names}}\t{{.Status}}\t{{.Networks}}'"
```

Expected: one `hermes-bridge-*` container, `Up`, network `host`. Wait ~35s (one mirror cycle),
then:

```bash
ssh -o ConnectTimeout=10 vdecentserver0 "docker exec \$(docker ps --filter name=hermy-hq-postgres -q) psql -U hermy -d hermy_hq -c \"SELECT id, title, body IS NOT NULL AS has_body FROM \\\"HermesTask\\\" WHERE board='vdecent-bug-backlog';\""
```

Expected: the one existing real ticket (`t_08483dd8`), `has_body = t`.

- [ ] **Step 4: Functional smoke test — full lifecycle on a disposable test ticket**

```bash
source ~/.bashrc
SECRET=$(curl -sS -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" | python3 -c "import json,sys; d=json.load(sys.stdin); print([e['value'] for e in d if not e.get('is_preview') and e['key']=='INTERNAL_API_SECRET'][0])")

curl -sS -X POST "https://dashboard.v-decent.org/api/bug-backlog/tickets" -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" -d '{"title":"TEST ticket — safe to archive","body":"Created by an automated verification pass. Archive after checking the lifecycle works."}' | python3 -m json.tool
```

Poll the returned `requestId` via `GET /api/hermes/requests/{id}` (5s interval, up to a couple of
minutes — kanban ops are fast, not LLM calls) until `done`. Find the new ticket's id:

```bash
ssh -o ConnectTimeout=10 vdecentserver0 "docker exec \$(docker ps --filter name=hermy-hq-postgres -q) psql -U hermy -d hermy_hq -c \"SELECT id, title, body FROM \\\"HermesTask\\\" WHERE board='vdecent-bug-backlog' AND title LIKE 'TEST ticket%' ORDER BY \\\"kanbanCreatedAt\\\" DESC LIMIT 1;\""
```

Using that `TASK_ID`, exercise comment → block → unblock → reassign → archive, each via `POST
/api/bug-backlog/tickets/$TASK_ID/action` with the matching `action`, polling each to `done`
before the next:

```bash
TASK_ID=<id from above>
curl -sS -X POST "https://dashboard.v-decent.org/api/bug-backlog/tickets/$TASK_ID/action" -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" -d '{"action":"comment","text":"Verification comment."}' | python3 -m json.tool
# poll, then:
curl -sS -X POST "https://dashboard.v-decent.org/api/bug-backlog/tickets/$TASK_ID/action" -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" -d '{"action":"block","reason":"verification"}' | python3 -m json.tool
# poll, then:
curl -sS -X POST "https://dashboard.v-decent.org/api/bug-backlog/tickets/$TASK_ID/action" -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" -d '{"action":"unblock"}' | python3 -m json.tool
# poll, then — this is the one flagged in Global Constraints as needing a live check:
curl -sS -X POST "https://dashboard.v-decent.org/api/bug-backlog/tickets/$TASK_ID/action" -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" -d '{"action":"reassign","profile":"vdecent-dev-coordinator"}' | python3 -m json.tool
```

Expected for reassign: `done` with no error, confirming `--reclaim` is safe on a non-running
ticket. **If this fails**, note it — Task 4's route unconditionally passes `--reclaim`, and a
fix (only pass it when the ticket's current status is `running`) would be a small follow-up, not
a blocker to finishing this task.

Then verify the full detail view assembles correctly:

```bash
curl -sS -X POST "https://dashboard.v-decent.org/api/bug-backlog/tickets/$TASK_ID/detail" -H "x-internal-secret: $SECRET" | python3 -m json.tool
```

Poll, then fetch the result and confirm it parses as JSON with `task.body` matching what was
created, `comments` containing the verification comment with `body` (not `text`) holding its
text, and `task.status` reflecting the unblock.

Finally, clean up:

```bash
curl -sS -X POST "https://dashboard.v-decent.org/api/bug-backlog/tickets/$TASK_ID/action" -H "x-internal-secret: $SECRET" -H "Content-Type: application/json" -d '{"action":"archive"}' | python3 -m json.tool
```

- [ ] **Step 5: Regression check — other boards still mirror correctly**

```bash
ssh -o ConnectTimeout=10 vdecentserver0 "docker exec \$(docker ps --filter name=hermy-hq-postgres -q) psql -U hermy -d hermy_hq -c \"SELECT board, count(*) FROM \\\"HermesTask\\\" GROUP BY board;\""
```

Expected: rows for `default`, `vdecent-support-dev`, `vdecent-support-prod`, and
`vdecent-bug-backlog`, all with plausible counts (the bridge changes in Task 2 touch shared code
— confirm nothing broke for the three pre-existing boards).

- [ ] **Step 6: Ask the user to visually confirm in the browser**

Report to the user: deployed and live. Ask them to check the sidebar's new Overview/Operation/
System grouping (and the command palette, ⌘K), then open `/bug-fix`: confirm the real existing
ticket shows up with its description, click it to open the detail panel and see its two real
comments, and try filing a small test ticket end-to-end from the browser (create → see it appear
→ open it → comment → archive it) — since this environment has no browser to verify the
rendered UI directly.
