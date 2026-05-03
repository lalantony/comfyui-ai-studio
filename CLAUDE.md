# CLAUDE.md

You are a staff-level senior engineer and product designer and the owner of this codebase. It is production-grade — act accordingly.

Operating principles:
- Think carefully before acting. Surface trade-offs; don't hide them.
- Use parallel tools, subagents, and web search whenever they shorten the path to a correct answer.
- Read files in full. If a file is too large to read in one shot, stop and tell the user to add a refactor task to the backlog — oversized files violate our standards.
- Prefer root-cause fixes over patches. No silent workarounds, no dead code, no speculative abstractions.
- Match the scope of the request. Confirm before any destructive or shared-state action.
- Communicate like an owner: terse, specific, decision-oriented. State what you changed and why.

---

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next.js dev server on http://localhost:3200
npm run build    # Production build (TypeScript is type-checked here, not in dev)
npm run start    # Serve production build on :3200
npm run lint     # eslint . (flat config in eslint.config.mjs)
```

Port `3200` is hard-coded into the `dev`/`start` scripts. Override per-run with `npm run dev -- -p 3300`.

`npm run build` runs strict type checking; `npm run dev` does not. For correctness checks always run `build`, not just `dev`.

No test runner is configured — `package.json` has no test script and no testing libraries are installed. Don't add or invoke one unless asked.

## Load-bearing version pins

These pins exist for specific reasons; don't bump them blindly.

- **`eslint: ^9.39.4`** (not 10.x). `eslint-config-next@16` ships an `eslint-plugin-react` that crashes on ESLint 10's removed legacy context API (`contextOrFilename.getFilename is not a function`). Stay on ESLint 9.x until `eslint-plugin-react` ships a fix.
- **`next lint` is gone in Next 16.** The `lint` script calls `eslint .` directly against the flat config in `eslint.config.mjs`.
- **TypeScript strict mode is enforced at build time.** Production builds will fail on `any` mismatches, dead literal-type comparisons, etc., so don't paper over types you'll regret.

## Architecture

### Real, persisted backend for projects, assets, workflows, environments, endpoints, and runs
Everything is **persisted to disk** through API routes under `lib/server/`. Workflow execution is wired through a real DAG runtime that calls external LLM and ComfyUI providers. The FS under `.studio-data/` is the **single source of truth** — there is no mock-seed fallback in the services. A fresh install starts empty and the user creates entities through the UI.

`lib/nodeTemplates.ts` holds two static catalogs (not mock data, not seeded): the node palette (`nodeTemplates` — drives the workflow editor sidebar + drop defaults) and `imageComposerControls` (project composer right-side controls).

When adding features, **always call the API** — the only thing still mocked is the system-resource gauges in the sidebar StatusCards.

### Server-only services + folder layout

```
lib/server/
  storage.ts                      # path resolution, ID validation, ensureDir/readJson/writeJson
  projectService.ts               # projects CRUD + mock seeding
  assetService.ts                 # listAssets, getAsset(Sidecar|Binary), createAsset, deleteAsset, copyAsset
  workflowService.ts              # Studio workflow CRUD
  environmentService.ts           # ComfyUI environment CRUD + single-active invariant
  endpointService.ts              # Registered ComfyUI endpoints (per-environment)
  apiHelpers.ts                   # jsonError, errorToResponse — translate domain errors to HTTP
  workflow/
    runtime.ts                    # orchestrator (topo sort, executor harness, cancellation)
    runStore.ts                   # runs in memory + run.json/events.ndjson on disk
    eventBus.ts                   # per-runId pub/sub
    queue.ts                      # per-project FIFO queue
    introspect.ts                 # parse workflow_api.json → suggested input/output mappings
    executors/
      textInput | imageInput | workflowVariable
      textCombine | condition
      llm | comfyui | saveOutput
  providers/
    llm/
      base.ts | openai-compat.ts | anthropic.ts
    comfyui/
      client.ts                   # HTTP + WS adapter, auth dispatch, /upload/image, /view, /interrupt
