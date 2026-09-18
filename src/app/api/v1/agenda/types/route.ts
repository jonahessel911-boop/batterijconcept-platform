import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-v1/auth";
import { jsonOk } from "@/lib/api-v1/http";
import { agendaTypesDocs } from "@/lib/api-v1/agenda-types";

export const runtime = "nodejs";

/** GET /api/v1/agenda/types */
export async function GET(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;

  return jsonOk({
    ok: true,
    types: agendaTypesDocs(),
    examples: {
      schouwweek: {
        type: 1,
        project_id: "<uuid>",
        schouw_jaar: 2026,
        schouw_week: 38,
      },
      schouwdag: {
        type: 2,
        project_id: "<uuid>",
        schouw_at: "2026-09-18T10:00",
        notities: "Klant belde voor ochtend",
      },
      installatie: {
        type: 3,
        project_id: "<uuid>",
        installatie_at: "2026-10-02T09:00",
        installatie_partner_id: "<uuid>",
      },
    },
  });
}
