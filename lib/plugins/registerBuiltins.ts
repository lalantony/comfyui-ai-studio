/**
 * Bootstrap: register every built-in plugin's manifest.
 *
 * Imported eagerly by both server-side and client-side bootstraps so the
 * shared manifest registry is populated before any consumer reads it.
 *
 * Order doesn't matter functionally (kinds are unique), but we group by
 * category for legibility — that's also the order they appear in the
 * palette by default.
 */

import { registerManifest } from "./manifestRegistry";
import type { NodeManifest } from "./types";

// Source category
import { manifest as textInputManifest } from "@/plugins/builtin/text-input/manifest";
import { manifest as imageInputManifest } from "@/plugins/builtin/image-input/manifest";
import { manifest as videoInputManifest } from "@/plugins/builtin/video-input/manifest";
import { manifest as workflowVariableManifest } from "@/plugins/builtin/workflow-variable/manifest";

// AI category
import { manifest as llmManifest } from "@/plugins/builtin/llm/manifest";

// Processing category
import { manifest as textCombineManifest } from "@/plugins/builtin/text-combine/manifest";
import { manifest as conditionManifest } from "@/plugins/builtin/condition/manifest";

// ComfyUI category
import { manifest as comfyuiManifest } from "@/plugins/builtin/comfyui/manifest";

// Utility category
import { manifest as saveOutputManifest } from "@/plugins/builtin/save-output/manifest";
import { manifest as noteManifest } from "@/plugins/builtin/note/manifest";

// Widen each manifest's specific generic param to the base shape so the
// array's element type unifies cleanly. The registry handles the variance
// internally.
const BUILTIN_MANIFESTS: NodeManifest[] = [
  textInputManifest as unknown as NodeManifest,
  imageInputManifest as unknown as NodeManifest,
  videoInputManifest as unknown as NodeManifest,
  workflowVariableManifest as unknown as NodeManifest,
  llmManifest as unknown as NodeManifest,
  textCombineManifest as unknown as NodeManifest,
  conditionManifest as unknown as NodeManifest,
  comfyuiManifest as unknown as NodeManifest,
  saveOutputManifest as unknown as NodeManifest,
  noteManifest as unknown as NodeManifest,
];

let registered = false;

/**
 * Idempotent — calling more than once is a no-op. Important for module
 * dedup across server + client bundles where this file might be imported
 * from multiple entry points.
 */
export function registerBuiltinManifests(): void {
  if (registered) return;
  for (const manifest of BUILTIN_MANIFESTS) {
    registerManifest(manifest);
  }
  registered = true;
}

// Side effect on first import.
registerBuiltinManifests();
