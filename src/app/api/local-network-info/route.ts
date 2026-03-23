import { networkInterfaces } from "node:os";
import { NextResponse } from "next/server";

export const dynamic = "force-static";

function pickLanIp() {
  const nets = networkInterfaces();
  const candidates: string[] = [];

  for (const values of Object.values(nets)) {
    for (const net of values || []) {
      if (!net || net.family !== "IPv4" || net.internal) continue;
      candidates.push(net.address);
    }
  }

  const preferred = candidates.find((ip) => ip.startsWith("192.168.") || ip.startsWith("10."));
  return preferred || candidates[0] || null;
}

export async function GET() {
  const lanIp = pickLanIp();
  return NextResponse.json({ lanIp });
}
