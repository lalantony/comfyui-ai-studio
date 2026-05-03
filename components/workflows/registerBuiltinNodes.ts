/**
 * Bootstrap: register every built-in plugin's React component on the
 * client-side node-component registry.
 *
 * Imported by `WorkflowCanvas` so the canvas's `nodeTypes` map is populated
 * before React Flow renders. Idempotent.
 */
"use client";

import { registerNodeComponent } from "./nodeComponents";
import { registerBuiltinManifests } from "@/lib/plugins/registerBuiltins";

import TextInputNode from "@/plugins/builtin/text-input/Component";
import { manifest as textInputManifest } from "@/plugins/builtin/text-input/manifest";

import ImageInputNode from "@/plugins/builtin/image-input/Component";
import { manifest as imageInputManifest } from "@/plugins/builtin/image-input/manifest";

import VideoInputNode from "@/plugins/builtin/video-input/Component";
import { manifest as videoInputManifest } from "@/plugins/builtin/video-input/manifest";

import WorkflowVariableNode from "@/plugins/builtin/workflow-variable/Component";
import { manifest as workflowVariableManifest } from "@/plugins/builtin/workflow-variable/manifest";

import LLMNode from "@/plugins/builtin/llm/Component";
import { manifest as llmManifest } from "@/plugins/builtin/llm/manifest";

import TextCombineNode from "@/plugins/builtin/text-combine/Component";
import { manifest as textCombineManifest } from "@/plugins/builtin/text-combine/manifest";

import ConditionNode from "@/plugins/builtin/condition/Component";
import { manifest as conditionManifest } from "@/plugins/builtin/condition/manifest";

import ComfyUINode from "@/plugins/builtin/comfyui/Component";
import { manifest as comfyuiManifest } from "@/plugins/builtin/comfyui/manifest";

import SaveOutputNode from "@/plugins/builtin/save-output/Component";
import { manifest as saveOutputManifest } from "@/plugins/builtin/save-output/manifest";

import NoteNode from "@/plugins/builtin/note/Component";
import { manifest as noteManifest } from "@/plugins/builtin/note/manifest";

let registered = false;

export function registerBuiltinNodeComponents(): void {
  if (registered) return;
  registerBuiltinManifests();

  registerNodeComponent(textInputManifest.kind, TextInputNode);
  registerNodeComponent(imageInputManifest.kind, ImageInputNode);
  registerNodeComponent(videoInputManifest.kind, VideoInputNode);
  registerNodeComponent(workflowVariableManifest.kind, WorkflowVariableNode);
  registerNodeComponent(llmManifest.kind, LLMNode);
  registerNodeComponent(textCombineManifest.kind, TextCombineNode);
  registerNodeComponent(conditionManifest.kind, ConditionNode);
  registerNodeComponent(comfyuiManifest.kind, ComfyUINode);
  registerNodeComponent(saveOutputManifest.kind, SaveOutputNode);
  registerNodeComponent(noteManifest.kind, NoteNode);

  registered = true;
}

// Side effect on first import.
registerBuiltinNodeComponents();
