import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { introspectWorkflowApiJson } from "./introspect";

const FIXTURE_DIR = path.join(
  process.cwd(),
  "docs",
  "examples",
  "comfyui-workflows"
);

function loadFixture(filename: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, filename), "utf8");
}

describe("introspectWorkflowApiJson", () => {
  describe("malformed input", () => {
    it("returns notes (not throws) on invalid JSON", () => {
      const result = introspectWorkflowApiJson("{ broken");
      expect(result.suggestedInputs).toEqual([]);
      expect(result.suggestedOutput).toBeNull();
      expect(result.notes.some((n) => n.includes("Could not parse"))).toBe(true);
    });

    it("rejects an array as top-level (must be object keyed by node id)", () => {
      const result = introspectWorkflowApiJson(JSON.stringify([]));
      expect(result.notes.some((n) => n.includes("object"))).toBe(true);
    });

    it("rejects null", () => {
      const result = introspectWorkflowApiJson("null");
      expect(result.suggestedInputs).toEqual([]);
    });

    it("returns empty result for an empty workflow", () => {
      const result = introspectWorkflowApiJson("{}");
      expect(result.suggestedInputs).toEqual([]);
      expect(result.suggestedOutput).toBeNull();
      expect(result.detectedNodeCount).toBe(0);
    });
  });

  describe("real-world fixtures", () => {
    it("Z-Image Turbo: detects prompt + SaveImage output", () => {
      const result = introspectWorkflowApiJson(
        loadFixture("Image Genration - Z-Image Turbo - Text to Image with Text (2).json")
      );
      expect(result.detectedNodeCount).toBeGreaterThan(0);
      expect(result.suggestedInputs.some((i) => i.type === "text")).toBe(true);
      expect(result.suggestedOutput).not.toBeNull();
      expect(result.suggestedOutput?.outputType).toBe("image");
    });

    it("Ernie Image: produces a non-empty input list", () => {
      const result = introspectWorkflowApiJson(
        loadFixture("Default Image Generation - Ernie_Image.json")
      );
      expect(result.detectedNodeCount).toBeGreaterThan(0);
      expect(result.suggestedInputs.length).toBeGreaterThan(0);
    });

    it("LTX2 video: detects video output", () => {
      const result = introspectWorkflowApiJson(
        loadFixture("Default Video Generation - video_ltx2_3_t2v.json")
      );
      expect(result.detectedNodeCount).toBeGreaterThan(0);
      // VHS_VideoCombine / SaveVideo / SaveAnimated* → "video" outputType
      if (result.suggestedOutput) {
        expect(["video", "image"]).toContain(result.suggestedOutput.outputType);
      }
    });

    it("ACE-Step audio: detects audio output", () => {
      const result = introspectWorkflowApiJson(
        loadFixture("Background Music Generation - audio_ace_step1_5_xl_base.json")
      );
      expect(result.detectedNodeCount).toBeGreaterThan(0);
      if (result.suggestedOutput) {
        expect(["audio", "image"]).toContain(result.suggestedOutput.outputType);
      }
    });
  });

  describe("synthetic prompts", () => {
    it("names a CLIPTextEncode node 'prompt'", () => {
      const json = JSON.stringify({
        "1": { class_type: "CLIPTextEncode", inputs: { text: "hello" } },
      });
      const result = introspectWorkflowApiJson(json);
      const promptInput = result.suggestedInputs.find((i) => i.studioPort === "prompt");
      expect(promptInput).toBeDefined();
      expect(promptInput?.type).toBe("text");
    });

    it("identifies a negative prompt by _meta title", () => {
      const json = JSON.stringify({
        "1": {
          class_type: "CLIPTextEncode",
          inputs: { text: "blurry" },
          _meta: { title: "Negative Prompt" },
        },
      });
      const result = introspectWorkflowApiJson(json);
      expect(result.suggestedInputs.some((i) => i.studioPort.includes("negative"))).toBe(true);
    });

    it("disambiguates multiple positive prompts (prompt, prompt_2, ...)", () => {
      const json = JSON.stringify({
        "1": { class_type: "CLIPTextEncode", inputs: { text: "a" } },
        "2": { class_type: "CLIPTextEncode", inputs: { text: "b" } },
        "3": { class_type: "CLIPTextEncode", inputs: { text: "c" } },
      });
      const result = introspectWorkflowApiJson(json);
      const promptPorts = result.suggestedInputs
        .map((i) => i.studioPort)
        .filter((p) => p.startsWith("prompt"));
      expect(promptPorts).toContain("prompt");
      // At least one suffixed prompt
      expect(promptPorts.length).toBeGreaterThan(1);
    });

    it("captures LoadImage as image input", () => {
      const json = JSON.stringify({
        "1": { class_type: "LoadImage", inputs: { image: "ref.png" } },
      });
      const result = introspectWorkflowApiJson(json);
      expect(result.suggestedInputs.some((i) => i.type === "image")).toBe(true);
    });

    it("captures SaveImage as image output", () => {
      const json = JSON.stringify({
        "1": { class_type: "CLIPTextEncode", inputs: { text: "x" } },
        "9": { class_type: "SaveImage", inputs: { filename_prefix: "out", images: ["1", 0] } },
      });
      const result = introspectWorkflowApiJson(json);
      expect(result.suggestedOutput?.comfyNodeId).toBe("9");
      expect(result.suggestedOutput?.outputType).toBe("image");
    });

    it("notes when no recognizable output node is present", () => {
      const json = JSON.stringify({
        "1": { class_type: "CLIPTextEncode", inputs: { text: "x" } },
      });
      const result = introspectWorkflowApiJson(json);
      expect(result.notes.some((n) => n.toLowerCase().includes("output"))).toBe(true);
    });
  });
});
