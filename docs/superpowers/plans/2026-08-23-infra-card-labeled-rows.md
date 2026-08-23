# Infra Card Labeled Rows + Per-Environment Apps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the V-Decent Infrastructure card's unlabeled health pills with labeled rows, and split "Coolify Apps" into separate Development/Production rows, each linking to its own Coolify environment page.

**Architecture:** Two new small fetchers in `src/lib/vdecent-infra.ts` hit Coolify's per-environment API for the dev/prod app counts (replacing the old account-wide `fetchCoolifyApps`); the existing Tunnels/Servers fetch logic is untouched except a URL constant change. The route reshapes its JSON to carry two app-count fields instead of one. The card component is rewritten to render labeled sub-rows per section instead of unlabeled `Pill`s.

**Tech Stack:** Next.js 16 (App Router, TypeScript, client components), existing `@/components/ui/kit` design system.

## Global Constraints

- No test framework exists in this repo — verification is `npx tsc`, plus a final live check against the deployed app.
- Do not modify `fetchCloudflareTunnels()`'s internals or `fetchCoolifyServers()`'s bucketing logic — both were just hardened through a full review cycle. Only `fetchCoolifyServers()`'s `url` constant changes.
- Every row always renders, including a zero count (e.g. "Degraded: 0") — do not hide zero-count rows, per operator decision.
- Coolify project/environment UUIDs are hardcoded constants (verified live during design): dev project `htb5fvtz30yyj3kmkgpy0e48` / environment `t13h0s3x0c342r4m2u2sg5tg`; prod project `rt43u6zclfay6zx1k5p0ct26` / environment `pq3z6jmucnbgwg9npyq0pbxv`.
- Design spec: `docs/superpowers/specs/2026-08-23-infra-card-labeled-rows-design.md`.

---

### Task 1: New per-environment app fetchers + Servers URL fix (`src/lib/vdecent-infra.ts`)

**Files:**
- Modify: `src/lib/vdecent-infra.ts`

**Interfaces:**
- Produces (used by Task 2): `export interface CountSection { state: "ok" | "not_configured" | "unreachable"; count: number | null; url: string; error: string | null }`, `fetchCoolifyDevApps(): Promise<CountSection>`, `fetchCoolifyProdApps(): Promise<CountSection>`.
- Removes: `fetchCoolifyApps()` (no longer used anywhere).

- [ ] **Step 1: Replace `fetchCoolifyApps()` with the two environment-scoped fetchers, and fix the Servers URL**

Current end of file (lines 47-100):

