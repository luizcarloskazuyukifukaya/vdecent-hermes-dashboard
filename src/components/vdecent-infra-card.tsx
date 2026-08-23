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
