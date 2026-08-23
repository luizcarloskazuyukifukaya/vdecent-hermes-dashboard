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
