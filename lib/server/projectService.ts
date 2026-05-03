/**
 * Project service — CRUD for `Project` records.
 *
 * One project per directory under `.studio-data/projects/<id>/`:
 *   - `project.json`   — the `Project` record
 *   - `assets/`        — per-asset sidecars + binaries (managed by `assetService`)
 *   - `runs/<runId>/`  — project-mode workflow runs
 *
 * `assetCount` and `workflowCount` on the Project record are caches —
 * `recountProject()` rebuilds them after asset mutations. The cache is
 * advisory; correctness checks read the actual files.
 *
 * Deleting a project recursively removes its entire directory, including
 * runs. There is no soft-delete or trash bin — destructive ops are confirmed
 * in the UI via `ConfirmDialog`.
 */
import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { Project } from "@/types";
import {
  assertSafeId,
  ensureDir,
  getAssetsDir,
  getProjectDir,
  getProjectFile,
  getProjectsDir,
  pathExists,
  readJson,
  writeJson,
} from "./storage";
import { releaseBlob } from "./blobStore";
import type { AssetSidecar } from "./assetService";

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
    this.name = "ProjectNotFoundError";
  }
}

export async function listProjects(): Promise<Project[]> {
  const dir = getProjectsDir();
  await ensureDir(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const projects = await Promise.all(
    ids.map(async (id) => {
      try {
        return await readJson<Project>(getProjectFile(id));
      } catch {
        return null;
      }
    })
  );
  return projects.filter((p): p is Project => p !== null);
}

export async function getProject(id: string): Promise<Project | null> {
  assertSafeId(id);
  const file = getProjectFile(id);
  if (await pathExists(file)) {
    return readJson<Project>(file);
  }
  return null;
}

export async function createProject(
  input: Omit<Project, "createdAt" | "updatedAt" | "assetCount" | "workflowCount">
): Promise<Project> {
  assertSafeId(input.id);
  if (await pathExists(getProjectFile(input.id))) {
    throw new Error(`Project ${input.id} already exists`);
  }
  const now = new Date().toISOString();
  const project: Project = {
    ...input,
    createdAt: now,
    updatedAt: now,
    assetCount: 0,
    workflowCount: 0,
  };
  await ensureDir(getAssetsDir(input.id));
  await writeJson(getProjectFile(input.id), project);
  return project;
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<Project, "id" | "createdAt">>
): Promise<Project> {
  const existing = await getProject(id);
  if (!existing) throw new ProjectNotFoundError(id);
  const updated: Project = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(getProjectFile(id), updated);
  return updated;
}

export async function deleteProject(id: string): Promise<void> {
  assertSafeId(id);
  const dir = getProjectDir(id);
  if (!(await pathExists(dir))) throw new ProjectNotFoundError(id);

  // Release every blob referenced by this project's assets BEFORE removing
  // the directory. Otherwise the rm wipes the sidecars and we leak refcounts
  // (and ultimately disk) on shared blobs that other projects still use.
  // Best-effort: a partial failure here just leaks one blob's count, which a
  // future "verify references" tool can reconcile.
  await releaseProjectBlobs(id);

  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Walk a project's `assets/` directory and call `releaseBlob` for every
 * sidecar that references the blob pool. Used by `deleteProject` and any
 * future bulk-clean code paths.
 */
async function releaseProjectBlobs(projectId: string): Promise<void> {
  const assetsDir = getAssetsDir(projectId);
  if (!(await pathExists(assetsDir))) return;

  const entries = await fs.readdir(assetsDir);
  await Promise.all(
    entries
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => {
        try {
          const sidecar = await readJson<AssetSidecar>(path.join(assetsDir, f));
          if (sidecar.contentHash) {
            await releaseBlob(sidecar.contentHash);
          }
        } catch (err) {
          console.warn(`[projectService] releaseProjectBlobs: ${f}`, err);
        }
      })
  );
}

export async function recountProject(id: string): Promise<Project> {
  const project = await getProject(id);
  if (!project) throw new ProjectNotFoundError(id);
  const assetsDir = getAssetsDir(id);
  await ensureDir(assetsDir);
  const entries = await fs.readdir(assetsDir);
  const assetCount = entries.filter((f) => f.endsWith(".json")).length;
  if (project.assetCount === assetCount) return project;
  return updateProject(id, { assetCount });
}
