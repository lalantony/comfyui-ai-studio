/**
 * ComfyUI provider — every HTTP and WebSocket call we make to a ComfyUI
 * server flows through this class. There are no other call sites; if you're
 * adding a new ComfyUI feature, add a method here first.
 *
 * Auth modes (from `ComfyUIEnvironment.authMode`):
 *   - `none`           — no auth headers
 *   - `comfy-org-key`  — sets `extra_data.api_key_comfy_org` in the `/prompt` body
 *   - `bearer`         — `Authorization: Bearer <apiKey>` on HTTP and the WS upgrade
 *
 * Surface area:
 *   - `systemStats()`     — RAM/VRAM, version, GPU device. Used by /health and the canvas.
 *   - `queueDepth()`      — count of pending prompts (best-effort, returns null on failure).
 *   - `uploadImage()`     — multipart POST to /upload/image; returns the server-side filename.
 *   - `submitPrompt()`    — POST /prompt with the patched `workflow_api.json`.
 *   - `getHistory()`      — GET /history/<promptId> after `execution_success`.
 *   - `fetchOutputBytes()`— GET /view; binary stream we forward to the asset pipeline.
 *   - `interrupt()`       — best-effort POST /interrupt on cancellation.
 *   - `openWebSocket()`   — opens /ws?clientId=<runId>; the executor opens this BEFORE
 *                           submitting the prompt so we don't miss `execution_start`.
 */
import "server-only";

import WebSocket from "ws";
import { ComfyUIEnvironment } from "@/types";
import { validateBaseUrl } from "../../baseUrlPolicy";
import { HttpStatusError, withRetry } from "../util/withRetry";
export class ComfyClient {
  private readonly baseUrl: string;
  private readonly env: ComfyUIEnvironment;

  constructor(env: ComfyUIEnvironment) {
    // Defence in depth — the environment service validates baseUrl on
    // create + update, but a legacy persisted env (from before the policy
    // shipped) or a hand-edited env.json could slip through. Block it at
    // construction so a stale config can't be used to talk to anything
    // disallowed. Errors surface as a runtime exception, which the
    // executor reports to the user as a node failure.
    const check = validateBaseUrl(env.baseUrl, env.type);
    if (!check.ok) {
      throw new Error(`Refusing to construct ComfyClient: ${check.reason}`);
    }
    this.env = env;
    this.baseUrl = env.baseUrl.replace(/\/+$/, "");
  }

  // ---- Header builders ----

