/**
 * Endpoint introspection — turns a raw `workflow_api.json` exported from
 * ComfyUI into a sensible default mapping the user can review and tweak.
 *
 * The heuristic, in order:
 *
 *   1. **Inputs**: walk every node. For each whose `class_type` is in the
 *      known input set (`CLIPTextEncode`, `LoadImage`, `EmptyLatentImage`,
 *      `KSampler`, etc.) AND whose primary parameter is a literal value
 *      (not a wire to another node), produce a suggested
 *      `ComfyEndpointInput` with a guessed type, label, and `studioPort`.
 *
 *   2. **Output**: locate the terminal node (no outgoing edges into another
 *      node). `SaveImage` → image; `VHS_VideoCombine` → video; `SaveAudio`
 *      → audio. If multiple terminals exist we pick the most "save-like"
 *      one and add a note.
 *
 *   3. **Notes**: surface anything ambiguous (multiple terminals, missing
 *      fields, unknown classes). The user sees these in the dialog.
 *
 * The heuristic is intentionally conservative — over-suggesting inputs the
 * user has to delete is worse than under-suggesting. Improving this is one
 * of the highest-impact contributions a new contributor can make; it's a
 * single self-contained file with no cross-dependencies.
 *
 * Wired into `POST /api/comfy/introspect` as a stateless helper. The
 * endpoint dialog calls it once when the user pastes a `workflow_api.json`
 * and hits Introspect.
 */
import "server-only";

import { ComfyEndpointInput, ComfyEndpointOutput } from "@/types";

export interface IntrospectionResult {
  suggestedInputs: ComfyEndpointInput[];
  suggestedOutput: ComfyEndpointOutput | null;
  detectedNodeCount: number;
  notes: string[];
}

interface ComfyNodeRaw {
  class_type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputs?: Record<string, any>;
  _meta?: { title?: string };
}

const NEGATIVE_KEYWORDS = ["negative", "neg", "anti"];

/**
 * Parse a `workflow_api.json` string and produce suggested Studio input/output bindings.
 *
 * The result is a starting point that the user reviews and edits in the registration dialog;
 * the heuristics here aim for "covers 80% of common workflows out of the box," not perfection.
 *
 * Heuristics:
 *   - CLIPTextEncode nodes → text input. If a node's _meta.title or text content contains "negative",
 *     we name it "negative_prompt"; otherwise "prompt". When multiple positive prompts exist,
 *     subsequent ones get suffixed (prompt_2, prompt_3, ...).
 *   - LoadImage / LoadImageMask → image input.
 *   - KSampler / KSamplerAdvanced → expose `seed` and `steps` as optional numeric inputs.
 *   - EmptyLatentImage → expose `width`/`height` as optional numeric inputs.
 *   - SaveImage / PreviewImage / SaveAnimated* / VHS_VideoCombine / SaveVideo / SaveAudio
 *     → captured as the output node. The first match wins.
 */
