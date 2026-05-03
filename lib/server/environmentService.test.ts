/**
 * environmentService — focuses on the SSRF guard on create + update.
 * Other behaviours (single-active invariant, default seed, interval clamp)
 * are exercised via the API integration tests.
 */
import { describe, expect, it } from "vitest";
import { useTmpStudioDir } from "@/tests/helpers/tmp-dir";
import {
  createEnvironment,
  InvalidBaseUrlError,
  updateEnvironment,
} from "./environmentService";

describe("environmentService — baseUrl SSRF guard", () => {
  useTmpStudioDir();

  it("creates a valid local env", async () => {
    const env = await createEnvironment({
      name: "Local",
      type: "local",
      baseUrl: "http://127.0.0.1:8188",
      authMode: "none",
    });
    expect(env.baseUrl).toBe("http://127.0.0.1:8188");
  });

  it("rejects file:// scheme on create", async () => {
    await expect(
      createEnvironment({
        name: "Bad",
        type: "remote",
        baseUrl: "file:///etc/passwd",
        authMode: "none",
      })
    ).rejects.toBeInstanceOf(InvalidBaseUrlError);
  });

  it("rejects loopback for remote envs on create", async () => {
    await expect(
      createEnvironment({
        name: "Bad",
        type: "remote",
        baseUrl: "http://127.0.0.1:8188",
        authMode: "none",
      })
    ).rejects.toBeInstanceOf(InvalidBaseUrlError);
  });

  it("rejects AWS metadata IP for remote envs on create", async () => {
    await expect(
      createEnvironment({
        name: "Bad",
        type: "remote",
        baseUrl: "http://169.254.169.254",
        authMode: "none",
      })
    ).rejects.toBeInstanceOf(InvalidBaseUrlError);
  });

  it("rejects baseUrl change on update", async () => {
    const env = await createEnvironment({
      name: "Local",
      type: "local",
      baseUrl: "http://127.0.0.1:8188",
      authMode: "none",
    });
    await expect(
      updateEnvironment(env.id, { baseUrl: "file:///etc/passwd" })
    ).rejects.toBeInstanceOf(InvalidBaseUrlError);
  });

  it("rejects type-only update that invalidates existing url (local→remote with loopback)", async () => {
    const env = await createEnvironment({
      name: "Local",
      type: "local",
      baseUrl: "http://127.0.0.1:8188",
      authMode: "none",
    });
    await expect(
      updateEnvironment(env.id, { type: "remote" })
    ).rejects.toBeInstanceOf(InvalidBaseUrlError);
  });

  it("allows updating unrelated fields without re-validating url", async () => {
    const env = await createEnvironment({
      name: "Local",
      type: "local",
      baseUrl: "http://127.0.0.1:8188",
      authMode: "none",
    });
    const next = await updateEnvironment(env.id, { name: "Renamed" });
    expect(next.name).toBe("Renamed");
    expect(next.baseUrl).toBe("http://127.0.0.1:8188");
  });
});
