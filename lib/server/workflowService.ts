/**
 * Workflow service — CRUD for `Workflow` records (the canvas DAG + metadata).
 *
 * Persisted at `.studio-data/workflows/<id>/workflow.json`. Workflows are
 * studio-wide (not scoped to a project) — any project can run any workflow
 * via the composer. The runtime resolves a workflow by id at run start.
 *
 * Note: workflows do NOT own an environment. The active ComfyUI environment
 * is a global studio-level setting (managed by `environmentService`). The
 * `Workflow.environment` field is deprecated and only present for legacy
 * seeded data.
 */
import "server-only";

import fs from "node:fs/promises";
import type {
  Workflow,
  WorkflowBundle,
  WorkflowChangelogEntry,
  WorkflowNode,
  ExportedWorkflow,
} from "@/types";
import {
  assertSafeId,
  ensureDir,
  getWorkflowDir,
  getWorkflowFile,
  getWorkflowsDir,
  pathExists,
  readJson,
  writeJson,
} from "./storage";
import { getManifest, listKinds } from "@/lib/plugins/manifestRegistry";
// Side-effect: ensure manifests are registered before export sanitization runs.
import "@/lib/plugins/registerBuiltins";

const STUDIO_VERSION = "1.0.0";
const SUPPORTED_BUNDLE_VERSIONS: ReadonlyArray<number> = [1];
const MAX_BUNDLE_BYTES = 1_000_000; // 1 MB — workflows are JSON, anything bigger is suspicious.

export class WorkflowNotFoundError extends Error {
  constructor(id: string) {
    super(`Workflow not found: ${id}`);
    this.name = "WorkflowNotFoundError";
  }
}

export async function listWorkflows(): Promise<Workflow[]> {
  const dir = getWorkflowsDir();
  await ensureDir(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const workflows = await Promise.all(
    ids.map(async (id) => {
      try {
        return await readJson<Workflow>(getWorkflowFile(id));
      } catch {
        return null;
      }
    })
  );
  return workflows.filter((w): w is Workflow => w !== null);
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  assertSafeId(id);
  const file = getWorkflowFile(id);
  if (await pathExists(file)) {
    return readJson<Workflow>(file);
  }
  return null;
}

type CreateWorkflowInput = Pick<
  Workflow,
  "name" | "description" | "type" | "tags"
> &
  Partial<Pick<Workflow, "id" | "version" | "status" | "nodes" | "edges">>;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export async function createWorkflow(input: CreateWorkflowInput): Promise<Workflow> {
  const id = input.id ?? `wf-${slugify(input.name)}-${Date.now().toString(36)}`;
  assertSafeId(id);
  if (await pathExists(getWorkflowFile(id))) {
    throw new Error(`Workflow ${id} already exists`);
  }
  const now = new Date().toISOString();
  const workflow: Workflow = {
    id,
    name: input.name,
    description: input.description ?? "",
    type: input.type,
    version: input.version ?? "1.0",
    status: input.status ?? "draft",
    environment: "",
    createdAt: now,
    updatedAt: now,
    tags: input.tags ?? [],
    nodes: input.nodes ?? [],
    edges: input.edges ?? [],
    nodeCount: input.nodes?.length ?? 0,
    averageTime: "0s",
  };
  await ensureDir(getWorkflowDir(id));
  await writeJson(getWorkflowFile(id), workflow);
  return workflow;
}

export async function updateWorkflow(
  id: string,
  patch: Partial<Omit<Workflow, "id" | "createdAt">>
): Promise<Workflow> {
  const existing = await getWorkflow(id);
  if (!existing) throw new WorkflowNotFoundError(id);
  const next: Workflow = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
    nodeCount: patch.nodes?.length ?? existing.nodeCount,
  };
  await writeJson(getWorkflowFile(id), next);
  return next;
}

export async function deleteWorkflow(id: string): Promise<void> {
  assertSafeId(id);
  const dir = getWorkflowDir(id);
  if (!(await pathExists(dir))) throw new WorkflowNotFoundError(id);
  await fs.rm(dir, { recursive: true, force: true });
}

// ----- Lifecycle helpers (Publish / Duplicate / Archive) -----

export class InvalidVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVersionError";
  }
}

const SEMVER_LIKE = /^v?\d+(\.\d+){0,2}([-+][a-zA-Z0-9.-]+)?$/;

/**
 * Mark a workflow as published, bump version, append to changelog.
 *
 * Validation:
 *   - `version` must look semver-ish (`1`, `1.0`, `1.2.3`, optional pre-release).
 *     Stricter than full semver; permissive enough to accept `v1.0` etc.
 *   - The new version must be different from the current version (else what
 *     are we publishing?). Re-publishing the same version is a UX mistake we
 *     surface via a clear error.
 *
 * Side effects:
 *   - status → "published"
 *   - version → new value
 *   - changelog appended with `{ version, notes, publishedAt }`
 *   - publishedAt → now
 *   - updatedAt → now (via updateWorkflow)
 */
