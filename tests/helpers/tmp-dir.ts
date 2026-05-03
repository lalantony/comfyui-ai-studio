/**
 * Temporary `STUDIO_DATA_DIR` helper for tests that touch the filesystem.
 *
 * Every test that exercises the storage layer (asset service, blob store,
 * project service, etc.) calls `useTmpStudioDir()` in `beforeEach` to get
 * a fresh, isolated directory. The cleanup runs in `afterEach`.
 *
 * Why a real tmp dir instead of mocking fs:
 *   1. Mocks of our own code lie. Real I/O catches integration bugs.
 *   2. The blob store relies on `fs.rename` for atomicity — that only
 *      works on real filesystems.
 *   3. The studio's invariants (sidecar + binary, refcount metadata) are
 *      structural, and structural tests need real structure.
 *
 * Performance: each test creates + tears down a directory. On modern SSDs
 * this is sub-millisecond. We don't pool or reuse — isolation > speed.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";

interface TmpStudioDirHandle {
  /** Absolute path to the tmp `STUDIO_DATA_DIR` for this test. */
  readonly path: string;
}

/**
 * Allocate a fresh tmp directory and override `STUDIO_DATA_DIR` to point
 * at it for the duration of each test. Cleans up automatically.
 *
 * @example
 *   describe("blobStore", () => {
 *     const tmp = useTmpStudioDir();
 *     it("writes a blob", async () => {
 *       const { hash } = await putBlob(buffer, "png");
 *       // tmp.path / "blobs" / "<hash>.png" exists
 *     });
 *   });
 */
export function useTmpStudioDir(): TmpStudioDirHandle {
  const handle: { path: string } = { path: "" };

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-test-"));
    handle.path = dir;
    vi.stubEnv("STUDIO_DATA_DIR", dir);
  });

  afterEach(async () => {
    if (handle.path) {
      await fs.rm(handle.path, { recursive: true, force: true });
    }
  });

  return {
    get path() {
      return handle.path;
    },
  };
}
