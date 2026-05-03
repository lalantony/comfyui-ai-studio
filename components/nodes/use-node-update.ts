"use client";

import { useReactFlow } from "@xyflow/react";
import { useCallback } from "react";

/**
 * Returns a function that merges a partial patch into a node's `data` object on the canvas.
 * Lets a node component edit its own configuration inline.
 */
export function useNodeUpdate(id: string) {
  const reactFlow = useReactFlow();
  return useCallback(
    (patch: Record<string, unknown>) => {
      reactFlow.setNodes((nodes) =>
        nodes.map((n) => (n.id === id ? { ...n, data: { ...(n.data ?? {}), ...patch } } : n))
      );
    },
    [id, reactFlow]
  );
}
