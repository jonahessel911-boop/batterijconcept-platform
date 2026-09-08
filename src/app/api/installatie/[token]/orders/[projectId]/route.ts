import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import type { ProjectStatus } from "@/types/database";

export const runtime = "nodejs";

/** Statussen die installateur zelf mag zetten (labels in portaal). */
const INSTALLATEUR_STATUSES = new Set<ProjectStatus>([
  "schouw_in_afwachting", // Schouw gepland
  "schouw_voltooid",
  "materiaal_installatie", // Installatie gepland
]);

async function resolvePartner(token: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("installatie_partners")
    .select("id, naam, email, telefoon, actief, portal_token")
    .eq("portal_token", token)
    .single();
  if (error || !data || !data.actief) return null;
  return data;
}

const ORDER_SELECT = `id, project_nummer, titel, status, offerte_id, schouw_at, schouw_jaar, schouw_week, schouw_notities, installatie_at, installatie_notities,
         installateur_notitie, installateur_notitie_door,
         monteur, startdatum, opleverdatum, created_at,
         leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats),
         offertes(id, offerte_nummer, status, ondertekend_op)`;

const ORDER_SELECT_FALLBACK = `id, project_nummer, titel, status, offerte_id, schouw_at, schouw_jaar, schouw_week, schouw_notities, installatie_at, installatie_notities,
           monteur, startdatum, opleverdatum, created_at,
           leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats)`;

/** GET /api/installatie/[token]/orders/[projectId] */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; projectId: string }> }
) {
  const { token, projectId } = await ctx.params;
  try {
    const partner = await resolvePartner(token);
    if (!partner) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const sb = getSupabaseAdmin();
    let { data: order, error } = await sb
      .from("projecten")
      .select(ORDER_SELECT)
      .eq("id", projectId)
      .eq("installatie_partner_id", partner.id)
      .single();

    if (
      error &&
      (error.message?.includes("installateur_notitie") ||
        error.message?.includes("offertes") ||
        error.code === "42703" ||
        error.code === "PGRST200")
    ) {
      ({ data: order, error } = await sb
        .from("projecten")
        .select(ORDER_SELECT_FALLBACK)
        .eq("id", projectId)
        .eq("installatie_partner_id", partner.id)
        .single());
    }

    if (error || !order) {
      return NextResponse.json(
        { error: "Order niet gevonden" },
        { status: 404 }
      );
    }

    let offerteMeta: {
      id: string;
      offerte_nummer: string;
      status: string;
      ondertekend_op: string | null;
    } | null = null;

    const embedded = (order as { offertes?: unknown }).offertes;
    const embeddedOne = Array.isArray(embedded) ? embedded[0] : embedded;
    if (
      embeddedOne &&
      typeof embeddedOne === "object" &&
      "id" in embeddedOne &&
      (embeddedOne as { status?: string }).status === "ondertekend"
    ) {
      const e = embeddedOne as {
        id: string;
        offerte_nummer: string;
        status: string;
        ondertekend_op: string | null;
      };
      offerteMeta = e;
    } else if ((order as { offerte_id?: string | null }).offerte_id) {
      const { data: off } = await sb
        .from("offertes")
        .select("id, offerte_nummer, status, ondertekend_op")
        .eq("id", (order as { offerte_id: string }).offerte_id)
        .eq("status", "ondertekend")
        .maybeSingle();
      if (off) offerteMeta = off;
    }

    const { data: fotos } = await sb
      .from("project_fotos")
      .select(
        "id, project_id, storage_path, bestandsnaam, omschrijving, created_at"
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

    const paths = (fotos || []).map((f) => f.storage_path);
    let urlMap = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await sb.storage
        .from("project-fotos")
        .createSignedUrls(paths, 60 * 60 * 6);
      for (const item of signed || []) {
        if (item.path && item.signedUrl) {
          urlMap.set(item.path, item.signedUrl);
        }
      }
    }

    const fotosWithUrl = (fotos || []).map((f) => ({
      ...f,
      url: urlMap.get(f.storage_path) || null,
    }));

    return NextResponse.json({
      partner: { id: partner.id, naam: partner.naam },
      order,
      offerte: offerteMeta,
      fotos: fotosWithUrl,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/installatie/[token]/orders/[projectId]
 * Status + notities door installateur — geen planning, geen e-mails.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; projectId: string }> }
) {
  const { token, projectId } = await ctx.params;
  let body: {
    status?: ProjectStatus;
    schouw_notities?: string | null;
    installatie_notities?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  try {
    const partner = await resolvePartner(token);
    if (!partner) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data: existing, error: existErr } = await sb
      .from("projecten")
      .select("id")
      .eq("id", projectId)
      .eq("installatie_partner_id", partner.id)
      .single();
    if (existErr || !existing) {
      return NextResponse.json(
        { error: "Order niet gevonden" },
        { status: 404 }
      );
    }

    const patch: Record<string, unknown> = {};

    if (body.status !== undefined) {
      if (!INSTALLATEUR_STATUSES.has(body.status)) {
        return NextResponse.json(
          { error: "Deze status mag je niet zetten" },
          { status: 400 }
        );
      }
      patch.status = body.status;
    }

    if (body.schouw_notities !== undefined) {
      patch.schouw_notities = body.schouw_notities?.trim() || null;
    }
    if (body.installatie_notities !== undefined) {
      patch.installatie_notities = body.installatie_notities?.trim() || null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Niets om bij te werken" },
        { status: 400 }
      );
    }

    let { data: order, error } = await sb
      .from("projecten")
      .update(patch)
      .eq("id", projectId)
      .eq("installatie_partner_id", partner.id)
      .select(ORDER_SELECT)
      .single();

    if (
      error &&
      (error.message?.includes("installateur_notitie") ||
        error.message?.includes("offertes") ||
        error.code === "42703" ||
        error.code === "PGRST200")
    ) {
      const retry = await sb
        .from("projecten")
        .update(patch)
        .eq("id", projectId)
        .eq("installatie_partner_id", partner.id)
        .select(ORDER_SELECT_FALLBACK)
        .single();
      // Fallback select mist optionele joins/kolommen — widen voor TS
      order = retry.data as typeof order;
      error = retry.error;
    }

    if (error || !order) {
      return NextResponse.json(
        {
          error: "Opslaan mislukt",
          detail: error?.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
