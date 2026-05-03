import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { useTmpStudioDir } from "@/tests/helpers/tmp-dir";
import {
  acquireBlob,
  blobExists,
  getBlobBuffer,
  putBlob,
  releaseBlob,
} from "./blobStore";
import { getBlobMetaPath, getBlobPath } from "./storage";

function buf(data: string): Buffer {
  return Buffer.from(data, "utf8");
}

describe("blobStore", () => {
  const tmp = useTmpStudioDir();

  describe("putBlob", () => {
    it("writes the binary + meta on first put", async () => {
      const { hash, ext } = await putBlob(buf("hello"), "txt");

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(ext).toBe("txt");
      await expect(fs.access(getBlobPath(hash, ext))).resolves.toBeUndefined();
      await expect(fs.access(getBlobMetaPath(hash))).resolves.toBeUndefined();
    });

    it("returns identical hash for identical content (dedup)", async () => {
      const a = await putBlob(buf("same"), "txt");
      const b = await putBlob(buf("same"), "txt");
      expect(a.hash).toBe(b.hash);
    });

    it("returns different hashes for different content", async () => {
      const a = await putBlob(buf("alpha"), "txt");
      const b = await putBlob(buf("beta"), "txt");
      expect(a.hash).not.toBe(b.hash);
    });

    it("increments refcount on duplicate puts", async () => {
      const { hash } = await putBlob(buf("x"), "txt");
      await putBlob(buf("x"), "txt");
      await putBlob(buf("x"), "txt");

      const meta = JSON.parse(await fs.readFile(getBlobMetaPath(hash), "utf8")) as {
        refCount: number;
      };
      expect(meta.refCount).toBe(3);
    });

    it("normalizes the extension (strips dot, lowercases, alphanumeric only)", async () => {
      const { ext } = await putBlob(buf("abc"), ".PnG");
      expect(ext).toBe("png");
    });

    it("falls back to 'bin' for empty extension", async () => {
      const { ext } = await putBlob(buf("abc"), "");
      expect(ext).toBe("bin");
    });

    it("rewrites missing binary defensively (someone deleted it manually)", async () => {
      const { hash, ext } = await putBlob(buf("rebuild me"), "txt");
      await fs.rm(getBlobPath(hash, ext));

      // Second put with the same content should restore the binary.
      await putBlob(buf("rebuild me"), "txt");
      await expect(fs.access(getBlobPath(hash, ext))).resolves.toBeUndefined();
    });
  });

  describe("acquireBlob", () => {
    it("bumps the refcount without reading bytes", async () => {
      const { hash } = await putBlob(buf("ref-me"), "txt");
      await acquireBlob(hash);

      const meta = JSON.parse(await fs.readFile(getBlobMetaPath(hash), "utf8")) as {
        refCount: number;
      };
      expect(meta.refCount).toBe(2);
    });

    it("throws when the blob doesn't exist", async () => {
      const fakeHash = "0".repeat(64);
      await expect(acquireBlob(fakeHash)).rejects.toThrow(/no blob/);
    });
  });

  describe("releaseBlob", () => {
    it("decrements refcount when above 1", async () => {
      const { hash } = await putBlob(buf("multi"), "txt");
      await acquireBlob(hash); // count = 2
      await releaseBlob(hash); // count = 1

      const meta = JSON.parse(await fs.readFile(getBlobMetaPath(hash), "utf8")) as {
        refCount: number;
      };
      expect(meta.refCount).toBe(1);
      expect(await blobExists(hash)).toBe(true);
    });

    it("garbage-collects the blob when refcount hits 0", async () => {
      const { hash, ext } = await putBlob(buf("alone"), "txt");
      await releaseBlob(hash);

      expect(await blobExists(hash)).toBe(false);
      await expect(fs.access(getBlobPath(hash, ext))).rejects.toThrow();
      await expect(fs.access(getBlobMetaPath(hash))).rejects.toThrow();
    });

    it("is idempotent on a missing blob (no throw)", async () => {
      const fakeHash = "f".repeat(64);
      await expect(releaseBlob(fakeHash)).resolves.toBeUndefined();
    });

    it("survives a full refcount lifecycle (3 acquires → 4 releases)", async () => {
      const { hash } = await putBlob(buf("lifecycle"), "txt");
      await acquireBlob(hash); // 2
      await acquireBlob(hash); // 3
      await acquireBlob(hash); // 4
      await releaseBlob(hash); // 3
      await releaseBlob(hash); // 2
      await releaseBlob(hash); // 1
      expect(await blobExists(hash)).toBe(true);
      await releaseBlob(hash); // 0 → GC
      expect(await blobExists(hash)).toBe(false);
    });
  });

  describe("getBlobBuffer", () => {
    it("returns the bytes + extension when the blob exists", async () => {
      const { hash } = await putBlob(buf("read me back"), "txt");
      const got = await getBlobBuffer(hash);
      expect(got).not.toBeNull();
      expect(got!.buffer.toString("utf8")).toBe("read me back");
      expect(got!.ext).toBe("txt");
    });

    it("returns null when the blob isn't in the pool", async () => {
      const fakeHash = "1".repeat(64);
      expect(await getBlobBuffer(fakeHash)).toBeNull();
    });

    it("returns null when meta exists but binary is gone", async () => {
      const { hash, ext } = await putBlob(buf("orphan"), "txt");
      await fs.rm(getBlobPath(hash, ext));
      expect(await getBlobBuffer(hash)).toBeNull();
    });
  });

  describe("storage layout invariant", () => {
    it("places blobs under <STUDIO_DATA_DIR>/blobs/", async () => {
      const { hash, ext } = await putBlob(buf("path-check"), "txt");
      const expected = path.join(tmp.path, "blobs", `${hash}.${ext}`);
      const actual = getBlobPath(hash, ext);
      // Normalize separators for cross-platform comparison.
      expect(actual.replace(/\\/g, "/")).toBe(expected.replace(/\\/g, "/"));
    });
  });
});
