# Architecture

> **Audience**: contributors who want to understand how ComfyUI AI Studio is wired together before changing it. Read [`README.md`](../README.md) first if you haven't run the app yet.

## TL;DR

- **Local-first.** The filesystem under `STUDIO_DATA_DIR` (default `<repo>/.studio-data/`) is the single source of truth. There's no database server, no auth layer, no cloud round-trip. The OS file system is the trust boundary.
- **Next.js 16 App Router** — one app, two surfaces. `app/(studio)/...` mounts the UI under the studio shell; `app/api/...` exposes server routes. All API routes are dynamic (`runtime: "nodejs"`).
- **Strict separation of client and server.** Every module under `lib/server/` starts with `import "server-only";`. A stray client import becomes a build error, which is the safety net.
- **One Zustand store per domain** — never merged into a root store.
- **Workflow runtime is a real DAG executor**, not a state machine sketch. Topological sort, executor harness, AbortSignal-aware cancellation, per-key FIFO queue, SSE event bus.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack) | RSC + API routes in one binary, file-system routing aligns with our domain model |
| UI | React 19 + Tailwind v4 + ShadCN primitives | Modern, ecosystem-friendly, no design system rebuild |
| Canvas | `@xyflow/react` v12 | Battle-tested, supports custom nodes + handles |
| State | Zustand (split per domain) | Light, no provider tree, easy mental model |
| ComfyUI client | Native `fetch` + `ws` | Direct, no abstraction tax |
| Persistence | Plain JSON + binaries on disk | Local-first; portable; gitignorable |

## High-level diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser (Next.js client)                                            │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ Studio shell                                                 │    │
│  │  ├─ AppSidebar       (z-40, fixed h-screen)                  │    │
│  │  ├─ TopBar           (z-30, fixed top)                       │    │
│  │  ├─ StatusCards      (z-50, fixed bottom-left, conditional)  │    │
│  │  └─ <main>           (route group children)                  │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Stores:  useUIStore   useProjectStore   useWorkflowStore            │
│           useEnvironmentStore  useModelStore                         │
└────────────────────────────┬─────────────────────────────────────────┘
                             │  REST + multipart + SSE
┌────────────────────────────▼─────────────────────────────────────────┐
│  Next.js API routes (runtime: nodejs, force-dynamic)                 │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Services                                                       │  │
│  │  projectService   assetService   workflowService               │  │
│  │  environmentService   endpointService                          │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Workflow runtime                                               │  │
│  │  queue → topo-sort orchestrator → executors → eventBus        │  │
│  │                                                  └─ runStore  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Providers                                                      │  │
│  │  ComfyClient                LLM adapters                       │  │
│  │  (HTTP + WS)                (openai-compat, anthropic)         │  │
│  └────────────────────────────────────────────────────────────────┘  │
└────────────┬───────────────────────────────────┬─────────────────────┘
             │ filesystem                        │ HTTP + WS
             ▼                                   ▼
