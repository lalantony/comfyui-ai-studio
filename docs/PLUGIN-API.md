# Node Plugin API

> **Audience**: contributors building new node types for ComfyUI AI Studio. The same API powers every built-in node — there is no separate path for "core" vs "third-party" plugins.

A node plugin is a self-contained folder that bundles three concerns into a single unit:

```
plugins/builtin/<your-node>/
├── manifest.ts        ← metadata (shared between client + server)
├── executor.ts        ← server-side execution (omit for inert nodes)
└── Component.tsx      ← client-side React component for the canvas
```

The studio loads built-in plugins from `plugins/builtin/`. The same module shape is the foundation for runtime-loaded community plugins planned for v2.

---

## Mental model

A workflow is a DAG of nodes. The runtime walks it in topological order, calling each node's executor with its upstream inputs and getting back outputs. The canvas renders each node as a React component the user can edit.

Every node has a unique **kind** (string discriminator). The kind is the join key across:

- The plugin's manifest (declares it)
- The server-side executor registry (looks up by kind)
- The client-side component registry (looks up by kind)
- The persisted workflow JSON (every node carries its kind in `data.kind`)

If those four ever drift, things break clearly: missing components show a fallback, missing executors fail the run with a clear error.

---

## File anatomy

### `manifest.ts` — the source of truth

```ts
import type { BaseNodeData, NodeManifest } from "@/lib/plugins/types";

// 1. Declare the data shape your node persists.
export interface MyNodeData extends BaseNodeData {
  kind: "myNode";
  // ...your fields
}

// 2. Declare the manifest.
export const manifest: NodeManifest<MyNodeData> = {
  kind: "myNode",                 // unique discriminator
  displayName: "My Node",         // palette + canvas header
  description: "What it does.",   // palette tooltip
  category: "ai",                 // source | ai | comfyui | utility
  accent: "purple",               // brand accent color
  icon: "Sparkles",               // Lucide icon name (see lib/plugins/icons.ts)

  inputs: [
    { id: "value", label: "input", type: "text", required: true },
  ],
  outputs: [
    { id: "output", label: "output", type: "text" },
  ],

  defaultData: () => ({
    kind: "myNode",
    label: "My Node",
    // ...your default fields
  }),

  executable: true,
};
```

Manifests are pure data and have no React or Node imports. They're imported by both client and server bundles.

### `executor.ts` — server-side execution

```ts
import "server-only";
import type { NodeExecutor } from "@/lib/server/plugins/executorRegistry";
import type { MyNodeData } from "./manifest";

export const executor: NodeExecutor<MyNodeData> = {
  async execute(ctx, inputs, data) {
    const value = typeof inputs.value === "string" ? inputs.value : "";

    // Honour cancellation
    if (ctx.abortSignal.aborted) throw new Error("Cancelled");

    // Optional progress emission for long-running work
    await ctx.emit({
      type: "node.progress",
      runId: ctx.runId,
      nodeId: "",
      message: "doing the thing",
    });

    // Return outputs keyed by source-handle id
    return { output: value.toUpperCase() };
  },
};
```

Omit `executor.ts` entirely for inert nodes (like `Note`). Set `manifest.executable: false`.

### `Component.tsx` — the canvas UI

```tsx
"use client";
import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Sparkles } from "lucide-react";
import { useNodeUpdate } from "@/components/nodes/use-node-update";
import type { NodeProps } from "@/lib/plugins/types";
import type { MyNodeData } from "./manifest";

function MyNode({ id, data }: NodeProps<MyNodeData>) {
  const update = useNodeUpdate(id);
  // ...render
  return (
    <div className="w-64 rounded-xl bg-panel border border-white/10">
      {/* ... */}
      <Handle type="target" position={Position.Left} id="value" />
      <Handle type="source" position={Position.Right} id="output" />
    </div>
  );
}

export default memo(MyNode);
```

Default-export the component wrapped with `memo()` — React Flow re-renders nodes frequently and `memo` is meaningful.

---

## Registering your plugin

Built-in plugins are explicit imports in three bootstrap files:

| Bootstrap | What it registers |
|---|---|
| `lib/plugins/registerBuiltins.ts` | Manifest |
| `lib/server/plugins/registerBuiltinExecutors.ts` | Executor |
| `components/workflows/registerBuiltinNodes.ts` | Component |

Add three import lines + three registration calls per new plugin. See those files for the existing pattern.

---

