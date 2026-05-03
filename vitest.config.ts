/**
 * Vitest configuration.
 *
 * Default `node` environment for the bulk of our tests (server-side logic,
 * pure functions). Component tests opt into `happy-dom` via their own
 * `// @vitest-environment happy-dom` directive so we don't pay the DOM
 * setup cost for every test.
 *
 * Path alias `@/*` → repo root mirrors `tsconfig.json` so test imports
 * match production imports exactly.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      // The `server-only` package is a build-time guard that throws if
      // imported outside a Server Component. In tests we run server modules
      // directly, so swap it for a no-op. Standard Next.js + Vitest pattern.
      "server-only": path.join(root, "tests/helpers/server-only-shim.ts"),
    },
  },
  test: {
    // Default to node — most tests don't need a DOM. Component tests
    // override per-file with `// @vitest-environment happy-dom`.
    environment: "node",

    // Test discovery:
    //   - Co-located unit tests: `**/*.test.ts` next to the source.
    //   - Integration tests:     `tests/integration/**/*.test.ts`.
    //   - E2E lives in `tests/e2e/` and runs via Playwright, not Vitest.
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "tests/e2e/**",
    ],

    // Global setup wires the tmp-dir helper, registers built-in plugins
    // once, and resets time/random seeds for determinism.
    setupFiles: ["./tests/setup.ts"],

    // Each test file gets its own module isolation. Critical for the
    // plugin registries — without this, registrations from one test would
    // leak into another.
    isolate: true,

    // Coverage — soft, informational. No hard threshold (yet). The HTML
    // report goes to coverage/ and is gitignored.
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["lib/**", "plugins/**", "stores/**", "hooks/**"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "tests/**",
        "node_modules/**",
      ],
    },
  },
});