┌──────────────────────────────┐         ┌──────────────────────────────┐
│  STUDIO_DATA_DIR             │         │  ComfyUI server              │
│   projects/<id>/             │         │   /system_stats              │
│     assets/<id>.{ext,json}   │         │   /upload/image              │
│     runs/<runId>/            │         │   /prompt   /interrupt       │
│   workflows/<id>/            │         │   /history/<promptId>        │
│   comfy-environments/<id>/   │         │   /view?...   /queue         │
│     endpoints/<id>/          │         │   /ws?clientId=<runId>       │
│   runs/<runId>/  (test)      │         └──────────────────────────────┘
└──────────────────────────────┘
```

## Data model

All shared types live in **one barrel**: [`types/index.ts`](../types/index.ts). Reference via `@/types`. The most important shapes:

- `Project` + `Asset` (+ `AssetSidecar`) — the creative unit
- `Workflow` + `WorkflowNode` (per-node data shapes live in each plugin's `manifest.ts`; narrow via `parseNodeData()` from `@/lib/plugins/parseNodeData`)
- `WorkflowEdge` — note: `style` is React's `CSSProperties` and `sourceHandle`/`targetHandle` are `string | null | undefined` to match React Flow's emit shape
- `ComfyUIEnvironment`, `ComfyEndpoint`, `ComfyEndpointInput`, `ComfyEndpointOutput`
- `WorkflowRun` — adds `workflowHash`, `nodeOutputs`, `resumedFromRunId` for the resume path; `RunSummary` is the projection used by the Runs tab
- `RunEvent`, `NodeRunState`, `TestRunOutputFile`
- `InputSlot` (in `lib/workflow/inputContract.ts`) — the composer's pre-flight contract
- `HealthSnapshot` — output of the `/api/comfy/environments/[id]/health` probe

## Persistence layout

```
STUDIO_DATA_DIR/
├─ projects/
│  └─ <projectId>/
│     ├─ project.json
│     ├─ assets/
│     │  ├─ <assetId>.json     ← sidecar (source of truth)
│     │  └─ <assetId>.<ext>    ← optional binary (mock-seeded assets have a mockUrl instead)
│     └─ runs/                  ← project-mode runs (composer Generate)
│        └─ <runId>/
│           ├─ run.json         ← WorkflowRun snapshot
│           ├─ events.ndjson    ← append-only SSE replay log
│           └─ outputs/         ← transient binaries (SaveOutput promotes them to assets)
├─ runs/                        ← test-mode runs (workflow editor Test Run, project-independent)
│  └─ <runId>/
│     ├─ run.json
│     ├─ events.ndjson
│     └─ outputs/               ← stays here; "Save to project" promotion is a manual step
├─ workflows/
│  └─ <workflowId>/
│     └─ workflow.json          ← canvas DAG
└─ comfy-environments/
   └─ <envId>/
      ├─ env.json               ← ComfyUIEnvironment
      └─ endpoints/
         └─ <endpointId>/
            ├─ endpoint.json    ← input/output mappings
            └─ workflow_api.json ← raw ComfyUI prompt JSON
