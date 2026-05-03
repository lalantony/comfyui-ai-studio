import { NextRequest, NextResponse } from "next/server";
import {
  EndpointNotFoundError,
  getEndpointWorkflowApiJson,
} from "@/lib/server/endpointService";
import { errorToResponse } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ envId: string; id: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { envId, id } = await ctx.params;
    const json = await getEndpointWorkflowApiJson(envId, id);
    if (json === null) throw new EndpointNotFoundError(envId, id);
    return new NextResponse(json, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
