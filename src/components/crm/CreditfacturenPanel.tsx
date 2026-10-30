"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Adviseur,
  AdviseurCreditFactuur,
  InstallatiePartner,
  PartnerCreditFactuur,
} from "@/types/database";
import { formatDateShort, formatEuro } from "@/lib/format";
import {
  VERKOPER_AANBETALING_FEE,
  creditWeekFromDate,
  previousCreditWeek,
  weekBeforePreviousCreditWeek,
} from "@/lib/adviseur-creditfactuur";
import { isUitgeslotenVanSalesCommissie } from "@/lib/rollen";
import type { ToekomstigeCreditfacturenPreview } from "@/lib/toekomstige-creditfacturen";

type MainTab = "concept_ab" | "te_betalen" | "betaald";
/** Unit-filter in de inbox (standaard Alles). */
type UnitFilter = "alles" | "sales" | "wf" | "installatie";
type CreateKind = "sales" | "wf" | "installatie";
/** Concept-tab: huidige ronde, 1 week vooruit (deze week → volgende wo), of alles. */
type WeekScope = "vorige" | "vooruit" | "alles";

type OverviewFactuur = AdviseurCreditFactuur & {
  adviseurs?: {
    id: string;
    naam: string;
    rol?: string | null;
    bedrijfsnaam?: string | null;
    kvk_nummer?: string | null;
    iban?: string | null;
    start_adres?: string | null;
  } | null;
};

type PartnerOverview = PartnerCreditFactuur & {
  installatie_partners?: {
    id: string;
    naam: string;
    bedrijfsnaam?: string | null;
    kvk_nummer?: string | null;
    iban?: string | null;
  } | null;
};

type InvoiceKind = "sales" | "wf" | "installatie";

type InboxRow = {
  key: string;
  source: "adviseur" | "partner";
  id: string;
  relatieId: string;
  relatieNaam: string;
  kvkOk: boolean;
  iban: string | null;
  bedrijfsnaam: string | null;
  nummer: string;
  kind: InvoiceKind;
  kindLabel: string;
  context: string | null;
  bedragEx: number;
  bedragInc: number;
  status: string;
  goedgekeurd_op: string | null;
  betaald_op: string | null;
  factuurdatum: string;
  weekJaar: number | null;
  weekNummer: number | null;
  searchText: string;
};

/** Eén uitbetalingsregel per relatie (sales én installatie). */
type PayoutGroup = {
  key: string;
  kind: "sales" | "installatie";
  relatieId: string;
  relatieNaam: string;
  bedrijfsnaam: string | null;
  iban: string | null;
  kvkOk: boolean;
  bedragEx: number;
  bedragInc: number;
  kenmerk: string;
  rows: InboxRow[];
  /** concept | verzonden | goedgekeurd | betaald | mixed | preview */
  status: string;
  /** Vooruitblik: nog geen (volledige) conceptfactuur — alleen preview. */
  preview?: boolean;
  previewOrders?: number;
};

function kvkIncompleet(r: {
  bedrijfsnaam?: string | null;
  kvk_nummer?: string | null;
  iban?: string | null;
  start_adres?: string | null;
}) {
  // Compleet ZZP óf (tijdelijk) startadres → mag bevestigen; adres gaat op PDF
  if (r.bedrijfsnaam && r.kvk_nummer && r.iban) return false;
  if (r.start_adres?.trim()) return false;
  return true;
}

function isWfTagged(opts: {
  nummer?: string | null;
  notities?: string | null;
  omschrijving?: string | null;
}): boolean {
  const blob = [opts.nummer, opts.notities, opts.omschrijving]
    .filter(Boolean)
    .join(" ");
  return /\/WF\//i.test(blob) || /\[WF\]/i.test(blob) || /\bWF\s*·/i.test(blob);
}

function parseKind(
  source: "adviseur" | "partner",
  nummer: string,
  meta?: { notities?: string | null; omschrijving?: string | null }
): { kind: InvoiceKind; label: string } {
  if (source === "partner") {
    return { kind: "installatie", label: "Installatie" };
  }
  if (isWfTagged({ nummer, ...meta })) {
    return { kind: "wf", label: "WF" };
  }
  if (/\/AANBETALING\//i.test(nummer)) {
    return { kind: "sales", label: "Sales · A" };
  }
  if (/\/RESTBETALING\//i.test(nummer)) {
    return { kind: "sales", label: "Sales · B" };
  }
  if (/^CF-\d{4}-W\d{2}-/i.test(nummer)) {
    return { kind: "sales", label: "Sales · week" };
  }
  return { kind: "sales", label: "Sales" };
}

function extractContext(opts: {
  notities?: string | null;
  omschrijving?: string | null;
  offerte_nummer?: string | null;
  project_nummer?: string | null;
}): string | null {
  const parts: string[] = [];
  if (opts.offerte_nummer) parts.push(`Offerte ${opts.offerte_nummer}`);
  if (opts.project_nummer) parts.push(`Project ${opts.project_nummer}`);
  const blob = [opts.omschrijving, opts.notities].filter(Boolean).join(" · ");
  if (blob) {
    const klant = /Klant\s+([^·|]+)/i.exec(blob);
    if (klant?.[1]?.trim() && !parts.some((p) => p.startsWith("Klant"))) {
      parts.unshift(`Klant ${klant[1].trim()}`);
    }
    if (!opts.offerte_nummer) {
      const off = /Offerte\s+([A-Z0-9\-_/]+)/i.exec(blob);
      if (off?.[1]) parts.push(`Offerte ${off[1]}`);
    }
    if (!opts.project_nummer) {
      const prj = /Project\s+([A-Z0-9\-_/]+)/i.exec(blob);
      if (prj?.[1]) parts.push(`Project ${prj[1]}`);
    }
  }
  return parts.length ? parts.join(" · ") : null;
}

function statusRank(status: string): number {
  switch (status) {
    case "concept":
      return 0;
    case "verzonden":
      return 1;
    case "goedgekeurd":
      return 2;
    case "betaald":
      return 3;
    default:
      return 9;
  }
}

function StatusBadge({
  status,
  goedgekeurd_op,
  betaald_op,
}: {
  status: string;
  goedgekeurd_op: string | null;
  betaald_op: string | null;
}) {
  if (status === "betaald") {
    return (
      <span
        className="inline-flex text-sm font-semibold text-green-dark"
        title={
          betaald_op
            ? `Betaald ${formatDateShort(betaald_op)}`
            : "Betaald"
        }
        aria-label="Betaald"
      >
        ✓
      </span>
    );
  }
  if (status === "goedgekeurd") {
    return (
      <span
        className="text-[11px] font-semibold text-green-dark"
        title={
          goedgekeurd_op
            ? `Te betalen sinds ${formatDateShort(goedgekeurd_op)}`
            : "Te betalen"
        }
      >
        Te betalen
      </span>
    );
  }
  if (status === "verzonden") {
    return (
      <span className="text-[11px] font-semibold text-[#854D0E]">
        Wacht op acceptatie
      </span>
    );
  }
  if (status === "concept") {
    return (
      <span className="text-[11px] font-semibold text-muted">Concept</span>
    );
  }
  return <span className="text-[11px] capitalize text-muted">{status}</span>;
}

