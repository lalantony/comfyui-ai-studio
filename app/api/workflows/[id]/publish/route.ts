import { NextRequest, NextResponse } from "next/server";
import { publishWorkflow } from "@/lib/server/workflowService";
import { errorToResponse, jsonError } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * Publish a workflow: bump version, flip status to "published", append a
 * changelog entry. Body shape: `{ version: string, notes?: string }`.
 *
 * Validation lives in `publishWorkflow()` — semver-ish version, must differ
 * from the current published version. 400 on InvalidVersionError, 404 on
 * unknown workflow.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError("Request body must be valid JSON", 400);
    }
    if (!body || typeof body !== "object") {
      return jsonError("Body must be an object with `version` (string)", 400);
    }
    const { version, notes } = body as { version?: unknown; notes?: unknown };
    if (typeof version !== "string" || !version.trim()) {
      return jsonError("`version` is required (string)", 400);
    }
    const workflow = await publishWorkflow(
      id,
      version,
      typeof notes === "string" ? notes : undefined
    );
    return NextResponse.json({ workflow });
  } catch (err) {
    return errorToResponse(err);
  }
}