```

**Asset sidecar is the source of truth; the binary is optional.** Mock-seeded assets have `filename: null` and a `mockUrl` — the `/api/.../file` endpoint 307-redirects to that URL when there's no binary. Real (uploaded or workflow-output) assets have the binary on disk.

## API surface

All routes are `runtime = "nodejs"` and `dynamic = "force-dynamic"`. Errors are translated to HTTP via `lib/server/apiHelpers.errorToResponse`.

### Projects + assets
| Method | Route | Notes |
|---|---|---|
| GET, POST | `/api/projects` | |
| GET, PUT, DELETE | `/api/projects/[id]` | |
| GET, POST | `/api/projects/[id]/assets` | POST = multipart upload, field name `file`. **Validated against `lib/uploadPolicy.ts`** (size + MIME); 413 on rejection. |
| GET, DELETE | `/api/projects/[id]/assets/[assetId]` | |
| GET | `/api/projects/[id]/assets/[assetId]/file` | binary stream OR 307 to `mockUrl` |
| POST | `/api/projects/[id]/assets/copy` | cross-project copy with `copiedFrom` provenance |
| GET | `/api/projects/[id]/runs` | **Run history**: list project runs, newest-first |
| GET | `/api/projects/[id]/runs/[runId]` | Run detail with replayed event log |

### Workflows
| Method | Route | Notes |
|---|---|---|
| GET, POST | `/api/workflows` | |
| GET, PUT, DELETE | `/api/workflows/[id]` | |

### ComfyUI environments + endpoints
| Method | Route | Notes |
|---|---|---|
| GET, POST | `/api/comfy/environments` | POST validates `baseUrl` against `lib/server/baseUrlPolicy.ts` (SSRF allowlist). Invalid URL → 400 `InvalidBaseUrlError`. |
| GET, PUT, DELETE | `/api/comfy/environments/[envId]` | PUT with `{ setActive: true }` flips the single-active flag. Also accepts `healthCheckEnabled` + `healthCheckIntervalSec` (clamped to [5, 3600]). PUT re-validates `baseUrl` whenever url or type changes. |
| POST | `/api/comfy/environments/[envId]/health` | probes `/system_stats` + `/queue` with a 5s timeout, samples host CPU + disk for `type: "local"` envs only, persists `status` + `lastChecked`. Returns `{ snapshot: HealthSnapshot }` |
| GET, POST | `/api/comfy/environments/[envId]/endpoints` | |
| GET, PUT, DELETE | `/api/comfy/environments/[envId]/endpoints/[id]` | |
| GET | `/api/comfy/environments/[envId]/endpoints/[id]/workflow-api` | raw `workflow_api.json`, used by the edit dialog |
| POST | `/api/comfy/introspect` | helper: `{ workflowApiJson }` → `{ suggestedInputs, suggestedOutput, notes }` |

### Workflow runs
| Method | Route | Notes |
|---|---|---|
| POST | `/api/workflow-runs` | body `{ workflowId, mode, inputs, projectId? }`. `projectId` required for `mode: "project"`, must be omitted for `mode: "test"`. Returns `{ runId }`. |
| GET | `/api/workflow-runs/[id]` | current run state |
| GET | `/api/workflow-runs/[id]/events` | **SSE stream**; replays `events.ndjson`, then subscribes live. 15s `:heartbeat` comments keep the connection alive through proxies. |
| POST | `/api/workflow-runs/[id]/cancel` | sets the run's `AbortSignal`. ComfyUI executor fires `POST /interrupt` if mid-flight. |
| POST | `/api/workflow-runs/[id]/resume` | **Resume from failed step**. Validates terminal status, workflow-hash unchanged, upstream assets still on disk. Spawns a new run with `seededOutputs` from the parent. Returns `{ runId, fromNodeId, reusedNodeIds }`. 404 / 409 on validation failure. |
| GET | `/api/workflow-runs/[id]/outputs/[filename]` | streams a test-run output binary. Project-mode outputs go through `/api/projects/[id]/assets/[assetId]/file` instead. |

> **Slug constraint:** Next.js 16 forbids different slug names at the same dynamic path level. Don't introduce `[id]` under `/api/comfy/environments/` — `[envId]` is the slug there.

## Workflow runtime

The runtime turns a Studio canvas DAG into a stream of executor calls. It lives in `lib/server/workflow/`.

```
                ┌─────────────────────────────────┐
   POST run ──▶│ /api/workflow-runs (route)      │
                └────────────────┬────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────┐
                │ runtime.startRun()              │
                │  • validate mode + projectId    │
                │  • allocate runId               │
                │  • runStore.create()            │
                │  • queue.enqueue(key, execute)  │
                └────────────────┬────────────────┘
                                 │
                  per-key FIFO   │   key = "test"  or  "project:<id>"
                                 ▼
                ┌─────────────────────────────────┐
                │ orchestrator.execute(run)       │
                │  • topological sort (Kahn)      │
                │  • per node:                    │
                │    – collect upstream values    │
                │    – run executor               │
                │    – persist + emit SSE event   │
                │  • abort polling between nodes  │
                └────────────────┬────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────┐
                │ eventBus.publish(runId, event)  │
                └────────────────┬────────────────┘
                                 │
                          /events SSE handler subscribes here