function CopyMini({
  copied,
  onCopy,
}: {
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className="shrink-0 border border-line bg-white px-1 py-0 text-[9px] font-semibold leading-4 text-muted hover:bg-wash hover:text-ink"
      title={copied ? "Gekopieerd" : "Kopieer"}
    >
      {copied ? "✓" : "⎘"}
    </button>
  );
}

function KindBadge({ kind, label }: { kind: InvoiceKind; label: string }) {
  const cls =
    kind === "installatie"
      ? "border-green/25 bg-green-soft text-green-dark"
      : kind === "wf"
        ? "border-[#B7D9C4] bg-[#F4FBF7] text-[#0D5C32]"
        : "border-line bg-wash text-muted";
  return (
    <span
      className={`border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

export function CreditfacturenPanel({
  embedded = false,
}: {
  /** In Team-hub: iets compactere top (parent heeft al titel). */
  embedded?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<MainTab>("concept_ab");
  const [unitFilter, setUnitFilter] = useState<UnitFilter>("alles");
  /** Concepten: standaard vorige week (commissieronde). */
  const [weekScope, setWeekScope] = useState<WeekScope>("vorige");
  const vorigeWeek = useMemo(() => previousCreditWeek(), []);
  const weekDaarvoor = useMemo(() => weekBeforePreviousCreditWeek(), []);
  const huidigeWeek = useMemo(() => creditWeekFromDate(), []);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [allAdvFacturen, setAllAdvFacturen] = useState<OverviewFactuur[]>([]);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [allPartnerFacturen, setAllPartnerFacturen] = useState<
    PartnerOverview[]
  >([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [createKind, setCreateKind] = useState<CreateKind>("sales");
  const [createMode, setCreateMode] = useState<"handmatig" | "deal">(
    "handmatig"
  );
  const [createTranche, setCreateTranche] = useState<"a" | "b">("a");
  const [createAdviseurId, setCreateAdviseurId] = useState("");
  const [createPartnerId, setCreatePartnerId] = useState("");
  const [createBedrag, setCreateBedrag] = useState(
    String(VERKOPER_AANBETALING_FEE)
  );
  const [createOmschrijving, setCreateOmschrijving] = useState("");
  const [dealQuery, setDealQuery] = useState("");
  const [dealOptions, setDealOptions] = useState<
    {
      offerte_id: string;
      klant_naam: string;
      adviseur_id: string | null;
      adviseur_naam: string | null;
      offerte_nummer: string | null;
      bedrag_ex_btw: number;
      creditfactuur_id: string | null;
    }[]
  >([]);
  const [selectedOfferteId, setSelectedOfferteId] = useState("");
  const [dealsLoading, setDealsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [toekomstig, setToekomstig] =
    useState<ToekomstigeCreditfacturenPreview | null>(null);
  /** Alleen aanbetalingen van de huidige week → volgende woensdag. */
  const [toekomstigVooruit, setToekomstigVooruit] =
    useState<ToekomstigeCreditfacturenPreview | null>(null);
  const [creatingConcepts, setCreatingConcepts] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [advRes, partRes, toeRes, toeVooruitRes] = await Promise.all([
        fetch("/api/adviseurs/creditfacturen"),
        fetch("/api/partners/creditfacturen"),
        fetch("/api/adviseurs/creditfacturen/toekomstig"),
        fetch("/api/adviseurs/creditfacturen/toekomstig?mode=vooruit"),
      ]);
      const advData = await advRes.json().catch(() => ({}));
      const partData = await partRes.json().catch(() => ({}));
      const toeData = await toeRes.json().catch(() => ({}));
      const toeVooruitData = await toeVooruitRes.json().catch(() => ({}));
      if (!advRes.ok) {
        throw new Error(
          (advData as { error?: string }).error || "Adviseurs laden mislukt"
        );
      }
      if (!partRes.ok) {
        throw new Error(
          (partData as { error?: string }).error || "Partners laden mislukt"
        );
      }
      if (toeRes.ok) {
        setToekomstig(toeData as ToekomstigeCreditfacturenPreview);
      } else {
        setToekomstig(null);
      }
      if (toeVooruitRes.ok) {
        setToekomstigVooruit(
          toeVooruitData as ToekomstigeCreditfacturenPreview
        );
      } else {
        setToekomstigVooruit(null);
      }
      setAllAdvFacturen(
        ((advData as { facturen?: OverviewFactuur[] }).facturen ||
          []) as OverviewFactuur[]
      );
      setAdviseurs(
        ((advData as { adviseurs?: Adviseur[] }).adviseurs || []) as Adviseur[]
      );
      setAllPartnerFacturen(
        ((partData as { facturen?: PartnerOverview[] }).facturen ||
          []) as PartnerOverview[]
      );
      setPartners(
        ((partData as { partners?: InstallatiePartner[] }).partners ||
          []) as InstallatiePartner[]
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /** Eenmalig: ontbrekende sales-concepten (vorige week + week ervoor) aanmaken. */
  const autoConceptsDone = useRef(false);
  useEffect(() => {
    if (loading || autoConceptsDone.current) return;
    const n = toekomstig?.totals.nieuw ?? 0;
    if (n <= 0) return;
    autoConceptsDone.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/adviseurs/creditfacturen/toekomstig", {
          method: "POST",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const created = Number((json as { created?: number }).created || 0);
        if (created > 0) {
          setOkMsg(
            `${created} sales-concept${created === 1 ? "" : "en"} klaargezet (W${weekDaarvoor.week}+W${vorigeWeek.week}).`
          );
          await loadAll();
        }
      } catch {
        /* stil — handmatige knop blijft beschikbaar */
      }
    })();
  }, [loading, toekomstig, loadAll, weekDaarvoor.week, vorigeWeek.week]);

  const loadDeals = useCallback(async (q: string) => {
    setDealsLoading(true);
    try {
      const sp = new URLSearchParams({ status: "alles" });
      if (q.trim()) sp.set("q", q.trim());
      const res = await fetch(`/api/netto-boord?${sp.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Deals laden mislukt"
        );
      }
      const items = (
        (data as {
          items?: {
            offerte_id: string;
            klant_naam: string;
            adviseur_id: string | null;
            adviseur_naam: string | null;
            offerte_nummer: string | null;
            bedrag_ex_btw: number;
            creditfactuur_id: string | null;
            geannuleerd?: boolean;
          }[];
        }).items || []
      ).filter((r) => !r.geannuleerd);
      setDealOptions(items.slice(0, 40));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deals laden mislukt");
    } finally {
      setDealsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showCreate || createKind !== "sales" || createMode !== "deal") {
      return;
    }
    const t = setTimeout(() => void loadDeals(dealQuery), 200);
    return () => clearTimeout(t);
  }, [showCreate, createKind, createMode, dealQuery, loadDeals]);

  const rows = useMemo((): InboxRow[] => {
    const out: InboxRow[] = [];

    for (const f of allAdvFacturen) {
      if (f.status === "geannuleerd") continue;
      if (f.adviseurs && isUitgeslotenVanSalesCommissie(f.adviseurs)) continue;
      const { kind, label } = parseKind("adviseur", f.factuur_nummer, {
        notities: f.notities,
      });
      const naam = f.adviseurs?.naam || "Onbekend";
      const context = extractContext({ notities: f.notities });
      out.push({
        key: `a:${f.id}`,
        source: "adviseur",
        id: f.id,
        relatieId: f.adviseur_id,
        relatieNaam: naam,
        kvkOk: !kvkIncompleet(f.adviseurs || {}),
        iban: f.adviseurs?.iban?.trim() || null,
        bedrijfsnaam: f.adviseurs?.bedrijfsnaam?.trim() || null,
        nummer: f.factuur_nummer,
        kind,
        kindLabel: label,
        context,
        bedragEx: Number(f.bedrag_ex_btw || 0),
        bedragInc: Number(f.bedrag_inc_btw || 0),
        status: f.status,
        goedgekeurd_op: f.goedgekeurd_op ?? null,
        betaald_op: f.betaald_op ?? null,
        factuurdatum: f.factuurdatum,
        weekJaar: f.week_jaar ?? null,
        weekNummer: f.week_nummer ?? null,
        searchText: [naam, f.factuur_nummer, f.notities, context, label]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      });
    }

    for (const f of allPartnerFacturen) {
      if (f.status === "geannuleerd") continue;
      const { kind, label } = parseKind("partner", f.factuur_nummer, {
        notities: f.notities,
        omschrijving: f.omschrijving,
      });
      const naam = f.installatie_partners?.naam || "Onbekend";
      const context = extractContext({
        notities: f.notities,
        omschrijving: f.omschrijving,
        offerte_nummer: f.offerte_nummer,
        project_nummer: f.project_nummer,
      });
      out.push({
        key: `p:${f.id}`,
        source: "partner",
        id: f.id,
        relatieId: f.partner_id,
        relatieNaam: naam,
        kvkOk: !kvkIncompleet(f.installatie_partners || {}),
        iban: f.installatie_partners?.iban?.trim() || null,
        bedrijfsnaam: f.installatie_partners?.bedrijfsnaam?.trim() || null,
        nummer: f.factuur_nummer,
        kind,
        kindLabel: label,
        context,
        bedragEx: Number(f.bedrag_ex_btw || 0),
        bedragInc: Number(f.bedrag_inc_btw || 0),
        status: f.status,
        goedgekeurd_op: f.goedgekeurd_op ?? null,
        betaald_op: f.betaald_op ?? null,
        factuurdatum: f.factuurdatum,
        weekJaar: f.week_jaar ?? null,
        weekNummer: f.week_nummer ?? null,
        searchText: [
          naam,
          f.factuur_nummer,
          f.notities,
          f.omschrijving,
          f.offerte_nummer,
          f.project_nummer,
          context,
          label,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      });
    }

    out.sort((a, b) => {
      const sr = statusRank(a.status) - statusRank(b.status);
      if (sr !== 0) return sr;
      return (b.factuurdatum || "").localeCompare(a.factuurdatum || "");
    });
    return out;
  }, [allAdvFacturen, allPartnerFacturen]);

  /** Vorige week + openstaande concepten van eerdere weken (nog niet betaald). */
  const inUitbetalingsronde = (r: InboxRow) => {
    if (r.weekJaar == null || r.weekNummer == null) return true;
    if (r.weekJaar === vorigeWeek.jaar && r.weekNummer === vorigeWeek.week) {
      return true;
    }
    // Oudere open concepten meenemen (bijv. Manting W42 → deze ronde)
    if (r.weekJaar < vorigeWeek.jaar) return true;
    if (r.weekJaar === vorigeWeek.jaar && r.weekNummer < vorigeWeek.week) {
      return true;
    }
    return false;
  };

  /** Concepten die bij de huidige ISO-week horen (1 week vooruit). */
  const inVooruitWeek = (r: InboxRow) => {
    const w = toekomstigVooruit?.week ?? huidigeWeek;
    if (r.weekJaar == null || r.weekNummer == null) return false;
    return r.weekJaar === w.jaar && r.weekNummer === w.week;
  };

  const tabCounts = useMemo(() => {
    const conceptAb = rows.filter((r) => {
      if (r.status !== "concept" && r.status !== "verzonden") return false;
      if (weekScope === "vorige" && !inUitbetalingsronde(r)) return false;
      if (weekScope === "vooruit" && !inVooruitWeek(r)) return false;
      return true;
    });
    const teBetalen = rows.filter((r) => r.status === "goedgekeurd");
    const betaald = rows.filter((r) => r.status === "betaald");
    const previewEuro =
      weekScope === "vooruit" && toekomstigVooruit
        ? toekomstigVooruit.totals.bedragExBtw
        : 0;
    return {
      concept_ab:
        weekScope === "vooruit" && toekomstigVooruit
          ? Math.max(conceptAb.length, toekomstigVooruit.perAdviseur.length)
          : conceptAb.length,
      te_betalen: teBetalen.length,
      betaald: betaald.length,
      conceptEuro:
        weekScope === "vooruit" && toekomstigVooruit
          ? previewEuro
          : conceptAb.reduce((s, r) => s + r.bedragEx, 0),
      teBetalenEuro: teBetalen.reduce((s, r) => s + r.bedragEx, 0),
    };
  }, [
    rows,
    weekScope,
    vorigeWeek.jaar,
    vorigeWeek.week,
    toekomstigVooruit,
    huidigeWeek.jaar,
    huidigeWeek.week,
  ]);

  const q = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (unitFilter !== "alles" && r.kind !== unitFilter) return false;

      if (tab === "concept_ab") {
        if (r.status !== "concept" && r.status !== "verzonden") return false;
        if (weekScope === "vorige" && !inUitbetalingsronde(r)) return false;
        if (weekScope === "vooruit") {
          // Vooruitblik: sales-concepten van de aankomende week; installatie niet
          if (r.kind === "installatie") return false;
          if (r.kind === "sales" && !inVooruitWeek(r)) return false;
        }
      } else if (tab === "te_betalen") {
        if (r.status !== "goedgekeurd") return false;
      } else if (tab === "betaald") {
        if (r.status !== "betaald") return false;
      }

      if (
        q &&
        !r.searchText.includes(q) &&
        !r.relatieNaam.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [
    rows,
    unitFilter,
    tab,
    q,
    weekScope,
    vorigeWeek.jaar,
    vorigeWeek.week,
    toekomstigVooruit,
    huidigeWeek.jaar,
    huidigeWeek.week,
  ]);

  const salesAdviseurs = useMemo(
    () => adviseurs.filter((a) => !isUitgeslotenVanSalesCommissie(a)),
    [adviseurs]
  );

  function payoutKenmerk(
    kind: "sales" | "installatie",
    list: InboxRow[]
  ): string {
    const prefix = kind === "sales" ? "betaalcommissie" : "installatie";
    const weeks = [
      ...new Set(
        list
          .map((r) => r.weekNummer)
          .filter((w): w is number => w != null)
      ),
    ].sort((a, b) => a - b);
    if (weeks.length === 0) {
      if (kind === "installatie" && list.length === 1) return list[0].nummer;
      if (kind === "installatie") return `${prefix} ${list.length}×`;
      return `${prefix} W${vorigeWeek.week}`;
    }
    if (weeks.length === 1) return `${prefix} W${weeks[0]}`;
    return `${prefix} W${weeks[0]}+W${weeks[weeks.length - 1]}`;
  }

  function buildPayoutGroups(
    kind: "sales" | "installatie",
    list: InboxRow[]
  ): PayoutGroup[] {
    const byPerson = new Map<string, InboxRow[]>();
    for (const r of list) {
      const cur = byPerson.get(r.relatieId) || [];
      cur.push(r);
      byPerson.set(r.relatieId, cur);
    }
    const groups: PayoutGroup[] = [];
    for (const [relatieId, personRows] of byPerson) {
      const first = personRows[0];
      const statuses = [...new Set(personRows.map((r) => r.status))];
      groups.push({
        key: `${kind}:${relatieId}`,
        kind,
        relatieId,
        relatieNaam: first.relatieNaam,
        bedrijfsnaam: first.bedrijfsnaam,
        iban: first.iban,
        kvkOk: personRows.every((r) => r.kvkOk),
        bedragEx: personRows.reduce((s, r) => s + r.bedragEx, 0),
        bedragInc: personRows.reduce((s, r) => s + r.bedragInc, 0),
        kenmerk: payoutKenmerk(kind, personRows),
        rows: personRows,
        status: statuses.length === 1 ? statuses[0] : "mixed",
      });
    }
    groups.sort((a, b) => a.relatieNaam.localeCompare(b.relatieNaam, "nl"));
    return groups;
  }

  const salesPayoutGroups = useMemo(() => {
    const fromFacturen = buildPayoutGroups(
      "sales",
      filtered.filter((r) => r.kind === "sales")
    );
    if (weekScope !== "vooruit" || !toekomstigVooruit) return fromFacturen;

    // 1 week vooruit: merge bestaande concepten + preview uit aanbetalingen deze week
    const byId = new Map(fromFacturen.map((g) => [g.relatieId, g]));
    const weekLabel = toekomstigVooruit.week.week;
    const kenmerk = `betaalcommissie W${weekLabel}`;
    const needle = q;

    for (const p of toekomstigVooruit.perAdviseur) {
      if (
        needle &&
        !p.naam.toLowerCase().includes(needle) &&
        !p.id.toLowerCase().includes(needle)
      ) {
        continue;
      }
      const existing = byId.get(p.id);
      if (existing) {
        // Concepten bestaan al — toon factuurbedrag; vul aan als preview hoger is
        if (p.bedragExBtw > existing.bedragEx) {
          byId.set(p.id, {
            ...existing,
            bedragEx: p.bedragExBtw,
            bedragInc: Math.round(p.bedragExBtw * 1.21 * 100) / 100,
            kenmerk,
            previewOrders: p.orders,
          });
        }
        continue;
      }
      const adv = adviseurs.find((a) => a.id === p.id);
      const kvkOk = Boolean(
        adv?.bedrijfsnaam && adv?.kvk_nummer && adv?.iban
      );
      byId.set(p.id, {
        key: `preview-sales:${p.id}`,
        kind: "sales",
        relatieId: p.id,
        relatieNaam: p.naam,
        bedrijfsnaam: adv?.bedrijfsnaam?.trim() || null,
        iban: adv?.iban?.trim() || null,
        kvkOk,
        bedragEx: p.bedragExBtw,
        bedragInc: Math.round(p.bedragExBtw * 1.21 * 100) / 100,
        kenmerk,
        rows: [],
        status: "preview",
        preview: true,
        previewOrders: p.orders,
      });
    }

    return [...byId.values()].sort((a, b) =>
      a.relatieNaam.localeCompare(b.relatieNaam, "nl")
    );
  }, [
    filtered,
    weekScope,
    toekomstigVooruit,
    adviseurs,
    q,
    vorigeWeek.week,
  ]);

  const installatiePayoutGroups = useMemo(
    () =>
      weekScope === "vooruit"
        ? []
        : buildPayoutGroups(
            "installatie",
            filtered.filter((r) => r.kind === "installatie")
          ),
    [filtered, weekScope, vorigeWeek.week]
  );

  const otherFilteredRows = useMemo(
    () => filtered.filter((r) => r.kind !== "sales" && r.kind !== "installatie"),
    [filtered]
  );

  async function copyField(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      setError("Kopiëren mislukt");
    }
  }

  function resetCreateForm() {
    setCreateKind("sales");
    setCreateMode("handmatig");
    setCreateTranche("a");
    setCreateAdviseurId("");
    setCreatePartnerId("");
    setCreateBedrag(String(VERKOPER_AANBETALING_FEE));
    setCreateOmschrijving("");
    setDealQuery("");
    setSelectedOfferteId("");
    setDealOptions([]);
  }

  async function maakConcepten() {
    setCreatingConcepts(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/adviseurs/creditfacturen/toekomstig", {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Concepten aanmaken mislukt"
        );
      }
      const created = Number((json as { created?: number }).created || 0);
      const errs = (json as { errors?: string[] }).errors || [];
      setToekomstig(json as ToekomstigeCreditfacturenPreview);
      setOkMsg(
        created > 0
          ? `${created} conceptfactuur${created === 1 ? "" : "en"} aangemaakt.`
          : "Geen nieuwe concepten — alles stond al klaar."
      );
      if (errs.length) {
        setError(errs.slice(0, 3).join(" · "));
      }
      setTab("concept_ab");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Concepten aanmaken mislukt");
    } finally {
      setCreatingConcepts(false);
    }
  }

  async function submitCreate() {
    setCreating(true);
    setError(null);
    setOkMsg(null);
    try {
      if (createKind === "installatie") {
        if (!createPartnerId) throw new Error("Kies een installatiepartner.");
        const bedrag = Number(createBedrag.replace(",", "."));
        if (!Number.isFinite(bedrag) || bedrag <= 0) {
          throw new Error("Vul een geldig bedrag excl. btw in.");
        }
        const res = await fetch("/api/partners/creditfacturen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partner_id: createPartnerId,
            bedrag_ex_btw: bedrag,
            omschrijving: createOmschrijving.trim() || undefined,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (json as { error?: string }).error || "Aanmaken mislukt"
          );
        }
        const nummer =
          (json as { factuur?: { factuur_nummer?: string } }).factuur
            ?.factuur_nummer || "concept";
        setOkMsg(`Concept ${nummer} aangemaakt.`);
      } else if (createKind === "wf") {
        if (!createAdviseurId) throw new Error("Kies een medewerker.");
        const bedrag = Number(createBedrag.replace(",", "."));
        if (!Number.isFinite(bedrag) || bedrag <= 0) {
          throw new Error("Vul een geldig bedrag excl. btw in.");
        }
        const oms = createOmschrijving.trim();
        const res = await fetch("/api/adviseurs/creditfacturen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adviseur_id: createAdviseurId,
            bedrag_ex_btw: bedrag,
            omschrijving: oms
              ? `[WF] ${oms}`
              : "[WF] Warmtefonds-uitbetaling",
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (json as { error?: string }).error || "Aanmaken mislukt"
          );
        }
        const nummer =
          (json as { factuur?: { factuur_nummer?: string } }).factuur
            ?.factuur_nummer || "concept";
        setOkMsg(`WF-concept ${nummer} aangemaakt.`);
      } else if (createMode === "deal") {
        if (!selectedOfferteId) throw new Error("Selecteer een deal.");
        const bedragRaw = createBedrag.trim();
        const bedrag = Number(bedragRaw.replace(",", "."));
        let body: Record<string, unknown>;
        if (bedragRaw && Number.isFinite(bedrag) && bedrag > 0) {
          const deal = dealOptions.find(
            (d) => d.offerte_id === selectedOfferteId
          );
          const adviseurId = createAdviseurId || deal?.adviseur_id;
          if (!adviseurId) {
            throw new Error(
              "Deal heeft geen adviseur — kies er handmatig een."
            );
          }
          body = {
            offerte_id: selectedOfferteId,
            adviseur_id: adviseurId,
            bedrag_ex_btw: bedrag,
            omschrijving: createOmschrijving.trim() || undefined,
          };
        } else {
          body = { offerte_id: selectedOfferteId, tranche: createTranche };
        }
        const res = await fetch("/api/adviseurs/creditfacturen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (json as { error?: string }).error || "Aanmaken mislukt"
          );
        }
        const nummer =
          (json as { factuur?: { factuur_nummer?: string } }).factuur
            ?.factuur_nummer || "concept";
        const created = (json as { created?: boolean }).created !== false;
        const label =
          createTranche === "b"
            ? "Rest-commissie (B)"
            : "Aanbetalingscommissie (A)";
        setOkMsg(
          created
            ? `${label} ${nummer} aangemaakt.`
            : `${label} ${nummer} bestond al voor deze deal.`
        );
      } else {
        if (!createAdviseurId) throw new Error("Kies een verkoper.");
        const bedrag = Number(createBedrag.replace(",", "."));
        if (!Number.isFinite(bedrag) || bedrag <= 0) {
          throw new Error("Vul een geldig bedrag excl. btw in.");
        }
        const res = await fetch("/api/adviseurs/creditfacturen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adviseur_id: createAdviseurId,
            bedrag_ex_btw: bedrag,
            omschrijving: createOmschrijving.trim() || undefined,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (json as { error?: string }).error || "Aanmaken mislukt"
          );
        }
        const nummer =
          (json as { factuur?: { factuur_nummer?: string } }).factuur
            ?.factuur_nummer || "concept";
        setOkMsg(`Concept ${nummer} aangemaakt.`);
      }
      setShowCreate(false);
      resetCreateForm();
      setTab("concept_ab");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aanmaken mislukt");
    } finally {
      setCreating(false);
    }
  }

  async function patchStatus(
    row: InboxRow,
    status: "verzonden" | "goedgekeurd" | "betaald"
  ) {
    setBusyId(row.key);
    setError(null);
    setOkMsg(null);
    try {
      const url =
        row.source === "adviseur"
          ? "/api/adviseurs/creditfacturen"
          : "/api/partners/creditfacturen";
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Bijwerken mislukt");
      if (status === "goedgekeurd") {
        setOkMsg(
          `Factuur ${json.factuur.factuur_nummer} bevestigd — staat op te betalen.`
        );
        setTab("te_betalen");
      } else if (status === "verzonden") {
        setOkMsg(
          `Factuur ${json.factuur.factuur_nummer} bevestigd — verstuurd.`
        );
      } else {
        setOkMsg(
          `Factuur ${json.factuur.factuur_nummer} gemarkeerd als betaald.`
        );
        setTab("betaald");
      }
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bijwerken mislukt");
    } finally {
      setBusyId(null);
    }
  }

  function payoutApiUrl(row: InboxRow): string {
    return row.source === "adviseur"
      ? "/api/adviseurs/creditfacturen"
      : "/api/partners/creditfacturen";
  }

  function payoutPdfUrl(row: InboxRow): string {
    return row.source === "adviseur"
      ? `/api/adviseurs/creditfacturen/${row.id}/pdf`
      : `/api/partners/creditfacturen/${row.id}/pdf`;
  }

  /** Bevestig alle openstaande facturen van één relatie. */
  async function bevestigPayoutGroup(group: PayoutGroup) {
    const targets = group.rows.filter(
      (r) => r.status === "concept" || r.status === "verzonden"
    );
    if (targets.length === 0) return;
    setBusyId(group.key);
    setError(null);
    setOkMsg(null);
    try {
      let anyTeBetalen = false;
      for (const row of targets) {
        // Sales/adviseur → direct te betalen; partner → eerst verzonden (acceptatie)
        const nextStatus =
          row.source === "adviseur"
            ? "goedgekeurd"
            : row.status === "verzonden"
              ? "goedgekeurd"
              : "verzonden";
        if (nextStatus === "goedgekeurd") anyTeBetalen = true;
        const res = await fetch(payoutApiUrl(row), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.id, status: nextStatus }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (json as { error?: string }).error ||
              `Bevestigen mislukt (${row.nummer})`
          );
        }
      }
      setOkMsg(
        anyTeBetalen
          ? `${group.relatieNaam}: ${formatEuro(group.bedragEx)} bevestigd — te betalen.`
          : `${group.relatieNaam}: ${formatEuro(group.bedragEx)} bevestigd — wacht op acceptatie.`
      );
      if (anyTeBetalen) setTab("te_betalen");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bevestigen mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function downloadPayoutGroupPdfs(group: PayoutGroup) {
    setBusyId(`pdf-${group.key}`);
    setError(null);
    try {
      for (const row of group.rows) {
        const res = await fetch(payoutPdfUrl(row));
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(
            (j as { error?: string }).error || `PDF ${row.nummer} mislukt`
          );
        }
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${row.nummer.replace(/\//g, "-")}.pdf`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function markPayoutGroupBetaald(group: PayoutGroup) {
    setBusyId(group.key);
    setError(null);
    setOkMsg(null);
    try {
      for (const row of group.rows) {
        const res = await fetch(payoutApiUrl(row), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.id, status: "betaald" }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (json as { error?: string }).error ||
              `Betaald zetten mislukt (${row.nummer})`
          );
        }
      }
      setOkMsg(`${group.relatieNaam} gemarkeerd als betaald.`);
      setTab("betaald");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Betaald zetten mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function downloadPdf(row: InboxRow) {
    setBusyId(`pdf-${row.key}`);
    try {
      const url =
        row.source === "adviseur"
          ? `/api/adviseurs/creditfacturen/${row.id}/pdf`
          : `/api/partners/creditfacturen/${row.id}/pdf`;
      const res = await fetch(url);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string }).error || "PDF download mislukt"
        );
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${row.nummer.replace(/\//g, "-")}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download mislukt");
    } finally {
      setBusyId(null);
    }
  }

  const bannerPreview =
    weekScope === "vooruit" ? toekomstigVooruit : toekomstig;
  const nieuwCount =
    (weekScope === "vooruit" ? toekomstigVooruit : toekomstig)?.totals
      .nieuw ?? 0;

  return (
    <div className={embedded ? "" : "space-y-4"}>
      <div className={embedded ? "" : "border border-line bg-white"}>
        <div
          className={[
            "flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5",
            "border-b border-line",
          ].join(" ")}
        >
          <div>
            {!embedded ? (
              <>
                <h2 className="font-display text-lg font-semibold text-ink">
                  Uitbetalingen
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Per persoon één bedrag · Bevestig → te betalen → betaald
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">
                Concept a.b. · te betalen · betaald
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {nieuwCount > 0 ? (
              <button
                type="button"
                disabled={creatingConcepts}
                onClick={() => void maakConcepten()}
                className="bg-orange px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {creatingConcepts
                  ? "Bezig…"
                  : `Maak ${nieuwCount} concept${nieuwCount === 1 ? "" : "en"}`}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setShowCreate((v) => !v);
                setError(null);
                setOkMsg(null);
                if (showCreate) resetCreateForm();
              }}
              className="bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-deeper"
            >
              {showCreate ? "Sluiten" : "Nieuwe factuur"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-px border-b border-line bg-line">
          {(
            [
              [
                "concept_ab",
                "Concept a.b.",
                String(tabCounts.concept_ab),
                formatEuro(tabCounts.conceptEuro),
              ],
              [
                "te_betalen",
                "Te betalen",
                String(tabCounts.te_betalen),
                formatEuro(tabCounts.teBetalenEuro),
              ],
              ["betaald", "Betaald", String(tabCounts.betaald), ""],
            ] as const
          ).map(([id, label, count, euro]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={[
                "bg-white px-4 py-3 text-left transition",
                tab === id ? "ring-2 ring-inset ring-green" : "hover:bg-wash",
              ].join(" ")}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                {label}
              </p>
              <p className="mt-1 font-display text-lg font-semibold tabular-nums text-ink">
                {count}
              </p>
              {euro ? (
                <p className="mt-0.5 text-[11px] tabular-nums text-muted">
                  {euro} excl.
                </p>
              ) : null}
            </button>
          ))}
        </div>

        {bannerPreview && tab === "concept_ab" ? (
          <div
            className={[
              "border-b border-line px-4 py-3 sm:px-5",
              weekScope === "vooruit" ? "bg-[#FFF8F0]" : "bg-[#F7FAF8]",
            ].join(" ")}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {weekScope === "vooruit"
                    ? "1 week vooruit · volgende uitbetaling"
                    : "Aankomende betaling"}
                </p>
                <p className="mt-0.5 font-display text-sm font-semibold text-ink">
                  {bannerPreview.betaalLabel}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Week {bannerPreview.week.week} ·{" "}
                  {formatDateShort(`${bannerPreview.week.van}T12:00:00`)} –{" "}
                  {formatDateShort(`${bannerPreview.week.tot}T12:00:00`)} ·{" "}
                  {bannerPreview.totals.orders} order
                  {bannerPreview.totals.orders === 1 ? "" : "s"}
                  {nieuwCount > 0
                    ? ` · ${nieuwCount} nog zonder concept`
                    : ""}
                  {weekScope === "vooruit"
                    ? " · aanbetalingen deze week"
                    : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-lg font-semibold tabular-nums text-ink">
                  {formatEuro(bannerPreview.totals.bedragExBtw)}
                </p>
                {weekScope !== "vooruit" ? (
                  <button
                    type="button"
                    onClick={() => setWeekScope("vooruit")}
                    className="mt-1 text-[11px] font-semibold text-green-dark hover:underline"
                  >
                    Bekijk 1 week vooruit →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setWeekScope("vorige")}
                    className="mt-1 text-[11px] font-semibold text-muted hover:underline"
                  >
                    ← Terug naar uitbetalingsronde
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {showCreate ? (
          <div className="space-y-3 border-b border-line bg-wash/40 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["sales", "Sales"],
                  ["wf", "WF"],
                  ["installatie", "Installatie"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setCreateKind(id);
                    if (id === "sales") {
                      setCreateMode("handmatig");
                      setCreateBedrag(String(VERKOPER_AANBETALING_FEE));
                    } else if (id === "wf") {
                      setCreateMode("handmatig");
                      setCreateBedrag("");
                    } else {
                      setCreateBedrag("");
                    }
                  }}
                  className={[
                    "px-3 py-1.5 text-xs font-semibold",
                    createKind === id
                      ? "bg-ink text-white"
                      : "border border-line bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>

            {createKind === "sales" ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCreateMode("handmatig");
                      setCreateBedrag(String(VERKOPER_AANBETALING_FEE));
                    }}
                    className={[
                      "px-3 py-1.5 text-xs font-semibold",
                      createMode === "handmatig"
                        ? "bg-green text-white"
                        : "border border-line bg-white text-muted hover:bg-wash",
                    ].join(" ")}
                  >
                    Handmatig
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreateMode("deal");
                      setCreateBedrag("");
                    }}
                    className={[
                      "px-3 py-1.5 text-xs font-semibold",
                      createMode === "deal"
                        ? "bg-green text-white"
                        : "border border-line bg-white text-muted hover:bg-wash",
                    ].join(" ")}
                  >
                    Vanuit deal
                  </button>
                </div>

                {createMode === "handmatig" ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Verkoper
                      <select
                        value={createAdviseurId}
                        onChange={(e) => setCreateAdviseurId(e.target.value)}
                        className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                      >
                        <option value="">Kies…</option>
                        {salesAdviseurs.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.naam}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Bedrag excl. btw
                      <input
                        type="text"
                        inputMode="decimal"
                        value={createBedrag}
                        onChange={(e) => setCreateBedrag(e.target.value)}
                        className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                      />
                    </label>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted sm:col-span-2">
                      Omschrijving (optioneel)
                      <input
                        type="text"
                        value={createOmschrijving}
                        onChange={(e) => setCreateOmschrijving(e.target.value)}
                        className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Zoek deal
                      <input
                        type="search"
                        value={dealQuery}
                        onChange={(e) => setDealQuery(e.target.value)}
                        placeholder="Klant, plaats of offertenr…"
                        className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green sm:max-w-md"
                      />
                    </label>
                    <div className="max-h-48 overflow-y-auto border border-line bg-white">
                      {dealsLoading ? (
                        <p className="px-3 py-4 text-sm text-muted">Laden…</p>
                      ) : dealOptions.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-muted">
                          Geen deals gevonden.
                        </p>
                      ) : (
                        <ul className="divide-y divide-line">
                          {dealOptions.map((d) => {
                            const selected =
                              selectedOfferteId === d.offerte_id;
                            return (
                              <li key={d.offerte_id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedOfferteId(d.offerte_id);
                                    if (d.adviseur_id) {
                                      setCreateAdviseurId(d.adviseur_id);
                                    }
                                  }}
                                  className={[
                                    "flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-sm",
                                    selected
                                      ? "bg-green-soft"
                                      : "hover:bg-wash",
                                  ].join(" ")}
                                >
                                  <span>
                                    <span className="font-medium text-ink">
                                      {d.klant_naam}
                                    </span>
                                    <span className="mt-0.5 block text-xs text-muted">
                                      {d.offerte_nummer || "Offerte"}
                                      {d.adviseur_naam
                                        ? ` · ${d.adviseur_naam}`
                                        : ""}
                                      {` · ${formatEuro(d.bedrag_ex_btw)} excl.`}
                                    </span>
                                  </span>
                                  {selected ? (
                                    <span className="shrink-0 text-xs font-semibold text-green-dark">
                                      Gekozen
                                    </span>
                                  ) : null}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <div className="sm:max-w-xs">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Soort commissie
                      </p>
                      <div className="mt-1 inline-flex border border-line">
                        <button
                          type="button"
                          onClick={() => setCreateTranche("a")}
                          className={[
                            "px-3 py-1.5 text-xs font-semibold",
                            createTranche === "a"
                              ? "bg-ink text-white"
                              : "bg-white text-muted hover:bg-wash",
                          ].join(" ")}
                        >
                          A · aanbetaling
                        </button>
                        <button
                          type="button"
                          onClick={() => setCreateTranche("b")}
                          className={[
                            "px-3 py-1.5 text-xs font-semibold",
                            createTranche === "b"
                              ? "bg-ink text-white"
                              : "bg-white text-muted hover:bg-wash",
                          ].join(" ")}
                        >
                          B · rest / netto
                        </button>
                      </div>
                    </div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted sm:max-w-xs">
                      Bedrag excl. (leeg = automatisch)
                      <input
                        type="text"
                        inputMode="decimal"
                        value={createBedrag}
                        onChange={(e) => setCreateBedrag(e.target.value)}
                        placeholder={
                          createTranche === "b"
                            ? "commissie% − €250"
                            : `€${VERKOPER_AANBETALING_FEE}`
                        }
                        className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                      />
                    </label>
                  </div>
                )}
              </>
            ) : createKind === "wf" ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Medewerker
                  <select
                    value={createAdviseurId}
                    onChange={(e) => setCreateAdviseurId(e.target.value)}
                    className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                  >
                    <option value="">Kies…</option>
                    {adviseurs
                      .filter((a) => {
                        const n = (a.naam || "").toLowerCase();
                        return !(
                          n.includes("huub") && n.includes("veldman")
                        );
                      })
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.naam}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Bedrag excl. btw
                  <input
                    type="text"
                    inputMode="decimal"
                    value={createBedrag}
                    onChange={(e) => setCreateBedrag(e.target.value)}
                    className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                  />
                </label>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Omschrijving (optioneel)
                  <input
                    type="text"
                    value={createOmschrijving}
                    onChange={(e) => setCreateOmschrijving(e.target.value)}
                    className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                  />
                </label>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Installateur
                  <select
                    value={createPartnerId}
                    onChange={(e) => setCreatePartnerId(e.target.value)}
                    className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                  >
                    <option value="">Kies…</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.naam}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Bedrag excl. btw
                  <input
                    type="text"
                    inputMode="decimal"
                    value={createBedrag}
                    onChange={(e) => setCreateBedrag(e.target.value)}
                    className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                  />
                </label>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Omschrijving (optioneel)
                  <input
                    type="text"
                    value={createOmschrijving}
                    onChange={(e) => setCreateOmschrijving(e.target.value)}
                    className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                  />
                </label>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={creating}
                onClick={() => void submitCreate()}
                className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-50"
              >
                {creating ? "Bezig…" : "Maak concept"}
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => {
                  setShowCreate(false);
                  resetCreateForm();
                }}
                className="border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50"
              >
                Annuleren
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="relative w-full sm:max-w-md">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted/50">
              ⌕
            </span>
            <input
              type="search"
              inputMode="search"
              placeholder="Zoek relatie, factuurnr, klant, project…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-line bg-white py-2.5 pl-8 pr-3 text-sm outline-none transition placeholder:text-muted/60 focus:border-green"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tab === "concept_ab" ? (
              <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Week
                <select
                  value={weekScope}
                  onChange={(e) =>
                    setWeekScope(e.target.value as WeekScope)
                  }
                  className="min-w-[12rem] border border-line bg-white px-2.5 py-2 text-xs font-semibold normal-case tracking-normal text-ink outline-none focus:border-green"
                >
                  <option value="vorige">
                    W{weekDaarvoor.week}+W{vorigeWeek.week} (+ openstaand)
                  </option>
                  <option value="vooruit">
                    W{toekomstigVooruit?.week.week ?? huidigeWeek.week} →{" "}
                    {toekomstigVooruit?.betaalLabel ||
                      `wo ${huidigeWeek.betaalWoensdag}`}{" "}
                    (1 week vooruit)
                  </option>
                  <option value="alles">Alle weken</option>
                </select>
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Unit
              <select
                value={unitFilter}
                onChange={(e) =>
                  setUnitFilter(e.target.value as UnitFilter)
                }
                className="min-w-[9rem] border border-line bg-white px-2.5 py-2 text-xs font-semibold normal-case tracking-normal text-ink outline-none focus:border-green"
              >
                <option value="alles">Alles</option>
                <option value="sales">Sales</option>
                <option value="wf">WF</option>
                <option value="installatie">Installatie</option>
              </select>
            </label>
          </div>
        </div>

        {(error || okMsg) && (
          <div className="space-y-2 border-b border-line px-4 py-3 sm:px-5">
            {error && (
              <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                {error}
              </p>
            )}
            {okMsg && (
              <p className="border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
                {okMsg}
              </p>
            )}
          </div>
        )}

        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-muted">Laden…</p>
        ) : filtered.length === 0 &&
          salesPayoutGroups.length === 0 &&
          installatiePayoutGroups.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            {tab === "concept_ab"
              ? weekScope === "vooruit"
                ? "Nog geen aanbetalingen in deze week voor de volgende uitbetaling."
                : nieuwCount > 0
                  ? `Nog geen concepten. Klik “Maak ${nieuwCount} concepten” hierboven.`
                  : "Geen conceptfacturen. Aankomende aanbetalingen verschijnen hier."
              : tab === "te_betalen"
                ? "Geen goedgekeurde facturen te betalen."
                : "Nog geen betaalde facturen."}
          </p>
        ) : (
          <>
            <div className="border-b border-line px-4 py-2 text-xs text-muted sm:px-5">
              {[
                salesPayoutGroups.length > 0
                  ? `${salesPayoutGroups.length} sales`
                  : null,
                installatiePayoutGroups.length > 0
                  ? `${installatiePayoutGroups.length} installatie`
                  : null,
                otherFilteredRows.length > 0
                  ? `${otherFilteredRows.length} overig`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") ||
                `${filtered.length} factuur${filtered.length === 1 ? "" : "en"}`}
              {weekScope === "vooruit" ? " · vooruitblik" : ""}
              {q ? ` · zoek: “${search.trim()}”` : ""}
            </div>

            {salesPayoutGroups.length > 0 ||
            installatiePayoutGroups.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] table-fixed text-left text-sm">
                  <colgroup>
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "22%" }} />
                    <col style={{ width: "16%" }} />
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "16%" }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-wide text-muted">
                      <th className="px-3 py-1.5 sm:px-4">Relatie</th>
                      <th className="px-2 py-1.5 text-right">Overmaken</th>
                      <th className="px-2 py-1.5">IBAN</th>
                      <th className="px-2 py-1.5">Kenmerk</th>
                      <th className="px-2 py-1.5">Factuur</th>
                      <th className="px-3 py-1.5 text-right sm:px-4"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ["Sales", salesPayoutGroups],
                        ["Installatie", installatiePayoutGroups],
                      ] as const
                    ).flatMap(([sectionTitle, groups]) => {
                      if (groups.length === 0) return [];
                      return [
                        <tr key={`sec-${sectionTitle}`}>
                          <td
                            colSpan={6}
                            className="border-b border-line bg-wash/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted sm:px-4"
                          >
                            {sectionTitle}
                            {weekScope === "vooruit" &&
                            sectionTitle === "Sales"
                              ? " · aanbetalingen → volgende wo"
                              : ""}
                          </td>
                        </tr>,
                        ...groups.map((g) => {
                          const busy =
                            busyId === g.key || busyId === `pdf-${g.key}`;
                          const canBevestig =
                            !g.preview &&
                            tab === "concept_ab" &&
                            g.rows.some(
                              (r) =>
                                r.status === "concept" ||
                                r.status === "verzonden"
                            );
                          const canBetaald =
                            !g.preview &&
                            tab === "te_betalen" &&
                            g.rows.every((r) => r.status === "goedgekeurd");
                          const isBetaald =
                            tab === "betaald" || g.status === "betaald";
                          const factuurHint = g.preview
                            ? `${g.previewOrders ?? 0} aanbetaling${
                                (g.previewOrders ?? 0) === 1 ? "" : "en"
                              }`
                            : g.rows
                                .map((r) => r.nummer)
                                .filter(Boolean)
                                .slice(0, 2)
                                .join(" · ");
                          const orderCount =
                            g.preview && g.previewOrders
                              ? g.previewOrders
                              : g.rows.length;
                          return (
                            <tr
                              key={g.key}
                              className="border-b border-line hover:bg-wash/60"
                            >
                              <td className="px-3 py-1.5 sm:px-4">
                                <div className="truncate font-medium text-ink">
                                  {g.relatieNaam}
                                </div>
                                {g.bedrijfsnaam ? (
                                  <div className="truncate text-[11px] text-muted">
                                    {g.bedrijfsnaam}
                                  </div>
                                ) : null}
                                {!g.kvkOk ? (
                                  <div className="text-[10px] font-semibold text-[#C45A12]">
                                    KvK/IBAN
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <div className="font-semibold tabular-nums text-ink">
                                  {formatEuro(g.bedragEx)}
                                </div>
                                <div className="text-[10px] tabular-nums text-muted">
                                  {formatEuro(g.bedragInc)} inc.
                                  {orderCount > 1
                                    ? ` · ${orderCount}×`
                                    : ""}
                                </div>
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="flex min-w-0 items-center gap-1">
                                  <span className="truncate font-mono text-[11px] text-ink">
                                    {g.iban || "—"}
                                  </span>
                                  {g.iban ? (
                                    <CopyMini
                                      copied={copiedKey === `${g.key}:iban`}
                                      onCopy={() =>
                                        void copyField(
                                          `${g.key}:iban`,
                                          g.iban!
                                        )
                                      }
                                    />
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="flex min-w-0 items-center gap-1">
                                  <span className="truncate text-[11px] text-ink">
                                    {g.kenmerk}
                                  </span>
                                  <CopyMini
                                    copied={copiedKey === `${g.key}:kenmerk`}
                                    onCopy={() =>
                                      void copyField(
                                        `${g.key}:kenmerk`,
                                        g.kenmerk
                                      )
                                    }
                                  />
                                </div>
                              </td>
                              <td className="truncate px-2 py-1.5 text-[11px] text-muted">
                                {factuurHint}
                                {!g.preview && g.rows.length > 2
                                  ? ` +${g.rows.length - 2}`
                                  : ""}
                              </td>
                              <td className="px-3 py-1.5 text-right sm:px-4">
                                <div className="inline-flex flex-wrap items-center justify-end gap-1">
                                  {g.preview ? (
                                    <span className="text-[11px] font-semibold text-[#854D0E]">
                                      Vooruitblik
                                    </span>
                                  ) : isBetaald ? (
                                    <StatusBadge
                                      status="betaald"
                                      goedgekeurd_op={null}
                                      betaald_op={
                                        g.rows.find((r) => r.betaald_op)
                                          ?.betaald_op || null
                                      }
                                    />
                                  ) : (
                                    <StatusBadge
                                      status={
                                        g.status === "mixed"
                                          ? "concept"
                                          : g.status
                                      }
                                      goedgekeurd_op={null}
                                      betaald_op={null}
                                    />
                                  )}
                                  <button
                                    type="button"
                                    disabled={busy || g.preview || g.rows.length === 0}
                                    onClick={() =>
                                      void downloadPayoutGroupPdfs(g)
                                    }
                                    className="border border-line bg-white px-1.5 py-0.5 text-[10px] font-semibold text-ink hover:bg-wash disabled:opacity-60"
                                    title={
                                      g.preview
                                        ? "Eerst concepten maken"
                                        : undefined
                                    }
                                  >
                                    PDF
                                  </button>
                                  {canBevestig ? (
                                    <button
                                      type="button"
                                      disabled={busy || !g.kvkOk}
                                      onClick={() =>
                                        void bevestigPayoutGroup(g)
                                      }
                                      className="bg-orange px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-60"
                                      title={
                                        !g.kvkOk
                                          ? "Vul eerst ZZP-gegevens in"
                                          : "Bevestig uitbetaling"
                                      }
                                    >
                                      Bevestig
                                    </button>
                                  ) : null}
                                  {canBetaald ? (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void markPayoutGroupBetaald(g)
                                      }
                                      className="bg-green px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-60"
                                    >
                                      Betaald
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        }),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            {otherFilteredRows.length > 0 ? (
              <div
                className={`overflow-x-auto ${
                  salesPayoutGroups.length > 0 ||
                  installatiePayoutGroups.length > 0
                    ? "border-t border-line"
                    : ""
                }`}
              >
                <div className="border-b border-line bg-wash/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted sm:px-4">
                  Overig
                </div>
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-wide text-muted">
                      <th className="px-3 py-1.5 sm:px-4">Relatie</th>
                      <th className="px-2 py-1.5">Type</th>
                      <th className="px-2 py-1.5">Deal / project</th>
                      <th className="px-2 py-1.5 text-right">Excl.</th>
                      <th className="px-2 py-1.5">Status</th>
                      <th className="px-3 py-1.5 text-right sm:px-4">Acties</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {otherFilteredRows.map((r) => {
                      const busy =
                        busyId === r.key || busyId === `pdf-${r.key}`;
                      return (
                        <tr key={r.key} className="hover:bg-wash/60">
                          <td className="px-3 py-1.5 sm:px-4">
                            <span className="font-medium text-ink">
                              {r.relatieNaam}
                            </span>
                            <span className="ml-1.5 text-[11px] text-muted">
                              {r.nummer}
                            </span>
                            {!r.kvkOk ? (
                              <span className="ml-1.5 text-[10px] font-semibold text-[#C45A12]">
                                KvK
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-1.5">
                            <KindBadge kind={r.kind} label={r.kindLabel} />
                          </td>
                          <td className="max-w-[14rem] truncate px-2 py-1.5 text-[11px] text-muted">
                            {r.context || "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <span className="font-semibold tabular-nums text-ink">
                              {formatEuro(r.bedragEx)}
                            </span>
                            <span className="ml-1 text-[10px] tabular-nums text-muted">
                              ({formatEuro(r.bedragInc)} inc.)
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <StatusBadge
                              status={r.status}
                              goedgekeurd_op={r.goedgekeurd_op}
                              betaald_op={r.betaald_op}
                            />
                          </td>
                          <td className="px-3 py-1.5 text-right sm:px-4">
                            <div className="inline-flex flex-wrap justify-end gap-1">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void downloadPdf(r)}
                                className="border border-line bg-white px-1.5 py-0.5 text-[10px] font-semibold text-ink hover:bg-wash disabled:opacity-60"
                              >
                                PDF
                              </button>
                              {r.status === "concept" ||
                              r.status === "verzonden" ? (
                                <button
                                  type="button"
                                  disabled={busy || !r.kvkOk}
                                  onClick={() =>
                                    void patchStatus(
                                      r,
                                      r.source === "adviseur"
                                        ? "goedgekeurd"
                                        : "verzonden"
                                    )
                                  }
                                  className="bg-orange px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-60"
                                  title={
                                    !r.kvkOk
                                      ? "Vul eerst ZZP-gegevens in"
                                      : undefined
                                  }
                                >
                                  Bevestig
                                </button>
                              ) : null}
                              {r.status === "goedgekeurd" ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void patchStatus(r, "betaald")}
                                  className="bg-green px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-60"
                                >
                                  Betaald
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
