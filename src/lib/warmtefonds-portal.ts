/**
 * Helpers voor het Warmtefonds-portaal (accounts + portal token).
 */
import {
  aanbetalingVanOrder,
  isAanbetalingFactuurOmschrijving,
  isRestantFactuurOmschrijving,
} from "@/lib/aanbetaling";
import { normalizeHouseNumber, normalizePostcode } from "@/lib/postcode";
import type { FinancieringStatus } from "@/lib/financiering-status";
import {
  FINANCIERING_PIPELINE,
  FINANCIERING_STATUS_LABEL,
  FINANCIERING_STATUS_LABEL_KORT,
  isFinancieringStatus,
  normalizeFinancieringStatus,
} from "@/lib/financiering-status";
import { appBaseUrl } from "@/lib/email/postmark";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WarmtefondsOperator = {
  id: string;
  naam: string;
  email: string;
  telefoon: string | null;
  actief: boolean;
  portal_token: string;
  /** Vergoeding per aanvraag (opgeslagen incl. btw). Null = standaard €300 excl. */
  tarief_inc?: number | null;
};

export function warmtefondsLoginUrl(): string {
  return `${appBaseUrl()}/warmtefonds/login`;
}

/** Welkomstmail met e-mail + tijdelijk wachtwoord. */
export async function verstuurWarmtefondsAccountInvite(opts: {
  naam: string;
  email: string;
  password: string;
}): Promise<{ ok: boolean; error?: string }> {
  const email = opts.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "E-mail ontbreekt" };
  try {
    const { sendEmail } = await import("@/lib/email/postmark");
    const { warmtefondsWelkomEmail } = await import("@/lib/email/templates");
    await sendEmail({
      to: email,
      subject: "Je Warmtefonds-account — Batterijconcept",
      html: warmtefondsWelkomEmail({
        naam: opts.naam,
        email,
        password: opts.password,
        loginUrl: warmtefondsLoginUrl(),
      }),
      tag: "warmtefonds-account-welkom",
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Mail versturen mislukt",
    };
  }
}

export const WF_PORTAL_STATUSES: FinancieringStatus[] = [
  ...FINANCIERING_PIPELINE,
  "afgewezen",
];

export function wfPortalStatusLabel(status: string | null | undefined): string {
  const n = normalizeFinancieringStatus(status);
  if (n) return FINANCIERING_STATUS_LABEL[n];
  if (status && isFinancieringStatus(status)) {
    return FINANCIERING_STATUS_LABEL[status];
  }
  return "Nog niet gestart";
}

export function wfPortalStatusLabelKort(
  status: string | null | undefined
): string {
  const n = normalizeFinancieringStatus(status);
  if (n) return FINANCIERING_STATUS_LABEL_KORT[n];
  return "Nog niet gestart";
}

export function wfPortalStatusOptions(): {
  value: FinancieringStatus;
  label: string;
}[] {
  return [
    ...FINANCIERING_PIPELINE.map((s) => ({
      value: s,
      label: FINANCIERING_STATUS_LABEL[s],
    })),
    { value: "afgewezen", label: FINANCIERING_STATUS_LABEL.afgewezen },
  ];
}

export function wfPortalOpenRank(status: string | null | undefined): number {
  const n = normalizeFinancieringStatus(status);
  if (!n) return 0;
  if (n === "afgewezen") return 90;
  const idx = FINANCIERING_PIPELINE.indexOf(n);
  return idx >= 0 ? idx + 1 : 50;
}

export async function resolveWarmtefondsOperator(
  sb: SupabaseClient,
  token: string
): Promise<WarmtefondsOperator | null> {
  if (!token || token.length < 16) return null;
  let { data, error } = await sb
    .from("warmtefonds_operators")
    .select("id, naam, email, telefoon, actief, portal_token, tarief_inc")
    .eq("portal_token", token)
    .maybeSingle();
  if (
    error &&
    (error.message?.includes("tarief_inc") || error.code === "42703")
  ) {
    ({ data, error } = await sb
      .from("warmtefonds_operators")
      .select("id, naam, email, telefoon, actief, portal_token")
      .eq("portal_token", token)
      .maybeSingle());
  }
  if (error || !data || !data.actief) return null;
  const row = data as WarmtefondsOperator;
  return {
    ...row,
    tarief_inc:
      row.tarief_inc != null && Number.isFinite(Number(row.tarief_inc))
        ? Number(row.tarief_inc)
        : null,
  };
}

