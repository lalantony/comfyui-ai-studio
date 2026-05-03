import { NextRequest, NextResponse } from "next/server";
import { importWorkflow, InvalidBundleError } from "@/lib/server/workflowService";
import { errorToResponse, jsonError } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Import a workflow bundle. Body is the bundle JSON (a `WorkflowBundle`).
 *
 * Returns:
 *   200: `{ workflow, warnings }` — workflow created; warnings may include
 *        missing-plugin notices and re-bind reminders.
 *   400: invalid bundle shape (validateBundleShape throws InvalidBundleError)
 */
export async function POST(req: NextRequest) {
  try {
    let bundle: unknown;
    try {
      bundle = await req.json();
    } catch {
      return jsonError("Request body must be valid JSON", 400);
    }

    const result = await importWorkflow(bundle);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof InvalidBundleError) {
      return jsonError(err.message, 400);
    }
    return errorToResponse(err);
  }
}
