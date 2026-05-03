/**
 * Endpoint service — CRUD for `ComfyEndpoint` records, scoped under a
 * specific `ComfyUIEnvironment`.
 *
 * Two files per endpoint:
 *   - `endpoint.json`     — the `ComfyEndpoint` shape (input/output mappings,
 *                           name, description, timestamps)
 *   - `workflow_api.json` — the raw ComfyUI prompt JSON, untouched. The
 *                           runtime patches a fresh in-memory copy on every
 *                           run; the on-disk file is the immutable template.
 *
 * Endpoints are the bridge between the user-facing canvas (which speaks in
 * studio ports like `prompt`, `image`) and the ComfyUI graph (which speaks
 * in node ids and field paths). The `inputs[].comfyNodeId` +
 * `inputs[].comfyInputPath` pair is what tells the executor where in the
 * `workflow_api.json` to write each user value.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { ComfyEndpoint } from "@/types";
import {
  assertSafeId,
  ensureDir,
  getComfyEndpointDir,
  getComfyEndpointFile,
  getComfyEndpointsDir,
  getComfyEndpointWorkflowApiFile,
  pathExists,
  readJson,
  writeJson,
} from "./storage";
import { getEnvironment, EnvironmentNotFoundError } from "./environmentService";

export class EndpointNotFoundError extends Error {
  constructor(envId: string, endpointId: string) {
    super(`Endpoint not found: ${envId}/${endpointId}`);
    this.name = "EndpointNotFoundError";
  }
}

async function assertEnvironmentExists(envId: string): Promise<void> {
  const env = await getEnvironment(envId);
  if (!env) throw new EnvironmentNotFoundError(envId);
}

export async function listEndpoints(envId: string): Promise<ComfyEndpoint[]> {
  await assertEnvironmentExists(envId);
  const dir = getComfyEndpointsDir(envId);
  await ensureDir(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const endpoints = await Promise.all(
    ids.map(async (id) => {
      try {
        return await readJson<ComfyEndpoint>(getComfyEndpointFile(envId, id));
      } catch {
        return null;
      }
    })
  );
  return endpoints
    .filter((e): e is ComfyEndpoint => e !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getEndpoint(envId: string, endpointId: string): Promise<ComfyEndpoint | null> {
  await assertEnvironmentExists(envId);
  assertSafeId(endpointId);
  const file = getComfyEndpointFile(envId, endpointId);
  if (!(await pathExists(file))) return null;
  return readJson<ComfyEndpoint>(file);
}

export async function getEndpointWorkflowApiJson(
  envId: string,
  endpointId: string
): Promise<string | null> {
  await assertEnvironmentExists(envId);
  const file = getComfyEndpointWorkflowApiFile(envId, endpointId);
  if (!(await pathExists(file))) return null;
  return fs.readFile(file, "utf8");
}

interface CreateEndpointInput {
  name: string;
  description?: string;
  inputs: ComfyEndpoint["inputs"];
  output: ComfyEndpoint["output"];
  workflowApiJson: string;
}

export async function createEndpoint(envId: string, input: CreateEndpointInput): Promise<ComfyEndpoint> {
  await assertEnvironmentExists(envId);
  // Validate the workflow_api.json is parseable JSON
  try {
    JSON.parse(input.workflowApiJson);
  } catch {
    throw new Error("workflow_api.json is not valid JSON");
  }

  // Full UUID, not a 12-char slice — same rationale as runtime.runId. The
  // prefix + UUID = 39 chars, well inside ID_PATTERN's 128-char limit.
  const id = `ep-${randomUUID()}`;
  const now = new Date().toISOString();
  const endpoint: ComfyEndpoint = {
    id,
    environmentId: envId,
    name: input.name,
    description: input.description,
    inputs: input.inputs,
    output: input.output,
    createdAt: now,
    updatedAt: now,
  };
  await ensureDir(getComfyEndpointDir(envId, id));
  await writeJson(getComfyEndpointFile(envId, id), endpoint);
  await fs.writeFile(getComfyEndpointWorkflowApiFile(envId, id), input.workflowApiJson, "utf8");
  return endpoint;
}

interface UpdateEndpointInput {
  name?: string;
  description?: string;
  inputs?: ComfyEndpoint["inputs"];
  output?: ComfyEndpoint["output"];
  workflowApiJson?: string;
}

export async function updateEndpoint(
  envId: string,
  endpointId: string,
  patch: UpdateEndpointInput
): Promise<ComfyEndpoint> {
  const existing = await getEndpoint(envId, endpointId);
  if (!existing) throw new EndpointNotFoundError(envId, endpointId);

  if (patch.workflowApiJson !== undefined) {
    try {
      JSON.parse(patch.workflowApiJson);
    } catch {
      throw new Error("workflow_api.json is not valid JSON");
    }
  }

  const next: ComfyEndpoint = {
    ...existing,
    name: patch.name ?? existing.name,
    description: patch.description ?? existing.description,
    inputs: patch.inputs ?? existing.inputs,
    output: patch.output ?? existing.output,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(getComfyEndpointFile(envId, endpointId), next);
  if (patch.workflowApiJson !== undefined) {
    await fs.writeFile(
      getComfyEndpointWorkflowApiFile(envId, endpointId),
      patch.workflowApiJson,
      "utf8"
    );
  }
  return next;
}

export async function deleteEndpoint(envId: string, endpointId: string): Promise<void> {
  const existing = await getEndpoint(envId, endpointId);
  if (!existing) throw new EndpointNotFoundError(envId, endpointId);
  await fs.rm(getComfyEndpointDir(envId, endpointId), { recursive: true, force: true });
}

/** List endpoints across every environment — used to populate the canvas comfyui node dropdown if we ever go cross-env. */
export async function listAllEndpoints(): Promise<ComfyEndpoint[]> {
  // Scoped to the active environment in v1; this helper is here for future use.
  // Implementation deferred — callers should use listEndpoints(envId) for now.
  return [];
}
