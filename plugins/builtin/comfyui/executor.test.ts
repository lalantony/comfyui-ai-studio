/**
 * ComfyUI executor — auto-save + transit-shape contract.
 *
 * Why these tests use module mocks (`vi.mock`):
 *   The real executor opens a WebSocket and hits the ComfyUI HTTP API.
 *   We don't want any of that under test. We DO want the real fs path
 *   (createAsset → blob pool + sidecar) so the multi-stage chain
 *   contract — "downstream gets an AssetRef pointing at a real, listable
 *   asset" — is verified end-to-end at the storage layer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTmpStudioDir } from "@/tests/helpers/tmp-dir";

// vi.mock is hoisted to the top of the file (before *any* imports execute).
// That means anything the mock factories reference must also be hoisted —
// otherwise the factory captures `undefined`. vi.hoisted() is the supported
// way to define values that need to be available at hoist time.
const mocks = vi.hoisted(() => {
  const ENV = {
    id: "env-test",
    name: "test-env",
    baseUrl: "http://comfy.test",
    apiKey: null,
    authMode: "none" as const,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  const ENDPOINT = {
    id: "ep-test",
    environmentId: "env-test",
    name: "test endpoint",
    inputs: [
      {
        studioPort: "prompt",
        label: "Prompt",
        type: "text" as const,
        comfyNodeId: "10",
        comfyInputPath: "text",
        required: true,
      },
    ],
    output: {
      comfyNodeId: "11",
      outputField: "images" as const,
      outputType: "image" as const,
    },
  };
  return {
    ENV,
    ENDPOINT,
    submitPromptMock: vi.fn(),
    openWebSocketMock: vi.fn(),
    getHistoryMock: vi.fn(),
    fetchOutputBytesMock: vi.fn(),
    uploadImageMock: vi.fn(),
    interruptMock: vi.fn(),
  };
});

const {
  submitPromptMock,
  openWebSocketMock,
  getHistoryMock,
  fetchOutputBytesMock,
  uploadImageMock,
} = mocks;
// `ENV`, `ENDPOINT`, `interruptMock` are referenced via the `mocks` object
// from inside the vi.mock factories above; no top-level alias needed.

vi.mock("@/lib/server/providers/comfyui/client", () => {
  return {
    ComfyClient: class {
      submitPrompt = mocks.submitPromptMock;
      openWebSocket = mocks.openWebSocketMock;
      getHistory = mocks.getHistoryMock;
      fetchOutputBytes = mocks.fetchOutputBytesMock;
      uploadImage = mocks.uploadImageMock;
      interrupt = mocks.interruptMock;
    },
    // Use the real-shaped parser so the executor's message handler can
    // dispatch on `event.type` (otherwise it never sees execution_success).
    parseWsMessage: (raw: string) => {
      try {
        const obj = JSON.parse(raw) as { type?: string; data?: unknown };
        if (typeof obj.type !== "string") return null;
        return { type: obj.type, data: obj.data };
      } catch {
        return null;
      }
    },
    debugLog: () => {
      /* no-op in tests */
    },
    HEARTBEAT_INTERVAL_MS: 15_000,
    HEARTBEAT_TIMEOUT_MS: 30_000,
  };
});

vi.mock("@/lib/server/environmentService", () => ({
  getEnvironment: vi.fn(async () => mocks.ENV),
  getActiveEnvironment: vi.fn(async () => mocks.ENV),
}));

vi.mock("@/lib/server/endpointService", () => ({
  getEndpoint: vi.fn(async () => mocks.ENDPOINT),
  getEndpointWorkflowApiJson: vi.fn(async () =>
    JSON.stringify({
      "10": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "11": { class_type: "SaveImage", inputs: {} },
    })
  ),
}));

import { createProject } from "@/lib/server/projectService";
import { listAssets } from "@/lib/server/assetService";
import { getRunOutputsDir } from "@/lib/server/storage";
import type { ExecutorContext } from "@/lib/server/plugins/executorRegistry";
import { executor } from "./executor";
import type { ComfyUINodeData } from "./manifest";

