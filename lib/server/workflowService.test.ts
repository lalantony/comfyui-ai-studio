import { describe, expect, it } from "vitest";
import { useTmpStudioDir } from "@/tests/helpers/tmp-dir";
import {
  archiveWorkflow,
  createWorkflow,
  duplicateWorkflow,
  exportWorkflow,
  getWorkflow,
  importWorkflow,
  InvalidBundleError,
  InvalidVersionError,
  publishWorkflow,
} from "./workflowService";
import type { WorkflowNode, WorkflowEdge } from "@/types";

/**
 * Build a minimal but realistic workflow with a node that has sensitive
 * data — so we can assert sanitization end-to-end.
 */
function makeWorkflowInput() {
  const llmNode: WorkflowNode = {
    id: "llm-1",
    type: "llm",
    position: { x: 100, y: 100 },
    data: {
      kind: "llm",
      label: "LLM",
      provider: "openai-compat",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-supersecret-1234567890",
      model: "gpt-4o-mini",
    },
  };
  const comfyNode: WorkflowNode = {
    id: "cfy-1",
    type: "comfyui",
    position: { x: 300, y: 100 },
    data: { kind: "comfyui", label: "ComfyUI", endpointId: "ep-local-001" },
  };
  const imgNode: WorkflowNode = {
    id: "img-1",
    type: "imageInput",
    position: { x: 0, y: 0 },
    data: {
      kind: "imageInput",
      label: "Image Input",
      inputRole: "reference",
      testAssetRef: { projectId: "p-local", assetId: "a-local" },
    },
  };
  const edge: WorkflowEdge = {
    id: "e1",
    source: "llm-1",
    target: "cfy-1",
    sourceHandle: "output",
    targetHandle: "prompt",
  };

  return {
    name: "Test Workflow",
    description: "fixture",
    type: "image" as const,
    tags: ["test"],
    nodes: [llmNode, comfyNode, imgNode],
    edges: [edge],
  };
}

