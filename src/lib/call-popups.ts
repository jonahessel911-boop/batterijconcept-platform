/**
 * Call-end popups voor medewerkers met gekoppelde Unite-lijn.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import { toE164Nl, phoneMatchVariants } from "@/lib/fonio";
import { appendStampedNotitie } from "@/lib/lead-notitie";
import { logLeadEvent } from "@/lib/lead-events";

export type CallPopupPhase = "ringing" | "ended";

export type CallPopupLeadCard = {
  id: string;
  naam: string | null;
  lead_number: string | null;
  telefoon: string | null;
  email: string | null;
  straat: string | null;
  huisnummer: string | null;
  postcode: string | null;
  plaats: string | null;
  status: string | null;
};

export type CallPopupProjectCard = {
  id: string;
  project_nummer: string | null;
  status: string | null;
  titel: string | null;
  betaalwijze: string | null;
  schouw_at: string | null;
  installatie_at: string | null;
};

export type CallPopupRow = {
  id: string;
  adviseur_id: string;
  lead_id: string | null;
  project_id: string | null;
  call_uniqueid: string | null;
  direction: string;
  phase: string;
  from_number: string | null;
  to_number: string | null;
  duration_seconds: number | null;
  lead_naam: string | null;
  project_nummer: string | null;
  meta: Record<string, unknown> | null;
  dismissed_at: string | null;
  note_saved_at: string | null;
  created_at: string;
  lead?: CallPopupLeadCard | null;
  project?: CallPopupProjectCard | null;
};

/** Unite stuurt in / inbound / incoming. Alleen die horen in de log-popup. */
export function isInboundCallDirection(raw: string | null | undefined): boolean {
  const d = String(raw || "")
    .trim()
    .toLowerCase();
  return (
    d === "in" ||
    d === "inbound" ||
    d === "incoming" ||
    d === "inkomend"
  );
}