/**
 * Zorg dat er een Warmtefonds-operator bestaat voor deze persoon
 * (bij aanmaken/wijzigen adviseur met rol=warmtefonds).
 */
export async function ensureWarmtefondsOperatorForPerson(
  sb: SupabaseClient,
  opts: {
    naam: string;
    email: string;
    telefoon?: string | null;
  }
): Promise<WarmtefondsOperator | null> {
  const naam = opts.naam.trim();
  const email = opts.email.trim().toLowerCase();
  if (!naam || !email) return null;

  const { data: existing } = await sb
    .from("warmtefonds_operators")
    .select("id, naam, email, telefoon, actief, portal_token")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    const { data: updated } = await sb
      .from("warmtefonds_operators")
      .update({
        naam,
        telefoon: opts.telefoon?.trim() || existing.telefoon || null,
        actief: true,
      })
      .eq("id", existing.id)
      .select("id, naam, email, telefoon, actief, portal_token")
      .single();
    return (updated || existing) as WarmtefondsOperator;
  }

  const { randomBytes } = await import("crypto");
  const { generatePassword, hashPassword } = await import("@/lib/auth-password");
  const portal_token = randomBytes(24).toString("hex");
  const password = generatePassword(12);
  const insertRow: Record<string, unknown> = {
    naam,
    email,
    telefoon: opts.telefoon?.trim() || null,
    portal_token,
    actief: true,
    password_hash: hashPassword(password),
  };
  let { data, error } = await sb
    .from("warmtefonds_operators")
    .insert(insertRow)
    .select("id, naam, email, telefoon, actief, portal_token")
    .single();
  if (
    error &&
    (error.code === "42703" || error.message?.includes("password_hash"))
  ) {
    delete insertRow.password_hash;
    ({ data, error } = await sb
      .from("warmtefonds_operators")
      .insert(insertRow)
      .select("id, naam, email, telefoon, actief, portal_token")
      .single());
  }
  if (error || !data) {
    console.error("ensureWarmtefondsOperatorForPerson:", error?.message);
    return null;
  }
  if (insertRow.password_hash) {
    void verstuurWarmtefondsAccountInvite({ naam, email, password });
  }
  return data as WarmtefondsOperator;
}

/** Projecten die in het Warmtefonds-portaal horen. */
export const WF_PORTAL_PROJECT_SELECT = `
  id, project_nummer, titel, status, betaalwijze, lead_id, offerte_id,
  financiering_status, warmtefonds_afspraak_at, warmtefonds_aangevraagd_at,
  warmtefonds_contact_pogingen, warmtefonds_notities, notities,
  backoffice_notitie, hold_sales_deadline_at, created_at, updated_at,
  leads(
    id, naam, email, telefoon, lead_number,
    postcode, huisnummer, toevoeging, straat, plaats, notities,
    adviseur_id, adviseurs!adviseur_id(id, naam)
  ),
  offertes(
    id, offerte_nummer, status, ondertekend_op, financiering_voorbehoud,
    subtotaal_ex_btw, btw_bedrag, totaal_inc_btw,
    aanbetaling_modus, aanbetaling_bedrag_inc, aanbetaling_te_innen_inc
  )
`;

/** Zonder optionele WF-kolommen (vóór migraties). */
export const WF_PORTAL_PROJECT_SELECT_MIN = `
  id, project_nummer, titel, status, betaalwijze, lead_id, offerte_id,
  financiering_status, warmtefonds_afspraak_at,
  notities, created_at, updated_at,
  leads(
    id, naam, email, telefoon, lead_number,
    postcode, huisnummer, toevoeging, straat, plaats, notities,
    adviseur_id, adviseurs!adviseur_id(id, naam)
  ),
  offertes(
    id, offerte_nummer, status, ondertekend_op, financiering_voorbehoud,
    subtotaal_ex_btw, btw_bedrag, totaal_inc_btw,
    aanbetaling_modus, aanbetaling_bedrag_inc, aanbetaling_te_innen_inc
  )
`;

export type WarmtefondsPortalBedragen = {
  totaalInc: number | null;
  /** Aanbetaling = BTW van de batterij. */
  aanbetalingInc: number | null;
  /** Te financieren via WF: order − BTW-aanbetaling (niet het € 8.500-plafond). */
  teFinancierenInc: number | null;
  /** Alias van teFinancierenInc voor bestaande UI. */
  warmtefondsInc: number | null;
  offerteGetekend: boolean;
};

