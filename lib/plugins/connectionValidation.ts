/**
 * Canvas-side connection-type validation.
 *
 * React Flow calls `isValidConnection` synchronously while the user is
 * dragging an edge. We resolve the source + target handle types from the
 * plugin manifests, apply the compatibility rules, and return a verdict
 * (true = drop allowed, false = rejected).
 *
 * Compatibility:
 *   - `any` is compatible with every other type (wildcard).
 *   - Same type compatible (text↔text, image↔image, …).
 *   - Otherwise rejected.
 *
 * Permissive defaults:
 *   - If we can't resolve a type (unknown plugin, ComfyUI binding still
 *     loading, orphan handle), we ALLOW the connection. The runtime
 *     validates at execution time as a backstop.
 */

import type { Connection, Edge } from "@xyflow/react";
import type { HandleType } from "./types";
import { getManifest } from "./manifestRegistry";
import type { WorkflowNode } from "@/types";

/**
 * Look up a handle's type for validation. `side` is which edge endpoint
 * we're resolving — `source` reads outputs, `target` reads inputs.
 *
 * Returns `"any"` (the safe-permissive default) when the type can't be
 * resolved — unknown plugin, ComfyUI binding cache miss, etc.
 */
export function getHandleType(
  node: WorkflowNode | undefined,
  handleId: string | null | undefined,
  side: "source" | "target",
  comfyEndpointLookup: (endpointId: string) => { inputs: Array<{ studioPort: string; type: HandleType }>; output: { outputType: "image" | "video" | "audio" } } | undefined
): HandleType {
  if (!node) return "any";
  const kind: string | undefined = node.data?.kind ?? node.type;
  if (!kind) return "any";

  // ComfyUI: dynamic handles derived from the active endpoint's binding shape.
  if (kind === "comfyui") {
    const endpointId = node.data?.endpointId as string | null | undefined;
    if (!endpointId) return "any";
    const endpoint = comfyEndpointLookup(endpointId);
    if (!endpoint) return "any"; // cache miss — permissive
    if (side === "target") {
      const binding = endpoint.inputs.find((b) => b.studioPort === handleId);
      return binding?.type ?? "any";
    }
    // Source: ComfyUI's output handle type maps from the endpoint's outputType.
    if (handleId === "output") {
      return endpoint.output.outputType === "image"
        ? "image"
        : endpoint.output.outputType === "video"
          ? "video"
          : endpoint.output.outputType === "audio"
            ? "audio"
            : "any";
    }
    return "any";
  }

  // Static plugins: read directly from the manifest's declared handles.
  const manifest = getManifest(kind);
  if (!manifest) return "any";
  const handles = side === "source" ? manifest.outputs : manifest.inputs;
  const handle = handles.find((h) => h.id === handleId);
  return handle?.type ?? "any";
}

/**
 * Verdict for a connection attempt. Returns `true` when types are
 * compatible (or when either side couldn't be resolved — see permissive
 * defaults note above).
 */
export function areTypesCompatible(source: HandleType, target: HandleType): boolean {
  if (source === "any" || target === "any") return true;
  return source === target;
}

/**
 * High-level canvas validator. Pass to React Flow's `isValidConnection`.
 * Looks up types via plugin manifests + the ComfyUI endpoint cache.
 */
export function isValidEdgeConnection(
  connection: Connection | Edge,
  nodes: WorkflowNode[],
  comfyEndpointLookup: Parameters<typeof getHandleType>[3]
): boolean {
  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);

  const sourceType = getHandleType(sourceNode, connection.sourceHandle, "source", comfyEndpointLookup);
  const targetType = getHandleType(targetNode, connection.targetHandle, "target", comfyEndpointLookup);

  return areTypesCompatible(sourceType, targetType);
}
