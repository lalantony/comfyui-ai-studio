/**
 * ComfyUI environment service — CRUD for `ComfyUIEnvironment` records.
 *
 * Invariants enforced here:
 *   - **Single-active**: at most one env can have `isActive: true`. Enforced
 *     defensively on read (`listEnvironments()` clears extras) and on every
 *     write that flips activation.
 *   - **Field defaults at read time**: older `env.json` files predate
 *     `authMode`, `healthCheckEnabled`, and `healthCheckIntervalSec`.
 *     `normalize()` fills them in (`none`, `true`, `30`) so the rest of the
 *     codebase can rely on the modern shape.
 *   - **Interval clamping**: `healthCheckIntervalSec` is clamped to
 *     [5, 3600] in `updateEnvironment()` so a misbehaving client can't
 *     starve or drown the server.
 *   - **Promote-on-delete**: deleting the active env promotes the first
 *     remaining one, so the user is never stuck without an active env if
 *     any envs still exist.
 */
import "server-only";

import fs from "node:fs/promises";
import { ComfyUIEnvironment } from "@/types";
import {
  assertSafeId,
  ensureDir,
  getComfyEnvironmentDir,
  getComfyEnvironmentFile,
  getComfyEnvironmentsDir,
  pathExists,
  readJson,
  writeJson,
} from "./storage";
import { validateBaseUrl } from "./baseUrlPolicy";

export class EnvironmentNotFoundError extends Error {
  constructor(id: string) {
    super(`ComfyUI environment not found: ${id}`);
    this.name = "EnvironmentNotFoundError";
  }
}

export class InvalidBaseUrlError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidBaseUrlError";
  }
}

function clampRunTimeoutSec(raw: number | undefined): number {
  if (typeof raw !== "number" || Number.isNaN(raw)) return 1800;
  return Math.max(60, Math.min(7200, Math.round(raw)));
}

function normalize(env: ComfyUIEnvironment): ComfyUIEnvironment {
  return {
    ...env,
    authMode: env.authMode ?? "none",
    healthCheckEnabled: env.healthCheckEnabled ?? true,
    healthCheckIntervalSec: env.healthCheckIntervalSec ?? 30,
    runTimeoutSec: env.runTimeoutSec ?? 1800,
  };
}

/**
 * One-time seed: when the environments directory has zero subdirectories
 * (truly fresh install), materialize a default "Local ComfyUI" entry so the
 * studio is immediately functional out of the box for users running ComfyUI
 * locally with no auth.
 *
 * After this runs once, the entry is a normal persisted env — the user can
 * rename it, delete it, or change its settings. Deleting it does NOT trigger
 * a re-seed; the only signal we use is "directory is empty" at first read.
 */
async function seedDefaultEnvironmentIfEmpty(): Promise<void> {
  const id = "env-default-local";
  if (await pathExists(getComfyEnvironmentFile(id))) return;
  const seed: ComfyUIEnvironment = normalize({
    id,
    name: "Local ComfyUI",
    type: "local",
    baseUrl: "http://127.0.0.1:8188",
    authMode: "none",
    isActive: true,
    status: "disconnected",
  });
  await ensureDir(getComfyEnvironmentDir(id));
  await writeJson(getComfyEnvironmentFile(id), seed);
}

export async function listEnvironments(): Promise<ComfyUIEnvironment[]> {
  const dir = getComfyEnvironmentsDir();
  await ensureDir(dir);

  // Fresh install detection: zero env subdirectories → seed a default Local
  // ComfyUI. We re-read after seeding so the rest of the function operates
  // on a populated directory.
  let entries = await fs.readdir(dir, { withFileTypes: true });
  if (entries.filter((e) => e.isDirectory()).length === 0) {
    await seedDefaultEnvironmentIfEmpty();
    entries = await fs.readdir(dir, { withFileTypes: true });
  }

  const ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const envs = await Promise.all(
    ids.map(async (id) => {
      try {
        const env = await readJson<ComfyUIEnvironment>(getComfyEnvironmentFile(id));
        return normalize(env);
      } catch {
        return null;
      }
    })
  );
  // Enforce single-active invariant defensively
  let activeSeen = false;
  return envs
    .filter((e): e is ComfyUIEnvironment => e !== null)
    .map((e) => {
      if (e.isActive) {
        if (activeSeen) return { ...e, isActive: false };
        activeSeen = true;
      }
      return e;
    });
}

export async function getEnvironment(id: string): Promise<ComfyUIEnvironment | null> {
  assertSafeId(id);
  const file = getComfyEnvironmentFile(id);
  if (await pathExists(file)) {
    return normalize(await readJson<ComfyUIEnvironment>(file));
  }
  return null;
}

