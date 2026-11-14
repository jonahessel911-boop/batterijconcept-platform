"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { parseCreditRegels } from "@/lib/creditfactuur-aftrek";
import type {
  Adviseur,
  AdviseurCreditFactuur,
  AdviseurKosten,
  InstallatiePartner,
  PartnerCreditFactuur,
} from "@/types/database";
import {
  formatDateShort,
  formatDateTimeNl,
  formatEuro,
} from "@/lib/format";
import {
  VERKOPER_AANBETALING_FEE,
  creditWeekByYearWeek,
  creditWeekFromDate,
  previousCreditWeek,
  weekBeforePreviousCreditWeek,
} from "@/lib/adviseur-creditfactuur";
import {
  isBelcommissieCreditfactuur,
  isOpsCommissieCreditfactuur,
} from "@/lib/callcenter-creditfactuur";
import {
  isUitgeslotenVanSalesCommissie,
  normalizeRol,
  type GebruikerRol,
} from "@/lib/rollen";
import type { ToekomstigeCreditfacturenPreview } from "@/lib/toekomstige-creditfacturen";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type MainTab = "concept_ab" | "te_betalen" | "betaald";
/** Categorie-filter in de inbox (standaard Alles). */
type PayoutCategorie = "operations" | "beller" | "adviseur" | "directie";
type CategorieFilter = "alles" | PayoutCategorie;
type CreateKind = "sales" | "wf" | "installatie";
/** Concept-tab: huidige ronde, 1 week vooruit (deze week → volgende wo), of alles. */
type WeekScope = "vorige" | "vooruit" | "alles";

const PAYOUT_CATEGORIE_ORDER: PayoutCategorie[] = [
  "operations",
  "beller",
  "adviseur",
  "directie",
];

const PAYOUT_CATEGORIE_LABEL: Record<PayoutCategorie, string> = {
  operations: "Operations",
  beller: "Beller",
  adviseur: "Adviseur",
  directie: "Directie",
};

function normalizeSearchToken(s: string): string {
  return s.toLowerCase().replace(/[\s\-_/·.•]/g, "");
}

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

type InvoiceKind = "sales" | "bel" | "ops" | "wf" | "installatie";
type PayoutKind = "sales" | "bel" | "ops" | "installatie";

function resolvePayoutCategorie(opts: {
  kind: InvoiceKind;
  rol?: string | null;
}): PayoutCategorie {
  if (opts.kind === "bel") return "beller";
  if (opts.kind === "ops" || opts.kind === "installatie") return "operations";
  const rol = normalizeRol(opts.rol);
  if (rol === "admin" || rol === "sales_manager") return "directie";
  if (rol === "backoffice") return "operations";
  if (rol === "beller") return "beller";
  return "adviseur";
}

function kindToPayoutKind(kind: InvoiceKind): PayoutKind {
  if (kind === "bel") return "bel";
  if (kind === "ops") return "ops";
  if (kind === "installatie") return "installatie";
  return "sales";
}

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
  categorie: PayoutCategorie;
  rol: GebruikerRol | null;
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

/** Eén uitbetalingsregel per relatie (sales, belcommissie én installatie). */
type PayoutGroup = {
  key: string;
  kind: PayoutKind;
  categorie: PayoutCategorie;
  relatieId: string;
  relatieNaam: string;
  bedrijfsnaam: string | null;
  iban: string | null;
  kvkOk: boolean;
  bedragEx: number;
  bedragInc: number;
  kenmerk: string;
  /** ISO yyyy-mm-dd: woensdag na de werkweek (uitbetalingsdeadline). */
  deadline: string | null;
  rows: InboxRow[];
  /** concept | verzonden | goedgekeurd | betaald | mixed | preview */
  status: string;
  /** Vooruitblik: nog geen (volledige) conceptfactuur — alleen preview. */
  preview?: boolean;
  previewOrders?: number;
};

/** Woensdag-uitbetalingsdag bij een datum zonder week_jaar/week_nummer. */
function deadlineFromFactuurdatum(ymd: string): string {
  const d = new Date(ymd.length <= 10 ? `${ymd}T12:00:00` : ymd);
  const dow = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Amsterdam",
    weekday: "short",
  }).format(d);
  // Factuurdatum valt vaak in de betaalweek (ma–wo) → woensdag van die week.
  // Anders (werkweek) → woensdag ná die week.
  if (dow === "Mon" || dow === "Tue" || dow === "Wed") {
    return previousCreditWeek(d).betaalWoensdag;
  }
  return creditWeekFromDate(d).betaalWoensdag;
}

/** Uitbetalingsdag = woensdag ná de ISO-werkweek van de factuur. */
function payoutDeadlineYmd(rows: InboxRow[]): string | null {
  const dates: string[] = [];
  for (const r of rows) {
    if (r.weekJaar != null && r.weekNummer != null) {
      dates.push(
        creditWeekByYearWeek(r.weekJaar, r.weekNummer).betaalWoensdag
      );
      continue;
    }
    if (r.factuurdatum) {
      dates.push(deadlineFromFactuurdatum(r.factuurdatum));
    }
  }
  if (dates.length === 0) return null;
  return dates.sort()[0] || null;
}

