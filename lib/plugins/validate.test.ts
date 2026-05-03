import { describe, expect, it } from "vitest";
import type { NodeManifest } from "./types";
import { validateManifest } from "./validate";

function baseManifest(overrides: Partial<NodeManifest> = {}): NodeManifest {
  return {
    kind: "myNode",
    displayName: "My Node",
    description: "Does the thing.",
    category: "ai",
    accent: "purple",
    icon: "Sparkles",
    inputs: [],
    outputs: [{ id: "output", label: "out", type: "text" }],
    defaultData: () => ({ kind: "myNode", label: "My Node" }),
    executable: true,
    ...overrides,
  };
}

describe("validateManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(validateManifest(baseManifest())).toEqual([]);
  });

  describe("rejects bad kind", () => {
    it.each([
      ["", "empty"],
      ["X", "too short"],
      ["UPPERCASE", "starts uppercase"],
      ["123start", "starts with digit"],
      ["has-dash", "non-camelCase"],
      ["a".repeat(33), "too long"],
    ])("%s (%s)", (kind) => {
      const errors = validateManifest(baseManifest({ kind } as Partial<NodeManifest>));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("kind"))).toBe(true);
    });
  });

  it("rejects empty displayName", () => {
    const errors = validateManifest(baseManifest({ displayName: "  " }));
    expect(errors.some((e) => e.includes("displayName"))).toBe(true);
  });

  it("rejects empty description", () => {
    const errors = validateManifest(baseManifest({ description: "" }));
    expect(errors.some((e) => e.includes("description"))).toBe(true);
  });

  it("rejects unknown category", () => {
    const errors = validateManifest(
      baseManifest({ category: "bogus" as unknown as NodeManifest["category"] })
    );
    expect(errors.some((e) => e.includes("category"))).toBe(true);
  });

  it("rejects unknown accent", () => {
    const errors = validateManifest(
      baseManifest({ accent: "magenta" as unknown as NodeManifest["accent"] })
    );
    expect(errors.some((e) => e.includes("accent"))).toBe(true);
  });

  it("rejects empty icon", () => {
    const errors = validateManifest(baseManifest({ icon: "" }));
    expect(errors.some((e) => e.includes("icon"))).toBe(true);
  });

  it("rejects non-boolean executable", () => {
    const errors = validateManifest(
      baseManifest({ executable: "yes" as unknown as boolean })
    );
    expect(errors.some((e) => e.includes("executable"))).toBe(true);
  });

  it("rejects missing defaultData factory", () => {
    const errors = validateManifest(
      baseManifest({ defaultData: undefined as unknown as () => never })
    );
    expect(errors.some((e) => e.includes("defaultData"))).toBe(true);
  });

  describe("handle validation", () => {
    it("rejects duplicate input handle ids", () => {
      const errors = validateManifest(
        baseManifest({
          inputs: [
            { id: "x", label: "x1", type: "text" },
            { id: "x", label: "x2", type: "text" },
          ],
        })
      );
      expect(errors.some((e) => e.includes("duplicate"))).toBe(true);
    });

    it("rejects an id that appears as both input and output", () => {
      const errors = validateManifest(
        baseManifest({
          inputs: [{ id: "shared", label: "in", type: "text" }],
          outputs: [{ id: "shared", label: "out", type: "text" }],
        })
      );
      expect(errors.some((e) => e.includes("input and an output"))).toBe(true);
    });

    it("rejects a handle marked both required and optional", () => {
      const errors = validateManifest(
        baseManifest({
          inputs: [{ id: "x", label: "x", type: "text", required: true, optional: true }],
        })
      );
      expect(errors.some((e) => e.includes("required and optional"))).toBe(true);
    });

    it("rejects handle with empty id", () => {
      const errors = validateManifest(
        baseManifest({
          inputs: [{ id: "", label: "x", type: "text" }],
        })
      );
      expect(errors.length).toBeGreaterThan(0);
    });

    it("rejects handle with empty label", () => {
      const errors = validateManifest(
        baseManifest({
          inputs: [{ id: "x", label: "", type: "text" }],
        })
      );
      expect(errors.some((e) => e.includes("label"))).toBe(true);
    });

    it("rejects non-array inputs", () => {
      const errors = validateManifest(
        baseManifest({ inputs: undefined as unknown as [] })
      );
      expect(errors.some((e) => e.includes("inputs"))).toBe(true);
    });
  });
});