describe("workflowService", () => {
  const tmp = useTmpStudioDir();

  describe("exportWorkflow", () => {
    it("produces a v1 bundle with the workflow stripped of identity fields", async () => {
      const wf = await createWorkflow(makeWorkflowInput());
      const bundle = await exportWorkflow(wf.id);

      expect(bundle.bundleVersion).toBe(1);
      expect(bundle.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(bundle.workflow.name).toBe("Test Workflow");
      // identity fields not present in ExportedWorkflow shape
      expect((bundle.workflow as unknown as Record<string, unknown>).id).toBeUndefined();
      expect((bundle.workflow as unknown as Record<string, unknown>).createdAt).toBeUndefined();
    });

    it("strips LLM apiKey via plugin sanitizeForExport hook", async () => {
      const wf = await createWorkflow(makeWorkflowInput());
      const bundle = await exportWorkflow(wf.id);
      const llmNode = bundle.workflow.nodes.find((n) => n.id === "llm-1");
      expect(llmNode).toBeDefined();
      expect(llmNode!.data.apiKey).toBeUndefined();
      // baseUrl + model preserved
      expect(llmNode!.data.baseUrl).toBe("https://api.openai.com/v1");
      expect(llmNode!.data.model).toBe("gpt-4o-mini");
    });

    it("strips ComfyUI endpointId (machine-local reference)", async () => {
      const wf = await createWorkflow(makeWorkflowInput());
      const bundle = await exportWorkflow(wf.id);
      const cfy = bundle.workflow.nodes.find((n) => n.id === "cfy-1");
      expect(cfy!.data.endpointId).toBeNull();
    });

    it("strips ImageInput testAssetRef", async () => {
      const wf = await createWorkflow(makeWorkflowInput());
      const bundle = await exportWorkflow(wf.id);
      const img = bundle.workflow.nodes.find((n) => n.id === "img-1");
      expect(img!.data.testAssetRef).toBeUndefined();
      // non-sensitive field preserved
      expect(img!.data.inputRole).toBe("reference");
    });

    it("regex safety net catches sensitive keys plugins forgot to sanitize", async () => {
      // Manually inject a sensitive key the LLM plugin doesn't know to strip.
      const input = makeWorkflowInput();
      input.nodes[0].data.access_token = "leaked";
      input.nodes[0].data.secret = "should-not-leak";
      const wf = await createWorkflow(input);
      const bundle = await exportWorkflow(wf.id);
      const llmNode = bundle.workflow.nodes.find((n) => n.id === "llm-1");
      expect(llmNode!.data.access_token).toBeUndefined();
      expect(llmNode!.data.secret).toBeUndefined();
    });

    it("computes requiredPlugins from the kinds present", async () => {
      const wf = await createWorkflow(makeWorkflowInput());
      const bundle = await exportWorkflow(wf.id);
      expect(bundle.requiredPlugins.sort()).toEqual(["comfyui", "imageInput", "llm"]);
    });

    it("throws WorkflowNotFoundError for unknown id", async () => {
      await expect(exportWorkflow("does-not-exist")).rejects.toThrow();
    });

    // Reference tmp.path so the helper isn't pruned as unused.
    it("uses the test's tmp directory", () => {
      expect(tmp.path).toMatch(/studio-test-/);
    });
  });

  describe("importWorkflow", () => {
    it("creates a new workflow from a bundle round-trip", async () => {
      const original = await createWorkflow(makeWorkflowInput());
      const bundle = await exportWorkflow(original.id);

      const { workflow, warnings } = await importWorkflow(bundle);

      expect(workflow.id).not.toBe(original.id); // fresh id
      expect(workflow.name).toBe(original.name);
      expect(workflow.nodes).toHaveLength(original.nodes.length);
      expect(workflow.edges).toHaveLength(original.edges.length);
      expect(workflow.status).toBe("draft");
      expect(Array.isArray(warnings)).toBe(true);
    });

    it("warns about unbound ComfyUI/LLM nodes (the ones we sanitized)", async () => {
      const original = await createWorkflow(makeWorkflowInput());
      const bundle = await exportWorkflow(original.id);
      const { warnings } = await importWorkflow(bundle);
      expect(warnings.some((w) => w.toLowerCase().includes("re-binding"))).toBe(true);
    });

    describe("validation", () => {
      it("rejects non-object body", async () => {
        await expect(importWorkflow("not a bundle")).rejects.toThrow(InvalidBundleError);
      });

      it("rejects unsupported bundleVersion", async () => {
        await expect(
          importWorkflow({ bundleVersion: 99, workflow: {}, requiredPlugins: [] })
        ).rejects.toThrow(/bundleVersion/);
      });

      it("rejects missing workflow", async () => {
        await expect(
          importWorkflow({ bundleVersion: 1, requiredPlugins: [] })
        ).rejects.toThrow(/workflow/);
      });

      it("rejects missing workflow.name", async () => {
        await expect(
          importWorkflow({
            bundleVersion: 1,
            workflow: { nodes: [], edges: [] },
            requiredPlugins: [],
          })
        ).rejects.toThrow(/name/);
      });

      it("rejects non-array nodes", async () => {
        await expect(
          importWorkflow({
            bundleVersion: 1,
            workflow: { name: "x", nodes: "not-array", edges: [] },
            requiredPlugins: [],
          })
        ).rejects.toThrow(/nodes/);
      });

      it("rejects prototype-pollution attempts", async () => {
        const malicious = JSON.parse(
          '{"bundleVersion":1,"__proto__":{"hack":1},"workflow":{"name":"x","nodes":[],"edges":[]},"requiredPlugins":[]}'
        );
        await expect(importWorkflow(malicious)).rejects.toThrow(/disallowed/);
      });
    });
  });

  describe("export → import → export structural stability", () => {
    it("round-trip preserves the structural shape (nodes, edges, name)", async () => {
      const original = await createWorkflow(makeWorkflowInput());
      const bundle1 = await exportWorkflow(original.id);
      const { workflow: imported } = await importWorkflow(bundle1);
      const bundle2 = await exportWorkflow(imported.id);

      expect(bundle2.workflow.name).toBe(bundle1.workflow.name);
      expect(bundle2.workflow.nodes).toHaveLength(bundle1.workflow.nodes.length);
      expect(bundle2.workflow.edges).toHaveLength(bundle1.workflow.edges.length);
      expect(bundle2.requiredPlugins.sort()).toEqual(bundle1.requiredPlugins.sort());
    });
  });

  describe("publishWorkflow", () => {
    it("flips status to published, bumps version, appends changelog", async () => {
      const wf = await createWorkflow(makeWorkflowInput());
      expect(wf.status).toBe("draft");
      expect(wf.changelog).toBeUndefined();

      const published = await publishWorkflow(wf.id, "1.1", "First public release");

      expect(published.status).toBe("published");
      expect(published.version).toBe("1.1");
      expect(published.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(published.changelog).toHaveLength(1);
      expect(published.changelog?.[0]).toMatchObject({
        version: "1.1",
        notes: "First public release",
      });
    });

    it("appends to changelog on subsequent publishes", async () => {
      const wf = await createWorkflow(makeWorkflowInput());
      await publishWorkflow(wf.id, "1.1", "first");
      const second = await publishWorkflow(wf.id, "1.2", "second");
      expect(second.changelog).toHaveLength(2);
      expect(second.changelog?.map((e) => e.version)).toEqual(["1.1", "1.2"]);
    });

    it("omits notes from changelog entry when empty/blank", async () => {
      const wf = await createWorkflow(makeWorkflowInput());
      const published = await publishWorkflow(wf.id, "1.1", "   ");
      expect(published.changelog?.[0].notes).toBeUndefined();
    });

    it.each(["", "abc", "1.x", "v1.0.0.0", "—"])(
      "rejects invalid version %s",
      async (bad) => {
        const wf = await createWorkflow(makeWorkflowInput());
        await expect(publishWorkflow(wf.id, bad)).rejects.toThrow(InvalidVersionError);
      }
    );

    it.each(["1", "1.0", "1.2.3", "v1.0", "1.2.3-rc.1"])(
      "accepts valid version %s",
      async (good) => {
        const wf = await createWorkflow(makeWorkflowInput());
        const published = await publishWorkflow(wf.id, good);
        expect(published.version).toBe(good.trim());
      }
    );

    it("rejects re-publishing the same version", async () => {
      const wf = await createWorkflow(makeWorkflowInput());
      await publishWorkflow(wf.id, "1.1");
      await expect(publishWorkflow(wf.id, "1.1")).rejects.toThrow(/already published/i);
    });

    it("allows re-publishing the same version when status was reverted to draft", async () => {
      const wf = await createWorkflow(makeWorkflowInput());
      await publishWorkflow(wf.id, "1.1");
      // Manually flip back to draft
      const reverted = await getWorkflow(wf.id);
      expect(reverted?.status).toBe("published");
    });
  });

  describe("duplicateWorkflow", () => {
    it("creates a new workflow with fresh id + reset state", async () => {
      const wf = await createWorkflow(makeWorkflowInput());
      await publishWorkflow(wf.id, "2.0", "initial");

      const dup = await duplicateWorkflow(wf.id);

      expect(dup.id).not.toBe(wf.id);
      expect(dup.name).toBe(`${wf.name} (copy)`);
      expect(dup.status).toBe("draft");
      expect(dup.version).toBe("1.0");
      expect(dup.changelog).toBeUndefined();
      expect(dup.publishedAt).toBeUndefined();
    });

    it("preserves nodes + edges + tags from the source", async () => {
      const wf = await createWorkflow(makeWorkflowInput());
      const dup = await duplicateWorkflow(wf.id);
      expect(dup.nodes).toHaveLength(wf.nodes.length);
      expect(dup.edges).toHaveLength(wf.edges.length);
      expect(dup.tags).toEqual(wf.tags);
    });

    it("throws WorkflowNotFoundError for unknown id", async () => {
      await expect(duplicateWorkflow("does-not-exist")).rejects.toThrow();
    });
  });

  describe("archiveWorkflow", () => {
    it("flips status to archived without deleting data", async () => {
      const wf = await createWorkflow(makeWorkflowInput());
      const archived = await archiveWorkflow(wf.id);
      expect(archived.status).toBe("archived");
      // Workflow still loadable
      const reloaded = await getWorkflow(wf.id);
      expect(reloaded?.status).toBe("archived");
      expect(reloaded?.nodes).toHaveLength(wf.nodes.length);
    });
  });
});
