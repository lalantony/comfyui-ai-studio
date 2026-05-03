# Contributing to ComfyUI AI Studio

Thanks for your interest in contributing! This project is built by and for the ComfyUI community — every workflow, bug report, and code change helps. This document explains how to set up your environment, what kinds of contributions we're looking for, and how to get a change merged.

> **Before you start a non-trivial change**, please open an issue or comment on an existing one to align on the approach. PRs that come out of nowhere with significant scope are hard to merge cleanly.

## Table of contents

- [Code of Conduct](#code-of-conduct)
- [Ways to contribute](#ways-to-contribute)
- [Development setup](#development-setup)
- [Project layout](#project-layout)
- [Coding standards](#coding-standards)
- [Commit + PR conventions](#commit--pr-conventions)
- [Testing your changes](#testing-your-changes)
- [Reporting bugs](#reporting-bugs)
- [Security disclosures](#security-disclosures)
- [License](#license)

## Code of Conduct

By participating in this project you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md). Be excellent to each other.

## Ways to contribute

- **Bug reports** — open an issue with a minimal reproduction. Use the bug report template.
- **Feature requests** — open an issue describing the user-visible behavior, why it matters, and (if you can) sketch how it might be built.
- **Documentation** — README clarifications, workflow recipes, architecture notes, screenshots. Docs PRs are welcome and don't usually need a prior issue.
- **Code** — bug fixes, new node types, ComfyUI integration improvements, LLM provider adapters, UI polish. Open an issue first if the change touches more than one module or alters public behavior.
- **Workflow examples** — drop a vetted `workflow_api.json` into `docs/examples/comfyui-workflows/` with a short description.

## Development setup

### Prerequisites

- **Node.js** >= 22 (we use `fs.statfs` and other modern Node APIs)
- **npm** >= 10 (bundled with Node 22)
- **A running ComfyUI instance** if you want to test end-to-end workflow execution. Local `127.0.0.1:8188` works fine; remote with bearer auth or a Comfy Org API key also works.

### Install + run

```bash
git clone https://github.com/lalantony/comfyui-ai-studio.git
cd comfyui-ai-studio
npm install
npm run dev      # http://localhost:3200
```

Hard-coded port is `3200` (see `package.json`). Override per-run with `npm run dev -- -p 3300`.

### Useful scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Next.js dev server with Turbopack on port 3200. Type checking is **not** run here. |
| `npm run build` | Production build. **This is the source of truth for type checking** — strict mode is on. |
| `npm run start` | Serve the production build on port 3200. |
| `npm run lint` | `eslint .` against the flat config in `eslint.config.mjs`. |
| `npm test` | Run the full Vitest suite (what CI runs). |
| `npm run test:watch` | Vitest in watch mode for the dev loop. |
| `npm run test:coverage` | Generate `coverage/` HTML report. |
| **`npm run check`** | **Lint + type-check + test in one command. Run this before opening a PR.** |

### Studio data

Local data (projects, assets, workflows, runs, ComfyUI envs) lives under `.studio-data/` — gitignored, never synced. You can blow it away anytime to start fresh. Override the location with the `STUDIO_DATA_DIR` env var.

## Project layout

```
app/                # Next.js App Router routes (UI + API endpoints)
  (studio)/         # Authenticated app shell (sidebar + topbar)
  api/              # Server-only API routes
components/         # React components, organized by domain
  app-shell/        # Sidebar, topbar, status widget
  projects/         # Project gallery + composer
  workflows/        # Canvas, node library, inspector
  nodes/            # Custom React Flow nodes
  shared/           # App-specific reusable surfaces (panels, buttons)
  ui/               # ShadCN-style primitives (button, dialog, select, switch)
  settings/         # Settings dialogs + lists
hooks/              # Cross-cutting hooks (useHealthMonitor, useNodeUpdate)
lib/
  server/           # `import "server-only"` modules (services, runtime, providers)
  nodeTemplates.ts  # Static catalog for node palette + composer controls
  utils.ts          # cn() and small helpers
stores/             # Zustand stores, one per domain
types/index.ts      # Single barrel of shared domain types
docs/               # Public-facing docs (architecture, ComfyUI guide, examples)
```

For a deeper dive, read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). The design system lives in [`design.md`](./design.md).

## Coding standards

The repo enforces these by build:

- **TypeScript strict mode** — no `any`, no implicit returns, exhaustive checks. `npm run build` is your final say.
- **ESLint flat config** — `eslint.config.mjs`. We don't suppress rules just to ship.
- **`import "server-only"`** — the first line of every module under `lib/server/`. A stray client import becomes a build error, which is what we want.

Style guidelines that are conventions rather than enforced:

- **No mock-seeding fallbacks**. The filesystem under `.studio-data/` is the single source of truth. New entities must be created through the UI/API.
- **Don't write trivial comments**. Don't restate what the code does; only document the *why*, hidden invariants, and surprising decisions.
- **Prefer editing existing files** over creating new ones. New shared utilities go in `components/ui/` (primitive) or `components/shared/` (app-specific composed UI). Don't add a parallel "common" folder.
- **One Zustand store per domain**. Don't merge them into a root store.
- **Tailwind v4 tokens**. Use the design tokens (`bg-panel`, `text-foreground`, `border-white/8`, `brand-gradient`) — not raw hex. Tokens live in `app/globals.css` under `@theme` and `@utility`.
- **Path alias** `@/*` resolves to the repo root.

### Adding a new node type to the workflow canvas

Node types are **plugins**. Each plugin lives in its own folder under `plugins/builtin/<your-node>/` and bundles three files:

```
plugins/builtin/your-node/
├── manifest.ts      ← metadata (kind, handles, defaults, validators)
├── executor.ts      ← server-side execution (omit for inert nodes)
└── Component.tsx    ← client-side React component
```

Then register the plugin in three bootstrap files (see `plugins/README.md` for the workflow). The plugin API powers every built-in node — there is no separate "core" path.

**Read these in order:**

1. [`docs/PLUGIN-API.md`](./docs/PLUGIN-API.md) — full type reference + the three-file contract
2. [`docs/PLUGIN-COOKBOOK.md`](./docs/PLUGIN-COOKBOOK.md) — copy-paste recipes for common patterns
3. [`plugins/README.md`](./plugins/README.md) — contributor checklist + naming conventions

### Adding a new LLM provider

1. Implement the `LLMProvider` interface in `lib/server/providers/llm/<provider>.ts`. Existing reference impls: `openai-compat.ts` (OpenAI/OpenRouter/Together/Ollama/vLLM) and `anthropic.ts`.
2. Wire it into the dispatch in `lib/server/workflow/executors/llm.ts`.
3. Add a model config UI surface (this is currently per-node — see `components/nodes/llm-node.tsx`).

### Adding a ComfyUI workflow endpoint

End-users do this via the UI; the implementation lives at `lib/server/workflow/introspect.ts`. If you're improving the introspection heuristic, see [`docs/COMFYUI-WORKFLOW-GUIDE.md`](./docs/COMFYUI-WORKFLOW-GUIDE.md) for the user flow it powers.

## Commit + PR conventions

### Branches

- Branch off `main`. Use a short, descriptive branch name: `fix/health-check-z-index`, `feat/llm-google-vertex`, `docs/architecture`.

### Commits

We don't enforce Conventional Commits but they're encouraged:

```
feat: add /api/comfy/environments/[id]/health endpoint
fix(workflow-runtime): cancel ComfyUI WebSocket on AbortSignal
docs: clarify endpoint introspection heuristics
refactor(stores): split useEnvironmentStore.healthSnapshots out
```

Keep commits small and reviewable. Multiple commits per PR is fine — squash-merge is the default merge strategy.

### Pull requests

Use the PR template (auto-loaded from `.github/PULL_REQUEST_TEMPLATE.md`). At minimum your PR should include:

- **What and why** — what user-visible behavior changes, and the motivation
- **How** — high-level approach if non-obvious
- **Screenshots / GIF** for any UI change
- **Testing notes** — what you ran locally to validate

PRs that touch the workflow runtime or ComfyUI integration should also include a manual test note: which workflow you ran, against which ComfyUI version, with which auth mode.

### Review

A maintainer will review within a few days. Don't take review comments personally — we're optimizing for the long-term health of the codebase, not for any particular PR.

## Testing your changes

The project uses **Vitest** for unit + integration tests (`*.test.ts` co-located next to the source). Run the full suite with `npm test`. See [`docs/TESTING.md`](./docs/TESTING.md) for the full guide — philosophy, recipes, mocking patterns, and the pre-PR checklist.

The shorthand:

```bash
npm run check    # lint + type-check + test, all in one. Run before opening a PR.
```

When your change touches:

- **A new plugin** — add `executor.test.ts` next to it covering happy + error paths.
- **A service** — add tests to `<service>.test.ts` (use `useTmpStudioDir()` for I/O isolation).
- **Sanitization or security-relevant code** — explicit tests for the negative case (malicious input rejected, secrets stripped). See `workflowService.test.ts` as reference.
- **A bug fix** — add a regression test that fails on `main` and passes on your branch. **Non-negotiable** for bug fixes.

Manual + ComfyUI integration testing still matters for workflow-runtime / ComfyUI changes. Note your manual test plan in the PR description (which workflow you ran, against which ComfyUI version, with which auth mode).

## Reporting bugs

Use the bug report template (auto-loaded when you open an issue). Include:

- **Versions**: app commit, Node version, ComfyUI version, OS
- **Reproduction**: minimum steps + a screenshot or short clip if UI-related
- **Expected vs. actual**
- **Logs**: dev server console output for runtime errors, browser DevTools console for UI errors

## Security disclosures

Do **not** open a public issue for security-sensitive reports. See [`SECURITY.md`](./SECURITY.md) for the disclosure process.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
