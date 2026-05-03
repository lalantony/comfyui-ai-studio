/**
 * SSRF allowlist for ComfyUI environment `baseUrl`.
 *
 * The ComfyClient proxies HTTP and WebSocket calls to whatever URL the user
 * configures on a `ComfyUIEnvironment`. Without this guard, a misconfigured
 * (or maliciously-imported) env can point the server at:
 *   - `file:///etc/passwd`   (data URLs / file URLs leak local files)
 *   - `http://169.254.169.254/latest/meta-data/...`   (AWS instance metadata)
 *   - `http://127.0.0.1:6379`   (Redis on the host)
 *   - `http://10.0.0.1`   (internal RFC1918 network on a hosted deploy)
 *
 * This module is a single pure function the studio calls in three places:
 *   1. `environmentService.createEnvironment` — reject at save time so the
 *      user sees a clean validation error in the dialog.
 *   2. `environmentService.updateEnvironment` — same on edits.
 *   3. `ComfyClient` constructor — defence in depth at runtime, in case a
 *      pre-validation env predates this module or someone bypasses the API.
 *
 * Type-aware policy:
 *   - `type: "local"` envs MAY use loopback (127/8, ::1, localhost). Most
 *     studio installs run ComfyUI on the same machine.
 *   - `type: "remote"` envs MUST NOT use loopback or any private/link-local
 *     range. Remote envs are by definition off-host; if a user wants to point
 *     at localhost, they should switch the type.
 *
 * Limitations (acknowledged, documented):
 *   - DNS rebinding is not prevented here — a hostname can resolve to
 *     1.1.1.1 at validation time and 127.0.0.1 at request time. Mitigating
 *     that requires re-resolving + IP-pinning at the http layer; out of
 *     scope for v1. Documented in BACKLOG.
 *   - Hostnames like "internal.corp" that resolve to RFC1918 are not
 *     blocked unless the user typed an IP literal. We rely on the
 *     "remote means public" convention; users opting into a private
 *     hostname have already accepted that risk.
 */
import "server-only";

import net from "node:net";
import type { ComfyUIEnvironment } from "@/types";

export interface BaseUrlValidation {
  ok: boolean;
  /** Human-friendly explanation when `ok === false`. */
  reason?: string;
}

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/**
 * Validate a candidate `baseUrl` for a ComfyUI environment of a given type.
 * Returns `{ ok: true }` on success, otherwise an `{ ok: false, reason }` so
 * the API layer can map it to a clean 400 with a user-facing message.
 */
export function validateBaseUrl(
  rawUrl: string,
  envType: ComfyUIEnvironment["type"]
): BaseUrlValidation {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return { ok: false, reason: "Base URL is required." };
  }

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return {
      ok: false,
      reason: "Base URL must be a valid URL (e.g. http://127.0.0.1:8188).",
    };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return {
      ok: false,
      reason: `Base URL scheme must be http or https (got "${url.protocol}").`,
    };
  }

  // WHATWG URL keeps IPv6 hostnames bracketed (`[::1]`). `net.isIP` and our
  // string checks expect the bare address, so strip brackets here once.
  const rawHost = url.hostname.toLowerCase();
  const host =
    rawHost.startsWith("[") && rawHost.endsWith("]")
      ? rawHost.slice(1, -1)
      : rawHost;
  if (!host) {
    return { ok: false, reason: "Base URL must include a hostname." };
  }

  const classification = classifyHost(host);

  if (envType === "local") {
    // Local envs may target loopback (the studio's own host) but we still
    // refuse public/private ranges — those are configuration errors, not
    // valid local setups.
    if (classification === "loopback") return { ok: true };
    if (classification === "public") {
      return {
        ok: false,
        reason:
          "Local environments must point at the local machine (localhost, 127.0.0.1, ::1). For other hosts, switch the type to Remote.",
      };
    }
    return {
      ok: false,
      reason: `Local environments must point at the local machine. "${host}" is in a non-loopback range.`,
    };
  }

  // type: "remote" — block every non-public class.
  if (classification === "public") return { ok: true };

  const friendly: Record<HostClassification, string> = {
    public: "ok",
    loopback:
      "Remote environments cannot use loopback (localhost / 127.0.0.1 / ::1). Switch the type to Local for same-machine ComfyUI.",
    "private-rfc1918":
      "Remote environments cannot use a private IPv4 range (10/8, 172.16/12, 192.168/16). Use a public address or run ComfyUI as Local.",
    "link-local":
      "Remote environments cannot use a link-local address (169.254/16 or fe80::/10). This range is reserved and includes cloud instance metadata endpoints.",
    "unique-local":
      "Remote environments cannot use a unique-local IPv6 address (fc00::/7).",
    multicast:
      "Remote environments cannot use a multicast address.",
    "ipv6-mapped":
      "IPv6-mapped IPv4 addresses (::ffff:x.x.x.x) aren't supported. Use the IPv4 form directly.",
    invalid:
      "Hostname is not a valid IP literal or DNS name.",
  };
  return { ok: false, reason: friendly[classification] ?? "Hostname is not allowed." };
}

