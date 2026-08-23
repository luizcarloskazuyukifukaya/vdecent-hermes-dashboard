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
