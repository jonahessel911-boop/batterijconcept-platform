import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireApiKey } from "@/lib/api-v1/auth";
import { jsonErr, jsonOk, pickStr } from "@/lib/api-v1/http";
import { openBackofficeActies } from "@/lib/backoffice-acties";
import { GET as backofficeRapportageGet } from "@/app/api/backoffice-rapportage/route";
import type { Afspraak, Factuur, Lead, Project } from "@/types/database";

export const runtime = "nodejs";

/** GET /api/v1/backoffice?view=acties|rapportage */
export async function GET(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;

  const view = pickStr(req.nextUrl.searchParams.get("view")) || "acties";

  if (view === "rapportage") {
    return backofficeRapportageGet(req);
  }

  try {
    const sb = getSupabaseAdmin();
    const [projectenRes, facturenRes, leadsRes, afsprakenRes] =
      await Promise.all([
        sb.from("projecten").select("*").order("created_at", { ascending: false }),
        sb.from("facturen").select("*"),
        sb
          .from("leads")
          .select(
            "id, naam, email, telefoon, plaats, status, lead_number, notities, adviseur_id"
          ),
        sb
          .from("afspraken")
          .select("id, lead_id, start_at, status, soort, adviseur_id"),
      ]);

    if (projectenRes.error) {
      return jsonErr("Projecten laden mislukt", 500, {
        detail: projectenRes.error.message,
      });
    }

    const acties = openBackofficeActies(
      (projectenRes.data || []) as Project[],
      (facturenRes.data || []) as Factuur[],
      new Date(),
      {
        leads: (leadsRes.data || []) as Lead[],
        afspraken: (afsprakenRes.data || []) as Afspraak[],
      }
    );

    const bySoort: Record<string, number> = {};
    for (const a of acties) {
      bySoort[a.soort] = (bySoort[a.soort] || 0) + 1;
    }

    return jsonOk({
      ok: true,
      count: acties.length,
      overdue: acties.filter((a) => a.overdue).length,
      by_soort: bySoort,
      acties: acties.map((a) => ({
        id: a.id,
        soort: a.soort,
        titel: a.titel,
        detail: a.detail,
        deadline_at: a.deadlineAt,
        overdue: a.overdue,
        lead_id: a.leadId,
        lead_naam: a.leadNaam,
        telefoon: a.telefoon ?? null,
        project_id: a.projectId ?? null,
        project_nummer: a.projectNummer ?? null,
        factuur_id: a.factuurId ?? null,
        factuur_nummer: a.factuurNummer ?? null,
        href: a.href,
      })),
    });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}
