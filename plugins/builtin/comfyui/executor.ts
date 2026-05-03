/**
 * ComfyUI executor — runs one ComfyUI node by submitting its endpoint's
 * `workflow_api.json` to the active ComfyUI server.
 *
 * Lifecycle (must keep in this order):
 *   1. Resolve endpoint + active environment.
 *   2. Apply input bindings: write user values into the patched prompt JSON.
 *      Image inputs are uploaded to ComfyUI first; the returned filename
 *      is what gets written into the prompt.
 *   3. Open WebSocket BEFORE submitting `/prompt` — otherwise we'd race
 *      with `execution_start` and miss progress on fast graphs.
 *   4. Submit prompt; race three completion signals to handle long /
 *      flaky / video runs gracefully:
 *        a. WS `execution_success` / `executing { node: null }`
 *        b. `getHistory(promptId).status.completed === true` (polled every 5s)
 *        c. Hard `runTimeoutSec` ceiling (env-configurable; default 30 min)
 *      Whichever fires first resolves; the losers are torn down.
 *   5. On success, fetch outputs via `/history` + `/view`.
 *
 * Why race instead of WS-only: long sampling runs (200s+ video) can leave
 * the WebSocket idle long enough that intermediate kernels / firewalls /
 * Defender silently kill the socket. ComfyUI then writes `execution_success`
 * to a dead socket — we never observe close, never observe success, and
 * `waitForCompletionViaWs` hangs forever. Polling getHistory in parallel
 * catches that case in 5s.
 *
 * Cancellation: if `ctx.abortSignal` fires mid-run, fire `/interrupt` to
 * free the GPU. Any of the three racing paths can win the cancellation.
 *
 * Diagnostics: at every meaningful state transition this executor emits a
 * `run.log` SSE event (level: debug | info | warn | error). The test panel
 * surfaces these in an Activity Log card so users can copy-paste a full
 * timeline when reporting issues.
 */
import "server-only";

import path from "node:path";
import fs from "node:fs/promises";
import type WS from "ws";
import type {
  Asset,
  ComfyEndpoint,
  ComfyEndpointInput,
  ComfyUIEnvironment,
  NodePreview,
  RunEvent,
} from "@/types";
import type { NodeExecutor } from "@/lib/server/plugins/executorRegistry";
import {
  ComfyClient,
  NodeOutput,
  debugLog,
  parseWsMessage,
} from "@/lib/server/providers/comfyui/client";
import { getEndpoint, getEndpointWorkflowApiJson } from "@/lib/server/endpointService";
import { getEnvironment, getActiveEnvironment } from "@/lib/server/environmentService";
import { createAsset, getAssetBinary } from "@/lib/server/assetService";
import { recountProject } from "@/lib/server/projectService";
import { ensureDir } from "@/lib/server/storage";
import type { ComfyUINodeData } from "./manifest";

// ---- Tunables ----
//
// Defaults are sized for real ComfyUI workloads: 30 min covers most video
// runs with margin; 5s polling is short enough to recover quickly when WS
// dies but cheap enough that a working chain doesn't hammer ComfyUI.

const DEFAULT_RUN_TIMEOUT_SEC = 30 * 60;
const MIN_RUN_TIMEOUT_SEC = 60;
const MAX_RUN_TIMEOUT_SEC = 2 * 60 * 60;
let HISTORY_POLL_INTERVAL_MS = 5_000;
let MIN_RUN_TIMEOUT_SEC_OVERRIDE = MIN_RUN_TIMEOUT_SEC;

// All three setters below are test-only by contract. We additionally guard
// them at runtime so a stray import from production code can't override
// production tunables — Vitest sets NODE_ENV=test, so tests still work.
function assertTestEnv(fn: string): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(`${fn} is test-only and must not be called outside the test runner`);
  }
}

/** TEST-ONLY: override the history-poll interval. Lets the WS-hang tests
 * exercise the fallback path without 5s real-time waits. Reset to default
 * with `__resetTunablesForTests()`. */
export function __setHistoryPollIntervalForTests(ms: number): void {
  assertTestEnv("__setHistoryPollIntervalForTests");
  HISTORY_POLL_INTERVAL_MS = ms;
}

/** TEST-ONLY: override the lower bound of the run-timeout clamp so tests
 * can fire the hard-timeout path with a sub-60s value. */