```

### Per-key FIFO queue

`queue.queueKeyForRun(projectId)` returns:
- `"project:<projectId>"` for project mode → **one run per project at a time**, but different projects run in parallel
- `"test"` for test mode → **test runs serialize amongst themselves but never block project runs**

This was an explicit design decision — running tests shouldn't compete with the user's actual creative work.

### Test mode vs. project mode

Both modes share the same orchestrator. The difference is at the boundary:

| | `mode: "test"` | `mode: "project"` |
|---|---|---|
| `projectId` | `null` | required |
| Run dir | `.studio-data/runs/<runId>/` | `.studio-data/projects/<id>/runs/<runId>/` |
| Image inputs | must be pinned via `data.testAssetRef = { projectId, assetId }` on the node | resolved from upstream edges |
| SaveOutput | writes to `outputs/` only | writes to `outputs/`, then promotes to a project asset (with prompt + workflowRunId provenance) |
| Asset count | not touched | `recountProject` runs after promotion |

### Cancellation

`POST /api/workflow-runs/[id]/cancel` sets the run's `AbortSignal`. Two effects:
1. The orchestrator polls between nodes and bails out cleanly.
2. The ComfyUI executor, if mid-flight, fires `POST /interrupt` to ComfyUI so the GPU is freed quickly.

### Per-node states

Driven by SSE on the canvas via `useWorkflowStore.nodeRunStates`:
`idle` → `running` → `success | failed | cancelled | skipped`

`skipped` happens when a Condition node null-routes a branch — every downstream node in that branch is marked skipped without being executed.

### Resume from failed step

When a chain fails (or is cancelled) mid-stream, the runtime has already auto-saved every successful stage's output as a project asset *and* recorded its serializable executor result on `run.json:nodeOutputs`. Re-running from scratch would re-pay the upstream GPU cost, so the studio supports a typed resume path:

```
parent run (failed at n5)         resume request
  nodeStates: n1..n4 = success      ──▶  POST /api/workflow-runs/<parentId>/resume
                n5 = failed
  nodeOutputs: n1..n4 captured      ──▶  resumeService validates:
                                          • status ∈ {failed, cancelled}
                                          • workflowHash unchanged
                                          • mode = project (test runs unsupported)
                                          • every AssetRef in seeded outputs still resolves
                                       │
                                       ▼
                                       startRun({ ...inputs, seededOutputs, resumedFromRunId })
                                       │
                                       ▼
                                       new run; ancestors of failure-point hydrate from seeds
                                       (orchestrator skips execution for seeded nodes,
                                        emits node.started + node.completed for trail clarity)
