import { NextRequest, NextResponse } from "next/server";
import { createEndpoint, listEndpoints } from "@/lib/server/endpointService";
import { errorToResponse, jsonError, readJsonBody } from "@/lib/server/apiHelpers";
import { ComfyEndpointInput, ComfyEndpointOutput } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ envId: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { envId } = await ctx.params;
    const endpoints = await listEndpoints(envId);
    return NextResponse.json({ endpoints });
  } catch (err) {
    return errorToResponse(err);
  }
}

interface CreateBody {
  name?: string;
  description?: string;
  inputs?: ComfyEndpointInput[];
  output?: ComfyEndpointOutput;
  workflowApiJson?: string;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { envId } = await ctx.params;
    const parsed = await readJsonBody<CreateBody>(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (!body.name) return jsonError("name is required", 400);
    if (!body.inputs) return jsonError("inputs is required", 400);
    if (!body.output) return jsonError("output is required", 400);
    if (!body.workflowApiJson) return jsonError("workflowApiJson is required", 400);
    const endpoint = await createEndpoint(envId, {
      name: body.name,
      description: body.description,
      inputs: body.inputs,
      output: body.output,
      workflowApiJson: body.workflowApiJson,
    });
    return NextResponse.json({ endpoint }, { status: 201 });
  } catch (err) {
    return errorToResponse(err);
  }
}