function digits(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

function normalizeExt(raw: string | null | undefined): string | null {
  const d = digits(raw);
  if (!d) return null;
  // 200 / 0200 / 0201
  if (d.length <= 5) return d.replace(/^0+/, "") || d;
  return null;
}

/** Match adviseur op DID (unite_lijn) of extensie (unite_ext). */
export async function findAdviseurForUniteEndpoint(
  endpoint: string | null | undefined
): Promise<{ id: string; naam: string } | null> {
  const raw = (endpoint || "").trim();
  if (!raw) return null;

  const sb = getSupabaseAdmin();
  const { data: rows, error } = await sb
    .from("adviseurs")
    .select("id, naam, unite_lijn, unite_ext, actief")
    .eq("actief", true);

  if (error) {
    if (
      error.message?.includes("unite_lijn") ||
      error.message?.includes("unite_ext")
    ) {
      console.warn(
        "call-popups: draai supabase/migrate-unite-lijn-call-popups.sql"
      );
      return null;
    }
    console.warn("findAdviseurForUniteEndpoint:", error.message);
    return null;
  }

  const endDigits = digits(toE164Nl(raw) || raw);
  const endExt = normalizeExt(raw);

  for (const a of rows || []) {
    const lijn = digits(toE164Nl(a.unite_lijn) || a.unite_lijn || "");
    if (lijn && endDigits && (endDigits === lijn || endDigits.endsWith(lijn) || lijn.endsWith(endDigits))) {
      return { id: a.id, naam: a.naam };
    }
    const ext = normalizeExt(a.unite_ext);
    if (ext && endExt && ext === endExt) {
      return { id: a.id, naam: a.naam };
    }
  }
  return null;
}

async function resolveLeadAndProject(phone: string | null): Promise<{
  leadId: string | null;
  leadNaam: string | null;
  projectId: string | null;
  projectNummer: string | null;
}> {
  if (!phone) {
    return {
      leadId: null,
      leadNaam: null,
      projectId: null,
      projectNummer: null,
    };
  }
  const e164 = toE164Nl(phone);
  if (!e164) {
    return {
      leadId: null,
      leadNaam: null,
      projectId: null,
      projectNummer: null,
    };
  }
  const variants = phoneMatchVariants(e164);
  const sb = getSupabaseAdmin();
  const { data: leads } = await sb
    .from("leads")
    .select("id, naam, telefoon, status, created_at")
    .or(variants.map((v) => `telefoon.eq.${v}`).join(","))
    .order("created_at", { ascending: false })
    .limit(12);

  const exact = (leads || []).filter((l) => toE164Nl(l.telefoon) === e164);
  const pool = exact.length > 0 ? exact : leads || [];
  if (pool.length === 0) {
    return {
      leadId: null,
      leadNaam: null,
      projectId: null,
      projectNummer: null,
    };
  }

  const ids = pool.map((l) => l.id);
  const { data: projects } = await sb
    .from("projecten")
    .select("id, project_nummer, lead_id, status, created_at")
    .in("lead_id", ids)
    .order("created_at", { ascending: false });

  const projectByLead = new Map<
    string,
    { id: string; project_nummer: string | null }
  >();
  const ranked = [...(projects || [])].sort((a, b) => {
    const aOpen = String(a.status || "") === "annulering" ? 1 : 0;
    const bOpen = String(b.status || "") === "annulering" ? 1 : 0;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return (
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  });
  for (const p of ranked) {
    if (!projectByLead.has(p.lead_id)) {
      projectByLead.set(p.lead_id, {
        id: p.id,
        project_nummer: p.project_nummer,
      });
    }
  }

  // Prefer: lead met project → deal-status → overige (nieuwste)
  const lead =
    pool.find((l) => projectByLead.has(l.id)) ||
    pool.find((l) => String(l.status || "").toLowerCase() === "deal") ||
    pool.find(
      (l) =>
        !["gegevens_niet_overeen", "afgewezen", "spam"].includes(
          String(l.status || "").toLowerCase()
        )
    ) ||
    pool[0]!;

  const project = projectByLead.get(lead.id) || null;

  return {
    leadId: lead.id,
    leadNaam: lead.naam,
    projectId: project?.id || null,
    projectNummer: project?.project_nummer || null,
  };
}

export async function upsertCallPopup(opts: {
  adviseurId: string;
  phase: CallPopupPhase;
  direction: string;
  callUniqueId?: string | null;
  fromNumber?: string | null;
  toNumber?: string | null;
  durationSeconds?: number | null;
  matchPhone?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<CallPopupRow | null> {
  const sb = getSupabaseAdmin();
  const resolved = await resolveLeadAndProject(opts.matchPhone || null);

  if (opts.callUniqueId) {
    // Inclusief dismissed: anders maakt CDR-sync na "Opslaan/Later" opnieuw
    // een popup voor dezelfde call → blijft terugkomen.
    const { data: anyExisting } = await sb
      .from("call_popups")
      .select("*")
      .eq("call_uniqueid", opts.callUniqueId)
      .eq("adviseur_id", opts.adviseurId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (anyExisting) {
      if (anyExisting.dismissed_at || anyExisting.note_saved_at) {
        return null;
      }

      const patch: Record<string, unknown> = {
        phase: opts.phase,
        direction: opts.direction,
        from_number: opts.fromNumber ?? anyExisting.from_number,
        to_number: opts.toNumber ?? anyExisting.to_number,
        meta: { ...(anyExisting.meta || {}), ...(opts.meta || {}) },
      };
      if (opts.durationSeconds != null) {
        patch.duration_seconds = opts.durationSeconds;
      }
      if (resolved.leadId && !anyExisting.lead_id) {
        patch.lead_id = resolved.leadId;
        patch.lead_naam = resolved.leadNaam;
      }
      if (resolved.projectId && !anyExisting.project_id) {
        patch.project_id = resolved.projectId;
        patch.project_nummer = resolved.projectNummer;
      }
      const { data, error } = await sb
        .from("call_popups")
        .update(patch)
        .eq("id", anyExisting.id)
        .select("*")
        .single();
      if (error) {
        console.warn("call_popups update:", error.message);
        return anyExisting as CallPopupRow;
      }
      return data as CallPopupRow;
    }
  }

  const { data, error } = await sb
    .from("call_popups")
    .insert({
      adviseur_id: opts.adviseurId,
      lead_id: resolved.leadId,
      project_id: resolved.projectId,
      call_uniqueid: opts.callUniqueId || null,
      direction: opts.direction,
      phase: opts.phase,
      from_number: opts.fromNumber || null,
      to_number: opts.toNumber || null,
      duration_seconds: opts.durationSeconds ?? null,
      lead_naam: resolved.leadNaam,
      project_nummer: resolved.projectNummer,
      meta: opts.meta || null,
    })
    .select("*")
    .single();

  if (error) {
    console.warn("call_popups insert:", error.message);
    return null;
  }
  return data as CallPopupRow;
}

function normalizeUniteStatus(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

export function isUniteDisconnectedStatus(
  raw: string | null | undefined
): boolean {
  const s = normalizeUniteStatus(raw);
  if (!s) return true; // lege status_desc → behandel als hangup (Unite stuurt soms alleen status-code)
  return (
    s === "DISCONNECTED" ||
    s === "CALL_DISCONNECTED" ||
    s === "HANGUP" ||
    s === "ENDED" ||
    s === "BYE" ||
    s.includes("DISCONNECT")
  );
}

export function isUniteRingingStatus(raw: string | null | undefined): boolean {
  const s = normalizeUniteStatus(raw);
  return s.includes("RINGING");
}

/** Webhook / CDR → popup voor de juiste medewerker. */
export async function emitCallPopupFromUnite(opts: {
  statusDesc: string;
  direction: string;
  callUniqueId?: string | null;
  callfrom?: string | null;
  callto?: string | null;
  durationSeconds?: number | null;
}): Promise<CallPopupRow | null> {
  const status = normalizeUniteStatus(opts.statusDesc);
  const dir = (opts.direction || "").toLowerCase();

  let phase: CallPopupPhase | null = null;
  if (isUniteRingingStatus(status)) phase = "ringing";
  if (isUniteDisconnectedStatus(status)) phase = "ended";
  if (!phase) return null;
  if (!isInboundCallDirection(dir)) return null;

  // Wie krijgt de popup?
  const inbound = isInboundCallDirection(dir);
  const internal = inbound ? opts.callto : opts.callfrom;
  const external = inbound ? opts.callfrom : opts.callto;
  // Inbound: DID vaak in callto. Outbound: extensie/DID in callfrom.
  // Probeer beide kanten — Unite wisselt soms van/ tot.
  let adviseur = await findAdviseurForUniteEndpoint(internal);
  if (!adviseur) {
    adviseur = await findAdviseurForUniteEndpoint(opts.callfrom);
  }
  if (!adviseur) {
    adviseur = await findAdviseurForUniteEndpoint(opts.callto);
  }
  if (!adviseur) return null;

  return upsertCallPopup({
    adviseurId: adviseur.id,
    phase,
    direction: "in",
    callUniqueId: opts.callUniqueId,
    fromNumber: opts.callfrom || null,
    toNumber: opts.callto || null,
    durationSeconds: opts.durationSeconds ?? null,
    matchPhone: toE164Nl(external) || external || null,
    meta: { status_desc: status || "DISCONNECTED", adviseur_naam: adviseur.naam },
  });
}

/**
 * Popup na recent beëindigd gesprek (webhook of CDR-sync).
 * Alleen als het gesprek < 15 min oud is — voorkomt spam bij backfill.
 */
export async function emitEndedPopupFromActivity(opts: {
  uniqueid: string;
  callAt: Date;
  direction: string;
  durationSeconds: number;
  fromNumber?: string | null;
  toNumber?: string | null;
}): Promise<CallPopupRow | null> {
  const ageMs = Date.now() - opts.callAt.getTime();
  if (ageMs > 15 * 60_000 || ageMs < -5 * 60_000) return null;
  return emitCallPopupFromUnite({
    statusDesc: "DISCONNECTED",
    direction: opts.direction,
    callUniqueId: opts.uniqueid,
    callfrom: opts.fromNumber,
    callto: opts.toNumber,
    durationSeconds: opts.durationSeconds,
  });
}

/** Throttle CDR→popup sync per adviseur (Unite rate limit). */
const popupSyncAt = new Map<string, number>();

/**
 * Haal recente Unite-CDR op en maak call-end popups voor deze medewerker.
 * Nodig op localhost (webhook kan localhost niet bereiken) én als backup als webhook faalt.
 */
export async function syncRecentCallPopupsForAdviseur(
  adviseurId: string,
  opts?: { force?: boolean; lookbackMinutes?: number }
): Promise<{ synced: number; skipped?: string }> {
  const now = Date.now();
  const prev = popupSyncAt.get(adviseurId) || 0;
  // Korte throttle i.v.m. Unite 30 req/min — popup max ~3s na ophangen zonder webhook
  if (!opts?.force && now - prev < 3_000) {
    return { synced: 0, skipped: "throttle" };
  }
  popupSyncAt.set(adviseurId, now);

  const sb = getSupabaseAdmin();
  const { data: adv, error } = await sb
    .from("adviseurs")
    .select("id, unite_lijn, unite_ext, actief")
    .eq("id", adviseurId)
    .maybeSingle();
  if (error || !adv?.actief) return { synced: 0, skipped: "geen_adviseur" };
  if (!adv.unite_lijn && !adv.unite_ext) {
    return { synced: 0, skipped: "geen_unite_lijn" };
  }

  const { listUniteCdrLogs, uniteConfigured } = await import("@/lib/unite");
  const { cdrLogToActivity, logUniteCallActivity } = await import(
    "@/lib/unite-call-activity"
  );
  if (!uniteConfigured()) return { synced: 0, skipped: "unite_off" };

  const lookback = Math.min(45, Math.max(5, opts?.lookbackMinutes ?? 25));
  const end = new Date();
  const start = new Date(end.getTime() - lookback * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  let items: Awaited<ReturnType<typeof listUniteCdrLogs>>["items"] = [];
  try {
    const res = await listUniteCdrLogs({
      dateStart: fmt(start),
      dateEnd: fmt(end),
      pageLimit: 40,
      page: 1,
    });
    items = res.items;
  } catch (e) {
    console.warn("syncRecentCallPopupsForAdviseur CDR:", e);
    return { synced: 0, skipped: "cdr_fout" };
  }

  let synced = 0;
  for (const log of items) {
    const act = cdrLogToActivity(log);
    if (!act) continue;
    if (act.durationSeconds <= 0 && !act.matchPhone) continue;
    // Geen popup voor intern toestel↔toestel (0200→0201)
    const fromExt = normalizeExt(act.fromNumber);
    const toExt = normalizeExt(act.toNumber);
    if (fromExt && toExt) continue;
    if (!act.matchPhone) continue;

    if (!isInboundCallDirection(act.direction)) continue;
    let owner = await findAdviseurForUniteEndpoint(act.toNumber);
    if (!owner) {
      owner = await findAdviseurForUniteEndpoint(act.fromNumber);
    }
    if (!owner || owner.id !== adviseurId) continue;

    const popup = await emitEndedPopupFromActivity({
      uniqueid: act.uniqueid,
      callAt: act.callAt,
      direction: act.direction,
      durationSeconds: act.durationSeconds,
      fromNumber: act.fromNumber,
      toNumber: act.toNumber,
    });
    if (popup) synced += 1;

    // Lead-activiteit best-effort (idempotent)
    if (act.matchPhone) {
      try {
        await logUniteCallActivity(act);
      } catch {
        /* ignore */
      }
    }
  }
  return { synced };
}

async function attachCallPopupCards(
  rows: CallPopupRow[]
): Promise<CallPopupRow[]> {
  if (rows.length === 0) return rows;
  const sb = getSupabaseAdmin();
  const leadIds = [
    ...new Set(rows.map((r) => r.lead_id).filter((id): id is string => Boolean(id))),
  ];
  const projectIds = [
    ...new Set(
      rows.map((r) => r.project_id).filter((id): id is string => Boolean(id))
    ),
  ];

  const leadById = new Map<string, CallPopupLeadCard>();
  if (leadIds.length > 0) {
    const { data } = await sb
      .from("leads")
      .select(
        "id, naam, lead_number, telefoon, email, straat, huisnummer, postcode, plaats, status"
      )
      .in("id", leadIds);
    for (const l of data || []) {
      leadById.set(l.id, {
        id: l.id,
        naam: l.naam,
        lead_number: l.lead_number,
        telefoon: l.telefoon,
        email: l.email,
        straat: l.straat,
        huisnummer: l.huisnummer,
        postcode: l.postcode,
        plaats: l.plaats,
        status: l.status,
      });
    }
  }

  const projectById = new Map<string, CallPopupProjectCard>();
  const projectByLead = new Map<string, CallPopupProjectCard>();
  const projectSelect =
    "id, project_nummer, status, titel, betaalwijze, schouw_at, installatie_at, lead_id, created_at";
  if (projectIds.length > 0) {
    const { data } = await sb
      .from("projecten")
      .select(projectSelect)
      .in("id", projectIds);
    for (const p of data || []) {
      const card: CallPopupProjectCard = {
        id: p.id,
        project_nummer: p.project_nummer,
        status: p.status,
        titel: p.titel,
        betaalwijze: p.betaalwijze,
        schouw_at: p.schouw_at,
        installatie_at: p.installatie_at,
      };
      projectById.set(p.id, card);
    }
  }
  if (leadIds.length > 0) {
    const { data } = await sb
      .from("projecten")
      .select(projectSelect)
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false });
    const ranked = [...(data || [])].sort((a, b) => {
      const aOpen = String(a.status || "") === "annulering" ? 1 : 0;
      const bOpen = String(b.status || "") === "annulering" ? 1 : 0;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
    for (const p of ranked) {
      if (projectByLead.has(p.lead_id)) continue;
      projectByLead.set(p.lead_id, {
        id: p.id,
        project_nummer: p.project_nummer,
        status: p.status,
        titel: p.titel,
        betaalwijze: p.betaalwijze,
        schouw_at: p.schouw_at,
        installatie_at: p.installatie_at,
      });
    }
  }

  return rows.map((row) => {
    const lead = row.lead_id ? leadById.get(row.lead_id) || null : null;
    const project =
      (row.project_id ? projectById.get(row.project_id) : null) ||
      (row.lead_id ? projectByLead.get(row.lead_id) : null) ||
      null;
    return {
      ...row,
      lead_naam: lead?.naam || row.lead_naam,
      project_id: project?.id || row.project_id,
      project_nummer: project?.project_nummer || row.project_nummer,
      lead,
      project,
    };
  });
}

export async function listOpenCallPopups(
  adviseurId: string
): Promise<CallPopupRow[]> {
  const sb = getSupabaseAdmin();
  const since = new Date(Date.now() - 2 * 3600_000).toISOString();
  const { data, error } = await sb
    .from("call_popups")
    .select("*")
    .eq("adviseur_id", adviseurId)
    .is("dismissed_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    if (error.message?.includes("call_popups")) return [];
    console.warn("listOpenCallPopups:", error.message);
    return [];
  }
  const open = ((data || []) as CallPopupRow[]).filter(
    (p) => p.phase === "ended" && isInboundCallDirection(p.direction)
  );
  return attachCallPopupCards(open);
}

export async function dismissCallPopup(id: string, adviseurId: string) {
  const sb = getSupabaseAdmin();
  await sb
    .from("call_popups")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("adviseur_id", adviseurId);
}

export async function saveCallPopupNotitie(opts: {
  id: string;
  adviseurId: string;
  adviseurNaam?: string | null;
  notitie: string;
}): Promise<{ ok: boolean; error?: string }> {
  const text = opts.notitie.trim();
  if (!text) return { ok: false, error: "Notitie is leeg" };

  const sb = getSupabaseAdmin();
  const { data: popup, error } = await sb
    .from("call_popups")
    .select("*")
    .eq("id", opts.id)
    .eq("adviseur_id", opts.adviseurId)
    .maybeSingle();
  if (error || !popup) return { ok: false, error: "Popup niet gevonden" };

  const noteBody = `Inkomend gesprek\n${text}`;
  let projectId = (popup.project_id as string | null) || null;
  if (!projectId && popup.lead_id) {
    const { data: projects } = await sb
      .from("projecten")
      .select("id, status, created_at")
      .eq("lead_id", popup.lead_id)
      .order("created_at", { ascending: false })
      .limit(8);
    const ranked = [...(projects || [])].sort((a, b) => {
      const aOpen = String(a.status || "") === "annulering" ? 1 : 0;
      const bOpen = String(b.status || "") === "annulering" ? 1 : 0;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
    projectId = ranked[0]?.id || null;
  }

  if (projectId) {
    const { data: project } = await sb
      .from("projecten")
      .select("notities")
      .eq("id", projectId)
      .maybeSingle();
    const merged = appendStampedNotitie(
      project?.notities,
      noteBody,
      new Date(),
      opts.adviseurNaam || null
    );
    await sb.from("projecten").update({ notities: merged }).eq("id", projectId);
  } else if (popup.lead_id) {
    const { data: lead } = await sb
      .from("leads")
      .select("notities")
      .eq("id", popup.lead_id)
      .maybeSingle();
    const merged = appendStampedNotitie(
      lead?.notities,
      noteBody,
      new Date(),
      opts.adviseurNaam || null
    );
    await sb
      .from("leads")
      .update({ notities: merged })
      .eq("id", popup.lead_id);
  }

  if (popup.lead_id) {
    await logLeadEvent({
      leadId: popup.lead_id,
      soort: "bel",
      titel: projectId ? "Gesprek bij order" : "Inkomend gesprek",
      detail: text,
      meta: {
        bron: "call_popup",
        call_popup_id: popup.id,
        call_uniqueid: popup.call_uniqueid,
        direction: "in",
        duration_seconds: popup.duration_seconds,
        project_id: projectId,
      },
    });
  }

  await sb
    .from("call_popups")
    .update({
      note_saved_at: new Date().toISOString(),
      dismissed_at: new Date().toISOString(),
      ...(projectId ? { project_id: projectId } : {}),
      meta: {
        ...(popup.meta || {}),
        nagesprek: text,
      },
    })
    .eq("id", opts.id);

  return { ok: true };
}
