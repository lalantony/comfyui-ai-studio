"use client";

import { useEffect, useRef } from "react";
import { useEnvironmentStore } from "@/stores/useEnvironmentStore";

const MAX_CONSECUTIVE_FAILS = 3;
const FAIL_BACKOFF_MULTIPLIER = 3;
const MIN_INTERVAL_SEC = 5;
const DEFAULT_INTERVAL_SEC = 30;

/**
 * Polls the active environment's /health endpoint on its configured interval.
 *
 * Behavior:
 *   - Idle when there is no active env, or the env has healthCheckEnabled === false.
 *   - Pauses while document.hidden is true; runs an immediate probe on visibility return.
 *   - Backs off (3x interval) after MAX_CONSECUTIVE_FAILS consecutive failures so we
 *     don't hammer a disconnected server.
 *   - Re-runs immediately whenever the active env id or its interval changes.
 *
 * Mount this once in the app shell (StatusCards) — multiple mounts are safe but
 * wasteful since concurrent calls for the same env id are deduped in the store.
 */
export function useHealthMonitor(): void {
  const environments = useEnvironmentStore((s) => s.environments);
  const runHealthCheck = useEnvironmentStore((s) => s.runHealthCheck);
  const snapshots = useEnvironmentStore((s) => s.healthSnapshots);

  const activeEnv = environments.find((e) => e.isActive) ?? environments[0];
  const activeEnvId = activeEnv?.id ?? null;
  const enabled = activeEnv?.healthCheckEnabled ?? true;
  const intervalSec = Math.max(
    MIN_INTERVAL_SEC,
    activeEnv?.healthCheckIntervalSec ?? DEFAULT_INTERVAL_SEC
  );

  const consecutiveFailsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `snapshots` is read by the runtime (via the store) — we don't need to mirror it here.
  void snapshots;

  useEffect(() => {
    if (!activeEnvId || !enabled) {
      consecutiveFailsRef.current = 0;
      return;
    }

    let cancelled = false;

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const tick = async () => {
      if (cancelled || typeof document !== "undefined" && document.hidden) {
        scheduleNext(intervalSec);
        return;
      }
      const snapshot = await runHealthCheck(activeEnvId);
      if (cancelled) return;
      if (!snapshot) {
        // Probe was deduped — try again on the normal cadence.
        scheduleNext(intervalSec);
        return;
      }
      if (snapshot.status === "connected") {
        consecutiveFailsRef.current = 0;
        scheduleNext(intervalSec);
      } else {
        consecutiveFailsRef.current += 1;
        const factor =
          consecutiveFailsRef.current >= MAX_CONSECUTIVE_FAILS ? FAIL_BACKOFF_MULTIPLIER : 1;
        scheduleNext(intervalSec * factor);
      }
    };

    const scheduleNext = (sec: number) => {
      clearTimer();
      timerRef.current = setTimeout(() => {
        void tick();
      }, sec * 1000);
    };

    const onVisibility = () => {
      if (cancelled) return;
      if (!document.hidden) {
        // Tab came back to focus — probe immediately and restart the loop.
        clearTimer();
        void tick();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    // Kick off the first probe immediately so the UI doesn't sit empty for `intervalSec`.
    void tick();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimer();
    };
    // We intentionally do not depend on snapshots — the loop manages its own cadence
    // and reacts to changes in env id, enabled flag, or interval.
  }, [activeEnvId, enabled, intervalSec, runHealthCheck]);
}
