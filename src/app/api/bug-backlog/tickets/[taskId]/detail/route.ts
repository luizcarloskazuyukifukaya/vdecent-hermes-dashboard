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
