import { NextRequest, NextResponse } from "next/server";
import { ResumeError, resumeRun } from "@/lib/server/workflow/resumeService";
import { errorToResponse, jsonError } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * Start a new project run that re-uses the parent run's successful upstream
 * outputs. The body is empty — the resume point is derived deterministically
 * from the parent's `nodeStates`. Returns `{ runId, fromNodeId, reusedNodeIds }`
 * so the UI can show "resuming at stage 3, reusing 1-2".
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { id: parentRunId } = await ctx.params;
    const result = await resumeRun(parentRunId);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ResumeError) {
      // Map every domain code to the right HTTP status. 404 for missing
      // run / workflow; 409 (Conflict) for "valid request, current state
      // doesn't permit it" — workflow changed, no node outputs, asset
      // missing. Lets the UI choose the right toast severity.
      const status =
        err.code === "run_not_found" || err.code === "workflow_deleted"
          ? 404
          : 409;
      return jsonError(err.message, status);
    }
    return errorToResponse(err);
  }
}
