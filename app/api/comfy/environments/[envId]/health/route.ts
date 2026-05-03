import { NextRequest, NextResponse } from "next/server";
import {
  EnvironmentNotFoundError,
  getEnvironment,
  updateEnvironment,
} from "@/lib/server/environmentService";
import { errorToResponse } from "@/lib/server/apiHelpers";
import { ComfyClient, type SystemStatsResponse } from "@/lib/server/providers/comfyui/client";
import { getHostMetrics } from "@/lib/server/healthMetrics";
import type { HealthSnapshot } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ envId: string }>;
}

const PROBE_TIMEOUT_MS = 5000;

function pct(used: number, total: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

function ramPctFrom(stats: SystemStatsResponse): number | null {
  const total = stats.system?.ram_total ?? 0;
  const free = stats.system?.ram_free ?? 0;
  if (!total) return null;
  return pct(total - free, total);
}

function vramPctFrom(stats: SystemStatsResponse): number | null {
  const dev = stats.devices?.[0];
  if (!dev || !dev.vram_total) return null;
  return pct((dev.vram_total ?? 0) - (dev.vram_free ?? 0), dev.vram_total);
}

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { envId } = await ctx.params;
    const env = await getEnvironment(envId);
    if (!env) throw new EnvironmentNotFoundError(envId);

    const client = new ComfyClient(env);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    const startedAt = Date.now();
    const lastChecked = new Date().toISOString();

    let snapshot: HealthSnapshot;
    try {
      // Run /system_stats + /queue in parallel; queue is best-effort. Host metrics
      // run alongside since CPU sampling needs ~250ms and we'd rather not block.
      const [stats, queueRemaining, host] = await Promise.all([
        client.systemStats(controller.signal),
        client.queueDepth(controller.signal),
        getHostMetrics(),
      ]);
      const latencyMs = Date.now() - startedAt;
      const isLocal = env.type === "local";
      snapshot = {
        envId: env.id,
        status: "connected",
        lastChecked,
        latencyMs,
        ramPct: ramPctFrom(stats),
        vramPct: vramPctFrom(stats),
        // Host CPU/disk only meaningful when ComfyUI is on the same machine.
        cpuPct: isLocal ? host.cpuPct : null,
        diskFreePct: isLocal ? host.diskFreePct : null,
        diskFreeGb: isLocal ? host.diskFreeGb : null,
        deviceName: stats.devices?.[0]?.name ?? null,
        queueRemaining,
        comfyVersion: stats.system?.comfyui_version ?? null,
      };
    } catch (err) {
      const message =
        err instanceof Error
          ? controller.signal.aborted
            ? `Probe timed out after ${PROBE_TIMEOUT_MS}ms`
            : err.message
          : "Unknown probe error";
      snapshot = {
        envId: env.id,
        status: "disconnected",
        lastChecked,
        latencyMs: null,
        ramPct: null,
        vramPct: null,
        cpuPct: null,
        diskFreePct: null,
        diskFreeGb: null,
        deviceName: null,
        queueRemaining: null,
        comfyVersion: null,
        error: message,
      };
    } finally {
      clearTimeout(timeout);
    }

    // Persist the connection status + lastChecked back to env.json so the
    // settings UI and listEnvironments() reflect the latest probe.
    await updateEnvironment(envId, {
      status: snapshot.status,
      lastChecked: snapshot.lastChecked,
    }).catch(() => {
      /* probe result is more important than the persistence side-effect */
    });

    return NextResponse.json({ snapshot });
  } catch (err) {
    return errorToResponse(err);
  }
}
