import { NextRequest, NextResponse } from "next/server";
import {
  EndpointNotFoundError,
  deleteEndpoint,
  getEndpoint,
  updateEndpoint,
} from "@/lib/server/endpointService";
import { errorToResponse, readJsonBody } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ envId: string; id: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { envId, id } = await ctx.params;
    const endpoint = await getEndpoint(envId, id);
    if (!endpoint) throw new EndpointNotFoundError(envId, id);
    return NextResponse.json({ endpoint });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const { envId, id } = await ctx.params;
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const endpoint = await updateEndpoint(
      envId,
      id,
      parsed.body as Parameters<typeof updateEndpoint>[2]
    );
    return NextResponse.json({ endpoint });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { envId, id } = await ctx.params;
    await deleteEndpoint(envId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}