  private httpHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...(extra ?? {}) };
    if (this.env.authMode === "bearer" && this.env.apiKey) {
      headers["Authorization"] = `Bearer ${this.env.apiKey}`;
    }
    return headers;
  }

  // ---- Health / metadata ----

  async systemStats(signal?: AbortSignal): Promise<SystemStatsResponse> {
    const res = await fetch(`${this.baseUrl}/system_stats`, {
      headers: this.httpHeaders(),
      signal,
    });
    if (!res.ok) throw new Error(`system_stats ${res.status}`);
    return (await res.json()) as SystemStatsResponse;
  }

  /** Returns the count of pending prompts (queue_running + queue_pending). */
  async queueDepth(signal?: AbortSignal): Promise<number | null> {
    try {
      const res = await fetch(`${this.baseUrl}/queue`, {
        headers: this.httpHeaders(),
        signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { queue_running?: unknown[]; queue_pending?: unknown[] };
      const running = Array.isArray(json.queue_running) ? json.queue_running.length : 0;
      const pending = Array.isArray(json.queue_pending) ? json.queue_pending.length : 0;
      return running + pending;
    } catch {
      return null;
    }
  }

  // ---- Image upload ----

  async uploadImage(
    bytes: Buffer,
    filename: string,
    mime: string,
    signal?: AbortSignal
  ): Promise<{ name: string; subfolder: string; type: string }> {
    const fd = new FormData();
    // node:fs Buffer wraps as Blob via the modern fetch FormData API
    fd.append("image", new Blob([new Uint8Array(bytes)], { type: mime }), filename);
    fd.append("type", "input");
    fd.append("overwrite", "true");

    const res = await fetch(`${this.baseUrl}/upload/image`, {
      method: "POST",
      headers: this.httpHeaders(),
      body: fd,
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`upload/image ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }
    return (await res.json()) as { name: string; subfolder: string; type: string };
  }

  // ---- Prompt submission ----

  async submitPrompt(
    promptJson: Record<string, unknown>,
    clientId: string,
    signal?: AbortSignal
  ): Promise<{ prompt_id: string; number?: number }> {
    const body: Record<string, unknown> = { prompt: promptJson, client_id: clientId };
    if (this.env.authMode === "comfy-org-key" && this.env.apiKey) {
      body.extra_data = { api_key_comfy_org: this.env.apiKey };
    }
    // Submission is idempotent only because ComfyUI assigns a server-side
    // prompt_id; a retried POST creates a duplicate run if the first one
    // partially succeeded. In practice we only retry on network failures
    // and 5xx — both indicate the request didn't reach the server intent
    // layer, so retrying is safe. 4xx (e.g. node_errors) does not retry.
    const bodyJson = JSON.stringify(body);
    return withRetry(
      async () => {
        const res = await fetch(`${this.baseUrl}/prompt`, {
          method: "POST",
          headers: this.httpHeaders({ "Content-Type": "application/json" }),
          body: bodyJson,
          signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new HttpStatusError(
            res.status,
            `/prompt ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 300)}` : ""}`
          );
        }
        const json = (await res.json()) as {
          prompt_id?: string;
          number?: number;
          error?: unknown;
          node_errors?: unknown;
        };
        if (!json.prompt_id) {
          throw new Error(`ComfyUI rejected prompt: ${JSON.stringify(json).slice(0, 300)}`);
        }
        return { prompt_id: json.prompt_id, number: json.number };
      },
      { signal }
    );
  }

  // ---- History + view ----

  async getHistory(promptId: string, signal?: AbortSignal): Promise<HistoryEntry | null> {
    // GET history is fully idempotent. Retry on network errors + 5xx only.
    // The polling loop calls this every ~5s already, so an extra fast
    // retry on a single transient failure shaves seconds off recovery.
    return withRetry(
      async () => {
        const res = await fetch(
          `${this.baseUrl}/history/${encodeURIComponent(promptId)}`,
          {
            headers: this.httpHeaders(),
            signal,
          }
        );
        // 404 = unknown prompt; the caller handles null. Don't retry.
        if (res.status === 404) return null;
        if (!res.ok) {
          throw new HttpStatusError(
            res.status,
            `/history ${res.status} ${res.statusText}`
          );
        }
        const json = (await res.json()) as Record<string, HistoryEntry>;
        return json[promptId] ?? null;
      },
      { signal }
    );
  }

  async fetchOutputBytes(
    file: { filename: string; subfolder: string; type: string },
    signal?: AbortSignal
  ): Promise<{ buffer: Buffer; mime: string }> {
    const params = new URLSearchParams({
      filename: file.filename,
      subfolder: file.subfolder ?? "",
      type: file.type ?? "output",
    });
    // GET /view is fully idempotent. Worth retrying because output binary
    // download is the last step of a long run — failing here means the
    // user has to re-execute the entire workflow if we don't recover.
    return withRetry(
      async () => {
        const res = await fetch(`${this.baseUrl}/view?${params.toString()}`, {
          headers: this.httpHeaders(),
          signal,
        });
        if (!res.ok) {
          throw new HttpStatusError(
            res.status,
            `/view ${res.status} for ${file.filename}`
          );
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        const mime =
          res.headers.get("content-type") ?? "application/octet-stream";
        return { buffer, mime };
      },
      { signal }
    );
  }

  // ---- Cancellation ----

  async interrupt(signal?: AbortSignal): Promise<void> {
    await fetch(`${this.baseUrl}/interrupt`, {
      method: "POST",
      headers: this.httpHeaders(),
      signal,
    }).catch(() => {
      /* best-effort */
    });
  }

  // ---- WebSocket ----

  /**
   * Open a WebSocket scoped to the given clientId. Caller is responsible for closing.
   * Returns once the socket is OPEN.
   *
   * **Heartbeat** — automatically attached. Sends a ping every
   * `HEARTBEAT_INTERVAL_MS` and expects a `pong` within
   * `HEARTBEAT_TIMEOUT_MS`. If the peer doesn't pong in time we synthetically
   * `terminate()` the socket — the executor's `ws.on("close", ...)` then
   * fires, which is the only path that breaks `waitForCompletionViaWs` out
   * of its wait loop.
   *
   * Why this matters: long ComfyUI samples (e.g. 200s+ video runs) leave the
   * WS idle between events. Windows TCP keepalive defaults to ~2 hours, so
   * a network blip / Defender / NLA cycling silently kills the socket
   * mid-run. Without an application-level ping, our side never observes the
   * close — `waitForCompletionViaWs` waits forever for `execution_success`
   * that already landed on a dead socket. Pinging makes that failure
   * detectable in 30s instead of hours.
   */
  async openWebSocket(clientId: string): Promise<WebSocket> {
    const wsUrl = this.baseUrl.replace(/^http/i, "ws") + `/ws?clientId=${encodeURIComponent(clientId)}`;
    const headers: Record<string, string> = {};
    if (this.env.authMode === "bearer" && this.env.apiKey) {
      headers["Authorization"] = `Bearer ${this.env.apiKey}`;
    }
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { headers });
      ws.once("open", () => {
        attachHeartbeat(ws, clientId);
        resolve(ws);
      });
      ws.once("error", (err) => reject(err));
    });
  }
}

