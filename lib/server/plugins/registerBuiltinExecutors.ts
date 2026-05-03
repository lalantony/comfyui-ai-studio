/**
 * Bootstrap: register every built-in plugin's server executor.
 *
 * Imported by `lib/server/workflow/runtime.ts` (and any other server entry
 * point that needs executors) at module load. Runs once; subsequent
 * imports are no-ops.
 *
 * Note: Note (the inert plugin) has no executor and is not registered here.
 */
import "server-only";

import { registerExecutor } from "./executorRegistry";
import { registerBuiltinManifests } from "@/lib/plugins/registerBuiltins";

import { executor as textInputExecutor } from "@/plugins/builtin/text-input/executor";
import { manifest as textInputManifest } from "@/plugins/builtin/text-input/manifest";

import { executor as imageInputExecutor } from "@/plugins/builtin/image-input/executor";
import { manifest as imageInputManifest } from "@/plugins/builtin/image-input/manifest";

import { executor as videoInputExecutor } from "@/plugins/builtin/video-input/executor";
import { manifest as videoInputManifest } from "@/plugins/builtin/video-input/manifest";

import { executor as workflowVariableExecutor } from "@/plugins/builtin/workflow-variable/executor";
import { manifest as workflowVariableManifest } from "@/plugins/builtin/workflow-variable/manifest";

import { executor as llmExecutor } from "@/plugins/builtin/llm/executor";
import { manifest as llmManifest } from "@/plugins/builtin/llm/manifest";

import { executor as textCombineExecutor } from "@/plugins/builtin/text-combine/executor";
import { manifest as textCombineManifest } from "@/plugins/builtin/text-combine/manifest";

import { executor as conditionExecutor } from "@/plugins/builtin/condition/executor";
import { manifest as conditionManifest } from "@/plugins/builtin/condition/manifest";

import { executor as comfyuiExecutor } from "@/plugins/builtin/comfyui/executor";
import { manifest as comfyuiManifest } from "@/plugins/builtin/comfyui/manifest";

import { executor as saveOutputExecutor } from "@/plugins/builtin/save-output/executor";
import { manifest as saveOutputManifest } from "@/plugins/builtin/save-output/manifest";

let registered = false;

export function registerBuiltinExecutors(): void {
  if (registered) return;
  // Manifests are needed first so consumers can validate `kind`s.
  registerBuiltinManifests();

  registerExecutor(textInputManifest.kind, textInputExecutor);
  registerExecutor(imageInputManifest.kind, imageInputExecutor);
  registerExecutor(videoInputManifest.kind, videoInputExecutor);
  registerExecutor(workflowVariableManifest.kind, workflowVariableExecutor);
  registerExecutor(llmManifest.kind, llmExecutor);
  registerExecutor(textCombineManifest.kind, textCombineExecutor);
  registerExecutor(conditionManifest.kind, conditionExecutor);
  registerExecutor(comfyuiManifest.kind, comfyuiExecutor);
  registerExecutor(saveOutputManifest.kind, saveOutputExecutor);
  // Note has no executor (manifest.executable === false).

  registered = true;
}

// Side effect on first import.
registerBuiltinExecutors();
