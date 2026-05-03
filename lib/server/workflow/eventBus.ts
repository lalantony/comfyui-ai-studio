import "server-only";

import { RunEvent } from "@/types";

/**
 * In-memory pub/sub keyed by runId. Survives the lifetime of the Node process.
 *
 * Subscribers receive events as they're emitted; for catch-up after disconnect/reload
 * the SSE handler reads events.ndjson from disk first, *then* subscribes here.
 */

type Subscriber = (event: RunEvent) => void;

const buses = new Map<string, Set<Subscriber>>();

export function subscribe(runId: string, sub: Subscriber): () => void {
  let set = buses.get(runId);
  if (!set) {
    set = new Set();
    buses.set(runId, set);
  }
  set.add(sub);
  return () => {
    const current = buses.get(runId);
    if (!current) return;
    current.delete(sub);
    if (current.size === 0) buses.delete(runId);
  };
}

export function emit(runId: string, event: RunEvent): void {
  const set = buses.get(runId);
  if (!set) return;
  // Iterate over a copy so subscribers can unsubscribe inside their handler without skipping.
  for (const sub of Array.from(set)) {
    try {
      sub(event);
    } catch (err) {
      // Subscriber failures should never break the runtime
      console.error("[eventBus] subscriber threw", err);
    }
  }
}

export function clear(runId: string): void {
  buses.delete(runId);
}