```

`computeWorkflowHash(workflow)` covers `nodes` (id + type + data) and `edges` (id + source/target/handles), sorted into canonical order so cosmetic-only changes don't invalidate the hash. Edits that change execution shape will — by design — refuse the resume with `workflow_changed` and the user must run fresh.

### Pre-flight input contract

`lib/workflow/inputContract.ts` is the shared (client + server) module that derives the **input slot list** from a `Workflow`. A slot is `{ nodeId, kind: text|image|video, label, required, role?, isPrimary }`. The composer:

1. Calls `deriveInputSlots(workflow)` to get the contract.
2. Calls `validateComposerInputs(slots, composerState)` before submission. Each error is a specific reason ("Workflow needs 2 image inputs (1 still missing)") rather than a flat "missing input".
3. Calls `buildRuntimeInputs(slots, composerState, projectId)` to bind chips → slot node ids in declaration order. The i-th image chip fills the i-th image slot.

For workflows with ≥2 image slots, the composer renders named slot indicators (Reference / Init / Mask / custom label) with filled / required-empty / optional-empty states. Single-image workflows keep the flat chip UX (no regression).

### Executors

Each node type is a self-contained plugin under `plugins/builtin/<name>/{manifest.ts, executor.ts, Component.tsx}`. The executor is the server-side execution; manifests + components are shared client/server. See [`docs/PLUGIN-API.md`](./PLUGIN-API.md) for the contract.

| Plugin folder | Node type | Notes |
|---|---|---|
| `text-input` | Text Input | Pulls from composer / test value |
| `image-input` | Image Input | Resolves to an asset ref: project upstream → `data.testAssetRef` (test mode) |
| `video-input` | Video Input | Same shape as image-input but for videos |
| `workflow-variable` | Workflow Variable | Static text bound to the workflow |
| `text-combine` | Text Combine | Concatenates multiple text inputs |
| `condition` | Condition | Boolean routing; null-routed branch → skipped |
| `llm` | LLM | Streams tokens via the LLM provider, emits `node.progress { partialText }` throttled |
| `comfyui` | ComfyUI | The big one — see below |
| `save-output` | Save Output | Soft-deprecated (every ComfyUI stage auto-saves). Still useful to rename a ComfyUI output or save a non-ComfyUI primitive (LLM text). |
| `note` | Note | Inert — emits `node.skipped` so the canvas badge updates |

## ComfyUI integration

Lives in `lib/server/providers/comfyui/client.ts` (HTTP + WebSocket adapter) and `lib/server/workflow/executors/comfyui.ts` (node executor).

### Auth modes

| Mode | Effect |
|---|---|
| `none` | No auth headers |
| `comfy-org-key` | Injects `extra_data.api_key_comfy_org` in the `/prompt` request body |
| `bearer` | `Authorization: Bearer <apiKey>` on every HTTP request and on the WS upgrade |

### Execution flow

1. **Resolve endpoint + active environment** for the node's `data.endpointId`.
2. **Apply typed input bindings** — for each `ComfyEndpointInput`:
   - `text`, `number`, `boolean`, `select`: write the value into `workflow_api.json` at `nodes[<comfyNodeId>].inputs[<comfyInputPath>]`
   - `image`: multipart-upload via `/upload/image`, then write the returned filename into the workflow input
3. **Open WebSocket** to `/ws?clientId=<runId>` — done **before** the prompt is submitted, so we don't miss `execution_start`.
4. **Submit prompt** via `POST /prompt` with the patched workflow_api.json.
5. **Relay `progress` events** as `node.progress` on the SSE bus, throttled.
6. **On `execution_success`**, fetch outputs:
   - `GET /history/<promptId>` → find the configured output node
   - `GET /view?...` → fetch each output binary
7. Return `{ bytes, mime, name, type }[]` so downstream `saveOutput` can promote them.

### Endpoint introspection

`lib/server/workflow/introspect.ts` parses a raw `workflow_api.json` and proposes a sensible default mapping. The heuristic:

- **Inputs**: walk every node, find ones whose class is in a known "input" set (`CLIPTextEncode`, `CLIPTextEncodeSDXL`, `LoadImage`, `LoadImageMask`, `EmptyLatentImage`, etc.) **AND** whose primary parameter is a literal value (not connected to another node). Each becomes a suggested `ComfyEndpointInput` with a guessed type (text/image/number) and label.
- **Output**: find the terminal node (`SaveImage`, `VHS_VideoCombine`, `SaveAudio`, `PreviewImage`, …) — the one with no outgoing edges into another node. Suggest its `outputType` based on the class name.
- **Notes**: include warnings for ambiguous cases (multiple terminal nodes, nested groups, missing labels).

The user reviews and tweaks before saving. **Improving the heuristic is a great first contribution** — it lives in one self-contained file.

## Reliability + safety

A handful of cross-cutting modules harden the runtime against the kinds of failures that show up in real-world use (proxies cutting idle SSE, ComfyUI restarts, network blips, hand-edited config) and the basic web-app exposure (SSRF, oversized uploads).

### `lib/server/providers/util/withRetry.ts`

Generic exponential-backoff retry helper. Wraps every outbound ComfyUI HTTP call (`submitPrompt`, `getHistory`, `fetchOutputBytes`):

- 3 attempts (1s / 2s baseline, exponential)
- Retries on network errors (`TypeError`, `fetch failed`, `ECONNRESET`/`ECONNREFUSED`/`EAI_AGAIN`/`ETIMEDOUT`) and **5xx** `HttpStatusError`
- Does **not** retry on **4xx** (deterministic) or `AbortError` (caller cancelled)
- Honours an `AbortSignal` between attempts and during sleeps

### WebSocket heartbeat + one-shot reconnect

In `lib/server/providers/comfyui/client.ts`:

- Every WS gets a 15s ping / 30s no-pong → `terminate()` heartbeat on open. This catches Windows TCP zombie sockets that the OS won't surface for ~2 hours.
- On close mid-run, the comfyui executor's `waitForWsCompletion` attempts a single reconnect with the same `clientId`. If reconnect succeeds, progress events resume on the new socket; if it fails, the parallel `getHistory` polling fallback still wins the completion race.

### SSE heartbeat

`/api/workflow-runs/[id]/events` writes a `:heartbeat\n\n` SSE comment every 15s. Comments are ignored by `EventSource` clients but keep the connection alive through Cloudflare / corp NAT / proxies that drop idle TCP after 30-60s.

### `lib/server/baseUrlPolicy.ts` — SSRF allowlist

`validateBaseUrl(url, envType)` is a pure function called by:
1. `environmentService.createEnvironment` + `updateEnvironment` (saves return 400 on rejection)
2. `ComfyClient` constructor (defence-in-depth at runtime; legacy persisted envs caught here)

Blocks `file://`, `data:`, `gopher://`, etc. Type-aware:
- `type: "local"` → loopback only (127/8, ::1, localhost)
- `type: "remote"` → public addresses only; rejects RFC1918 (10/8, 172.16/12, 192.168/16), link-local (169.254/16, fe80::/10) including AWS metadata, ULA (fc00::/7), multicast, IPv4-mapped IPv6 bypasses

