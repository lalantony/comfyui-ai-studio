# Plugin Cookbook

Copy-paste recipes for common plugin patterns. Each recipe walks one of the built-in plugins as a teaching example.

> **Read [`PLUGIN-API.md`](./PLUGIN-API.md) first** for the type reference and the three-file contract.

---

## Recipe 1: Static input node

**Pattern**: a leaf node that emits a value with no upstream inputs.

**Example**: `plugins/builtin/text-input/`

**When to use**: any node that's a *source* of data — composer-fed inputs, static values, environment lookups.

```ts
// manifest.ts
export const manifest: NodeManifest<TextInputData> = {
  kind: "textInput",
  displayName: "Text Input",
  category: "source",
  accent: "purple",
  icon: "Type",
  inputs: [],                                  // no inputs
  outputs: [{ id: "output", label: "text", type: "text" }],
  defaultData: () => ({ kind: "textInput", label: "Text Input", testValue: "" }),
  executable: true,
};
```

```ts
// executor.ts
export const executor: NodeExecutor<TextInputData> = {
  async execute(_ctx, inputs, data) {
    // Source nodes get their value from `inputs.value` (injected by the
    // runtime from the run's initial `inputs[nodeId]`) or fall back to data.
    const fromRun = typeof inputs.value === "string" ? inputs.value : undefined;
    return { output: fromRun ?? data.testValue ?? "" };
  },
};
```

---

## Recipe 2: Pass-through transform

**Pattern**: takes a value in, transforms it, emits the result.

**Example**: `plugins/builtin/text-combine/`

**When to use**: most "operator" nodes — string manipulation, format conversion, value coercion.

```ts
inputs: [
  { id: "a", label: "a", type: "text" },
  { id: "b", label: "b", type: "text" },
],
outputs: [{ id: "output", label: "result", type: "text" }],
```

```ts
async execute(_ctx, inputs, _data) {
  const a = String(inputs.a ?? "");
  const b = String(inputs.b ?? "");
  return { output: a + b };
}
```

Note: don't make inputs required unless you really need them. Empty string defaults make pipelines forgiving.

---

## Recipe 3: Branching / null-routing

**Pattern**: emits a value on one of multiple output handles. Other handles emit `null`. Downstream nodes that receive `null` on every incoming edge are auto-skipped by the orchestrator.

**Example**: `plugins/builtin/condition/`

**When to use**: anywhere the workflow needs to make a decision and route data accordingly.

```ts
outputs: [
  { id: "true", label: "true", type: "any" },
  { id: "false", label: "false", type: "any" },
],
```

```ts
async execute(_ctx, inputs, data) {
  const value = inputs.input;
  const pass = checkPredicate(value, data.predicate);
  return {
    true: pass ? value : null,    // ← null routes downstream skip
    false: pass ? null : value,
  };
}
```

The runtime's null-routing semantics: a downstream node receiving `null` from *every* incoming edge is marked `skipped` and never executed; its outputs are also `null`, cascading the skip.

---

## Recipe 4: Long-running with progress events

**Pattern**: a node that takes seconds-to-minutes and should show live progress on the canvas.

**Example**: `plugins/builtin/llm/`

**When to use**: LLM streaming, ComfyUI generation, anything async with intermediate state worth surfacing.

```ts
async execute(ctx, inputs, data) {
  const stream = provider.stream({ /* ... */, abortSignal: ctx.abortSignal });
  let accumulated = "";
  let lastEmit = 0;

  for await (const chunk of stream) {
    if (ctx.abortSignal.aborted) throw new Error("Cancelled");
    accumulated += chunk.text;

    // Throttle to ~10 Hz — the canvas re-renders on every emit.
    const now = Date.now();
    if (now - lastEmit >= 100) {
      lastEmit = now;
      await ctx.emit({
        type: "node.progress",
        runId: ctx.runId,
        nodeId: "",                            // runtime fills this in
        partialText: accumulated,
        progress: chunk.percent,               // 0-1, optional
        message: chunk.label,                  // optional
      });
    }
  }

  // Always emit a final progress event so the UI sees the last bytes.
  await ctx.emit({
    type: "node.progress",
    runId: ctx.runId,
    nodeId: "",
    progress: 1,
    partialText: accumulated,
  });

  return { output: accumulated };
}
```

**Two rules** for streaming nodes:
1. **Throttle progress** to ~10 Hz. Emitting on every byte murders frame rate.
2. **Always check `abortSignal`** at every yield point. Users will hit Cancel.

---

## Recipe 5: Dynamic handles

**Pattern**: input handles depend on runtime configuration (selected endpoint, parsed template, etc.) rather than being statically declared.

**Example**: `plugins/builtin/comfyui/` (handles from selected endpoint), `plugins/builtin/text-combine/` (handles from `{token}` parsing).

**When to use**: when handle count or type is data-driven.

