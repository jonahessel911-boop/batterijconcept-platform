/**
 * Helpers voor het Warmtefonds-portaal (externe operator, magic token).
 */
import { aanbetalingVanOrder } from "@/lib/aanbetaling";
import type { FinancieringStatus } from "@/lib/financiering-status";
import {
  FINANCIERING_PIPELINE,
  FINANCIERING_STATUS_LABEL,
  FINANCIERING_STATUS_LABEL_KORT,
  isFinancieringStatus,
  normalizeFinancieringStatus,
} from "@/lib/financiering-status";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WarmtefondsOperator = {
  id: string;
  naam: string;
  email: string;
  telefoon: string | null;
  actief: boolean;
  portal_token: string;
  /** Vergoeding per aanvraag incl. btw. Null = globaal Edergy-tarief. */
  tarief_inc?: number | null;
};

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

/** Projecten die in het Warmtefonds-portaal horen. */
export const WF_PORTAL_PROJECT_SELECT = `
  id, project_nummer, titel, status, betaalwijze, lead_id, offerte_id,
  financiering_status, warmtefonds_afspraak_at, warmtefonds_aangevraagd_at,
  warmtefonds_contact_pogingen, warmtefonds_notities, notities, created_at, updated_at,
  leads(
    id, naam, email, telefoon, lead_number,
    postcode, huisnummer, toevoeging, straat, plaats, notities
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
    postcode, huisnummer, toevoeging, straat, plaats, notities
  ),
  offertes(
    id, offerte_nummer, status, ondertekend_op, financiering_voorbehoud,
    subtotaal_ex_btw, btw_bedrag, totaal_inc_btw,
    aanbetaling_modus, aanbetaling_bedrag_inc, aanbetaling_te_innen_inc
  )
`;

export type WarmtefondsPortalBedragen = {
  totaalInc: number | null;
  aanbetalingInc: number | null;
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
  return {
    totaalInc: a.orderIncBtw,
    aanbetalingInc: off.aanbetaling_te_innen_inc ?? a.bedragIncBtw,
    warmtefondsInc: a.warmtefondsIncBtw,
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
    /financiering_status/i.test(msg) ||
    /schema cache/i.test(msg) ||
    /does not exist/i.test(msg)
  );
}

export function isWarmtefondsPortalProject(row: {
  betaalwijze?: string | null;
  financiering_status?: string | null;
  status?: string | null;
}): boolean {
  const st = (row.status || "").toLowerCase();
  if (st === "annulering" || st === "geannuleerd" || st === "hold_sales_actie" || st === "hold_sales") {
    return false;
  }
  if (row.betaalwijze === "warmtefonds") return true;
  if (row.financiering_status) return true;
  return false;
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

/** Batch: betalingssamenvatting per project_id. */
export async function betalingVoorProjecten(
  sb: SupabaseClient,
  projectIds: string[]
): Promise<Map<string, PortalBetalingSamenvatting>> {
  const out = new Map<string, PortalBetalingSamenvatting>();
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (ids.length === 0) return out;

  type FacLite = {
    project_id?: string | null;
    status?: string | null;
    credit_van_factuur_id?: string | null;
  };
  const rows: FacLite[] = [];

  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    const res = await sb
      .from("facturen")
      .select("project_id, status, credit_van_factuur_id")
      .in("project_id", slice);
    if (res.error) {
      if (res.error.message?.includes("credit_van_factuur_id")) {
        const plain = await sb
          .from("facturen")
          .select("project_id, status")
          .in("project_id", slice);
        if (plain.error) continue;
        rows.push(...((plain.data || []) as FacLite[]));
        continue;
      }
      continue;
    }
    rows.push(...((res.data || []) as FacLite[]));
  }

  const byProject = new Map<
    string,
    Array<{ status?: string | null; isCredit?: boolean }>
  >();
  for (const id of ids) byProject.set(id, []);
  for (const f of rows) {
    const pid = f.project_id;
    if (!pid || !byProject.has(pid)) continue;
    byProject.get(pid)!.push({
      status: f.status,
      isCredit: Boolean(f.credit_van_factuur_id),
    });
  }

  for (const [pid, list] of byProject) {
    out.set(pid, betalingSamenvattingVanStatussen(list));
  }
  return out;
}
