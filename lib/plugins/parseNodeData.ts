/**
 * Narrow a loose-typed `WorkflowNode` to a recognized node-data shape, or
 * `null` if the kind isn't registered in the manifest registry.
 *
 * The kind is read from `data.kind` first, falling back to `node.type`
 * (React Flow's identifier). This lets persisted workflows survive a
 * minor restructuring of the data shape — `node.type` is what React Flow
 * uses to look up the component, so it always matches.
 *
 * Lives in `lib/plugins/` (not `types/`) because it depends on the runtime
 * registry, which depends on the plugin definitions. Keeping it here
 * preserves the dependency direction `types/ ← plugins/`.
 */

import type { WorkflowNode } from "@/types";
import { hasManifest } from "./manifestRegistry";

/**
 * The narrowed shape — at this layer we don't know the discriminated
 * union members (those are private to each plugin's manifest module),
 * so we surface only the fields the runtime guarantees.
 */
export interface ParsedNodeData {
  kind: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin-specific fields vary
  [key: string]: any;
}

export function parseNodeData(node: WorkflowNode): ParsedNodeData | null {
  const data = node.data ?? {};
  const kind: string | undefined = data.kind ?? node.type;
  if (!kind || !hasManifest(kind)) return null;
  return { ...data, kind, label: data.label ?? "" };
}