```ts
// manifest.ts — declare base/zero handles
inputs: [],   // dynamic; Component renders them

// Component.tsx
function MyNode({ id, data }: NodeProps<MyData>) {
  const handles = useMemo(() => extractHandles(data.config), [data.config]);

  return (
    <div>
      {/* ... node body ... */}
      {handles.map((h, i) => (
        <Handle
          key={h.id}
          type="target"
          position={Position.Left}
          id={h.id}
          style={{ left: -5, top: `${(i + 1) / (handles.length + 1) * 100}%` }}
        />
      ))}
    </div>
  );
}
```

The runtime is permissive — it accepts any upstream value keyed by any handle id, even ones not in the manifest. So dynamic handles "just work" for routing.

---

## Recipe 6: Asset producer (writes to project)

**Pattern**: produces a binary that becomes a project asset.

**Example**: `plugins/builtin/save-output/`

**When to use**: any node that's the sink of generation work — image/video/audio outputs.

```ts
async execute(ctx, inputs, data) {
  const buffer = /* ...produce bytes... */;
  const isTest = ctx.projectId === null;

  if (isTest) {
    // Write to ctx.outputsDir; surfaced via the test-run output panel.
    await fs.writeFile(path.join(ctx.outputsDir, "result.png"), buffer);
    return { savedFile: { filename: "result.png", name: "result.png", type: "image", mime: "image/png" } };
  }

  // Project mode — promote to an asset (sidecar + blob, with provenance).
  const asset = await createAsset(ctx.projectId!, {
    type: "image",
    name: "result.png",
    content: buffer,
    extension: "png",
    source: "workflow",
    workflowRunId: ctx.runId,
  });
  await recountProject(ctx.projectId!);
  return { savedAssetId: asset.id, asset };
}
```

The test/project mode split is invariant — your executor must handle both. `createAsset` writes through the content-addressable blob pool, so identical bytes from re-running a deterministic workflow occupy disk once.

---

## Recipe 7: Inert / decorative

**Pattern**: a node that exists only on the canvas. No execution.

**Example**: `plugins/builtin/note/`

**When to use**: documentation blocks, group labels, anything that's pure annotation.

```ts
// manifest.ts — set executable: false, omit handles
{
  kind: "note",
  /* ... */
  inputs: [],
  outputs: [],
  executable: false,                          // ← runtime skips this kind
}
```

**No `executor.ts` file needed.** Skip it. The runtime walks past inert nodes without resolving them.

---

## Recipe 8: Sensitive data sanitization

**Pattern**: your node's data has API keys, local IDs, or anything machine-specific that must be stripped on workflow export.

**Example**: `plugins/builtin/llm/` (apiKey), `plugins/builtin/comfyui/` (endpointId), `plugins/builtin/image-input/` (testAssetRef).

```ts
export const manifest: NodeManifest<MyData> = {
  // ...
  sanitizeForExport: (data) => ({
    ...data,
    apiKey: undefined,                        // critical
    localId: null,                            // local-only reference
  }),
};
```

This hook runs on every node before bundling for export. The exported workflow is safe to share publicly. **Implement it** if you have any sensitive fields — the export pipeline's safety net catches obvious cases but isn't a substitute.

---

## Recipe 9: Validation

**Pattern**: catch malformed `data` blobs at registration time and inline in the inspector.

```ts
validateData: (data) => {
  const errors: string[] = [];
  if (!data || typeof data !== "object") return ["data must be an object"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  if (!d.model?.trim()) errors.push("model is required");
  if (typeof d.temperature !== "number" || d.temperature < 0 || d.temperature > 2) {
    errors.push("temperature must be a number between 0 and 2");
  }
  return errors.length > 0 ? errors : null;
},
```

The runtime calls this before executing. The inspector calls this on every change to surface errors inline.

---

## Recipe 10: Reading another asset

**Pattern**: your executor needs to read a project asset's bytes (for vision input, format conversion, etc.).

```ts
import { getAssetBinary } from "@/lib/server/assetService";

async execute(ctx, inputs, _data) {
  if (!isAssetRef(inputs.image)) return { output: null };
  const ref = inputs.image as { assetId: string; projectId: string };

  const bin = await getAssetBinary(ref.projectId, ref.assetId);
  if (!bin) throw new Error(`Could not read asset ${ref.assetId}`);

  // bin = { buffer: Buffer, mime: string, filename: string }
  return { output: { bytes: bin.buffer, mime: bin.mime } };
}
```

`getAssetBinary` handles the legacy + content-addressable storage path internally. Don't reach into the filesystem yourself.

---

## Recipe 11: Multi-stage chain (transit-as-AssetRef)

**Pattern**: your executor produces a binary that needs to flow into the *next* executor — typically multiple ComfyUI calls in series (`upscale → faceswap → upres again`).

**Example**: `plugins/builtin/comfyui/executor.ts`

**Why**: a 10-stage chain shouldn't carry tens-of-MB buffers through your run aggregator, and the user should *see* every intermediate output the moment it lands — both because they may want to bail out early ("first frame already looks wrong") and because partial-failure runs leave half the work salvaged in the gallery.

