/**
 * inputContract — derivation + validation + runtime-binding tests.
 *
 * The tests use minimal `WorkflowNode` shapes and skip the full Workflow
 * fields not used by the contract. The module loads manifests on import
 * via the side-effect bootstrap, so `parseNodeData` resolves correctly.
 */
import { describe, expect, it } from "vitest";
import {
  buildRuntimeInputs,
  deriveInputSlots,
  validateComposerInputs,
} from "./inputContract";
import type { Workflow, WorkflowNode } from "@/types";

function workflow(nodes: WorkflowNode[]): Workflow {
  return {
    id: "wf-test",
    name: "Test",
    version: "1",
    type: "image",
    description: "",
    nodeCount: nodes.length,
    averageTime: "",
    environment: "",
    status: "draft",
    createdAt: "",
    updatedAt: "",
    tags: [],
    nodes,
    edges: [],
  };
}

function textNode(id: string, opts: { required?: boolean; isPrimary?: boolean; label?: string } = {}): WorkflowNode {
  return {
    id,
    type: "textInput",
    position: { x: 0, y: 0 },
    data: {
      kind: "textInput",
      label: opts.label ?? "Prompt",
      required: opts.required ?? true,
      isPrimary: opts.isPrimary ?? false,
    },
  };
}

function imageNode(
  id: string,
  opts: { required?: boolean; role?: "reference" | "init" | "mask"; label?: string } = {}
): WorkflowNode {
  return {
    id,
    type: "imageInput",
    position: { x: 0, y: 0 },
    data: {
      kind: "imageInput",
      label: opts.label ?? "Image",
      required: opts.required ?? false,
      inputRole: opts.role ?? "reference",
    },
  };
}

describe("inputContract.deriveInputSlots", () => {
  it("returns empty for a null or empty workflow", () => {
    expect(deriveInputSlots(null)).toEqual([]);
    expect(deriveInputSlots(workflow([]))).toEqual([]);
  });

  it("captures one required text + one required image", () => {
    const slots = deriveInputSlots(
      workflow([textNode("t1"), imageNode("i1", { required: true, role: "reference" })])
    );
    expect(slots).toEqual([
      { nodeId: "t1", kind: "text", label: "Prompt", required: true, isPrimary: false },
      {
        nodeId: "i1",
        kind: "image",
        label: "Image",
        required: true,
        role: "reference",
        isPrimary: false,
      },
    ]);
  });

  it("captures multiple image inputs in declaration order", () => {
    const slots = deriveInputSlots(
      workflow([
        imageNode("ref", { required: true, role: "reference", label: "Reference" }),
        imageNode("init", { required: true, role: "init", label: "Init" }),
        imageNode("mask", { required: false, role: "mask", label: "Mask" }),
      ])
    );
    expect(slots.map((s) => s.nodeId)).toEqual(["ref", "init", "mask"]);
    expect(slots[0].role).toBe("reference");
    expect(slots[1].required).toBe(true);
    expect(slots[2].required).toBe(false);
  });
});

describe("inputContract.validateComposerInputs", () => {
  const refs = (
    items: Array<{ name: string; type: "image" | "video" | "music" | "file" }>
  ) =>
    items.map((it, i) => ({
      id: `asset-${i}`,
      name: it.name,
      type: it.type,
    }));

  it("passes when every required slot is satisfied", () => {
    const slots = deriveInputSlots(
      workflow([textNode("t1"), imageNode("i1", { required: true })])
    );
    const result = validateComposerInputs(slots, {
      text: "a sunset",
      referencedAssets: refs([{ name: "ref.png", type: "image" }]),
    });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("rejects empty text on a required text slot", () => {
    const slots = deriveInputSlots(workflow([textNode("t1")]));
    const result = validateComposerInputs(slots, {
      text: "",
      referencedAssets: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].slotNodeId).toBe("t1");
  });

  it("reports how many image slots are still missing", () => {
    const slots = deriveInputSlots(
      workflow([
        textNode("t1"),
        imageNode("i1", { required: true }),
        imageNode("i2", { required: true }),
      ])
    );
    const result = validateComposerInputs(slots, {
      text: "x",
      referencedAssets: refs([{ name: "ref.png", type: "image" }]),
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].reason).toMatch(/2 image inputs.*1 still missing/);
  });

  it("warns when a chip type doesn't fit any slot in the workflow", () => {
    const slots = deriveInputSlots(workflow([textNode("t1")]));
    const result = validateComposerInputs(slots, {
      text: "x",
      referencedAssets: refs([{ name: "clip.mp4", type: "video" }]),
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].reason).toContain("doesn't fit any input slot");
  });

  it("ignores extra chips beyond the slot count without erroring", () => {
    const slots = deriveInputSlots(
      workflow([imageNode("i1", { required: true })])
    );
    const result = validateComposerInputs(slots, {
      text: "",
      referencedAssets: refs([
        { name: "a.png", type: "image" },
        { name: "b.png", type: "image" },
      ]),
    });
    expect(result.ok).toBe(true);
  });

  it("flags multi-text workflows so users know it's an unsupported shape", () => {
    const slots = deriveInputSlots(
      workflow([
        textNode("t1", { required: true }),
        textNode("t2", { required: true }),
      ])
    );
    const result = validateComposerInputs(slots, {
      text: "x",
      referencedAssets: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].reason).toMatch(/2 required text inputs/);
  });
});

describe("inputContract.buildRuntimeInputs", () => {
  it("binds chips to slots in declaration order", () => {
    const slots = deriveInputSlots(
      workflow([
        textNode("t1"),
        imageNode("ref", { required: true, role: "reference" }),
        imageNode("init", { required: true, role: "init" }),
      ])
    );
    const inputs = buildRuntimeInputs(
      slots,
      {
        text: "a desert",
        referencedAssets: [
          { id: "asset-A", name: "ref.png", type: "image" },
          { id: "asset-B", name: "init.png", type: "image" },
        ],
      },
      "p-test"
    );
    expect(inputs).toEqual({
      t1: "a desert",
      ref: { assetId: "asset-A", projectId: "p-test" },
      init: { assetId: "asset-B", projectId: "p-test" },
    });
  });

  it("omits slots that aren't filled (orchestrator treats as missing)", () => {
    const slots = deriveInputSlots(
      workflow([textNode("t1"), imageNode("i1", { required: false })])
    );
    const inputs = buildRuntimeInputs(
      slots,
      { text: "only text", referencedAssets: [] },
      "p-test"
    );
    expect(inputs).toEqual({ t1: "only text" });
  });
});
