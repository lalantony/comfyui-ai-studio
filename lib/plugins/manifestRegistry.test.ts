import { afterEach, describe, expect, it } from "vitest";
import type { NodeManifest } from "./types";
import {
  __clearRegistryForTests,
  getManifest,
  hasManifest,
  listKinds,
  listManifests,
  listManifestsByCategory,
  registerManifest,
  validateRegistry,
} from "./manifestRegistry";

function manifest(overrides: Partial<NodeManifest> = {}): NodeManifest {
  return {
    kind: "myNode",
    displayName: "My Node",
    description: "Test fixture node.",
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

describe("manifestRegistry", () => {
  afterEach(() => {
    __clearRegistryForTests();
  });

  describe("registerManifest", () => {
    it("makes the manifest retrievable by kind", () => {
      const m = manifest();
      registerManifest(m);
      expect(getManifest("myNode")).toBe(m);
    });

    it("throws when the manifest is malformed", () => {
      expect(() =>
        registerManifest(manifest({ kind: "" } as Partial<NodeManifest>))
      ).toThrow(/Invalid manifest/);
    });

    it("overwrites on duplicate kind (last-write-wins for hot-reload)", () => {
      registerManifest(manifest({ displayName: "First" }));
      registerManifest(manifest({ displayName: "Second" }));
      expect(getManifest("myNode")?.displayName).toBe("Second");
    });
  });

  describe("hasManifest", () => {
    it("returns true for registered kinds", () => {
      registerManifest(manifest());
      expect(hasManifest("myNode")).toBe(true);
    });

    it("returns false for unknown kinds", () => {
      expect(hasManifest("nope")).toBe(false);
    });
  });

  describe("listManifests", () => {
    it("returns every registered manifest", () => {
      registerManifest(manifest({ kind: "alpha", displayName: "Alpha" }));
      registerManifest(manifest({ kind: "beta", displayName: "Beta" }));
      const list = listManifests();
      expect(list).toHaveLength(2);
      expect(list.map((m) => m.kind).sort()).toEqual(["alpha", "beta"]);
    });

    it("returns empty array on empty registry", () => {
      expect(listManifests()).toEqual([]);
    });
  });

  describe("listManifestsByCategory", () => {
    it("filters by category", () => {
      registerManifest(manifest({ kind: "src1", displayName: "Src 1", category: "source" }));
      registerManifest(manifest({ kind: "src2", displayName: "Src 2", category: "source" }));
      registerManifest(manifest({ kind: "ai1", displayName: "AI 1", category: "ai" }));
      expect(listManifestsByCategory("source")).toHaveLength(2);
      expect(listManifestsByCategory("ai")).toHaveLength(1);
      expect(listManifestsByCategory("comfyui")).toHaveLength(0);
    });
  });

  describe("listKinds", () => {
    it("returns every registered kind", () => {
      registerManifest(manifest({ kind: "kindOne", displayName: "K1" }));
      registerManifest(manifest({ kind: "kindTwo", displayName: "K2" }));
      expect(listKinds().sort()).toEqual(["kindOne", "kindTwo"]);
    });
  });

  describe("validateRegistry", () => {
    it("returns no errors for a clean registry", () => {
      registerManifest(manifest({ kind: "kindOne", displayName: "Alpha" }));
      registerManifest(manifest({ kind: "kindTwo", displayName: "Beta" }));
      expect(validateRegistry()).toEqual([]);
    });

    it("flags duplicate displayNames across kinds", () => {
      registerManifest(manifest({ kind: "kindOne", displayName: "Same" }));
      registerManifest(manifest({ kind: "kindTwo", displayName: "Same" }));
      const errors = validateRegistry();
      expect(errors.some((e) => e.includes("Duplicate displayName"))).toBe(true);
    });
  });
});