## The `NodeManifest` reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `kind` | `string` | yes | camelCase, 3-32 chars, stable across versions. Changing this breaks every saved workflow using your node. |
| `displayName` | `string` | yes | Palette + canvas header label. |
| `description` | `string` | yes | One-line palette tooltip. |
| `category` | `NodeCategory` | yes | `"source"`, `"ai"`, `"comfyui"`, `"utility"`. |
| `accent` | `NodeAccent` | yes | Brand accent: `purple`, `cyan`, `orange`, `green`, `yellow`, `pink`, `blue`. |
| `icon` | `string` | yes | Lucide icon name. See `lib/plugins/icons.ts` for the canonical list. |
| `inputs` | `HandleDef[]` | yes | Static input handles. Use `[]` if dynamic. |
| `outputs` | `HandleDef[]` | yes | Static output handles. Use `[]` if dynamic. |
| `defaultData` | `() => D` | yes | Factory for new instances. Pure — no globals, no hooks. |
| `validateData` | `(data) => string[] \| null` | no | Aggressive shape check; runs at registration + before execute. |
| `sanitizeForExport` | `(data: D) => D` | no | Strip API keys / local refs from `data` before export. **Required** if your data has any sensitive fields. |
| `executable` | `boolean` | yes | False = inert (no executor needed). |
| `experimental` | `boolean` | no | Surfaces an "exp" badge in the palette. |
| `deprecated` | `{ reason, replacedBy? }` | no | Hidden from palette but still loads. |
| `documentationUrl` | `string` | no | Link to extended docs (cookbook recipe, etc.). |

### `HandleDef`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Used as the React Flow handle id and to route edges. Unique within the node. |
| `label` | `string` | Display label in tooltip + inspector. |
| `type` | `HandleType` | `text`, `number`, `boolean`, `image`, `audio`, `video`, `json`, `any`. |
| `required` | `boolean` | Inputs only — fail the run if no value flows in. |
| `optional` | `boolean` | UI hint for advanced inputs. |

---

## The `NodeExecutor` reference

```ts
interface NodeExecutor<D extends BaseNodeData> {
  execute(ctx: ExecutorContext, inputs: ExecutorInputs, data: D): Promise<ExecutorOutputs>;
}
```

### `ExecutorContext`

| Field | Notes |
|---|---|
| `runId` | Stable across the entire run; same in every node's context. |
| `projectId` | `string \| null` — null in test mode. |
| `workflowId` | The workflow being executed. |
| `mode` | `"test"` or `"project"`. Affects asset promotion semantics. |
| `abortSignal` | **Honour this.** The runtime sets it on cancel; long-running executors must check and bail. |
| `outputsDir` | Filesystem path for run-scoped output binaries. |
| `emit` | Publishes a SSE event. `await` for ordering guarantees. |

### `ExecutorInputs`

