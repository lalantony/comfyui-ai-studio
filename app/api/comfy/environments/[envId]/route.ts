import { NextRequest, NextResponse } from "next/server";
import {
  EnvironmentNotFoundError,
  deleteEnvironment,
  getEnvironment,
  setActive,
  updateEnvironment,
} from "@/lib/server/environmentService";
import { errorToResponse, readJsonBody } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ envId: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { envId } = await ctx.params;
    const env = await getEnvironment(envId);
    if (!env) throw new EnvironmentNotFoundError(envId);
    return NextResponse.json({ environment: env });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const { envId } = await ctx.params;
    const parsed = await readJsonBody<Record<string, unknown> & { setActive?: boolean }>(req);
    if (!parsed.ok) return parsed.response;
    const patch = parsed.body;
    // Special case: { setActive: true } to flip the single-active flag
    if (patch && patch.setActive === true) {
      const env = await setActive(envId);
      return NextResponse.json({ environment: env });
    }
    const env = await updateEnvironment(envId, patch as Parameters<typeof updateEnvironment>[1]);
    return NextResponse.json({ environment: env });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { envId } = await ctx.params;
    await deleteEnvironment(envId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}