**Two transit shapes** — pick one consistently per executor:

```ts
// AssetRef (project mode default): cheap to pass around. Downstream
// executors load bytes from the blob pool only when they actually need them.
type AssetRefValue = { assetId: string; projectId: string; type?, name?, mime? };

// BytesRef (test mode + opt-out): for short-lived runs that never touch
// the asset gallery — keeps everything in-memory.
type BytesRefValue = { bytes: Buffer; mime?: string; name?: string; type? };
```

**Producer side** — auto-save in project mode, fall back to bytes in test:

```ts
async execute(ctx, inputs, data) {
  const fetched = await producer.run(/* ... */);
  const shouldAutoSave =
    ctx.mode === "project" && ctx.projectId !== null && data.saveToProject !== false;

  if (shouldAutoSave) {
    const asset = await createAsset(ctx.projectId!, {
      type: outputType,
      name: filename,
      content: fetched.buffer,
      extension: ext,
      source: "workflow",
      workflowRunId: ctx.runId,
      producedByNodeId: ctx.nodeId,
    });
    await recountProject(ctx.projectId!);
    // Single-shape return: AssetRef-only.
    return {
      output: { assetId: asset.id, projectId: ctx.projectId!, type: outputType, name: filename, mime: fetched.mime },
      savedAssetId: asset.id,
    };
  }

  // Test mode (or explicit opt-out): legacy bytes shape.
  return {
    output: { bytes: fetched.buffer, mime: fetched.mime, name: filename, type: outputType },
  };
}
```

**Consumer side** — accept *either* AssetRef or BytesRef on a binary input handle:

```ts
if (isAssetRef(value)) {
  const bin = await getAssetBinary(value.projectId, value.assetId);
  buffer = bin!.buffer; filename = bin!.filename; mime = bin!.mime;
} else if (isBytesRef(value)) {
  buffer = value.bytes; mime = value.mime ?? "application/octet-stream"; filename = value.name ?? "input.bin";
} else {
  throw new Error(`Expected an asset or bytes; got ${typeof value}`);
}
```

**Why both shapes** — invariant: in project mode, the canonical transit shape is AssetRef. The bytes path stays for two reasons: (1) test runs intentionally avoid the gallery; (2) executors that opt out via a `saveToProject: false` flag still produce *something* downstream consumers can swallow.

**SaveOutput is the rename helper** — when SaveOutput receives an AssetRef from an upstream that already auto-saved, it calls `renameAsset()` on the existing sidecar instead of duplicating the asset. The blob is reference-counted, so duplication would be cheap on disk anyway, but a duplicate gallery card is *visually* confusing — the user expects "the file I just saved" to be one entry, not two.

```ts
if (isAssetRef(incoming) && incoming.projectId === ctx.projectId) {
  if (!isAutoFilename) {
    await renameAsset(ctx.projectId!, incoming.assetId, finalName);
  }
  return { savedAssetId: incoming.assetId };
}
```

**The `producedByNodeId` field on AssetSidecar** — set when an executor auto-saves. Lets the UI group "stage 1 / stage 2 / final" outputs from the same run + node back to the canvas node that produced them.

**Long-running calls — race three completion signals.** The reference ComfyUI executor doesn't trust the WebSocket alone. Long sampling runs (200s+) can leave the socket idle long enough that intermediate kernels silently kill it; the producer thinks "I sent execution_success" while we never observe a `close` event. Production-grade executors that depend on a WebSocket should:
1. Listen on the WS for the natural success event.
2. **In parallel**, poll the producer's status endpoint every few seconds (`getHistory(promptId).status.completed` for ComfyUI).
3. **Also in parallel**, enforce a hard wall-clock timeout from the environment record (env-configurable; default 30 min for ComfyUI).
4. `Promise.race` the three. Whichever resolves first wins; the loser paths are torn down via a shared `AbortController`.

If you're writing a new long-running executor, study `waitForCompletion` in `plugins/builtin/comfyui/executor.ts` and copy the structure — including the WS-close behavior of *not* rejecting (it must drop out silently so polling/timeout can still win).

**Surface lifecycle in `run.log` events.** The runtime carries a `run.log` SSE event type for free-form diagnostics: `{ level: 'debug' | 'info' | 'warn' | 'error', message, nodeId?, timestamp }`. Long-running executors should emit one at every meaningful transition (call started, call completed, fallback path taken, retry, hard timeout). The test panel's Activity Log surfaces these with copy-to-clipboard so users can paste a clean timeline into bug reports — and since they're persisted to `events.ndjson`, the SSE replay still shows historical context after a reconnect.

---

## When to break out of the cookbook

If your node doesn't fit any pattern above, you might be:
- **Doing too much in one node.** Split into two.
- **Pushing UI state into the canvas.** That belongs in the inspector or composer.
- **Inventing a new runtime concept.** Discuss in an issue first — most needs are already covered by progress events + AbortSignal.

Open a discussion if you're stuck. We'd rather extend the runtime once for everyone than have ten plugins each work around the same gap.
