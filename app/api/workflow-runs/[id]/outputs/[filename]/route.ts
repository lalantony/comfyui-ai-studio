import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { findRunLocation } from "@/lib/server/workflow/runStore";
import { getRunOutputsDir } from "@/lib/server/storage";
import { errorToResponse, jsonError } from "@/lib/server/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string; filename: string }>;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  txt: "text/plain",
  json: "application/json",
};

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id: runId, filename } = await ctx.params;

    // Reject anything that could escape the outputs dir
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      return jsonError("Invalid filename", 400);
    }

    const loc = await findRunLocation(runId);
    if (!loc) return jsonError("Run not found", 404);

    const outputsDir = getRunOutputsDir(loc.projectId, runId);
    const fullPath = path.join(outputsDir, filename);

    // Defensive: ensure resolved path is still inside outputsDir
    const resolved = path.resolve(fullPath);
    const dirResolved = path.resolve(outputsDir);
    if (!resolved.startsWith(dirResolved + path.sep) && resolved !== dirResolved) {
      return jsonError("Invalid filename", 400);
    }

    const data = await fs.readFile(resolved).catch(() => null);
    if (!data) return jsonError("Output not found", 404);

    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
