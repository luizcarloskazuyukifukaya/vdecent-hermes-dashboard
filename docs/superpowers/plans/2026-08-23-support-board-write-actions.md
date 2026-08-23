# Support Board Write Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human view why a task is blocked on the `/support-dev`/`/support-pro` Board view and act on it directly — Comment, Unblock, Mark Done — instead of it being purely read-only.

**Architecture:** Two new Next.js API routes, parameterized by `env` (`dev`/`pro`) instead of a single hardcoded board, mirror the existing Bug Fix board's `detail`/`action` route pattern exactly (same `kanban.show`/`kanban.<action>` `AgentRequest` dispatch, same `hermes-bridge` handling — no bridge-side changes needed, it's already board-agnostic). A new trimmed detail-panel component (Comment/Unblock/Mark Done only — no Block/Archive/Reassign) is wired into `TaskBoard`'s existing (currently unused) `onSelectTask` prop.

**Tech Stack:** Next.js 16 (App Router, TypeScript, client components), existing `@/components/ui/kit` design system, `dispatchAndPoll` from `@/lib/bug-backlog-dispatch` (already generic, reused as-is).

## Global Constraints

- No test framework exists in this repo — verification is `npx tsc`, plus a final live check against the deployed app.
- Action set is exactly `comment`, `unblock`, `complete` — no `block`, `archive`, `reassign` (operator decision; those remain agent-only on this board).
- Board mapping: `dev` → `"vdecent-support-dev"`, `pro` → `"vdecent-support-prod"` — note the env code is `pro` but the board slug is `vdecent-support-prod` (not `-pro`), matching `hermes-bridge/bridge.mjs`'s `KANBAN_BOARDS` list and `support-team-page.tsx`'s existing `vdecent-support-{env === "dev" ? "dev" : "prod"}` string.
- No proactive human notification (Telegram/gateway) — out of scope, deferred.
- Design spec: `docs/superpowers/specs/2026-08-23-support-board-write-actions-design.md`.

---

### Task 1: Detail route (`src/app/api/support-team/[env]/tasks/[taskId]/detail/route.ts`)

**Files:**
- Create: `src/app/api/support-team/[env]/tasks/[taskId]/detail/route.ts`

