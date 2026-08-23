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
