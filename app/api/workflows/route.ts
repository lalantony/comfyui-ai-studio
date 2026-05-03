import { NextRequest, NextResponse } from "next/server";
import { createWorkflow, listWorkflows } from "@/lib/server/workflowService";
import { errorToResponse, jsonError, readJsonBody } from "@/lib/server/apiHelpers";
import { assertSafeId } from "@/lib/server/storage";
import { Workflow } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const workflows = await listWorkflows();
    return NextResponse.json({ workflows });
  } catch (err) {
    return errorToResponse(err);
  }
}

interface CreateBody {
  id?: string;
  name?: string;
  description?: string;
  type?: Workflow["type"];
  tags?: string[];
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await readJsonBody<CreateBody>(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (!body.name) return jsonError("name is required", 400);
    if (!body.type) return jsonError("type is required (image|video|music|mixed)", 400);
    if (body.id !== undefined) assertSafeId(body.id);
    const workflow = await createWorkflow({
      id: body.id,
      name: body.name,
      description: body.description ?? "",
      type: body.type,
      tags: body.tags ?? [],
    });
    return NextResponse.json({ workflow }, { status: 201 });
  } catch (err) {
    return errorToResponse(err);
  }
}