type OfferteBedragBron = {
  status?: string | null;
  subtotaal_ex_btw?: number | null;
  btw_bedrag?: number | null;
  totaal_inc_btw?: number | null;
  aanbetaling_modus?: string | null;
  aanbetaling_bedrag_inc?: number | null;
  aanbetaling_te_innen_inc?: number | null;
};

/** Orderbedrag, aanbetaling en het deel dat via Warmtefonds loopt. */
export function warmtefondsPortalBedragen(
  offertes: OfferteBedragBron | OfferteBedragBron[] | null | undefined
): WarmtefondsPortalBedragen {
  const off = Array.isArray(offertes) ? offertes[0] : offertes;
  const leeg: WarmtefondsPortalBedragen = {
    totaalInc: null,
    aanbetalingInc: null,
    teFinancierenInc: null,
    warmtefondsInc: null,
    offerteGetekend: false,
  };
  if (!off) return leeg;
  const offerteGetekend = off.status === "ondertekend";
  const heeftBedrag =
    off.subtotaal_ex_btw != null || off.totaal_inc_btw != null;
  if (!heeftBedrag) {
    return {
      ...leeg,
      offerteGetekend,
      aanbetalingInc: off.aanbetaling_te_innen_inc ?? null,
    };
  }
  const a = aanbetalingVanOrder({
    subtotaalExBtw: Number(off.subtotaal_ex_btw) || 0,
    btwBedrag: off.btw_bedrag ?? undefined,
    totaalIncBtw: off.totaal_inc_btw ?? undefined,
    modus: off.aanbetaling_modus,
    handmatigIncBtw: off.aanbetaling_bedrag_inc,
    financieringVoorbehoud: true,
  });
  const aanbetalingInc = off.aanbetaling_te_innen_inc ?? a.bedragIncBtw;
  const teFinancierenInc = a.restantIncBtw;
  return {
    totaalInc: a.orderIncBtw,
    aanbetalingInc,
    teFinancierenInc,
    warmtefondsInc: teFinancierenInc,
    offerteGetekend,
  };
}

export function withPortalBedragen<T extends { offertes?: unknown }>(
  order: T
): T & { bedragen: WarmtefondsPortalBedragen } {
  return {
    ...order,
    bedragen: warmtefondsPortalBedragen(
      order.offertes as OfferteBedragBron | OfferteBedragBron[] | null
    ),
  };
}

const DOORGESTUURD_STATUS = new Set([
  "doorgestuurd_naar_edwin",
  "afspraak_ingepland",
]);

