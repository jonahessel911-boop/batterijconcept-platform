import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";
import {
  buildNettoTimeline,
  mapAdviseurActies,
  mapOpenTaken,
  mapSchouwDocs,
} from "@/lib/netto-boord-detail";

export const runtime = "nodejs";

async function requireSession() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return {
      error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }),
    };
  }
  const rol = normalizeRol(session.rol);
  if (rol !== "admin" && rol !== "adviseur") {
    return {
      error: NextResponse.json({ error: "Geen toegang" }, { status: 403 }),
    };
  }
  return { session, rol };
}

/**
 * GET /api/netto-boord/detail?offerte_id=… | ?lead_id=…
 * Volledige tijdlijn + openstaande taken + schouwdocumenten (alleen-lezen).
 */
export async function GET(req: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const offerteId = req.nextUrl.searchParams.get("offerte_id")?.trim() || "";
  const leadIdParam = req.nextUrl.searchParams.get("lead_id")?.trim() || "";

  if (!offerteId && !leadIdParam) {
    return NextResponse.json(
      { error: "offerte_id of lead_id verplicht" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();

    let leadId = leadIdParam;
    let projectId: string | null = null;

    if (offerteId) {
      const { data: off, error: offErr } = await sb
        .from("offertes")
        .select("id, lead_id, leads(adviseur_id)")
        .eq("id", offerteId)
        .maybeSingle();
      if (offErr || !off) {
        return NextResponse.json(
          { error: "Offerte niet gevonden" },
          { status: 404 }
        );
      }
      leadId = off.lead_id as string;
      const leadJoin = off.leads as
        | { adviseur_id: string | null }
        | { adviseur_id: string | null }[]
        | null;
      const lead = Array.isArray(leadJoin) ? leadJoin[0] : leadJoin;
      if (
        auth.rol === "adviseur" &&
        lead?.adviseur_id &&
        lead.adviseur_id !== auth.session.adviseurId
      ) {
        return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
      }

      const { data: proj } = await sb
        .from("projecten")
        .select("id")
        .eq("offerte_id", offerteId)
        .maybeSingle();
      projectId = proj?.id || null;
    } else {
      const { data: lead } = await sb
        .from("leads")
        .select("id, adviseur_id")
        .eq("id", leadId)
        .maybeSingle();
      if (!lead) {
        return NextResponse.json(
          { error: "Lead niet gevonden" },
          { status: 404 }
        );
      }
      if (
        auth.rol === "adviseur" &&
        lead.adviseur_id &&
        lead.adviseur_id !== auth.session.adviseurId
      ) {
        return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
      }
      const { data: proj } = await sb
        .from("projecten")
        .select("id")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      projectId = proj?.id || null;
    }

    const [
      eventsRes,
      offertesRes,
      facturenRes,
      projectenRes,
      afsprakenRes,
      takenRes,
      fotosRes,
      boRes,
      fonioRes,
    ] = await Promise.all([
      sb
        .from("lead_events")
        .select("id, soort, titel, detail, meta, created_at")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(300),
      sb
        .from("offertes")
        .select(
          "id, offerte_nummer, status, created_at, ondertekend_op, ondertekend_naam, subtotaal_ex_btw, sign_token"
        )
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false }),
      sb
        .from("facturen")
        .select(
          "id, factuur_nummer, status, omschrijving, created_at, factuurdatum, betaald_op, bedrag_ex_btw, bedrag_inc_btw"
        )
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false }),
      sb
        .from("projecten")
        .select(
          "id, project_nummer, status, created_at, updated_at, schouw_at, schouw_jaar, schouw_week, installatie_at"
        )
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false }),
      sb
        .from("afspraken")
        .select("id, start_at, created_at, status, soort, adviseurs(naam)")
        .eq("lead_id", leadId)
        .order("start_at", { ascending: false })
        .limit(50),
      projectId
        ? sb
            .from("project_taken")
            .select(
              "id, titel, status, afdeling, due_at, auto_key, notities, aangemaakt_door_id, created_at, updated_at, verantwoordelijke:adviseurs!verantwoordelijke_id(naam), aangemaakt_door:adviseurs!aangemaakt_door_id(naam)"
            )
            .eq("project_id", projectId)
            .order("updated_at", { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [] as unknown[] }),
      projectId
        ? sb
            .from("project_fotos")
            .select(
              "id, storage_path, bestandsnaam, omschrijving, created_at"
            )
            .eq("project_id", projectId)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as unknown[] }),
      sb
        .from("backoffice_actie_events")
        .select(
          "id, soort, completed_at, on_time, adviseurs:adviseur_id(naam)"
        )
        .eq("lead_id", leadId)
        .order("completed_at", { ascending: false })
        .limit(50),
      sb
        .from("fonio_calls")
        .select("id, status, started_at, ended_at, outcome")
        .eq("lead_id", leadId)
        .order("started_at", { ascending: false })
        .limit(50),
    ]);

    // Signed URLs voor foto's / schouwformulier
    const fotosRaw = (fotosRes.data || []) as Array<{
      id: string;
      storage_path: string;
      bestandsnaam: string | null;
      omschrijving: string | null;
      created_at: string;
    }>;
    const urlMap = new Map<string, string>();
    if (fotosRaw.length) {
      const paths = fotosRaw.map((f) => f.storage_path);
      const { data: signed } = await sb.storage
        .from("project-fotos")
        .createSignedUrls(paths, 60 * 60 * 6);
      for (const item of signed || []) {
        if (item.path && item.signedUrl) {
          urlMap.set(item.path, item.signedUrl);
        }
      }
    }
    const fotos = fotosRaw.map((f) => ({
      id: f.id,
      bestandsnaam: f.bestandsnaam,
      omschrijving: f.omschrijving,
      created_at: f.created_at,
      url: urlMap.get(f.storage_path) || null,
    }));

    type AdvJoin = { naam: string } | { naam: string }[] | null;

    type TakenRow = {
      id: string;
      titel: string;
      status: string;
      afdeling: string | null;
      due_at: string | null;
      auto_key: string | null;
      notities: string | null;
      aangemaakt_door_id?: string | null;
      created_at: string;
      updated_at: string;
      verantwoordelijke?: AdvJoin;
      aangemaakt_door?: AdvJoin;
    };

    let takenRaw = (takenRes.data || []) as TakenRow[];
    const takenErrEarly = "error" in takenRes ? takenRes.error : null;
    if (
      takenErrEarly &&
      (takenErrEarly.message?.includes("aangemaakt_door") ||
        takenErrEarly.code === "42703") &&
      projectId
    ) {
      const fallback = await sb
        .from("project_taken")
        .select(
          "id, titel, status, afdeling, due_at, auto_key, notities, created_at, updated_at, verantwoordelijke:adviseurs!verantwoordelijke_id(naam)"
        )
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false })
        .limit(100);
      takenRaw = (fallback.data || []) as TakenRow[];
    }

    const taken = takenRaw.map((t) => {
      const v = Array.isArray(t.verantwoordelijke)
        ? t.verantwoordelijke[0]
        : t.verantwoordelijke;
      const maker = Array.isArray(t.aangemaakt_door)
        ? t.aangemaakt_door[0]
        : t.aangemaakt_door;
      return {
        id: t.id,
        titel: t.titel,
        status: t.status,
        afdeling: t.afdeling,
        due_at: t.due_at,
        auto_key: t.auto_key,
        notities: t.notities,
        aangemaakt_door_id: t.aangemaakt_door_id || null,
        aangemaakt_door_naam: maker?.naam || null,
        created_at: t.created_at,
        updated_at: t.updated_at,
        verantwoordelijke_naam: v?.naam || null,
      };
    });

    const afspraken = ((afsprakenRes.data || []) as Array<{
      id: string;
      start_at: string;
      created_at: string | null;
      status: string;
      soort: string | null;
      adviseurs?: AdvJoin;
    }>).map((a) => {
      const adv = Array.isArray(a.adviseurs) ? a.adviseurs[0] : a.adviseurs;
      return {
        id: a.id,
        start_at: a.start_at,
        created_at: a.created_at,
        status: a.status,
        soort: a.soort,
        adviseur_naam: adv?.naam || null,
      };
    });

    const backofficeEvents = ((boRes.data || []) as Array<{
      id: string;
      soort: string;
      completed_at: string;
      on_time: boolean | null;
      adviseurs?: AdvJoin;
    }>).map((b) => {
      const adv = Array.isArray(b.adviseurs) ? b.adviseurs[0] : b.adviseurs;
      return {
        id: b.id,
        soort: b.soort,
        completed_at: b.completed_at,
        on_time: b.on_time,
        adviseur_naam: adv?.naam || null,
      };
    });

    // Tables die mogelijk nog niet gemigreerd zijn → negeer errors
    const events =
      eventsRes.error &&
      (eventsRes.error.message?.includes("lead_events") ||
        eventsRes.error.code === "42P01")
        ? []
        : (eventsRes.data || []);

    const fonioCalls =
      fonioRes.error &&
      (fonioRes.error.message?.includes("fonio_calls") ||
        fonioRes.error.code === "42P01")
        ? []
        : ((fonioRes.data || []) as BuildInputFonio);

    const boSafe =
      boRes.error &&
      (boRes.error.message?.includes("backoffice_actie_events") ||
        boRes.error.code === "42P01")
        ? []
        : backofficeEvents;

    const takenErr = "error" in takenRes ? takenRes.error : null;
    const takenSafe =
      takenErr &&
      (takenErr.message?.includes("project_taken") || takenErr.code === "42P01")
        ? []
        : taken;

    const timeline = buildNettoTimeline({
      events: events as BuildInputEvents,
      offertes: (offertesRes.data || []) as BuildInputOffertes,
      facturen: (facturenRes.data || []) as BuildInputFacturen,
      projecten: (projectenRes.data || []) as BuildInputProjecten,
      afspraken,
      taken: takenSafe,
      fotos,
      backofficeEvents: boSafe,
      fonioCalls,
    });

    const open_taken = mapOpenTaken(takenSafe);
    const adviseur_acties = mapAdviseurActies(takenSafe);
    const schouw_docs = mapSchouwDocs(fotos);

    const project = (projectenRes.data || [])[0] as
      | {
          id: string;
          schouw_at: string | null;
          installatie_at: string | null;
          status: string;
        }
      | undefined;

    return NextResponse.json({
      lead_id: leadId,
      project_id: projectId,
      schouw_at: project?.schouw_at || null,
      installatie_at: project?.installatie_at || null,
      timeline,
      open_taken,
      adviseur_acties,
      schouw_docs,
      has_schouw_formulier: schouw_docs.length > 0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Detail laden mislukt", detail: errMessage(e) },
      { status: 500 }
    );
  }
}

type BuildInputEvents = Parameters<typeof buildNettoTimeline>[0]["events"];
type BuildInputOffertes = Parameters<typeof buildNettoTimeline>[0]["offertes"];
type BuildInputFacturen = Parameters<typeof buildNettoTimeline>[0]["facturen"];
type BuildInputProjecten = Parameters<typeof buildNettoTimeline>[0]["projecten"];
type BuildInputFonio = Parameters<typeof buildNettoTimeline>[0]["fonioCalls"];
