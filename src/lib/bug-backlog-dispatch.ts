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