export async function publishWorkflow(
  id: string,
  newVersion: string,
  notes?: string
): Promise<Workflow> {
  const existing = await getWorkflow(id);
  if (!existing) throw new WorkflowNotFoundError(id);

  const trimmed = newVersion.trim();
  if (!SEMVER_LIKE.test(trimmed)) {
    throw new InvalidVersionError(
      `Version "${trimmed}" must look like 1, 1.0, or 1.2.3 (optional v prefix).`
    );
  }
  if (trimmed === existing.version && existing.status === "published") {
    throw new InvalidVersionError(
      `Version "${trimmed}" is already published. Bump the version to publish again.`
    );
  }

  const now = new Date().toISOString();
  const entry: WorkflowChangelogEntry = {
    version: trimmed,
    publishedAt: now,
    ...(notes?.trim() ? { notes: notes.trim() } : {}),
  };

  return updateWorkflow(id, {
    status: "published",
    version: trimmed,
    publishedAt: now,
    changelog: [...(existing.changelog ?? []), entry],
  });
}

/**
 * Copy an existing workflow as a fresh draft. Useful for "let me try a
 * variation" — common during iteration. The duplicate gets:
 *   - new id (slugified from `<source-name> copy`)
 *   - reset to status "draft" + version "1.0"
 *   - cleared changelog and publishedAt
 *   - same nodes + edges + tags as the source
 *   - prefixed name ("<source name> (copy)")
 */
export async function duplicateWorkflow(id: string): Promise<Workflow> {
  const source = await getWorkflow(id);
  if (!source) throw new WorkflowNotFoundError(id);

  // Strip sensitive field names (apiKey, secret, accessToken, password)
  // from each node's data when duplicating. Within the same studio, local
  // references like ComfyUI's `endpointId` stay valid — we only want to
  // avoid silently cloning credentials a user might forget exists in two
  // places. Uses the same regex as the export-sanitization safety net,
  // but skips the plugin's own `sanitizeForExport` hook (which clears
  // local-but-resolvable bindings).
  const dupedNodes = source.nodes.map((node) => ({
    ...node,
    data: stripSensitiveFields(node.data ?? {}),
  }));

  return createWorkflow({
    name: `${source.name} (copy)`,
    description: source.description,
    type: source.type,
    tags: source.tags ?? [],
    nodes: dupedNodes,
    edges: source.edges,
    // status, version, id all default in createWorkflow
  });
}

const SENSITIVE_FIELD = /^(api[_-]?key|secret|access[_-]?token|password)$/i;
function stripSensitiveFields(data: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data };
  for (const key of Object.keys(next)) {
    if (SENSITIVE_FIELD.test(key)) delete next[key];
  }
  return next;
}

/**
 * Soft-archive: status → "archived". Hidden from the default workflow
 * list; everything still on disk so unarchive is just a status flip.
 * No data deletion — that's `deleteWorkflow`.
 */
export async function archiveWorkflow(id: string): Promise<Workflow> {
  return updateWorkflow(id, { status: "archived" });
}

// ----- Import / Export -----

export class InvalidBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBundleError";
  }
}

/**
 * Build a portable bundle for `id` — strips identity fields, calls each
 * node's `sanitizeForExport` hook, and assembles `requiredPlugins`.
 *
 * Belt-and-braces safety net: a final regex pass removes any obviously-
 * sensitive field names (`apiKey`, `apikey`) that slipped through plugin
 * sanitization. Plugin authors are responsible for declaring their
 * sensitive fields; this is the failure mode for forgetting.
 */
export async function exportWorkflow(id: string): Promise<WorkflowBundle> {
  const workflow = await getWorkflow(id);
  if (!workflow) throw new WorkflowNotFoundError(id);

  const sanitizedNodes = workflow.nodes.map(sanitizeNodeForExport);
  const requiredPlugins = Array.from(
    new Set(sanitizedNodes.map((n) => (n.data?.kind ?? n.type) as string).filter(Boolean))
  );

  const exported: ExportedWorkflow = {
    name: workflow.name,
    description: workflow.description ?? "",
    type: workflow.type,
    version: workflow.version,
    tags: workflow.tags ?? [],
    nodes: sanitizedNodes,
    edges: workflow.edges,
  };

  return {
    $schema: "https://comfyui-ai-studio.dev/schema/workflow-bundle/v1.json",
    bundleVersion: 1,
    exportedAt: new Date().toISOString(),
    exportedFromStudio: STUDIO_VERSION,
    workflow: exported,
    requiredPlugins,
  };
}

/**
 * Import a bundle as a new workflow. Validates aggressively, calls
 * `createWorkflow`, returns the new workflow plus warnings the UI should
 * surface (missing plugins, nodes that need re-binding).
 */