// ---- WebSocket heartbeat ----
//
// Module-scope helpers so they're trivially testable + shared across
// connection instances. The interval/timeout values are exported for tests
// (see plugins/builtin/comfyui/executor.test.ts).

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_TIMEOUT_MS = 30_000;

function attachHeartbeat(ws: WebSocket, clientId: string): void {
  let lastPongAt = Date.now();
  const onPong = () => {
    lastPongAt = Date.now();
    debugLog(`[comfy:${clientId}] pong`);
  };
  ws.on("pong", onPong);

  const interval = setInterval(() => {
    // If the peer hasn't responded to the previous ping within the timeout,
    // treat the socket as dead and force-close. The executor's close handler
    // takes over from there.
    if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
      debugLog(
        `[comfy:${clientId}] ws heartbeat timeout (${Math.round(
          (Date.now() - lastPongAt) / 1000
        )}s since last pong) — terminating`
      );
      clearInterval(interval);
      ws.off("pong", onPong);
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
      return;
    }
    try {
      ws.ping();
      debugLog(`[comfy:${clientId}] ping`);
    } catch {
      // Sending failed — let the close handler clean up; clear the interval
      // so we don't keep banging on a dead socket.
      clearInterval(interval);
      ws.off("pong", onPong);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // When the socket closes for any reason, drop the timer.
  ws.once("close", () => {
    clearInterval(interval);
    ws.off("pong", onPong);
  });
}

// ---- Gated debug logging ----
//
// Set `STUDIO_COMFY_DEBUG=1` in the env to surface fine-grained ComfyUI
// runtime events. Intentionally noisy when on; silent when off.

export function debugLog(...args: unknown[]): void {
  if (process.env.STUDIO_COMFY_DEBUG !== "1") return;
  console.log(...args);
}

// ---- Types for /system_stats responses ----

export interface SystemStatsResponse {
  system?: {
    os?: string;
    comfyui_version?: string;
    python_version?: string;
    /** Bytes. */
    ram_total?: number;
    /** Bytes. */
    ram_free?: number;
  };
  devices?: Array<{
    name?: string;
    type?: string;
    index?: number;
    /** Bytes. */
    vram_total?: number;
    /** Bytes. */
    vram_free?: number;
  }>;
}

// ---- Types for /history responses ----

export interface HistoryEntry {
  prompt: unknown;
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
  outputs?: Record<string, NodeOutput>;
}

export interface NodeOutput {
  images?: Array<{ filename: string; subfolder: string; type: string }>;
  videos?: Array<{ filename: string; subfolder: string; type: string }>;
  audio?: Array<{ filename: string; subfolder: string; type: string }>;
  files?: Array<{ filename: string; subfolder: string; type: string }>;
  // Allow extension fields without trapping us in Record<string, never>
  [key: string]: unknown;
}

// ---- Typed WS events ----

export type ComfyWsEvent =
  | { type: "status"; data: { exec_info: { queue_remaining: number } } }
  | { type: "execution_start"; data: { prompt_id: string } }
  | { type: "execution_cached"; data: { prompt_id: string; nodes: string[] } }
  | { type: "executing"; data: { node: string | null; prompt_id: string } }
  | { type: "progress"; data: { node: string; prompt_id: string; value: number; max: number } }
  | { type: "executed"; data: { node: string; prompt_id: string; output: NodeOutput } }
  | { type: "execution_error"; data: { prompt_id: string; node_id?: string; message?: string } }
  | { type: "execution_success"; data: { prompt_id: string; timestamp?: number } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: string; data: any };

export function parseWsMessage(raw: string): ComfyWsEvent | null {
  try {
    const obj = JSON.parse(raw) as { type?: string; data?: unknown };
    if (typeof obj.type !== "string") return null;
    return { type: obj.type, data: obj.data } as ComfyWsEvent;
  } catch {
    return null;
  }
}