```ts
export async function fetchCoolifyServers(): Promise<Section<never>> {
  const token = process.env.COOLIFY_API_TOKEN;
  const url = "https://coolify.v-decent.org";
  if (!token) return emptySection("not_configured", null, null);

  try {
    const data = await fetchJson(
      "https://coolify.v-decent.org/api/v1/servers",
      { Authorization: `Bearer ${token}` }
    ) as Array<{ is_reachable?: boolean; is_usable?: boolean }>;
    if (!Array.isArray(data)) {
      throw new Error("Unexpected Coolify servers API response shape");
    }
    const items = data;
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
    if (!Array.isArray(data)) {
      throw new Error("Unexpected Coolify applications API response shape");
    }
    const items = data;
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

Replace with:

```ts
export async function fetchCoolifyServers(): Promise<Section<never>> {
  const token = process.env.COOLIFY_API_TOKEN;
  const url = "https://coolify.v-decent.org/servers";
  if (!token) return emptySection("not_configured", null, null);

  try {
    const data = await fetchJson(
      "https://coolify.v-decent.org/api/v1/servers",
      { Authorization: `Bearer ${token}` }
    ) as Array<{ is_reachable?: boolean; is_usable?: boolean }>;
    if (!Array.isArray(data)) {
      throw new Error("Unexpected Coolify servers API response shape");
    }
    const items = data;
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

export interface CountSection {
  state: "ok" | "not_configured" | "unreachable";
  count: number | null;
  url: string;
  error: string | null;
}

interface CoolifyEnvironmentRef {
  projectUuid: string;
  environmentUuid: string;
}

const COOLIFY_DEV_ENV: CoolifyEnvironmentRef = {
  projectUuid: "htb5fvtz30yyj3kmkgpy0e48",
  environmentUuid: "t13h0s3x0c342r4m2u2sg5tg",
};
const COOLIFY_PROD_ENV: CoolifyEnvironmentRef = {
  projectUuid: "rt43u6zclfay6zx1k5p0ct26",
  environmentUuid: "pq3z6jmucnbgwg9npyq0pbxv",
};

async function fetchCoolifyEnvironmentAppCount(env: CoolifyEnvironmentRef): Promise<CountSection> {
  const token = process.env.COOLIFY_API_TOKEN;
  const url = `https://coolify.v-decent.org/project/${env.projectUuid}/environment/${env.environmentUuid}`;
  if (!token) return { state: "not_configured", count: null, url, error: null };

  try {
    const data = await fetchJson(
      `https://coolify.v-decent.org/api/v1/projects/${env.projectUuid}/${env.environmentUuid}`,
      { Authorization: `Bearer ${token}` }
    ) as { applications?: unknown };
    if (!Array.isArray(data.applications)) {
      throw new Error("Unexpected Coolify environment API response shape");
    }
    return { state: "ok", count: data.applications.length, url, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return { state: "unreachable", count: null, url, error: message };
  }
}

export function fetchCoolifyDevApps(): Promise<CountSection> {
  return fetchCoolifyEnvironmentAppCount(COOLIFY_DEV_ENV);
}

export function fetchCoolifyProdApps(): Promise<CountSection> {
  return fetchCoolifyEnvironmentAppCount(COOLIFY_PROD_ENV);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/vdecent-infra.ts
git commit -m "$(cat <<'EOF'
feat: split Coolify Apps fetch by environment

Replaces the account-wide fetchCoolifyApps() with two fetchers that
each hit Coolify's per-environment endpoint directly, since
Development and Production are two separate Coolify
projects/environments with two separate dashboard pages the operator
wants linked separately. Each fetches and fails independently.
Also points Coolify Servers' link at the static /servers page
instead of the bare account root.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 2: Route reshape (`src/app/api/vdecent/infra/route.ts`)

**Files:**
- Modify: `src/app/api/vdecent/infra/route.ts`

**Interfaces:**
- Consumes: `fetchCloudflareTunnels`, `fetchCoolifyServers` (unchanged), `fetchCoolifyDevApps`, `fetchCoolifyProdApps` (Task 1).
- Produces (used by Task 3): `GET /api/vdecent/infra` → `{ tunnels, tunnelsState, coolifyDevApps: number|null, coolifyDevAppsState: SectionState, coolifyProdApps: number|null, coolifyProdAppsState: SectionState, coolifyServers, coolifyServersState, urls: { tunnels, coolifyDevApps, coolifyProdApps, coolifyServers }, errors: { tunnels, coolifyDevApps, coolifyProdApps, coolifyServers } }`.

- [ ] **Step 1: Rewrite the route**

Current full file:

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
    urls: { tunnels: tunnels.url, coolifyApps: coolifyApps.url, coolifyServers: coolifyServers.url },
    errors: {
      tunnels: tunnels.error,
      coolifyApps: coolifyApps.error,
      coolifyServers: coolifyServers.error,
    },
  });
}
```

Replace with:

```ts
import { NextResponse } from "next/server";
import { fetchCloudflareTunnels, fetchCoolifyDevApps, fetchCoolifyProdApps, fetchCoolifyServers } from "@/lib/vdecent-infra";

export const dynamic = "force-dynamic";

export async function GET() {
  const [tunnels, coolifyDevApps, coolifyProdApps, coolifyServers] = await Promise.all([
    fetchCloudflareTunnels(),
    fetchCoolifyDevApps(),
    fetchCoolifyProdApps(),
    fetchCoolifyServers(),
  ]);

  return NextResponse.json({
    tunnels: tunnels.counts,
    tunnelsState: tunnels.state,
    coolifyDevApps: coolifyDevApps.count,
    coolifyDevAppsState: coolifyDevApps.state,
    coolifyProdApps: coolifyProdApps.count,
    coolifyProdAppsState: coolifyProdApps.state,
    coolifyServers: coolifyServers.counts,
    coolifyServersState: coolifyServers.state,
    urls: {
      tunnels: tunnels.url,
      coolifyDevApps: coolifyDevApps.url,
      coolifyProdApps: coolifyProdApps.url,
      coolifyServers: coolifyServers.url,
    },
    errors: {
      tunnels: tunnels.error,
      coolifyDevApps: coolifyDevApps.error,
      coolifyProdApps: coolifyProdApps.error,
      coolifyServers: coolifyServers.error,
    },
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
feat: expose Coolify dev/prod app counts as separate route fields

Replaces the single coolifyApps/coolifyAppsState pair with
coolifyDevApps/coolifyDevAppsState and coolifyProdApps/
coolifyProdAppsState, matching the new per-environment fetchers.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 3: Card redesign — labeled rows (`src/components/vdecent-infra-card.tsx`)

**Files:**
- Modify: `src/components/vdecent-infra-card.tsx`

**Interfaces:**
- Consumes: `GET /api/vdecent/infra` (Task 2) — new field names.

- [ ] **Step 1: Replace the full file**

Current full file (119 lines) — replace entirely with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Panel, Skeleton } from "@/components/ui/kit";
import type { HealthCounts, SectionState } from "@/lib/vdecent";

interface AppEnvData {
  count: number | null;
  state: SectionState;
  url: string | null;
  error: string | null;
}

interface InfraData {
  tunnels: HealthCounts | null;
  tunnelsState: SectionState;
  coolifyDevApps: number | null;
  coolifyDevAppsState: SectionState;
  coolifyProdApps: number | null;
  coolifyProdAppsState: SectionState;
  coolifyServers: HealthCounts | null;
  coolifyServersState: SectionState;
  urls: { tunnels: string | null; coolifyDevApps: string | null; coolifyProdApps: string | null; coolifyServers: string | null };
  errors: { tunnels: string | null; coolifyDevApps: string | null; coolifyProdApps: string | null; coolifyServers: string | null };
}

const EMPTY: InfraData = {
  tunnels: null, tunnelsState: "not_configured",
  coolifyDevApps: null, coolifyDevAppsState: "not_configured",
  coolifyProdApps: null, coolifyProdAppsState: "not_configured",
  coolifyServers: null, coolifyServersState: "not_configured",
  urls: { tunnels: null, coolifyDevApps: null, coolifyProdApps: null, coolifyServers: null },
  errors: { tunnels: null, coolifyDevApps: null, coolifyProdApps: null, coolifyServers: null },
};

const FAILED: InfraData = {
  tunnels: null, tunnelsState: "unreachable",
  coolifyDevApps: null, coolifyDevAppsState: "unreachable",
  coolifyProdApps: null, coolifyProdAppsState: "unreachable",
  coolifyServers: null, coolifyServersState: "unreachable",
  urls: { tunnels: null, coolifyDevApps: null, coolifyProdApps: null, coolifyServers: null },
  errors: { tunnels: null, coolifyDevApps: null, coolifyProdApps: null, coolifyServers: null },
};

function isInfraData(d: unknown): d is InfraData {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  if (typeof obj.tunnelsState !== "string") return false;
  if (typeof obj.coolifyDevAppsState !== "string") return false;
  if (typeof obj.coolifyProdAppsState !== "string") return false;
  if (typeof obj.coolifyServersState !== "string") return false;
  if (!obj.urls || typeof obj.urls !== "object") return false;
  const urls = obj.urls as Record<string, unknown>;
  if (!("tunnels" in urls) || !("coolifyDevApps" in urls) || !("coolifyProdApps" in urls) || !("coolifyServers" in urls)) return false;
  if (!obj.errors || typeof obj.errors !== "object") return false;
  const errors = obj.errors as Record<string, unknown>;
  if (!("tunnels" in errors) || !("coolifyDevApps" in errors) || !("coolifyProdApps" in errors) || !("coolifyServers" in errors)) return false;
  return true;
}

function StatusNote({ state, error }: { state: SectionState; error?: string | null }) {
  if (state === "not_configured") {
    return <span className="text-[12px] text-[var(--text-3)]">Not configured</span>;
  }
  return <span className="text-[12px]" style={{ color: "var(--down)" }}>Unreachable{error ? `: ${error}` : ""}</span>;
}

function LabeledRow({ label, count, href, tone }: {
  label: string;
  count: number;
  href: string | null;
  tone: "up" | "warn" | "down";
}) {
  const color = tone === "up" ? "var(--up)" : tone === "warn" ? "var(--warn)" : "var(--down)";
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 pl-3">
      <span className="text-[12px] text-[var(--text-3)]">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium" style={{ color }}>{count}</span>
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--accent)] hover:underline">
            Open ↗
          </a>
        )}
      </div>
    </div>
  );
}