export function __setMinRunTimeoutForTests(sec: number): void {
  assertTestEnv("__setMinRunTimeoutForTests");
  MIN_RUN_TIMEOUT_SEC_OVERRIDE = sec;
}

/** TEST-ONLY: restore production defaults. Call in `afterEach`. */
export function __resetTunablesForTests(): void {
  assertTestEnv("__resetTunablesForTests");
  HISTORY_POLL_INTERVAL_MS = 5_000;
  MIN_RUN_TIMEOUT_SEC_OVERRIDE = MIN_RUN_TIMEOUT_SEC;
}

// ---- Value-type guards ----

interface AssetRefValue {
  assetId: string;
  projectId: string;
}

function isAssetRef(value: unknown): value is AssetRefValue {
  return !!value && typeof value === "object" && "assetId" in value && "projectId" in value;
}

interface BytesRefValue {
  bytes: Buffer;
  mime?: string;
  name?: string;
  type?: Asset["type"];
}

function isBytesRef(value: unknown): value is BytesRefValue {
  return (
    !!value &&
    typeof value === "object" &&
    "bytes" in value &&
    Buffer.isBuffer((value as { bytes: unknown }).bytes)
  );
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
};

function extensionFromName(name: string, mime: string): string {
  const fromName = name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  return EXT_BY_MIME[mime.toLowerCase().split(";")[0].trim()] ?? "bin";
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned : `output-${Date.now()}`;
}

function applyBinding(
  prompt: Record<string, unknown>,
  binding: ComfyEndpointInput,
  value: unknown
): void {
  const node = prompt[binding.comfyNodeId] as { inputs?: Record<string, unknown> } | undefined;
  if (!node) {
    throw new Error(`Endpoint binding references missing node ${binding.comfyNodeId}`);
  }
  if (!node.inputs) node.inputs = {};
  node.inputs[binding.comfyInputPath] = value;
}

async function loadEnvironmentForEndpoint(endpoint: ComfyEndpoint): Promise<ComfyUIEnvironment> {
  const env = (await getEnvironment(endpoint.environmentId)) ?? (await getActiveEnvironment());
  if (!env) {
    throw new Error(
      `Endpoint "${endpoint.name}" has no usable environment (env id ${endpoint.environmentId} not found, and no active environment is configured)`
    );
  }
  return env;
}

interface ProgressContext {
  runId: string;
  nodeId: string;
  abortSignal: AbortSignal;
  emit: (event: RunEvent) => Promise<void>;
}

/**
 * Emit a `run.log` SSE event AND (when STUDIO_COMFY_DEBUG=1) mirror to
 * stdout. Async-fire-and-forget by design; we don't want a slow disk write
 * to block executor progress. Errors logging are themselves logged via
 * stdout so we don't recurse.
 */
function runLog(
  ctx: ProgressContext,
  level: "debug" | "info" | "warn" | "error",
  message: string
): void {
  debugLog(`[comfy:${ctx.runId}:${ctx.nodeId}] ${level}: ${message}`);
  void ctx
    .emit({
      type: "run.log",
      runId: ctx.runId,
      nodeId: ctx.nodeId,
      level,
      message,
      timestamp: new Date().toISOString(),
    })
    .catch((err) => {
      console.warn(`[comfy] run.log emit failed: ${err}`);
    });
}

function clampTimeoutSec(raw: number | undefined): number {
  if (typeof raw !== "number" || Number.isNaN(raw)) return DEFAULT_RUN_TIMEOUT_SEC;
  return Math.max(
    MIN_RUN_TIMEOUT_SEC_OVERRIDE,
    Math.min(MAX_RUN_TIMEOUT_SEC, Math.floor(raw))
  );
}

