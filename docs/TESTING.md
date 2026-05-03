# Testing

> **Audience**: contributors writing or running tests. Existing tests live next to source as `*.test.ts`. The full suite runs in well under a second.

ComfyUI AI Studio uses **Vitest** for unit and integration tests, with Testing Library + happy-dom for the (sparing) component tests. There is no separate "test framework setup" you need to learn — it's standard Vitest + TypeScript, the same pattern most modern TS projects use.

## TL;DR — running tests

```bash
npm test               # one-shot run, what CI does
npm run test:watch     # dev loop, re-runs on save
npm run test:coverage  # generates coverage/ HTML report
npm run check          # lint + type-check + test (run this before opening a PR)
```

**`npm run check` is the contributor command.** It runs everything CI runs, in the same order, against your local code. If `npm run check` is green, your PR is unlikely to fail CI.

## Philosophy

Three rules we follow:

1. **Test the contract, not the implementation.** A test that knows about internal variable names breaks every refactor. Tests should care what a function *does*, not *how*.
2. **Real I/O over mocks for our own code.** The blob store and storage layer write to a tmp directory in tests, not a mock filesystem. Mocks of our own code lie. Mocks of *external* services (ComfyUI HTTP, LLM streams) are fine.
3. **No shared state between tests.** Each test creates its own tmp `STUDIO_DATA_DIR`, registers its own manifests, gets fresh time. Test A's bug should never depend on test B running first.

## The test pyramid

```
                /\
               /  \   E2E (Playwright)
              /----\  TBD — not yet wired up
             /      \
            /        \  Integration
           /----------\  ~80 tests on services + workflows + resume + runtime
          /            \
         /              \  Unit
        /________________\  ~220 tests on pure functions, contracts, retry/policy
```

Total: **298 tests across 21 files**, sub-2s wall time. Tracking grows linearly with shipped features (each new module ships with table-driven tests; see `lib/server/baseUrlPolicy.test.ts` for the canonical "many small cases, one rule" shape).

Where each tier lives:

| Tier | Location | What |
|---|---|---|
| **Unit** | Co-located `*.test.ts` next to the source | Pure functions, fast, deterministic. ~70% of tests. |
| **Integration** | `tests/integration/**/*.test.ts` | Service boundaries with real I/O against tmp dirs. |
| **Component** | Co-located `*.test.tsx` next to the source (with `// @vitest-environment happy-dom`) | Selective — only for behavior-rich primitives like `Callout`, `Select`. |
| **E2E** | `tests/e2e/**/*.spec.ts` | Critical user flows in a real browser via Playwright. |

## Running specific tests

```bash
# Single file
npm test -- lib/server/blobStore.test.ts

# Pattern
npm test -- --grep "refcount"

# Watch mode focused on one file
npm run test:watch -- lib/plugins/connectionValidation.test.ts
```

## Anatomy of a unit test

```ts
// lib/server/storage.test.ts
import { describe, expect, it } from "vitest";
import { assertSafeId, InvalidIdError } from "./storage";

describe("assertSafeId", () => {
  describe("accepts valid ids", () => {
    it.each([
      ["asset-abc123"],
      ["wf-image-z-index-momv4gxf"],
    ])("%s", (id) => {
      expect(() => assertSafeId(id)).not.toThrow();
    });
  });

  describe("rejects unsafe ids", () => {
    it.each([
      ["..", "parent-directory traversal"],
      ["../etc/passwd", "absolute traversal"],
      [".hidden", "leading dot"],
    ])("%s (%s)", (id) => {
      expect(() => assertSafeId(id)).toThrow(InvalidIdError);
    });
  });
});
```

**Conventions worth following:**
- `describe(<unit name>)` at the top — one per file.
- `it.each(...)` for parameterized tests — beats copy-pasting near-identical assertions.
- The assertion is the test name's verb: `it("rejects empty descriptions")` not `it("returns false when description is empty")`.
- One concept per `it()`. Not "creates and updates and deletes" — that's three tests.
- Don't `try/catch` to assert errors — use `expect(...).toThrow(...)`.

