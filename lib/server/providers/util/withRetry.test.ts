/**
 * withRetry — exponential backoff helper used by every ComfyUI HTTP call.
 *
 * Tests use very small base delays (1ms / 2ms) so the suite stays fast.
 * Real production calls use 1000ms; that's a single constant in the
 * caller's options and not encoded here.
 */
import { describe, expect, it, vi } from "vitest";
import { HttpStatusError, withRetry } from "./withRetry";

describe("withRetry", () => {
  it("returns on first attempt success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { attempts: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries network errors and eventually returns", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(Object.assign(new Error("ECONNRESET"), { name: "Error" }))
      .mockResolvedValue("ok");
    const onRetry = vi.fn();
    const result = await withRetry(fn, {
      attempts: 3,
      baseDelayMs: 1,
      onRetry,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("retries 5xx HttpStatusError but not 4xx", async () => {
    const fn503 = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new HttpStatusError(503, "service unavailable"))
      .mockResolvedValue("ok");
    expect(await withRetry(fn503, { attempts: 3, baseDelayMs: 1 })).toBe("ok");
    expect(fn503).toHaveBeenCalledTimes(2);

    const fn400 = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new HttpStatusError(400, "bad request"));
    await expect(
      withRetry(fn400, { attempts: 3, baseDelayMs: 1 })
    ).rejects.toBeInstanceOf(HttpStatusError);
    expect(fn400).toHaveBeenCalledTimes(1);
  });

  it("does not retry AbortError", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(abortErr);
    await expect(
      withRetry(fn, { attempts: 3, baseDelayMs: 1 })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("aborts mid-sleep when the signal fires", async () => {
    const ctrl = new AbortController();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    // Abort during the first sleep
    setTimeout(() => ctrl.abort(), 5);
    await expect(
      withRetry(fn, { attempts: 3, baseDelayMs: 50, signal: ctrl.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("surfaces the last error when retries exhaust", async () => {
    const err = new HttpStatusError(503, "still down");
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(err);
    await expect(
      withRetry(fn, { attempts: 2, baseDelayMs: 1 })
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("respects a custom shouldRetry predicate", async () => {
    const err = new Error("custom");
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(err)
      .mockResolvedValue("ok");
    const result = await withRetry(fn, {
      attempts: 3,
      baseDelayMs: 1,
      shouldRetry: (e) => e === err,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
