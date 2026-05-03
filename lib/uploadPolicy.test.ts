/**
 * uploadPolicy — covers the registry-based validator and env overrides.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSET_TYPE_REGISTRY,
  getAcceptString,
  getMaxBytes,
  validateUpload,
} from "./uploadPolicy";

describe("uploadPolicy.validateUpload", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a normal PNG", () => {
    const result = validateUpload({ name: "shot.png", size: 1024, type: "image/png" });
    expect(result).toEqual({ ok: true, type: "image" });
  });

  it("accepts a video by extension when MIME is missing", () => {
    const result = validateUpload({ name: "clip.mp4", size: 1024, type: "" });
    expect(result).toEqual({ ok: true, type: "video" });
  });

  it("accepts the modern .m4a extension as music", () => {
    const result = validateUpload({ name: "song.m4a", size: 1024, type: "" });
    expect(result).toEqual({ ok: true, type: "music" });
  });

  it("rejects an empty file with a clear reason", () => {
    const result = validateUpload({ name: "shot.png", size: 0, type: "image/png" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("empty");
  });

  it("rejects an unknown MIME type with no matching extension", () => {
    const result = validateUpload({
      name: "thing.xyz",
      size: 1024,
      type: "application/x-shockwave-flash",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not allowed");
  });

  it("rejects an executable masquerading as octet-stream", () => {
    const result = validateUpload({
      name: "evil.exe",
      size: 1024,
      type: "application/octet-stream",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects oversized images at default 25MB cap", () => {
    const result = validateUpload({
      name: "huge.png",
      size: 26 * 1024 * 1024,
      type: "image/png",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("too large");
  });

  it("respects STUDIO_UPLOAD_MAX_IMAGE_MB to raise the cap", () => {
    vi.stubEnv("STUDIO_UPLOAD_MAX_IMAGE_MB", "100");
    const result = validateUpload({
      name: "huge.png",
      size: 80 * 1024 * 1024,
      type: "image/png",
    });
    expect(result).toEqual({ ok: true, type: "image" });
  });

  it("falls back to default when env override is non-numeric", () => {
    vi.stubEnv("STUDIO_UPLOAD_MAX_IMAGE_MB", "huge");
    expect(getMaxBytes("image")).toBe(25 * 1024 * 1024);
  });

  it("falls back to default when env override is negative", () => {
    vi.stubEnv("STUDIO_UPLOAD_MAX_IMAGE_MB", "-5");
    expect(getMaxBytes("image")).toBe(25 * 1024 * 1024);
  });
});

describe("uploadPolicy.getAcceptString", () => {
  it("contains every registered MIME and extension", () => {
    const accept = getAcceptString();
    for (const p of ASSET_TYPE_REGISTRY) {
      for (const m of p.mimes) expect(accept).toContain(m);
      for (const e of p.extensions) expect(accept).toContain(`.${e}`);
    }
  });
});
