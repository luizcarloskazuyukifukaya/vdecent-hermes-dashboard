# V-Decent Infrastructure Overview (Coolify + Cloudflare) — Design

Date: 2026-08-23

## Purpose

The home dashboard already shows App Manager + Node Manager health per environment via
`VDecentOverviewCard` (`GET /api/vdecent/overview`), linking out to full detail on
`/vdecent-dev` and `/vdecent-pro`. Two more V-Decent infrastructure layers have zero presence
anywhere in the dashboard today: Coolify (servers, applications) and Cloudflare (Tunnels).
Both currently exist only as a *simulated* chat persona's role description
(`src/app/api/agent-chat/route.ts`'s "Edge" prompt), which explicitly declines to report real
status. This adds real, live status for both to the home dashboard, as a compact summary
card — matching operator decision, verified with real data during design (Coolify: 8 servers/
16 apps queried live; Cloudflare: 20 tunnels queried live).

Billing (Operations Platform) is explicitly out of scope for this round — no credentials
exist for it anywhere, and it was already marked out of scope in the original V-Decent ops
dashboard design. It remains a candidate follow-up once Operations Platform access exists.

## Background: verified live during design

- **Coolify** (`https://coolify.v-decent.org` API, `COOLIFY_API_TOKEN`): 8 servers registered
  (`GET /api/v1/servers`), 4 unreachable (`vdecent-node-99/220/225/332`); 16 applications
  (`GET /api/v1/applications`), all currently `running` (10 `running:unknown` health-check
  state, 6 `running:healthy`, 0 down).
- **Cloudflare** (`https://api.cloudflare.com/client/v4`, account id
  `0780cc2c18c0cc9fd0a09bec1e43ec7d`): 20 Tunnels (`GET /accounts/{id}/cfd_tunnel`) — 5
  `healthy` (the currently-active nodes: `vdecent-server-network-0`, `vdecent-dev-network-0`,
  `vdecent-network-node-1`/`-10000`/`-1001`), 4 `inactive`, 11 `down` (mostly decommissioned
  test-node tunnels — matches the same unreachable server list from Coolify above,
  cross-verified consistent between both APIs).
- **Neither Coolify nor Cloudflare credentials are wired into the running `hermy-hq`
  container today** — `docker-compose.yaml`'s `hermy-hq` service has no `COOLIFY_*`/
  `CLOUDFLARE_*` env vars at all. These tokens exist only in the operator's own shell
  (`~/.bashrc` on `vdecentserver0`), used for manual/agent-driven `curl` calls, not by the
  deployed app. This design adds them to the app for the first time.

## What changes

### 1. Shared fetch module: `src/lib/vdecent-infra.ts`

Server-only helpers, following the exact `Section<T>` pattern already established by
`src/lib/vdecent.ts` (`fetchAppManagerSection`/`fetchNodeManagerSection`) — `state: "ok" |
"not_configured" | "unreachable"`, an `error` string when `state !== "ok"`, and a `url` for
the card's "Open X ↗" link. Unlike the App/Node Manager helpers, these don't carry a full
`items` list — this card only needs counts, so the shape drops `items` and keeps just
`counts`:

```ts
export interface InfraCounts { healthy: number; warn: number; down: number; total: number }
export interface InfraSection {
  state: "ok" | "not_configured" | "unreachable";
  counts: InfraCounts;
  url: string;
  error?: string;
}
```

Three fetchers, each bucketing a live API response into `{healthy, warn, down}`:

- **`fetchCloudflareTunnels()`** — `GET https://api.cloudflare.com/client/v4/accounts/
  {CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel?is_deleted=false`, `Authorization: Bearer
  {CLOUDFLARE_API_TOKEN}`. Bucket by each tunnel's `status`: `healthy` → healthy, `inactive`
  → warn, everything else (`down`, `degraded`) → down.
- **`fetchCoolifyServers()`** — `GET https://coolify.v-decent.org/api/v1/servers`,
  `Authorization: Bearer {COOLIFY_API_TOKEN}`. Bucket by `is_reachable`/`is_usable`:
  reachable && usable → healthy; reachable && !usable → warn; !reachable → down.
- **`fetchCoolifyApps()`** — `GET https://coolify.v-decent.org/api/v1/applications`, same
  token. Bucket by each app's `status` string: starts with `running:healthy` → healthy,
  starts with `running:` (any other suffix, e.g. `unknown`) → warn, anything not starting
  with `running:` → down.

`state` is `"not_configured"` when the relevant token/account-id env var is unset (mirrors
the existing App/Node Manager helpers' "blank env var disables the feature" convention —
same as `AM_DEV_API_URL` etc. today), `"unreachable"` on a fetch error or non-2xx response
(8s timeout, no retries — matching the existing helpers exactly), `"ok"` otherwise.

### 2. New route: `GET /api/vdecent/infra`

```ts
export async function GET() {
  const [tunnels, coolifyApps, coolifyServers] = await Promise.all([
    fetchCloudflareTunnels(), fetchCoolifyApps(), fetchCoolifyServers(),
  ]);
  return NextResponse.json({ tunnels, coolifyApps, coolifyServers });
}
```

`export const dynamic = "force-dynamic"`, matching `/api/vdecent/overview` and `/api/vdecent/
[env]`. Kept as its own route rather than folded into `/api/vdecent/overview` — that route's
shape is dev/prod-keyed (`{ dev: {...}, prod: {...} }`); this data is account-wide (one
Coolify instance, one Cloudflare account serving both environments), so merging would force
an awkward "which env does this belong to" question that doesn't apply. Keeping them separate
also means zero risk to the already-shipped `overview` route.

### 3. New card: `src/components/vdecent-infra-card.tsx`

`VDecentInfraCard` — a client component fetching `/api/vdecent/infra` on mount (same pattern
as `VDecentOverviewCard`), rendered in `src/app/page.tsx` directly below the existing
`VDecentOverviewCard`. Three rows, one per section, each a label plus three `Pill`s (`tone=
"up"` for healthy, `"warn"` for warn, `"down"` for down — reusing the exact `Pill` component
and tone vocabulary already used throughout `vdecent-env-page.tsx`), matching the approved
mockup:

```
V-Decent Infrastructure
  Cloudflare Tunnels    🟢 5  ⚪ 4  🔴 11
  Coolify Apps          🟢 6  ⚪ 10
  Coolify Servers       🟢 4        🔴 4
```

A zero-count bucket is simply omitted from that row (matching the mockup, which shows no
"⚪ 0" for Coolify Servers' warn bucket). Each row's rightmost element is a small "Open X ↗"
link (`https://coolify.v-decent.org` for both Coolify rows, the Cloudflare dashboard's tunnel
page for the Tunnels row), matching `VDecentOverviewCard`'s existing link-out convention. A
`state !== "ok"` section renders inline as a quiet one-line note ("not configured" /
"unreachable — <error>") instead of pills, matching `EmptyState`'s use elsewhere for the same
distinction.

### 4. Credentials

`docker-compose.yaml`'s `hermy-hq` service `environment:` block gains three entries, in the
same `${VAR}` style already used for every other secret (`POSTGRES_PASSWORD`,
`GOOGLE_CLIENT_SECRET`, etc. — resolved from Coolify's own env-var config for this app, never
committed):

```yaml
- COOLIFY_API_TOKEN=${COOLIFY_API_TOKEN:-}
- CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN:-}
- CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID:-}
```

(`:-` default-to-empty, matching this file's existing optional-var convention like
`OPENAI_API_KEY:-` — blank means `not_configured`, not a boot failure.) The actual values are
set directly on the `vdecent-hermes-dashboard` Coolify application's environment variables,
using the tokens already verified working during design — no new credential gathering needed,
per operator decision.

## What does NOT change

- `/api/vdecent/overview`, `/api/vdecent/[env]`, `/vdecent-dev`, `/vdecent-pro` — untouched.
- No mutating actions (deploy/restart/purge-cache) — read-only status, matching every other
  V-Decent ops surface in this dashboard.
- No new sidebar entry — this lives on the existing home dashboard, per operator decision.
- Billing/Operations Platform — explicitly deferred; no code, no env vars, no placeholder UI
  for it in this round.

## Out of scope

- Billing payment schedule, due dates, overdue billing — needs Operations Platform
  credentials that don't exist yet; a separate follow-up once they do.
- A dedicated detail page for Coolify/Cloudflare (the existing per-item tables `/vdecent-dev`/
  `/vdecent-pro` have for App/Node Manager) — this round is counts-only on the home dashboard.
- Any Cloudflare DNS record or zone-level detail beyond Tunnel status.
- Historical trends or alerting on any of these three metrics.
