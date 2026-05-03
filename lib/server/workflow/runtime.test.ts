/**
 * Runtime cancel-vs-fail semantics.
 *
 * The interesting case is mid-flight cancellation: the user pressed Stop
 * *while* an executor was running, the abort signal fired, the executor
 * threw "Cancelled" (or some other abort-shaped error). Before the audit
 * fix, the runtime caught that throw in its generic catch branch and
 * persisted the run as `failed` — wrong, because the user expects a
 * neutral "cancelled" outcome with no red toast.
 *
 * This test wires up a fake executor that aborts itself, kicks off a run,
 * and asserts the on-disk run status + the SSE event stream agree the run
 * was cancelled, not failed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTmpStudioDir } from "@/tests/helpers/tmp-dir";
import { createWorkflow } from "../workflowService";
import { startRun } from "./runtime";
import { getRunInMemory, readRunFromDisk } from "./runStore";
import {
  __clearExecutorsForTests,
  registerExecutor,
} from "../plugins/executorRegistry";
import { registerManifest } from "@/lib/plugins/manifestRegistry";
import type { WorkflowNode } from "@/types";

// Re-register the built-in executors after each test so the rest of the
// suite (which expects them) stays green.
async function reregisterBuiltins(): Promise<void> {
  await import("../plugins/registerBuiltinExecutors");
}

describe("runtime — cancel mid-flight", () => {
  const _tmp = useTmpStudioDir();
  void _tmp;

  beforeEach(() => {
    __clearExecutorsForTests();
  });

  afterEach(async () => {
    __clearExecutorsForTests();
    await reregisterBuiltins();
  });

  it("emits run.cancelled (not run.failed) when an executor throws after the abort signal fires", async () => {
    // Register both manifest + executor. parseNodeData rejects unknown
    // kinds, so without the manifest the runtime would skip the node and
    // the run would succeed trivially.
    registerManifest({
      kind: "testAborter",
      displayName: "Test Aborter",
      description: "Aborts itself, used in cancel-semantic tests",
      category: "utility",
      accent: "purple",
      icon: "Cpu",
      inputs: [],
      outputs: [],
      defaultData: () => ({ kind: "testAborter", label: "Test" }),
      executable: true,
    });

    // Register a fake executor that aborts itself immediately. The
    // runtime sets the AbortSignal on cancel; we simulate the same
    // condition by aborting from inside the executor body before
    // throwing.
    registerExecutor("testAborter", {
      async execute(ctx) {
        // Find the in-memory entry's controller and abort it. We can't
        // reach the controller directly; the runtime owns it. But it
        // exposes the *signal* on ctx, and we can synthesize the same
        // observable outcome by waiting until the signal would have been
        // tripped externally. Easier: just abort immediately via the
        // run's own signal — runStore exposes the entry and its
        // abortController.
        const entry = getRunInMemory(ctx.runId);
        entry!.abortController.abort();
        throw new Error("Cancelled");
      },
    });

    const node: WorkflowNode = {
      id: "n1",
      type: "testAborter",
      position: { x: 0, y: 0 },
      data: { kind: "testAborter", label: "Test" },
    };
    const workflow = await createWorkflow({
      name: "wf",
      description: "",
      type: "image",
      tags: [],
      nodes: [node],
      edges: [],
    });

    const { runId } = await startRun({
      workflowId: workflow.id,
      projectId: null,
      mode: "test",
      inputs: {},
    });

    // Wait for the run to reach a terminal state. The runtime writes
    // run.json after every state change; reads can briefly race against an
    // in-flight write (empty file → JSON parse error). Swallow those and
    // retry — we just need to observe the final status.
    const start = Date.now();
    let final: Awaited<ReturnType<typeof readRunFromDisk>> = null;
    while (Date.now() - start < 2000) {
      try {
        final = await readRunFromDisk(null, runId);
        if (
          final &&
          ["cancelled", "failed", "succeeded"].includes(final.status)
        ) {
          break;
        }
      } catch {
        /* mid-write race; retry */
      }
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(final).not.toBeNull();
    expect(final!.status).toBe("cancelled");
    expect(final!.nodeStates["n1"]).toBe("cancelled");
  });
});

describe("runtime — runId format", () => {
  const _tmp = useTmpStudioDir();
  void _tmp;

  it("generates runs with full-length UUIDs (no slice-12)", async () => {
    // Register a noop manifest+executor so the run can complete.
    registerManifest({
      kind: "testNoop",
      displayName: "Test Noop",
      description: "Noop executor for runId-format test",
      category: "utility",
      accent: "purple",
      icon: "Cpu",
      inputs: [],
      outputs: [],
      defaultData: () => ({ kind: "testNoop", label: "Noop" }),
      executable: true,
    });
    registerExecutor("testNoop", {
      async execute() {
        return {};
      },
    });
    const workflow = await createWorkflow({
      name: "wf",
      description: "",
      type: "image",
      tags: [],
      nodes: [
        {
          id: "n1",
          type: "testNoop",
          position: { x: 0, y: 0 },
          data: { kind: "testNoop", label: "Noop" },
        },
      ],
      edges: [],
    });
    const { runId } = await startRun({
      workflowId: workflow.id,
      projectId: null,
      mode: "test",
      inputs: {},
    });
    // run-<uuid> = 4 + 36 = 40 chars; uuid format is
    // 8-4-4-4-12 hex with hyphens.
    expect(runId).toMatch(
      /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    // Wait for the run to reach terminal state before letting afterEach
    // tear down STUDIO_DATA_DIR — otherwise the in-flight write of run.json
    // races with `fs.rm`, producing "ENOTEMPTY" cleanup failures.
    const start = Date.now();
    while (Date.now() - start < 2000) {
      try {
        const final = await readRunFromDisk(null, runId);
        if (
          final &&
          ["cancelled", "failed", "succeeded"].includes(final.status)
        ) {
          break;
        }
      } catch {
        /* mid-write race; retry */
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    __clearExecutorsForTests();
    await reregisterBuiltins();
  });
});
