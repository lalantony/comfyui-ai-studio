"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useEnvironmentStore } from "@/stores/useEnvironmentStore";
import { useHealthMonitor } from "@/hooks/useHealthMonitor";
import { ResourceMeter } from "@/components/shared/ResourceMeter";
import { GlassPanel } from "@/components/shared/GlassPanel";
import { RefreshCw, CheckCircle2, XCircle, Loader2 } from "lucide-react";

/**
 * Sidebar bottom widget. Renders only when:
 *   - At least one environment exists, AND
 *   - The active env has health checks enabled.
 *
 * When health checks are disabled the widget hides entirely — settings is the
 * place to opt back in. The polling loop is owned by useHealthMonitor and
 * mounts here so it lives only inside the studio shell.
 */
export function StatusCards() {
  const environments = useEnvironmentStore((s) => s.environments);
  const snapshots = useEnvironmentStore((s) => s.healthSnapshots);
  const probingEnvIds = useEnvironmentStore((s) => s.probingEnvIds);
  const loadEnvironments = useEnvironmentStore((s) => s.loadEnvironments);
  const runHealthCheck = useEnvironmentStore((s) => s.runHealthCheck);

  useEffect(() => {
    void loadEnvironments();
  }, [loadEnvironments]);

  useHealthMonitor();

  const activeEnv = environments.find((e) => e.isActive) ?? environments[0];

  if (!activeEnv) return null;
  if (activeEnv.healthCheckEnabled === false) return null;

  const snapshot = snapshots[activeEnv.id];
  const status = snapshot?.status ?? activeEnv.status ?? "checking";
  const isProbing = probingEnvIds.has(activeEnv.id);

  const statusIcon = (() => {
    switch (status) {
      case "connected":
        return <CheckCircle2 className="w-3 h-3 text-accent-green" />;
      case "disconnected":
        return <XCircle className="w-3 h-3 text-danger" />;
      case "checking":
      default:
        return <Loader2 className="w-3 h-3 text-warning animate-spin" />;
    }
  })();

  const statusLabel =
    status === "connected" ? "Connected" : status === "checking" ? "Checking..." : "Disconnected";
  const statusColor =
    status === "connected"
      ? "text-accent-green"
      : status === "checking"
        ? "text-warning"
        : "text-danger";

  // Render meters only when we have a real snapshot. Each metric is null-aware
  // so remote envs (no host CPU/disk) collapse cleanly.
  const meters: Array<{ label: string; value: number | null }> = snapshot
    ? [
        { label: "CPU", value: snapshot.cpuPct },
        { label: "RAM", value: snapshot.ramPct },
        { label: "VRAM", value: snapshot.vramPct },
        { label: "Disk", value: snapshot.diskFreePct === null ? null : 100 - snapshot.diskFreePct },
      ]
    : [];
  const visibleMeters = meters.filter((m) => m.value !== null) as Array<{ label: string; value: number }>;

  return (
    <div className="p-3 space-y-3">
      {/* ComfyUI Status */}
      <GlassPanel className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            {statusIcon}
            <span className="text-xs font-medium text-foreground truncate">{activeEnv.name}</span>
          </div>
          <button
            onClick={() => void runHealthCheck(activeEnv.id)}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            disabled={isProbing}
            title="Refresh health"
          >
            <RefreshCw className={cn("w-3 h-3", isProbing && "animate-spin")} />
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground truncate font-mono">{activeEnv.baseUrl}</p>
        <div className="flex items-center justify-between mt-1">
          <p className={cn("text-[10px]", statusColor)}>{statusLabel}</p>
          {snapshot?.latencyMs != null && status === "connected" && (
            <p className="text-[10px] text-muted-foreground">{snapshot.latencyMs}ms</p>
          )}
        </div>
        {snapshot?.queueRemaining != null && snapshot.queueRemaining > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Queue: <span className="text-foreground">{snapshot.queueRemaining}</span>
          </p>
        )}
        {status === "disconnected" && snapshot?.error && (
          <p className="text-[10px] text-danger/80 mt-1 line-clamp-2" title={snapshot.error}>
            {snapshot.error}
          </p>
        )}
      </GlassPanel>

      {/* System Resources — hidden until we have a successful probe */}
      {visibleMeters.length > 0 && (
        <GlassPanel className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              System Resources
            </h3>
            {snapshot?.diskFreeGb != null && (
              <span className="text-[10px] text-muted-foreground">
                {snapshot.diskFreeGb} GB free
              </span>
            )}
          </div>
          <div className="space-y-2">
            {visibleMeters.map((m) => (
              <ResourceMeter key={m.label} label={m.label} value={m.value} />
            ))}
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
