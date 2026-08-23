# V-Decent Infrastructure Card — Labeled Rows + Per-Environment Apps — Design

Date: 2026-08-23

## Purpose

The "V-Decent Infrastructure" card shipped earlier today shows Cloudflare Tunnel and Coolify
health as unlabeled colored pills, and a single account-wide "Coolify Apps" count with one
link. Operator feedback: the pills don't say what they mean, and Coolify Apps needs to be
split by environment (Development vs. Production are two separate Coolify projects/
environments with two separate dashboard pages) rather than shown as one combined number.

## Background: verified live during design

- `GET /api/v1/projects` returns two projects matching the operator-supplied URLs exactly:
  `htb5fvtz30yyj3kmkgpy0e48` ("V-Decent Project Development/PoC") and `rt43u6zclfay6zx1k5p0ct26`
  ("V-Decent Project Production").
- `GET /api/v1/projects/{projectUuid}/{environmentUuid}` returns that environment's own
  `applications` array. Dev environment (`t13h0s3x0c342r4m2u2sg5tg`): 12 apps. Prod environment
  (`pq3z6jmucnbgwg9npyq0pbxv`): 4 apps. 12 + 4 = 16, matching today's account-wide total exactly
  — confirms this is a clean partition, not overlapping or missing anything.
- Each application in that response carries the same `status` field (`"running:healthy"` /
  `"running:unknown"` / etc.) already used by the existing `fetchCoolifyApps()` bucketing logic
  — not needed for this design (counts only, no health breakdown per environment, per operator
  decision), but confirms the data is structurally consistent with the rest of this module.

## What changes

### 1. Two new fetchers for per-environment app counts (`src/lib/vdecent-infra.ts`)

```ts
export interface CountSection {
  state: "ok" | "not_configured" | "unreachable";
  count: number | null;
  url: string;
  error: string | null;
}

const COOLIFY_DEV_ENV = {
  projectUuid: "htb5fvtz30yyj3kmkgpy0e48",
  environmentUuid: "t13h0s3x0c342r4m2u2sg5tg",
};
const COOLIFY_PROD_ENV = {
  projectUuid: "rt43u6zclfay6zx1k5p0ct26",
  environmentUuid: "pq3z6jmucnbgwg9npyq0pbxv",
};

async function fetchCoolifyEnvironmentAppCount(env: { projectUuid: string; environmentUuid: string }): Promise<CountSection> {
  const token = process.env.COOLIFY_API_TOKEN;
  const url = `https://coolify.v-decent.org/project/${env.projectUuid}/environment/${env.environmentUuid}`;
  if (!token) return { state: "not_configured", count: null, url, error: null };
  try {
    const data = await fetchJson(
      `https://coolify.v-decent.org/api/v1/projects/${env.projectUuid}/${env.environmentUuid}`,
      { Authorization: `Bearer ${token}` }
    ) as { applications?: unknown };
    if (!Array.isArray(data.applications)) throw new Error("Unexpected Coolify environment response shape");
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

Each environment fetches and fails independently — if the dev call fails, the prod row is
unaffected (matches the existing per-metric independence already used for tunnels/servers/apps
today).

`fetchCoolifyApps()` (the old account-wide version) is deleted — nothing else calls it.

### 2. `fetchCoolifyServers()`'s URL becomes a constant

Currently `fetchCoolifyServers()` computes `url` the same way `fetchCoolifyApps()` did. Change
it to the fixed operator-requested URL:

```ts
const url = "https://coolify.v-decent.org/servers";
```

No other change to that function — its `HealthCounts` bucketing (`healthy`/`pending`/`atRisk`)
is untouched; this is a labeling change made entirely in the card component (Section 4), not
here. This code just went through a full review-and-harden cycle — minimizing the diff here on
purpose.

`fetchCloudflareTunnels()` is untouched entirely (data and URL both already correct).

### 3. Route reshape (`src/app/api/vdecent/infra/route.ts`)

Replace the single `coolifyApps`/`coolifyAppsState` pair with two pairs, and update the
`urls`/`errors` companion objects to match:

```ts
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

`tunnels`/`tunnelsState`/`coolifyServers`/`coolifyServersState` keep their exact existing shape
and field names — only the two Coolify-apps fields are replaced and the `urls`/`errors` objects
gain matching keys.

### 4. Card redesign (`src/components/vdecent-infra-card.tsx`)

Replace the current single-row-of-pills layout with a labeled sub-row list per section, per the
approved mockup. All rows always render, including zero counts (a labeled zero is itself useful
information, e.g. "Degraded: 0" confirms nothing is degraded — and rows no longer jump around as
counts cross zero).

```
Cloudflare Tunnels
  Healthy    5   Open ↗
  Inactive   4   Open ↗
  Down      12   Open ↗

Coolify Apps
  Development apps  12   Open ↗
  Production apps    4   Open ↗

Coolify Servers
  Online     4   Open ↗
  Degraded   0   Open ↗
  Offline    4   Open ↗
```

- Tunnels and Servers each render 3 fixed labeled rows sourced from their `HealthCounts`
  (`healthy`→"Healthy"/"Online", `pending`→"Inactive"/"Degraded", `atRisk`→"Down"/"Offline"),
  each row's link using that section's single shared `url`. A `state !== "ok"` section still
  renders its existing quiet "Not configured"/"Unreachable: <error>" line instead of rows
  (unchanged behavior, just no longer pill-based).
- Coolify Apps renders 2 rows ("Development apps", "Production apps"), each independently
  showing its own count/link, or its own "Not configured"/"Unreachable" note if that specific
  environment's fetch failed — since the two are now fetched (and can fail) independently.
- The `isInfraData` runtime type guard (added in the prior hardening pass) is updated to check
  the new field names (`coolifyDevApps`/`coolifyDevAppsState`/`coolifyProdApps`/
  `coolifyProdAppsState` replacing `coolifyApps`/`coolifyAppsState`) instead of the old ones, and
  the `errors`/`urls` key checks are updated to the new key names.

## What does NOT change

- `fetchCloudflareTunnels()`'s internals, `fetchCoolifyServers()`'s bucketing logic, the shared
  `fetchJson` helper, the `HealthCounts`/`Section<T>` reuse pattern — untouched, per Section 2/3
  above.
- No sidebar, no new page, no billing — this is purely a reshape of the existing home-dashboard
  card.
- Credential handling — no new env vars needed; both new fetchers reuse `COOLIFY_API_TOKEN`,
  already wired into `hermy-hq` since the prior round.

## Out of scope

- A health breakdown within each Coolify environment (e.g. "Development: 12 total, 7 healthy") —
  operator explicitly chose total-count-only per environment.
- Any other Coolify project/environment beyond these two (none currently exist).
