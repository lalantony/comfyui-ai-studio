/**
 * No-op replacement for the `server-only` package, used during tests.
 *
 * The real package throws at import time if it's reached from a Client
 * Component bundle — that's its whole job, and it's load-bearing in
 * production. In tests we run server modules directly under Node, so we
 * swap the package via vitest's resolve.alias.
 *
 * This file intentionally exports nothing.
 */
export {};