type HostClassification =
  | "public"
  | "loopback"
  | "private-rfc1918"
  | "link-local"
  | "unique-local"
  | "multicast"
  | "ipv6-mapped"
  | "invalid";

/**
 * Classify a hostname into a single label. DNS names that aren't IP
 * literals fall through to `public` — we don't resolve them here. The
 * literal-string checks for "localhost" and friends catch the most common
 * misconfigurations without paying for a DNS round-trip on every save.
 */
function classifyHost(host: string): HostClassification {
  // Common loopback hostnames as plain strings. These don't show up in
  // `net.isIP` (they're DNS names) but we treat them as loopback so the
  // user can type the friendly name in the dialog.
  if (host === "localhost" || host === "ip6-localhost" || host === "ip6-loopback") {
    return "loopback";
  }

  const family = net.isIP(host);
  if (family === 0) {
    // It's a DNS name we don't recognise as loopback — treat as public.
    // (See module-level note re: DNS rebinding limitation.)
    return "public";
  }

  if (family === 4) return classifyIPv4(host);
  if (family === 6) return classifyIPv6(host);
  return "invalid";
}

function classifyIPv4(ip: string): HostClassification {
  // net.isIP === 4 already validated dotted-quad. Parse the octets safely.
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return "invalid";
  }
  const [a, b] = parts;

  // 127.0.0.0/8 — loopback
  if (a === 127) return "loopback";
  // 0.0.0.0/8 — "this network" reserved; treat as loopback for safety
  if (a === 0) return "loopback";
  // 10.0.0.0/8 — private
  if (a === 10) return "private-rfc1918";
  // 172.16.0.0/12 — private
  if (a === 172 && b >= 16 && b <= 31) return "private-rfc1918";
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return "private-rfc1918";
  // 169.254.0.0/16 — link-local (includes AWS/GCP metadata 169.254.169.254)
  if (a === 169 && b === 254) return "link-local";
  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return "multicast";
  // 240.0.0.0/4 — reserved (Class E); treat as invalid for safety
  if (a >= 240) return "invalid";
  return "public";
}

function classifyIPv6(ip: string): HostClassification {
  // Lowercase + collapse double-colon for prefix matching. We don't fully
  // canonicalise — we only need to recognise the common reserved prefixes.
  const lower = ip.toLowerCase();

  // Loopback: ::1 (any number of leading zero groups)
  if (lower === "::1") return "loopback";

  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — defer to IPv4 classification of
  // the mapped portion. This catches `::ffff:169.254.169.254` etc.
  const mapped = lower.match(/^::ffff:([0-9a-f.:]+)$/i);
  if (mapped) {
    const inner = mapped[1];
    // Either dotted-quad form (::ffff:1.2.3.4) or hex form (::ffff:0102:0304).
    if (net.isIPv4(inner)) {
      const sub = classifyIPv4(inner);
      // Treat any non-public mapped form as ipv6-mapped so the message is clear.
      return sub === "public" ? "ipv6-mapped" : "ipv6-mapped";
    }
    return "ipv6-mapped";
  }

  // Link-local: fe80::/10 — first 10 bits are 1111111010, so first byte is
  // fe and the high two bits of the second byte are 10. Practically, any
  // address starting `fe8`, `fe9`, `fea`, or `feb` qualifies.
  if (/^fe[89ab][0-9a-f]?:/i.test(lower)) return "link-local";

  // Unique-local: fc00::/7 (so first byte fc or fd)
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return "unique-local";

  // Multicast: ff00::/8
  if (/^ff[0-9a-f]{2}:/i.test(lower)) return "multicast";

  // Unspecified: ::
  if (lower === "::") return "loopback";

  return "public";
}