**Interfaces:**
- Produces (used by Task 3): `POST /api/support-team/{env}/tasks/{taskId}/detail` → `{requestId}` (an `AgentRequest` of `kind: "kanban.show"`; poll it via the existing `GET /api/hermes/requests/[id]` to get `result` — a JSON string of `{task: {id, title, body, status, assignee, result}, comments: [{author, body}]}`, matching the Bug Fix detail route's exact result shape).

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const BOARD: Record<"dev" | "pro", string> = { dev: "vdecent-support-dev", pro: "vdecent-support-prod" };

function isVDecentEnv(value: string): value is "dev" | "pro" {
  return value === "dev" || value === "pro";
}

export async function POST(_req: Request, { params }: { params: Promise<{ env: string; taskId: string }> }) {
  const { env, taskId } = await params;
  if (!isVDecentEnv(env)) {
    return NextResponse.json({ error: "invalid environment" }, { status: 400 });
  }

  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind: "kanban.show",
      title: `Show ${taskId}`,
      prompt: JSON.stringify({ taskId }),
      board: BOARD[env],
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
git add src/app/api/support-team/[env]/tasks/[taskId]/detail/route.ts
git commit -m "$(cat <<'EOF'
feat: add detail route for Support board tasks

Mirrors the Bug Fix board's kanban.show dispatch pattern, but
resolves the board from env (dev -> vdecent-support-dev, pro ->
vdecent-support-prod) instead of a single hardcoded board.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 2: Action route (`src/app/api/support-team/[env]/tasks/[taskId]/action/route.ts`)

**Files:**
- Create: `src/app/api/support-team/[env]/tasks/[taskId]/action/route.ts`

**Interfaces:**
- Produces (used by Task 3): `POST /api/support-team/{env}/tasks/{taskId}/action` with body `{action: "comment"|"unblock"|"complete", text?, reason?, result?}` → `{requestId}`.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const BOARD: Record<"dev" | "pro", string> = { dev: "vdecent-support-dev", pro: "vdecent-support-prod" };
const ACTIONS = new Set(["comment", "unblock", "complete"]);

function isVDecentEnv(value: string): value is "dev" | "pro" {
  return value === "dev" || value === "pro";
}

export async function POST(req: Request, { params }: { params: Promise<{ env: string; taskId: string }> }) {
  const { env, taskId } = await params;
  if (!isVDecentEnv(env)) {
    return NextResponse.json({ error: "invalid environment" }, { status: 400 });
  }

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
  } else if (action === "unblock") {
    const reason = (b.reason || "").toString().trim();
    if (reason) payload.reason = reason;
    title = `Unblock ${taskId}`;
  } else if (action === "complete") {
    const result = (b.result || "").toString().trim();
    if (result) payload.result = result;
    title = `Complete ${taskId}`;
  }

  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind: `kanban.${action}`,
      title: title.slice(0, 200),
      prompt: JSON.stringify(payload),
      board: BOARD[env],
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
git add src/app/api/support-team/[env]/tasks/[taskId]/action/route.ts
git commit -m "$(cat <<'EOF'
feat: add scoped action route for Support board tasks

comment/unblock/complete only - no block/archive/reassign, which
stay agent-only decisions on this board per operator decision.
Mirrors the Bug Fix board's dispatch pattern, board resolved from
env instead of hardcoded.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 3: Detail panel component (`src/components/support-task-detail-panel.tsx`)

**Files:**
- Create: `src/components/support-task-detail-panel.tsx`

**Interfaces:**
- Consumes: `POST /api/support-team/{env}/tasks/{taskId}/detail` and `.../action` (Tasks 1-2), `dispatchAndPoll` from `@/lib/bug-backlog-dispatch` (existing, generic).
- Produces (used by Task 4): `SupportTaskDetailPanel({taskId, env, onClose, onChanged}: {taskId: string; env: "dev" | "pro"; onClose: () => void; onChanged: () => void})`.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { dispatchAndPoll } from "@/lib/bug-backlog-dispatch";

interface Comment {
  author: string;
  body: string;
  created_at?: number;
}

interface TaskDetail {
  id: string;
  title: string;
  body: string | null;
  status: string;
  assignee: string | null;
  result: string | null;
  comments: Comment[];
}

export function SupportTaskDetailPanel({
  taskId, env, onClose, onChanged,
}: {
  taskId: string;
  env: "dev" | "pro";
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [doneResult, setDoneResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadDetail() {
    setLoading(true);
    setError(null);
    try {
      const raw = await dispatchAndPoll(`/api/support-team/${env}/tasks/${taskId}/detail`, {});
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
      setError(err instanceof Error ? err.message : "Failed to load task");
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
      await dispatchAndPoll(`/api/support-team/${env}/tasks/${taskId}/action`, { action, ...fields });
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

  function submitComplete() {
    const result = doneResult.trim();
    setDoneResult("");
    runAction("complete", result ? { result } : {});
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
            {detail?.status === "blocked" && (
              <button onClick={() => runAction("unblock")} disabled={busy}
                className="px-3 py-1.5 rounded-full text-[12px] text-[var(--text-2)]" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
                Unblock
              </button>
            )}
            {detail?.status !== "done" && (
              <div className="flex gap-2 ml-auto">
                <input
                  value={doneResult}
                  onChange={e => setDoneResult(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && submitComplete()}
                  placeholder="Resolution summary (optional)…"
                  className="w-56 rounded-full px-3 py-1.5 text-[12px] text-[var(--text)] focus:outline-none"
                  style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}
                />
                <button onClick={submitComplete} disabled={busy}
                  className="px-3 py-1.5 text-[12px] rounded-full font-medium"
                  style={{ color: "var(--up)", background: "color-mix(in srgb, var(--up) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--up) 30%, transparent)" }}>
                  Mark Done
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/support-task-detail-panel.tsx
git commit -m "$(cat <<'EOF'
feat: add SupportTaskDetailPanel (Comment/Unblock/Mark Done)

Trimmed adaptation of TicketDetailPanel for the Support boards -
same modal shell and dispatch pattern, narrower action set (no
Block/Archive/Reassign, which stay agent-only on this board).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 4: Wire into `support-team-page.tsx`'s Board view

**Files:**
- Modify: `src/components/support-team-page.tsx`

**Interfaces:**
- Consumes: `SupportTaskDetailPanel` (Task 3), `TaskBoard`'s existing `onSelectTask` prop (already present, unused until now).

- [ ] **Step 1: Add the import and selection state**

Current top of file:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import SupportOfficeView from "@/components/SupportOfficeView";
import { AgentCard, type Agent } from "@/components/agent-card";
import { AgentChat } from "@/components/agent-chat";
import { TaskBoard, type Task } from "@/components/task-board";
import { useAgentChats } from "@/lib/use-agent-chats";
```

Replace with:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import SupportOfficeView from "@/components/SupportOfficeView";
import { AgentCard, type Agent } from "@/components/agent-card";
import { AgentChat } from "@/components/agent-chat";
import { TaskBoard, type Task } from "@/components/task-board";
import { SupportTaskDetailPanel } from "@/components/support-task-detail-panel";
import { useAgentChats } from "@/lib/use-agent-chats";
```

Current state declarations:

```tsx
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const { getThread, sendMessage } = useAgentChats(env);
```

Replace with:

```tsx
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const { getThread, sendMessage } = useAgentChats(env);
```

- [ ] **Step 2: Wire `onSelectTask` and render the panel**

Current Board View block:

```tsx
      {/* Board View */}
      {view === "board" && (
        <TaskBoard
          tasks={board.tasks}
          total={board.total}
          lastSync={board.lastSync}
          label="Issue board"
          title={`${title} incidents`}
          emptyTitle="No open incidents"
          emptyHint="Incidents mirrored from this environment's support board will show up here."
        />
      )}
      </div>
    </>
  );
}
```

Replace with:

```tsx
      {/* Board View */}
      {view === "board" && (
        <TaskBoard
          tasks={board.tasks}
          total={board.total}
          lastSync={board.lastSync}
          label="Issue board"
          title={`${title} incidents`}
          emptyTitle="No open incidents"
          emptyHint="Incidents mirrored from this environment's support board will show up here."
          onSelectTask={setSelectedTask}
        />
      )}
      {selectedTask && (
        <SupportTaskDetailPanel
          taskId={selectedTask.id}
          env={env}
          onClose={() => setSelectedTask(null)}
          onChanged={loadBoard}
        />
      )}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/support-team-page.tsx
git commit -m "$(cat <<'EOF'
feat: open SupportTaskDetailPanel on Support board card click

Wires TaskBoard's existing onSelectTask prop, unused until now, to
open the new detail/action panel. onChanged re-runs loadBoard() so
the board reflects the action immediately.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 5: Deploy and verify live

**Files:** none (deploy + verification only).

**Interfaces:**
- Consumes: all prior tasks' committed code, pushed to `main`.

No new credentials needed — this reuses the existing `AgentRequest`/`hermes-bridge` dispatch pipeline already live since earlier this session.

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Trigger a deploy and wait for it to finish**

```bash
source ~/.bashrc
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/deploy?uuid=ezghadjtwn2fd9u6dlmfohcn"
```

Poll `GET https://coolify.v-decent.org/api/v1/deployments/{deployment_uuid}` yourself (no external notification — check, sleep ~10-15s, check again) until `status` is `finished`. Retry once on a transient DNS blip; escalate if it fails twice or any other way.

- [ ] **Step 3: Verify the new routes live**

Fetch the `INTERNAL_API_SECRET` the same way as prior deploy tasks this session, then exercise the detail route against a real currently-blocked task (e.g. `t_c9ad19a3`-style ID — look up a current blocked task id from `GET /api/support-team/dev/tasks` first since specific IDs drift over time):

```bash
source ~/.bashrc
SECRET=$(curl -sS -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" | python3 -c "import json,sys; d=json.load(sys.stdin); print([e['value'] for e in d if not e.get('is_preview') and e['key']=='INTERNAL_API_SECRET'][0])")

TASK_ID=$(curl -sS "https://dashboard.v-decent.org/api/support-team/dev/tasks" -H "x-internal-secret: $SECRET" | python3 -c "
import json,sys
d = json.load(sys.stdin)
tasks = d.get('tasks', [])
blocked = [t for t in tasks if str(t.get('status','')).lower() == 'blocked']
print(blocked[0]['id'] if blocked else '')
")
echo "testing against: $TASK_ID"

RESP=$(curl -sS -X POST "https://dashboard.v-decent.org/api/support-team/dev/tasks/$TASK_ID/detail" -H "x-internal-secret: $SECRET")
echo "$RESP"
REQ_ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['requestId'])")

for i in $(seq 1 15); do
  STATUS=$(curl -sS "https://dashboard.v-decent.org/api/hermes/requests/$REQ_ID" -H "x-internal-secret: $SECRET" | python3 -c "import json,sys; print(json.load(sys.stdin)['request']['status'])")
  echo "poll $i: $STATUS"
  [ "$STATUS" = "done" ] || [ "$STATUS" = "failed" ] && break
  sleep 5
done
curl -sS "https://dashboard.v-decent.org/api/hermes/requests/$REQ_ID" -H "x-internal-secret: $SECRET" | python3 -m json.tool
```

Expected: the request completes `done`, with `result` containing a JSON string with `task`/`comments` — confirming the detail route successfully dispatches a real `kanban.show` against `vdecent-support-dev` for a real blocked task. Do NOT exercise the `action` route's `unblock`/`complete` actions against a real task during this verification step — those are side-effecting on live operational data; read-only `detail` is sufficient to confirm the deploy took effect.

- [ ] **Step 4: Ask the user to visually confirm in the browser**

Report to the user: deployed and live. Ask them to open `/support-dev`, switch to Board view, click a card, and confirm the detail panel opens showing status/body/comments with Comment (always) and, if the task is blocked, an Unblock button, and if not done, a Mark Done control — since this environment has no browser to verify the rendered UI directly. Suggest they try it on the actual `t_e5e364f8`-style orphaned task if one is still present, to close the real case that motivated this feature.
