import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-v1/auth";
import {
  PATCH as takenPatch,
  DELETE as takenDelete,
} from "@/app/api/taken/[id]/route";

export const runtime = "nodejs";

/** PATCH /api/v1/taken/:id */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  return takenPatch(req, ctx);
}

/** DELETE /api/v1/taken/:id */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  return takenDelete(req, ctx);
}