/** Eerste moment dat de aanvraag op Doorgestuurd naar Edwin stond. */
export async function doorgestuurdAtVoorProjecten(
  sb: SupabaseClient,
  orders: { id: string; lead_id?: string | null }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const leadIds = [
    ...new Set(
      orders
        .map((o) => o.lead_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (leadIds.length === 0) return out;
  const orderIds = new Set(orders.map((o) => o.id));
  const events: { created_at?: string | null; meta?: unknown }[] = [];
  for (let i = 0; i < leadIds.length; i += 80) {
    const { data, error } = await sb
      .from("lead_events")
      .select("created_at, meta")
      .in("lead_id", leadIds.slice(i, i + 80))
      .eq("soort", "status")
      .limit(2000);
    if (error) return out;
    events.push(...(data || []));
  }
  for (const ev of events) {
    const meta = ev.meta as { naar?: unknown; project_id?: unknown } | null;
    const naar = typeof meta?.naar === "string" ? meta.naar : "";
    if (!DOORGESTUURD_STATUS.has(naar)) continue;
    const pid = typeof meta?.project_id === "string" ? meta.project_id : "";
    const at = ev.created_at;
    if (!pid || !at || !orderIds.has(pid)) continue;
    const prev = out.get(pid);
    if (!prev || new Date(at).getTime() < new Date(prev).getTime()) {
      out.set(pid, at);
    }
  }
  return out;
}

export function isMissingWfProjectColumn(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    /warmtefonds_aangevraagd_at/i.test(msg) ||
    /warmtefonds_notities/i.test(msg) ||
    /warmtefonds_afspraak_at/i.test(msg) ||
    /warmtefonds_contact_pogingen/i.test(msg) ||
    /backoffice_notitie/i.test(msg) ||
    /hold_sales_deadline_at/i.test(msg) ||
    /financiering_status/i.test(msg) ||
    /schema cache/i.test(msg) ||
    /does not exist/i.test(msg)
  );
}

/** Hold / annulering — hoort in archief, niet in de open werklijst. */
export function isWarmtefondsStopStatus(
  status: string | null | undefined
): boolean {
  const st = (status || "").toLowerCase();
  return (
    st === "annulering" ||
    st === "geannuleerd" ||
    st === "hold_sales_actie" ||
    st === "hold_sales"
  );
}

type WarmtefondsRelatedRow = {
  betaalwijze?: string | null;
  financiering_status?: string | null;
  warmtefonds_aangevraagd_at?: string | null;
};

/**
 * Pas in het WF-portaal nadat BO heeft doorgestuurd
 * (`financiering_status` in de pipeline). Alleen `betaalwijze=warmtefonds`
 * is niet genoeg. Eigen middelen nooit.
 */
export function isWarmtefondsRelatedProject(row: WarmtefondsRelatedRow): boolean {
  if (row.betaalwijze === "eigen_middelen") return false;
  if (row.betaalwijze && row.betaalwijze !== "warmtefonds") return false;
  const n = normalizeFinancieringStatus(row.financiering_status);
  if (n) return true;
  return Boolean(row.warmtefonds_aangevraagd_at);
}

/** Open werk in het Warmtefonds-portaal (geen hold/annulering). */
export function isWarmtefondsPortalProject(row: WarmtefondsRelatedRow & {
  status?: string | null;
}): boolean {
  if (isWarmtefondsStopStatus(row.status)) return false;
  return isWarmtefondsRelatedProject(row);
}

type PortalAdresLead = {
  postcode?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  telefoon?: string | null;
};

function leadVanPortalRow(row: { leads?: unknown }): PortalAdresLead | null {
  const raw = row.leads;
  if (!raw) return null;
  const lead = Array.isArray(raw) ? raw[0] : raw;
  return lead && typeof lead === "object" ? (lead as PortalAdresLead) : null;
}

/**
 * Zelfde woning = zelfde Warmtefonds-aanvraag.
 * Postcode + huisnummer + toevoeging; leeg adres wordt niet gegroepeerd.
 */
export function warmtefondsAdresSleutel(lead: {
  postcode?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
} | null | undefined): string | null {
  if (!lead) return null;
  const pc = normalizePostcode(lead.postcode || "");
  const nrRaw = String(lead.huisnummer || "").trim();
  if (!pc || pc.length < 4 || !nrRaw) return null;
  const nr = normalizeHouseNumber(nrRaw);
  if (!nr) return null;
  const toev = (lead.toevoeging || "").trim().toUpperCase().replace(/\s+/g, "");
  return `${pc}|${nr}|${toev}`;
}

export type WarmtefondsSamengevoegdProject = {
  id: string;
  project_nummer: string;
};

const AANBETALING_STATUS_RANK: Record<string, number> = {
  concept: 0,
  verzonden: 1,
  deels_betaald: 2,
  betaald: 3,
};

function pipelineRank(status: string | null | undefined): number {
  const n = normalizeFinancieringStatus(status);
  if (!n) return -1;
  if (n === "afgewezen") return FINANCIERING_PIPELINE.length + 1;
  const idx = FINANCIERING_PIPELINE.indexOf(n);
  return idx >= 0 ? idx : 0;
}

function earliestIso(
  values: (string | null | undefined)[]
): string | null {
  let best: string | null = null;
  let bestMs = Infinity;
  for (const v of values) {
    if (!v) continue;
    const ms = new Date(v).getTime();
    if (!Number.isFinite(ms) || ms >= bestMs) continue;
    bestMs = ms;
    best = v;
  }
  return best;
}

function sumNum(values: (number | null | undefined)[]): number | null {
  let sum = 0;
  let any = false;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    sum += v;
    any = true;
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

function slechtsteAanbetalingStatus(
  statuses: (string | null | undefined)[]
): string | null {
  let worst: string | null = null;
  let rank = 99;
  for (const s of statuses) {
    const key = (s || "").trim();
    const r = key ? (AANBETALING_STATUS_RANK[key] ?? 4) : 4;
    if (r < rank) {
      rank = r;
      worst = key || null;
    }
  }
  return worst;
}

function kiesTelefoon(leads: (PortalAdresLead | null)[]): string | null {
  const nums = leads
    .map((l) => (l?.telefoon || "").trim())
    .filter(Boolean);
  const intl = nums.find((n) => n.startsWith("+"));
  return intl || nums[0] || null;
}

export type WarmtefondsAdresMergeRow = {
  id: string;
  project_nummer?: string | null;
  financiering_status?: string | null;
  warmtefonds_afspraak_at?: string | null;
  warmtefonds_contact_pogingen?: number | null;
  doorgestuurd_at?: string | null;
  aanbetaling_factuur_status?: string | null;
  leads?: unknown;
  bedragen?: {
    totaalInc?: number | null;
    aanbetalingInc?: number | null;
    teFinancierenInc?: number | null;
    warmtefondsInc?: number | null;
    offerteGetekend?: boolean;
  } | null;
  samengevoegd?: WarmtefondsSamengevoegdProject[];
};

/**
 * Meerdere orders op hetzelfde adres → één Warmtefonds-aanvraag.
 * Te financieren = som van (order − BTW-aanbetaling) per batterij.
 */
export function mergeWarmtefondsAanvragenOpAdres<
  T extends WarmtefondsAdresMergeRow,
>(rows: T[]): T[] {
  const groepen = new Map<string, T[]>();
  const rest: T[] = [];
  for (const row of rows) {
    const key = warmtefondsAdresSleutel(leadVanPortalRow(row));
    if (!key) {
      rest.push(row);
      continue;
    }
    const g = groepen.get(key);
    if (g) g.push(row);
    else groepen.set(key, [row]);
  }

  const out: T[] = [...rest];
  for (const groep of groepen.values()) {
    if (groep.length === 1) {
      out.push(groep[0]!);
      continue;
    }
    const sorted = [...groep].sort((a, b) => {
      const pr = pipelineRank(b.financiering_status) - pipelineRank(a.financiering_status);
      if (pr !== 0) return pr;
      const aw = a.bedragen?.warmtefondsInc ?? 0;
      const bw = b.bedragen?.warmtefondsInc ?? 0;
      if (bw !== aw) return bw - aw;
      return String(a.project_nummer || "").localeCompare(
        String(b.project_nummer || ""),
        "nl"
      );
    });
    const primary = sorted[0]!;
    const teFinancierenSom = sumNum(
      sorted.map(
        (r) =>
          r.bedragen?.teFinancierenInc ?? r.bedragen?.warmtefondsInc ?? null
      )
    );
    const aanbetalingSom = sumNum(sorted.map((r) => r.bedragen?.aanbetalingInc));
    const totaalSom = sumNum(sorted.map((r) => r.bedragen?.totaalInc));
    const tel = kiesTelefoon(sorted.map(leadVanPortalRow));
    const primaryLead = leadVanPortalRow(primary);
    const leadsNext =
      tel && primaryLead && primaryLead.telefoon !== tel
        ? Array.isArray(primary.leads)
          ? [{ ...(primary.leads[0] as object), telefoon: tel }]
          : primary.leads && typeof primary.leads === "object"
            ? { ...(primary.leads as object), telefoon: tel }
            : primary.leads
        : primary.leads;

    out.push({
      ...primary,
      leads: leadsNext,
      doorgestuurd_at: earliestIso(sorted.map((r) => r.doorgestuurd_at)),
      warmtefonds_afspraak_at:
        earliestIso(sorted.map((r) => r.warmtefonds_afspraak_at)) ??
        primary.warmtefonds_afspraak_at,
      warmtefonds_contact_pogingen: Math.max(
        0,
        ...sorted.map((r) => Number(r.warmtefonds_contact_pogingen) || 0)
      ),
      aanbetaling_factuur_status: slechtsteAanbetalingStatus(
        sorted.map((r) => r.aanbetaling_factuur_status)
      ),
      bedragen: {
        ...(primary.bedragen || {}),
        totaalInc: totaalSom,
        aanbetalingInc: aanbetalingSom,
        teFinancierenInc: teFinancierenSom,
        warmtefondsInc: teFinancierenSom,
      },
      samengevoegd: sorted.map((r) => ({
        id: r.id,
        project_nummer: String(r.project_nummer || r.id),
      })),
    });
  }
  return out;
}

export type PortalBetalingKey =
  | "betaald"
  | "open"
  | "deels"
  | "geen"
  | "overig";

export type PortalBetalingSamenvatting = {
  key: PortalBetalingKey;
  label: string;
};

/** Samenvatting van factuurstatussen voor één project (geen credit/concept). */
export function betalingSamenvattingVanStatussen(
  statuses: Array<{ status?: string | null; isCredit?: boolean }>
): PortalBetalingSamenvatting {
  const relevant = statuses.filter(
    (f) => !f.isCredit && (f.status || "") !== "concept"
  );
  if (relevant.length === 0) {
    return { key: "geen", label: "Nog geen factuur" };
  }
  const open = relevant.filter(
    (f) => f.status === "verzonden" || f.status === "deels_betaald"
  );
  const betaald = relevant.filter((f) => f.status === "betaald");
  if (open.length === 0 && betaald.length === relevant.length) {
    return { key: "betaald", label: "Alles betaald" };
  }
  if (betaald.length > 0 && open.length > 0) {
    return {
      key: "deels",
      label: `${betaald.length} betaald · ${open.length} open`,
    };
  }
  if (open.length > 0) {
    return {
      key: "open",
      label:
        open.length === 1 ? "Factuur openstaand" : `${open.length} openstaand`,
    };
  }
  return { key: "overig", label: "Facturen aanwezig" };
}

export type PortalFactuurEnrichment = {
  betaling: PortalBetalingSamenvatting;
  /** Status van de aanbetalingsfactuur, of null als die er nog niet is. */
  aanbetalingFactuurStatus: string | null;
  /** Status van de WF-declaratie/restantfactuur, of null als die er nog niet is. */
  declaratieFactuurStatus: string | null;
};

/** Batch: betalingssamenvatting + declaratiefactuur-status per project_id. */
export async function betalingVoorProjecten(
  sb: SupabaseClient,
  projectIds: string[]
): Promise<Map<string, PortalFactuurEnrichment>> {
  const out = new Map<string, PortalFactuurEnrichment>();
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (ids.length === 0) return out;

  type FacLite = {
    project_id?: string | null;
    status?: string | null;
    omschrijving?: string | null;
    credit_van_factuur_id?: string | null;
    created_at?: string | null;
  };
  const rows: FacLite[] = [];

  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    const res = await sb
      .from("facturen")
      .select(
        "project_id, status, omschrijving, credit_van_factuur_id, created_at"
      )
      .in("project_id", slice);
    if (res.error) {
      if (
        res.error.message?.includes("credit_van_factuur_id") ||
        res.error.message?.includes("omschrijving")
      ) {
        const plain = await sb
          .from("facturen")
          .select("project_id, status, omschrijving, created_at")
          .in("project_id", slice);
        if (plain.error) {
          const bare = await sb
            .from("facturen")
            .select("project_id, status")
            .in("project_id", slice);
          if (bare.error) continue;
          rows.push(...((bare.data || []) as FacLite[]));
          continue;
        }
        rows.push(...((plain.data || []) as FacLite[]));
        continue;
      }
      continue;
    }
    rows.push(...((res.data || []) as FacLite[]));
  }

  const byProject = new Map<string, FacLite[]>();
  for (const id of ids) byProject.set(id, []);
  for (const f of rows) {
    const pid = f.project_id;
    if (!pid || !byProject.has(pid)) continue;
    byProject.get(pid)!.push(f);
  }

  for (const [pid, list] of byProject) {
    const betaling = betalingSamenvattingVanStatussen(
      list.map((f) => ({
        status: f.status,
        isCredit: Boolean(f.credit_van_factuur_id),
      }))
    );
    const byNewest = (a: FacLite, b: FacLite) => {
      const at = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bt - at;
    };
    const aanbetalingen = list
      .filter(
        (f) =>
          !f.credit_van_factuur_id &&
          isAanbetalingFactuurOmschrijving(f.omschrijving) &&
          !isRestantFactuurOmschrijving(f.omschrijving)
      )
      .sort(byNewest);
    const restanten = list
      .filter(
        (f) =>
          !f.credit_van_factuur_id &&
          isRestantFactuurOmschrijving(f.omschrijving)
      )
      .sort(byNewest);
    out.set(pid, {
      betaling,
      aanbetalingFactuurStatus: aanbetalingen[0]?.status?.trim() || null,
      declaratieFactuurStatus: restanten[0]?.status?.trim() || null,
    });
  }
  return out;
}
