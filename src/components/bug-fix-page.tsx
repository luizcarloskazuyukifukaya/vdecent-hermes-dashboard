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
