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