export const executor: NodeExecutor<ComfyUINodeData> = {
  async execute(ctx, inputs, data) {
    if (!data.endpointId) throw new Error("ComfyUI node has no endpoint selected");

    const activeEnv = await getActiveEnvironment();
    if (!activeEnv) throw new Error("No active ComfyUI environment is configured");
    const endpoint = await getEndpoint(activeEnv.id, data.endpointId);
    if (!endpoint) {
      throw new Error(
        `Endpoint ${data.endpointId} not found on the active environment "${activeEnv.name}". ` +
          `Either re-select an endpoint on this node or change the active environment in Settings.`
      );
    }
    const env = await loadEnvironmentForEndpoint(endpoint);
    const timeoutMs = clampTimeoutSec(env.runTimeoutSec) * 1000;

    runLog(
      ctx,
      "info",
      `using endpoint "${endpoint.name}" on env "${env.name}" (${env.baseUrl}); ${endpoint.inputs.length} input(s); timeout ${timeoutMs / 1000}s`
    );

    const promptJsonRaw = await getEndpointWorkflowApiJson(env.id, endpoint.id);
    if (!promptJsonRaw) throw new Error(`Endpoint ${endpoint.id} has no workflow_api.json on disk`);
    const promptJson = JSON.parse(promptJsonRaw) as Record<string, unknown>;

    const client = new ComfyClient(env);

    // ---- Apply input bindings ----
    for (const binding of endpoint.inputs) {
      const incoming = inputs[binding.studioPort];
      const value = incoming === undefined ? binding.default : incoming;
      if (value === undefined || value === null) {
        if (binding.required) {
          throw new Error(`Required input "${binding.label}" was not provided to the ComfyUI node`);
        }
        continue;
      }

      if (binding.type === "image" || binding.type === "video") {
        // Image + video bindings both upload through ComfyUI's `/upload/image`
        // endpoint (which accepts any file in the input directory). They
        // accept either:
        //   - AssetRef: read bytes from the project blob pool
        //   - BytesRef: pre-fetched buffer (in-memory test mode passthrough)
        // Anything else is a misconfigured wire (e.g. Text Input → image
        // handle); fail fast with an actionable message.
        let buffer: Buffer;
        let filename: string;
        let mime: string;
        if (isAssetRef(value)) {
          const bin = await getAssetBinary(value.projectId, value.assetId);
          if (!bin) throw new Error(`Could not read asset bytes for "${binding.label}"`);
          buffer = bin.buffer;
          filename = bin.filename;
          mime = bin.mime;
        } else if (isBytesRef(value)) {
          buffer = value.bytes;
          mime = value.mime ?? "application/octet-stream";
          filename = value.name ?? `upstream.${extensionFromName(value.name ?? "", mime)}`;
        } else {
          const previewPiece =
            typeof value === "string"
              ? `"${value.slice(0, 60)}${value.length > 60 ? "…" : ""}"`
              : `${JSON.stringify(value).slice(0, 60)}`;
          const expectedSourceNode =
            binding.type === "video" ? "Video Input" : "Image Input";
          throw new Error(
            `ComfyUI ${binding.type} input "${binding.label}" expected a ${binding.type} asset reference, ` +
              `got ${typeof value}: ${previewPiece}. ` +
              `Make sure a ${expectedSourceNode} node is wired into this handle, not a Text Input.`
          );
        }
        runLog(
          ctx,
          "debug",
          `uploading ${binding.type} "${binding.label}" (${buffer.length}B, ${mime}) as ${filename}`
        );
        const uploaded = await client.uploadImage(buffer, filename, mime, ctx.abortSignal);
        applyBinding(promptJson, binding, uploaded.name);
      } else if (binding.type === "number") {
        const n = typeof value === "number" ? value : Number(value);
        if (Number.isNaN(n)) throw new Error(`Input "${binding.label}" expected a number, got ${value}`);
        applyBinding(promptJson, binding, n);
      } else if (binding.type === "boolean") {
        applyBinding(promptJson, binding, !!value);
      } else {
        if (typeof value === "object" && value !== null) {
          const previewPiece = JSON.stringify(value).slice(0, 60);
          throw new Error(
            `ComfyUI ${binding.type} input "${binding.label}" expected a string, ` +
              `got an object: ${previewPiece}. ` +
              `Looks like an Image Input is wired into this handle — wire a Text Input instead.`
          );
        }
        applyBinding(promptJson, binding, String(value));
      }
    }

    // ---- Open WS BEFORE submitting so we don't miss execution_start ----
    let ws: WS | null = null;
    try {
      ws = (await client.openWebSocket(ctx.runId)) as unknown as WS;
      runLog(ctx, "debug", `WebSocket opened`);
    } catch (err) {
      runLog(ctx, "warn", `WebSocket open failed (${(err as Error).message}); falling back to polling-only`);
      ws = null;
    }

    let promptId: string;
    try {
      const submission = await client.submitPrompt(promptJson, ctx.runId, ctx.abortSignal);
      promptId = submission.prompt_id;
      runLog(ctx, "info", `prompt submitted: ${promptId}`);
    } catch (err) {
      ws?.close();
      runLog(ctx, "error", `prompt submission failed: ${(err as Error).message}`);
      throw err;
    }

    // ---- Race WS, polling, and timeout ----
    try {
      const completionPath = await waitForCompletion(
        ws,
        promptId,
        ctx,
        client,
        timeoutMs
      );
      runLog(ctx, "info", `completion observed via ${completionPath}`);
    } catch (err) {
      runLog(ctx, "error", `completion failed: ${(err as Error).message}`);
      throw err;
    }

    // ---- Fetch outputs ----
    const history = await client.getHistory(promptId, ctx.abortSignal);
    if (!history) throw new Error(`No history entry for prompt ${promptId}`);
    const outputNode = history.outputs?.[endpoint.output.comfyNodeId];
    if (!outputNode) {
      throw new Error(`Output node ${endpoint.output.comfyNodeId} produced no output`);
    }
    const files = pickOutputFiles(outputNode, endpoint.output.outputField);
    if (files.length === 0) throw new Error(`No files in output of node ${endpoint.output.comfyNodeId}`);

    const first = files[0];
    runLog(ctx, "debug", `fetching output bytes: ${first.filename} (${first.subfolder}/${first.type})`);
    const fetched = await client.fetchOutputBytes(first, ctx.abortSignal);
    runLog(ctx, "debug", `fetched ${fetched.buffer.length}B (${fetched.mime})`);

    // ComfyEndpoint speaks "audio"; the asset gallery's vocabulary is "music".
    const endpointOutputType = endpoint.output.outputType;
    const outputType: Asset["type"] =
      endpointOutputType === "audio" ? "music" : endpointOutputType;

    // Filename prefix so multi-stage chains don't collide on `ComfyUI_00001_.png`.
    const labelSlug = (data.label ?? "comfyui")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "comfyui";
    const stagePrefix = `${labelSlug}-${ctx.nodeId.slice(-6)}`;
    const baseName = first.filename
      ? `${stagePrefix}-${first.filename}`
      : `${stagePrefix}-${promptId.slice(0, 8)}`;
    const ext = extensionFromName(baseName, fetched.mime);

    // ---- Persistence + transit shape ----
    //
    // Project mode (default): auto-save to project assets, return AssetRef
    // for downstream consumers. Test mode: write to the run's outputs dir
    // for the test panel preview AND keep bytes in transit so downstream
    // stages still receive raw buffers.
    const shouldAutoSave =
      ctx.mode === "project" && ctx.projectId !== null && data.saveToProject !== false;

    if (shouldAutoSave) {
      const asset = await createAsset(ctx.projectId!, {
        type: outputType,
        name: baseName,
        content: fetched.buffer,
        extension: ext,
        source: "workflow",
        workflowRunId: ctx.runId,
        producedByNodeId: ctx.nodeId,
      });
      try {
        await recountProject(ctx.projectId!);
      } catch {
        /* swallow; cache will self-heal */
      }
      runLog(ctx, "info", `saved as project asset ${asset.id} ("${baseName}")`);

      const preview: NodePreview = {
        url: `/api/projects/${encodeURIComponent(ctx.projectId!)}/assets/${encodeURIComponent(asset.id)}/file`,
        type: outputType,
        mime: fetched.mime,
        name: baseName,
      };
      return {
        output: {
          assetId: asset.id,
          projectId: ctx.projectId!,
          mime: fetched.mime,
          name: baseName,
          type: outputType,
          comfyFile: first,
          promptId,
        },
        savedAssetId: asset.id,
        asset,
        preview,
      };
    }

    // Test mode: write the bytes to the run's outputs dir so the test
    // panel can render them, AND keep the bytes in transit for downstream
    // executors. This collapses the old "wire SaveOutput just to see a
    // preview" workflow into a single auto-write — SaveOutput is now
    // optional in test mode.
    await ensureDir(ctx.outputsDir);
    const safeFilename = sanitizeFilename(baseName);
    await fs.writeFile(path.join(ctx.outputsDir, safeFilename), fetched.buffer);
    runLog(ctx, "info", `test output written: ${safeFilename}`);

    const preview: NodePreview = {
      url: `/api/workflow-runs/${encodeURIComponent(ctx.runId)}/outputs/${encodeURIComponent(safeFilename)}`,
      type: outputType,
      mime: fetched.mime,
      name: baseName,
    };
    return {
      output: {
        bytes: fetched.buffer,
        mime: fetched.mime,
        name: baseName,
        type: outputType,
        comfyFile: first,
        promptId,
      },
      savedFile: {
        filename: safeFilename,
        name: baseName,
        type: outputType,
        mime: fetched.mime,
      },
      preview,
    };
  },
};

