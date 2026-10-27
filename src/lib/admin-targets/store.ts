import {
  DEFAULT_TARGETS,
  type AdminTargetsStore,
  type PersonOverride,
  type TargetFieldKey,
  type TargetFields,
  type TargetRole,
} from "./types";

function numOr(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function normalizeFields(
  raw: unknown,
  base: TargetFields
): TargetFields {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const orders = numOr(o.orders, base.orders);
  let gemOrderwaarde: number;
  if ("gemOrderwaarde" in o) {
    gemOrderwaarde = numOr(o.gemOrderwaarde, base.gemOrderwaarde);
  } else {
    // Legacy: omzet was weektotaal — herleid AOV, maar nooit lager dan default
    const legacyOmzet = numOr(o.omzet, 0);
    const inferred = orders > 0 ? legacyOmzet / orders : 0;
    gemOrderwaarde = Math.max(inferred, base.gemOrderwaarde);
  }
  const merged = {
    leads: numOr(o.leads, base.leads),
    afsprakenGepland: numOr(o.afsprakenGepland, base.afsprakenGepland),
    leadToAppt: Math.min(100, numOr(o.leadToAppt, base.leadToAppt)),
    afspraakToSale: Math.min(100, numOr(o.afspraakToSale, base.afspraakToSale)),
    showRate: Math.min(100, numOr(o.showRate, base.showRate)),
    orders,
    gemOrderwaarde,
    omzet: numOr(o.omzet, base.omzet),
    installaties: numOr(o.installaties, base.installaties),
  };
  return withDerivedFunnelTargets(merged);
}

/** Sales-doel = closing-% × geplande afspraken (standaard 30%). */
export const DEFAULT_AFSPRAAK_TO_SALE_PCT = 30;

/**
 * Leads = afspraken ÷ (L2A/100)
 * Orders = afspraken × (afspraak→sale %/100)
 * Omzet = orders × gem. orderwaarde
 */

export function deriveFunnelFromInputs(input: {
  afsprakenGepland: number;
  leadToAppt: number;
  /** Closing % — bepaalt orders */
  afspraakToSale?: number;
  /** @deprecated Alleen fallback als afspraakToSale ontbreekt */
  orders?: number;
  gemOrderwaarde?: number;
}): { leads: number; orders: number; afspraakToSale: number; omzet: number } {
  const appt = Math.max(0, Number(input.afsprakenGepland) || 0);
  const l2a = Math.max(0, Math.min(100, Number(input.leadToAppt) || 0));
  const aov = Math.max(0, Number(input.gemOrderwaarde) || 0);
  let a2s = Number(input.afspraakToSale);
  if (!Number.isFinite(a2s) || a2s < 0) {
    const ord = Math.max(0, Number(input.orders) || 0);
    a2s =
      appt > 0
        ? Math.min(100, Math.round((ord / appt) * 1000) / 10)
        : DEFAULT_AFSPRAAK_TO_SALE_PCT;
  }
  a2s = Math.max(0, Math.min(100, a2s));
  const leads = l2a > 0 ? Math.ceil((appt * 100) / l2a) : 0;
  const orders = Math.round((appt * a2s) / 100);
  const omzet = Math.round(orders * aov * 100) / 100;
  return { leads, orders, afspraakToSale: a2s, omzet };
}

export function withDerivedFunnelTargets(fields: TargetFields): TargetFields {
  const derived = deriveFunnelFromInputs(fields);
  return {
    ...fields,
    leads: derived.leads,
    orders: derived.orders,
    afspraakToSale: derived.afspraakToSale,
    omzet: derived.omzet,
  };
}

function normalizeOverride(raw: unknown): PersonOverride {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: PersonOverride = {};
  const keys: TargetFieldKey[] = [
    "leads",
    "afsprakenGepland",
    "leadToAppt",
    "afspraakToSale",
    "showRate",
    "orders",
    "gemOrderwaarde",
    "omzet",
    "installaties",
  ];
  for (const k of keys) {
    if (k in o && o[k] !== "" && o[k] != null) {
      const n = Number(o[k]);
      if (Number.isFinite(n) && n >= 0) {
        const rate =
          k === "leadToAppt" || k === "afspraakToSale" || k === "showRate";
        out[k] = rate ? Math.min(100, n) : n;
      }
    }
  }
  // Legacy person override: alleen omzet (weektotaal) → gem. orderwaarde
  if (out.gemOrderwaarde == null && out.omzet != null && out.omzet > 0) {
    const ord = out.orders;
    if (ord != null && ord > 0) {
      out.gemOrderwaarde = Math.round((out.omzet / ord) * 100) / 100;
    } else {
      out.gemOrderwaarde = out.omzet;
    }
    delete out.omzet;
  }
  return out;
}

function emptyStore(): AdminTargetsStore {
  return {
    version: 1,
    defaults: {
      team: { ...DEFAULT_TARGETS.team },
      adviseur: { ...DEFAULT_TARGETS.adviseur },
      beller: { ...DEFAULT_TARGETS.beller },
      installateur: { ...DEFAULT_TARGETS.installateur },
    },
    personen: {},
    partners: {},
  };
}

/**
 * Parse JSONB `dashboard_v2_doelen` — ondersteunt nieuw Admin-formaat
 * én legacy `{ per_7_days: { leads, omzet, omzetPerAdviseur } }`.
 */
export function parseAdminTargetsStore(raw: unknown): AdminTargetsStore {
  const store = emptyStore();
  if (!raw || typeof raw !== "object") return store;
  const obj = raw as Record<string, unknown>;

  if (obj.version === 1 && obj.defaults && typeof obj.defaults === "object") {
    const d = obj.defaults as Record<string, unknown>;
    for (const role of ["team", "adviseur", "beller", "installateur"] as TargetRole[]) {
      store.defaults[role] = normalizeFields(d[role], DEFAULT_TARGETS[role]);
    }
    if (obj.personen && typeof obj.personen === "object") {
      for (const [id, v] of Object.entries(obj.personen as Record<string, unknown>)) {
        store.personen[id] = normalizeOverride(v);
      }
    }
    if (obj.partners && typeof obj.partners === "object") {
      for (const [id, v] of Object.entries(obj.partners as Record<string, unknown>)) {
        store.partners[id] = normalizeOverride(v);
      }
    }
    return store;
  }

  // Legacy Dashboard v2 weekdoelen
  const weekly =
    obj.per_7_days && typeof obj.per_7_days === "object"
      ? (obj.per_7_days as Record<string, unknown>)
      : obj.last_7_days && typeof obj.last_7_days === "object"
        ? (obj.last_7_days as Record<string, unknown>)
        : null;

  if (weekly) {
    store.defaults.team = normalizeFields(
      {
        leads: weekly.leads,
        afsprakenGepland: weekly.afsprakenGepland,
        leadToAppt: weekly.leadToAppt,
        orders: weekly.orders,
        omzet: weekly.omzet,
      },
      DEFAULT_TARGETS.team
    );
    const map = weekly.omzetPerAdviseur;
    if (map && typeof map === "object") {
      for (const [id, v] of Object.entries(map as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          // Legacy week-omzet → gem. orderwaarde (minstens default AOV)
          const orders = Math.max(DEFAULT_TARGETS.adviseur.orders, 1);
          store.personen[id] = {
            gemOrderwaarde: Math.max(
              Math.round((n / orders) * 100) / 100,
              DEFAULT_TARGETS.adviseur.gemOrderwaarde
            ),
          };
        }
      }
    }
  }

  return store;
}

export function mergeFields(
  base: TargetFields,
  override: PersonOverride | null | undefined
): TargetFields {
  const merged = !override
    ? { ...base }
    : {
        leads: override.leads ?? base.leads,
        afsprakenGepland: override.afsprakenGepland ?? base.afsprakenGepland,
        leadToAppt: override.leadToAppt ?? base.leadToAppt,
        afspraakToSale: override.afspraakToSale ?? base.afspraakToSale,
        showRate: override.showRate ?? base.showRate,
        orders: override.orders ?? base.orders,
        gemOrderwaarde: override.gemOrderwaarde ?? base.gemOrderwaarde,
        omzet: override.omzet ?? base.omzet,
        installaties: override.installaties ?? base.installaties,
      };
  return withDerivedFunnelTargets(merged);
}

export function resolvePersonTargets(
  store: AdminTargetsStore,
  rol: TargetRole,
  personId: string
): { effective: TargetFields; override: PersonOverride; usesDefault: boolean } {
  const base =
    rol === "team"
      ? store.defaults.team
      : store.defaults[rol] || DEFAULT_TARGETS[rol];
  const override = store.personen[personId] || {};
  const usesDefault = Object.keys(override).length === 0;
  return {
    effective: mergeFields(base, override),
    override,
    usesDefault,
  };
}

export function resolvePartnerTargets(
  store: AdminTargetsStore,
  partnerId: string
): { effective: TargetFields; override: PersonOverride; usesDefault: boolean } {
  const base = store.defaults.installateur;
  const override = store.partners[partnerId] || {};
  return {
    effective: mergeFields(base, override),
    override,
    usesDefault: Object.keys(override).length === 0,
  };
}

export function rolToTargetRole(
  rol: string | null | undefined
): TargetRole {
  const r = (rol || "adviseur").toLowerCase();
  if (r === "beller") return "beller";
  if (r === "installateur") return "installateur";
  if (r === "admin" || r === "backoffice") return "adviseur";
  return "adviseur";
}

/** Alleen echte sales-adviseurs (niet admin/backoffice) voor team-doelen. */
export function isSalesAdviseurRol(rol: string | null | undefined): boolean {
  return (rol || "").toLowerCase() === "adviseur";
}

export type TargetPersonRef = {
  id: string;
  rol?: string | null;
  actief?: boolean;
  /** Eerste werkdag yyyy-MM-dd — telt mee voor team-targets vanaf die dag */
  startdatum?: string | null;
};

export type TeamSnapshotOpts = {
  /** Alleen adviseurs die op/vóór deze dag gestart zijn (of geen startdatum) */
  asOfYmd?: string;
  /** Voor pro-rata: startdatum midden in periode → deel van weekdoel */
  periodStartYmd?: string;
  periodEndYmd?: string;
};

function ymdDaysInclusive(startYmd: string, endYmd: string): number {
  const a = Date.parse(`${startYmd}T12:00:00Z`);
  const b = Date.parse(`${endYmd}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * 0–1: welk deel van de periode (of full 1) telt deze adviseur mee.
 * Geen startdatum = volledig. Start na periodEnd/asOf = 0.
 * Start midden in periode = resterende dagen / periodeduur.
 */
export function personTargetWeight(
  startdatum: string | null | undefined,
  opts?: TeamSnapshotOpts
): number {
  const start = (startdatum || "").trim().slice(0, 10);
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return 1;

  const periodStart = opts?.periodStartYmd?.slice(0, 10);
  const periodEnd = opts?.periodEndYmd?.slice(0, 10);
  if (periodStart && periodEnd) {
    if (start > periodEnd) return 0;
    if (start <= periodStart) return 1;
    const total = ymdDaysInclusive(periodStart, periodEnd);
    const active = ymdDaysInclusive(start, periodEnd);
    if (total <= 0) return 0;
    return Math.max(0, Math.min(1, active / total));
  }

  const asOf = opts?.asOfYmd?.slice(0, 10);
  if (asOf && start > asOf) return 0;
  return 1;
}

/** Actieve sales-adviseurs voor team-vermenigvuldiging (orders/leads/omzet). */
export function salesPeopleForTeam(
  people: TargetPersonRef[],
  asOfYmd?: string
): TargetPersonRef[] {
  return people.filter((p) => {
    if (p.actief === false) return false;
    if (!isSalesAdviseurRol(p.rol)) return false;
    return personTargetWeight(p.startdatum, { asOfYmd }) > 0;
  });
}

/**
 * Team-doelen voor Dashboard v2 =
 * som van effectieve targets per actieve adviseur (volume),
 * percentages uit adviseur-standaard (niet × headcount).
 * Startdatum: toekomstige starters tellen niet mee; mid-periode pro-rata.
 */
export function teamWeeklySnapshot(
  store: AdminTargetsStore,
  people: TargetPersonRef[] = [],
  opts?: TeamSnapshotOpts
): {
  leads: number;
  afsprakenGepland: number;
  leadToAppt: number;
  afspraakToSale: number;
  orders: number;
  omzet: number;
  omzetPerAdviseur: Record<string, number>;
  adviseurCount: number;
} {
  const asOf =
    opts?.asOfYmd || opts?.periodEndYmd || undefined;
  const sales = salesPeopleForTeam(people, asOf);
  const rateBase = store.defaults.adviseur;
  const omzetPerAdviseur: Record<string, number> = {};

  let leads = 0;
  let afsprakenGepland = 0;
  let orders = 0;
  let omzet = 0;
  let weightSum = 0;

  if (sales.length === 0) {
    const t = store.defaults.team;
    const a = store.defaults.adviseur;
    return {
      leads: t.leads || a.leads,
      afsprakenGepland: t.afsprakenGepland || a.afsprakenGepland,
      leadToAppt: a.leadToAppt || t.leadToAppt,
      afspraakToSale: a.afspraakToSale || t.afspraakToSale,
      orders: t.orders || a.orders,
      omzet: t.omzet || a.omzet,
      omzetPerAdviseur: {},
      adviseurCount: 0,
    };
  }

  for (const p of sales) {
    const w = personTargetWeight(p.startdatum, opts);
    if (w <= 0) continue;
    weightSum += w;
    const { effective } = resolvePersonTargets(store, "adviseur", p.id);
    leads += effective.leads * w;
    afsprakenGepland += effective.afsprakenGepland * w;
    orders += effective.orders * w;
    omzet += effective.omzet * w;
    if (effective.omzet > 0) {
      omzetPerAdviseur[p.id] = Math.round(effective.omzet * w);
    }
  }

  return {
    leads: Math.round(leads),
    afsprakenGepland: Math.round(afsprakenGepland),
    leadToAppt: rateBase.leadToAppt,
    afspraakToSale: rateBase.afspraakToSale,
    orders: Math.round(orders),
    omzet: Math.round(omzet),
    omzetPerAdviseur,
    adviseurCount: Math.round(weightSum * 10) / 10,
  };
}

/** Volledige team TargetFields (incl. rates) voor Admin-preview. */
export function computeTeamDashboardTargets(
  store: AdminTargetsStore,
  people: TargetPersonRef[],
  opts?: TeamSnapshotOpts
): TargetFields {
  const snap = teamWeeklySnapshot(store, people, opts);
  const rates = store.defaults.adviseur;
  return {
    leads: snap.leads,
    afsprakenGepland: snap.afsprakenGepland,
    leadToAppt: rates.leadToAppt,
    afspraakToSale: rates.afspraakToSale,
    showRate: rates.showRate,
    orders: snap.orders,
    gemOrderwaarde: rates.gemOrderwaarde,
    omzet: snap.omzet,
    installaties: 0,
  };
}

/** Schrijf Admin-store; team-defaults + per_7_days = berekende team-snapshot. */
export function serializeAdminTargetsStore(
  store: AdminTargetsStore,
  people: TargetPersonRef[] = [],
  opts?: TeamSnapshotOpts
): Record<string, unknown> {
  const weekly = teamWeeklySnapshot(store, people, opts);
  const teamComputed = computeTeamDashboardTargets(store, people, opts);
  return {
    version: 1,
    defaults: {
      ...store.defaults,
      team: teamComputed,
    },
    personen: store.personen,
    partners: store.partners,
    per_7_days: {
      leads: weekly.leads,
      afsprakenGepland: weekly.afsprakenGepland,
      leadToAppt: weekly.leadToAppt,
      orders: weekly.orders,
      omzet: weekly.omzet,
      omzetPerAdviseur: weekly.omzetPerAdviseur,
    },
  };
}