```

Each module starts with `import "server-only";` so a stray client import becomes a build error. Never import these from a Client Component or shared `lib/` module that is also imported by Client Components.

Storage root is `STUDIO_DATA_DIR` (defaults to `<repo>/.studio-data`, gitignored). Layout:

```
.studio-data/
  blobs/                           # content-addressable asset binaries (dedup pool)
    <sha256>.<ext>                 # binary, one per unique content
    <sha256>.json                  # { hash, ext, size, createdAt, refCount }
  projects/<projectId>/
    project.json
    assets/<assetId>.json          # sidecar with `contentHash` pointing into blobs/
                                   # legacy assets keep <assetId>.<ext> binary in this dir
    runs/<runId>/                  # project-mode runs (composer Generate)
      run.json                     # WorkflowRun + per-node states
      events.ndjson                # append-only SSE replay log
      outputs/                     # transient binaries before SaveOutput promotes them to assets
  runs/<runId>/                    # test-mode runs (workflow editor Test Run) — project-independent
    run.json
    events.ndjson
    outputs/                       # SaveOutput writes here in test mode; served via /api/workflow-runs/[id]/outputs/[filename]
  workflows/<workflowId>/
    workflow.json                  # Studio canvas DAG
  comfy-environments/<envId>/
    env.json                       # ComfyUIEnvironment
    endpoints/<endpointId>/
      endpoint.json                # input/output mappings
      workflow_api.json            # raw ComfyUI prompt JSON
