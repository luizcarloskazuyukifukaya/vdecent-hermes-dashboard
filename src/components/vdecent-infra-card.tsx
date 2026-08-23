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
  urls: { tunnels: string | null; coolifyApps: string | null; coolifyServers: string | null };
  errors: { tunnels: string | null; coolifyApps: string | null; coolifyServers: string | null };
}

const EMPTY: InfraData = {
  tunnels: null, tunnelsState: "not_configured",
  coolifyApps: null, coolifyAppsState: "not_configured",
  coolifyServers: null, coolifyServersState: "not_configured",
  urls: { tunnels: null, coolifyApps: null, coolifyServers: null },
  errors: { tunnels: null, coolifyApps: null, coolifyServers: null },
};

const FAILED: InfraData = {
  tunnels: null, tunnelsState: "unreachable",
  coolifyApps: null, coolifyAppsState: "unreachable",
  coolifyServers: null, coolifyServersState: "unreachable",
  urls: { tunnels: null, coolifyApps: null, coolifyServers: null },
  errors: { tunnels: null, coolifyApps: null, coolifyServers: null },
};

function isInfraData(d: unknown): d is InfraData {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  if (typeof obj.tunnelsState !== "string") return false;
  if (typeof obj.coolifyAppsState !== "string") return false;
  if (typeof obj.coolifyServersState !== "string") return false;
  if (!obj.urls || typeof obj.urls !== "object") return false;
  const urls = obj.urls as Record<string, unknown>;
  if (!("tunnels" in urls) || !("coolifyApps" in urls) || !("coolifyServers" in urls)) return false;
  if (!obj.errors || typeof obj.errors !== "object") return false;
  const errors = obj.errors as Record<string, unknown>;
  if (!("tunnels" in errors) || !("coolifyApps" in errors) || !("coolifyServers" in errors)) return false;
  return true;
}

function CountsRow({ label, counts, state, href, error }: {
  label: string;
  counts: HealthCounts | null;
  state: SectionState;
  href: string | null;
  error?: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[13px] text-[var(--text-2)]">{label}</span>
      {state === "not_configured" ? (
        <span className="text-[12px] text-[var(--text-3)]">Not configured</span>
      ) : state === "unreachable" || !counts ? (
        <span className="text-[12px]" style={{ color: "var(--down)" }}>Unreachable{error ? `: ${error}` : ""}</span>
      ) : (
        <div className="flex items-center gap-2">
          {counts.healthy > 0 && <Pill tone="up">{counts.healthy}</Pill>}
          {counts.pending > 0 && <Pill tone="warn">{counts.pending}</Pill>}
          {counts.atRisk > 0 && <Pill tone="down">{counts.atRisk}</Pill>}
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--accent)] hover:underline ml-1">
              Open {label} ↗
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
          <CountsRow label="Cloudflare Tunnels" counts={data.tunnels} state={data.tunnelsState} href={data.urls.tunnels} error={data.errors.tunnels} />
          <CountsRow label="Coolify Apps" counts={data.coolifyApps} state={data.coolifyAppsState} href={data.urls.coolifyApps} error={data.errors.coolifyApps} />
          <CountsRow label="Coolify Servers" counts={data.coolifyServers} state={data.coolifyServersState} href={data.urls.coolifyServers} error={data.errors.coolifyServers} />
        </div>
      )}
    </Panel>
  );
}