type CreateEnvironmentInput = Omit<ComfyUIEnvironment, "id" | "isActive" | "status" | "lastChecked"> &
  Partial<Pick<ComfyUIEnvironment, "id" | "isActive">>;

function genId(): string {
  return `env-${Math.random().toString(36).slice(2, 10)}`;
}

export async function createEnvironment(input: CreateEnvironmentInput): Promise<ComfyUIEnvironment> {
  const id = input.id ?? genId();
  assertSafeId(id);
  // SSRF guard at the trust boundary. We re-check on update + at runtime
  // (in ComfyClient) for defence in depth, but failing fast at create time
  // means the user sees a clean dialog error instead of a confusing 500
  // the first time they Run a workflow.
  const urlCheck = validateBaseUrl(input.baseUrl, input.type);
  if (!urlCheck.ok) {
    throw new InvalidBaseUrlError(urlCheck.reason ?? "Invalid base URL");
  }
  if (await pathExists(getComfyEnvironmentFile(id))) {
    throw new Error(`Environment ${id} already exists`);
  }
  const existing = await listEnvironments();
  const env: ComfyUIEnvironment = normalize({
    id,
    name: input.name,
    type: input.type,
    baseUrl: input.baseUrl,
    authMode: input.authMode ?? "none",
    apiKey: input.apiKey,
    isActive: input.isActive ?? existing.length === 0,
    status: "disconnected",
    healthCheckEnabled: input.healthCheckEnabled ?? true,
    healthCheckIntervalSec: input.healthCheckIntervalSec ?? 30,
    runTimeoutSec: clampRunTimeoutSec(input.runTimeoutSec),
  });
  await ensureDir(getComfyEnvironmentDir(id));
  await writeJson(getComfyEnvironmentFile(id), env);
  if (env.isActive) await setActive(id);
  return env;
}

export async function updateEnvironment(
  id: string,
  patch: Partial<Omit<ComfyUIEnvironment, "id">>
): Promise<ComfyUIEnvironment> {
  const existing = await getEnvironment(id);
  if (!existing) throw new EnvironmentNotFoundError(id);
  // Validate baseUrl/type whenever either changes — partial updates can
  // flip the type but keep the URL (or vice-versa) and either combination
  // needs to satisfy the policy.
  if (patch.baseUrl !== undefined || patch.type !== undefined) {
    const nextUrl = patch.baseUrl ?? existing.baseUrl;
    const nextType = patch.type ?? existing.type;
    const urlCheck = validateBaseUrl(nextUrl, nextType);
    if (!urlCheck.ok) {
      throw new InvalidBaseUrlError(urlCheck.reason ?? "Invalid base URL");
    }
  }
  const sanitized: typeof patch = { ...patch };
  if (typeof sanitized.healthCheckIntervalSec === "number") {
    sanitized.healthCheckIntervalSec = Math.max(
      5,
      Math.min(3600, Math.round(sanitized.healthCheckIntervalSec))
    );
  }
  if (typeof sanitized.runTimeoutSec === "number") {
    sanitized.runTimeoutSec = clampRunTimeoutSec(sanitized.runTimeoutSec);
  }
  const next = normalize({ ...existing, ...sanitized, id: existing.id });
  await writeJson(getComfyEnvironmentFile(id), next);
  if (patch.isActive === true) await setActive(id);
  return next;
}

export async function deleteEnvironment(id: string): Promise<void> {
  assertSafeId(id);
  const dir = getComfyEnvironmentDir(id);
  if (!(await pathExists(dir))) throw new EnvironmentNotFoundError(id);
  await fs.rm(dir, { recursive: true, force: true });
  // If we deleted the active one, promote the first remaining (if any).
  const rest = await listEnvironments();
  if (rest.length > 0 && !rest.some((e) => e.isActive)) {
    await setActive(rest[0].id);
  }
}

export async function setActive(id: string): Promise<ComfyUIEnvironment> {
  const all = await listEnvironments();
  const target = all.find((e) => e.id === id);
  if (!target) throw new EnvironmentNotFoundError(id);
  for (const env of all) {
    const shouldBeActive = env.id === id;
    if (env.isActive !== shouldBeActive) {
      await writeJson(getComfyEnvironmentFile(env.id), { ...env, isActive: shouldBeActive });
    }
  }
  return { ...target, isActive: true };
}

export async function getActiveEnvironment(): Promise<ComfyUIEnvironment | null> {
  const all = await listEnvironments();
  return all.find((e) => e.isActive) ?? all[0] ?? null;
}
