/**
 * HTTP error mapping for API routes.
 *
 * Every route should funnel its catch block through `errorToResponse(err)`
 * so domain errors (NotFound, InvalidId, …) map to the right status codes
 * consistently. Anything unrecognised falls through to 500 + console.error.
 *
 * Domain errors live with their service (e.g. `ProjectNotFoundError` is
 * exported from `projectService`). When you add a new service, add a new
 * `instanceof` branch here so its errors map cleanly.
 */
import "server-only";

import { NextResponse } from "next/server";
import { InvalidIdError } from "./storage";
import { ProjectNotFoundError } from "./projectService";
import { AssetNotFoundError } from "./assetService";
import {
  WorkflowNotFoundError,
  InvalidBundleError,
  InvalidVersionError,
} from "./workflowService";
import {
  EnvironmentNotFoundError,
  InvalidBaseUrlError,
} from "./environmentService";
import { EndpointNotFoundError } from "./endpointService";

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function errorToResponse(err: unknown): NextResponse {
  if (err instanceof InvalidIdError) return jsonError(err.message, 400);
  if (err instanceof ProjectNotFoundError) return jsonError(err.message, 404);
  if (err instanceof AssetNotFoundError) return jsonError(err.message, 404);
  if (err instanceof WorkflowNotFoundError) return jsonError(err.message, 404);
  if (err instanceof InvalidBundleError) return jsonError(err.message, 400);
  if (err instanceof InvalidVersionError) return jsonError(err.message, 400);
  if (err instanceof EnvironmentNotFoundError) return jsonError(err.message, 404);
  if (err instanceof InvalidBaseUrlError) return jsonError(err.message, 400);
  if (err instanceof EndpointNotFoundError) return jsonError(err.message, 404);
  if (err instanceof Error) {
    console.error("[api error]", err);
    // Don't leak raw error messages to the client — they often contain
    // absolute filesystem paths (Node fs errors are like
    // `ENOENT: ... open 'C:\Users\foo\.studio-data\...'`). The full
    // detail is in the server log; the client just needs to know the
    // request failed.
    return jsonError("Internal server error", 500);
  }
  console.error("[api error]", err);
  return jsonError("Unknown error", 500);
}

/**
 * Wrap `req.json()` so a malformed request body is mapped to a clean 400
 * `{ error: "Invalid JSON body" }` response instead of bubbling up as a
 * 500 via `errorToResponse`. Returns the parsed body on success or a
 * NextResponse on failure that the route should return directly.
 */
export async function readJsonBody<T = unknown>(
  req: Request
): Promise<{ ok: true; body: T } | { ok: false; response: NextResponse }> {
  try {
    const body = (await req.json()) as T;
    return { ok: true, body };
  } catch {
    return { ok: false, response: jsonError("Invalid JSON body", 400) };
  }
}
