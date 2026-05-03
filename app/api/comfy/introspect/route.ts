import { NextRequest, NextResponse } from "next/server";
import { introspectWorkflowApiJson } from "@/lib/server/workflow/introspect";
import { errorToResponse, jsonError, readJsonBody } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  workflowApiJson?: string;
}

// Cap on the inline workflowApiJson size — defense against a 100MB POST
// body landing in JSON.parse. Real ComfyUI exports are typically <100KB.
const MAX_WORKFLOW_API_JSON_BYTES = 1_000_000;

export async function POST(req: NextRequest) {
  try {
    const parsed = await readJsonBody<Body>(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (!body.workflowApiJson || typeof body.workflowApiJson !== "string") {
      return jsonError("workflowApiJson string is required", 400);
    }
    if (body.workflowApiJson.length > MAX_WORKFLOW_API_JSON_BYTES) {
      return jsonError(
        `workflowApiJson exceeds the ${MAX_WORKFLOW_API_JSON_BYTES.toLocaleString()} byte limit`,
        413
      );
    }
    const result = introspectWorkflowApiJson(body.workflowApiJson);
    return NextResponse.json(result);
  } catch (err) {
    return errorToResponse(err);
  }
}
