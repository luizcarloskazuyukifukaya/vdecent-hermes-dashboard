# V-Decent Infrastructure Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact "V-Decent Infrastructure" card to the home dashboard showing live Coolify (servers, applications) and Cloudflare (Tunnels) status — the first real data either system has anywhere in this dashboard.

**Architecture:** Three new server-side fetch helpers in a new `lib/vdecent-infra.ts`, reusing the exact `HealthCounts`/`Section<T>` pattern already established by `lib/vdecent.ts` for App Manager/Node Manager (same field names, same three-bucket shape) rather than inventing a parallel type. A new `GET /api/vdecent/infra` route aggregates all three. A new card component renders them on the home dashboard using the existing `Pill` component. Credentials (`COOLIFY_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) are wired into `docker-compose.yaml` for the first time and set on the live Coolify app.

**Tech Stack:** Next.js 16 (App Router, TypeScript, client components), existing `@/components/ui/kit` design system.

## Global Constraints

- No test framework exists in this repo — verification is `npx tsc`, plus a final live check against the deployed app.
- **Deviation from the design spec's literal field names**: the spec drafted a new `InfraCounts = {healthy, warn, down, total}` type. This plan instead reuses the existing `HealthCounts = {healthy, pending, atRisk, total}` type from `lib/vdecent.ts` unchanged — same three-bucket concept (good/pending-or-unclear/at-risk), just matching the field names already established codebase-wide instead of introducing a second type that means the same thing. Flagged here so a reviewer doesn't read this as a missed requirement — it's a deliberate consistency improvement, not a scope change.
- `state: "not_configured"` when the relevant env var(s) are unset; `"unreachable"` on fetch error/timeout/non-2xx; `"ok"` otherwise — matching `fetchAppManagerSection`/`fetchNodeManagerSection` exactly (same 8s timeout, no retries, no caching).
- Credential VALUES are never committed to the repo, never printed in any report/log, and only ever read from `~/.bashrc` on the operator's host at deploy time — same handling discipline as every credential-touching task earlier today.
- Design spec: `docs/superpowers/specs/2026-08-23-vdecent-infra-overview-design.md`.

---

### Task 1: Fetch helpers — `src/lib/vdecent-infra.ts`

**Files:**
- Create: `src/lib/vdecent-infra.ts`

**Interfaces:**
- Produces (used by Task 2): `fetchCloudflareTunnels(): Promise<Section<never>>`, `fetchCoolifyServers(): Promise<Section<never>>`, `fetchCoolifyApps(): Promise<Section<never>>` — each returning `Section<never>` (imported from `@/lib/vdecent`; `items` is always `[]` since this feature is counts-only, `never` documents that nothing should ever push an item into it).

- [ ] **Step 1: Write the module**

```ts
import { fetchAppManagerSection as _unused } from "@/lib/vdecent"; // remove — see Step 1 note below
```

(Ignore the line above — it's a placeholder reminder, not real code. Write the actual file as follows.)

`src/lib/vdecent-infra.ts` (new file):

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/vdecent-infra.ts
git commit -m "$(cat <<'EOF'
feat: add Coolify + Cloudflare fetch helpers

Reuses lib/vdecent.ts's existing HealthCounts/Section<T> pattern
(not a new type) for the same three-bucket health shape App
Manager/Node Manager already use. Same not_configured/unreachable
state handling, same 8s timeout, no caching.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 2: API route — `GET /api/vdecent/infra`

**Files:**
- Create: `src/app/api/vdecent/infra/route.ts`

**Interfaces:**
- Consumes: `fetchCloudflareTunnels`, `fetchCoolifyServers`, `fetchCoolifyApps` (Task 1).
- Produces (used by Task 3): `GET /api/vdecent/infra` → `{ tunnels: HealthCounts|null, tunnelsState: SectionState, coolifyApps: HealthCounts|null, coolifyAppsState: SectionState, coolifyServers: HealthCounts|null, coolifyServersState: SectionState, urls: { tunnels: string|null, coolify: string|null } }`.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { fetchCloudflareTunnels, fetchCoolifyApps, fetchCoolifyServers } from "@/lib/vdecent-infra";

export const dynamic = "force-dynamic";

export async function GET() {
  const [tunnels, coolifyApps, coolifyServers] = await Promise.all([
    fetchCloudflareTunnels(),
    fetchCoolifyApps(),
    fetchCoolifyServers(),
  ]);

  return NextResponse.json({
    tunnels: tunnels.counts,
    tunnelsState: tunnels.state,
    coolifyApps: coolifyApps.counts,
    coolifyAppsState: coolifyApps.state,
    coolifyServers: coolifyServers.counts,
    coolifyServersState: coolifyServers.state,
    urls: { tunnels: tunnels.url, coolify: coolifyApps.url },
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/vdecent/infra/route.ts
git commit -m "$(cat <<'EOF'
feat: add GET /api/vdecent/infra route

Aggregates Cloudflare Tunnel + Coolify server/app health counts.
Kept separate from /api/vdecent/overview — this data is account-wide
(one Coolify instance, one Cloudflare account for both
environments), not dev/prod-keyed like that route's shape.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 3: Card component + homepage wiring

**Files:**
- Create: `src/components/vdecent-infra-card.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `GET /api/vdecent/infra` (Task 2), `Pill`/`Panel`/`Skeleton` from `@/components/ui/kit`.

- [ ] **Step 1: Write the card**

`src/components/vdecent-infra-card.tsx` (new file):

```tsx
"use client";

import { useEffect, useState } from "react";
import { Panel, Pill, Skeleton } from "@/components/ui/kit";
import type { HealthCounts, SectionState } from "@/lib/vdecent";

interface InfraData {
  tunnels: HealthCounts | null;
  tunnelsState: SectionState;
  coolifyApps: HealthCounts | null;
  coolifyAppsState: SectionState;
  coolifyServers: HealthCounts | null;
  coolifyServersState: SectionState;
  urls: { tunnels: string | null; coolify: string | null };
}

const EMPTY: InfraData = {
  tunnels: null, tunnelsState: "not_configured",
  coolifyApps: null, coolifyAppsState: "not_configured",
  coolifyServers: null, coolifyServersState: "not_configured",
  urls: { tunnels: null, coolify: null },
};

function CountsRow({ label, counts, state, href }: {
  label: string;
  counts: HealthCounts | null;
  state: SectionState;
  href: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[13px] text-[var(--text-2)]">{label}</span>
      {state === "not_configured" ? (
        <span className="text-[12px] text-[var(--text-3)]">Not configured</span>
      ) : state === "unreachable" || !counts ? (
        <span className="text-[12px]" style={{ color: "var(--down)" }}>Unreachable</span>
      ) : (
        <div className="flex items-center gap-2">
          {counts.healthy > 0 && <Pill tone="up">{counts.healthy}</Pill>}
          {counts.pending > 0 && <Pill tone="warn">{counts.pending}</Pill>}
          {counts.atRisk > 0 && <Pill tone="down">{counts.atRisk}</Pill>}
          {href && (
            <a href={href} target="_blank" rel="noreferrer" className="text-[11px] text-[var(--accent)] hover:underline ml-1">
              Open ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function VDecentInfraCard() {
  const [data, setData] = useState<InfraData>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/vdecent/infra")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(d as InfraData);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <Panel className="p-6 mt-4">
      <p className="eyebrow mb-4">V-Decent Infrastructure</p>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 rounded-[var(--r-md)]" />
          <Skeleton className="h-8 rounded-[var(--r-md)]" />
          <Skeleton className="h-8 rounded-[var(--r-md)]" />
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: "var(--line)" }}>
          <CountsRow label="Cloudflare Tunnels" counts={data.tunnels} state={data.tunnelsState} href={data.urls.tunnels} />
          <CountsRow label="Coolify Apps" counts={data.coolifyApps} state={data.coolifyAppsState} href={data.urls.coolify} />
          <CountsRow label="Coolify Servers" counts={data.coolifyServers} state={data.coolifyServersState} href={data.urls.coolify} />
        </div>
      )}
    </Panel>
  );
}
```

- [ ] **Step 2: Render it on the home dashboard**

Current `src/app/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { VDecentOverviewCard } from "@/components/vdecent-overview-card";
```

Replace with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { VDecentOverviewCard } from "@/components/vdecent-overview-card";
import { VDecentInfraCard } from "@/components/vdecent-infra-card";
```

Then find:

```tsx
      <VDecentOverviewCard />
    </div>
  );
}
```

Replace with:

```tsx
      <VDecentOverviewCard />
      <VDecentInfraCard />
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/vdecent-infra-card.tsx src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat: show V-Decent Infrastructure card on the home dashboard

