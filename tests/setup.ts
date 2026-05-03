/**
 * Global Vitest setup — runs once per test file, before any test.
 *
 * Currently minimal:
 *   - Suppress next/server's `console.error` warnings about edge-runtime
 *     features when running in node (they're harmless in tests).
 *
 * Avoids registering plugins or seeding state here — each test file owns
 * its own setup. This keeps tests independent and makes ordering-bug
 * reproductions trivial.
 */
import { afterEach, beforeEach, vi } from "vitest";

// Reset all mocks between tests so spy state doesn't bleed across files.
beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
});
