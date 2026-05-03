import { describe, expect, it } from "vitest";
import { enqueue, pendingCount, queueKeyForRun } from "./queue";

/**
 * Tiny helper: a deferred promise that resolves when `resolve()` is called.
 * Used to control execution timing so we can assert serialization without
 * relying on `setTimeout`.
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Yield to the microtask queue. Use after enqueue() to let the drain loop start. */
const tick = () => new Promise<void>((r) => setImmediate(r));

describe("queueKeyForRun", () => {
  it("returns 'test' for null projectId", () => {
    expect(queueKeyForRun(null)).toBe("test");
  });

  it("returns 'project:<id>' for a real project", () => {
    expect(queueKeyForRun("abc")).toBe("project:abc");
  });
});

describe("enqueue / drain", () => {
  it("runs a single function to completion", async () => {
    let ran = false;
    enqueue("k1", async () => {
      ran = true;
    });
    await tick();
    await tick();
    expect(ran).toBe(true);
  });

  it("serializes runs on the same key (FIFO)", async () => {
    const order: number[] = [];
    const d1 = deferred();
    const d2 = deferred();

    enqueue("same", async () => {
      order.push(1);
      await d1.promise;
    });
    enqueue("same", async () => {
      order.push(2);
      await d2.promise;
    });

    await tick();
    expect(order).toEqual([1]); // second hasn't started — it's pending
    expect(pendingCount("same")).toBe(1);

    d1.resolve();
    await tick();
    await tick();
    expect(order).toEqual([1, 2]);

    d2.resolve();
    await tick();
    expect(pendingCount("same")).toBe(0);
  });

  it("runs different keys in parallel", async () => {
    const order: string[] = [];
    const dA = deferred();
    const dB = deferred();

    enqueue("a", async () => {
      order.push("a-start");
      await dA.promise;
      order.push("a-end");
    });
    enqueue("b", async () => {
      order.push("b-start");
      await dB.promise;
      order.push("b-end");
    });

    await tick();
    expect(order).toEqual(["a-start", "b-start"]); // both started
  });

  it("survives a thrown function and drains the next one", async () => {
    let secondRan = false;
    enqueue("err", async () => {
      throw new Error("boom");
    });
    enqueue("err", async () => {
      secondRan = true;
    });

    await tick();
    await tick();
    await tick();
    expect(secondRan).toBe(true);
  });

  it("removes the queue entry when fully drained", async () => {
    enqueue("once", async () => {
      /* noop */
    });
    await tick();
    await tick();
    expect(pendingCount("once")).toBe(0);
  });
});
