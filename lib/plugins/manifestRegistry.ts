/**
 * Manifest registry — single source of truth for which node kinds exist.
 *
 * Populated at module load by `registerBuiltins.ts` (and, in the future,
 * by external plugin manifests). Read by:
 *   - `parseNodeData()` to validate persisted node `data` blobs
 *   - The palette to render the node library
 *   - Workflow import to validate `requiredPlugins`
 *   - The canvas to look up component + accent for each node
 *
 * Works in BOTH client and server contexts (no `server-only` directive,
 * no React imports). Same registry ends up populated on both sides because
 * each side runs its own bootstrap, but the manifest data is identical.
 *
 * `register` is last-write-wins to be friendly to dev hot-reload. A
 * separate `validateRegistry()` helper detects pathological cases.
 */

import type { NodeKind, NodeManifest, NodeCategory, BaseNodeData } from "./types";
import { validateManifest } from "./validate";

const registry = new Map<NodeKind, NodeManifest>();

/**
 * Register a manifest. Validates the manifest shape on every call so a
 * malformed plugin fails loud at module load, not at run time.
 *
 * Last-write-wins on duplicate kind — this is the standard pattern for
 * dev hot-reload friendliness. If you suspect duplicate registrations
 * across plugin packs, run `validateRegistry()` at startup.
 */
export function registerManifest<D extends BaseNodeData>(manifest: NodeManifest<D>): void {
  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new Error(
      `Invalid manifest for kind "${manifest.kind}":\n  - ${errors.join("\n  - ")}`
    );
  }
  registry.set(manifest.kind, manifest as unknown as NodeManifest);
}

/** Look up a manifest by kind. Returns `undefined` for unknown kinds. */
export function getManifest(kind: NodeKind): NodeManifest | undefined {
  return registry.get(kind);
}

/** Whether the given kind is registered. */
export function hasManifest(kind: NodeKind): boolean {
  return registry.has(kind);
}

/** All registered manifests, in registration order. */
export function listManifests(): NodeManifest[] {
  return Array.from(registry.values());
}

/** Manifests within one category, in registration order. */
export function listManifestsByCategory(category: NodeCategory): NodeManifest[] {
  return listManifests().filter((m) => m.category === category);
}

/** Every registered kind. Useful for debug/devtools. */
export function listKinds(): NodeKind[] {
  return Array.from(registry.keys());
}

/**
 * Walk the registry and return any structural problems. Run this at app
 * startup if you want to catch issues that wouldn't be visible from
 * `validateManifest` alone (e.g. duplicate display names, conflicting
 * kinds across plugin packs).
 */
export function validateRegistry(): string[] {
  const errors: string[] = [];
  const seenDisplayNames = new Map<string, NodeKind>();
  for (const m of registry.values()) {
    const previous = seenDisplayNames.get(m.displayName);
    if (previous && previous !== m.kind) {
      errors.push(
        `Duplicate displayName "${m.displayName}" in kinds [${previous}, ${m.kind}]`
      );
    }
    seenDisplayNames.set(m.displayName, m.kind);
  }
  return errors;
}

/**
 * INTERNAL: clear the registry. Useful for tests; do not call from app code.
 */
export function __clearRegistryForTests(): void {
  registry.clear();
}
