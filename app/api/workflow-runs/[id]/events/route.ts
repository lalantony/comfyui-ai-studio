import { NextRequest } from "next/server";
import { findRunLocation, readEventsFromDisk } from "@/lib/server/workflow/runStore";
import { subscribe } from "@/lib/server/workflow/eventBus";
import { jsonError } from "@/lib/server/apiHelpers";
import { RunEvent } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const TERMINAL_TYPES: Set<RunEvent["type"]> = new Set(["run.completed", "run.failed", "run.cancelled"]);

/**
 * SSE comment-line heartbeat interval. Long idle stretches (e.g. a 200s
 * ComfyUI sample where `node.progress` events stop coming because the
 * model is mid-step) get killed by intermediate proxies / Cloudflare /
 * corp NAT after ~30-60s of total silence on the connection. Writing a
 * comment every 15s keeps the socket warm; comments start with `:` and
 * are silently dropped by EventSource on the client, so they don't
 * surface as messages.
 */
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_BYTES = new TextEncoder().encode(":heartbeat\n\n");

function sseLine(event: RunEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * SSE handler — replays past events from disk, then continues live via the
 * in-memory event bus. Order of operations is critical:
 *
 *   1. Subscribe FIRST and buffer live events while replay is in flight.
 *   2. Read events.ndjson (the canonical history up to "now").
 *   3. Send disk events; record their `_seq` in a seen-set.
 *   4. Drain the live buffer, skipping any seq we already sent from disk.
 *   5. Switch the subscriber to send-direct mode; future events stream live.
 *
 * Why subscribe-first matters: `runStore.emitEvent` does `appendFile` THEN
 * `eventBus.emit`. If we subscribed AFTER reading the file, an event whose
 * append landed *between* the read and the subscribe would be lost — not
 * in the file we read, not delivered to a non-existent subscriber. With a
 * fast text-input executor that fires `node.started` + `node.completed`
 * back-to-back, this race window is reproducible. The subscribe-first
 * pattern + seq-based dedup guarantees every event is delivered exactly
 * once.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id: runId } = await ctx.params;
  const loc = await findRunLocation(runId);
  if (!loc) return jsonError("Run not found", 404);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      // Single-source-of-truth for cleanup. Both controller.close + the
      // heartbeat timer must be torn down together; doing it through
      // `close()` everywhere keeps the lifecycle consistent.
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(HEARTBEAT_BYTES);
        } catch {
          // Controller already gone — clean up immediately so we don't
          // pile timers up if the abort listener didn't fire.
          closed = true;
          clearInterval(heartbeat);
        }
      }, SSE_HEARTBEAT_INTERVAL_MS);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const send = (event: RunEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseLine(event)));
        } catch {
          closed = true;
        }
      };

      // Track sequence numbers we've already forwarded so the live drain
      // doesn't double-send events that also showed up in the disk replay.
      const seenSeq = new Set<number>();
      // While the buffer is non-null, the subscriber appends to it instead
      // of sending live. Set to null once we're past replay; the subscriber
      // then sends events directly.
      let buffered: RunEvent[] | null = [];

      const handleLive = (event: RunEvent): boolean => {
        // Returns true if we should stop (terminal event delivered).
        const seq = (event as { _seq?: number })._seq;
        if (typeof seq === "number") {
          if (seenSeq.has(seq)) return false;
          seenSeq.add(seq);
        }
        send(event);
        return TERMINAL_TYPES.has(event.type);
      };

      const unsubscribe = subscribe(runId, (event) => {
        if (closed) return;
        if (buffered !== null) {
          buffered.push(event);
          return;
        }
        if (handleLive(event)) {
          unsubscribe();
          close();
        }
      });

      // Register the disconnect handler IMMEDIATELY after subscribing —
      // before the disk-replay await. If the client disconnects during
      // the replay (which on a large events.ndjson can take a beat), we
      // still need to release the subscription, otherwise it leaks in
      // the eventBus map until the run is disposed (or forever if it's
      // already terminal). Previous code registered this only after the
      // drain finished, leaving a real leak window.
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        close();
      });

      // Replay past events from disk.
      const past = await readEventsFromDisk(loc.projectId, runId);
      let terminalSeen = false;
      for (const ev of past) {
        const seq = (ev as { _seq?: number })._seq;
        if (typeof seq === "number") seenSeq.add(seq);
        send(ev);
        if (TERMINAL_TYPES.has(ev.type)) {
          terminalSeen = true;
          break;
        }
      }

      if (terminalSeen) {
        unsubscribe();
        close();
        return;
      }

      // Drain whatever the live subscriber buffered while we were reading.
      const toFlush = buffered;
      buffered = null;
      for (const ev of toFlush) {
        if (handleLive(ev)) {
          unsubscribe();
          close();
          return;
        }
      }

      // From here on, the subscriber sends directly (buffered === null).
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
