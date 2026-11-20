import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import type { ProjectStatus } from "@/types/database";
import {
  applyOwnJobsFilter,
  resolveInstallatiePortal,
  resolveOwnJobsScope,
  scopesToOwnJobsOnly,
} from "@/lib/installatie-portal";
import { resolveInstallatieKoppelId } from "@/lib/installatie-koppel";

export const runtime = "nodejs";

/** Statussen die installateur zelf mag zetten (labels in portaal). */
const INSTALLATEUR_STATUSES = new Set<ProjectStatus>([
  "schouwdag_ingepland",
  "schouw_voltooid",
  "installatie_ingepland",
]);

async function resolvePartner(token: string, req: NextRequest) {
  const session = await resolveInstallatiePortal(token, req);
  if (!session) return null;
  return {
    ...session.partner,
    _session: session,
  };
}

const ORDER_SELECT = `id, project_nummer, titel, status, offerte_id, schouw_at, schouw_jaar, schouw_week, schouw_notities, installatie_at, installatie_notities,
         service_at, service_notities,
         installateur_notitie, installateur_notitie_door,
         backoffice_notitie, backoffice_notitie_door,
         monteur, installatie_teamgenoot_id, materiaal_checks, startdatum, opleverdatum, created_at,
         leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats),
         offertes(id, offerte_nummer, status, ondertekend_op),
         installatie_teamgenoot:installatie_partner_teamgenoten!installatie_teamgenoot_id(id, naam, email, telefoon)`;

const ORDER_SELECT_FALLBACK = `id, project_nummer, titel, status, offerte_id, schouw_at, schouw_jaar, schouw_week, schouw_notities, installatie_at, installatie_notities,
           monteur, startdatum, opleverdatum, created_at,
           leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats)`;

const ORDER_SELECT_NO_TG_JOIN = `id, project_nummer, titel, status, offerte_id, schouw_at, schouw_jaar, schouw_week, schouw_notities, installatie_at, installatie_notities,
         service_at, service_notities,
         installateur_notitie, installateur_notitie_door,
         backoffice_notitie, backoffice_notitie_door,
         monteur, installatie_teamgenoot_id, materiaal_checks, startdatum, opleverdatum, created_at,
         leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats),
         offertes(id, offerte_nummer, status, ondertekend_op)`;

