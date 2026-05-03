import "server-only";

import os from "node:os";
import fs from "node:fs/promises";
import { getDataDir } from "./storage";

/**
 * Host-side metrics for the Next.js process. Only meaningful when ComfyUI is
 * running on the same machine as the studio (which is the typical local-dev
 * setup). For remote ComfyUI envs the caller can skip these and just report
 * RAM + VRAM from /system_stats.
 */
export interface HostMetrics {
  cpuPct: number | null;
  diskFreePct: number | null;
  diskFreeGb: number | null;
}

/**
 * Snapshot of cumulative CPU times across all logical cores. ComfyUI's
 * /system_stats does not expose CPU%, so we sample twice on the host and diff
 * the busy/total ratio. ~250ms is enough to be representative without
 * meaningfully delaying a 30s health check.
 */
function readCpuTimes(): { idle: number; total: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const value of Object.values(cpu.times)) total += value;
    idle += cpu.times.idle;
  }
  return { idle, total };
}

async function sampleCpuPct(durationMs: number): Promise<number | null> {
  try {
    const a = readCpuTimes();
    await new Promise((r) => setTimeout(r, durationMs));
    const b = readCpuTimes();
    const idleDelta = b.idle - a.idle;
    const totalDelta = b.total - a.total;
    if (totalDelta <= 0) return null;
    const pct = (1 - idleDelta / totalDelta) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  } catch {
    return null;
  }
}

async function readDiskFree(): Promise<{ pct: number | null; gb: number | null }> {
  try {
    const stats = await fs.statfs(getDataDir());
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    if (totalBytes <= 0) return { pct: null, gb: null };
    const freePct = Math.max(0, Math.min(100, Math.round((freeBytes / totalBytes) * 100)));
    const freeGb = Math.round((freeBytes / 1024 ** 3) * 10) / 10;
    return { pct: freePct, gb: freeGb };
  } catch {
    return { pct: null, gb: null };
  }
}

/**
 * Collect CPU% (sampled over `cpuSampleMs`) and disk-free metrics for the host.
 * Both fields fall back to null on failure so callers can render gracefully.
 */
export async function getHostMetrics(cpuSampleMs = 250): Promise<HostMetrics> {
  const [cpuPct, disk] = await Promise.all([sampleCpuPct(cpuSampleMs), readDiskFree()]);
  return { cpuPct, diskFreePct: disk.pct, diskFreeGb: disk.gb };
}
