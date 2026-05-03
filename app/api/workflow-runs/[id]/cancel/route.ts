import { NextRequest, NextResponse } from "next/server";
import { cancel as cancelRun, findRunLocation } from "@/lib/server/workflow/runStore";
import { errorToResponse, jsonError } from "@/lib/server/apiHelpers";
import { assertSafeId } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * Cancel a run. Idempotent — three response shapes:
 *   - 200 { status: "cancelled" }         → in-flight run aborted
 *   - 200 { status: "already_finished" }  → run exists but already terminal
 *   - 404 { error: "Run not found" }      → run id unknown
 *
 * The "already_finished" branch is important: a fast user clicking Stop
 * just as the run completes shouldn't see a misleading 404. The client
 * treats both 200 shapes as success.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    assertSafeId(id);
    const outcome = cancelRun(id);
    if (outcome === "cancelled" || outcome === "already_finished") {
      return NextResponse.json({ status: outcome });
    }
    // outcome === "unknown" — the run isn't in memory. Disambiguate
    // between "truly unknown" and "finished and disposed long ago" via a
    // disk lookup.
    const loc = await findRunLocation(id);
    if (loc) {
      return NextResponse.json({ status: "already_finished" });
    }
    return jsonError("Run not found", 404);
  } catch (err) {
    return errorToResponse(err);
  }
}
