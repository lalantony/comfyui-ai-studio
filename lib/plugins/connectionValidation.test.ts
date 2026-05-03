import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowNode } from "@/types";
import { __clearRegistryForTests, registerManifest } from "./manifestRegistry";
import {
  areTypesCompatible,
  getHandleType,
  isValidEdgeConnection,
} from "./connectionValidation";
import type { NodeManifest } from "./types";

const NO_COMFY = () => undefined; // permissive default for ComfyUI cache lookup

function textNode(): NodeManifest {
  return {
    kind: "textKind",
    displayName: "TextKind",
    description: "x",
    category: "source",
    accent: "purple",
    icon: "Type",
    inputs: [{ id: "imgKind", label: "imgKind", type: "text" }],
    outputs: [{ id: "output", label: "out", type: "text" }],
    defaultData: () => ({ kind: "textKind", label: "TextKind" }),
    executable: true,
  };
}

function imageNode(): NodeManifest {
  return {
    ...textNode(),
    kind: "imgKind",
    displayName: "IN",
    inputs: [{ id: "imgKind", label: "imgKind", type: "image" }],
    outputs: [{ id: "output", label: "out", type: "image" }],
    defaultData: () => ({ kind: "imgKind", label: "IN" }),
  };
}

describe("areTypesCompatible", () => {
  it.each([
    ["text", "text", true],
    ["image", "image", true],
    ["any", "text", true],
    ["text", "any", true],
    ["any", "any", true],
    ["text", "image", false],
    ["image", "text", false],
    ["number", "boolean", false],
    ["audio", "video", false],
  ] as const)("(%s, %s) → %s", (a, b, expected) => {
    expect(areTypesCompatible(a, b)).toBe(expected);
  });
});

describe("getHandleType", () => {
  beforeEach(() => {
    __clearRegistryForTests();
    registerManifest(textNode());
    registerManifest(imageNode());
  });

  afterEach(() => {
    __clearRegistryForTests();
  });

  function node(kind: string, type?: string): WorkflowNode {
    return {
      id: "n",
      type: type ?? kind,
      position: { x: 0, y: 0 },
      data: { kind, label: kind },
    };
  }

  it("reads source type from manifest outputs", () => {
    expect(getHandleType(node("textKind"), "output", "source", NO_COMFY)).toBe("text");
    expect(getHandleType(node("imgKind"), "output", "source", NO_COMFY)).toBe("image");
  });

  it("reads target type from manifest inputs", () => {
    expect(getHandleType(node("textKind"), "imgKind", "target", NO_COMFY)).toBe("text");
    expect(getHandleType(node("imgKind"), "imgKind", "target", NO_COMFY)).toBe("image");
  });

  it("returns 'any' for unknown kind (permissive)", () => {
    expect(getHandleType(node("unknown"), "imgKind", "target", NO_COMFY)).toBe("any");
  });

  it("returns 'any' for unknown handle id on a known node", () => {
    expect(getHandleType(node("textKind"), "ghost", "target", NO_COMFY)).toBe("any");
  });

  it("returns 'any' when node is undefined", () => {
    expect(getHandleType(undefined, "x", "source", NO_COMFY)).toBe("any");
  });

  describe("ComfyUI dynamic handles", () => {
    function comfyNode(endpointId: string | null): WorkflowNode {
      return {
        id: "c",
        type: "comfyui",
        position: { x: 0, y: 0 },
        data: { kind: "comfyui", label: "ComfyUI", endpointId },
      };
    }

    const lookup = (epId: string) =>
      epId === "ep-1"
        ? {
            inputs: [
              { studioPort: "prompt", type: "text" as const },
              { studioPort: "image", type: "image" as const },
            ],
            output: { outputType: "image" as const },
          }
        : undefined;

    it("returns 'any' when endpointId is null", () => {
      expect(getHandleType(comfyNode(null), "image", "target", lookup)).toBe("any");
    });

    it("returns 'any' on cache miss (permissive)", () => {
      expect(getHandleType(comfyNode("nope"), "image", "target", lookup)).toBe("any");
    });

    it("resolves typed input handle from cached endpoint", () => {
      expect(getHandleType(comfyNode("ep-1"), "prompt", "target", lookup)).toBe("text");
      expect(getHandleType(comfyNode("ep-1"), "image", "target", lookup)).toBe("image");
    });

    it("resolves output type from endpoint outputType", () => {
      expect(getHandleType(comfyNode("ep-1"), "output", "source", lookup)).toBe("image");
    });
  });
});

describe("isValidEdgeConnection", () => {
  beforeEach(() => {
    __clearRegistryForTests();
    registerManifest(textNode());
    registerManifest(imageNode());
  });

  afterEach(() => {
    __clearRegistryForTests();
  });

  const nodes: WorkflowNode[] = [
    { id: "t1", type: "textKind", position: { x: 0, y: 0 }, data: { kind: "textKind", label: "T1" } },
    { id: "i1", type: "imgKind", position: { x: 0, y: 0 }, data: { kind: "imgKind", label: "I1" } },
    { id: "t2", type: "textKind", position: { x: 0, y: 0 }, data: { kind: "textKind", label: "T2" } },
    { id: "i2", type: "imgKind", position: { x: 0, y: 0 }, data: { kind: "imgKind", label: "I2" } },
  ];

  it("accepts text → text", () => {
    expect(
      isValidEdgeConnection(
        { source: "t1", target: "t2", sourceHandle: "output", targetHandle: "imgKind" },
        nodes,
        NO_COMFY
      )
    ).toBe(true);
  });

  it("accepts image → image", () => {
    expect(
      isValidEdgeConnection(
        { source: "i1", target: "i2", sourceHandle: "output", targetHandle: "imgKind" },
        nodes,
        NO_COMFY
      )
    ).toBe(true);
  });

  it("rejects text → image", () => {
    expect(
      isValidEdgeConnection(
        { source: "t1", target: "i1", sourceHandle: "output", targetHandle: "imgKind" },
        nodes,
        NO_COMFY
      )
    ).toBe(false);
  });

  it("rejects image → text", () => {
    expect(
      isValidEdgeConnection(
        { source: "i1", target: "t1", sourceHandle: "output", targetHandle: "imgKind" },
        nodes,
        NO_COMFY
      )
    ).toBe(false);
  });

  it("permissive when source is unknown (no manifest)", () => {
    const bogus: WorkflowNode = {
      id: "x",
      type: "unknown",
      position: { x: 0, y: 0 },
      data: { kind: "unknown", label: "X" },
    };
    expect(
      isValidEdgeConnection(
        { source: "x", target: "i1", sourceHandle: "output", targetHandle: "imgKind" },
        [...nodes, bogus],
        NO_COMFY
      )
    ).toBe(true);
  });
});