function BucketSection({ title, counts, state, url, error, labels }: {
  title: string;
  counts: HealthCounts | null;
  state: SectionState;
  url: string | null;
  error: string | null;
  labels: [string, string, string];
}) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-[var(--text-2)]">{title}</span>
        {state !== "ok" && <StatusNote state={state} error={error} />}
      </div>
      {state === "ok" && counts && (
        <div>
          <LabeledRow label={labels[0]} count={counts.healthy} href={url} tone="up" />
          <LabeledRow label={labels[1]} count={counts.pending} href={url} tone="warn" />
          <LabeledRow label={labels[2]} count={counts.atRisk} href={url} tone="down" />
        </div>
      )}
    </div>
  );
}

function AppEnvRow({ label, data }: { label: string; data: AppEnvData }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 pl-3">
      <span className="text-[12px] text-[var(--text-3)]">{label}</span>
      {data.state === "ok" && data.count !== null ? (
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium">{data.count}</span>
          {data.url && (
            <a href={data.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--accent)] hover:underline">
              Open ↗
            </a>
          )}
        </div>
      ) : (
        <StatusNote state={data.state} error={data.error} />
      )}
    </div>
  );
}

function AppsSection({ title, dev, prod }: { title: string; dev: AppEnvData; prod: AppEnvData }) {
  return (
    <div className="py-2">
      <span className="text-[13px] text-[var(--text-2)]">{title}</span>
      <div>
        <AppEnvRow label="Development apps" data={dev} />
        <AppEnvRow label="Production apps" data={prod} />
      </div>
    </div>
  );
}

