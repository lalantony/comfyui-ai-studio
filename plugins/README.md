# Plugins

This directory holds the studio's node plugins — the unit of extension for the workflow canvas. Every node type users can drop on the canvas is defined here.

```
plugins/
└── builtin/
    ├── text-input/
    ├── image-input/
    ├── workflow-variable/
    ├── text-combine/
    ├── condition/
    ├── llm/
    ├── comfyui/
    ├── save-output/
    └── note/
```

Each subfolder is **one plugin** in the three-file shape:

| File | Role |
|---|---|
| `manifest.ts` | Identity, handles, defaults, validators. Imported by both client + server. |
| `executor.ts` | Server-side execution. Omit for inert nodes (Note). |
| `Component.tsx` | Client-side React component for the canvas. |

---

## Adding a new node type

1. **Read [`docs/PLUGIN-API.md`](../docs/PLUGIN-API.md)** for the type contract.
2. **Skim [`docs/PLUGIN-COOKBOOK.md`](../docs/PLUGIN-COOKBOOK.md)** to find a recipe close to what you're building.
3. **Copy the closest existing plugin folder** as your starting template:
   - Static input → `text-input/`
   - Pass-through → `text-combine/`
   - Branching → `condition/`
   - Streaming/long-running → `llm/`
   - Dynamic handles → `comfyui/` or `text-combine/`
   - Asset producer → `save-output/`
   - Inert → `note/`
4. **Rename** files + types + the `kind` discriminator (must be unique).
5. **Register** the plugin in three bootstrap files:
   - `lib/plugins/registerBuiltins.ts` (manifest)
   - `lib/server/plugins/registerBuiltinExecutors.ts` (executor — skip if inert)
   - `components/workflows/registerBuiltinNodes.ts` (component)
6. **Test** end-to-end:
   - `npm run build` + `npm run lint` clean
   - Drag your node onto the canvas, edit fields, refresh, verify persistence
   - Run via Test Run + via project composer
   - Cancel mid-run → verify your executor honours the abort signal

7. **Document**: if your node introduces a non-obvious pattern, add a recipe to `PLUGIN-COOKBOOK.md`.

---

## Folder naming

- Folder: kebab-case (`my-node`, not `myNode` or `MyNode`)
- Component: PascalCase ending in `Node` (`MyNode`)
- Manifest export: always `manifest`
- Executor export: always `executor`
- Data interface: `<KindName>Data` (e.g. `MyNodeData`)
- `kind` discriminator: camelCase matching `^[a-z][a-zA-Z0-9]{2,31}$`

The validator runs at registration time and rejects manifests that violate these rules. Catch your typos at boot, not at run time.

---

## Naming + style

Use the design tokens from `app/globals.css`:

- Width: 224-288px (`w-56` / `w-72`)
- Header band: `bg-<accent>/10` with icon at `w-3 h-3`
- Body: `p-3 space-y-2`
- Form controls: `bg-panel-soft border border-white/10 rounded-md px-2 py-1 text-[11px]`
- Every interactive control: add `nodrag` class
- Handles: 10px (`!w-2.5 !h-2.5`) circles with 2px panel border (`!border-2 !border-panel`)

See `design.md` at the repo root for the full design system + accent token table.

---

## Conventions worth following

These are non-obvious rules learned the hard way. Your plugin will be easier to review if you observe them.

- **Default-export your component wrapped in `memo()`.** React Flow re-renders nodes frequently; memo matters.
- **Handle types match data flow types.** A `text` handle on the producer side connects to a `text` handle on the consumer side. The runtime is permissive (so it'll work cross-type), but the inspector uses these for connection validation.
- **Inputs carry semantic names.** Don't name them `input1`, `input2`. Name them what they semantically *are*: `prompt`, `system`, `image`, `seed`.
- **Throw user-actionable errors.** "Required input 'prompt' is empty — wire it from a Text Input node." not "validation failed".
- **Strip secrets in `sanitizeForExport`.** API keys, local IDs, asset references — anything machine-specific. The export pipeline has a regex safety net but it's not a substitute.

---

## Future: runtime-loaded plugins

The plugin shape is intentionally serializable (string icon names, plain manifests, no React imports in `manifest.ts`) so we can ship runtime-loaded plugins later. **That's v2 work** — current scope is built-in only.

If you're prototyping in that direction, talk to the maintainers first. The threat model needs design (sandboxing, manifest signing, capability declarations) before we ship anything that loads third-party code.
