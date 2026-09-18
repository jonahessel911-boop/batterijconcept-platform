import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireApiKey } from "@/lib/api-v1/auth";
import { jsonErr, jsonOk, parseNum, pickStr } from "@/lib/api-v1/http";
import { agendaTypesDocs, parseAgendaType } from "@/lib/api-v1/agenda-types";
import { planProjectAgenda } from "@/lib/api-v1/plan-agenda";
import { isSchouwdagDefinitief } from "@/lib/schouw-week";

export const runtime = "nodejs";

/** GET /api/v1/agenda — geplande schouw/installatie */
export async function GET(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const from = pickStr(sp.get("from"));
  const to = pickStr(sp.get("to"));
  const typeRaw = pickStr(sp.get("type"));
  const type = typeRaw ? parseAgendaType(typeRaw) : null;
  const projectId = pickStr(sp.get("project_id"));
  const limit = Math.min(Math.max(parseNum(sp.get("limit")) || 200, 1), 500);

  try {
    const sb = getSupabaseAdmin();
    let q = sb
      .from("projecten")
      .select(
        "id, project_nummer, status, lead_id, schouw_jaar, schouw_week, schouw_at, installatie_at, installatie_partner_id, leads(naam, lead_number, plaats)"
      )
      .or("schouw_at.not.is.null,installatie_at.not.is.null")
      .limit(limit);

    if (projectId) q = q.eq("id", projectId);

    const { data, error } = await q;
    if (error) {
      return jsonErr("Agenda laden mislukt", 500, { detail: error.message });
    }

    const fromT = from ? new Date(from).getTime() : null;
    const toT = to ? new Date(to).getTime() : null;

    type Item = {
      type: 1 | 2 | 3;
      kind: string;
      project_id: string;
      project_nummer: string | null;
      status: string;
      at: string;
      schouw_jaar?: number | null;
      schouw_week?: number | null;
      installatie_partner_id?: string | null;
      lead?: unknown;
    };

    const items: Item[] = [];
    for (const p of data || []) {
      if (p.schouw_at) {
        const t = new Date(p.schouw_at).getTime();
        if (fromT != null && !Number.isNaN(fromT) && t < fromT) {
          /* skip */
        } else if (toT != null && !Number.isNaN(toT) && t > toT) {
          /* skip */
        } else {
          const definitief = isSchouwdagDefinitief(p);
          const agendaType: 1 | 2 = definitief ? 2 : 1;
          if (type == null || type === agendaType) {
            items.push({
              type: agendaType,
              kind: agendaType === 1 ? "schouwweek" : "schouwdag",
              project_id: p.id,
              project_nummer: p.project_nummer,
              status: p.status,
              at: p.schouw_at,
              schouw_jaar: p.schouw_jaar,
              schouw_week: p.schouw_week,
              installatie_partner_id: p.installatie_partner_id,
              lead: p.leads,
            });
          }
        }
      }

      if (p.installatie_at) {
        const t = new Date(p.installatie_at).getTime();
        if (fromT != null && !Number.isNaN(fromT) && t < fromT) continue;
        if (toT != null && !Number.isNaN(toT) && t > toT) continue;
        if (type != null && type !== 3) continue;
        items.push({
          type: 3,
          kind: "installatie",
          project_id: p.id,
          project_nummer: p.project_nummer,
          status: p.status,
          at: p.installatie_at,
          installatie_partner_id: p.installatie_partner_id,
          lead: p.leads,
        });
      }
    }

    items.sort((a, b) => a.at.localeCompare(b.at));

    return jsonOk({
      ok: true,
      count: items.length,
      types: agendaTypesDocs(),
      items,
    });
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}

/** POST /api/v1/agenda — type 1|2|3 plannen */
export async function POST(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonErr("Ongeldige JSON");
  }

  const type = parseAgendaType(body.type ?? body.agenda_type ?? body.code);
  const projectId = pickStr(body.project_id, body.projectId);
  if (!type) {
    return jsonErr(
      "type is verplicht (1=schouwweek, 2=schouwdag, 3=installatie)",
      400,
      { types: agendaTypesDocs() }
    );
  }
  if (!projectId) return jsonErr("project_id is verplicht");

  try {
    const sb = getSupabaseAdmin();
    const result = await planProjectAgenda(sb, {
      type,
      project_id: projectId,
      schouw_jaar: parseNum(body.schouw_jaar) ?? undefined,
      schouw_week: parseNum(body.schouw_week) ?? undefined,
      start_at: pickStr(body.start_at, body.start) || undefined,
      schouw_at: pickStr(body.schouw_at) || undefined,
      installatie_at: pickStr(body.installatie_at) || undefined,
      installatie_partner_id:
        pickStr(body.installatie_partner_id, body.partner_id) || undefined,
      notities: pickStr(body.notities, body.omschrijving),
    });

    if (!result.ok) {
      return jsonErr(result.error, result.status, { detail: result.detail });
    }

    return jsonOk(
      { ok: true, agenda: result.agenda, project: result.project },
      201
    );
  } catch (e) {
    return jsonErr(errMessage(e, "Fout"), 500);
  }
}