function pickOutputFiles(
  node: NodeOutput,
  field: ComfyEndpoint["output"]["outputField"]
): Array<{ filename: string; subfolder: string; type: string }> {
  const candidates = node[field];
  if (Array.isArray(candidates)) {
    return candidates as Array<{ filename: string; subfolder: string; type: string }>;
  }
  for (const v of Object.values(node)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] && "filename" in v[0]) {
      return v as Array<{ filename: string; subfolder: string; type: string }>;
    }
  }
  return [];
}

/**
 * Race three completion signals; whichever fires first resolves. Tear down
 * the others and propagate the outcome up.
 *
 *   - WS path: listen on ws messages for execution_success / executing-null.
 *   - Polling path: every HISTORY_POLL_INTERVAL_MS ask getHistory(promptId).
 *   - Timeout path: hard ceiling after timeoutMs; fires /interrupt and
 *     rejects with a timeout-shaped error.
 *
 * Returns a string describing which path won (`"websocket" | "polling" |
 * "timeout"`) for diagnostic purposes.
 */
async function waitForCompletion(
  ws: WS | null,
  promptId: string,
  ctx: ProgressContext,
  client: ComfyClient,
  timeoutMs: number
): Promise<"websocket" | "polling" | "timeout"> {
  // Local AbortController used to tell the loser paths to stop.
  const localAbort = new AbortController();
  const onParentAbort = () => localAbort.abort();
  ctx.abortSignal.addEventListener("abort", onParentAbort);

  const wsPromise = ws
    ? waitForWsCompletion(ws, promptId, ctx, client, localAbort.signal)
    : new Promise<never>(() => {
        /* if no WS, this path never resolves */
      });
  const pollPromise = waitForHistoryCompletion(client, promptId, ctx, localAbort.signal);
  const timeoutPromise = waitForTimeout(timeoutMs, ctx, localAbort.signal);

  try {
    const winner = await Promise.race([
      wsPromise.then(() => "websocket" as const),
      pollPromise.then(() => "polling" as const),
      timeoutPromise.then(() => "timeout" as const),
    ]);

    // Stop the loser paths. Each path observes localAbort and tears down.
    localAbort.abort();
    ctx.abortSignal.removeEventListener("abort", onParentAbort);

    if (winner === "timeout") {
      // Best-effort: tell ComfyUI to free the GPU.
      runLog(ctx, "warn", `hard timeout after ${timeoutMs / 1000}s — sending /interrupt`);
      await client.interrupt().catch(() => {});
      throw new Error(
        `ComfyUI run exceeded timeout (${timeoutMs / 1000}s). Increase Settings → ComfyUI → run timeout, or check whether the server is healthy.`
      );
    }

    if (ctx.abortSignal.aborted) {
      // Cancellation that arrived simultaneously with completion.
      await client.interrupt().catch(() => {});
      throw new Error("Cancelled");
    }

    return winner;
  } catch (err) {
    localAbort.abort();
    ctx.abortSignal.removeEventListener("abort", onParentAbort);
    if (ctx.abortSignal.aborted) {
      await client.interrupt().catch(() => {});
      throw new Error("Cancelled");
    }
    throw err;
  }
}

