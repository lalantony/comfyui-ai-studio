import "server-only";

/**
 * Per-key FIFO queue. Project runs key on `project:<projectId>` so per-project sequencing
 * is preserved; test runs key on `test` so they serialize amongst themselves but don't
 * block (or get blocked by) project runs.
 *
 * Different keys run in parallel.
 */

interface KeyedQueue {
  pending: Array<() => Promise<void>>;
  draining: boolean;
}

const queues = new Map<string, KeyedQueue>();

export function enqueue(key: string, runFn: () => Promise<void>): void {
  let q = queues.get(key);
  if (!q) {
    q = { pending: [], draining: false };
    queues.set(key, q);
  }
  q.pending.push(runFn);
  if (!q.draining) {
    void drain(key);
  }
}

async function drain(key: string): Promise<void> {
  const q = queues.get(key);
  if (!q) return;
  q.draining = true;
  try {
    while (q.pending.length > 0) {
      const next = q.pending.shift();
      if (!next) break;
      try {
        await next();
      } catch (err) {
        console.error(`[queue][${key}] run threw`, err);
      }
    }
  } finally {
    q.draining = false;
    if (q.pending.length === 0) {
      queues.delete(key);
    }
  }
}

export function pendingCount(key: string): number {
  return queues.get(key)?.pending.length ?? 0;
}

export function queueKeyForRun(projectId: string | null): string {
  return projectId === null ? "test" : `project:${projectId}`;
}
