import type { HealthCounts, Section } from "@/lib/vdecent";

async function fetchJson(url: string, headers: Record<string, string> = {}, timeoutMs = 8000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function emptySection(state: "not_configured" | "unreachable", url: string | null, error: string | null): Section<never> {
  return { state, counts: null, items: [], url, error };
}

export async function fetchCloudflareTunnels(): Promise<Section<never>> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const url = "https://dash.cloudflare.com/" + (accountId ?? "") + "/networks/tunnels";
  if (!token || !accountId) return emptySection("not_configured", null, null);

  try {
    const data = await fetchJson(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel?is_deleted=false`,
      { Authorization: `Bearer ${token}` }
    ) as { result?: Array<{ status?: string }> };
    const items = data.result ?? [];
    const counts: HealthCounts = { healthy: 0, pending: 0, atRisk: 0, total: items.length };
    for (const t of items) {
      if (t.status === "healthy") counts.healthy += 1;
      else if (t.status === "inactive") counts.pending += 1;
      else counts.atRisk += 1;
    }
    return { state: "ok", counts, items: [], url, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return emptySection("unreachable", url, message);
  }
}

export async function fetchCoolifyServers(): Promise<Section<never>> {
  const token = process.env.COOLIFY_API_TOKEN;
  const url = "https://coolify.v-decent.org";
  if (!token) return emptySection("not_configured", null, null);

  try {
    const data = await fetchJson(
      "https://coolify.v-decent.org/api/v1/servers",
      { Authorization: `Bearer ${token}` }
    ) as Array<{ is_reachable?: boolean; is_usable?: boolean }>;
    const items = Array.isArray(data) ? data : [];
    const counts: HealthCounts = { healthy: 0, pending: 0, atRisk: 0, total: items.length };
    for (const s of items) {
      if (s.is_reachable && s.is_usable) counts.healthy += 1;
      else if (s.is_reachable) counts.pending += 1;
      else counts.atRisk += 1;
    }
    return { state: "ok", counts, items: [], url, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return emptySection("unreachable", url, message);
  }
}

export async function fetchCoolifyApps(): Promise<Section<never>> {
  const token = process.env.COOLIFY_API_TOKEN;
  const url = "https://coolify.v-decent.org";
  if (!token) return emptySection("not_configured", null, null);

  try {
    const data = await fetchJson(
      "https://coolify.v-decent.org/api/v1/applications",
      { Authorization: `Bearer ${token}` }
    ) as Array<{ status?: string }>;
    const items = Array.isArray(data) ? data : [];
    const counts: HealthCounts = { healthy: 0, pending: 0, atRisk: 0, total: items.length };
    for (const a of items) {
      const status = a.status ?? "";
      if (status.startsWith("running:healthy")) counts.healthy += 1;
      else if (status.startsWith("running:")) counts.pending += 1;
      else counts.atRisk += 1;
    }
    return { state: "ok", counts, items: [], url, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return emptySection("unreachable", url, message);
  }
}
