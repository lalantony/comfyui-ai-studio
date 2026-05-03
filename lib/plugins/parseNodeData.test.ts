import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowNode } from "@/types";
import {
  __clearRegistryForTests,
  registerManifest,
} from "./manifestRegistry";
import { parseNodeData } from "./parseNodeData";
import type { NodeManifest } from "./types";

function manifest(kind: string): NodeManifest {
  return {
    kind,
    displayName: kind,
    description: "fixture",
    category: "ai",
    accent: "purple",
    icon: "Sparkles",
    inputs: [],
    outputs: [{ id: "output", label: "out", type: "text" }],
    defaultData: () => ({ kind, label: kind }),
    executable: true,
  };
}

describe("parseNodeData", () => {
  beforeEach(() => {
    __clearRegistryForTests();
    registerManifest(manifest("textInput"));
    registerManifest(manifest("imageInput"));
  });

  afterEach(() => {
    __clearRegistryForTests();
  });

  it("narrows a known kind via data.kind", () => {
    const node: WorkflowNode = {
      id: "n",
      type: "textInput",
      position: { x: 0, y: 0 },
      data: { kind: "textInput", label: "T", testValue: "hi" },
    };
    const parsed = parseNodeData(node);
    expect(parsed?.kind).toBe("textInput");
    expect(parsed?.testValue).toBe("hi");
  });

  it("falls back to node.type when data.kind is missing", () => {
    const node: WorkflowNode = {
      id: "n",
      type: "imageInput",
      position: { x: 0, y: 0 },
      data: { label: "I" },
    };
    expect(parseNodeData(node)?.kind).toBe("imageInput");
  });

  it("returns null for unknown kind", () => {
    const node: WorkflowNode = {
      id: "n",
      type: "unknown",
      position: { x: 0, y: 0 },
      data: { kind: "unknown", label: "?" },
    };
    expect(parseNodeData(node)).toBeNull();
  });

  it("returns null when neither data.kind nor node.type is set", () => {
    const node: WorkflowNode = {
      id: "n",
      type: "",
      position: { x: 0, y: 0 },
      data: {},
    };
    expect(parseNodeData(node)).toBeNull();
  });

  it("ensures label is always present (defaults to empty string)", () => {
    const node: WorkflowNode = {
      id: "n",
      type: "textInput",
      position: { x: 0, y: 0 },
      data: { kind: "textInput" },
    };
    expect(parseNodeData(node)?.label).toBe("");
  });

  it("data.kind takes precedence over node.type", () => {
    const node: WorkflowNode = {
      id: "n",
      type: "imageInput", // React Flow type
      position: { x: 0, y: 0 },
      data: { kind: "textInput", label: "T" }, // wins
    };
    expect(parseNodeData(node)?.kind).toBe("textInput");
  });
});