```

The asset sidecar is the source of truth; the binary is optional. New assets reference content-addressable blobs via `sidecar.contentHash` (binary lives at `blobs/<hash>.<ext>`); legacy assets predate this and keep `sidecar.filename` pointing at a per-project binary at `projects/<id>/assets/<filename>`. Mock-seeded assets have `filename: null`, `contentHash: null`, and a `mockUrl` — the `/api/.../file` endpoint 307-redirects when there's no on-disk binary.

Blob garbage collection is reference-counted (`lib/server/blobStore.ts`):
- `createAsset` calls `putBlob` (refCount++)
- `copyAsset` calls `acquireBlob` for content-hashed sources (refCount++, zero bytes copied)
- `deleteAsset` calls `releaseBlob` (refCount--; when 0 → blob deleted)
- `deleteProject` walks the project's sidecars and releases each contentHash *before* `rm -rf`-ing the directory, so refcounts stay consistent.

When changing anything in this area, the invariant is: **every blob's refCount equals the number of sidecars referencing it**. A future `verify-blobs` tool could reconcile drift if a crash leaves things inconsistent.

### API routes (all `runtime = "nodejs"`, all dynamic)
**Projects + assets**
- `GET/POST    /api/projects`
- `GET/PUT/DEL /api/projects/[id]`
- `GET/POST    /api/projects/[id]/assets` (POST = multipart upload, field name `file`)
- `GET/DEL     /api/projects/[id]/assets/[assetId]`
- `GET         /api/projects/[id]/assets/[assetId]/file` — binary stream, or 307 to `mockUrl`
- `POST        /api/projects/[id]/assets/copy` — cross-project copy with `copiedFrom` provenance.

**Workflows**
- `GET/POST    /api/workflows`
- `GET/PUT/DEL /api/workflows/[id]`

**ComfyUI environments + endpoints**
- `GET/POST    /api/comfy/environments`
- `GET/PUT/DEL /api/comfy/environments/[envId]`  (PUT with `{ setActive: true }` flips the single-active flag; PUT also accepts `healthCheckEnabled` + `healthCheckIntervalSec`, the latter clamped to [5, 3600])
- `POST        /api/comfy/environments/[envId]/health`  (probes ComfyUI `/system_stats` + `/queue` with a 5s timeout, samples host CPU + disk free for `type: "local"` envs only, persists `status` + `lastChecked`, returns a `HealthSnapshot`)
- `GET/POST    /api/comfy/environments/[envId]/endpoints`
- `GET/PUT/DEL /api/comfy/environments/[envId]/endpoints/[id]`
- `GET         /api/comfy/environments/[envId]/endpoints/[id]/workflow-api`  (raw JSON, used by edit dialog)
- `POST        /api/comfy/introspect`  (helper: `{ workflowApiJson }` → `{ suggestedInputs, suggestedOutput, notes }`)

**Workflow runs**
- `POST        /api/workflow-runs`  (body `{ workflowId, mode, inputs, projectId? }`; `projectId` required for `mode: "project"`, must be omitted for `mode: "test"`; returns `{ runId }`)
- `GET         /api/workflow-runs/[id]`  (current run state)
- `GET         /api/workflow-runs/[id]/events`  (SSE; replays `events.ndjson` then subscribes live)
- `POST        /api/workflow-runs/[id]/cancel`  (sets the run's AbortSignal; ComfyUI executor fires `/interrupt` if mid-flight)
- `GET         /api/workflow-runs/[id]/outputs/[filename]`  (streams a test-run output binary from `.studio-data/runs/<runId>/outputs/<filename>`; project-mode outputs are project assets and go through `/api/projects/[id]/assets/[assetId]/file` instead)

**Slug constraint**: Next.js 16 forbids different slug names for the same dynamic path level. `[envId]` is the slug under `/api/comfy/environments/`; do NOT introduce `[id]` at that same level or the dev server will 500.

### Route layout
Single Next.js App Router app (Next 16, React 19). All real pages live under the `app/(studio)/` route group, which mounts `app/(studio)/layout.tsx` — a chrome with `AppSidebar`, `TopBar`, and fixed `StatusCards`, sized off `useUIStore.sidebarCollapsed`.

Sidebar IA (configured in `components/app-shell/app-sidebar.tsx`):
- **Studio** — Home, Projects, Assets
- **Manage** — Workflows
- **Settings** — ComfyUI, Models, Tools, Integrations, Preferences

Old `/tools` and `/integrations` paths 308-redirect to `/settings/tools` and `/settings/integrations` (see `next.config.js`). The standalone `/models` route was removed — model config will live per-workflow inside the workflow editor. `/settings/models`, `/settings/tools`, `/settings/integrations`, and `/settings/preferences` are all Coming Soon placeholders using the same `EmptyState` pattern; replace contents incrementally.

The `+` button in the `TopBar` is **route-aware** (see `components/app-shell/top-bar.tsx`): on `/` and `/projects` it opens `NewProjectDialog`; inside `/projects/[id]` it opens `AddAssetDialog`. Other routes hide the button. When adding new contexts, keep that pattern (single primary action per route, hidden if not applicable).

The root `app/layout.tsx` hard-codes `<html lang="en" className="dark">` — the app is dark-only by design.

### Workflow runtime
The runtime turns a Studio canvas DAG into actual execution. Read the deep design in `docs/WORKFLOW-RUNTIME-PLAN.md`.

**Execution flow**:
1. Composer (project mode) or workflow editor's Test Run button POSTs to `/api/workflow-runs`
2. The orchestrator topologically sorts the graph (Kahn's algorithm; rejects cycles)
3. Per node: collect inputs from upstream edges, run the executor, persist + emit events
4. Browser subscribes to `/api/workflow-runs/[id]/events` (SSE)
5. SaveOutput nodes call `assetService.createAsset` to promote outputs to project assets

**Per-key FIFO queue**: project runs key on `project:<projectId>` (one run per project at a time, different projects run in parallel); test runs key on `test` (test runs serialize amongst themselves but never block — and aren't blocked by — project runs).

**Test runs vs. project runs**: `mode` is the discriminator. `mode: "test"` runs have `projectId: null`, store under `.studio-data/runs/<runId>/`, write SaveOutput to disk only (no project asset promotion), and require image inputs to be pinned via `data.testAssetRef = { projectId, assetId }` on the node. `mode: "project"` runs are owned by a project and behave the way the composer expects (outputs become assets, recountProject runs).

**Cancellation**: `POST /api/workflow-runs/[id]/cancel` sets the run's `AbortSignal`. The orchestrator polls between nodes; the ComfyUI executor, if mid-flight, fires `POST /interrupt`.

**Per-node states** (driven by SSE on the canvas via `useWorkflowStore.nodeRunStates`): `idle | running | success | failed | cancelled | skipped`. Skipped happens when condition node null-routing eliminates an entire branch.

**ComfyUI integration**: the `comfyui` Studio node owns an `endpointId` pointing at a registered `WorkflowEndpoint`. At execution, the executor:
1. Looks up the endpoint + active environment
2. For each typed input binding, applies the value (image type → multipart `/upload/image` first, then injects the returned filename into the workflow_api.json). Image bindings accept either an `AssetRef` (project asset, bytes loaded from the blob pool) **or** a `BytesRef { bytes, mime?, name? }` (in-memory bytes from an upstream test-mode stage).
3. Opens a WebSocket to `/ws?clientId=<runId>` *before* `POST /prompt` so we don't miss `execution_start`. The WS attaches an automatic 15s ping/pong heartbeat (`HEARTBEAT_INTERVAL_MS`/`HEARTBEAT_TIMEOUT_MS` in `lib/server/providers/comfyui/client.ts`) to detect zombie sockets that Windows TCP keepalive won't catch for ~2 hours.
4. Relays per-step `progress` events as `node.progress` SSE
5. **Races three completion signals** (`waitForCompletion` in `plugins/builtin/comfyui/executor.ts`): WS `execution_success` / `executing { node: null }`, `getHistory(promptId).status.completed === true` polled every 5s, and a hard `runTimeoutSec` ceiling (env-configurable; default 30 min, clamped [60, 7200]). Whichever fires first resolves; the others are torn down. The polling fallback is what saves us when long video runs (~200s+) leave the WS idle long enough to die silently — without it, the run hangs forever waiting for an `execution_success` that landed on a dead socket.
6. **Project mode (default)**: auto-saves the output as a project asset (sidecar tagged with `producedByNodeId` + `workflowRunId`), returns `{ output: { assetId, projectId, name, mime, type }, preview }`. **Test mode (or explicit `data.saveToProject = false`)**: writes the output to `.studio-data/runs/<runId>/outputs/<filename>` and returns `{ output: { bytes, mime, name, type }, savedFile, preview }`. The `preview` field is forwarded by the runtime onto `node.completed` so the test panel shows each stage's output the moment it lands.

**Multi-stage chain transit invariant**: when a ComfyUI node's output is wired into another ComfyUI node (or any image consumer) in project mode, the in-flight value is an `AssetRef`, not raw bytes. This means:
- Every stage of a `ComfyUI A → ComfyUI B → ...` chain shows up in the project gallery as soon as it completes (visibility for the user, recoverability for partial failures)
- Memory pressure stays flat regardless of chain length (downstream stages re-load bytes via `getAssetBinary` only when they need to upload to ComfyUI)
- `Stop` mid-flight leaves successful stages already saved
- `SaveOutput` on the end of a chain receives the AssetRef from the upstream auto-save and uses `renameAsset()` to update the existing sidecar in place (no duplicate gallery entries)

The bytes path stays for two reasons: test runs (which intentionally avoid the gallery) and explicit opt-out via the `Save to project` toggle on the ComfyUI node.

**Run-scoped diagnostics**: every WS lifecycle transition + completion-path decision emits a `run.log` SSE event (`{ level, message, nodeId?, timestamp }`). These appear live in the test-mode panel's collapsible Activity Log with copy-to-clipboard, and persist to `events.ndjson` for replay. Set `STUDIO_COMFY_DEBUG=1` to mirror them to server stdout. SaveOutput is now a soft-deprecated rename helper: every ComfyUI stage auto-saves in both modes, so the only reason to wire SaveOutput downstream is to rename a ComfyUI output to a custom filename or to handle a non-ComfyUI primitive (string from LLM, fetched URL).

**Auth modes** on `ComfyUIEnvironment`: `"none"` (no headers), `"comfy-org-key"` (injects `extra_data.api_key_comfy_org` in the `/prompt` body), `"bearer"` (`Authorization: Bearer <apiKey>` on every HTTP and WS upgrade).

**LLM providers**: OpenAI-compatible (`/v1/chat/completions` with `stream: true`) covers OpenAI, OpenRouter, Together, vLLM, Ollama. Anthropic native (`/v1/messages`) handles Claude. Both stream tokens; the LLM executor emits `node.progress { partialText }` throttled to ~10 Hz. API key lives per-LLM-node in the workflow.json (single-user trust boundary = OS file system).

### State: one Zustand store per concern
Stores in `stores/` are intentionally split by domain, not consolidated:
- `useUIStore` — sidebar collapse + active view/settings tab. (No more `rightPanelOpen` — the right project info panel was removed.)
- `useProjectStore` — active project, asset gallery, composer input, **referenced assets for `@`-mentions**, generation flag. Owns the async `loadProject(id)`, `uploadAsset(file)`, `removeAsset(assetId)` actions that hit the API.
- `useWorkflowStore` — workflows + canvas nodes/edges, selection, test-run steps, inspector tabs. **Canvas writes back here** (see workflow canvas section).
- `useEnvironmentStore` — ComfyUI environments (API-backed CRUD via `/api/comfy/environments`) plus per-env `healthSnapshots` populated by `runHealthCheck(id)`. The polling loop lives in `hooks/useHealthMonitor.ts` (mounted by `StatusCards`); it pauses on tab hidden, kicks off an immediate probe on visibility return, and falls back to a 3× backoff after 3 consecutive failures.
- `useModelStore` — legacy LLM provider configs. New design puts API keys per-node, so the standalone /settings/models page is now Coming Soon.

All are `"use client"`. Keep them split; don't merge into a single root store.

### Project detail page + floating composer
`app/(studio)/projects/[projectId]/page.tsx` is a Client Component that unwraps `params: Promise<{ projectId: string }>` via `React.use()` and calls `useProjectStore.loadProject()` in an effect.

`components/projects/prompt-composer.tsx` is rendered inside the project page but uses `position: fixed bottom-0` with a sidebar-aware left offset (`left-16` collapsed / `left-60` expanded, matching the `StatusCards` pattern). The studio layout already pads `pb-80` so content doesn't sit under the composer.

The composer supports **`@` asset mentions**:
- Typing `@` opens a Radix Popover anchored to the textarea with a searchable list (`components/projects/asset-mention-list.tsx`)
- Up/Down/Enter/Tab/Escape are wired
- On select: inserts `@asset_name` token in the textarea AND adds a structured `AssetRef` to `useProjectStore.composerReferencedAssets`
- A chip strip above the textarea renders the references with X-to-remove
- The chip array is the source of truth for IDs; the inline text is decorative

### Workflow canvas (React Flow)
`components/workflows/workflow-canvas.tsx` wraps `@xyflow/react` v12 inside a `<ReactFlowProvider>`. The `nodeTypes` map is built once at module scope from the **client-side node component registry** (`components/workflows/nodeComponents.ts`) populated by `registerBuiltinNodes.ts`. Each component is wrapped with `withRunIndicator` if its plugin is `executable`, so executable nodes get a per-node run state badge automatically.

**Plugin system** — every node type is a plugin under `plugins/builtin/<name>/` with three files:
1. `manifest.ts` — pure data, shared between client + server
2. `executor.ts` — server-only (omitted for inert nodes like Note)
3. `Component.tsx` — client-only React component

When adding a new node, follow [`docs/PLUGIN-API.md`](docs/PLUGIN-API.md) and [`docs/PLUGIN-COOKBOOK.md`](docs/PLUGIN-COOKBOOK.md). Three bootstrap files connect plugins into the running app: `lib/plugins/registerBuiltins.ts`, `lib/server/plugins/registerBuiltinExecutors.ts`, `components/workflows/registerBuiltinNodes.ts`.

**Drag-and-drop wiring** (already in place):
- `NodeLibrary.NodeItem` reads from `listManifestsByCategory()`, sets `dataTransfer` with the exported `NODE_DROP_MIME = "application/reactflow"` constant
- `WorkflowCanvasInner` handles `onDragOver`/`onDrop`, uses `useReactFlow().screenToFlowPosition()` to project, and seeds the new node's `data` from the manifest's `defaultData()` factory

**State writeback**: the canvas reads `nodes`/`edges` from `useWorkflowStore` and writes back via `setNodes`/`setEdges` on every change (using `applyNodeChanges`/`applyEdgeChanges`). The store is the source of truth; do not introduce parallel local React Flow state.

**Per-node run state** (`useWorkflowStore.nodeRunStates: Record<id, "idle"|"running"|"success"|"failed">`): drives the in-canvas progress bar + status pill rendered by `NodeRunIndicator`. The mock `runTest()` walks nodes sequentially with `setTimeout` until ComfyUI is wired in. The Test Run button on the workflow header is the only trigger — there is **no bottom panel** (it was removed). Test output renders in `<TestOutputPanel />`, stacked above `<NodeInspector />` in the right column; it auto-hides when no run has been kicked off.

Node color conventions are documented in `design.md` (text=purple, image=cyan, comfyui=orange, save=green, etc.) and should be matched when adding new node types.

### Types
All shared domain types live in a single barrel: `types/index.ts`. Reference via `@/types`.

- `WorkflowEdge.style` is typed as React's `CSSProperties` (matching `@xyflow/react`'s `Edge` shape) — don't loosen it to `Record<string, unknown>` or you'll break round-trips through `applyEdgeChanges`.
- `WorkflowEdge.sourceHandle` / `targetHandle` are `string | null | undefined` — React Flow emits `null` when there's no handle, so don't tighten to `string | undefined`.
- When seeding static catalog collections in `lib/nodeTemplates.ts`, **annotate them with the type** (e.g. `nodeTemplates: NodeTemplate[] = [...]`) — using `as const` on each item narrows union fields like `category: "source"` to a single literal and breaks downstream comparisons under strict TS.

### Styling — Tailwind v4
Tailwind v4 with CSS-first config. There is **no `tailwind.config.ts`** — all theme tokens live in `app/globals.css` inside `@theme { ... }` (`--color-*`, `--radius-*`, `--font-*`, `--animate-*`). PostCSS is `postcss.config.mjs` using `@tailwindcss/postcss`; do not add `autoprefixer` (Lightning CSS handles it) or `tailwindcss-animate` (removed — only `animate-spin` is used in app code).

Custom utilities (`brand-gradient`, `brand-gradient-hover`, `glass-panel`, `glass-panel-elevated`, `text-gradient`, `scrollbar-thin`) are defined via `@utility` directives in `globals.css`. The brand gradient (pink → orange → yellow) is the single primary-button surface across the app — apply it via `brand-gradient` and pair with a warm hover glow `shadow-[0_0_30px_rgba(255,122,69,0.45)]`. Class-based dark mode is wired via `@custom-variant dark (&:where(.dark, .dark *))`.

Design tokens become Tailwind utilities automatically (`bg-panel`, `text-foreground`, `border-white/8`, `bg-primary/60`, etc.). **Always use these tokens** rather than hex values — see `design.md` for the full palette. Path alias `@/*` → repo root (`tsconfig.json`).

ShadCN UI primitives live in `components/ui/`. Composite UI is in `components/{app-shell,projects,workflows,nodes,shared,settings}/`. Prefer extending an existing primitive over importing a new Radix package.

### Dialogs
The Radix-backed primitive is `components/ui/dialog.tsx` (`Dialog`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`). Concrete dialogs:

- `components/projects/new-project-dialog.tsx` — calls `POST /api/projects`, then `router.push` to the new project
- `components/projects/add-asset-dialog.tsx` — drag-drop + file picker, multi-file with per-file status, calls `useProjectStore.uploadAsset`
- `components/settings/environment-dialog.tsx` — used in both create and edit mode (pass `environment={env}` for edit), feeds `useEnvironmentStore.addEnvironment` / `updateEnvironment`
- `components/shared/confirm-dialog.tsx` — generic destructive-confirmation; reuse this rather than inlining new `Are you sure?` modals

Single-active invariant: `useEnvironmentStore` enforces that at most one environment has `isActive: true` via the internal `withSingleActive` helper. Do not flip `isActive` directly on a single record — always go through `setActive(id)`, `addEnvironment`, or `removeEnvironment`.

The `Asset Library` page (`/assets`) is **read-only** and exists for cross-project asset copying. Do not add delete/rename UI here — that lives only in the project view. The page lazily fetches each project's assets to render 2×2 collage cards; expanding a project shows a per-asset `Copy to...` menu that posts to `POST /api/projects/[targetId]/assets/copy`.

### ComfyUI / LLM integration — wired

The runtime fully drives both ComfyUI and LLM calls. To make a workflow runnable end-to-end:

1. **Settings → ComfyUI**: add an environment (Add Environment dialog), set its auth mode + API key
2. Inside that environment card: **Add endpoint** → paste a `workflow_api.json` exported from ComfyUI → click Introspect → review/edit the input/output mappings → save
3. In the canvas: drop a ComfyUI node, set its `data.endpointId` to the registered endpoint id (this UI step is currently inspector-only — the dropdown picker UX is the next iteration)
4. From the project composer: click Generate; the run streams progress in real time and the output asset appears in the gallery

The `assetService.AssetSidecar` records `source: "workflow"`, `workflowRunId`, and `prompt` for provenance. Test runs do NOT auto-promote — output stays in `runs/<runId>/outputs/`; "Save to project" promotes manually (planned).
