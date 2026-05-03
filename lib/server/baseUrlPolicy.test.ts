/**
 * baseUrlPolicy — SSRF allowlist tests.
 *
 * Table-driven so every bypass attempt is one entry. When you find a new
 * sneaky URL form, add a row.
 */
import { describe, expect, it } from "vitest";
import { validateBaseUrl } from "./baseUrlPolicy";
import type { ComfyUIEnvironment } from "@/types";

interface Case {
  url: string;
  type: ComfyUIEnvironment["type"];
  expectOk: boolean;
  /** Optional substring that must appear in the rejection reason. */
  reasonContains?: string;
}

const CASES: Case[] = [
  // --- Local: loopback OK ---
  { url: "http://127.0.0.1:8188", type: "local", expectOk: true },
  { url: "http://localhost:8188", type: "local", expectOk: true },
  { url: "http://[::1]:8188", type: "local", expectOk: true },
  { url: "http://127.0.0.1", type: "local", expectOk: true },
  { url: "https://localhost", type: "local", expectOk: true },
  { url: "http://0.0.0.0:8188", type: "local", expectOk: true },

  // --- Local: non-loopback rejected ---
  { url: "http://10.0.0.1", type: "local", expectOk: false, reasonContains: "non-loopback" },
  { url: "http://example.com", type: "local", expectOk: false, reasonContains: "Local environments must point at the local machine" },
  { url: "http://192.168.1.5", type: "local", expectOk: false, reasonContains: "non-loopback" },

  // --- Remote: public hostnames OK ---
  { url: "https://comfy.example.com", type: "remote", expectOk: true },
  { url: "https://api.runpod.io", type: "remote", expectOk: true },
  { url: "http://3.4.5.6", type: "remote", expectOk: true },

  // --- Remote: loopback rejected ---
  { url: "http://127.0.0.1", type: "remote", expectOk: false, reasonContains: "loopback" },
  { url: "http://localhost:8188", type: "remote", expectOk: false, reasonContains: "loopback" },
  { url: "http://[::1]", type: "remote", expectOk: false, reasonContains: "loopback" },
  { url: "http://0.0.0.0", type: "remote", expectOk: false, reasonContains: "loopback" },

  // --- Remote: RFC1918 rejected ---
  { url: "http://10.0.0.1", type: "remote", expectOk: false, reasonContains: "private" },
  { url: "http://172.16.0.1", type: "remote", expectOk: false, reasonContains: "private" },
  { url: "http://172.31.255.255", type: "remote", expectOk: false, reasonContains: "private" },
  { url: "http://192.168.1.1", type: "remote", expectOk: false, reasonContains: "private" },
  // 172.32 is NOT private — should pass
  { url: "http://172.32.0.1", type: "remote", expectOk: true },
  // 172.15 is NOT private — should pass
  { url: "http://172.15.255.255", type: "remote", expectOk: true },

  // --- Remote: link-local (cloud metadata) rejected ---
  { url: "http://169.254.169.254", type: "remote", expectOk: false, reasonContains: "link-local" },
  { url: "http://169.254.0.1", type: "remote", expectOk: false, reasonContains: "link-local" },
  { url: "http://[fe80::1]", type: "remote", expectOk: false, reasonContains: "link-local" },

  // --- Remote: ULA + multicast rejected ---
  { url: "http://[fc00::1]", type: "remote", expectOk: false, reasonContains: "unique-local" },
  { url: "http://[fd12:3456::1]", type: "remote", expectOk: false, reasonContains: "unique-local" },
  { url: "http://[ff02::1]", type: "remote", expectOk: false, reasonContains: "multicast" },
  { url: "http://224.0.0.1", type: "remote", expectOk: false, reasonContains: "multicast" },

  // --- IPv4-mapped IPv6 bypass attempts ---
  { url: "http://[::ffff:127.0.0.1]", type: "remote", expectOk: false, reasonContains: "IPv6-mapped" },
  { url: "http://[::ffff:169.254.169.254]", type: "remote", expectOk: false, reasonContains: "IPv6-mapped" },

  // --- Bad schemes ---
  { url: "file:///etc/passwd", type: "remote", expectOk: false, reasonContains: "scheme" },
  { url: "gopher://example.com", type: "remote", expectOk: false, reasonContains: "scheme" },
  { url: "ftp://example.com", type: "remote", expectOk: false, reasonContains: "scheme" },
  { url: "javascript:alert(1)", type: "remote", expectOk: false, reasonContains: "scheme" },
  { url: "data:text/plain;base64,aGVsbG8=", type: "remote", expectOk: false, reasonContains: "scheme" },

  // --- Garbage input ---
  { url: "", type: "remote", expectOk: false, reasonContains: "required" },
  { url: "not a url", type: "remote", expectOk: false, reasonContains: "valid URL" },
  { url: "http://", type: "remote", expectOk: false },
];

describe("baseUrlPolicy.validateBaseUrl", () => {
  for (const c of CASES) {
    const label = `${c.expectOk ? "accepts" : "rejects"} ${c.type} ${c.url || "<empty>"}`;
    it(label, () => {
      const result = validateBaseUrl(c.url, c.type);
      expect(result.ok).toBe(c.expectOk);
      if (!c.expectOk && c.reasonContains) {
        expect(result.reason ?? "").toContain(c.reasonContains);
      }
    });
  }

  it("trims surrounding whitespace before parsing", () => {
    expect(validateBaseUrl("  http://127.0.0.1:8188  ", "local").ok).toBe(true);
  });

  it("rejects undefined / non-string input", () => {
    // @ts-expect-error — runtime check for misuse
    expect(validateBaseUrl(undefined, "remote").ok).toBe(false);
    // @ts-expect-error — runtime check for misuse
    expect(validateBaseUrl(null, "remote").ok).toBe(false);
  });
});