/** GET /api/installatie/[token]/orders/[projectId] */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; projectId: string }> }
) {
  const { token, projectId } = await ctx.params;
  try {
    const partner = await resolvePartner(token, req);
    if (!partner) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }
    const session = partner._session;
    const scope = await resolveOwnJobsScope(session);

    const sb = getSupabaseAdmin();
    let q = applyOwnJobsFilter(
      sb
        .from("projecten")
        .select(ORDER_SELECT)
        .eq("id", projectId)
        .eq("installatie_partner_id", partner.id),
      scope
    );
    let { data: order, error } = await q.single();

    if (
      error &&
      (error.message?.includes("installatie_teamgenoot") ||
        error.message?.includes("installatie_partner_teamgenoten"))
    ) {
      const q2 = applyOwnJobsFilter(
        sb
          .from("projecten")
          .select(ORDER_SELECT_NO_TG_JOIN)
          .eq("id", projectId)
          .eq("installatie_partner_id", partner.id),
        scope
      );
      ({ data: order, error } = await q2.single());
    }

    if (
      error &&
      (error.message?.includes("installateur_notitie") ||
        error.message?.includes("offertes") ||
        error.message?.includes("installatie_teamgenoot") ||
        error.code === "42703" ||
        error.code === "PGRST200")
    ) {
      const q3 = applyOwnJobsFilter(
        sb
          .from("projecten")
          .select(ORDER_SELECT_FALLBACK)
          .eq("id", projectId)
          .eq("installatie_partner_id", partner.id),
        scope
      );
      ({ data: order, error } = await q3.single());
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

    const { data: teamgenoten } = await sb
      .from("installatie_partner_teamgenoten")
      .select("id, naam, email, telefoon, actief")
      .eq("partner_id", partner.id)
      .order("naam");

    return NextResponse.json({
      partner: { id: partner.id, naam: partner.naam },
      order,
      offerte: offerteMeta,
      fotos: fotosWithUrl,
      teamgenoten: (teamgenoten || []).filter((t) => t.actief !== false),
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
 * Status + notities + monteur-koppeling door installateur.
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
    service_notities?: string | null;
    installatie_teamgenoot_id?: string | null;
    installatie_koppel_id?: string | null;
    service_teamgenoot_id?: string | null;
    monteur_beoordeling_sterren?: number | string | null;
    monteur_beoordeling_notitie?: string | null;
    monteur_beoordeling_door?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  try {
    const partner = await resolvePartner(token, req);
    if (!partner) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }
    const session = partner._session;
    const scope = await resolveOwnJobsScope(session);

    const sb = getSupabaseAdmin();
    const existQ = applyOwnJobsFilter(
      sb
        .from("projecten")
        .select("id, installatie_koppel_id")
        .eq("id", projectId)
        .eq("installatie_partner_id", partner.id),
      scope
    );
    let { data: existing, error: existErr } = await existQ.single();
    if (
      existErr &&
      (existErr.code === "42703" ||
        existErr.message?.includes("installatie_koppel_id"))
    ) {
      const retry = applyOwnJobsFilter(
        sb
          .from("projecten")
          .select("id")
          .eq("id", projectId)
          .eq("installatie_partner_id", partner.id),
        scope
      );
      const soft = await retry.single();
      existing = soft.data as typeof existing;
      existErr = soft.error;
    }
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
    if (body.service_notities !== undefined) {
      patch.service_notities = body.service_notities?.trim() || null;
    }

    if (body.installatie_teamgenoot_id !== undefined) {
      if (scopesToOwnJobsOnly(session)) {
        return NextResponse.json(
          { error: "Je kunt de medewerker-koppeling niet wijzigen" },
          { status: 403 }
        );
      }
      const tgId = body.installatie_teamgenoot_id?.trim() || null;
      if (tgId) {
        let tgQ = await sb
          .from("installatie_partner_teamgenoten")
          .select("id, naam, actief, kan_schouw")
          .eq("id", tgId)
          .eq("partner_id", partner.id)
          .maybeSingle();
        if (
          tgQ.error &&
          (tgQ.error.code === "42703" ||
            tgQ.error.message?.includes("kan_schouw"))
        ) {
          tgQ = await sb
            .from("installatie_partner_teamgenoten")
            .select("id, naam, actief")
            .eq("id", tgId)
            .eq("partner_id", partner.id)
            .maybeSingle();
        }
        const tg = tgQ.data as {
          id: string;
          naam: string;
          actief?: boolean | null;
          kan_schouw?: boolean | null;
        } | null;
        if (!tg || tg.actief === false) {
          return NextResponse.json(
            { error: "Medewerker niet gevonden" },
            { status: 400 }
          );
        }
        if ("kan_schouw" in (tg as object) && tg.kan_schouw !== true) {
          return NextResponse.json(
            { error: "Kies iemand die mag schouwen (vinkje Schouw)" },
            { status: 400 }
          );
        }
        patch.installatie_teamgenoot_id = tg.id;
        if (body.installatie_koppel_id === undefined) {
          patch.monteur = tg.naam;
        }
      } else {
        patch.installatie_teamgenoot_id = null;
      }
    }

    if (body.installatie_koppel_id !== undefined) {
      if (scopesToOwnJobsOnly(session)) {
        return NextResponse.json(
          { error: "Je kunt het koppel niet wijzigen" },
          { status: 403 }
        );
      }
      const koppelId = body.installatie_koppel_id?.trim() || null;
      if (koppelId) {
        const { resolveKoppelVanPartner, koppelWeergaveNaam } = await import(
          "@/lib/installatie-koppel"
        );
        const koppel = await resolveKoppelVanPartner(partner.id, koppelId);
        if (!koppel) {
          return NextResponse.json(
            { error: "Koppel niet gevonden" },
            { status: 400 }
          );
        }
        patch.installatie_koppel_id = koppel.id;
        patch.monteur = koppelWeergaveNaam(koppel);
      } else {
        patch.installatie_koppel_id = null;
      }
    }

    if (body.service_teamgenoot_id !== undefined) {
      if (scopesToOwnJobsOnly(session)) {
        return NextResponse.json(
          { error: "Je kunt de service-monteur niet wijzigen" },
          { status: 403 }
        );
      }
      const tgId = body.service_teamgenoot_id?.trim() || null;
      if (tgId) {
        let tgQ = await sb
          .from("installatie_partner_teamgenoten")
          .select("id, naam, actief, kan_service")
          .eq("id", tgId)
          .eq("partner_id", partner.id)
          .maybeSingle();
        if (
          tgQ.error &&
          (tgQ.error.code === "42703" ||
            tgQ.error.message?.includes("kan_service"))
        ) {
          tgQ = await sb
            .from("installatie_partner_teamgenoten")
            .select("id, naam, actief")
            .eq("id", tgId)
            .eq("partner_id", partner.id)
            .maybeSingle();
        }
        const tg = tgQ.data as {
          id: string;
          naam: string;
          actief?: boolean | null;
          kan_service?: boolean | null;
        } | null;
        if (!tg || tg.actief === false) {
          return NextResponse.json(
            { error: "Medewerker niet gevonden" },
            { status: 400 }
          );
        }
        if ("kan_service" in (tg as object) && tg.kan_service !== true) {
          return NextResponse.json(
            { error: "Kies iemand die Service heeft aangevinkt" },
            { status: 400 }
          );
        }
        patch.service_teamgenoot_id = tg.id;
        if (body.installatie_koppel_id === undefined) {
          patch.monteur = tg.naam;
        }
      } else {
        patch.service_teamgenoot_id = null;
      }
    }

    // Beoordeling: alleen beheerder/partner (niet solo monteur-scope)
    if (
      body.monteur_beoordeling_sterren !== undefined ||
      body.monteur_beoordeling_notitie !== undefined
    ) {
      if (session.kind === "teamgenoot" && session.authRol !== "beheerder") {
        return NextResponse.json(
          { error: "Alleen beheerders mogen beoordelen" },
          { status: 403 }
        );
      }
      if (body.monteur_beoordeling_sterren !== undefined) {
        const raw = body.monteur_beoordeling_sterren;
        if (raw === null || raw === "") {
          patch.monteur_beoordeling_sterren = null;
          patch.monteur_beoordeling_op = null;
          patch.monteur_beoordeling_door = null;
        } else {
          const n = Number(raw);
          if (!Number.isFinite(n) || n < 0 || n > 5) {
            return NextResponse.json(
              { error: "Beoordeling moet 0 t/m 5 sterren zijn" },
              { status: 400 }
            );
          }
          patch.monteur_beoordeling_sterren = Math.round(n);
          patch.monteur_beoordeling_op = new Date().toISOString();
          const door =
            typeof body.monteur_beoordeling_door === "string"
              ? body.monteur_beoordeling_door.trim() || null
              : session.kind === "partner"
                ? partner.naam
                : session.teamgenoot?.naam || partner.naam;
          patch.monteur_beoordeling_door = door;
        }
      }
      if (body.monteur_beoordeling_notitie !== undefined) {
        patch.monteur_beoordeling_notitie =
          typeof body.monteur_beoordeling_notitie === "string"
            ? body.monteur_beoordeling_notitie.trim() || null
            : null;
        if (
          body.monteur_beoordeling_sterren === undefined &&
          patch.monteur_beoordeling_notitie
        ) {
          patch.monteur_beoordeling_op = new Date().toISOString();
        }
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Niets om bij te werken" },
        { status: 400 }
      );
    }

    async function doUpdate(select: string, usePatch: Record<string, unknown>) {
      const q = applyOwnJobsFilter(
        sb
          .from("projecten")
          .update(usePatch)
          .eq("id", projectId)
          .eq("installatie_partner_id", partner!.id),
        scope
      );
      return q.select(select).single();
    }

    let { data: order, error } = await doUpdate(ORDER_SELECT, patch);

    // Kolom installatie_teamgenoot_id ontbreekt → alleen monteur-tekst
    if (
      error &&
      body.installatie_teamgenoot_id !== undefined &&
      (error.code === "42703" ||
        error.message?.includes("installatie_teamgenoot_id") ||
        error.message?.includes("installatie_koppel_id"))
    ) {
      const fallbackPatch = { ...patch };
      delete fallbackPatch.installatie_teamgenoot_id;
      if (error.message?.includes("installatie_koppel_id")) {
        delete fallbackPatch.installatie_koppel_id;
      }
      if (error.message?.includes("service_teamgenoot_id")) {
        delete fallbackPatch.service_teamgenoot_id;
      }
      ({ data: order, error } = await doUpdate(
        ORDER_SELECT_FALLBACK,
        fallbackPatch
      ));
    }

    if (
      error &&
      (error.message?.includes("installatie_teamgenoot") ||
        error.message?.includes("installatie_partner_teamgenoten"))
    ) {
      ({ data: order, error } = await doUpdate(ORDER_SELECT_NO_TG_JOIN, patch));
    }

    if (
      error &&
      (error.message?.includes("installateur_notitie") ||
        error.message?.includes("offertes") ||
        error.code === "42703" ||
        error.code === "PGRST200")
    ) {
      const retry = await doUpdate(ORDER_SELECT_FALLBACK, patch);
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

    if (
      patch.monteur_beoordeling_sterren !== undefined ||
      patch.monteur_beoordeling_notitie !== undefined
    ) {
      const { data: partnerKoppels } = await sb
        .from("installatie_partner_koppels")
        .select("id, partner_id, actief")
        .eq("partner_id", partner.id);
      const koppelId = resolveInstallatieKoppelId(
        {
          installatie_koppel_id:
            (existing as { installatie_koppel_id?: string | null })
              .installatie_koppel_id ||
            (order as { installatie_koppel_id?: string | null })
              .installatie_koppel_id,
          installatie_partner_id: partner.id,
        },
        (partnerKoppels || []) as {
          id: string;
          partner_id: string;
          actief?: boolean | null;
        }[]
      );
      if (koppelId) {
        const koppelPatch: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        if (patch.monteur_beoordeling_sterren !== undefined) {
          koppelPatch.beoordeling_sterren = patch.monteur_beoordeling_sterren;
        }
        if (patch.monteur_beoordeling_notitie !== undefined) {
          koppelPatch.beoordeling_notitie = patch.monteur_beoordeling_notitie;
        }
        await sb
          .from("installatie_partner_koppels")
          .update(koppelPatch)
          .eq("id", koppelId)
          .eq("partner_id", partner.id);
        if (
          !(existing as { installatie_koppel_id?: string | null })
            .installatie_koppel_id
        ) {
          await sb
            .from("projecten")
            .update({ installatie_koppel_id: koppelId })
            .eq("id", projectId)
            .eq("installatie_partner_id", partner.id);
        }
      }
    }

    return NextResponse.json({ order });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