function makeCtx(over: Partial<ExecutorContext>): ExecutorContext {
  const runId = over.runId ?? "run-cfy";
  const projectId = over.projectId ?? null;
  return {
    runId,
    nodeId: "comfyui-1",
    projectId,
    workflowId: "wf-1",
    mode: "test",
    abortSignal: new AbortController().signal,
    outputsDir: getRunOutputsDir(projectId, runId),
    emit: async () => {},
    ...over,
  };
}

const data: ComfyUINodeData = {
  kind: "comfyui",
  label: "ComfyUI",
  endpointId: "ep-test",
  saveToProject: true,
};

describe("ComfyUI executor — transit-shape contract", () => {
  // Fresh STUDIO_DATA_DIR per test so the asset writes don't leak.
  const _tmp = useTmpStudioDir();
  void _tmp;

  beforeEach(() => {
    // Standard happy-path mocks: WS open succeeds and immediately reports
    // execution complete; getHistory returns a single output file; the
    // bytes fetcher returns a fixed PNG buffer.
    submitPromptMock.mockResolvedValue({ prompt_id: "prompt-abc" });
    openWebSocketMock.mockImplementation(async () => {
      // Mock ws-like object whose handlers fire once with execution_success.
      const handlers: Record<string, ((arg?: unknown) => void)[]> = {
        message: [],
        close: [],
        error: [],
      };
      const ws = {
        on: (ev: string, fn: (arg?: unknown) => void) => {
          handlers[ev]?.push(fn);
          // After handlers are wired, fire success synchronously.
          if (ev === "message") {
            queueMicrotask(() => {
              fn(
                JSON.stringify({
                  type: "execution_success",
                  data: { prompt_id: "prompt-abc" },
                })
              );
            });
          }
          return ws;
        },
        close: () => {},
      };
      return ws;
    });
    getHistoryMock.mockResolvedValue({
      status: { completed: true },
      outputs: {
        "11": {
          images: [{ filename: "out.png", subfolder: "", type: "output" }],
        },
      },
    });
    fetchOutputBytesMock.mockResolvedValue({
      buffer: Buffer.from("OUTPUT-BYTES"),
      mime: "image/png",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("project mode + saveToProject=true: returns AssetRef and creates a project asset tagged with producedByNodeId", async () => {
    const project = await createProject({
      id: "proj-cfy-auto",
      name: "P",
      description: "",
      tags: [],
    });

    const result = await executor.execute(
      makeCtx({ projectId: project.id, mode: "project", nodeId: "comfyui-1" }),
      { prompt: "a cat in a hat" },
      data
    );

    const out = result.output as Record<string, unknown>;
    expect(out.assetId).toBeDefined();
    expect(out.projectId).toBe(project.id);
    expect(typeof result.savedAssetId).toBe("string");
    expect(out.bytes).toBeUndefined();

    const all = await listAssets(project.id);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(out.assetId);
    // Auto-save prefixes the filename with the node label + nodeId suffix
    // so multiple ComfyUI stages don't all collide on `out.png`.
    expect(all[0].name).toMatch(/out\.png$/);
    expect(all[0].name).toContain("comfyui");
  });

  it("test mode: returns bytes shape — no project asset is created", async () => {
    const result = await executor.execute(
      makeCtx({ projectId: null, mode: "test" }),
      { prompt: "a cat" },
      data
    );
    const out = result.output as Record<string, unknown>;
    expect(Buffer.isBuffer(out.bytes)).toBe(true);
    expect(out.assetId).toBeUndefined();
    expect(result.savedAssetId).toBeUndefined();
  });

  it("project mode + saveToProject=false: opt-out keeps bytes shape, no auto-save", async () => {
    const project = await createProject({
      id: "proj-cfy-optout",
      name: "P",
      description: "",
      tags: [],
    });

    const result = await executor.execute(
      makeCtx({ projectId: project.id, mode: "project" }),
      { prompt: "a cat" },
      { ...data, saveToProject: false }
    );

    const out = result.output as Record<string, unknown>;
    expect(Buffer.isBuffer(out.bytes)).toBe(true);
    expect(out.assetId).toBeUndefined();
    expect(await listAssets(project.id)).toHaveLength(0);
  });

  it("downstream stage 2: accepts upstream AssetRef on an image binding (multi-stage chain)", async () => {
    const project = await createProject({
      id: "proj-chain",
      name: "P",
      description: "",
      tags: [],
    });
    // Stage 1 ran first → produced an asset.
    const stage1Asset = (
      await import("@/lib/server/assetService")
    ).createAsset(project.id, {
      type: "image",
      name: "stage1.png",
      content: Buffer.from("stage1-bytes"),
      extension: "png",
      source: "workflow",
      workflowRunId: "run-prev",
      producedByNodeId: "comfyui-stage1",
    });
    const upstream = await stage1Asset;

    // Override the endpoint mock to declare an image binding (so we exercise
    // the AssetRef-on-image-handle code path).
    const endpointSvc = await import("@/lib/server/endpointService");
    vi.mocked(endpointSvc.getEndpoint).mockResolvedValueOnce({
      ...mocks.ENDPOINT,
      inputs: [
        {
          studioPort: "image",
          label: "Image",
          type: "image",
          comfyNodeId: "10",
          comfyInputPath: "image",
          required: true,
        },
      ],
    } as unknown as Awaited<ReturnType<typeof endpointSvc.getEndpoint>>);

    uploadImageMock.mockResolvedValueOnce({ name: "uploaded-stage1.png" });

    const result = await executor.execute(
      makeCtx({ projectId: project.id, mode: "project", nodeId: "comfyui-2" }),
      { image: { assetId: upstream.id, projectId: project.id, type: "image" } },
      data
    );

    // The executor uploaded the upstream asset's bytes to ComfyUI...
    expect(uploadImageMock).toHaveBeenCalledTimes(1);
    expect(uploadImageMock.mock.calls[0][0].toString("utf8")).toBe("stage1-bytes");

    // ...and returned an AssetRef for stage 2's output (which is now also
    // saved as a project asset, alongside stage 1).
    const out = result.output as Record<string, unknown>;
    expect(out.assetId).toBeDefined();
    expect(out.assetId).not.toBe(upstream.id);
    expect(await listAssets(project.id)).toHaveLength(2);
  });

  it("audio output is mapped from ComfyEndpoint 'audio' to Asset 'music'", async () => {
    const project = await createProject({
      id: "proj-audio",
      name: "P",
      description: "",
      tags: [],
    });

    const endpointSvc = await import("@/lib/server/endpointService");
    vi.mocked(endpointSvc.getEndpoint).mockResolvedValueOnce({
      ...mocks.ENDPOINT,
      output: { ...mocks.ENDPOINT.output, outputType: "audio" },
    } as unknown as Awaited<ReturnType<typeof endpointSvc.getEndpoint>>);

    fetchOutputBytesMock.mockResolvedValueOnce({
      buffer: Buffer.from("AUDIO"),
      mime: "audio/mpeg",
    });
    getHistoryMock.mockResolvedValueOnce({
      status: { completed: true },
      outputs: {
        "11": {
          images: [{ filename: "out.mp3", subfolder: "", type: "output" }],
        },
      },
    });

    const result = await executor.execute(
      makeCtx({ projectId: project.id, mode: "project" }),
      { prompt: "a song" },
      data
    );

    const out = result.output as Record<string, unknown>;
    expect(out.type).toBe("music");
    const all = await listAssets(project.id);
    expect(all[0].type).toBe("music");
  });

  it("rejects an image binding that received a string (e.g. Text Input wired into image handle)", async () => {
    const project = await createProject({
      id: "proj-misw",
      name: "P",
      description: "",
      tags: [],
    });

    const endpointSvc = await import("@/lib/server/endpointService");
    vi.mocked(endpointSvc.getEndpoint).mockResolvedValueOnce({
      ...mocks.ENDPOINT,
      inputs: [
        {
          studioPort: "image",
          label: "Image",
          type: "image",
          comfyNodeId: "10",
          comfyInputPath: "image",
          required: true,
        },
      ],
    } as unknown as Awaited<ReturnType<typeof endpointSvc.getEndpoint>>);

    await expect(
      executor.execute(
        makeCtx({ projectId: project.id, mode: "project" }),
        { image: "this is text not an image" },
        data
      )
    ).rejects.toThrow(/expected a image asset reference/);
  });
});

// ---- WS hang scenarios + diagnostics ----
//
// These cover the failure modes that motivated the rewrite: the WS goes
// silent (Windows zombie socket) but ComfyUI did finish; both signals
// stay silent and the hard timeout has to fire; mid-run cancel triggers
// `/interrupt`. The polling/timeout paths use small intervals via the
// test-only setters so the tests don't sit on real-world timeouts.
describe("ComfyUI executor — WS hang + cancellation + run.log", () => {
  const _tmp = useTmpStudioDir();
  void _tmp;

  beforeEach(async () => {
    const exec = await import("./executor");
    exec.__setHistoryPollIntervalForTests(20);
    exec.__setMinRunTimeoutForTests(0);
    submitPromptMock.mockResolvedValue({ prompt_id: "prompt-hang" });
    fetchOutputBytesMock.mockResolvedValue({
      buffer: Buffer.from("OUT"),
      mime: "image/png",
    });
    getHistoryMock.mockResolvedValue({
      status: { completed: true },
      outputs: {
        "11": { images: [{ filename: "out.png", subfolder: "", type: "output" }] },
      },
    });
    // The executor calls `client.interrupt().catch(...)` — make sure the
    // mock returns a Promise so .catch is available.
    mocks.interruptMock.mockResolvedValue(undefined);
    // WS that opens but never delivers any messages — simulates the
    // zombie-socket case. Tests can override per-test.
    openWebSocketMock.mockImplementation(async () => {
      const ws = {
        on: () => ws,
        close: () => {},
      };
      return ws;
    });
  });

  afterEach(async () => {
    const exec = await import("./executor");
    exec.__resetTunablesForTests();
    vi.clearAllMocks();
  });

  it("polling fallback: silent WS + history.completed=true → executor resolves via polling", async () => {
    const result = await executor.execute(
      makeCtx({
        runId: "run-poll",
        projectId: null,
        mode: "test",
      }),
      { prompt: "a cat" },
      data
    );
    // Result is bytes-shaped (test mode); the executor only got here because
    // polling won the race over a silent WS.
    const out = result.output as Record<string, unknown>;
    expect(Buffer.isBuffer(out.bytes)).toBe(true);
  });

  it("hard timeout: silent WS + status.completed=false → throws timeout error after env.runTimeoutSec", async () => {
    // History never reports completion.
    getHistoryMock.mockResolvedValue({
      status: { completed: false },
      outputs: {},
    });
    const envSvc = await import("@/lib/server/environmentService");
    vi.mocked(envSvc.getEnvironment).mockResolvedValueOnce({
      ...mocks.ENV,
      runTimeoutSec: 1, // 1 second hard ceiling for the test
    } as unknown as Awaited<ReturnType<typeof envSvc.getEnvironment>>);
    vi.mocked(envSvc.getActiveEnvironment).mockResolvedValueOnce({
      ...mocks.ENV,
      runTimeoutSec: 1,
    } as unknown as Awaited<ReturnType<typeof envSvc.getActiveEnvironment>>);

    await expect(
      executor.execute(
        makeCtx({ runId: "run-timeout", projectId: null, mode: "test" }),
        { prompt: "a cat" },
        data
      )
    ).rejects.toThrow(/exceeded timeout/);
  });

  it("ctx.abortSignal mid-run: fires /interrupt and rejects with Cancelled", async () => {
    // History never completes — keeps polling losing the race so the abort
    // path actually wins.
    getHistoryMock.mockResolvedValue({
      status: { completed: false },
      outputs: {},
    });

    const ctrl = new AbortController();
    // Trip the abort after 5ms — before polling+timeout can resolve.
    setTimeout(() => ctrl.abort(), 5);
    const interruptCalls = mocks.interruptMock;

    await expect(
      executor.execute(
        {
          ...makeCtx({ runId: "run-cancel", projectId: null, mode: "test" }),
          abortSignal: ctrl.signal,
        },
        { prompt: "a cat" },
        data
      )
    ).rejects.toThrow(/Cancelled/);
    expect(interruptCalls).toHaveBeenCalled();
  });

  it("emits run.log events for prompt submit + completion path", async () => {
    const logs: Array<{ level: string; message: string; nodeId?: string }> = [];
    // WS that delivers execution_success synchronously, so completion is fast.
    openWebSocketMock.mockImplementation(async () => {
      const ws = {
        on: (ev: string, fn: (arg?: unknown) => void) => {
          if (ev === "message") {
            queueMicrotask(() => {
              fn(
                JSON.stringify({
                  type: "execution_success",
                  data: { prompt_id: "prompt-hang" },
                })
              );
            });
          }
          return ws;
        },
        close: () => {},
      };
      return ws;
    });

    await executor.execute(
      {
        ...makeCtx({ runId: "run-log", projectId: null, mode: "test" }),
        emit: async (event) => {
          if (event.type === "run.log") {
            logs.push({
              level: event.level,
              message: event.message,
              nodeId: event.nodeId,
            });
          }
        },
      },
      { prompt: "a cat" },
      data
    );

    // We expect at minimum: "using endpoint", "prompt submitted", a
    // completion-path log line, and "test output written".
    const messages = logs.map((l) => l.message);
    expect(messages.some((m) => m.includes("using endpoint"))).toBe(true);
    expect(messages.some((m) => m.includes("prompt submitted"))).toBe(true);
    expect(messages.some((m) => m.includes("completion observed via"))).toBe(true);
    expect(messages.some((m) => m.includes("test output written"))).toBe(true);
    // All log lines must carry the source nodeId.
    expect(logs.every((l) => l.nodeId === "comfyui-1")).toBe(true);
  });

  it("WS reconnect: closes mid-run → opens a fresh socket → completes via reconnected WS", async () => {
    let openCallCount = 0;
    openWebSocketMock.mockImplementation(async () => {
      openCallCount += 1;
      const isFirst = openCallCount === 1;
      const ws = {
        on: (ev: string, fn: (arg?: unknown) => void) => {
          if (isFirst && ev === "close") {
            // First socket dies as soon as the executor finishes wiring
            // up handlers — simulates the WinError 10054 / proxy-kill
            // case the reconnect feature exists for.
            queueMicrotask(() => fn());
          }
          if (!isFirst && ev === "message") {
            // Reconnected socket delivers execution_success on the next tick.
            queueMicrotask(() => {
              fn(
                JSON.stringify({
                  type: "execution_success",
                  data: { prompt_id: "prompt-hang" },
                })
              );
            });
          }
          return ws;
        },
        close: () => {},
        removeAllListeners: () => {},
      };
      return ws;
    });

    // Polling interval long enough that the WS reconnect path wins the race —
    // reconnect happens in microseconds via queueMicrotask, polling waits 2s.
    const exec = await import("./executor");
    exec.__setHistoryPollIntervalForTests(2_000);

    // getHistory is invoked AFTER waitForCompletion resolves to fetch the
    // output binary refs. Reuse the beforeEach setup which returns the
    // happy-path payload — both polling (if it fired) and the post-
    // completion fetch see the same shape.
    const logs: Array<{ level: string; message: string }> = [];

    await executor.execute(
      {
        ...makeCtx({ runId: "run-reconnect", projectId: null, mode: "test" }),
        emit: async (event) => {
          if (event.type === "run.log") {
            logs.push({ level: event.level, message: event.message });
          }
        },
      },
      { prompt: "a cat" },
      data
    );

    expect(openCallCount).toBe(2);
    const messages = logs.map((l) => l.message);
    expect(messages.some((m) => /one-shot reconnect/.test(m))).toBe(true);
    expect(messages.some((m) => /WS reconnected/.test(m))).toBe(true);
    expect(messages.some((m) => /completion observed via websocket/.test(m))).toBe(true);
  });
});