/**
 * WS-based completion: resolves on `execution_success` or
 * `executing { node: null }`; rejects on `execution_error` or socket close.
 * Honours `localAbort` so the racer can stop us when polling wins.
 *
 * Loosened prompt-id filter: `execution_success` and `execution_error`
 * always carry a prompt_id and we trust it. Other event types (e.g.
 * `executing { node: null }`) can come tagged with a *previous* prompt's
 * id when prompts queue back-to-back; we accept those generously rather
 * than risk hanging on a real completion that we filtered out.
 *
 * **One-shot reconnect**: if the socket closes mid-run for a non-abort
 * reason, we attempt one fresh `client.openWebSocket(clientId)` and
 * re-attach the same handlers to the new socket. ComfyUI keys WS
 * subscriptions on `clientId` so the new socket picks up future events
 * for the same prompt. The polling fallback is still running in
 * parallel, so even if the reconnect itself fails the race still
 * resolves through `getHistory`. Reconnect is capped at 1 to avoid an
 * infinite reconnect loop on a permanently-broken endpoint.
 */
function waitForWsCompletion(
  ws: WS,
  promptId: string,
  ctx: ProgressContext,
  client: ComfyClient,
  localAbort: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    let currentWs: WS = ws;
    let reconnectsRemaining = 1;

    const settle = (action: () => void) => {
      if (done) return;
      done = true;
      // Drop ALL handlers + close the LATEST socket. Reconnects swap
      // currentWs in place so settle's teardown follows the live one.
      // Without this, the message/close/error closures retain `ctx` +
      // `promptId` + the resolve/reject refs until the underlying socket
      // finishes its teardown — closures pinning whole runs after they've
      // supposedly completed.
      try {
        currentWs.removeAllListeners();
      } catch {
        /* not all WS impls expose removeAllListeners; ignore */
      }
      try {
        currentWs.close();
      } catch {
        /* ignore */
      }
      action();
    };

    const onLocalAbort = () => settle(() => reject(new Error("aborted")));
    localAbort.addEventListener("abort", onLocalAbort);

    const attachAll = (socket: WS) => {
      // The message handler is async because we `await ctx.emit(...)` on
      // progress events. A throw from a `.on("message")` handler that
      // returns a rejected promise becomes an unhandled rejection in
      // Node — fatal in newer versions. Wrap the body so any throw is
      // logged (via runLog if possible) but the WS keeps running; another
      // completion signal (polling / timeout) will eventually win the race.
      socket.on("message", (raw: WS.Data) => {
        void (async () => {
          if (done) return;
          try {
            const text =
              typeof raw === "string"
                ? raw
                : Buffer.isBuffer(raw)
                  ? raw.toString("utf8")
                  : raw.toString();
            const event = parseWsMessage(text);
            if (!event) return;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ComfyUI WS payloads are heterogeneous
            const data = event.data as any;

            if (event.type === "progress" && data) {
              // Only forward progress events for our prompt — otherwise we'd flash
              // bars for queued sibling runs.
              if (data.prompt_id && data.prompt_id !== promptId) return;
              await ctx.emit({
                type: "node.progress",
                runId: ctx.runId,
                nodeId: "",
                progress: data.max ? data.value / data.max : undefined,
                comfyValue: data.value,
                comfyMax: data.max,
                message: `step ${data.value}/${data.max}`,
              });
              return;
            }

            if (
              event.type === "execution_error" &&
              data &&
              data.prompt_id === promptId
            ) {
              runLog(
                ctx,
                "error",
                `WS execution_error: ${data.message ?? "(no message)"}`
              );
              settle(() =>
                reject(
                  new Error(
                    `ComfyUI execution_error: ${data.message ?? JSON.stringify(data).slice(0, 200)}`
                  )
                )
              );
              return;
            }

            // Completion: trust execution_success blindly (well-defined
            // contract); be permissive on `executing { node: null }` since
            // some ComfyUI builds tag it with the wrong prompt_id when
            // prompts queue.
            if (
              event.type === "execution_success" &&
              data &&
              data.prompt_id === promptId
            ) {
              runLog(ctx, "debug", `WS execution_success`);
              settle(() => {
                localAbort.removeEventListener("abort", onLocalAbort);
                resolve();
              });
              return;
            }

            if (event.type === "executing" && data && data.node === null) {
              runLog(
                ctx,
                "debug",
                `WS executing { node: null } (prompt_id=${data.prompt_id ?? "<none>"})`
              );
              settle(() => {
                localAbort.removeEventListener("abort", onLocalAbort);
                resolve();
              });
              return;
            }
          } catch (err) {
            // Don't kill the WS over a single bad message; another
            // completion signal will win the race if this one was
            // structural. Log so the user sees it in the activity log.
            runLog(
              ctx,
              "warn",
              `WS message handler error: ${(err as Error).message ?? err}`
            );
          }
        })();
      });

      // Socket close: ATTEMPT one reconnect with the same clientId before
      // dropping silently. If the close was caused by localAbort we already
      // settled — short-circuit. The polling fallback is still running, so
      // even if reconnect fails the race resolves through `getHistory`.
      socket.on("close", () => {
        if (done || localAbort.aborted) return;
        // Detach the dead socket's listeners NOW so we don't double-fire
        // on a late buffered event.
        try {
          socket.removeAllListeners();
        } catch {
          /* ignore */
        }
        if (reconnectsRemaining > 0) {
          reconnectsRemaining -= 1;
          runLog(ctx, "warn", `WS closed mid-run; attempting one-shot reconnect`);
          void (async () => {
            try {
              const fresh = (await client.openWebSocket(
                ctx.runId
              )) as unknown as WS;
              if (done || localAbort.aborted) {
                try {
                  fresh.close();
                } catch {
                  /* ignore */
                }
                return;
              }
              currentWs = fresh;
              attachAll(fresh);
              runLog(ctx, "info", `WS reconnected`);
            } catch (err) {
              runLog(
                ctx,
                "warn",
                `WS reconnect failed: ${(err as Error).message} (relying on polling fallback)`
              );
              done = true;
              // Intentionally do NOT resolve/reject — let polling win.
            }
          })();
          return;
        }
        // Reconnects exhausted — silent drop, polling continues.
        done = true;
        runLog(
          ctx,
          "warn",
          `WS closed before completion (relying on polling fallback)`
        );
        localAbort.removeEventListener("abort", onLocalAbort);
        // Intentionally do NOT call resolve() or reject().
      });

      socket.on("error", (err: Error) => {
        if (done) return;
        runLog(
          ctx,
          "warn",
          `WS error: ${err.message} (close handler will decide on reconnect)`
        );
        // The 'close' event almost always follows 'error' for WebSockets.
        // Defer reconnect logic to the close handler so we don't double-act
        // on an error that's about to be followed by close.
      });
    };

    attachAll(ws);
  });
}