export function VDecentInfraCard() {
  const [data, setData] = useState<InfraData>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/vdecent/infra")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (isInfraData(d)) {
          setData(d);
        } else {
          setData(FAILED);
        }
        setLoading(false);
      })
      .catch(() => {
        setData(FAILED);
        setLoading(false);
      });
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
          <BucketSection
            title="Cloudflare Tunnels"
            counts={data.tunnels}
            state={data.tunnelsState}
            url={data.urls.tunnels}
            error={data.errors.tunnels}
            labels={["Healthy", "Inactive", "Down"]}
          />
          <AppsSection
            title="Coolify Apps"
            dev={{ count: data.coolifyDevApps, state: data.coolifyDevAppsState, url: data.urls.coolifyDevApps, error: data.errors.coolifyDevApps }}
            prod={{ count: data.coolifyProdApps, state: data.coolifyProdAppsState, url: data.urls.coolifyProdApps, error: data.errors.coolifyProdApps }}
          />
          <BucketSection
            title="Coolify Servers"
            counts={data.coolifyServers}
            state={data.coolifyServersState}
            url={data.urls.coolifyServers}
            error={data.errors.coolifyServers}
            labels={["Online", "Degraded", "Offline"]}
          />
        </div>
      )}
    </Panel>
  );
}
```

Note: `Pill` is no longer imported/used — the count itself is colored by `tone` instead of wrapped in a pill, since each row now carries its own label (a pill made sense when three unlabeled numbers needed color to distinguish them; a labeled row doesn't need that redundancy, but the color is kept as a quick-glance health cue).

- [ ] **Step 2: Type-check**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/vdecent-infra-card.tsx
git commit -m "$(cat <<'EOF'
feat: show labeled rows instead of unlabeled pills on infra card

Cloudflare Tunnels and Coolify Servers now render three named rows
each (Healthy/Inactive/Down, Online/Degraded/Offline) instead of
unlabeled colored pills, and Coolify Apps splits into Development/
Production rows with independent per-environment links and failure
states. Every row always renders, including zero counts, since a
labeled zero is itself useful information.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LuBbBbxRhBkAavr4J6iHXH
EOF
)"
```

---

### Task 4: Deploy and verify live

**Files:** none (deploy + verification only).

**Interfaces:**
- Consumes: all prior tasks' committed code, pushed to `main`.

No new credentials are needed — both new fetchers reuse `COOLIFY_API_TOKEN`, already set on the live Coolify app since the prior round.

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Trigger a deploy and wait for it to finish**

```bash
source ~/.bashrc
curl -sS -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/deploy?uuid=ezghadjtwn2fd9u6dlmfohcn"
```

There is no external notification system — poll `GET https://coolify.v-decent.org/api/v1/deployments/{deployment_uuid}` yourself in a bash loop (check, sleep ~10-15s, check again) until `status` is `finished`. Retry once on a transient DNS blip; escalate if it fails twice or any other way.

- [ ] **Step 3: Verify the new response shape live**

```bash
source ~/.bashrc
SECRET=$(curl -sS -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" "https://coolify.v-decent.org/api/v1/applications/ezghadjtwn2fd9u6dlmfohcn/envs" | python3 -c "import json,sys; d=json.load(sys.stdin); print([e['value'] for e in d if not e.get('is_preview') and e['key']=='INTERNAL_API_SECRET'][0])")
curl -sS "https://dashboard.v-decent.org/api/vdecent/infra" -H "x-internal-secret: $SECRET" | python3 -m json.tool
```

Expected: `tunnelsState`/`coolifyDevAppsState`/`coolifyProdAppsState`/`coolifyServersState` all `"ok"`; `coolifyDevApps` and `coolifyProdApps` are plain numbers (around 12 and 4, may have drifted); `urls.coolifyDevApps` starts with `https://coolify.v-decent.org/project/htb5fvtz30yyj3kmkgpy0e48/environment/`; `urls.coolifyProdApps` starts with `https://coolify.v-decent.org/project/rt43u6zclfay6zx1k5p0ct26/environment/`; `urls.coolifyServers` is exactly `https://coolify.v-decent.org/servers`.

- [ ] **Step 4: Ask the user to visually confirm in the browser**

Report to the user: deployed and live. Ask them to open the home dashboard and confirm the "V-Decent Infrastructure" card now shows labeled rows (Healthy/Inactive/Down for Tunnels, Development apps/Production apps for Coolify Apps with two different links, Online/Degraded/Offline for Servers) instead of unlabeled pills — since this environment has no browser to verify the rendered UI directly.
