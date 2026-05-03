/**
 * runStore + eventBus seq-stamp + SSE-style consumption.
 *
 * The bug we're guarding against: events emitted between a consumer's
 * disk-read and bus-subscribe were silently dropped. The fix stamps each
 * event with a monotonic `_seq` so a consumer can subscribe-first, read
 * disk, send disk events, then drain the live buffer skipping anything it
 * already saw via disk.
 *
 * These tests reproduce the race shape in-memory, then assert exactly-once
 * delivery with the sequence-number dedup.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTmpStudioDir } from "@/tests/helpers/tmp-dir";
import {
  __resetSeqForTests,
  emitEvent,
  initRun,
  readEventsFromDisk,
} from "./runStore";
import * as eventBus from "./eventBus";
import type { RunEvent, WorkflowRun } from "@/types";

function makeRun(): WorkflowRun {
  return {
    id: "run-seq-test",
    workflowId: "wf-1",
    projectId: null,
    mode: "test",
    status: "queued",
    inputs: {},
    startedAt: new Date().toISOString(),
    outputAssetIds: [],
    nodeStates: {},
  };
}

describe("runStore — seq stamping + dedup", () => {
  const _tmp = useTmpStudioDir();
  void _tmp;

  beforeEach(() => {
    __resetSeqForTests();
  });

  afterEach(() => {
    eventBus.clear("run-seq-test");
  });

  it("stamps every emitted event with a monotonically increasing _seq", async () => {
    await initRun(makeRun());
    await emitEvent("run-seq-test", {
      type: "node.started",
      runId: "run-seq-test",
      nodeId: "n1",
    });
    await emitEvent("run-seq-test", {
      type: "node.completed",
      runId: "run-seq-test",
      nodeId: "n1",
    });
    await emitEvent("run-seq-test", {
      type: "node.started",
      runId: "run-seq-test",
      nodeId: "n2",
    });

    const past = await readEventsFromDisk(null, "run-seq-test");
    const seqs = past.map((e) => (e as { _seq?: number })._seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it("subscribe-first → read-disk → drain-buffered yields exactly-once delivery in race", async () => {
    await initRun(makeRun());

    // Pre-load a few events so readEventsFromDisk has prior history.
    await emitEvent("run-seq-test", {
      type: "node.started",
      runId: "run-seq-test",
      nodeId: "n1",
    });
    await emitEvent("run-seq-test", {
      type: "node.completed",
      runId: "run-seq-test",
      nodeId: "n1",
    });

    // Now simulate the SSE handler shape: subscribe FIRST, buffer,
    // read disk, drain buffer with seq dedup.
    const seenSeq = new Set<number>();
    const delivered: RunEvent[] = [];
    let buffered: RunEvent[] | null = [];

    const unsubscribe = eventBus.subscribe("run-seq-test", (event) => {
      if (buffered !== null) {
        buffered.push(event);
        return;
      }
      const seq = (event as { _seq?: number })._seq;
      if (typeof seq === "number" && seenSeq.has(seq)) return;
      if (typeof seq === "number") seenSeq.add(seq);
      delivered.push(event);
    });

    // Simulate the canonical race: an event lands AFTER subscribe but
    // BEFORE we read the file. Both the file (which already has it after
    // appendFile resolves) and the bus (subscriber buffered it) carry the
    // same event — exactly the case dedup must handle.
    await emitEvent("run-seq-test", {
      type: "node.started",
      runId: "run-seq-test",
      nodeId: "n2",
    });

    // Read disk — file now has events 1, 2, 3 (and the one above which
    // also appended; file flush is awaited inside emitEvent).
    const past = await readEventsFromDisk(null, "run-seq-test");
    for (const ev of past) {
      const seq = (ev as { _seq?: number })._seq;
      if (typeof seq === "number") seenSeq.add(seq);
      delivered.push(ev);
    }

    // Drain buffered with dedup.
    const toFlush = buffered;
    buffered = null;
    for (const ev of toFlush) {
      const seq = (ev as { _seq?: number })._seq;
      if (typeof seq === "number" && seenSeq.has(seq)) continue;
      if (typeof seq === "number") seenSeq.add(seq);
      delivered.push(ev);
    }

    // After the race + dedup, the consumer has received each event
    // exactly once, in seq order.
    const seqs = delivered.map((e) => (e as { _seq?: number })._seq);
    expect(seqs).toEqual([1, 2, 3]);
    expect(delivered).toHaveLength(3);

    // Subsequent events still flow live without duplication.
    await emitEvent("run-seq-test", {
      type: "run.completed",
      runId: "run-seq-test",
      outputAssetIds: [],
    });
    expect(delivered.map((e) => (e as { _seq?: number })._seq)).toEqual([1, 2, 3, 4]);
    unsubscribe();
  });

  it("a fast back-to-back start/completed pair is fully delivered (the original symptom)", async () => {
    await initRun(makeRun());

    // Subscribe FIRST.
    const seenSeq = new Set<number>();
    const delivered: RunEvent[] = [];
    let buffered: RunEvent[] | null = [];
    eventBus.subscribe("run-seq-test", (event) => {
      if (buffered !== null) {
        buffered.push(event);
        return;
      }
      const seq = (event as { _seq?: number })._seq;
      if (typeof seq === "number" && seenSeq.has(seq)) return;
      if (typeof seq === "number") seenSeq.add(seq);
      delivered.push(event);
    });

    // Fire node.started + node.completed back-to-back — the case that was
    // dropping `node.completed` before the fix.
    await emitEvent("run-seq-test", {
      type: "node.started",
      runId: "run-seq-test",
      nodeId: "text-1",
    });
    await emitEvent("run-seq-test", {
      type: "node.completed",
      runId: "run-seq-test",
      nodeId: "text-1",
    });

    // Read disk + drain buffer (the SSE-route shape).
    const past = await readEventsFromDisk(null, "run-seq-test");
    for (const ev of past) {
      const seq = (ev as { _seq?: number })._seq;
      if (typeof seq === "number") seenSeq.add(seq);
      delivered.push(ev);
    }
    const toFlush = buffered;
    buffered = null;
    for (const ev of toFlush) {
      const seq = (ev as { _seq?: number })._seq;
      if (typeof seq === "number" && seenSeq.has(seq)) continue;
      if (typeof seq === "number") seenSeq.add(seq);
      delivered.push(ev);
    }

    // Both events are delivered, exactly once each.
    const types = delivered.map((e) => e.type);
    expect(types.filter((t) => t === "node.started")).toHaveLength(1);
    expect(types.filter((t) => t === "node.completed")).toHaveLength(1);
  });
});
