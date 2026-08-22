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
