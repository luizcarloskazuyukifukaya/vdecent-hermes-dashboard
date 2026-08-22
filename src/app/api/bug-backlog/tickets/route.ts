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
