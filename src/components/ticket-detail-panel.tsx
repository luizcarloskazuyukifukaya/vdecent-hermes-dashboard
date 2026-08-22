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
