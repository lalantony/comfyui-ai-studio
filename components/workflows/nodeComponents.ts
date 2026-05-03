/**
 * Client-side node component registry. One React component per node `kind`.
 *
 * Populated at module load by `registerBuiltinNodes.ts`. Read by
 * `WorkflowCanvas` to build React Flow's `nodeTypes` map.
 *
 * The canvas wraps each component with `withRunIndicator` at the
 * consumption site — plugins author bare components and don't need to
 * know about the run-state badge.
 */
"use client";

import type { BaseNodeData, NodeComponent } from "@/lib/plugins/types";

// Re-export for plugin authors so they can import everything they need
// from one place inside their Component.tsx files.
export type { NodeProps, NodeComponent } from "@/lib/plugins/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry values vary by plugin's D
const registry = new Map<string, NodeComponent<any>>();

/**
 * Register a component for a kind. Last-write-wins to match the other
 * registries and play nice with dev hot-reload.
 *
 * Plugin authors typically don't call this directly — `registerBuiltinNodes.ts`
 * does it for built-ins; future external plugin loaders will do the same.
 */
export function registerNodeComponent<D extends BaseNodeData>(
  kind: string,
  component: NodeComponent<D>
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registry.set(kind, component as NodeComponent<any>);
}

/** Look up the component for a kind. Returns undefined for unknown kinds. */
export function getNodeComponent(
  kind: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): NodeComponent<any> | undefined {
  return registry.get(kind);
}

/** All registered kind/component pairs, in registration order. */
export function listNodeComponents(): Array<[string, NodeComponent<BaseNodeData>]> {
  return Array.from(registry.entries()) as Array<[string, NodeComponent<BaseNodeData>]>;
}

/** INTERNAL: clear the registry. Tests only. */
export function __clearComponentsForTests(): void {
  registry.clear();
}