`Record<string, unknown>` — keyed by target-handle id. The runtime resolves upstream values (or the run's initial `inputs[nodeId]` for source nodes) and hands them in.

### Returning outputs

Return `Record<string, unknown>` keyed by **source-handle id**. The runtime feeds these into downstream nodes. Anything you return is also persisted to the run record for inspection.

### Errors

Throwing maps to a `node.failed` event with the error message. **Make messages user-actionable** — they surface in the canvas badge and the run log. Bad: `"failure"`. Good: `"Required input 'prompt' is empty — wire it from a Text Input node."`

---

## The `NodeProps<D>` shape

```ts
type NodeProps<D extends BaseNodeData> = ReactFlowNodeProps & { data: D };
```

You receive everything React Flow passes plus a typed `data: D`. Use `useNodeUpdate(id)` from `@/components/nodes/use-node-update` to mutate `data` — it routes through the workflow store correctly.

---

## Conventions + best practices

### Visual design

- Width: 224-288px (`w-56` to `w-72`). Match existing nodes in your category.
- Header: solid color band with icon + label. Use accent token classes (e.g. `bg-primary/10`).
- Handles: 10px circles (`!w-2.5 !h-2.5`) with 2px panel border. Color matches the data type flowing through.
- Nodrag: every interactive control needs the `nodrag` class so the canvas doesn't intercept drags.

See `design.md` for the full design system + tokens.

### Naming

- **Folder name**: kebab-case (`text-input`, `comfy-ui`, `save-output`).
- **Component**: PascalCase, ends with `Node` (`TextInputNode`, `ComfyUINode`).
- **Manifest exports**: `manifest`, `<KindName>Data` interface.
- **Executor exports**: `executor`.

### Handle ids

- Output nodes typically use `output` for their primary source handle.
- Input nodes typically expect `value` on a target.
- Multi-input nodes name handles by their semantic role (`system`, `user`, `image`).

### Sensitive fields

Any node data with API keys, local IDs, asset references, or anything machine-specific MUST implement `sanitizeForExport` so workflow bundles can be safely shared. The export pipeline calls this hook on every node before bundling.

```ts
sanitizeForExport: (data) => ({
  ...data,
  apiKey: undefined,           // critical
  endpointId: null,            // local-only ID
  testAssetRef: undefined,     // asset IDs are local
})
```

If you forget this and your node has secrets, the export pipeline's safety net (a regex pass for `apiKey`-shaped fields) catches the obvious cases — but don't rely on it. Implement the hook.

---

## Testing your plugin

### Automated tests (required for PRs)

Drop an `executor.test.ts` next to your `executor.ts`. See [`docs/TESTING.md`](./TESTING.md) for the full testing guide; the minimal template:

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
      { kind: "yourNode", label: "Your Node" }
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

If your plugin has a `sanitizeForExport` hook, **also add a test** asserting sensitive fields are stripped. Reference: `lib/server/workflowService.test.ts`.

Run `npm run check` before opening a PR — that runs lint + type-check + the full test suite in one shot.

### Manual checklist (also recommended)

- [ ] Drag your node from the palette onto the canvas
- [ ] Edit every editable field; refresh the page; verify the data persists
- [ ] Wire it up in a small workflow with valid inputs
- [ ] Click **Test Run** in the workflow editor → run completes successfully
- [ ] Trigger an error condition → the node turns red with your error message
- [ ] Run from a project composer → output flows through to a Save Output node correctly
- [ ] Hit Cancel mid-run → your executor honours `abortSignal`
- [ ] Export the workflow → open the `.studio-workflow.json` → verify nothing sensitive leaked

---

## Lifecycle + edge cases

### Hot reload

The registries are last-write-wins, so editing a manifest, executor, or component live in dev is safe. The canvas may need a manual page refresh to pick up component swaps because React Flow caches `nodeTypes` in its provider.

### Plugins must register before the canvas mounts

The canvas's `nodeTypes` map is computed once at module-scope from the registered components — it doesn't refresh on later registrations. If your plugin's `registerBuiltinNodes` import runs *after* the canvas module has loaded, your node won't appear in the picker until the next full reload. In practice this means: register your plugin via the side-effect imports in `lib/plugins/registerBuiltins.ts`, `lib/server/plugins/registerBuiltinExecutors.ts`, and `components/workflows/registerBuiltinNodes.ts` — not from inside an effect or a route handler. The three bootstrap files run at import time, before any canvas component renders.

### Removing a plugin

Deleting `plugins/builtin/<name>/` and removing it from the bootstraps means workflows that referenced it will load with `UnknownNodeFallback` rendering for those nodes. The runtime fails the run with "no executor registered for kind" — clear error, no silent corruption.

### Renaming a kind

**Don't.** Every saved workflow that used the old kind will break. If you must, use the deprecation path: keep the old manifest with `deprecated: { reason, replacedBy }` and write a one-time migration that rewrites `data.kind` on load.

### Dynamic handles

Some nodes (e.g. ComfyUI, Text Combine) have handles that depend on runtime config. Two patterns:

1. **Manifest declares zero/base handles** + **Component renders extras**. The runtime is permissive — it accepts any upstream value addressed by a handle id, even ones not declared in the manifest. The manifest's static handles are advisory for the inspector + connection rules.

2. **Manifest declares the maximum set** + **Component hides ones not in use**. Simpler when the set is bounded.

ComfyUI uses pattern 1 (handles depend on the selected endpoint). Text Combine uses pattern 1 (handles depend on `{token}` count in the template).

---

## Where to look next

- **`docs/PLUGIN-COOKBOOK.md`** — copy-paste recipes for common patterns.
- **`plugins/builtin/text-input/`** — simplest reference plugin.
- **`plugins/builtin/comfyui/`** — the most complex (dynamic handles, WebSocket lifecycle).
- **`plugins/builtin/llm/`** — streaming + sensitive fields (apiKey).
- **`docs/ARCHITECTURE.md`** — full studio architecture, including how the runtime drives executors.