## Anatomy of an integration test

Integration tests touch real disk via the `useTmpStudioDir` helper:

```ts
// lib/server/blobStore.test.ts
import { describe, expect, it } from "vitest";
import { useTmpStudioDir } from "@/tests/helpers/tmp-dir";
import { putBlob, releaseBlob, blobExists } from "./blobStore";

describe("blobStore", () => {
  // Each test gets a fresh tmp STUDIO_DATA_DIR, auto-cleaned afterward.
  useTmpStudioDir();

  it("dedupes identical content", async () => {
    const a = await putBlob(Buffer.from("same"), "txt");
    const b = await putBlob(Buffer.from("same"), "txt");
    expect(a.hash).toBe(b.hash);
  });

  it("garbage-collects when refcount hits zero", async () => {
    const { hash } = await putBlob(Buffer.from("alone"), "txt");
    await releaseBlob(hash);
    expect(await blobExists(hash)).toBe(false);
  });
});
```

The helper handles tmp dir creation + `STUDIO_DATA_DIR` env override + cleanup. Use it for any test that exercises the storage layer.

## Anatomy of a workflow service test

`workflowService.test.ts` is the reference for testing services with sensitive-data sanitization. Two patterns to copy:

1. **Build a realistic workflow with sensitive fields** in a test factory, then assert those fields are stripped after `exportWorkflow()`.
2. **Round-trip** export → import → export and assert structural equivalence.

```ts
it("strips LLM apiKey via plugin sanitizeForExport hook", async () => {
  const wf = await createWorkflow(makeWorkflowInput());
  const bundle = await exportWorkflow(wf.id);
  const llmNode = bundle.workflow.nodes.find((n) => n.id === "llm-1");
  expect(llmNode!.data.apiKey).toBeUndefined();
});
```

## Testing your plugin

If you're adding a new node plugin (see [`docs/PLUGIN-API.md`](./PLUGIN-API.md)), add a test file next to its `executor.ts`:

```
plugins/builtin/your-node/
├── manifest.ts
├── executor.ts
├── executor.test.ts   ← here
└── Component.tsx
```

A minimal executor test:

```ts
// plugins/builtin/your-node/executor.test.ts
import { describe, expect, it } from "vitest";
import { executor } from "./executor";

const ctx = {
  runId: "test-run",
  projectId: null,
  workflowId: "test-wf",
  mode: "test" as const,
  abortSignal: new AbortController().signal,
  outputsDir: "/tmp/test",
  emit: async () => {},
};

describe("yourNode executor", () => {
  it("does the thing", async () => {
    const result = await executor.execute(
      ctx,
      { value: "input" },
      { kind: "yourNode", label: "Your Node", /* your data */ }
    );
    expect(result.output).toBe("expected");
  });

  it("throws on missing required input", async () => {
    await expect(
      executor.execute(ctx, {}, { kind: "yourNode", label: "Your Node", required: true })
    ).rejects.toThrow(/required/i);
  });
});
```

## Mocking external services

For tests that need to exercise an executor that calls ComfyUI or an LLM provider, use `vi.mock()` to swap the client:

```ts
import { vi } from "vitest";

vi.mock("@/lib/server/providers/comfyui/client", () => ({
  ComfyClient: vi.fn().mockImplementation(() => ({
    submitPrompt: vi.fn().mockResolvedValue({ prompt_id: "fake-id" }),
    // ... other methods you need
  })),
}));
```

**Don't mock our own services** (assetService, workflowService, etc.). Those tests should run against tmp dirs.

## Coverage

`npm run test:coverage` generates `coverage/index.html`. Open it in a browser to see line-by-line coverage.

We don't enforce a coverage floor — that creates perverse incentives (people write trivial tests to hit the number). What matters is **meaningful coverage on critical paths**:

- ✅ Sanitization logic
- ✅ Path-traversal defense
- ✅ Refcount / GC math
- ✅ Type validation + parsers
- ✅ Bundle import validation
- ⚠️ UI components — selective; don't bother with most of them
- ⚠️ Glue code — usually low ROI

