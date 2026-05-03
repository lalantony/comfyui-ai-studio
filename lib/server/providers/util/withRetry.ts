/**
 * Generic exponential-backoff retry helper for outbound HTTP calls.
 *
 * Used by `ComfyClient` to make `submitPrompt`, `getHistory`, and
 * `fetchOutputBytes` robust against transient network blips and 5xx
 * responses. Each attempt re-runs the user-supplied function from
 * scratch — caller must make `fn` idempotent (the ComfyUI calls we wrap
 * are: GET history, POST a unique-prompt-id-keyed prompt, GET /view).
 *
 * Retry policy (defaults):
 *   - 3 attempts (1 initial + 2 retries)
 *   - 1s / 2s delays between (exponential, base 2)
 *   - Retries on:
 *       - Network errors (TypeError from fetch, "fetch failed" message,
 *         ECONNRESET / ECONNREFUSED / EAI_AGAIN)
 *       - HttpStatusError with status >= 500
 *   - Does NOT retry on:
 *       - HttpStatusError with 4xx (deterministic — retrying won't help)
 *       - AbortError (caller cancelled)
 *
 * Cancellation: the helper observes the caller's AbortSignal between
 * attempts. A signal that fires mid-sleep aborts the sleep and
 * propagates as a thrown abort.
 */
import "server-only";

export class HttpStatusError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

export interface WithRetryOptions {
  /** Total attempts including the first. Default 3. */
  attempts?: number;
  /** Base delay; subsequent retries are baseDelayMs * 2^(i-1). Default 1000. */
  baseDelayMs?: number;
  /** Aborts both sleeps and prevents further attempts. */
  signal?: AbortSignal;
  /** Override the default predicate. Returning true means retry the failure. */
  shouldRetry?: (err: unknown) => boolean;
  /** Diagnostic hook fired before each retry (1-based attempt number). */
  onRetry?: (attempt: number, err: unknown) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: WithRetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseDelayMs = Math.max(0, opts.baseDelayMs ?? 1000);
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (opts.signal?.aborted) throw abortError();
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Last attempt — surface the error verbatim.
      if (i === attempts - 1) throw err;
      if (!shouldRetry(err)) throw err;
      const delay = baseDelayMs * Math.pow(2, i);
      opts.onRetry?.(i + 1, err);
      await sleep(delay, opts.signal);
    }
  }
  // Defensive — the loop always returns or throws.
  throw lastErr;
}

function defaultShouldRetry(err: unknown): boolean {
  // Caller cancelled — never retry.
  if (err instanceof Error && err.name === "AbortError") return false;
  // Server-side transient errors only.
  if (err instanceof HttpStatusError) return err.status >= 500;
  // Native fetch surfaces network failures as a TypeError. Some Node
  // builds wrap them as Error with `fetch failed` message.
  if (err instanceof TypeError) return true;
  if (
    err instanceof Error &&
    /fetch failed|network|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT/i.test(
      err.message
    )
  ) {
    return true;
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort);
  });
}

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}
