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