Cloudflare Tunnels + Coolify Apps/Servers health counts, rendered
below the existing V-Decent Operations card. Same Pill-based compact
style, one row per section, "not configured"/"unreachable" states
handled the same way as every other V-Decent status section.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 4: Wire credentials into `docker-compose.yaml` and `.env.example`

**Files:**
- Modify: `docker-compose.yaml`
- Modify: `.env.example`

**Interfaces:** None — configuration only.

- [ ] **Step 1: Add the three env vars to `hermy-hq`**

Current (`docker-compose.yaml`, inside `hermy-hq`'s `environment:` block):

```yaml
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - OPENAI_BASE_URL=${OPENAI_BASE_URL:-}
```

Replace with:

```yaml
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - OPENAI_BASE_URL=${OPENAI_BASE_URL:-}
      - COOLIFY_API_TOKEN=${COOLIFY_API_TOKEN:-}
      - CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN:-}
      - CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID:-}
```

- [ ] **Step 2: Validate the compose file**

Run: `docker compose config --quiet`
Expected: no output, exit 0 (empty `POSTGRES_PASSWORD` etc. locally is fine — this only validates YAML/interpolation syntax, not that values are set).

- [ ] **Step 3: Document the new optional vars**

Current (`.env.example`):

```
NM_PROD_API_TOKEN="your-node-manager-prod-token"
NM_PROD_URL="https://nm.example.org"
```

Replace with:

```
NM_PROD_API_TOKEN="your-node-manager-prod-token"
NM_PROD_URL="https://nm.example.org"

# ─── OPTIONAL · V-Decent Infrastructure (Coolify / Cloudflare) ───
# Only needed for the homepage's V-Decent Infrastructure card. Leave
# blank to show that section as "not configured" instead of erroring.

COOLIFY_API_TOKEN="your-coolify-api-token"
CLOUDFLARE_API_TOKEN="your-cloudflare-api-token"
CLOUDFLARE_ACCOUNT_ID="your-cloudflare-account-id"
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yaml .env.example
git commit -m "$(cat <<'EOF'
feat: wire COOLIFY_API_TOKEN and CLOUDFLARE_* into hermy-hq

Neither was available to the app's own backend before — both tokens
existed only in the operator's shell, used for manual/agent curl
calls. This is what the V-Decent Infrastructure card (Task 3) reads
at runtime. Real values are set on the Coolify app directly (Task
5), never committed here.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 5: Set real credential values, deploy, and verify live

**Files:** none (Coolify env-var + deployment API calls, plus live verification).

**Interfaces:**
- Consumes: all prior tasks' committed code, pushed to `main`.

**CRITICAL SAFETY RULE:** this task reads real credential values from `~/.bashrc` on the operator's host. Never print, log, echo, or include any of these values (Coolify token, Cloudflare token, Cloudflare account id) in any command output, tool report, or commit — only their presence/success should ever be reported. The two known-working values were already verified during design (Coolify: the token `source ~/.bashrc` already exports as `$COOLIFY_API_TOKEN`, used successfully throughout today's work; Cloudflare: NOT the line in `~/.bashrc` that plain `source` exports — that one is invalid. Use the token on the specific line starting with `#export CLOUDFLARE_API_TOKEN="cfut_` — extract it with `sed -n '176p' ~/.bashrc | sed -E 's/^#export CLOUDFLARE_API_TOKEN="([^"]+)"/\1/'`, adjusting the line number if the file has changed; verify whichever line you use actually starts with `cfut_`, not `cfat_`, before trusting it — the `cfat_`-prefixed one that's actively exported is confirmed invalid.  `CLOUDFLARE_ACCOUNT_ID` is actively exported and valid as-is via plain `source ~/.bashrc`.

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Set the three env vars on the live Coolify app**

For each of the three (`COOLIFY_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), first verify it doesn't already exist on the app (skip creation if it does — don't create a duplicate):

```bash
source ~/.bashrc
curl -sS -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" | python3 -c "
import json, sys
d = json.load(sys.stdin)
present = sorted(set(e['key'] for e in d))
for k in ['COOLIFY_API_TOKEN','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID']:
    print(k, 'ALREADY SET' if k in present else 'missing')
"
```

For each one reported `missing`, create it (values sourced as described in the safety rule above — never printed):

```bash
# Coolify token (value already in $COOLIFY_API_TOKEN from `source ~/.bashrc`)
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" -H "Content-Type: application/json" \
  "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" \
  -d "$(python3 -c "import json,os; print(json.dumps({'key':'COOLIFY_API_TOKEN','value':os.environ['COOLIFY_API_TOKEN'],'is_preview':False}))")"

# Cloudflare account id (already exported correctly)
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" -H "Content-Type: application/json" \
  "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" \
  -d "$(python3 -c "import json,os; print(json.dumps({'key':'CLOUDFLARE_ACCOUNT_ID','value':os.environ['CLOUDFLARE_ACCOUNT_ID'],'is_preview':False}))")"

# Cloudflare API token — extract the WORKING one (cfut_ prefix), not the actively-exported invalid one
CF_TOKEN=$(sed -n '176p' ~/.bashrc | sed -E 's/^#export CLOUDFLARE_API_TOKEN="([^"]+)"/\1/')
echo "extracted token starts with: ${CF_TOKEN:0:5}"  # sanity check only — must print "cfut_", never the full value
curl -sS -H "Authorization: Bearer $CF_TOKEN" "https://api.cloudflare.com/client/v4/user/tokens/verify" | python3 -c "import json,sys; print('valid' if json.load(sys.stdin).get('success') else 'INVALID — STOP, do not use this token')"
# Only proceed if the line above printed "valid":
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" -H "Content-Type: application/json" \
  "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" \
  -d "$(CF_TOKEN="$CF_TOKEN" python3 -c "import json,os; print(json.dumps({'key':'CLOUDFLARE_API_TOKEN','value':os.environ['CF_TOKEN'],'is_preview':False}))")"
```

Note: Coolify's env-creation endpoint creates both a runtime and a preview copy from one call (observed during design) — this is expected, not a bug; no extra action needed.

- [ ] **Step 3: Trigger a deploy and wait for it to finish**

Setting env vars alone does not affect the already-running container — `docker-compose.yaml`'s `${VAR}` interpolation only resolves at deploy time, so a fresh deploy is required to actually apply them.

```bash
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/deploy?uuid=ezghadjtwn2fd9u6dlmfohcn"
```

Poll `GET https://coolify.v-decent.org/api/v1/deployments/{deployment_uuid}` yourself, in a loop (check, sleep ~10-15s, check again — there is no external notification to wait for), until `status` is `finished`. Retry once on the known transient DNS blip; escalate if it fails twice or for any other reason.

- [ ] **Step 4: Verify the new endpoint returns real data**

```bash
SECRET=$(curl -sS -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" | python3 -c "import json,sys; d=json.load(sys.stdin); print([e['value'] for e in d if not e.get('is_preview') and e['key']=='INTERNAL_API_SECRET'][0])")
curl -sS "https://dashboard.v-decent.org/api/vdecent/infra" -H "x-internal-secret: $SECRET" | python3 -m json.tool
```

Expected: `tunnelsState`, `coolifyAppsState`, `coolifyServersState` are all `"ok"` (not `"not_configured"` — that would mean the env vars didn't take effect — and not `"unreachable"` — that would mean a real connectivity/auth problem). Counts should be non-zero and roughly match what was observed live during design (~20 tunnels, ~16 apps, ~8 servers, exact numbers may have drifted since then — that's expected, not a bug).

- [ ] **Step 5: Ask the user to visually confirm in the browser**

Report to the user: deployed and live. Ask them to open the home dashboard and confirm the new "V-Decent Infrastructure" card appears below "V-Decent Operations," showing real pill counts for Cloudflare Tunnels, Coolify Apps, and Coolify Servers (not "Not configured") — since this environment has no browser to verify the rendered UI directly.
