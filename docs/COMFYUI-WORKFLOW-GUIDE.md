# ComfyUI Workflow Guide

> **Audience**: anyone who wants to take a ComfyUI workflow and make it runnable from inside ComfyUI AI Studio. No prior knowledge of the studio assumed — only that you can run a workflow in ComfyUI itself.

The studio doesn't replace ComfyUI's node graph. It **wraps** a workflow you already trust into a clean, reusable endpoint that other people (and your future self) can call from a prompt composer without reading any spaghetti.

This guide is the 5-minute path: from a working ComfyUI workflow to "Generate" in the studio.

---

## What you'll do

1. Connect ComfyUI AI Studio to your ComfyUI server.
2. Export a `workflow_api.json` from ComfyUI.
3. Register that JSON as an **endpoint** in the studio.
4. Let the studio **introspect** the JSON to suggest input/output mappings.
5. Build a small canvas workflow that uses your endpoint.
6. Run it from a project's composer.

---

## 0. Prerequisites

- ComfyUI running somewhere — local at `http://127.0.0.1:8188` is the easiest. Remote (over the network with bearer auth, or the Comfy Org API) also works.
- A ComfyUI workflow you've **already verified runs in ComfyUI itself**. Don't try to debug a broken workflow through the studio's lens — fix it upstream first.
- The studio installed and running ([README — Getting Started](../README.md#getting-started)).

> 💡 **No workflow yet?** We've bundled four ready-to-use examples in [`docs/examples/comfyui-workflows/`](./examples/comfyui-workflows/) — grab one. They cover image, video, and audio generation.

---

## 1. Connect to ComfyUI

In the studio: **Settings → ComfyUI → Add Environment**.

| Field | Value |
|---|---|
| Name | "Local ComfyUI" (or whatever — purely cosmetic) |
| Type | **Local** if ComfyUI is on the same machine, **Remote** otherwise |
| Base URL | `http://127.0.0.1:8188` for local. Use the actual hostname/port for remote. **No trailing slash, no `/api` suffix.** |
| Auth mode | `None` for a vanilla local server. `Bearer` for a remote server you've put behind an auth proxy. `Comfy Org Key` if you're using the official ComfyUI Cloud API. |
| API Key | Required for `bearer` and `comfy-org-key`. |

Save. The environment is now persisted under `.studio-data/comfy-environments/<envId>/env.json`.

The bottom-left **status widget** in the sidebar will start polling `/system_stats` every 30 seconds (configurable in **Settings → ComfyUI → Health Check**). You should see:

- ✅ **Connected** + a latency reading
- Live **CPU / RAM / VRAM / Disk** meters (host CPU + disk only show for `type: "local"` — they wouldn't be meaningful for a remote server)
- The GPU device name when ComfyUI exposes one

If you see ❌ Disconnected:
- Confirm ComfyUI is actually up — `curl http://127.0.0.1:8188/system_stats` should return JSON
- Check the auth mode + API key
- Look at the dev server console — the `/health` route logs probe failures

---

## 2. Export `workflow_api.json` from ComfyUI

This is a **ComfyUI** step, not a studio step. The studio reads the same prompt JSON that ComfyUI uses internally.

In ComfyUI:

1. Open **Settings** → enable **"Enable Dev mode Options"**.
2. Build (or load) the workflow you want to expose.
3. Run it once to make sure it actually works.
4. Click the new **`Save (API Format)`** button. You'll get a `<workflow-name>_api.json` file.

This file is what the studio cares about — not the regular workflow JSON. The two are different shapes:

| File | Contains | Used by |
|---|---|---|
| Regular workflow JSON | UI layout, node positions, group boxes | ComfyUI editor |
| `workflow_api.json` | Just the prompt graph: nodes keyed by id, with `class_type` and `inputs` | The studio (and ComfyUI's `/prompt` endpoint) |

The API-format file looks roughly like:

```json
{
  "3": {
    "class_type": "KSampler",
    "inputs": { "seed": 12345, "steps": 20, "model": ["4", 0], "positive": ["6", 0], ... }
  },
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "a portrait of a cat", "clip": ["4", 1] }
  },
  "9": {
    "class_type": "SaveImage",
    "inputs": { "filename_prefix": "ComfyUI", "images": ["8", 0] }
  }
}
```

Two important shape rules the studio relies on:
- **Inputs are either literal values** (`"text": "a portrait of a cat"`) **or wires to other nodes** (`"images": ["8", 0]` means "node 8, output index 0").
- **A node is a "user input candidate" when its primary parameter is a literal**, not a wire. The studio's introspection uses this to decide what to expose.

---

## 3. Register the endpoint in the studio

Back in **Settings → ComfyUI**, expand the environment card → **Add endpoint**.

Fill in:

| Field | Value |
|---|---|
| Name | A short label, e.g. "Z-Image Turbo Text-to-Image" |
| Description | One line about what this endpoint does. Optional but appreciated by future-you. |
| `workflow_api.json` | Paste the entire JSON file content. |

Click **Introspect**. The studio reads the JSON and suggests:

- **Inputs** — every node whose class is in the known input set (`CLIPTextEncode`, `LoadImage`, `EmptyLatentImage`, etc.) **and** whose primary parameter is a literal. Each becomes an `studioPort` (the handle name on the canvas) with a guessed type.
- **Output** — the terminal node (no outgoing edges). `SaveImage` → image, `VHS_VideoCombine` → video, `SaveAudio` → audio, etc.
- **Notes** — warnings if anything was ambiguous (multiple terminal nodes, missing labels).

### Reviewing the suggestions

You'll see a table of suggested inputs. For each one, decide:

- **Studio port** — a short, readable name (`prompt`, `negative`, `seed`, `image`, `width`). This is what shows up as the node handle on the canvas.
- **Label** — a longer human description. Surfaced in the inspector.
- **Type** — `text`, `number`, `boolean`, `image`, or `select`.
- **Required** — whether the workflow refuses to run without this input. The composer will warn the user.
- **Comfy node id** — the id in the JSON, prefilled.
- **Comfy input path** — usually a single field like `text`, `image`, `seed`. The studio writes the user's value into `nodes[<comfyNodeId>].inputs[<comfyInputPath>]` at run time.

For the output, confirm the node id and the **history field** — usually `images` for `SaveImage`, but some custom nodes use `video`, `audio`, or `files`.

Save. The endpoint is persisted under `.studio-data/comfy-environments/<envId>/endpoints/<endpointId>/{endpoint.json, workflow_api.json}`.

> 💡 **Improving the heuristic**: introspection is intentionally conservative. If you spot patterns it should pick up automatically, the heuristic lives in [`lib/server/workflow/introspect.ts`](../lib/server/workflow/introspect.ts) — it's a great first contribution.

---

## 4. Build a workflow on the canvas

`Workflows → New Workflow`. Name it something memorable.

Drag from the left **Node Library**:

1. **Source → Text Input** — where the user's prompt comes in
2. **ComfyUI → ComfyUI** — drop one and select your endpoint from the dropdown on the node
3. **Utilities → Save Output** — promotes the result to a project asset

Wire `Text Input → ComfyUI.prompt → Save Output`. The handles on the ComfyUI node are dynamically generated from the input bindings you set during introspection — that's why a `prompt` handle exists.

The colored outline of each node hints at its type — purple for text, cyan for image, orange for ComfyUI, green for save. See [`design.md`](../design.md) for the full convention.

Save the workflow.

---

## 5. Run it

Two paths:

### A. Test Run (workflow editor)

Click **Test Run** in the workflow toolbar. This runs the workflow without a project context. Test runs:

- Live under `.studio-data/runs/<runId>/`
- **Don't** promote outputs to project assets (output stays in the run's `outputs/` directory)
- For Image Input nodes, you must pin a test asset via `data.testAssetRef` on the node (set this in the inspector)

Test runs serialize amongst themselves but **never block project runs**, so you can test while a real generation is happening.

### B. Generate (project composer)

Open any project (or create one). The composer at the bottom has a workflow dropdown — pick yours. Type a prompt, hit **Generate**.

What happens under the hood:

1. `POST /api/workflow-runs` with `{ mode: "project", projectId, workflowId, inputs }` returns `{ runId }`
2. The browser opens an SSE connection to `/api/workflow-runs/<runId>/events`
3. The runtime topo-sorts the DAG, executes node by node:
   - Text Input → reads from `inputs`
   - ComfyUI → patches `workflow_api.json` with input values, opens a WebSocket to ComfyUI's `/ws?clientId=<runId>`, posts to `/prompt`, relays progress
   - On `execution_success` → fetches outputs via `/history` + `/view`
   - Save Output → promotes binaries to project assets
4. The composer's "Generating..." chip closes when `run.completed` arrives
5. The new asset appears in the gallery with `source: "workflow"` provenance

If anything fails, the per-node state badge on the canvas turns red and the SSE stream emits a `node.failed` event with the error.

---

## Common gotchas

### "ComfyUI rejected prompt: ..."

ComfyUI's `/prompt` endpoint validates the graph before queueing. If you see this, the patched `workflow_api.json` is malformed in some way. Common causes:

- **Wrong type written**: writing a string into an integer field, or vice versa. Check the input's type matches the ComfyUI field.
- **Missing required input**: an input that ComfyUI considers required wasn't connected and didn't have a literal default. Mark it as `required: true` so the composer warns the user.
- **Image not uploaded**: the studio uploads images via `/upload/image` before submitting. If the upload fails, the prompt will reference a filename that doesn't exist.

### "Probe timed out after 5000ms"

The health check has a 5-second timeout. If ComfyUI takes longer than that to respond to `/system_stats`, the widget will show Disconnected. This usually means ComfyUI is busy with a heavy workflow — generally not a real problem.

### Test Run says "Image input is required but no test asset is pinned"

Image Input nodes in test mode need a `data.testAssetRef = { projectId, assetId }` pointing at a real asset. The inspector has a picker for this. In project mode this isn't an issue because the upstream `composerReferencedAssets` chip provides the asset.

### My output isn't promoted to a project asset

Check that:
- You're using **Generate** (project mode), not **Test Run**
- A **Save Output** node is downstream of the ComfyUI node
- The Save Output node's "promote to project" toggle is on

### Multiple ComfyUI envs and only one of them works

Only one environment can be active at a time (single-active invariant enforced server-side). The currently active one is what the runtime hits. Set active in **Settings → ComfyUI** by clicking the star icon on the env card.

---

## Where to dig next

- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — full architecture deep-dive, including the workflow runtime internals
- [`lib/server/workflow/introspect.ts`](../lib/server/workflow/introspect.ts) — the introspection heuristic
- [`lib/server/providers/comfyui/client.ts`](../lib/server/providers/comfyui/client.ts) — every HTTP/WS call to ComfyUI
- [`docs/examples/comfyui-workflows/`](./examples/comfyui-workflows/) — reference `workflow_api.json` files

If something in this guide is wrong or unclear, please [open an issue](../../../issues/new/choose) or send a doc PR — these guides only stay good if the community keeps them honest.
