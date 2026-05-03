/**
 * Workflow Variable executor — emits the static value configured on the node.
 */
import "server-only";

import type { NodeExecutor } from "@/lib/server/plugins/executorRegistry";
import type { WorkflowVariableData } from "./manifest";

export const executor: NodeExecutor<WorkflowVariableData> = {
  async execute(_ctx, _inputs, data) {
    return { output: data.value ?? "" };
  },
};