### `lib/uploadPolicy.ts` — upload allowlist + caps

A single `ASSET_TYPE_REGISTRY` (image / video / music) is the contract for both `POST /api/projects/[id]/assets` (server-side validation, returns 413) and `AddAssetDialog` (client-side pre-validation + `accept` attribute on the file picker). Per-type defaults: 25 MB image / 500 MB video / 100 MB music. Override per-install via `STUDIO_UPLOAD_MAX_*_MB` env vars. Contributors extend the registry to add a new MIME or type — see [`docs/UPLOAD-POLICY.md`](./UPLOAD-POLICY.md).

### `lib/server/runHistoryService.ts`

Read-side projection over `projects/<id>/runs/<runId>/run.json` → `RunSummary[]` for the project's Runs tab. Disjoint from the runtime's `runStore`: hot-path persistence vs cold-path UI reads. Workflow names are cached per-list to avoid re-reading `workflow.json` for every row.

### `lib/server/workflow/resumeService.ts`

Resume validation entry point — see [Resume from failed step](#resume-from-failed-step) above. Maps each rejection reason to a discriminated `ResumeError.code` so the API can return the right status (404 / 409) and the UI can render a clear toast.

## LLM providers

Two adapters in `lib/server/providers/llm/`:

- `openai-compat.ts` — `POST /v1/chat/completions` with `stream: true`. Covers OpenAI, OpenRouter, Together, Ollama, vLLM, and any other OpenAI-compatible endpoint.
- `anthropic.ts` — `POST /v1/messages` with native Claude streaming.

Both stream tokens; the LLM executor emits `node.progress { partialText }` throttled to ~10 Hz so the canvas doesn't paint on every token.

API keys live **per-LLM-node in `workflow.json`**. The trust boundary is the OS file system — anyone with read access to `STUDIO_DATA_DIR` has access to the keys, which is the same trust model as ComfyUI itself.

Adding a new LLM provider:
1. Implement the `LLMProvider` interface in `lib/server/providers/llm/<provider>.ts`. Reference impls: `openai-compat.ts` and `anthropic.ts`.
2. Register it in the dispatch inside `lib/server/workflow/executors/llm.ts`.

## State model

State is split per domain — one Zustand store per concern, no root store:

| Store | Owns |
|---|---|
| `useUIStore` | Sidebar collapse, active settings tab |
| `useProjectStore` | Active project, asset gallery, composer input + referenced assets, generation flag. Owns `loadProject(id)`, `uploadAsset(file)`, `removeAsset(id)`. |
| `useWorkflowStore` | Workflows, canvas nodes/edges, selection, test-run steps, inspector tabs, per-node run states. **The canvas writes back to this store via `setNodes`/`setEdges` — there is no parallel local React Flow state.** |
| `useEnvironmentStore` | ComfyUI environments (API-backed CRUD) plus per-env `healthSnapshots` populated by `runHealthCheck(id)`. |
| `useModelStore` | Legacy LLM provider configs. New design puts API keys per-node, so `/settings/models` is now a Coming Soon stub. |

## Health monitoring

The sidebar bottom widget (`components/app-shell/status-card.tsx`) is the user's live read on their ComfyUI environment.

- The polling loop is owned by `hooks/useHealthMonitor.ts`, mounted by `StatusCards`.
- Polling pauses while `document.hidden`, fires immediately on visibility return.
- After 3 consecutive failures, polling backs off to 3× the configured interval — so a downed server doesn't hammer the network.
- The widget renders **only when** an active env exists AND `healthCheckEnabled === true`. Manual refresh is always available via the button.

The `/health` route does the heavy lifting:
- `client.systemStats()` — RAM + VRAM + GPU device name + ComfyUI version
- `client.queueDepth()` — pending prompts
- `getHostMetrics()` (only for `type: "local"`) — host CPU% (250ms sample) + disk free via `fs.statfs(STUDIO_DATA_DIR)`
- 5s `AbortController` timeout for the whole probe
- Persists `status` + `lastChecked` back to `env.json`

## Adding things

### A new node type

Node types are plugins. Each plugin is a self-contained folder under `plugins/builtin/<your-node>/`:

```
plugins/builtin/your-node/
├── manifest.ts      ← metadata (kind, handles, defaults, validators)
├── executor.ts      ← server-side execution (omit for inert nodes)
└── Component.tsx    ← client-side React component for the canvas
```

Register the plugin in three bootstraps (manifest, executor, component) and you're done. See [`docs/PLUGIN-API.md`](./PLUGIN-API.md) for the full contract and [`docs/PLUGIN-COOKBOOK.md`](./PLUGIN-COOKBOOK.md) for recipes.

### A new API route
- Place it under `app/api/.../route.ts`.
- Always set `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`.
- Translate domain errors via `errorToResponse(err)` from `lib/server/apiHelpers.ts`.
- Validate IDs through `assertSafeId()` from `lib/server/storage.ts` — this is what stops path traversal.

### A new ComfyUI auth mode
Extend the union on `ComfyUIEnvironment.authMode`, then handle it in `ComfyClient.httpHeaders()` and `ComfyClient.openWebSocket()`. Update the `EnvironmentDialog` UI.

## Conventions

- **`import "server-only";`** as the first line of every `lib/server/**` module.
- **TypeScript strict mode is enforced at build time.** `npm run build` is the source of truth — `npm run dev` does not type-check.
- **Use design tokens, not raw hex.** `bg-panel`, `text-foreground`, `border-white/8`, `brand-gradient`. See [`design.md`](../design.md) for the full system.
- **No mock-seeding fallbacks.** A fresh install starts empty. The user creates entities through the UI.
- **One Zustand store per domain.** Don't merge them.
- **Default-export memoized React Flow nodes.** The whole codebase is consistent on this — don't switch one to a named export.

## Where to dig next

- [`lib/server/workflow/runtime.ts`](../lib/server/workflow/runtime.ts) — the orchestrator (now with `seededOutputs` + workflow hashing)
- [`lib/server/workflow/resumeService.ts`](../lib/server/workflow/resumeService.ts) — resume validation pipeline; clean read for understanding the run lifecycle end-to-end
- [`lib/workflow/inputContract.ts`](../lib/workflow/inputContract.ts) — pure derivation + validation; shared client/server, no `server-only`
- [`lib/server/baseUrlPolicy.ts`](../lib/server/baseUrlPolicy.ts) — SSRF allowlist with table-driven tests; easy first contribution to extend (e.g. add a new bypass guard)
- [`lib/server/workflow/introspect.ts`](../lib/server/workflow/introspect.ts) — endpoint heuristics (great first PR target)
- [`lib/server/providers/comfyui/client.ts`](../lib/server/providers/comfyui/client.ts) — every ComfyUI HTTP/WS call, with retry/heartbeat
- [`plugins/builtin/comfyui/executor.ts`](../plugins/builtin/comfyui/executor.ts) — three-path completion race + WS reconnect
- [`components/workflows/workflow-canvas.tsx`](../components/workflows/workflow-canvas.tsx) — how the React Flow surface meets our store
- [`components/projects/run-history-tab.tsx`](../components/projects/run-history-tab.tsx) — the Runs tab + Resume + Run-again UX
- [`components/app-shell/status-card.tsx`](../components/app-shell/status-card.tsx) — the conditional-render + live-data pattern, reusable for other widgets