export async function importWorkflow(
  rawBundle: unknown
): Promise<{ workflow: Workflow; warnings: string[] }> {
  const bundle = validateBundleShape(rawBundle);
  const warnings: string[] = [];

  // Plugin presence check
  const localKinds = new Set(listKinds());
  for (const kind of bundle.requiredPlugins) {
    if (!localKinds.has(kind)) {
      warnings.push(
        `Plugin "${kind}" isn't installed — those nodes will load but won't function.`
      );
    }
  }

  // Per-node validation via plugin manifests' validateData hook
  for (const node of bundle.workflow.nodes) {
    const kind = (node.data?.kind ?? node.type) as string | undefined;
    if (!kind) continue;
    const manifest = getManifest(kind);
    if (!manifest?.validateData) continue;
    const errors = manifest.validateData(node.data);
    if (errors && errors.length > 0) {
      warnings.push(`Node ${node.id} (${kind}): ${errors.join(", ")}`);
    }
  }

  // Re-bind warnings for nodes whose sensitive fields were stripped
  const rebindKinds = new Set(["comfyui", "llm"]);
  const rebindCount = bundle.workflow.nodes.filter((n) =>
    rebindKinds.has((n.data?.kind ?? n.type) as string)
  ).length;
  if (rebindCount > 0) {
    warnings.push(
      `${rebindCount} node${rebindCount > 1 ? "s" : ""} need re-binding (ComfyUI endpoints / LLM API keys).`
    );
  }

  const created = await createWorkflow({
    name: bundle.workflow.name,
    description: bundle.workflow.description,
    type: bundle.workflow.type,
    version: bundle.workflow.version,
    tags: bundle.workflow.tags,
    nodes: bundle.workflow.nodes,
    edges: bundle.workflow.edges,
    status: "draft",
  });

  return { workflow: created, warnings };
}

// ----- Internal helpers -----

/**
 * Run a node's data through its plugin manifest's `sanitizeForExport`
 * hook (when available), then a regex safety net for anything matching
 * known sensitive field names. Both layers run; the manifest hook is
 * the canonical channel, the regex is the failsafe.
 */
function sanitizeNodeForExport(node: WorkflowNode): WorkflowNode {
  const kind = (node.data?.kind ?? node.type) as string | undefined;
  let nextData = node.data ?? {};

  if (kind) {
    const manifest = getManifest(kind);
    if (manifest?.sanitizeForExport) {
      // The sanitize hook is parameterised over each plugin's specific D shape;
      // here we erase the type and trust the hook to return a compatible shape.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hook = manifest.sanitizeForExport as (data: any) => any;
      nextData = hook(nextData);
    }
  }

  // Regex safety net — catches sensitive field names regardless of plugin hook.
  const SENSITIVE = /^(api[_-]?key|secret|access[_-]?token|password)$/i;
  for (const key of Object.keys(nextData)) {
    if (SENSITIVE.test(key)) {
      nextData = { ...nextData, [key]: undefined };
    }
  }

  return {
    ...node,
    data: nextData,
  };
}

/**
 * Validate the raw bundle shape — throws InvalidBundleError on any
 * structural problem. Aggressive about rejecting obviously malformed
 * input (size cap, missing required keys, prototype-pollution attempts).
 */
function validateBundleShape(raw: unknown): WorkflowBundle {
  const serialized = JSON.stringify(raw);
  if (serialized.length > MAX_BUNDLE_BYTES) {
    throw new InvalidBundleError(`Bundle exceeds ${MAX_BUNDLE_BYTES} bytes`);
  }

  // Block prototype-pollution keys
  if (/"__proto__"|"prototype"|"constructor"\s*:/.test(serialized)) {
    throw new InvalidBundleError("Bundle contains disallowed keys");
  }

  if (!raw || typeof raw !== "object") {
    throw new InvalidBundleError("Bundle must be a JSON object");
  }
  const b = raw as Record<string, unknown>;

  if (typeof b.bundleVersion !== "number" || !SUPPORTED_BUNDLE_VERSIONS.includes(b.bundleVersion)) {
    throw new InvalidBundleError(
      `Unsupported bundleVersion: ${String(b.bundleVersion)}. Supported: ${SUPPORTED_BUNDLE_VERSIONS.join(", ")}`
    );
  }

  if (!b.workflow || typeof b.workflow !== "object") {
    throw new InvalidBundleError("Bundle is missing workflow");
  }
  const w = b.workflow as Record<string, unknown>;
  if (typeof w.name !== "string" || !w.name.trim()) {
    throw new InvalidBundleError("Bundle workflow.name is required");
  }
  if (!Array.isArray(w.nodes)) {
    throw new InvalidBundleError("Bundle workflow.nodes must be an array");
  }
  if (!Array.isArray(w.edges)) {
    throw new InvalidBundleError("Bundle workflow.edges must be an array");
  }
  if (!Array.isArray(b.requiredPlugins)) {
    throw new InvalidBundleError("Bundle requiredPlugins must be an array");
  }

  return raw as WorkflowBundle;
}