export function introspectWorkflowApiJson(jsonText: string): IntrospectionResult {
  const notes: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      suggestedInputs: [],
      suggestedOutput: null,
      detectedNodeCount: 0,
      notes: [`Could not parse JSON: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      suggestedInputs: [],
      suggestedOutput: null,
      detectedNodeCount: 0,
      notes: ["Top-level value must be an object keyed by node id."],
    };
  }

  const entries = Object.entries(parsed as Record<string, ComfyNodeRaw>);
  const inputs: ComfyEndpointInput[] = [];
  let output: ComfyEndpointOutput | null = null;
  let positiveCount = 0;

  for (const [nodeId, node] of entries) {
    if (!node || typeof node !== "object") continue;
    const cls = node.class_type;
    if (!cls) continue;

    if (cls === "CLIPTextEncode") {
      const title = (node._meta?.title ?? "").toLowerCase();
      const text = typeof node.inputs?.text === "string" ? node.inputs.text.toLowerCase() : "";
      const looksNegative = NEGATIVE_KEYWORDS.some((kw) => title.includes(kw) || text.startsWith(kw));
      if (looksNegative) {
        inputs.push({
          studioPort: "negative_prompt",
          label: "Negative prompt",
          type: "text",
          comfyNodeId: nodeId,
          comfyInputPath: "text",
          required: false,
          default: typeof node.inputs?.text === "string" ? node.inputs.text : undefined,
        });
      } else {
        const isFirst = positiveCount === 0;
        positiveCount += 1;
        inputs.push({
          studioPort: isFirst ? "prompt" : `prompt_${positiveCount}`,
          label: isFirst ? "Prompt" : `Prompt ${positiveCount}`,
          type: "text",
          comfyNodeId: nodeId,
          comfyInputPath: "text",
          required: isFirst,
          default: typeof node.inputs?.text === "string" ? node.inputs.text : undefined,
        });
      }
      continue;
    }

    if (cls === "LoadImage" || cls === "LoadImageMask") {
      const studioPort = cls === "LoadImageMask" ? "mask" : "image";
      const label = cls === "LoadImageMask" ? "Mask" : "Image";
      inputs.push({
        studioPort,
        label,
        type: "image",
        comfyNodeId: nodeId,
        comfyInputPath: "image",
        required: cls === "LoadImage",
      });
      continue;
    }

    // Video input loaders. The community-maintained VHS suite is the most
    // common; ComfyUI core has been adding native LoadVideo nodes too.
    // All store the video filename under `inputs.video` (or `.file`).
    if (
      cls === "LoadVideo" ||
      cls === "VHS_LoadVideo" ||
      cls === "VHS_LoadVideoFFmpeg" ||
      cls === "VHS_LoadVideoUpload" ||
      cls === "VHS_LoadVideoFFmpegUpload" ||
      cls === "VHS_LoadVideoPath"
    ) {
      const inputFieldName =
        node.inputs && "file" in node.inputs ? "file" : "video";
      inputs.push({
        studioPort: "video",
        label: "Video",
        type: "video",
        comfyNodeId: nodeId,
        comfyInputPath: inputFieldName,
        required: true,
      });
      continue;
    }

    if (cls === "KSampler" || cls === "KSamplerAdvanced") {
      if (node.inputs && "seed" in node.inputs) {
        inputs.push({
          studioPort: `seed_${nodeId}`,
          label: "Seed",
          type: "number",
          comfyNodeId: nodeId,
          comfyInputPath: "seed",
          required: false,
          default: typeof node.inputs.seed === "number" ? node.inputs.seed : undefined,
        });
      }
      if (node.inputs && "steps" in node.inputs) {
        inputs.push({
          studioPort: `steps_${nodeId}`,
          label: "Steps",
          type: "number",
          comfyNodeId: nodeId,
          comfyInputPath: "steps",
          required: false,
          default: typeof node.inputs.steps === "number" ? node.inputs.steps : undefined,
        });
      }
      continue;
    }

    if (cls === "EmptyLatentImage") {
      if (node.inputs && "width" in node.inputs) {
        inputs.push({
          studioPort: "width",
          label: "Width",
          type: "number",
          comfyNodeId: nodeId,
          comfyInputPath: "width",
          required: false,
          default: typeof node.inputs.width === "number" ? node.inputs.width : undefined,
        });
      }
      if (node.inputs && "height" in node.inputs) {
        inputs.push({
          studioPort: "height",
          label: "Height",
          type: "number",
          comfyNodeId: nodeId,
          comfyInputPath: "height",
          required: false,
          default: typeof node.inputs.height === "number" ? node.inputs.height : undefined,
        });
      }
      continue;
    }

    // Output detection — first match wins
    if (!output) {
      if (cls === "SaveImage" || cls === "PreviewImage" || cls === "SaveAnimatedWEBP" || cls === "SaveAnimatedPNG") {
        output = { comfyNodeId: nodeId, outputType: "image", outputField: "images" };
        continue;
      }
      if (cls === "VHS_VideoCombine" || cls === "SaveVideo") {
        output = { comfyNodeId: nodeId, outputType: "video", outputField: "video" };
        continue;
      }
      if (cls === "SaveAudio" || cls === "VHS_AudioSave") {
        output = { comfyNodeId: nodeId, outputType: "audio", outputField: "audio" };
        continue;
      }
    }
  }

  if (positiveCount > 1) {
    notes.push(
      `Detected ${positiveCount} positive-prompt nodes; only the first is required by default. Edit the bindings if a different one should be primary.`
    );
  }
  if (!output) {
    notes.push(
      "No SaveImage / PreviewImage / SaveVideo / SaveAudio output node was detected. Pick one manually before saving."
    );
  }
  if (inputs.length === 0) {
    notes.push("No common input nodes were detected. You can still register this endpoint and add inputs manually.");
  }

  return {
    suggestedInputs: inputs,
    suggestedOutput: output,
    detectedNodeCount: entries.length,
    notes,
  };
}