function todayYmdAmsterdam(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDeadlineLabel(ymd: string | null): string {
  if (!ymd) return "—";
  const todayYmd = todayYmdAmsterdam();
  const label = formatDateShort(`${ymd}T12:00:00`);
  if (ymd === todayYmd) return `Vandaag · ${label}`;
  const t = new Date(`${ymd}T12:00:00`);
  const n = new Date(`${todayYmd}T12:00:00`);
  const diffDays = Math.round((t.getTime() - n.getTime()) / 86400000);
  if (diffDays === 1) return `Morgen · ${label}`;
  if (diffDays < 0) return `Verlopen · ${label}`;
  return `wo ${label}`;
}

/** Compact voor dichte tabelrijen. */
function formatDeadlineShort(ymd: string | null): string {
  if (!ymd) return "—";
  const todayYmd = todayYmdAmsterdam();
  if (ymd === todayYmd) return "Vandaag";
  const t = new Date(`${ymd}T12:00:00`);
  const n = new Date(`${todayYmd}T12:00:00`);
  const diffDays = Math.round((t.getTime() - n.getTime()) / 86400000);
  if (diffDays === 1) return "Morgen";
  if (diffDays < 0) return "Verlopen";
  return formatDateShort(`${ymd}T12:00:00`);
}

function maskIban(iban: string): string {
  const clean = iban.replace(/\s+/g, "").toUpperCase();
  if (clean.length < 10) return iban;
  return `${clean.slice(0, 4)} ${clean.slice(4, 8)} •••• ${clean.slice(-3)}`;
}

function detailStatusLabel(status: string, tab: MainTab): string {
  if (tab === "concept_ab" || status === "concept" || status === "verzonden") {
    return "Te controleren";
  }
  if (tab === "te_betalen" || status === "goedgekeurd") return "Te betalen";
  if (status === "betaald") return "Betaald";
  if (status === "preview") return "Vooruitblik";
  return status;
}

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
  if (
    isOpsCommissieCreditfactuur({
      factuur_nummer: nummer,
      notities: meta?.notities,
    })
  ) {
    return { kind: "ops", label: "Opscommissie" };
  }
  if (
    isBelcommissieCreditfactuur({
      factuur_nummer: nummer,
      notities: meta?.notities,
    })
  ) {
    return { kind: "bel", label: "Belcommissie" };
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

function initialsFromName(naam: string): string {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] || ""}${parts[parts.length - 1]![0] || ""}`.toUpperCase();
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
      <Badge
        variant="secondary"
        className="border-transparent bg-emerald-50 text-emerald-700"
        title={
          betaald_op ? `Betaald ${formatDateShort(betaald_op)}` : "Betaald"
        }
      >
        Betaald
      </Badge>
    );
  }
  if (status === "goedgekeurd") {
    return (
      <Badge
        variant="secondary"
        className="border-transparent bg-amber-50 text-amber-800"
        title={
          goedgekeurd_op
            ? `Te betalen sinds ${formatDateShort(goedgekeurd_op)}`
            : "Te betalen"
        }
      >
        Te betalen
      </Badge>
    );
  }
  if (status === "verzonden") {
    return (
      <Badge
        variant="secondary"
        className="border-transparent bg-orange-50 text-orange-800"
      >
        Wacht op acceptatie
      </Badge>
    );
  }
  if (status === "concept") {
    return <Badge variant="outline">Concept</Badge>;
  }
  if (status === "preview") {
    return (
      <Badge
        variant="secondary"
        className="border-transparent bg-amber-50 text-amber-800"
      >
        Vooruitblik
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="capitalize">
      {status}
    </Badge>
  );
}

function CopyMini({
  copied,
  onCopy,
}: {
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={(e) => {
        e.stopPropagation();
        onCopy();
      }}
      title={copied ? "Gekopieerd" : "Kopieer"}
    >
      {copied ? "✓" : <Copy className="size-3" />}
    </Button>
  );
}

function amountQueryToCents(raw: string): number | null {
  let s = raw.replace(/€/gi, "").replace(/\s/g, "");
  if (!s || !/\d/.test(s)) return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
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
  const [categorieFilter, setCategorieFilter] =
    useState<CategorieFilter>("alles");
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
  const [editOpen, setEditOpen] = useState(false);
  const [editRows, setEditRows] = useState<InboxRow[]>([]);
  const [editFactuurId, setEditFactuurId] = useState("");
  const [editRegels, setEditRegels] = useState<
    { omschrijving: string; bedrag: string }[]
  >([]);
  const [aftrekBedrag, setAftrekBedrag] = useState("");
  const [aftrekOmschrijving, setAftrekOmschrijving] = useState("");
  const [editOpenKosten, setEditOpenKosten] = useState<AdviseurKosten[]>([]);
  const [editSelectedKostenIds, setEditSelectedKostenIds] = useState<string[]>(
    []
  );
  const [editSaving, setEditSaving] = useState(false);
  const [detailGroup, setDetailGroup] = useState<PayoutGroup | null>(null);
  const [detailFactuurId, setDetailFactuurId] = useState("");

  const refreshAdvFacturen = useCallback(async () => {
    const advRes = await fetch("/api/adviseurs/creditfacturen");
    const advData = await advRes.json().catch(() => ({}));
    if (!advRes.ok) return false;
    setAllAdvFacturen(
      ((advData as { facturen?: OverviewFactuur[] }).facturen ||
        []) as OverviewFactuur[]
    );
    setAdviseurs(
      ((advData as { adviseurs?: Adviseur[] }).adviseurs || []) as Adviseur[]
    );
    return true;
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Snelle first paint: alleen bestaande facturen (read-only GETs).
      const [advRes, partRes] = await Promise.all([
        fetch("/api/adviseurs/creditfacturen"),
        fetch("/api/partners/creditfacturen"),
      ]);
      const advData = await advRes.json().catch(() => ({}));
      const partData = await partRes.json().catch(() => ({}));
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

  /** Preview + ensure op de achtergrond (blokkeert first paint niet). */
  const backgroundSyncDone = useRef(false);
  useEffect(() => {
    if (loading || backgroundSyncDone.current) return;
    backgroundSyncDone.current = true;
    void (async () => {
      try {
        const [toeRes, ensureRes] = await Promise.all([
          fetch("/api/adviseurs/creditfacturen/toekomstig"),
          fetch("/api/adviseurs/creditfacturen/ensure", { method: "POST" }),
        ]);
        const toeData = await toeRes.json().catch(() => ({}));
        if (toeRes.ok) {
          setToekomstig(toeData as ToekomstigeCreditfacturenPreview);
        }

        // Ensure kan bedragen/regels wijzigen of bel-/opsconcepten toevoegen.
        if (ensureRes.ok) {
          await ensureRes.json().catch(() => ({}));
          await refreshAdvFacturen();
        }

        const nieuw = Number(
          (toeData as ToekomstigeCreditfacturenPreview)?.totals?.nieuw || 0
        );
        if (toeRes.ok && nieuw > 0) {
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
            await refreshAdvFacturen();
            setToekomstig(json as ToekomstigeCreditfacturenPreview);
          }
        }
      } catch {
        /* stil — handmatige knop blijft beschikbaar */
      }
    })();
  }, [
    loading,
    refreshAdvFacturen,
    weekDaarvoor.week,
    vorigeWeek.week,
  ]);

  /** Vooruit-preview pas laden als die scope actief is. */
  useEffect(() => {
    if (weekScope !== "vooruit") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          "/api/adviseurs/creditfacturen/toekomstig?mode=vooruit"
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setToekomstigVooruit(data as ToekomstigeCreditfacturenPreview);
      } catch {
        if (!cancelled) setToekomstigVooruit(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekScope]);

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
      const keepCallcenter =
        isBelcommissieCreditfactuur(f) || isOpsCommissieCreditfactuur(f);
      if (
        !keepCallcenter &&
        f.adviseurs &&
        isUitgeslotenVanSalesCommissie(f.adviseurs)
      ) {
        continue;
      }
      const { kind, label } = parseKind("adviseur", f.factuur_nummer, {
        notities: f.notities,
      });
      const naam = f.adviseurs?.naam || "Onbekend";
      const rol = f.adviseurs?.rol
        ? normalizeRol(f.adviseurs.rol)
        : null;
      const categorie = resolvePayoutCategorie({
        kind,
        rol: f.adviseurs?.rol,
      });
      const context = extractContext({ notities: f.notities });
      const iban = f.adviseurs?.iban?.trim() || null;
      const bedrijfsnaam = f.adviseurs?.bedrijfsnaam?.trim() || null;
      out.push({
        key: `a:${f.id}`,
        source: "adviseur",
        id: f.id,
        relatieId: f.adviseur_id,
        relatieNaam: naam,
        kvkOk: !kvkIncompleet(f.adviseurs || {}),
        iban,
        bedrijfsnaam,
        nummer: f.factuur_nummer,
        kind,
        kindLabel: label,
        categorie,
        rol,
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
          context,
          label,
          PAYOUT_CATEGORIE_LABEL[categorie],
          bedrijfsnaam,
          iban,
          f.week_nummer != null ? `W${f.week_nummer} week${f.week_nummer}` : null,
          String(f.bedrag_ex_btw ?? ""),
          String(f.bedrag_inc_btw ?? ""),
        ]
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
      const categorie = resolvePayoutCategorie({ kind });
      const context = extractContext({
        notities: f.notities,
        omschrijving: f.omschrijving,
        offerte_nummer: f.offerte_nummer,
        project_nummer: f.project_nummer,
      });
      const iban = f.installatie_partners?.iban?.trim() || null;
      const bedrijfsnaam =
        f.installatie_partners?.bedrijfsnaam?.trim() || null;
      out.push({
        key: `p:${f.id}`,
        source: "partner",
        id: f.id,
        relatieId: f.partner_id,
        relatieNaam: naam,
        kvkOk: !kvkIncompleet(f.installatie_partners || {}),
        iban,
        bedrijfsnaam,
        nummer: f.factuur_nummer,
        kind,
        kindLabel: label,
        categorie,
        rol: null,
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
          PAYOUT_CATEGORIE_LABEL[categorie],
          bedrijfsnaam,
          iban,
          f.week_nummer != null ? `W${f.week_nummer} week${f.week_nummer}` : null,
          String(f.bedrag_ex_btw ?? ""),
          String(f.bedrag_inc_btw ?? ""),
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
      // Zonder IBAN betalen we niet uit → niet in concepten tonen
      if (!r.iban?.trim()) return false;
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
      if (categorieFilter !== "alles" && r.categorie !== categorieFilter) {
        return false;
      }

      if (tab === "concept_ab") {
        if (r.status !== "concept" && r.status !== "verzonden") return false;
        // Zonder IBAN betalen we niet uit → niet in concepten tonen
        if (!r.iban?.trim()) return false;
        if (weekScope === "vorige" && !inUitbetalingsronde(r)) return false;
        if (weekScope === "vooruit") {
          // Vooruitblik: sales-concepten van de aankomende week; bel/ops/installatie niet
          if (
            r.kind === "installatie" ||
            r.kind === "bel" ||
            r.kind === "ops"
          ) {
            return false;
          }
          if (r.kind === "sales" && !inVooruitWeek(r)) return false;
        }
      } else if (tab === "te_betalen") {
        if (r.status !== "goedgekeurd") return false;
      } else if (tab === "betaald") {
        if (r.status !== "betaald") return false;
      }

      if (q) {
        const tokens = q.split(/\s+/).filter(Boolean);
        const hayRaw = [
          r.searchText,
          r.relatieNaam,
          r.nummer,
          r.bedrijfsnaam,
          r.iban,
          r.context,
          r.kindLabel,
          PAYOUT_CATEGORIE_LABEL[r.categorie],
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const hayNorm = normalizeSearchToken(hayRaw);
        const allHit = tokens.every((token) => {
          const cents = amountQueryToCents(token);
          if (
            cents != null &&
            (Math.round(Math.abs(r.bedragEx) * 100) === cents ||
              Math.round(Math.abs(r.bedragInc) * 100) === cents)
          ) {
            return true;
          }
          if (hayRaw.includes(token)) return true;
          return hayNorm.includes(normalizeSearchToken(token));
        });
        if (!allHit) return false;
      }
      return true;
    });
  }, [
    rows,
    categorieFilter,
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

  function payoutKenmerk(kind: PayoutKind, list: InboxRow[]): string {
    const prefix =
      kind === "sales"
        ? "betaalcommissie"
        : kind === "bel"
          ? "belcommissie"
          : kind === "ops"
            ? "opscommissie"
            : "installatie";
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
    kind: PayoutKind,
    list: InboxRow[],
    opts?: { individual?: boolean }
  ): PayoutGroup[] {
    /** Betaald: elke factuur apart (zoekbaar op nummer). */
    if (opts?.individual) {
      return [...list]
        .map((r) => {
          const categorie =
            r.categorie ||
            resolvePayoutCategorie({ kind: r.kind, rol: r.rol });
          return {
            key: `${kind}:factuur:${r.id}`,
            kind,
            categorie,
            relatieId: r.relatieId,
            relatieNaam: r.relatieNaam,
            bedrijfsnaam: r.bedrijfsnaam,
            iban: r.iban,
            kvkOk: r.kvkOk,
            bedragEx: r.bedragEx,
            bedragInc: r.bedragInc,
            kenmerk: payoutKenmerk(kind, [r]),
            deadline: payoutDeadlineYmd([r]),
            rows: [r],
            status: r.status,
          } satisfies PayoutGroup;
        })
        .sort(
          (a, b) =>
            a.relatieNaam.localeCompare(b.relatieNaam, "nl") ||
            (a.rows[0]?.nummer || "").localeCompare(
              b.rows[0]?.nummer || "",
              "nl"
            )
        );
    }

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
      const categorie =
        first.categorie ||
        resolvePayoutCategorie({ kind: first.kind, rol: first.rol });
      groups.push({
        key: `${kind}:${relatieId}`,
        kind,
        categorie,
        relatieId,
        relatieNaam: first.relatieNaam,
        bedrijfsnaam: first.bedrijfsnaam,
        iban: first.iban,
        kvkOk: personRows.every((r) => r.kvkOk),
        bedragEx: personRows.reduce((s, r) => s + r.bedragEx, 0),
        bedragInc: personRows.reduce((s, r) => s + r.bedragInc, 0),
        kenmerk: payoutKenmerk(kind, personRows),
        deadline: payoutDeadlineYmd(personRows),
        rows: personRows,
        status: statuses.length === 1 ? statuses[0] : "mixed",
      });
    }
    groups.sort((a, b) => a.relatieNaam.localeCompare(b.relatieNaam, "nl"));
    return groups;
  }

  const individualPayouts = tab === "betaald";

  const salesPayoutGroups = useMemo(() => {
    const fromFacturen = buildPayoutGroups(
      "sales",
      filtered.filter((r) => r.kind === "sales" || r.kind === "wf"),
      { individual: individualPayouts }
    );
    if (weekScope !== "vooruit" || !toekomstigVooruit || individualPayouts) {
      return fromFacturen;
    }

    // 1 week vooruit: merge bestaande concepten + preview uit aanbetalingen deze week
    const byId = new Map(fromFacturen.map((g) => [g.relatieId, g]));
    const weekLabel = toekomstigVooruit.week.week;
    const kenmerk = `betaalcommissie W${weekLabel}`;
    const previewDeadline = toekomstigVooruit.week.betaalWoensdag;
    const needle = q;

    for (const p of toekomstigVooruit.perAdviseur) {
      if (needle) {
        const hay = normalizeSearchToken(`${p.naam} ${p.id}`);
        const tokens = needle.split(/\s+/).filter(Boolean);
        if (
          !tokens.every(
            (t) =>
              p.naam.toLowerCase().includes(t) ||
              hay.includes(normalizeSearchToken(t))
          )
        ) {
          continue;
        }
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
            deadline: existing.deadline ?? previewDeadline,
            previewOrders: p.orders,
          });
        }
        continue;
      }
      const adv = adviseurs.find((a) => a.id === p.id);
      const iban = adv?.iban?.trim() || null;
      // Zonder IBAN niet in concepten / vooruitblik
      if (!iban) continue;
      const kvkOk = Boolean(
        adv?.bedrijfsnaam && adv?.kvk_nummer && adv?.iban
      );
      const previewCategorie = resolvePayoutCategorie({
        kind: "sales",
        rol: adv?.rol,
      });
      if (
        categorieFilter !== "alles" &&
        previewCategorie !== categorieFilter
      ) {
        continue;
      }
      byId.set(p.id, {
        key: `preview-sales:${p.id}`,
        kind: "sales",
        categorie: previewCategorie,
        relatieId: p.id,
        relatieNaam: p.naam,
        bedrijfsnaam: adv?.bedrijfsnaam?.trim() || null,
        iban,
        kvkOk,
        bedragEx: p.bedragExBtw,
        bedragInc: Math.round(p.bedragExBtw * 1.21 * 100) / 100,
        kenmerk,
        deadline: previewDeadline,
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
    categorieFilter,
    vorigeWeek.week,
    individualPayouts,
  ]);

  const belPayoutGroups = useMemo(
    () =>
      weekScope === "vooruit"
        ? []
        : buildPayoutGroups(
            "bel",
            filtered.filter((r) => r.kind === "bel"),
            { individual: individualPayouts }
          ),
    [filtered, weekScope, vorigeWeek.week, individualPayouts]
  );

  const opsPayoutGroups = useMemo(
    () =>
      weekScope === "vooruit"
        ? []
        : buildPayoutGroups(
            "ops",
            filtered.filter((r) => r.kind === "ops"),
            { individual: individualPayouts }
          ),
    [filtered, weekScope, vorigeWeek.week, individualPayouts]
  );

  const installatiePayoutGroups = useMemo(
    () =>
      weekScope === "vooruit"
        ? []
        : buildPayoutGroups(
            "installatie",
            filtered.filter((r) => r.kind === "installatie"),
            { individual: individualPayouts }
          ),
    [filtered, weekScope, vorigeWeek.week, individualPayouts]
  );

  const otherFilteredRows = useMemo(
    () =>
      filtered.filter(
        (r) =>
          r.kind !== "sales" &&
          r.kind !== "wf" &&
          r.kind !== "bel" &&
          r.kind !== "ops" &&
          r.kind !== "installatie"
      ),
    [filtered]
  );

  const allPayoutGroups = useMemo(
    () => [
      ...salesPayoutGroups,
      ...belPayoutGroups,
      ...opsPayoutGroups,
      ...installatiePayoutGroups,
    ],
    [
      salesPayoutGroups,
      belPayoutGroups,
      opsPayoutGroups,
      installatiePayoutGroups,
    ]
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

  function notitiesForRow(row: InboxRow): string | null {
    if (row.source === "adviseur") {
      return (
        allAdvFacturen.find((f) => f.id === row.id)?.notities ?? null
      );
    }
    return (
      allPartnerFacturen.find((f) => f.id === row.id)?.notities ?? null
    );
  }

  function loadEditRegelsForRow(row: InboxRow) {
    const notes = notitiesForRow(row);
    const parsed = parseCreditRegels(notes);
    const regels =
      parsed && parsed.length > 0
        ? parsed
        : [
            {
              omschrijving: `Vergoeding ${row.nummer}`,
              bedrag: row.bedragEx,
            },
          ];
    setEditRegels(
      regels.map((r) => ({
        omschrijving: r.omschrijving,
        bedrag: String(r.bedrag),
      }))
    );
  }

  async function loadOpenKostenForRow(row: InboxRow) {
    if (row.source !== "adviseur") {
      setEditOpenKosten([]);
      setEditSelectedKostenIds([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/adviseurs/kosten?adviseur_id=${encodeURIComponent(row.relatieId)}&status=open`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditOpenKosten([]);
        setEditSelectedKostenIds([]);
        return;
      }
      const list = ((data.kosten || []) as AdviseurKosten[]).map((k) => ({
        ...k,
        bedrag_ex_btw: Number(k.bedrag_ex_btw) || 0,
      }));
      setEditOpenKosten(list);
      setEditSelectedKostenIds(list.map((k) => k.id));
    } catch {
      setEditOpenKosten([]);
      setEditSelectedKostenIds([]);
    }
  }

  function openEditConcept(rows: InboxRow[]) {
    const editable = rows.filter(
      (r) => r.status === "concept" || r.status === "verzonden"
    );
    if (editable.length === 0) return;
    setDetailGroup(null);
    setEditRows(editable);
    setEditFactuurId(editable[0]!.id);
    loadEditRegelsForRow(editable[0]!);
    setAftrekBedrag("");
    setAftrekOmschrijving("");
    setEditOpenKosten([]);
    setEditSelectedKostenIds([]);
    setEditOpen(true);
    void loadOpenKostenForRow(editable[0]!);
  }

  function openDetail(group: PayoutGroup) {
    if (group.preview && group.rows.length === 0) {
      setDetailGroup(group);
      setDetailFactuurId("");
      return;
    }
    setDetailGroup(group);
    setDetailFactuurId(group.rows[0]?.id || "");
  }

  function openDetailFromRow(row: InboxRow) {
    openDetail({
      key: `detail:${row.key}`,
      kind: kindToPayoutKind(row.kind),
      categorie: row.categorie,
      relatieId: row.relatieId,
      relatieNaam: row.relatieNaam,
      bedrijfsnaam: row.bedrijfsnaam,
      iban: row.iban,
      kvkOk: row.kvkOk,
      bedragEx: row.bedragEx,
      bedragInc: row.bedragInc,
      kenmerk: row.context || row.nummer,
      deadline: payoutDeadlineYmd([row]),
      rows: [row],
      status: row.status,
    });
  }

  function rawFactuurForRow(row: InboxRow): OverviewFactuur | PartnerOverview | null {
    if (row.source === "adviseur") {
      return allAdvFacturen.find((f) => f.id === row.id) || null;
    }
    return allPartnerFacturen.find((f) => f.id === row.id) || null;
  }

  function adviseurForRow(row: InboxRow): Adviseur | null {
    if (row.source !== "adviseur") return null;
    return adviseurs.find((a) => a.id === row.relatieId) || null;
  }

  async function submitEditRegels() {
    const row = editRows.find((r) => r.id === editFactuurId) || editRows[0];
    if (!row) return;
    const regels = editRegels
      .map((r) => ({
        omschrijving: r.omschrijving.trim(),
        bedrag: Number(String(r.bedrag).replace(",", ".")),
      }))
      .filter((r) => r.omschrijving.length > 0);
    if (regels.length === 0) {
      setError("Minstens één regel is verplicht.");
      return;
    }
    if (regels.some((r) => !Number.isFinite(r.bedrag))) {
      setError("Alle bedragen moeten geldig zijn.");
      return;
    }
    const som = Math.round(regels.reduce((s, r) => s + r.bedrag, 0) * 100) / 100;
    if (som < 0) {
      setError("Totaal mag niet onder €0.");
      return;
    }
    setEditSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(payoutApiUrl(row), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, regels }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Opslaan mislukt"
        );
      }
      const nummer =
        (json as { factuur?: { factuur_nummer?: string } }).factuur
          ?.factuur_nummer || row.nummer;
      setOkMsg(
        `Concept ${nummer} bijgewerkt · ${formatEuro(som)} excl.`
      );
      setEditOpen(false);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setEditSaving(false);
    }
  }

  async function submitAftrek() {
    const row = editRows.find((r) => r.id === editFactuurId) || editRows[0];
    if (!row) return;
    const aftrek = Number(String(aftrekBedrag).replace(",", "."));
    if (!Number.isFinite(aftrek) || aftrek <= 0) {
      setError("Vul een aftrekbedrag groter dan 0 in.");
      return;
    }
    setEditSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(payoutApiUrl(row), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          aftrek_ex_btw: aftrek,
          aftrek_omschrijving: aftrekOmschrijving.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Aftrek mislukt"
        );
      }
      const nummer =
        (json as { factuur?: { factuur_nummer?: string } }).factuur
          ?.factuur_nummer || row.nummer;
      setOkMsg(
        `Aftrek op ${nummer}: −${formatEuro(aftrek)} excl. bijgewerkt.`
      );
      setEditOpen(false);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aftrek mislukt");
    } finally {
      setEditSaving(false);
    }
  }

  async function submitKostenAftrek() {
    const row = editRows.find((r) => r.id === editFactuurId) || editRows[0];
    if (!row || row.source !== "adviseur") return;
    if (editSelectedKostenIds.length === 0) {
      setError("Selecteer minstens één open kostenpost.");
      return;
    }
    const som = editOpenKosten
      .filter((k) => editSelectedKostenIds.includes(k.id))
      .reduce((s, k) => s + (Number(k.bedrag_ex_btw) || 0), 0);
    if (som > row.bedragEx + 0.001) {
      setError(
        `Geselecteerde kosten (${formatEuro(som)}) zijn hoger dan het factuurbedrag (${formatEuro(row.bedragEx)}).`
      );
      return;
    }
    setEditSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/adviseurs/creditfacturen", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          kosten_ids: editSelectedKostenIds,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Kosten aftrekken mislukt"
        );
      }
      const nummer =
        (json as { factuur?: { factuur_nummer?: string } }).factuur
          ?.factuur_nummer || row.nummer;
      const n =
        (json as { kosten_ingedekt?: number }).kosten_ingedekt ||
        editSelectedKostenIds.length;
      setOkMsg(
        `${n} kostenpost(en) afgetrokken op ${nummer} (−${formatEuro(som)} excl.).`
      );
      setEditOpen(false);
      await loadAll();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Kosten aftrekken mislukt"
      );
    } finally {
      setEditSaving(false);
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
      setDetailGroup(null);
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
      setDetailGroup(null);
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

  const payoutSections = PAYOUT_CATEGORIE_ORDER.map((cat) => {
    const groups = allPayoutGroups.filter((g) => g.categorie === cat);
    return [PAYOUT_CATEGORIE_LABEL[cat], groups] as const;
  }).filter(([, groups]) => groups.length > 0);

  function renderPayoutRow(g: PayoutGroup) {
    const busy = busyId === g.key || busyId === `pdf-${g.key}`;
    const canBevestig =
      !g.preview &&
      tab === "concept_ab" &&
      g.rows.some((r) => r.status === "concept" || r.status === "verzonden");
    const canBetaald =
      !g.preview &&
      tab === "te_betalen" &&
      g.rows.every((r) => r.status === "goedgekeurd");
    const isBetaald = tab === "betaald" || g.status === "betaald";
    const primaryNummer = g.preview
      ? null
      : g.rows.map((r) => r.nummer).filter(Boolean)[0] || null;
    const extraNummers = g.preview
      ? 0
      : Math.max(0, g.rows.map((r) => r.nummer).filter(Boolean).length - 1);
    const orderCount =
      g.preview && g.previewOrders ? g.previewOrders : g.rows.length;
    const statusKey = g.preview
      ? "preview"
      : isBetaald
        ? "betaald"
        : g.status === "mixed"
          ? "concept"
          : g.status;
    const cell = "h-9 px-2 py-0 align-middle";
    const stopBtn = (e: ReactMouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("button")) e.stopPropagation();
    };
    return (
      <TableRow
        key={g.key}
        role="button"
        tabIndex={0}
        className="cursor-pointer hover:bg-wash/70"
        onClick={() => openDetail(g)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openDetail(g);
          }
        }}
      >
        <TableCell className={cell} onClick={stopBtn}>
          <div className="flex items-center gap-0.5">
            {g.preview ? (
              <span className="truncate text-[11px] text-muted-foreground">
                {g.previewOrders ?? 0}× aanbet.
              </span>
            ) : primaryNummer ? (
              <>
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground"
                  title={g.rows.map((r) => r.nummer).join(" · ")}
                >
                  {primaryNummer}
                  {extraNummers > 0 ? ` +${extraNummers}` : ""}
                </span>
                <CopyMini
                  copied={copiedKey === `${g.key}:factuur`}
                  onCopy={() =>
                    void copyField(`${g.key}:factuur`, primaryNummer)
                  }
                />
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground">—</span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              disabled={busy || g.preview || g.rows.length === 0}
              title="PDF"
              onClick={() => void downloadPayoutGroupPdfs(g)}
            >
              <FileText className="size-3.5" />
            </Button>
          </div>
        </TableCell>
        <TableCell className={cell}>
          <span
            className="block truncate text-[13px] font-medium text-foreground"
            title={
              [g.bedrijfsnaam, !g.kvkOk ? "KvK/IBAN ontbreekt" : null]
                .filter(Boolean)
                .join(" · ") || undefined
            }
          >
            {g.relatieNaam}
          </span>
        </TableCell>
        <TableCell className={cn(cell, "text-right")}>
          <span
            className="block tabular-nums text-[13px] font-semibold text-foreground"
            title={`${formatEuro(g.bedragInc)} incl.${orderCount > 1 ? ` · ${orderCount}×` : ""}`}
          >
            {formatEuro(g.bedragEx)}
          </span>
        </TableCell>
        <TableCell className={cell} onClick={stopBtn}>
          <div className="flex items-center gap-0.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
              {g.iban || "—"}
            </span>
            {g.iban ? (
              <CopyMini
                copied={copiedKey === `${g.key}:iban`}
                onCopy={() => void copyField(`${g.key}:iban`, g.iban!)}
              />
            ) : null}
          </div>
        </TableCell>
        <TableCell className={cell} onClick={stopBtn}>
          <div className="flex items-center gap-0.5">
            <span
              className="min-w-0 flex-1 truncate text-[11px] text-foreground"
              title={g.kenmerk}
            >
              {g.kenmerk}
            </span>
            <CopyMini
              copied={copiedKey === `${g.key}:kenmerk`}
              onCopy={() => void copyField(`${g.key}:kenmerk`, g.kenmerk)}
            />
          </div>
        </TableCell>
        {tab === "te_betalen" ? (
          <TableCell className={cell}>
            <span
              className={cn(
                "text-[11px] font-medium tabular-nums",
                !g.deadline
                  ? "text-muted-foreground"
                  : g.deadline < todayYmdAmsterdam()
                    ? "text-orange-700"
                    : g.deadline === todayYmdAmsterdam()
                      ? "text-emerald-700"
                      : "text-foreground"
              )}
              title={
                g.deadline
                  ? formatDeadlineLabel(g.deadline)
                  : undefined
              }
            >
              {formatDeadlineShort(g.deadline)}
            </span>
          </TableCell>
        ) : null}
        <TableCell className={cell}>
          <StatusBadge
            status={statusKey}
            goedgekeurd_op={null}
            betaald_op={
              isBetaald
                ? g.rows.find((r) => r.betaald_op)?.betaald_op || null
                : null
            }
          />
        </TableCell>
        <TableCell className={cn(cell, "text-right")} onClick={stopBtn}>
          <div className="inline-flex items-center justify-end gap-1">
            {canBevestig ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="h-7 px-1.5"
                disabled={busy}
                onClick={() => openEditConcept(g.rows)}
                title="Bewerken"
              >
                <Pencil className="size-3" />
              </Button>
            ) : null}
            {canBevestig ? (
              <Button
                type="button"
                size="xs"
                className="h-7 bg-orange px-2 text-[11px] text-white hover:bg-orange/90"
                disabled={busy || !g.kvkOk}
                onClick={() => void bevestigPayoutGroup(g)}
                title={!g.kvkOk ? "Vul eerst ZZP-gegevens in" : "Bevestig"}
              >
                Bevestig
              </Button>
            ) : null}
            {canBetaald ? (
              <Button
                type="button"
                size="xs"
                className="h-7 px-2 text-[11px]"
                disabled={busy}
                onClick={() => void markPayoutGroupBetaald(g)}
              >
                Betaald
              </Button>
            ) : null}
            {!canBevestig && !canBetaald ? (
              <span className="text-[11px] text-muted-foreground">—</span>
            ) : null}
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <div className={cn("space-y-4", embedded && "space-y-3")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {!embedded ? (
            <>
              <h2 className="font-heading text-xl font-semibold tracking-tight text-foreground">
                Uitbetalingen
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Per persoon één bedrag · bevestigen → betalen → afgerond
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Concept a.b. · te betalen · betaald
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {nieuwCount > 0 ? (
            <Button
              type="button"
              variant="secondary"
              disabled={creatingConcepts}
              onClick={() => void maakConcepten()}
            >
              {creatingConcepts
                ? "Bezig…"
                : `Maak ${nieuwCount} concept${nieuwCount === 1 ? "" : "en"}`}
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => {
              setShowCreate((v) => !v);
              setError(null);
              setOkMsg(null);
              if (showCreate) resetCreateForm();
            }}
          >
            {showCreate ? (
              "Sluiten"
            ) : (
              <>
                <Plus data-icon="inline-start" />
                Nieuwe factuur
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full max-w-xl">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek naam, factuurnr, IBAN, kenmerk, bedrag, W45…"
            className="bg-background pl-8"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab === "concept_ab" ? (
            <NativeSelect
              value={weekScope}
              onChange={(e) => setWeekScope(e.target.value as WeekScope)}
              className="min-w-[14rem]"
            >
              <NativeSelectOption value="vorige">
                W{weekDaarvoor.week}+W{vorigeWeek.week} (+ openstaand)
              </NativeSelectOption>
              <NativeSelectOption value="vooruit">
                W{toekomstigVooruit?.week.week ?? huidigeWeek.week} · 1 week
                vooruit
              </NativeSelectOption>
              <NativeSelectOption value="alles">Alle weken</NativeSelectOption>
            </NativeSelect>
          ) : null}
          <NativeSelect
            value={categorieFilter}
            onChange={(e) =>
              setCategorieFilter(e.target.value as CategorieFilter)
            }
            className="min-w-[10rem]"
          >
            <NativeSelectOption value="alles">Alle categorieën</NativeSelectOption>
            <NativeSelectOption value="adviseur">Adviseur</NativeSelectOption>
            <NativeSelectOption value="beller">Beller</NativeSelectOption>
            <NativeSelectOption value="operations">Operations</NativeSelectOption>
            <NativeSelectOption value="directie">Directie</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            {
              id: "concept_ab" as MainTab,
              label: "Concept a.b.",
              value: String(tabCounts.concept_ab),
              hint: `${formatEuro(tabCounts.conceptEuro)} excl.`,
            },
            {
              id: "te_betalen" as MainTab,
              label: "Te betalen",
              value: String(tabCounts.te_betalen),
              hint: `${formatEuro(tabCounts.teBetalenEuro)} excl.`,
            },
            {
              id: "betaald" as MainTab,
              label: "Betaald",
              value: String(tabCounts.betaald),
              hint: "Afgeronde uitbetalingen",
            },
          ] as const
        ).map((card) => {
          const active = tab === card.id;
          return (
            <button
              key={card.label}
              type="button"
              onClick={() => setTab(card.id)}
              className={cn(
                "rounded-xl border bg-card p-4 text-left shadow-xs transition hover:bg-wash/60",
                active && "ring-2 ring-ring"
              )}
            >
              <p className="text-xs font-medium text-muted-foreground">
                {card.label}
              </p>
              <p className="mt-2 font-heading text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                {card.value}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
            </button>
          );
        })}
      </div>

      {bannerPreview && tab === "concept_ab" ? (
        <Card size="sm" className="bg-wash/40 shadow-none ring-border/60">
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardDescription>
                {weekScope === "vooruit"
                  ? "1 week vooruit · volgende uitbetaling"
                  : "Aankomende betaling"}
              </CardDescription>
              <CardTitle className="mt-1">
                {bannerPreview.betaalLabel}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Week {bannerPreview.week.week} ·{" "}
                {formatDateShort(`${bannerPreview.week.van}T12:00:00`)} –{" "}
                {formatDateShort(`${bannerPreview.week.tot}T12:00:00`)} ·{" "}
                {bannerPreview.totals.orders} order
                {bannerPreview.totals.orders === 1 ? "" : "s"}
                {nieuwCount > 0 ? ` · ${nieuwCount} nog zonder concept` : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="font-heading text-xl font-semibold tabular-nums">
                {formatEuro(bannerPreview.totals.bedragExBtw)}
              </p>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={() =>
                  setWeekScope(weekScope === "vooruit" ? "vorige" : "vooruit")
                }
              >
                {weekScope === "vooruit"
                  ? "← Terug naar uitbetalingsronde"
                  : "Bekijk 1 week vooruit →"}
              </Button>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      {showCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Nieuwe factuur</CardTitle>
            <CardDescription>
              Sales, Warmtefonds of installatie-concept aanmaken
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["sales", "Sales"],
                  ["wf", "WF"],
                  ["installatie", "Installatie"],
                ] as const
              ).map(([id, label]) => (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={createKind === id ? "default" : "outline"}
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
                >
                  {label}
                </Button>
              ))}
            </div>

            {createKind === "sales" ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={createMode === "handmatig" ? "default" : "outline"}
                    onClick={() => {
                      setCreateMode("handmatig");
                      setCreateBedrag(String(VERKOPER_AANBETALING_FEE));
                    }}
                  >
                    Handmatig
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={createMode === "deal" ? "default" : "outline"}
                    onClick={() => {
                      setCreateMode("deal");
                      setCreateBedrag("");
                    }}
                  >
                    Vanuit deal
                  </Button>
                </div>

                {createMode === "handmatig" ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                      Verkoper
                      <NativeSelect
                        value={createAdviseurId}
                        onChange={(e) => setCreateAdviseurId(e.target.value)}
                        className="w-full"
                      >
                        <NativeSelectOption value="">Kies…</NativeSelectOption>
                        {salesAdviseurs.map((a) => (
                          <NativeSelectOption key={a.id} value={a.id}>
                            {a.naam}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                    <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                      Bedrag excl. btw
                      <Input
                        inputMode="decimal"
                        value={createBedrag}
                        onChange={(e) => setCreateBedrag(e.target.value)}
                      />
                    </label>
                    <label className="block space-y-1.5 text-xs font-medium text-muted-foreground sm:col-span-2">
                      Omschrijving (optioneel)
                      <Input
                        value={createOmschrijving}
                        onChange={(e) => setCreateOmschrijving(e.target.value)}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="block max-w-md space-y-1.5 text-xs font-medium text-muted-foreground">
                      Zoek deal
                      <Input
                        type="search"
                        value={dealQuery}
                        onChange={(e) => setDealQuery(e.target.value)}
                        placeholder="Klant, plaats of offertenr…"
                      />
                    </label>
                    <div className="max-h-48 overflow-y-auto rounded-lg border">
                      {dealsLoading ? (
                        <p className="px-3 py-4 text-sm text-muted-foreground">
                          Laden…
                        </p>
                      ) : dealOptions.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-muted-foreground">
                          Geen deals gevonden.
                        </p>
                      ) : (
                        <ul className="divide-y">
                          {dealOptions.map((d) => {
                            const selected = selectedOfferteId === d.offerte_id;
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
                                  className={cn(
                                    "flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-sm",
                                    selected ? "bg-primary/5" : "hover:bg-wash"
                                  )}
                                >
                                  <span>
                                    <span className="font-medium text-foreground">
                                      {d.klant_naam}
                                    </span>
                                    <span className="mt-0.5 block text-xs text-muted-foreground">
                                      {d.offerte_nummer || "Offerte"}
                                      {d.adviseur_naam
                                        ? ` · ${d.adviseur_naam}`
                                        : ""}
                                      {` · ${formatEuro(d.bedrag_ex_btw)} excl.`}
                                    </span>
                                  </span>
                                  {selected ? (
                                    <Badge variant="secondary">Gekozen</Badge>
                                  ) : null}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={createTranche === "a" ? "default" : "outline"}
                        onClick={() => setCreateTranche("a")}
                      >
                        A · aanbetaling
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={createTranche === "b" ? "default" : "outline"}
                        onClick={() => setCreateTranche("b")}
                      >
                        B · rest / netto
                      </Button>
                    </div>
                    <label className="block max-w-xs space-y-1.5 text-xs font-medium text-muted-foreground">
                      Bedrag excl. (leeg = automatisch)
                      <Input
                        inputMode="decimal"
                        value={createBedrag}
                        onChange={(e) => setCreateBedrag(e.target.value)}
                        placeholder={
                          createTranche === "b"
                            ? "commissie% − €250"
                            : `€${VERKOPER_AANBETALING_FEE}`
                        }
                      />
                    </label>
                  </div>
                )}
              </>
            ) : createKind === "wf" ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                  Medewerker
                  <NativeSelect
                    value={createAdviseurId}
                    onChange={(e) => setCreateAdviseurId(e.target.value)}
                    className="w-full"
                  >
                    <NativeSelectOption value="">Kies…</NativeSelectOption>
                    {adviseurs
                      .filter((a) => {
                        const n = (a.naam || "").toLowerCase();
                        return !(n.includes("huub") && n.includes("veldman"));
                      })
                      .map((a) => (
                        <NativeSelectOption key={a.id} value={a.id}>
                          {a.naam}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </label>
                <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                  Bedrag excl. btw
                  <Input
                    inputMode="decimal"
                    value={createBedrag}
                    onChange={(e) => setCreateBedrag(e.target.value)}
                  />
                </label>
                <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                  Omschrijving (optioneel)
                  <Input
                    value={createOmschrijving}
                    onChange={(e) => setCreateOmschrijving(e.target.value)}
                  />
                </label>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                  Installateur
                  <NativeSelect
                    value={createPartnerId}
                    onChange={(e) => setCreatePartnerId(e.target.value)}
                    className="w-full"
                  >
                    <NativeSelectOption value="">Kies…</NativeSelectOption>
                    {partners.map((p) => (
                      <NativeSelectOption key={p.id} value={p.id}>
                        {p.naam}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                  Bedrag excl. btw
                  <Input
                    inputMode="decimal"
                    value={createBedrag}
                    onChange={(e) => setCreateBedrag(e.target.value)}
                  />
                </label>
                <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                  Omschrijving (optioneel)
                  <Input
                    value={createOmschrijving}
                    onChange={(e) => setCreateOmschrijving(e.target.value)}
                  />
                </label>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                disabled={creating}
                onClick={() => void submitCreate()}
              >
                {creating ? "Bezig…" : "Maak concept"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={creating}
                onClick={() => {
                  setShowCreate(false);
                  resetCreateForm();
                }}
              >
                Annuleren
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {(error || okMsg) && (
        <div className="space-y-2">
          {error ? (
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
              {error}
            </div>
          ) : null}
          {okMsg ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {okMsg}
            </div>
          ) : null}
        </div>
      )}

      <Card className="shadow-xs">
        <CardHeader className="border-b [.border-b]:pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Uitbetalingslijst</CardTitle>
              <CardDescription>
                {[
                  ...PAYOUT_CATEGORIE_ORDER.map((cat) => {
                    const n = allPayoutGroups.filter(
                      (g) => g.categorie === cat
                    ).length;
                    return n > 0
                      ? `${n} ${PAYOUT_CATEGORIE_LABEL[cat].toLowerCase()}`
                      : null;
                  }),
                  otherFilteredRows.length > 0
                    ? `${otherFilteredRows.length} overig`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") ||
                  `${filtered.length} factuur${filtered.length === 1 ? "" : "en"}`}
                {q ? ` · zoek “${search.trim()}”` : ""}
              </CardDescription>
            </div>
            <Tabs
              value={tab}
              onValueChange={(id) => setTab(id as MainTab)}
            >
              <TabsList>
                <TabsTrigger value="concept_ab">Concept</TabsTrigger>
                <TabsTrigger value="te_betalen">Te betalen</TabsTrigger>
                <TabsTrigger value="betaald">Betaald</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          {loading ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              Laden…
            </p>
          ) : filtered.length === 0 && allPayoutGroups.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
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
              {payoutSections.length > 0 ? (
                <Table className="table-fixed w-full text-[13px]">
                  <colgroup>
                    {tab === "te_betalen" ? (
                      <>
                        <col className="w-[18%]" />
                        <col className="w-[14%]" />
                        <col className="w-[11%]" />
                        <col className="w-[18%]" />
                        <col className="w-[14%]" />
                        <col className="w-[8%]" />
                        <col className="w-[9%]" />
                        <col className="w-[8%]" />
                      </>
                    ) : (
                      <>
                        <col className="w-[20%]" />
                        <col className="w-[16%]" />
                        <col className="w-[12%]" />
                        <col className="w-[20%]" />
                        <col className="w-[15%]" />
                        <col className="w-[9%]" />
                        <col className="w-[8%]" />
                      </>
                    )}
                  </colgroup>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-8 px-2 text-[11px] font-medium text-muted-foreground">
                        Factuur
                      </TableHead>
                      <TableHead className="h-8 px-2 text-[11px] font-medium text-muted-foreground">
                        Relatie
                      </TableHead>
                      <TableHead className="h-8 px-2 text-right text-[11px] font-medium text-muted-foreground">
                        Excl.
                      </TableHead>
                      <TableHead className="h-8 px-2 text-[11px] font-medium text-muted-foreground">
                        IBAN
                      </TableHead>
                      <TableHead className="h-8 px-2 text-[11px] font-medium text-muted-foreground">
                        Kenmerk
                      </TableHead>
                      {tab === "te_betalen" ? (
                        <TableHead className="h-8 px-2 text-[11px] font-medium text-muted-foreground">
                          Deadline
                        </TableHead>
                      ) : null}
                      <TableHead className="h-8 px-2 text-[11px] font-medium text-muted-foreground">
                        Status
                      </TableHead>
                      <TableHead className="h-8 px-2 text-right text-[11px] font-medium text-muted-foreground">
                        Actie
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payoutSections.flatMap(([sectionTitle, groups]) => [
                      <TableRow
                        key={`sec-${sectionTitle}`}
                        className="hover:bg-transparent"
                      >
                        <TableCell
                          colSpan={tab === "te_betalen" ? 8 : 7}
                          className="bg-wash/60 py-1 px-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
                        >
                          {sectionTitle}
                          {weekScope === "vooruit" &&
                          sectionTitle === "Adviseur"
                            ? " · aanbetalingen → volgende wo"
                            : ""}
                        </TableCell>
                      </TableRow>,
                      ...groups.map((g) => renderPayoutRow(g)),
                    ])}
                  </TableBody>
                </Table>
              ) : null}

              {otherFilteredRows.length > 0 ? (
                <div
                  className={cn(
                    payoutSections.length > 0 && "border-t"
                  )}
                >
                  <div className="bg-wash/60 px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Overig
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Relatie</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Deal / project</TableHead>
                        <TableHead className="text-right">Excl.</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Acties</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {otherFilteredRows.map((r) => {
                        const busy =
                          busyId === r.key || busyId === `pdf-${r.key}`;
                        return (
                          <TableRow
                            key={r.key}
                            role="button"
                            tabIndex={0}
                            className="cursor-pointer hover:bg-wash/70"
                            onClick={() => openDetailFromRow(r)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openDetailFromRow(r);
                              }
                            }}
                          >
                            <TableCell>
                              <div className="flex min-w-0 items-center gap-3">
                                <Avatar size="sm">
                                  <AvatarFallback>
                                    {initialsFromName(r.relatieNaam)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <div className="truncate font-medium">
                                    {r.relatieNaam}
                                  </div>
                                  <div className="flex min-w-0 items-center gap-1">
                                    <span className="truncate font-mono text-xs text-muted-foreground">
                                      {r.nummer}
                                    </span>
                                    <CopyMini
                                      copied={copiedKey === `${r.key}:factuur`}
                                      onCopy={() =>
                                        void copyField(
                                          `${r.key}:factuur`,
                                          r.nummer
                                        )
                                      }
                                    />
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">
                                {PAYOUT_CATEGORIE_LABEL[r.categorie]}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-[14rem] truncate text-xs text-muted-foreground">
                              {r.context || "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="font-semibold tabular-nums">
                                {formatEuro(r.bedragEx)}
                              </div>
                              <div className="text-xs tabular-nums text-muted-foreground">
                                {formatEuro(r.bedragInc)} inc.
                              </div>
                            </TableCell>
                            <TableCell>
                              <StatusBadge
                                status={r.status}
                                goedgekeurd_op={r.goedgekeurd_op}
                                betaald_op={r.betaald_op}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <div
                                className="inline-flex flex-wrap justify-end gap-1.5"
                                onClick={(e) => {
                                  const t = e.target as HTMLElement | null;
                                  if (t?.closest("button")) e.stopPropagation();
                                }}
                              >
                                {r.status === "concept" ||
                                r.status === "verzonden" ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    disabled={busy}
                                    onClick={() => openEditConcept([r])}
                                    title="Concept bewerken / aftrek"
                                  >
                                    <Pencil data-icon="inline-start" />
                                    Bewerk
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="xs"
                                  disabled={busy}
                                  onClick={() => void downloadPdf(r)}
                                >
                                  PDF
                                </Button>
                                {r.status === "concept" ||
                                r.status === "verzonden" ? (
                                  <Button
                                    type="button"
                                    size="xs"
                                    disabled={busy || !r.kvkOk}
                                    onClick={() =>
                                      void patchStatus(
                                        r,
                                        r.source === "adviseur"
                                          ? "goedgekeurd"
                                          : "verzonden"
                                      )
                                    }
                                    className="bg-orange text-white hover:bg-orange/90"
                                    title={
                                      !r.kvkOk
                                        ? "Vul eerst ZZP-gegevens in"
                                        : undefined
                                    }
                                  >
                                    Bevestig
                                  </Button>
                                ) : null}
                                {r.status === "goedgekeurd" ? (
                                  <Button
                                    type="button"
                                    size="xs"
                                    disabled={busy}
                                    onClick={() =>
                                      void patchStatus(r, "betaald")
                                    }
                                  >
                                    Betaald
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Sheet
        open={detailGroup != null}
        onOpenChange={(open) => {
          if (!open) setDetailGroup(null);
        }}
      >
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          {detailGroup ? (
            (() => {
              const g = detailGroup;
              const row =
                g.rows.find((r) => r.id === detailFactuurId) ||
                g.rows[0] ||
                null;
              const raw = row ? rawFactuurForRow(row) : null;
              const adv = row ? adviseurForRow(row) : null;
              const bedragEx = g.bedragEx;
              const bedragInc = g.bedragInc;
              const btw = Math.round((bedragInc - bedragEx) * 100) / 100;
              const regels =
                row != null
                  ? parseCreditRegels(notitiesForRow(row)) ||
                    (raw && "omschrijving" in raw && raw.omschrijving
                      ? [
                          {
                            omschrijving: String(raw.omschrijving),
                            bedrag: row.bedragEx,
                          },
                        ]
                      : [
                          {
                            omschrijving: g.kenmerk || "Vergoeding",
                            bedrag: row?.bedragEx ?? bedragEx,
                          },
                        ])
                  : [
                      {
                        omschrijving: g.kenmerk || "Vergoeding",
                        bedrag: bedragEx,
                      },
                    ];
              const adresParts = [
                g.relatieNaam,
                g.bedrijfsnaam || adv?.bedrijfsnaam || null,
                adv?.factuur_adres || null,
                [adv?.factuur_postcode, adv?.factuur_plaats]
                  .filter(Boolean)
                  .join(" ") || null,
              ].filter(Boolean);
              const factuurdatum = row?.factuurdatum || raw?.factuurdatum || null;
              const deadline =
                g.deadline || (row ? payoutDeadlineYmd([row]) : null);
              const canBevestig =
                !g.preview &&
                tab === "concept_ab" &&
                g.rows.some(
                  (r) => r.status === "concept" || r.status === "verzonden"
                );
              const canBetaald =
                !g.preview &&
                tab === "te_betalen" &&
                g.rows.every((r) => r.status === "goedgekeurd");
              const canEdit =
                !g.preview &&
                tab === "concept_ab" &&
                g.rows.some(
                  (r) => r.status === "concept" || r.status === "verzonden"
                );
              const busy = busyId === g.key || busyId === `pdf-${g.key}`;
              const sheetTitle =
                tab === "concept_ab"
                  ? "Factuur controleren"
                  : tab === "te_betalen"
                    ? "Uitbetaling"
                    : "Factuurgegevens";
              const statusForBadge =
                g.preview
                  ? "preview"
                  : g.status === "mixed"
                    ? row?.status || "concept"
                    : g.status;
              const history: { label: string; at: string }[] = [];
              if (raw?.created_at) {
                history.push({
                  label: "Factuur aangemaakt",
                  at: raw.created_at,
                });
              }
              if (raw?.verzonden_op) {
                history.push({
                  label: "Bevestigd / verzonden",
                  at: raw.verzonden_op,
                });
              }
              if (raw?.goedgekeurd_op) {
                history.push({
                  label:
                    tab === "concept_ab"
                      ? "Acceptatie ontvangen"
                      : "Goedgekeurd",
                  at: raw.goedgekeurd_op,
                });
              }
              if (raw?.betaald_op) {
                history.push({ label: "Betaald", at: raw.betaald_op });
              }

              return (
                <>
                  <SheetHeader className="border-b px-4 py-4 text-left">
                    <SheetTitle>{sheetTitle}</SheetTitle>
                    <SheetDescription className="sr-only">
                      Details voor {g.relatieNaam}
                    </SheetDescription>
                  </SheetHeader>

                  <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-heading text-xl font-semibold tracking-tight text-foreground">
                          {g.relatieNaam}
                        </p>
                        <div className="mt-0.5 flex min-w-0 items-center gap-1">
                          <p className="truncate text-sm text-muted-foreground">
                            {row?.nummer ||
                              (g.preview
                                ? `${g.previewOrders ?? 0} aanbetaling(en)`
                                : g.rows.map((r) => r.nummer).join(" · "))}
                          </p>
                          {row?.nummer ? (
                            <CopyMini
                              copied={copiedKey === `${g.key}:detail-nummer`}
                              onCopy={() =>
                                void copyField(
                                  `${g.key}:detail-nummer`,
                                  row.nummer
                                )
                              }
                            />
                          ) : null}
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "shrink-0 border-transparent",
                          statusForBadge === "betaald"
                            ? "bg-emerald-50 text-emerald-700"
                            : statusForBadge === "goedgekeurd"
                              ? "bg-amber-50 text-amber-800"
                              : "bg-emerald-50 text-emerald-800"
                        )}
                      >
                        {detailStatusLabel(statusForBadge, tab)}
                      </Badge>
                    </div>

                    {g.rows.length > 1 ? (
                      <div className="space-y-1.5">
                        <Label>Factuur</Label>
                        <NativeSelect
                          value={detailFactuurId || g.rows[0]!.id}
                          onChange={(e) => setDetailFactuurId(e.target.value)}
                          className="w-full"
                        >
                          {g.rows.map((r) => (
                            <NativeSelectOption key={r.id} value={r.id}>
                              {r.nummer} · {formatEuro(r.bedragEx)}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </div>
                    ) : null}

                    <div className="rounded-xl border bg-card p-4 shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                            Factuur
                          </p>
                          <div className="mt-0.5 flex items-center gap-1">
                            <p className="font-mono text-sm text-foreground">
                              {row?.nummer || "—"}
                            </p>
                            {row?.nummer ? (
                              <CopyMini
                                copied={
                                  copiedKey === `${g.key}:detail-card-nummer`
                                }
                                onCopy={() =>
                                  void copyField(
                                    `${g.key}:detail-card-nummer`,
                                    row.nummer
                                  )
                                }
                              />
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                        {adresParts.join(", ") || "—"}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>
                          Factuurdatum:{" "}
                          <span className="text-foreground">
                            {factuurdatum
                              ? formatDateShort(factuurdatum)
                              : "—"}
                          </span>
                        </div>
                        <div>
                          Deadline:{" "}
                          <span className="text-foreground">
                            {deadline
                              ? formatDateShort(`${deadline}T12:00:00`)
                              : "—"}
                          </span>
                        </div>
                      </div>
                      <div className="mt-4 overflow-hidden rounded-lg border">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-wash/60 text-muted-foreground">
                            <tr>
                              <th className="px-2 py-1.5 font-medium">
                                Omschrijving
                              </th>
                              <th className="px-2 py-1.5 text-right font-medium">
                                Excl.
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {regels.map((regel, i) => (
                              <tr
                                key={`${regel.omschrijving}-${i}`}
                                className="border-t"
                              >
                                <td className="px-2 py-1.5 text-foreground">
                                  {regel.omschrijving}
                                </td>
                                <td
                                  className={cn(
                                    "px-2 py-1.5 text-right tabular-nums",
                                    regel.bedrag < 0
                                      ? "text-orange-700"
                                      : "text-foreground"
                                  )}
                                >
                                  {formatEuro(regel.bedrag)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="space-y-1 border-t bg-wash/40 px-2 py-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              Excl. btw
                            </span>
                            <span className="tabular-nums">
                              {formatEuro(row?.bedragEx ?? bedragEx)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              Btw 21%
                            </span>
                            <span className="tabular-nums">
                              {formatEuro(
                                row
                                  ? Math.round(
                                      (row.bedragInc - row.bedragEx) * 100
                                    ) / 100
                                  : btw
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between font-semibold">
                            <span>Totaal incl. btw</span>
                            <span className="tabular-nums">
                              {formatEuro(row?.bedragInc ?? bedragInc)}
                            </span>
                          </div>
                        </div>
                      </div>
                      {row && !g.preview ? (
                        <button
                          type="button"
                          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                          onClick={() => void downloadPdf(row)}
                        >
                          Bekijk volledige factuur
                          <ExternalLink className="size-3.5" />
                        </button>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-muted-foreground">
                          Excl. btw
                        </span>
                        <span className="tabular-nums text-foreground">
                          {formatEuro(bedragEx)}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-muted-foreground">
                          Btw 21%
                        </span>
                        <span className="tabular-nums text-foreground">
                          {formatEuro(btw)}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 border-t pt-2">
                        <span className="text-sm font-medium text-foreground">
                          {tab === "betaald" ? "Betaald" : "Te betalen"}
                        </span>
                        <span className="font-heading text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                          {formatEuro(bedragInc)}
                        </span>
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        Betaalgegevens
                      </p>
                      <div className="rounded-xl border bg-wash/40 px-3 py-3 text-sm">
                        <p className="font-medium text-foreground">
                          {g.bedrijfsnaam || adv?.bedrijfsnaam || g.relatieNaam}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {g.iban ? maskIban(g.iban) : "IBAN ontbreekt"}
                          </span>
                          {g.iban ? (
                            <CopyMini
                              copied={copiedKey === `${g.key}:detail-iban`}
                              onCopy={() =>
                                void copyField(`${g.key}:detail-iban`, g.iban!)
                              }
                            />
                          ) : null}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                          <span className="text-xs text-muted-foreground">
                            Kenmerk
                          </span>
                          <div className="flex min-w-0 items-center gap-1">
                            <span className="truncate text-xs font-medium text-foreground">
                              {g.kenmerk}
                            </span>
                            <CopyMini
                              copied={copiedKey === `${g.key}:detail-kenmerk`}
                              onCopy={() =>
                                void copyField(
                                  `${g.key}:detail-kenmerk`,
                                  g.kenmerk
                                )
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {history.length > 0 ? (
                      <div>
                        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          Geschiedenis
                        </p>
                        <ul className="space-y-3">
                          {history.map((h) => (
                            <li
                              key={`${h.label}-${h.at}`}
                              className="flex items-start gap-2.5"
                            >
                              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">
                                  {h.label}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatDateTimeNl(h.at)}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>

                  <SheetFooter className="border-t px-4 py-3 sm:flex-row">
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        disabled={busy}
                        onClick={() => {
                          openEditConcept(g.rows);
                        }}
                      >
                        <Pencil data-icon="inline-start" />
                        Bewerken
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        disabled={busy || g.preview || g.rows.length === 0}
                        onClick={() => void downloadPayoutGroupPdfs(g)}
                      >
                        <FileText data-icon="inline-start" />
                        PDF
                      </Button>
                    )}
                    {canBevestig ? (
                      <Button
                        type="button"
                        className="flex-1"
                        disabled={busy || !g.kvkOk}
                        title={
                          !g.kvkOk ? "Vul eerst ZZP-gegevens in" : undefined
                        }
                        onClick={() => void bevestigPayoutGroup(g)}
                      >
                        Goedkeuren
                      </Button>
                    ) : null}
                    {canBetaald ? (
                      <Button
                        type="button"
                        className="flex-1"
                        disabled={busy}
                        onClick={() => void markPayoutGroupBetaald(g)}
                      >
                        Betaald
                      </Button>
                    ) : null}
                    {!canBevestig && !canBetaald && tab === "betaald" ? (
                      <Button
                        type="button"
                        className="flex-1"
                        variant="secondary"
                        onClick={() => setDetailGroup(null)}
                      >
                        Sluiten
                      </Button>
                    ) : null}
                  </SheetFooter>
                </>
              );
            })()
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          {(() => {
            const row =
              editRows.find((r) => r.id === editFactuurId) || editRows[0] || null;
            if (!row) {
              return (
                <SheetHeader>
                  <SheetTitle>Concept bewerken</SheetTitle>
                  <SheetDescription>Geen factuur geselecteerd.</SheetDescription>
                </SheetHeader>
              );
            }
            const draftParsed = editRegels.map((r) => ({
              omschrijving: r.omschrijving.trim(),
              bedrag: Number(String(r.bedrag).replace(",", ".")),
            }));
            const draftOk =
              draftParsed.length > 0 &&
              draftParsed.every(
                (r) => r.omschrijving.length > 0 && Number.isFinite(r.bedrag)
              );
            const previewEx = draftOk
              ? Math.round(
                  draftParsed.reduce((s, r) => s + r.bedrag, 0) * 100
                ) / 100
              : row.bedragEx;
            const previewInc =
              Math.round(previewEx * 1.21 * 100) / 100;
            const aftrekNum = Number(String(aftrekBedrag).replace(",", "."));
            const aftrekReady =
              Number.isFinite(aftrekNum) && aftrekNum > 0;
            return (
              <>
                <SheetHeader>
                  <SheetTitle>Concept bewerken</SheetTitle>
                  <SheetDescription>
                    {row.relatieNaam} · {row.nummer} · regels aanpassen of
                    verwijderen
                  </SheetDescription>
                </SheetHeader>
                <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
                  {editRows.length > 1 ? (
                    <div className="space-y-1.5">
                      <Label>Factuur</Label>
                      <NativeSelect
                        value={editFactuurId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setEditFactuurId(id);
                          const next =
                            editRows.find((r) => r.id === id) || editRows[0];
                          if (next) {
                            loadEditRegelsForRow(next);
                            void loadOpenKostenForRow(next);
                          }
                        }}
                        className="w-full"
                      >
                        {editRows.map((r) => (
                          <NativeSelectOption key={r.id} value={r.id}>
                            {r.nummer} · {formatEuro(r.bedragEx)}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label>Regels</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() =>
                          setEditRegels((list) => [
                            ...list,
                            { omschrijving: "", bedrag: "" },
                          ])
                        }
                      >
                        <Plus data-icon="inline-start" />
                        Regel
                      </Button>
                    </div>
                    {editRegels.map((regel, idx) => (
                      <div
                        key={`edit-regel-${idx}`}
                        className="space-y-2 rounded-lg border border-line p-2.5"
                      >
                        <Input
                          value={regel.omschrijving}
                          onChange={(e) =>
                            setEditRegels((list) =>
                              list.map((r, i) =>
                                i === idx
                                  ? { ...r, omschrijving: e.target.value }
                                  : r
                              )
                            )
                          }
                          placeholder="Omschrijving"
                        />
                        <div className="flex items-center gap-2">
                          <Input
                            inputMode="decimal"
                            value={regel.bedrag}
                            onChange={(e) =>
                              setEditRegels((list) =>
                                list.map((r, i) =>
                                  i === idx
                                    ? { ...r, bedrag: e.target.value }
                                    : r
                                )
                              )
                            }
                            placeholder="Bedrag excl."
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            disabled={editRegels.length <= 1}
                            aria-label="Regel verwijderen"
                            onClick={() =>
                              setEditRegels((list) =>
                                list.filter((_, i) => i !== idx)
                              )
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-baseline justify-between border-t pt-2">
                      <span className="text-xs text-muted-foreground">
                        Totaal excl.
                      </span>
                      <span className="font-heading text-lg font-semibold tabular-nums">
                        {formatEuro(previewEx)}
                      </span>
                    </div>
                    <p className="text-right text-xs text-muted-foreground">
                      ≈ {formatEuro(previewInc)} incl. btw
                    </p>
                  </div>

                  {row.source === "adviseur" && editOpenKosten.length > 0 ? (
                    <div className="space-y-2 rounded-lg border border-line bg-[#FAFBFA] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-ink">
                          Open kosten / voorschotten
                        </p>
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-green-dark hover:underline"
                          onClick={() => {
                            const allSelected =
                              editSelectedKostenIds.length ===
                              editOpenKosten.length;
                            setEditSelectedKostenIds(
                              allSelected
                                ? []
                                : editOpenKosten.map((k) => k.id)
                            );
                          }}
                        >
                          {editSelectedKostenIds.length ===
                          editOpenKosten.length
                            ? "Deselecteer alles"
                            : "Selecteer alles"}
                        </button>
                      </div>
                      <ul className="space-y-1.5">
                        {editOpenKosten.map((k) => {
                          const checked = editSelectedKostenIds.includes(k.id);
                          return (
                            <li key={k.id}>
                              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-line bg-white px-2.5 py-2 text-sm hover:bg-wash/60">
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  checked={checked}
                                  onChange={() => {
                                    setEditSelectedKostenIds((ids) =>
                                      checked
                                        ? ids.filter((id) => id !== k.id)
                                        : [...ids, k.id]
                                    );
                                  }}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-medium text-ink">
                                    {k.omschrijving}
                                  </span>
                                  <span className="block text-[11px] text-muted">
                                    {k.soort === "voorschot"
                                      ? "Voorschot"
                                      : k.soort === "correctie"
                                        ? "Correctie"
                                        : "Kosten"}
                                    {k.kosten_datum
                                      ? ` · ${formatDateShort(k.kosten_datum)}`
                                      : ""}
                                  </span>
                                </span>
                                <span className="shrink-0 tabular-nums font-semibold text-ink">
                                  −{formatEuro(Number(k.bedrag_ex_btw) || 0)}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="text-right text-xs text-muted">
                        Geselecteerd:{" "}
                        <span className="font-semibold tabular-nums text-ink">
                          −
                          {formatEuro(
                            editOpenKosten
                              .filter((k) =>
                                editSelectedKostenIds.includes(k.id)
                              )
                              .reduce(
                                (s, k) => s + (Number(k.bedrag_ex_btw) || 0),
                                0
                              )
                          )}
                        </span>{" "}
                        excl.
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        disabled={
                          editSaving || editSelectedKostenIds.length === 0
                        }
                        onClick={() => void submitKostenAftrek()}
                      >
                        Kosten aftrekken van factuur
                      </Button>
                    </div>
                  ) : null}

                  <div className="space-y-2 rounded-lg border border-dashed border-line p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Of snelle aftrek
                    </p>
                    <Input
                      inputMode="decimal"
                      placeholder="Aftrek excl. btw"
                      value={aftrekBedrag}
                      onChange={(e) => setAftrekBedrag(e.target.value)}
                    />
                    <Input
                      placeholder="Reden (optioneel)"
                      value={aftrekOmschrijving}
                      onChange={(e) => setAftrekOmschrijving(e.target.value)}
                    />
                  </div>
                </div>
                <SheetFooter>
                  <Button
                    type="button"
                    disabled={editSaving || !draftOk || previewEx < 0}
                    onClick={() => void submitEditRegels()}
                  >
                    {editSaving ? "Opslaan…" : "Regels opslaan"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={editSaving || !aftrekReady}
                    onClick={() => void submitAftrek()}
                  >
                    Aftrek toepassen
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={editSaving}
                    onClick={() => setEditOpen(false)}
                  >
                    Annuleren
                  </Button>
                </SheetFooter>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