## Pre-PR checklist

Before opening a PR, run:

```bash
npm run check
```

This is **lint + type-check + test** in one command. If anything fails, fix it before pushing. CI will run the same pipeline; running locally first saves a round-trip.

For PRs that touch:

- **A new plugin** — add `executor.test.ts` covering happy path + error paths.
- **A service** — add tests covering the new behavior (look at `workflowService.test.ts` as reference).
- **Sanitization or security-relevant code** — add explicit tests for the negative case (malicious input rejected, secrets stripped, etc.).
- **A bug fix** — add a regression test that fails on `main` and passes on your branch. This is non-negotiable for bug fixes — without it, the bug is one merge away from coming back.

## What we *don't* test (and why)

- **React Server Components** — running RSCs in Vitest is friction without a clear benefit. Their behavior is data-flow, which we test at the service layer.
- **Most React components** — tests of `<button onClick={...}>` rarely catch real bugs. We test primitives (`Callout`, `Select`) and skip the rest. E2E covers the integrated UX.
- **Next.js routing** — Next handles this. We test the route handler functions directly when needed.
- **TypeScript types alone** — `npm run build` already type-checks. We don't write tests like `expect(x as never).toBe(...)`.

## Patterns we use

### Path aliases

`@/*` resolves to the repo root in both source and tests:

```ts
import { putBlob } from "@/lib/server/blobStore";
import { useTmpStudioDir } from "@/tests/helpers/tmp-dir";
```

### Registry isolation

Plugin registries (`manifestRegistry`, `executorRegistry`, `nodeComponents`) are global singletons. Tests that exercise them must clear between runs:

```ts
import { __clearRegistryForTests, registerManifest } from "@/lib/plugins/manifestRegistry";

beforeEach(() => {
  __clearRegistryForTests();
});
```

### Fake timers

For polling / timeout / retry logic, use Vitest's fake timers:

```ts
import { vi } from "vitest";

it("retries after 100ms", async () => {
  vi.useFakeTimers();
  const promise = retryingFn();
  await vi.advanceTimersByTimeAsync(100);
  expect(await promise).toBe("ok");
  vi.useRealTimers();
});
```

### Property-based tests

For heuristics with broad input space, `fast-check` is available:

```ts
import * as fc from "fast-check";

it.skip("introspection never throws on arbitrary JSON", () => {
  fc.assert(
    fc.property(fc.json(), (json) => {
      expect(() => introspectWorkflowApiJson(json)).not.toThrow();
    })
  );
});
```

(Currently used selectively — it's not the default.)

## Adding a new test file

1. Put it next to the source it tests, named `<source>.test.ts`.
2. Run `npm test -- <your-file>` to verify it discovers + passes.
3. Run `npm run check` to make sure you haven't broken anything else.
4. Open your PR.

That's it. No framework registration, no test config edits, no per-test boilerplate.

## CI

`.github/workflows/ci.yml` runs on every push + PR:

- `lint-and-build` job: `npm run lint && npm run build`
- `test` job: `npm test`

Both run in parallel. The PR can't merge until both are green.

There's no nightly build, no scheduled E2E, and no separate environments. Keeping CI simple = keeping it fast and reliable.

## Where to dig next

- [`lib/server/storage.test.ts`](../lib/server/storage.test.ts) — minimal unit-test pattern
- [`lib/server/blobStore.test.ts`](../lib/server/blobStore.test.ts) — integration-test pattern with `useTmpStudioDir`
- [`lib/server/workflowService.test.ts`](../lib/server/workflowService.test.ts) — service-level tests with sensitive-data assertions
- [`lib/plugins/connectionValidation.test.ts`](../lib/plugins/connectionValidation.test.ts) — registry-isolation pattern
- [`tests/helpers/tmp-dir.ts`](../tests/helpers/tmp-dir.ts) — the file/state isolation helper
- [`vitest.config.ts`](../vitest.config.ts) — the runner config (path aliases, coverage, env)