/**
 * Polling-based completion: hits `/history/<promptId>` every
 * HISTORY_POLL_INTERVAL_MS and resolves once `status.completed === true`.
 * Designed to recover from zombie WebSockets.
 */
async function waitForHistoryCompletion(
  client: ComfyClient,
  promptId: string,
  ctx: ProgressContext,
  localAbort: AbortSignal
): Promise<void> {
  // Initial small delay so we don't pre-empt the WS path on a fast graph
  // that completes within a second.
  await sleep(HISTORY_POLL_INTERVAL_MS, localAbort);
  while (!localAbort.aborted) {
    if (ctx.abortSignal.aborted) throw new Error("Cancelled");
    try {
      const history = await client.getHistory(promptId, ctx.abortSignal);
      if (history && history.status?.completed) {
        runLog(ctx, "debug", `history poll: status.completed=true`);
        return;
      }
      runLog(ctx, "debug", `history poll: not yet completed`);
    } catch (err) {
      // Network blips on a single poll shouldn't kill the chain; log + retry.
      runLog(ctx, "warn", `history poll error: ${(err as Error).message}`);
    }
    await sleep(HISTORY_POLL_INTERVAL_MS, localAbort);
  }
  throw new Error("polling aborted");
}

/** Hard timeout — fires after timeoutMs unless localAbort kills it first. */
function waitForTimeout(
  timeoutMs: number,
  ctx: ProgressContext,
  localAbort: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const handle = setTimeout(() => {
      runLog(ctx, "warn", `hard timeout fired after ${timeoutMs / 1000}s`);
      resolve();
    }, timeoutMs);
    localAbort.addEventListener("abort", () => {
      clearTimeout(handle);
      reject(new Error("aborted"));
    });
  });
}

function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const handle = setTimeout(resolve, ms);
    abortSignal?.addEventListener("abort", () => {
      clearTimeout(handle);
      reject(new Error("aborted"));
    });
  });
}
