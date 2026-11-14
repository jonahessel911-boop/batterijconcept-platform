import type { SupabaseClient } from "@supabase/supabase-js";
import { fromZonedTime } from "date-fns-tz";
import { isAdminAdviseur, isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import {
  buildBelConversie,
  type BelConversieAfspraak,
  type BelConversieLead,
} from "@/lib/bel-conversie";
import { AMSTERDAM_TZ } from "@/lib/format";
import { isAgendaAdviseur } from "@/lib/rollen";
import {
  isBeforeStartdatum,
  isSlotGeblokkeerd,
  loadAfblokkingen,
  loadSlotVrijgaven,
  loadUnavailableWeekKeys,
} from "@/lib/adviseur-beschikbaarheid";
import { ADVISEUR_SLOT_HOURS } from "@/lib/slots";
import {
  advisorRows,
  applyFilters,
  inSelectedPeriod,
  matchesFocus,
  perDay,
  signedPaymentView,
  targetWarning,
  totalsFor,
  trendFor,
  weeksActiveApprox,
  type Filters,
  type Focus,
} from "@/lib/sales-cockpit/aggregate";
import {
  classifyLead,
  type Dossier,
  type RawAppt,
  type RawFactuur,
  type RawLead,
  type RawOffer,
  type RawProject,
} from "@/lib/sales-cockpit/classify";
import {
  buildDayOverview,
  buildSalesQuality,
  buildTrendSeries,
  buildWeekLeaderboard,
  buildWeekOverview,
} from "@/lib/sales-cockpit/cockpit-metrics";
import {
  buildWallboard,
  WALL_CLAIM_DISPLAY_TTL_MS,
  type WallActivityEvent,
  type WallActivityKind,
  type WallClaimRow,
} from "@/lib/sales-cockpit/wallboard";
import {
  addYmd,
  daysInclusive,
  defaultGroupBy,
  formatRangeLabel,
  isYmd,
  isoToYmd,
  presetRange,
  rangesEqualLength,
  upcomingWeeks,
  weekOverlaps,
  weekRangeContaining,
  ymdInRange,
  type DateRange,
  type GroupBy,
} from "@/lib/sales-cockpit/range";
import { isAfboekDetail } from "@/lib/sales-cockpit/uitkomst";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

const NORM_BLOCKS = 15;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function amsDayBounds(ymd: string): { start: Date; end: Date } {
  const [y, m, d] = ymd.split("-").map(Number);
  return {
    start: fromZonedTime(new Date(y!, m! - 1, d!, 0, 0, 0, 0), AMSTERDAM_TZ),
    end: fromZonedTime(
      new Date(y!, m! - 1, d!, 23, 59, 59, 999),
      AMSTERDAM_TZ
    ),
  };
}

/** Aantal leads aangemaakt op een Amsterdam-kalenderdag. */
async function loadLeadsCreatedOnDay(
  sb: SupabaseClient,
  ymd: string
): Promise<number> {
  const { start, end } = amsDayBounds(ymd);
  const { count, error } = await sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function wallActivityKindFromLeadEvent(soort: string): WallActivityKind {
  if (soort === "status") return "status";
  if (soort === "afspraak" || soort === "terugbel") return "afspraak";
  if (soort === "bel") return "bel";
  if (soort === "offerte") return "offerte";
  if (soort === "factuur") return "factuur";
  if (soort === "betaling") return "betaling";
  if (soort === "inkoop") return "inkoop";
  if (soort === "schouw") return "schouw";
  if (soort === "installatie") return "installatie";
  if (soort === "service") return "service";
  if (soort === "contact" || soort === "email" || soort === "notitie") {
    return "overig";
  }
  return "overig";
}

const BACKOFFICE_ACTIE_LABEL: Record<string, string> = {
  bel_schouw_aanbetaling: "Bel schouw / aanbetaling",
  schakel_financiering: "Schakel financiering",
  nabellen_factuur: "Factuur opvolgen",
  herplan_afspraak: "Herplan afspraak",
  aangetekende_brief: "Aangetekende brief",
  annulering_keuze_controle: "Annuleringskeuze gecontroleerd",
};

function backofficeActieLabel(soort: string): string {
  return BACKOFFICE_ACTIE_LABEL[soort] || soort.replace(/_/g, " ");
}

function soortAfspraakLabel(soort: string | null | undefined): string {
  const s = (soort || "").trim();
  if (s === "nieuw") return "Nieuw";
  if (s === "vervolg_fysiek") return "Locatie";
  if (s === "vervolg_tel") return "Telefonisch";
  if (s === "vervolg_punt") return "Punt";
  return s || "Afspraak";
}

/**
 * Live activity-feed voor de wall: lead_events + leads + afspraken +
 * offertes + backoffice-acties van de geselecteerde dag (nieuwste eerst).
 */
async function loadWallActivity(
  sb: SupabaseClient,
  opts: {
    ymd: string;
    appointments: RawAppt[];
    advisorsById: Map<string, { naam: string; rol?: string | null }>;
    leadMetaById: Map<string, { leadNumber: string; naam: string }>;
    limit?: number;
  }
): Promise<WallActivityEvent[]> {
  const limit = opts.limit ?? 80;
  const { start, end } = amsDayBounds(opts.ymd);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const events: WallActivityEvent[] = [];
  const seen = new Set<string>();

  const push = (ev: WallActivityEvent) => {
    if (seen.has(ev.id)) return;
    seen.add(ev.id);
    events.push(ev);
  };

  const [
    leadEventsRes,
    newLeadsRes,
    offersCreatedRes,
    offersSentRes,
    offersSignedRes,
    offersRejectedRes,
    backofficeRes,
  ] = await Promise.all([
    sb
      .from("lead_events")
      .select("id, lead_id, soort, titel, detail, meta, created_at")
      .in("soort", [
        "status",
        "afspraak",
        "terugbel",
        "bel",
        "contact",
        "notitie",
        "email",
        "offerte",
        "factuur",
        "betaling",
        "inkoop",
        "schouw",
        "installatie",
        "service",
        "overig",
      ])
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .limit(120),
    sb
      .from("leads")
      .select("id, naam, lead_number, adviseur_id, created_at")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .limit(40),
    sb
      .from("offertes")
      .select("id, lead_id, aangemaakt_door_id, created_at, status, offerte_nummer")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .limit(40),
    sb
      .from("offertes")
      .select(
        "id, lead_id, aangemaakt_door_id, verzonden_op, status, offerte_nummer"
      )
      .not("verzonden_op", "is", null)
      .gte("verzonden_op", startIso)
      .lte("verzonden_op", endIso)
      .order("verzonden_op", { ascending: false })
      .limit(40),
    sb
      .from("offertes")
      .select(
        "id, lead_id, aangemaakt_door_id, ondertekend_op, status, offerte_nummer"
      )
      .eq("status", "ondertekend")
      .not("ondertekend_op", "is", null)
      .gte("ondertekend_op", startIso)
      .lte("ondertekend_op", endIso)
      .order("ondertekend_op", { ascending: false })
      .limit(40),
    sb
      .from("offertes")
      .select(
        "id, lead_id, aangemaakt_door_id, updated_at, status, offerte_nummer"
      )
      .in("status", ["afgewezen", "verlopen"])
      .gte("updated_at", startIso)
      .lte("updated_at", endIso)
      .order("updated_at", { ascending: false })
      .limit(40),
    sb
      .from("backoffice_actie_events")
      .select(
        "id, soort, lead_id, project_id, adviseur_id, completed_at, meta, created_at"
      )
      .gte("completed_at", startIso)
      .lte("completed_at", endIso)
      .order("completed_at", { ascending: false })
      .limit(80),
  ]);

  // Extra lead-meta voor IDs die nog niet in leadMetaById zitten.
  const missingLeadIds = new Set<string>();
  for (const row of leadEventsRes.data || []) {
    const id = String(row.lead_id);
    if (!opts.leadMetaById.has(id)) missingLeadIds.add(id);
  }
  for (const row of [
    ...(offersCreatedRes.data || []),
    ...(offersSentRes.data || []),
    ...(offersSignedRes.data || []),
    ...(offersRejectedRes.data || []),
  ]) {
    const id = String(row.lead_id);
    if (!opts.leadMetaById.has(id)) missingLeadIds.add(id);
  }
  for (const row of backofficeRes.data || []) {
    if (row.lead_id == null) continue;
    const id = String(row.lead_id);
    if (!opts.leadMetaById.has(id)) missingLeadIds.add(id);
  }
  for (const appt of opts.appointments) {
    if (!opts.leadMetaById.has(appt.leadId)) missingLeadIds.add(appt.leadId);
  }

  const extraLeadMeta = new Map(opts.leadMetaById);
  if (missingLeadIds.size > 0) {
    const ids = [...missingLeadIds];
    for (let i = 0; i < ids.length; i += 150) {
      const chunkIds = ids.slice(i, i + 150);
      const { data } = await sb
        .from("leads")
        .select("id, naam, lead_number")
        .in("id", chunkIds);
      for (const row of data || []) {
        extraLeadMeta.set(String(row.id), {
          leadNumber: String(row.lead_number || row.id),
          naam: String(row.naam || "Lead"),
        });
      }
    }
  }

  const leadName = (leadId: string | null | undefined) =>
    leadId ? extraLeadMeta.get(leadId)?.naam || null : null;
  const actorName = (id: string | null | undefined) =>
    id ? opts.advisorsById.get(id)?.naam || null : null;

  /** Actor uit lead_events.meta of detail-tekst. */
  const actorFromEventMeta = (meta: unknown, detail: string | null) => {
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      const m = meta as Record<string, unknown>;
      for (const key of [
        "adviseur_naam",
        "door_naam",
        "actor_naam",
        "operator_naam",
      ] as const) {
        const v = m[key];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      for (const key of ["adviseur_id", "door_id", "actor_id", "operator_id"] as const) {
        const v = m[key];
        if (typeof v === "string" && v) {
          const naam = actorName(v);
          if (naam) return naam;
        }
      }
    }
    // Annuleer-detail bevat vaak al de naam: "… · Naam · Reden: …"
    if (detail) {
      const parts = detail.split("·").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const mid = parts[1]!;
        if (
          mid &&
          !mid.toLowerCase().startsWith("reden") &&
          mid !== "Klant" &&
          mid.length <= 48
        ) {
          return mid;
        }
      }
    }
    return null;
  };

  // Fallback voor oudere status-events zonder meta: adviseur van de afspraak.
  const apptActorByLead = new Map<string, string>();
  for (const appt of opts.appointments) {
    if (!appt.adviseurId) continue;
    const ymd = isoToYmd(appt.startAt);
    if (ymd !== opts.ymd) continue;
    if (!apptActorByLead.has(appt.leadId)) {
      const naam = actorName(appt.adviseurId);
      if (naam) apptActorByLead.set(appt.leadId, naam);
    }
  }

  const offerEventId = (
    phase: "c" | "s" | "x" | "r",
    offerteId: string | null | undefined,
    fallback: string
  ) => (offerteId ? `offer-${phase}:${offerteId}` : fallback);

  if (!leadEventsRes.error) {
    for (const row of leadEventsRes.data || []) {
      const soort = String(row.soort || "overig");
      const detail = row.detail == null ? null : String(row.detail);
      const leadId = String(row.lead_id);
      const titel = String(row.titel || "Gebeurtenis");
      const meta =
        row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
          ? (row.meta as Record<string, unknown>)
          : null;
      const offerteId =
        meta && typeof meta.offerte_id === "string" ? meta.offerte_id : null;
      let actor =
        actorFromEventMeta(row.meta, detail) ||
        (soort === "status" ? apptActorByLead.get(leadId) || null : null);

      // Dedup met offerte-tabel-events (aangemaakt / verstuurd / getekend).
      let id = `le:${row.id}`;
      let kind = wallActivityKindFromLeadEvent(soort);
      let displayTitel = titel;
      const titelLower = titel.toLowerCase();
      if (kind === "offerte" || soort === "offerte") {
        if (titelLower.includes("verstuurd")) {
          id = offerEventId("s", offerteId, id);
        } else if (titelLower.includes("getekend") || titelLower.includes("ondertekend")) {
          id = offerEventId("x", offerteId, id);
        } else if (titelLower.includes("aangemaakt")) {
          id = offerEventId("c", offerteId, id);
        } else if (titelLower.includes("afgewezen") || titelLower.includes("verlopen")) {
          id = offerEventId("r", offerteId, id);
        }
      }

      // Agenda-afboek → eigen activity-kind voor live wall + overlay.
      if (soort === "status" && isAfboekDetail(detail)) {
        kind = "afboek";
        const statusLabel = titel.startsWith("Status → ")
          ? titel.slice("Status → ".length).trim()
          : titel;
        displayTitel = statusLabel
          ? `Afspraak afgeboekt · ${statusLabel}`
          : "Afspraak afgeboekt";
        if (!actor) {
          const metaAdv =
            meta && typeof meta.adviseur_id === "string"
              ? actorName(meta.adviseur_id)
              : null;
          const metaNaam =
            meta && typeof meta.adviseur_naam === "string"
              ? meta.adviseur_naam.trim()
              : "";
          actor = metaNaam || metaAdv || actor;
        }
      }

      push({
        id,
        at: String(row.created_at),
        kind,
        titel: displayTitel,
        detail,
        leadId,
        leadNaam: leadName(leadId),
        actorNaam: actor,
      });
    }
  }

  if (!newLeadsRes.error) {
    for (const row of newLeadsRes.data || []) {
      const advId =
        row.adviseur_id == null ? null : String(row.adviseur_id);
      const id = String(row.id);
      push({
        id: `lead:${id}`,
        at: String(row.created_at),
        kind: "lead",
        titel: "Nieuwe lead",
        detail: null,
        leadId: id,
        leadNaam: String(row.naam || "Lead"),
        actorNaam: actorName(advId),
      });
    }
  }

  for (const appt of opts.appointments) {
    if (appt.status === "geannuleerd" || appt.status === "verzet") continue;
    const created = appt.createdAt || appt.startAt;
    const createdYmd = isoToYmd(created);
    if (createdYmd !== opts.ymd) continue;
    const soort = (appt.soort || "").trim();
    if (
      soort === "bel" ||
      soort === "warme_bel" ||
      soort === "warmtefonds_aanvraag"
    ) {
      continue;
    }
    push({
      id: `appt:${appt.id}`,
      at: created,
      kind: "afspraak",
      titel: `Afspraak ingepland · ${soortAfspraakLabel(soort)}`,
      detail: null,
      leadId: appt.leadId,
      leadNaam: leadName(appt.leadId),
      actorNaam:
        actorName(appt.plannerId) || actorName(appt.adviseurId),
    });
  }

  if (!offersCreatedRes.error) {
    for (const row of offersCreatedRes.data || []) {
      const actorId =
        row.aangemaakt_door_id == null
          ? null
          : String(row.aangemaakt_door_id);
      const leadId = String(row.lead_id);
      const nr = row.offerte_nummer ? String(row.offerte_nummer) : null;
      push({
        id: `offer-c:${row.id}`,
        at: String(row.created_at),
        kind: "offerte",
        titel: nr ? `Offerte ${nr} aangemaakt` : "Offerte aangemaakt",
        detail: null,
        leadId,
        leadNaam: leadName(leadId),
        actorNaam: actorName(actorId),
      });
    }
  }
  if (!offersSentRes.error) {
    for (const row of offersSentRes.data || []) {
      const actorId =
        row.aangemaakt_door_id == null
          ? null
          : String(row.aangemaakt_door_id);
      const leadId = String(row.lead_id);
      const nr = row.offerte_nummer ? String(row.offerte_nummer) : null;
      push({
        id: `offer-s:${row.id}`,
        at: String(row.verzonden_op),
        kind: "offerte",
        titel: nr ? `Offerte ${nr} verstuurd` : "Offerte verstuurd",
        detail: null,
        leadId,
        leadNaam: leadName(leadId),
        actorNaam: actorName(actorId),
      });
    }
  }
  if (!offersSignedRes.error) {
    for (const row of offersSignedRes.data || []) {
      const actorId =
        row.aangemaakt_door_id == null
          ? null
          : String(row.aangemaakt_door_id);
      const leadId = String(row.lead_id);
      const nr = row.offerte_nummer ? String(row.offerte_nummer) : null;
      push({
        id: `offer-x:${row.id}`,
        at: String(row.ondertekend_op),
        kind: "offerte",
        titel: nr ? `Offerte ${nr} getekend` : "Offerte getekend",
        detail: null,
        leadId,
        leadNaam: leadName(leadId),
        actorNaam: actorName(actorId),
      });
    }
  }
  if (!offersRejectedRes.error) {
    for (const row of offersRejectedRes.data || []) {
      const actorId =
        row.aangemaakt_door_id == null
          ? null
          : String(row.aangemaakt_door_id);
      const leadId = String(row.lead_id);
      const nr = row.offerte_nummer ? String(row.offerte_nummer) : null;
      const status = String(row.status || "afgewezen");
      const label = status === "verlopen" ? "verlopen" : "afgewezen";
      push({
        id: `offer-r:${row.id}`,
        at: String(row.updated_at),
        kind: "offerte",
        titel: nr ? `Offerte ${nr} ${label}` : `Offerte ${label}`,
        detail: null,
        leadId,
        leadNaam: leadName(leadId),
        actorNaam: actorName(actorId),
      });
    }
  }

  if (!backofficeRes.error) {
    for (const row of backofficeRes.data || []) {
      const leadId = row.lead_id == null ? null : String(row.lead_id);
      const actorId =
        row.adviseur_id == null ? null : String(row.adviseur_id);
      const soort = String(row.soort || "");
      const meta =
        row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
          ? (row.meta as Record<string, unknown>)
          : null;
      const metaTitel =
        meta && typeof meta.titel === "string" ? meta.titel.trim() : "";
      push({
        id: `bo:${row.id}`,
        at: String(row.completed_at || row.created_at),
        kind: "backoffice",
        titel: metaTitel || `Backoffice: ${backofficeActieLabel(soort)}`,
        detail: metaTitel ? backofficeActieLabel(soort) : null,
        leadId,
        leadNaam: leadName(leadId),
        actorNaam: actorName(actorId),
      });
    }
  }

  events.sort((a, b) => b.at.localeCompare(a.at));
  return events.slice(0, limit);
}

/**
 * Week-belconversie voor de live wall —zelfde definitie als rapportage
 * Bel-conversie: L→A = nonNieuwIngepland / nonNieuwGebeld (Lead to appointment).
 */
async function loadWeekBelWallKpis(
  sb: SupabaseClient,
  week: DateRange,
  appointments: RawAppt[],
  advisors: {
    id: string;
    naam: string;
    rol: string | null;
    actief: boolean;
    email: string | null;
  }[]
): Promise<{ gebeld: number; belIngepland: number; belConversiePct: number | null }> {
  const { start } = amsDayBounds(week.from);
  const { end } = amsDayBounds(week.to);
  // Zelfde ±12u padding als /api/rapportage/bel-conversie
  const padStart = new Date(start.getTime() - 12 * 3600 * 1000).toISOString();
  const padEnd = new Date(end.getTime() + 12 * 3600 * 1000).toISOString();

  const afspraken: BelConversieAfspraak[] = appointments.map((a) => ({
    id: a.id,
    lead_id: a.leadId,
    created_at: a.createdAt ?? null,
    start_at: a.startAt,
    status: a.status,
    soort: a.soort,
    adviseur_id: a.adviseurId,
    ingepland_door_id: a.plannerId,
  }));

  const leadsById = new Map<string, BelConversieLead>();

  async function ingestLeadRows(rows: Record<string, unknown>[]) {
    for (const row of rows) {
      const id = String(row.id);
      leadsById.set(id, {
        id,
        naam: (row.naam as string | null) ?? null,
        lead_number: (row.lead_number as string | null) ?? null,
        status: (row.status as string | null) ?? null,
        laatst_gebeld_at: (row.laatst_gebeld_at as string | null) ?? null,
        laatst_gebeld_door: (row.laatst_gebeld_door as string | null) ?? null,
        bel_claimed_by: (row.bel_claimed_by as string | null) ?? null,
        beller_id: (row.beller_id as string | null) ?? null,
      });
    }
  }

  const { data: belledRows, error: belledErr } = await sb
    .from("leads")
    .select(
      "id, naam, lead_number, status, laatst_gebeld_at, laatst_gebeld_door, bel_claimed_by, beller_id"
    )
    .gte("laatst_gebeld_at", padStart)
    .lte("laatst_gebeld_at", padEnd);
  if (belledErr) {
    const msg = belledErr.message || "";
    if (
      belledErr.code === "42703" ||
      msg.includes("laatst_gebeld_at") ||
      msg.includes("laatst_gebeld_door") ||
      msg.includes("beller_id")
    ) {
      // Fallback zonder optionele kolommen
      const { data: fallback, error: fbErr } = await sb
        .from("leads")
        .select(
          "id, naam, lead_number, status, laatst_gebeld_at, bel_claimed_by"
        )
        .gte("laatst_gebeld_at", padStart)
        .lte("laatst_gebeld_at", padEnd);
      if (fbErr) {
        if (
          fbErr.code === "42703" ||
          (fbErr.message || "").includes("laatst_gebeld_at")
        ) {
          return { gebeld: 0, belIngepland: 0, belConversiePct: null };
        }
        throw new Error(fbErr.message);
      }
      await ingestLeadRows((fallback || []) as Record<string, unknown>[]);
    } else {
      throw new Error(belledErr.message);
    }
  } else {
    await ingestLeadRows((belledRows || []) as Record<string, unknown>[]);
  }

  // Leads met huisbezoek-created_at in de week (ook als laatst_gebeld buiten venster valt).
  const extraIds: string[] = [];
  for (const a of appointments) {
    if (!a.createdAt) continue;
    const t = new Date(a.createdAt).getTime();
    if (t < start.getTime() || t > end.getTime()) continue;
    if (leadsById.has(a.leadId)) continue;
    extraIds.push(a.leadId);
  }
  for (const ids of chunk([...new Set(extraIds)], 150)) {
    const { data, error } = await sb
      .from("leads")
      .select(
        "id, naam, lead_number, status, laatst_gebeld_at, laatst_gebeld_door, bel_claimed_by, beller_id"
      )
      .in("id", ids);
    if (error) {
      const msg = error.message || "";
      if (error.code === "42703" || msg.includes("beller_id") || msg.includes("laatst_gebeld_door")) {
        const { data: fb, error: fbErr } = await sb
          .from("leads")
          .select(
            "id, naam, lead_number, status, laatst_gebeld_at, bel_claimed_by"
          )
          .in("id", ids);
        if (fbErr) throw new Error(fbErr.message);
        await ingestLeadRows((fb || []) as Record<string, unknown>[]);
        continue;
      }
      throw new Error(error.message);
    }
    await ingestLeadRows((data || []) as Record<string, unknown>[]);
  }

  const result = buildBelConversie({
    dateYmd: week.to,
    rangeStartYmd: week.from,
    periodLabel: "Deze week",
    period: "custom_week",
    periodDays:
      Math.max(
        1,
        Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
      ),
    leads: [...leadsById.values()],
    afspraken,
    huisbezoekHistorie: afspraken,
    adviseurs: advisors,
  });

  // Zelfde KPI als Bel-conversie rapportage: “Lead to appointment”
  return {
    gebeld: result.totals.nonNieuwGebeld,
    belIngepland: result.totals.nonNieuwIngepland,
    belConversiePct: result.totals.nonNieuwLeadToAppt,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function loadAppointments(sb: SupabaseClient): Promise<RawAppt[]> {
  const withPlanner = await fetchAllRows<Record<string, unknown>>((from, to) =>
    sb
      .from("afspraken")
      .select(
        "id, lead_id, adviseur_id, ingepland_door_id, start_at, end_at, created_at, status, soort"
      )
      .order("id", { ascending: true })
      .range(from, to)
  ).catch(async (err: { message?: string; code?: string }) => {
    const msg = err?.message || "";
    if (err?.code === "42703" || msg.includes("ingepland_door_id")) {
      return fetchAllRows<Record<string, unknown>>((from, to) =>
        sb
          .from("afspraken")
          .select(
            "id, lead_id, adviseur_id, start_at, end_at, created_at, status, soort"
          )
          .order("id", { ascending: true })
          .range(from, to)
      );
    }
    if (err?.code === "42703" || msg.includes("created_at")) {
      return fetchAllRows<Record<string, unknown>>((from, to) =>
        sb
          .from("afspraken")
          .select(
            "id, lead_id, adviseur_id, ingepland_door_id, start_at, end_at, status, soort"
          )
          .order("id", { ascending: true })
          .range(from, to)
      );
    }
    throw err;
  });
  return withPlanner.map((row) => ({
    id: String(row.id),
    leadId: String(row.lead_id),
    adviseurId: (row.adviseur_id as string | null) ?? null,
    plannerId: (row.ingepland_door_id as string | null) ?? null,
    startAt: String(row.start_at),
    endAt: row.end_at == null ? null : String(row.end_at),
    createdAt: row.created_at == null ? null : String(row.created_at),
    status: String(row.status || ""),
    soort: (row.soort as string | null) ?? null,
  }));
}

/**
 * Actieve bellers voor de live wall:
 * 1) soft-claims (ruimer TTL dan de bel-queue),
 * 2) open Fonio-gesprekken (ringing/active), toegeschreven via lead.
 */
async function loadWallBelCallers(sb: SupabaseClient): Promise<WallClaimRow[]> {
  const since = new Date(Date.now() - WALL_CLAIM_DISPLAY_TTL_MS).toISOString();
  const byLead = new Map<string, WallClaimRow>();

  const { data: claimRows, error: claimErr } = await sb
    .from("leads")
    .select("id, lead_number, naam, bel_claimed_by, bel_claimed_at")
    .not("bel_claimed_by", "is", null)
    .gte("bel_claimed_at", since)
    .order("bel_claimed_at", { ascending: false })
    .limit(60);
  if (claimErr) {
    const msg = claimErr.message || "";
    if (
      !(
        claimErr.code === "42703" ||
        msg.includes("bel_claimed_by") ||
        msg.includes("bel_claimed_at")
      )
    ) {
      console.warn("wall bel claims:", claimErr.message);
    }
  } else {
    for (const row of claimRows || []) {
      if (!row.bel_claimed_by || !row.bel_claimed_at) continue;
      const leadId = String(row.id);
      byLead.set(leadId, {
        leadId,
        leadNumber: String(row.lead_number || row.id),
        leadNaam: String(row.naam || "Lead"),
        claimedBy: String(row.bel_claimed_by),
        claimedAt: String(row.bel_claimed_at),
        onCall: false,
      });
    }
  }

  const { data: fonioRows, error: fonioErr } = await sb
    .from("fonio_calls")
    .select("lead_id, started_at, status")
    .in("status", ["ringing", "active"])
    .order("started_at", { ascending: false })
    .limit(40);
  if (fonioErr) {
    const msg = fonioErr.message || "";
    if (
      !(
        fonioErr.code === "42P01" ||
        msg.includes("fonio_calls")
      )
    ) {
      console.warn("wall fonio calls:", fonioErr.message);
    }
  } else if (fonioRows && fonioRows.length > 0) {
    const fonioLeadIds = [
      ...new Set(
        fonioRows
          .map((r) => (r.lead_id ? String(r.lead_id) : ""))
          .filter(Boolean)
      ),
    ];
    const leadById = new Map<
      string,
      {
        lead_number: string | null;
        naam: string | null;
        bel_claimed_by: string | null;
        bel_claimed_at: string | null;
        laatst_gebeld_door: string | null;
        beller_id: string | null;
      }
    >();
    for (const ids of chunk(fonioLeadIds, 150)) {
      const { data: leads, error: leadErr } = await sb
        .from("leads")
        .select(
          "id, lead_number, naam, bel_claimed_by, bel_claimed_at, laatst_gebeld_door, beller_id"
        )
        .in("id", ids);
      if (leadErr) {
        console.warn("wall fonio leads:", leadErr.message);
        break;
      }
      for (const row of leads || []) {
        leadById.set(String(row.id), {
          lead_number: (row.lead_number as string | null) ?? null,
          naam: (row.naam as string | null) ?? null,
          bel_claimed_by: (row.bel_claimed_by as string | null) ?? null,
          bel_claimed_at: (row.bel_claimed_at as string | null) ?? null,
          laatst_gebeld_door: (row.laatst_gebeld_door as string | null) ?? null,
          beller_id: (row.beller_id as string | null) ?? null,
        });
      }
    }

    for (const call of fonioRows) {
      const leadId = call.lead_id ? String(call.lead_id) : "";
      if (!leadId) continue;
      const lead = leadById.get(leadId);
      const claimedBy =
        (lead?.bel_claimed_by || "").trim() ||
        (lead?.laatst_gebeld_door || "").trim() ||
        (lead?.beller_id || "").trim();
      if (!claimedBy) continue;
      const claimedAt =
        (lead?.bel_claimed_at || "").trim() ||
        (call.started_at ? String(call.started_at) : new Date().toISOString());
      const prev = byLead.get(leadId);
      byLead.set(leadId, {
        leadId,
        leadNumber: String(lead?.lead_number || prev?.leadNumber || leadId),
        leadNaam: String(lead?.naam || prev?.leadNaam || "Lead"),
        claimedBy: prev?.claimedBy || claimedBy,
        claimedAt: prev?.claimedAt || claimedAt,
        onCall: true,
      });
    }
  }

  return [...byLead.values()].sort((a, b) =>
    b.claimedAt.localeCompare(a.claimedAt)
  );
}

/**
 * Offerte-flags voor de live wall / dagoverzicht.
 * Alleen acties op de gekozen dag tellen — anders blijft een oud concept
 * ten onrechte als “Aangemaakt” op de adviseurskaart staan.
 */
async function loadOfferFlagsByLead(
  sb: SupabaseClient,
  leadIds: string[],
  dayYmd: string
): Promise<Map<string, { created: boolean; sent: boolean; signed: boolean }>> {
  const out = new Map<
    string,
    { created: boolean; sent: boolean; signed: boolean }
  >();
  if (leadIds.length === 0) return out;
  const { start, end } = amsDayBounds(dayYmd);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const inDay = (iso: string | null | undefined) => {
    if (!iso) return false;
    return iso >= startIso && iso <= endIso;
  };

  for (const ids of chunk(leadIds, 200)) {
    const { data, error } = await sb
      .from("offertes")
      .select("lead_id, status, created_at, verzonden_op, ondertekend_op")
      .in("lead_id", ids)
      .in("status", ["concept", "verzonden", "ondertekend"]);
    if (error) {
      // Graceful als verzonden_op-kolom nog ontbreekt.
      if (
        error.message?.includes("verzonden_op") ||
        error.message?.includes("schema cache")
      ) {
        const retry = await sb
          .from("offertes")
          .select("lead_id, status, created_at, ondertekend_op")
          .in("lead_id", ids)
          .in("status", ["concept", "verzonden", "ondertekend"]);
        if (retry.error) throw new Error(retry.error.message);
        for (const row of retry.data || []) {
          const leadId = String(row.lead_id);
          const status = String(row.status || "");
          const createdAt = row.created_at
            ? String(row.created_at)
            : null;
          const signedAt = row.ondertekend_op
            ? String(row.ondertekend_op)
            : null;
          const prev = out.get(leadId) || {
            created: false,
            sent: false,
            signed: false,
          };
          if (inDay(createdAt)) prev.created = true;
          if (
            status === "verzonden" &&
            inDay(createdAt)
          ) {
            prev.created = true;
            prev.sent = true;
          }
          if (status === "ondertekend" && inDay(signedAt)) {
            prev.created = true;
            prev.sent = true;
            prev.signed = true;
          }
          out.set(leadId, prev);
        }
        continue;
      }
      throw new Error(error.message);
    }
    for (const row of data || []) {
      const leadId = String(row.lead_id);
      const status = String(row.status || "");
      const createdAt = row.created_at ? String(row.created_at) : null;
      const sentAt = row.verzonden_op ? String(row.verzonden_op) : null;
      const signedAt = row.ondertekend_op ? String(row.ondertekend_op) : null;
      const prev = out.get(leadId) || {
        created: false,
        sent: false,
        signed: false,
      };
      // Alleen vandaag aangemaakt → “Aangemaakt”.
      if (inDay(createdAt)) prev.created = true;
      // Vandaag verstuurd (of getekend met verzonden_op vandaag).
      if (inDay(sentAt) || (status === "ondertekend" && inDay(signedAt) && inDay(sentAt))) {
        prev.sent = true;
        if (!prev.created && inDay(createdAt)) prev.created = true;
      }
      // Status verzonden zonder verzonden_op: alleen als vandaag aangemaakt.
      if (status === "verzonden" && !sentAt && inDay(createdAt)) {
        prev.sent = true;
      }
      if (status === "ondertekend" && inDay(signedAt)) {
        prev.signed = true;
        prev.sent = true;
        // Getekend vandaag telt ook als er vandaag een traject was.
        if (inDay(createdAt) || inDay(sentAt)) prev.created = true;
      }
      out.set(leadId, prev);
    }
  }
  return out;
}

async function loadOffers(sb: SupabaseClient): Promise<RawOffer[]> {
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
    sb
      .from("offertes")
      .select(
        "id, lead_id, ondertekend_op, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, aanbetaling_modus, aanbetaling_bedrag_inc, aanbetaling_te_innen_inc, financiering_voorbehoud, aangemaakt_door_id"
      )
      .eq("status", "ondertekend")
      .not("ondertekend_op", "is", null)
      .order("id", { ascending: true })
      .range(from, to)
  );
  return rows.map((row) => ({
    id: String(row.id),
    leadId: String(row.lead_id),
    ondertekendOp: String(row.ondertekend_op),
    ex: num(row.subtotaal_ex_btw),
    btw: num(row.btw_bedrag),
    inc: num(row.totaal_inc_btw),
    modus: (row.aanbetaling_modus as string | null) ?? null,
    bedragInc: row.aanbetaling_bedrag_inc == null ? null : num(row.aanbetaling_bedrag_inc),
    teInnen: row.aanbetaling_te_innen_inc == null ? null : num(row.aanbetaling_te_innen_inc),
    financiering: row.financiering_voorbehoud == null ? null : Boolean(row.financiering_voorbehoud),
    aangemaaktDoorId:
      row.aangemaakt_door_id == null ? null : String(row.aangemaakt_door_id),
  }));
}

export async function buildSalesCockpitReport(
  sb: SupabaseClient,
  opts: {
    range: DateRange;
    compare: DateRange | null;
    group: GroupBy;
    filters: Filters;
    focus: Focus | null;
    page: number;
    pageSize: number;
    todayYmd: string;
    /** Dag binnen de gewenste week voor het weekoverzicht (default: vandaag). */
    weekAnchorYmd?: string;
    /** Periode voor de trendchart onder het weekoverzicht. */
    trendRange?: DateRange;
    /** Interval voor de trendchart. */
    trendGroup?: GroupBy;
    /** Optionele adviseur-filter alleen voor de trendchart. */
    trendAdvisorIds?: string[];
    /** Dag voor het dagoverzicht (default: vandaag). */
    dayAnchorYmd?: string;
    /** Periode voor de sales-kwaliteit tab. */
    qualityRange?: DateRange;
    includePeriodRows?: boolean;
  }
) {
  const warnings: string[] = [];
  const [adviseurRows, appointments, offers] = await Promise.all([
    sb
      .from("adviseurs")
      .select("id, naam, actief, rol, email, startdatum, commissie_pct")
      .order("naam"),
    loadAppointments(sb),
    loadOffers(sb),
  ]);
  if (adviseurRows.error) throw new Error(adviseurRows.error.message);

  type Adv = {
    id: string;
    naam: string;
    actief: boolean;
    rol: string | null;
    email: string | null;
    startdatum: string | null;
    commissiePct: number;
  };
  const advisors: Adv[] = (adviseurRows.data || []).map((row) => ({
    id: String(row.id),
    naam: String(row.naam || "Onbekend"),
    actief: row.actief !== false,
    rol: (row.rol as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    startdatum: (row.startdatum as string | null) ?? null,
    commissiePct: num(row.commissie_pct),
  }));
  const advisorMap = new Map(
    advisors.map((a) => [
      a.id,
      { id: a.id, naam: a.naam, actief: a.actief, commissiePct: a.commissiePct },
    ])
  );
  const commissie = new Map(advisors.map((a) => [a.id, a.commissiePct]));

  const byLeadAppt = new Map<string, RawAppt[]>();
  for (const appt of appointments) {
    const list = byLeadAppt.get(appt.leadId) ?? [];
    list.push(appt);
    byLeadAppt.set(appt.leadId, list);
  }
  const byLeadOffer = new Map<string, RawOffer[]>();
  for (const offer of offers) {
    const list = byLeadOffer.get(offer.leadId) ?? [];
    list.push(offer);
    byLeadOffer.set(offer.leadId, list);
  }
  const leadIds = [...new Set([...byLeadAppt.keys(), ...byLeadOffer.keys()])];

  const leads: RawLead[] = [];
  const projects: RawProject[] = [];
  const invoices: RawFactuur[] = [];
  let invoicesOk = true;

  for (const ids of chunk(leadIds, 150)) {
    const [leadRes, projectRes, factuurRes] = await Promise.all([
      sb
        .from("leads")
        .select("id, lead_number, naam, status, bron, adviseur_id")
        .in("id", ids),
      sb
        .from("projecten")
        .select(
          "lead_id, offerte_id, status, installatie_voltooid_at, projectkosten, betaalwijze, bel_schouw_aanbetaling_at"
        )
        .in("lead_id", ids),
      sb
        .from("facturen")
        .select(
          "lead_id, offerte_id, status, omschrijving, factuurdatum, vervaldatum, bedrag_inc_btw, betaald_op, credit_van_factuur_id, bunq_payment_id"
        )
        .in("lead_id", ids),
    ]);
    if (leadRes.error) throw new Error(leadRes.error.message);
    if (projectRes.error) {
      const msg = projectRes.error.message || "";
      if (
        projectRes.error.code === "42703" ||
        msg.includes("bel_schouw_aanbetaling_at")
      ) {
        const retry = await sb
          .from("projecten")
          .select(
            "lead_id, offerte_id, status, installatie_voltooid_at, projectkosten, betaalwijze"
          )
          .in("lead_id", ids);
        if (retry.error) warnings.push("Projecten konden niet geladen worden.");
        else {
          for (const row of retry.data || []) {
            projects.push({
              leadId: String(row.lead_id),
              offerteId: (row.offerte_id as string | null) ?? null,
              status: String(row.status || ""),
              installatieVoltooidAt:
                (row.installatie_voltooid_at as string | null) ?? null,
              projectkosten: num(row.projectkosten),
              betaalwijze: (row.betaalwijze as string | null) ?? null,
              belSchouwAanbetalingAt: null,
            });
          }
        }
      } else {
        warnings.push("Projecten konden niet geladen worden.");
      }
    } else {
      for (const row of projectRes.data || []) {
        projects.push({
          leadId: String(row.lead_id),
          offerteId: (row.offerte_id as string | null) ?? null,
          status: String(row.status || ""),
          installatieVoltooidAt: (row.installatie_voltooid_at as string | null) ?? null,
          projectkosten: num(row.projectkosten),
          betaalwijze: (row.betaalwijze as string | null) ?? null,
          belSchouwAanbetalingAt:
            (row.bel_schouw_aanbetaling_at as string | null) ?? null,
        });
      }
    }
    if (factuurRes.error) {
      const msg = factuurRes.error.message || "";
      if (factuurRes.error.code === "42703" || msg.includes("bunq_payment_id")) {
        const retry = await sb
          .from("facturen")
          .select(
            "lead_id, offerte_id, status, omschrijving, factuurdatum, vervaldatum, bedrag_inc_btw, betaald_op, credit_van_factuur_id"
          )
          .in("lead_id", ids);
        if (retry.error) {
          invoicesOk = false;
          warnings.push("Facturen konden niet geladen worden.");
        } else {
          for (const row of retry.data || []) {
            invoices.push({
              leadId: String(row.lead_id),
              offerteId: (row.offerte_id as string | null) ?? null,
              status: String(row.status || ""),
              inc: num(row.bedrag_inc_btw),
              betaaldOp: (row.betaald_op as string | null) ?? null,
              creditOf: (row.credit_van_factuur_id as string | null) ?? null,
              bunq: false,
              omschrijving: (row.omschrijving as string | null) ?? null,
              factuurdatum: (row.factuurdatum as string | null) ?? null,
              vervaldatum: (row.vervaldatum as string | null) ?? null,
            });
          }
        }
      } else {
        invoicesOk = false;
        warnings.push("Facturen konden niet geladen worden.");
      }
    } else {
      for (const row of factuurRes.data || []) {
        invoices.push({
          leadId: String(row.lead_id),
          offerteId: (row.offerte_id as string | null) ?? null,
          status: String(row.status || ""),
          inc: num(row.bedrag_inc_btw),
          betaaldOp: (row.betaald_op as string | null) ?? null,
          creditOf: (row.credit_van_factuur_id as string | null) ?? null,
          bunq: row.bunq_payment_id != null,
          omschrijving: (row.omschrijving as string | null) ?? null,
          factuurdatum: (row.factuurdatum as string | null) ?? null,
          vervaldatum: (row.vervaldatum as string | null) ?? null,
        });
      }
    }
    for (const row of leadRes.data || []) {
      leads.push({
        id: String(row.id),
        leadNumber: String(row.lead_number || row.id),
        naam: String(row.naam || "Lead"),
        status: String(row.status || ""),
        bron: (row.bron as string | null) ?? null,
        adviseurId:
          row.adviseur_id == null ? null : String(row.adviseur_id),
      });
    }
  }

  // Fallback: bel-moment uit actie-events als projectkolom ontbreekt/leeg is.
  const missingBelLeadIds = [
    ...new Set(
      projects
        .filter((p) => !p.belSchouwAanbetalingAt)
        .map((p) => p.leadId)
    ),
  ];
  if (missingBelLeadIds.length > 0) {
    const belByLead = new Map<string, string>();
    for (const ids of chunk(missingBelLeadIds, 150)) {
      const belRes = await sb
        .from("backoffice_actie_events")
        .select("lead_id, completed_at")
        .eq("soort", "bel_schouw_aanbetaling")
        .not("completed_at", "is", null)
        .in("lead_id", ids);
      if (belRes.error) break;
      for (const row of belRes.data || []) {
        const leadId = String(row.lead_id);
        const at = row.completed_at as string | null;
        if (!at) continue;
        const prev = belByLead.get(leadId);
        if (!prev || at < prev) belByLead.set(leadId, at);
      }
    }
    if (belByLead.size > 0) {
      for (const project of projects) {
        if (project.belSchouwAanbetalingAt) continue;
        const at = belByLead.get(project.leadId);
        if (at) project.belSchouwAanbetalingAt = at;
      }
    }
  }

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const projectsByLead = new Map<string, RawProject[]>();
  for (const project of projects) {
    const list = projectsByLead.get(project.leadId) ?? [];
    list.push(project);
    projectsByLead.set(project.leadId, list);
  }
  const invoicesByLead = new Map<string, RawFactuur[]>();
  for (const invoice of invoices) {
    const list = invoicesByLead.get(invoice.leadId) ?? [];
    list.push(invoice);
    invoicesByLead.set(invoice.leadId, list);
  }

  const dossiers: Dossier[] = [];
  for (const id of leadIds) {
    const found = leadById.get(id);
    if (!found) continue;
    const appts = byLeadAppt.get(id) ?? [];
    const dossier = classifyLead({
      lead: found,
      appointments: appts,
      offers: byLeadOffer.get(id) ?? [],
      projects: projectsByLead.get(id) ?? [],
      invoices: invoicesOk ? invoicesByLead.get(id) ?? [] : [],
      commissiePct: 0,
      todayYmd: opts.todayYmd,
    });
    if (dossier.adviseurId && dossier.stand === "sale" && dossier.signedEx > 0) {
      const pct = commissie.get(dossier.adviseurId) ?? 0;
      dossier.commissiePct = pct;
      dossier.marginEx = round2(dossier.signedEx - (dossier.signedEx * pct) / 100 - dossier.projectkosten);
    }
    dossiers.push(dossier);
  }

  const filtered = applyFilters(dossiers, opts.filters, advisorMap);
  const excludedUnattributed =
    opts.filters.advisorIds.length > 0
      ? dossiers.filter(
          (row) =>
            row.attribution === "onzeker" &&
            (ymdInRange(row.assignmentYmd, opts.range) ||
              (row.gelopen && ymdInRange(row.conversationYmd, opts.range)) ||
              ymdInRange(row.signedYmd, opts.range))
        ).length
      : dossiers.filter(
          (row) =>
            row.attribution === "onzeker" &&
            (ymdInRange(row.assignmentYmd, opts.range) ||
              ymdInRange(row.signedYmd, opts.range))
        ).length;
  const primary = totalsFor(filtered.rows, opts.range);
  const compare = opts.compare ? totalsFor(filtered.rows, opts.compare) : null;
  const trends = trendFor(filtered.rows, opts.range, opts.group);
  const people = advisorRows(filtered.rows, opts.range, advisorMap).map((row) => {
    const dates = filtered.rows
      .filter((d) => d.adviseurId === row.id && d.assignmentYmd)
      .map((d) => d.assignmentYmd!);
    return { ...row, weeksActive: weeksActiveApprox(dates, opts.todayYmd) };
  });
  people.sort((a, b) => b.signedEx - a.signedEx || b.gelopen - a.gelopen || a.naam.localeCompare(b.naam, "nl"));

  const focused = opts.focus
    ? filtered.rows.filter((row) => matchesFocus(row, opts.focus!, opts.range))
    : opts.includePeriodRows
      ? filtered.rows.filter((row) => inSelectedPeriod(row, opts.range))
      : [];
  const pageSize = Math.min(20000, Math.max(1, opts.pageSize));
  const page = Math.max(1, opts.page);
  const start = (page - 1) * pageSize;
  const dossierPage = focused.slice(start, start + pageSize).map((row) => toPublicDossier(row, advisorMap));

  const availability = await loadAvailability(sb, advisors, opts.todayYmd);
  const afboeken = openCheckout(appointments, filtered.rows, opts.todayYmd, advisorMap);
  const targetPeople = [
    ...new Map(
      [
        ...advisors.filter((a) => isPlanbaarAdviseur(a)).map((a) => ({ id: a.id, naam: a.naam })),
        ...people.map((p) => ({ id: p.id, naam: p.naam })),
      ].map((p) => [p.id, p])
    ).values(),
  ];
  const targets = await loadTargets(sb, targetPeople, filtered.rows, opts.range, opts.todayYmd);

  const currentWeek = weekRangeContaining(opts.todayYmd);
  const weekAnchor = opts.weekAnchorYmd || opts.todayYmd;
  const selectedWeek = weekRangeContaining(weekAnchor);
  const leadStatusById = new Map(leads.map((l) => [l.id, l.status]));

  const trendRange =
    opts.trendRange && opts.trendRange.from <= opts.trendRange.to
      ? opts.trendRange
      : presetRange("d90", new Date(`${opts.todayYmd}T12:00:00`));
  const trendGroup: GroupBy =
    opts.trendGroup || defaultGroupBy(trendRange);

  const capacityFrom = trendRange.from < selectedWeek.from ? trendRange.from : selectedWeek.from;
  const capacityTo = trendRange.to > selectedWeek.to ? trendRange.to : selectedWeek.to;
  const capacity = await loadAvailableBlocksByYmd(sb, advisors, {
    from: capacityFrom,
    to: capacityTo,
  });

  // Capaciteitsgemiddelden: alleen planbare adviseurs mét minstens één afspraak in de week.
  const advisorsWithWeekAppts = new Set<string>();
  for (const appt of appointments) {
    if (!appt.adviseurId) continue;
    const ymd = isoToYmd(appt.startAt);
    if (ymd == null || !ymdInRange(ymd, selectedWeek)) continue;
    advisorsWithWeekAppts.add(appt.adviseurId);
  }
  const weekCapacityAdvisors = advisors.filter(
    (a) => isPlanbaarAdviseur(a) && advisorsWithWeekAppts.has(a.id)
  );
  const weekCapacity =
    weekCapacityAdvisors.length > 0
      ? await loadAvailableBlocksByYmd(sb, weekCapacityAdvisors, {
          from: selectedWeek.from,
          to: selectedWeek.to,
        })
      : { byYmd: new Map<string, number>(), headcount: 0 };

  let selectedBlocksTotal = 0;
  let dayCursor = selectedWeek.from;
  while (dayCursor <= selectedWeek.to) {
    selectedBlocksTotal += weekCapacity.byYmd.get(dayCursor) || 0;
    dayCursor = addYmd(dayCursor, 1);
  }

  const weekOverview = buildWeekOverview({
    dossiers,
    appointments,
    leadStatusById,
    appointmentsByLead: byLeadAppt,
    week: selectedWeek,
    todayYmd: opts.todayYmd,
    label: formatRangeLabel({ from: selectedWeek.from, to: selectedWeek.to }),
    isCurrent: selectedWeek.key === currentWeek.key,
    availableBlocksTotal: selectedBlocksTotal,
    planbaarAdvisors: weekCapacity.headcount,
  });

  const dayYmd =
    opts.dayAnchorYmd && isYmd(opts.dayAnchorYmd)
      ? opts.dayAnchorYmd
      : opts.todayYmd;
  const dayLeadIds = [
    ...new Set(
      appointments
        .filter((a) => {
          if (a.status === "geannuleerd" || a.status === "verzet") return false;
          const ymd = isoToYmd(a.startAt);
          return ymd === dayYmd;
        })
        .map((a) => a.leadId)
    ),
  ];
  const offerFlagsByLead = await loadOfferFlagsByLead(
    sb,
    dayLeadIds,
    dayYmd
  ).catch(
    () =>
      new Map<string, { created: boolean; sent: boolean; signed: boolean }>()
  );
  const leadMetaById = new Map(
    leads.map((l) => [l.id, { leadNumber: l.leadNumber, naam: l.naam }])
  );
  const dayOverview = buildDayOverview({
    // Zelfde scope als agenda-kolommen: sales-adviseurs (ook inactief),
    // geen bel-accounts / admin-systeemaccount.
    advisors: advisors.filter(
      (a) => isAgendaAdviseur(a) && !isAdminAdviseur(a)
    ),
    dossiers,
    appointments,
    offers,
    leadMetaById,
    offerFlagsByLead,
    dayYmd,
    todayYmd: opts.todayYmd,
  });

  const belClaims = await loadWallBelCallers(sb).catch((err) => {
    console.warn("wall bel callers:", err);
    return [] as WallClaimRow[];
  });
  const weekBel = await loadWeekBelWallKpis(
    sb,
    selectedWeek,
    appointments,
    advisors
  ).catch(() => ({
    gebeld: 0,
    belIngepland: 0,
    belConversiePct: null as number | null,
  }));
  const leadsToday = await loadLeadsCreatedOnDay(sb, dayYmd).catch((err) => {
    console.warn("wall leads today:", err);
    return 0;
  });
  const weekLeaderboard = buildWeekLeaderboard({
    advisors: advisors.filter((a) => isPlanbaarAdviseur(a)),
    dossiers,
    appointments,
    leadStatusById,
    appointmentsByLead: byLeadAppt,
    week: selectedWeek,
    todayYmd: opts.todayYmd,
  });
  const advisorsById = new Map(
    advisors.map((a) => [a.id, { naam: a.naam, rol: a.rol }] as const)
  );
  const wallActivity = await loadWallActivity(sb, {
    ymd: dayYmd,
    appointments,
    advisorsById,
    leadMetaById,
  }).catch((err) => {
    console.warn("wall activity:", err);
    return [] as WallActivityEvent[];
  });
  const wallboard = buildWallboard({
    day: dayOverview,
    appointments,
    claims: belClaims,
    advisorsById,
    leadMetaById,
    week: weekOverview,
    weekLeaderboard,
    belConversiePct: weekBel.belConversiePct,
    gebeld: weekBel.gebeld,
    belIngepland: weekBel.belIngepland,
    leadsToday,
    activity: wallActivity,
  });

  const qualityRange = opts.qualityRange || {
    from: selectedWeek.from,
    to: selectedWeek.to,
  };
  const salesQuality = buildSalesQuality({
    advisors: advisors.filter(
      (a) => isAgendaAdviseur(a) && !isAdminAdviseur(a)
    ),
    dossiers,
    projects,
    range: qualityRange,
  });

  const trendAdvisorIds = [
    ...new Set((opts.trendAdvisorIds || []).map((id) => id.trim()).filter(Boolean)),
  ];
  const trendAdvisorSet = new Set(trendAdvisorIds);
  const trendDossiers =
    trendAdvisorSet.size > 0
      ? dossiers.filter(
          (d) => d.adviseurId != null && trendAdvisorSet.has(d.adviseurId)
        )
      : dossiers;
  const trendAppointments =
    trendAdvisorSet.size > 0
      ? appointments.filter(
          (a) => a.adviseurId != null && trendAdvisorSet.has(a.adviseurId)
        )
      : appointments;
  let trendBlocksByYmd = capacity.byYmd;
  if (trendAdvisorSet.size > 0) {
    const trendCapacity = await loadAvailableBlocksByYmd(
      sb,
      advisors.filter((a) => trendAdvisorSet.has(a.id)),
      { from: capacityFrom, to: capacityTo }
    );
    trendBlocksByYmd = trendCapacity.byYmd;
  }
  const weekTrend = buildTrendSeries({
    dossiers: trendDossiers,
    appointments: trendAppointments,
    leadStatusById,
    appointmentsByLead: byLeadAppt,
    range: trendRange,
    group: trendGroup,
    selectedWeekKey: selectedWeek.key,
    todayYmd: opts.todayYmd,
    blocksByYmd: trendBlocksByYmd,
  });

  const bronnen = [...new Set(dossiers.map((d) => d.bron).filter(Boolean) as string[])].sort((a, b) =>
    a.localeCompare(b, "nl")
  );

  return {
    ok: true as const,
    generatedAt: new Date().toISOString(),
    warnings,
    paymentsAvailable: invoicesOk,
    range: { ...opts.range, label: formatRangeLabel(opts.range), days: inclusive(opts.range) },
    compare: opts.compare
      ? {
          ...opts.compare,
          label: formatRangeLabel(opts.compare),
          days: inclusive(opts.compare),
          equalLength: rangesEqualLength(opts.range, opts.compare),
        }
      : null,
    perDay: perDay(primary, opts.range),
    comparePerDay: opts.compare ? perDay(compare!, opts.compare) : null,
    group: opts.group,
    primary,
    payments: signedPaymentView(filtered.rows, opts.range),
    compareTotals: compare,
    trends,
    advisors: people,
    excludedUnattributed,
    focus: opts.focus,
    dossiers: dossierPage,
    dossierTotal: focused.length,
    page,
    pageSize,
    availability,
    afboeken,
    targets,
    weekOverview,
    dayOverview,
    wallboard,
    weekLeaderboard,
    weekTrend,
    salesQuality,
    trend: {
      from: trendRange.from,
      to: trendRange.to,
      label: formatRangeLabel(trendRange),
      group: trendGroup,
      advisorIds: trendAdvisorIds,
    },
    options: {
      advisors: advisors
        .filter((a) => isPlanbaarAdviseur(a) || people.some((p) => p.id === a.id))
        .map((a) => ({ id: a.id, naam: a.naam, actief: a.actief })),
      bronnen,
      planners: advisors.map((a) => ({ id: a.id, naam: a.naam })),
    },
  };
}

function inclusive(range: DateRange): number {
  return daysInclusive(range.from, range.to);
}

function toPublicDossier(row: Dossier, advisors: Map<string, { naam: string }>) {
  return {
    leadId: row.leadId,
    leadNumber: row.leadNumber,
    naam: row.naam,
    bron: row.bron,
    status: row.status,
    adviseurId: row.adviseurId,
    adviseurNaam: row.adviseurId ? advisors.get(row.adviseurId)?.naam || "Onbekend" : "Niet toerekenbaar",
    attribution: row.attribution,
    financiering: row.financiering,
    assignmentYmd: row.assignmentYmd,
    conversationYmd: row.conversationYmd,
    gelopen: row.gelopen,
    gelopenBenadering: row.gelopenBenadering,
    stand: row.stand,
    bezoek: row.bezoek,
    vervolgYmd: row.vervolgYmd,
    signedYmd: row.signedYmd,
    signedEx: row.signedEx,
    extraOrders: row.extraOrders,
    depositNone: row.depositNone,
    depositMet: row.depositMet,
    depositYmd: row.depositYmd,
    depositDateQuality: row.depositDateQuality,
    payDays: row.payDays,
    timelyKnown: row.timelyKnown,
    depositClockStartYmd: row.depositClockStartYmd,
    depositPayDeadlineYmd: row.depositPayDeadlineYmd,
    timelyDepositKnown: row.timelyDepositKnown,
    inTerm: row.inTerm,
    openOver7: row.openOver7,
    cancelled: row.cancelled,
    conflict: row.conflict,
    netto: row.netto,
    nettoYmd: row.nettoYmd,
    marginEx: row.marginEx,
  };
}

function openCheckout(
  appointments: RawAppt[],
  rows: Dossier[],
  today: string,
  advisors: Map<string, { naam: string }>
) {
  const byLead = new Map(rows.map((r) => [r.leadId, r]));
  const followAfter = new Map<string, RawAppt[]>();
  for (const appt of appointments) {
    if (appt.status === "geannuleerd") continue;
    const soort = appt.soort || "nieuw";
    if (soort !== "vervolg_fysiek" && soort !== "vervolg_tel" && soort !== "vervolg_punt") continue;
    const list = followAfter.get(appt.leadId) ?? [];
    list.push(appt);
    followAfter.set(appt.leadId, list);
  }

  const open: {
    id: string;
    leadId: string;
    leadNumber: string;
    naam: string;
    adviseur: string;
    startAt: string;
    soort: string | null;
  }[] = [];
  let older = 0;

  for (const appt of appointments) {
    if (appt.status === "geannuleerd") continue;
    const soort = appt.soort || "nieuw";
    if (!["nieuw", "vervolg_fysiek", "vervolg_tel", "vervolg_punt"].includes(soort)) continue;
    const ymd = isoToYmd(appt.startAt);
    if (!ymd || ymd > today) continue;
    const dossier = byLead.get(appt.leadId);
    if (!dossier) continue;
    const laterFollow = (followAfter.get(appt.leadId) ?? []).some((f) => f.startAt > appt.startAt);
    const closed =
      dossier?.stand === "sale" ||
      dossier?.stand === "afgeboekt" ||
      (dossier?.stand === "open_vervolg" && laterFollow);
    if (closed) continue;
    if (ymd === today) {
      open.push({
        id: appt.id,
        leadId: appt.leadId,
        leadNumber: dossier?.leadNumber || appt.leadId,
        naam: dossier?.naam || "Lead",
        adviseur: appt.adviseurId ? advisors.get(appt.adviseurId)?.naam || "Onbekend" : "Onbekend",
        startAt: appt.startAt,
        soort: appt.soort,
      });
    } else older += 1;
  }

  return {
    measurablePunctuality: false as const,
    note: "Er is geen afboektijd per afspraak. Automatisch voltooid telt niet als afboeken. Daarom geen punctualiteitspercentage.",
    todayOpen: open,
    olderOpen: older,
  };
}

/**
 * Niet-geblokkeerde tijdblokken per kalenderdag voor planbare adviseurs.
 * Geboekte afspraken trekken geen capaciteit af (zelfde definitie als loadAvailability).
 */
async function loadAvailableBlocksByYmd(
  sb: SupabaseClient,
  advisors: {
    id: string;
    naam: string;
    actief: boolean;
    rol: string | null;
    email: string | null;
    startdatum: string | null;
  }[],
  range: DateRange
): Promise<{ byYmd: Map<string, number>; headcount: number }> {
  const byYmd = new Map<string, number>();
  const planbaar = advisors.filter((a) => isPlanbaarAdviseur(a));
  const headcount = planbaar.length;
  if (range.from > range.to || headcount === 0) {
    return { byYmd, headcount };
  }

  const ids = planbaar.map((a) => a.id);
  const jaren = [
    ...new Set([Number(range.from.slice(0, 4)), Number(range.to.slice(0, 4))]),
  ];

  try {
    const [blocked, open, ...unavailableSets] = await Promise.all([
      loadAfblokkingen(sb, {
        adviseurIds: ids,
        van: range.from,
        tot: range.to,
      }),
      loadSlotVrijgaven(sb, {
        adviseurIds: ids,
        van: range.from,
        tot: range.to,
      }),
      ...planbaar.map((adv) => loadUnavailableWeekKeys(sb, adv.id, jaren)),
    ]);

    let day = range.from;
    while (day <= range.to) {
      const weekKey = weekRangeContaining(day).key;
      let total = 0;
      planbaar.forEach((adv, index) => {
        if (unavailableSets[index]?.has(weekKey)) return;
        for (const hour of ADVISEUR_SLOT_HOURS) {
          const noon = new Date(`${day}T12:00:00.000Z`);
          if (isBeforeStartdatum(noon, adv.startdatum)) continue;
          if (isSlotGeblokkeerd(adv.id, day, hour, blocked, open)) continue;
          total += 1;
        }
      });
      byYmd.set(day, total);
      day = addYmd(day, 1);
    }
    return { byYmd, headcount };
  } catch {
    return { byYmd, headcount };
  }
}

async function loadAvailability(
  sb: SupabaseClient,
  advisors: {
    id: string;
    naam: string;
    actief: boolean;
    rol: string | null;
    email: string | null;
    startdatum: string | null;
  }[],
  today: string
) {
  const planbaar = advisors.filter((a) => isPlanbaarAdviseur(a));
  const weeks = upcomingWeeks(new Date());
  const van = weeks[0]!.from;
  const tot = weeks[1]!.to;
  const ids = planbaar.map((a) => a.id);
  const jaren = [...new Set(weeks.flatMap((w) => [Number(w.from.slice(0, 4)), Number(w.to.slice(0, 4))]))];
  let blocked = new Set<string>();
  let open = new Set<string>();
  const unavailable = new Map<string, Set<string>>();
  try {
    const [b, v] = await Promise.all([
      loadAfblokkingen(sb, { adviseurIds: ids, van, tot }),
      loadSlotVrijgaven(sb, { adviseurIds: ids, van, tot }),
    ]);
    blocked = b;
    open = v;
    for (const adv of planbaar) {
      unavailable.set(adv.id, await loadUnavailableWeekKeys(sb, adv.id, jaren));
    }
  } catch {
    return {
      available: false,
      note: "Beschikbaarheid kon niet geladen worden.",
      norm: NORM_BLOCKS,
      weeks: [],
    };
  }

  const weekRows = weeks.map((week) => {
    const people = planbaar.map((adv) => {
      let blocks = 0;
      let day = week.from;
      const closedWeek = unavailable.get(adv.id);
      while (day <= week.to) {
        if (closedWeek?.has(week.key)) {
          day = addYmd(day, 1);
          continue;
        }
        for (const hour of ADVISEUR_SLOT_HOURS) {
          const noon = new Date(`${day}T12:00:00.000Z`);
          if (isBeforeStartdatum(noon, adv.startdatum)) continue;
          if (isSlotGeblokkeerd(adv.id, day, hour, blocked, open)) continue;
          blocks += 1;
        }
        day = addYmd(day, 1);
      }
      return { id: adv.id, naam: adv.naam, blocks, meetsNorm: blocks >= NORM_BLOCKS };
    });
    const total = people.reduce((s, p) => s + p.blocks, 0);
    const meeting = people.filter((p) => p.meetsNorm).length;
    return {
      ...week,
      people: people.sort((a, b) => b.blocks - a.blocks || a.naam.localeCompare(b.naam, "nl")),
      total,
      average: people.length ? Math.round((total / people.length) * 10) / 10 : null,
      meetingNorm: meeting,
      headcount: people.length,
    };
  });

  return {
    available: true,
    historical: false,
    note: "Alleen de actuele agenda. Geboekte blokken blijven capaciteit. Zaterdag telt mee, zondag is standaard dicht. Er is geen historie van blokkades.",
    norm: NORM_BLOCKS,
    weeks: weekRows,
    today,
  };
}

async function loadTargets(
  sb: SupabaseClient,
  people: { id: string; naam: string }[],
  rows: Dossier[],
  range: DateRange,
  today: string
) {
  const weeks = weekOverlaps(range);
  const { data, error } = await sb
    .from("sales_cockpit_weektargets")
    .select("adviseur_id, week_key, gelopen_doel, deals_doel, conversie_doel, updated_at, updated_by");
  if (error) {
    const missing =
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      (error.message || "").includes("sales_cockpit_weektargets");
    return {
      available: false,
      missing,
      note: missing
        ? "Weektargets zijn nog niet beschikbaar. Voer het migratiebestand uit; er wordt niets automatisch gewijzigd."
        : "Weektargets konden niet geladen worden.",
      weeks: weeks.map((w) => ({ ...w, rows: [] })),
      today,
    };
  }

  const stored = new Map<string, {
    gelopen: number | null;
    deals: number | null;
    conversie: number | null;
    updatedAt: string | null;
  }>();
  for (const row of data || []) {
    stored.set(`${row.adviseur_id}:${row.week_key}`, {
      gelopen: row.gelopen_doel == null ? null : Number(row.gelopen_doel),
      deals: row.deals_doel == null ? null : Number(row.deals_doel),
      conversie: row.conversie_doel == null ? null : Number(row.conversie_doel),
      updatedAt: (row.updated_at as string | null) ?? null,
    });
  }

  return {
    available: true,
    missing: false,
    note: "Doelen horen bij een kalenderweek. Een vrije periode wordt niet naar rato verdeeld.",
    weeks: weeks.map((week) => ({
      ...week,
      rows: people.map((person) => {
        const goal = stored.get(`${person.id}:${week.key}`) ?? {
          gelopen: null,
          deals: null,
          conversie: null,
          updatedAt: null,
        };
        const weekRange = { from: week.from, to: week.to };
        const mine = rows.filter((r) => r.adviseurId === person.id);
        const realized = totalsFor(mine, weekRange);
        return {
          adviseurId: person.id,
          naam: person.naam,
          gelopenDoel: goal.gelopen,
          dealsDoel: goal.deals,
          conversieDoel: goal.conversie,
          updatedAt: goal.updatedAt,
          gelopen: realized.gelopen,
          deals: realized.signed,
          conversion: realized.conversion,
          warning: targetWarning(goal.gelopen, goal.deals, goal.conversie),
        };
      }),
    })),
    today,
  };
}

export function dossierCsv(rows: ReturnType<typeof toPublicDossier>[]): string {
  const header = [
    "leadnummer",
    "naam",
    "bron",
    "stand",
    "bezoek",
    "toewijzing",
    "gesprek",
    "ondertekend",
    "orderwaarde_ex",
    "aanbetaald",
    "betaaldagen",
    "geannuleerd",
    "netto",
    "toerekening",
  ];
  const lines = rows.map((row) =>
    [
      row.leadNumber,
      row.naam,
      row.bron ?? "",
      row.stand,
      row.bezoek,
      row.assignmentYmd ?? "",
      row.conversationYmd ?? "",
      row.signedYmd ?? "",
      String(row.signedEx),
      row.depositNone ? "geen" : row.depositMet ? "ja" : "nee",
      row.payDays == null ? "" : String(row.payDays),
      row.cancelled ? "ja" : "nee",
      row.netto ? row.nettoYmd ?? "ja" : "nee",
      row.attribution,
    ]
      .map(csvCell)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function dossiersForExport(
  sb: SupabaseClient,
  opts: {
    range: DateRange;
    filters: Filters;
    focus: Focus | null;
    todayYmd: string;
  }
) {
  const report = await buildSalesCockpitReport(sb, {
    range: opts.range,
    compare: null,
    group: "week",
    filters: opts.filters,
    focus: opts.focus,
    page: 1,
    pageSize: 20000,
    todayYmd: opts.todayYmd,
    includePeriodRows: opts.focus == null,
  });
  return report.dossiers;
}
