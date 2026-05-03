/**
 * Environment store — owns ComfyUI environments + their live health snapshots.
 *
 * The CRUD path is API-backed (`/api/comfy/environments/...`). After every
 * write, `loadEnvironments()` re-pulls so the UI reflects the persisted
 * single-active invariant from the server.
 *
 * Health monitoring is split: `runHealthCheck(envId)` does one probe and
 * stores the result in `healthSnapshots[envId]`. The `useHealthMonitor`
 * hook (mounted by `StatusCards`) drives the polling loop. Concurrent
 * calls for the same env id are deduped via `probingEnvIds`.
 */
"use client";

import { create } from "zustand";
import { ComfyEndpoint, ComfyUIEnvironment, HealthSnapshot } from "@/types";

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface EnvironmentState {
  environments: ComfyUIEnvironment[];
  loadStatus: LoadStatus;
  loadError: string | null;
  /** Latest health probe per environment id. Not persisted across refreshes — re-fetched on first poll. */
  healthSnapshots: Record<string, HealthSnapshot>;
  /** envIds with a probe currently in-flight (used to dedupe overlapping calls). */
  probingEnvIds: Set<string>;
  /**
   * Endpoint cache, keyed by environment id. Populated by ComfyUI nodes when
   * they fetch their endpoint list — consumed by the canvas's connection
   * validator so dynamic handle types can be resolved synchronously.
   */
  endpointsByEnv: Record<string, ComfyEndpoint[]>;

  loadEnvironments: () => Promise<void>;
  createEnvironment: (input: CreateEnvInput) => Promise<ComfyUIEnvironment>;
  updateEnvironment: (id: string, patch: Partial<ComfyUIEnvironment>) => Promise<ComfyUIEnvironment>;
  removeEnvironment: (id: string) => Promise<void>;
  setActive: (id: string) => Promise<void>;
  /** Hit /api/comfy/environments/[id]/health and store the snapshot. Concurrent calls for the same id no-op. */
  runHealthCheck: (id: string) => Promise<HealthSnapshot | null>;
  /** Cache the endpoints fetched for an environment. Called by ComfyUI nodes after their fetch resolves. */
  setEndpointsForEnv: (envId: string, endpoints: ComfyEndpoint[]) => void;
  /** Look up a single endpoint by id across all cached envs. Returns undefined if not yet cached. */
  findCachedEndpoint: (endpointId: string) => ComfyEndpoint | undefined;
}

export interface CreateEnvInput {
  name: string;
  type: ComfyUIEnvironment["type"];
  baseUrl: string;
  authMode?: ComfyUIEnvironment["authMode"];
  apiKey?: string;
  healthCheckEnabled?: boolean;
  healthCheckIntervalSec?: number;
  runTimeoutSec?: number;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${message}`);
  }
  return (await res.json()) as T;
}

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  environments: [],
  loadStatus: "idle",
  loadError: null,
  healthSnapshots: {},
  probingEnvIds: new Set<string>(),
  endpointsByEnv: {},

  loadEnvironments: async () => {
    if (get().loadStatus === "loading") return;
    set({ loadStatus: "loading", loadError: null });
    try {
      const { environments } = await fetchJson<{ environments: ComfyUIEnvironment[] }>(
        "/api/comfy/environments"
      );
      set({ environments, loadStatus: "ready" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load environments";
      set({ loadStatus: "error", loadError: message });
    }
  },

  createEnvironment: async (input) => {
    const { environment } = await fetchJson<{ environment: ComfyUIEnvironment }>(
      "/api/comfy/environments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
    await get().loadEnvironments();
    return environment;
  },

  updateEnvironment: async (id, patch) => {
    const { environment } = await fetchJson<{ environment: ComfyUIEnvironment }>(
      `/api/comfy/environments/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    await get().loadEnvironments();
    return environment;
  },

  removeEnvironment: async (id) => {
    await fetchJson<{ ok: true }>(
      `/api/comfy/environments/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    // Drop any cached snapshot for the removed env.
    set((state) => {
      const next = { ...state.healthSnapshots };
      delete next[id];
      return { healthSnapshots: next };
    });
    await get().loadEnvironments();
  },

  setActive: async (id) => {
    await fetchJson<{ environment: ComfyUIEnvironment }>(
      `/api/comfy/environments/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setActive: true }),
      }
    );
    await get().loadEnvironments();
  },

  runHealthCheck: async (id) => {
    const probing = get().probingEnvIds;
    if (probing.has(id)) return null;
    const nextSet = new Set(probing);
    nextSet.add(id);
    // Mark "checking" so the UI shows the spinner immediately.
    set((state) => ({
      probingEnvIds: nextSet,
      healthSnapshots: {
        ...state.healthSnapshots,
        [id]: {
          ...(state.healthSnapshots[id] ?? {
            envId: id,
            latencyMs: null,
            ramPct: null,
            vramPct: null,
            cpuPct: null,
            diskFreePct: null,
            diskFreeGb: null,
            deviceName: null,
            queueRemaining: null,
            comfyVersion: null,
          }),
          envId: id,
          status: "checking",
          lastChecked: new Date().toISOString(),
        },
      },
    }));
    try {
      const { snapshot } = await fetchJson<{ snapshot: HealthSnapshot }>(
        `/api/comfy/environments/${encodeURIComponent(id)}/health`,
        { method: "POST" }
      );
      set((state) => ({
        healthSnapshots: { ...state.healthSnapshots, [id]: snapshot },
      }));
      return snapshot;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Probe failed";
      const snapshot: HealthSnapshot = {
        envId: id,
        status: "disconnected",
        lastChecked: new Date().toISOString(),
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
      set((state) => ({
        healthSnapshots: { ...state.healthSnapshots, [id]: snapshot },
      }));
      return snapshot;
    } finally {
      set((state) => {
        const updated = new Set(state.probingEnvIds);
        updated.delete(id);
        return { probingEnvIds: updated };
      });
    }
  },

  setEndpointsForEnv: (envId, endpoints) => {
    set((state) => ({
      endpointsByEnv: { ...state.endpointsByEnv, [envId]: endpoints },
    }));
  },

  findCachedEndpoint: (endpointId) => {
    const map = get().endpointsByEnv;
    for (const list of Object.values(map)) {
      const found = list.find((e) => e.id === endpointId);
      if (found) return found;
    }
    return undefined;
  },
}));
