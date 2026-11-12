"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { addDays, format, isSameDay, isToday, isYesterday, parseISO, startOfWeek } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import {
  Calendar,
  CalendarPlus,
  ChevronDown,
  Columns3,
  FileText,
  List,
  Phone,
  Search,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { EDERGY_THUIS_ADRES } from "@/lib/edergy-tarief";
import { adresRegel, formatDateTimeNl, formatEuro, formatTimeNl } from "@/lib/format";
import { WarmtefondsAfspraakForm } from "@/components/warmtefonds/WarmtefondsAfspraakForm";
import { WarmtefondsContactMail } from "@/components/warmtefonds/WarmtefondsContactMail";
import { WarmtefondsCreditfacturen } from "@/components/warmtefonds/WarmtefondsCreditfacturen";
import {
  patchVoorWerkStatus,
  poortVoorWerkStatus,
  WF_WERK_LABEL,
  WF_WERK_STATUSSEN,
  wfWerkStatusVan,
  type WfWerkStatus,
} from "@/lib/warmtefonds-werkstatus";
import type { PortalBetalingSamenvatting } from "@/lib/warmtefonds-portal";

type AanvragenView = "table" | "kanban";

const WF_KANBAN_ACCENT: Record<WfWerkStatus, string> = {
  afwachten_contact: "#6B7C72",
  afspraak_inplannen: "#1A4A6E",
  afspraak_ingepland: "#1D4ED8",
  in_behandeling: "#CA8A04",
  goedgekeurd: "#0D5C32",
  declaratie: "#C45A12",
  afgerond: "#0D5C32",
};

type LeadLite = {
  naam?: string | null;
  telefoon?: string | null;
  email?: string | null;
  postcode?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  straat?: string | null;
  plaats?: string | null;
};

type OrderRow = {
  id: string;
  project_nummer: string;
  titel?: string | null;
  status: string;
  financiering_status?: string | null;
  warmtefonds_afspraak_at?: string | null;
  warmtefonds_contact_pogingen?: number | null;
  /** Eerste moment dat de aanvraag naar Edwin is doorgestuurd. */
  doorgestuurd_at?: string | null;
  leads?: LeadLite | LeadLite[] | null;
  bedragen?: {
    warmtefondsInc: number | null;
  } | null;
  betaling?: PortalBetalingSamenvatting | null;
};

type TabId = "aanvragen" | "agenda" | "creditfacturen" | "account";
type QuickFilter = "alle" | "te_bellen" | "ingepland" | "custom";

const WF_PORTAL_BADGE: Record<WfWerkStatus, string> = {
  afwachten_contact: "Nog te bellen",
  afspraak_inplannen: "Afspraak inplannen",
  afspraak_ingepland: "Ingepland",
  in_behandeling: "In behandeling",
  goedgekeurd: "Aanbod tekenen",
  declaratie: "Declaratie",
  afgerond: "Afgerond",
};

function momentLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseISO(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const tijd = formatTimeNl(d);
  if (isToday(d)) return `Vandaag · ${tijd}`;
  if (isYesterday(d)) return `Gisteren · ${tijd}`;
  return `${formatInTimeZone(d, "Europe/Amsterdam", "dd-MM-yyyy", { locale: nl })} · ${tijd}`;
}

function leadOf(o: OrderRow): LeadLite | null {
  if (!o.leads) return null;
  return Array.isArray(o.leads) ? o.leads[0] || null : o.leads;
}

function werkTone(status: WfWerkStatus | null): string {
  if (status === "afgerond" || status === "goedgekeurd") {
    return "bg-green-soft text-green-dark";
  }
  if (
    status === "declaratie" ||
    status === "in_behandeling" ||
    status === "afwachten_contact"
  ) {
    return "bg-[#FFF7ED] text-[#C45A12]";
  }
  if (status === "afspraak_ingepland") return "bg-[#EEF4FF] text-[#1D4ED8]";
  if (status === "afspraak_inplannen") return "bg-wash text-ink";
  return "bg-wash text-muted";
}

function werkDot(status: WfWerkStatus | null): string {
  if (status === "afgerond" || status === "goedgekeurd") return "bg-green";
  if (
    status === "declaratie" ||
    status === "in_behandeling" ||
    status === "afwachten_contact"
  ) {
    return "bg-[#C45A12]";
  }
  if (status === "afspraak_ingepland") return "bg-[#1D4ED8]";
  return "bg-muted";
}

const AGENDA_TZ = "Europe/Amsterdam";

/** Kalenderdag in NL-tijd (voorkomt UTC-dagverschuiving). */
function agendaDagKey(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return "";
  return formatInTimeZone(d, AGENDA_TZ, "yyyy-MM-dd");
}

function agendaTijdLabel(iso: string): string {
  return formatInTimeZone(new Date(iso), AGENDA_TZ, "HH:mm", { locale: nl });
}

function adresVanOrder(o: OrderRow): string | null {
  const lead = leadOf(o);
  if (!lead) return null;
  const regel = adresRegel(lead);
  if (!regel || regel === "—") return null;
  return regel;
}

function straatRegel(lead: LeadLite): string {
  return [lead.straat, lead.huisnummer, lead.toevoeging].filter(Boolean).join(" ");
}

function postcodePlaats(lead: LeadLite): string {
  return [lead.postcode, lead.plaats].filter(Boolean).join(" ");
}

function googleMapsUrl(query: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

function wazeUrl(query: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`;
}

/** Volgende afspraak dezelfde dag, in tijdsvolgorde. */
function volgendeZelfdeDag(order: OrderRow, orders: OrderRow[]): OrderRow | null {
  if (!order.warmtefonds_afspraak_at) return null;
  const dag = agendaDagKey(order.warmtefonds_afspraak_at);
  const start = new Date(order.warmtefonds_afspraak_at).getTime();
  const later = orders
    .filter(
      (o) =>
        o.id !== order.id &&
        o.warmtefonds_afspraak_at &&
        agendaDagKey(o.warmtefonds_afspraak_at) === dag &&
        new Date(o.warmtefonds_afspraak_at).getTime() > start
    )
    .sort(
      (a, b) =>
        new Date(a.warmtefonds_afspraak_at!).getTime() -
        new Date(b.warmtefonds_afspraak_at!).getTime()
    );
  return later[0] || null;
}

function reisKort(sec: number): string {
  const mins = Math.max(1, Math.round(sec / 60));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}u ${m}m` : `${h}u`;
}

type ReisInfo = { sec: number; soort: "volgende" | "huis" };

function reisTekst(reis: ReisInfo | undefined): string | null {
  if (!reis || !Number.isFinite(reis.sec)) return null;
  const duur = reisKort(reis.sec);
  return reis.soort === "huis"
    ? `Reistijd naar huis ${duur}`
    : `Reistijd naar volgende ${duur}`;
}

function StatusFilter({
  selected,
  onChange,
}: {
  selected: WfWerkStatus[];
  onChange: (next: WfWerkStatus[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = selected.length !== WF_WERK_STATUSSEN.length;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(status: WfWerkStatus) {
    onChange(
      selected.includes(status)
        ? selected.filter((s) => s !== status)
        : [...selected, status]
    );
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          "inline-flex h-9 w-9 items-center justify-center rounded-full border bg-white hover:bg-wash",
          active ? "border-green-dark text-green-dark" : "border-line text-muted",
        ].join(" ")}
        aria-expanded={open}
        aria-label="Filter op status"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-64 border border-line bg-white py-1 shadow-lg">
          <button
            type="button"
            onClick={() => onChange([...WF_WERK_STATUSSEN])}
            className="w-full px-3 py-1.5 text-left text-xs font-semibold text-muted hover:bg-wash"
          >
            Alles
          </button>
          {WF_WERK_STATUSSEN.map((status) => (
            <label
              key={status}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-wash"
            >
              <input
                type="checkbox"
                checked={selected.includes(status)}
                onChange={() => toggle(status)}
                className="accent-[#0d5c32]"
              />
              {WF_WERK_LABEL[status]}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WarmtefondsPortalPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("aanvragen");
  const [operatorNaam, setOperatorNaam] = useState("");
  const [operatorTarief, setOperatorTarief] = useState("375");
  const [operatorTariefExcl, setOperatorTariefExcl] = useState<number | null>(
    296.25
  );
  const [operatorTariefBusy, setOperatorTariefBusy] = useState(false);
  const [operatorTariefMsg, setOperatorTariefMsg] = useState<string | null>(
    null
  );
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoek, setZoek] = useState("");
  const [aanvragenView, setAanvragenView] = useState<AanvragenView>("table");
  const [statusFilter, setStatusFilter] =
    useState<WfWerkStatus[]>([...WF_WERK_STATUSSEN]);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("alle");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [contactId, setContactId] = useState<string | null>(null);
  const [afspraakId, setAfspraakId] = useState<string | null>(null);
  const [afspraakKiezerOpen, setAfspraakKiezerOpen] = useState(false);
  const [afspraakKiezerZoek, setAfspraakKiezerZoek] = useState("");
  const [afspraakMsg, setAfspraakMsg] = useState<string | null>(null);
  const [openAfspraakId, setOpenAfspraakId] = useState<string | null>(null);
  const [reistijd, setReistijd] = useState<Record<string, ReisInfo>>({});
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );

  function setQuick(next: Exclude<QuickFilter, "custom">) {
    setQuickFilter(next);
    if (next === "alle") setStatusFilter([...WF_WERK_STATUSSEN]);
    else if (next === "te_bellen") setStatusFilter(["afwachten_contact"]);
    else setStatusFilter(["afspraak_ingepland"]);
  }

  function setStatusFilterFromUi(next: WfWerkStatus[]) {
    setStatusFilter(next);
    const sorted = [...next].sort().join(",");
    if (sorted === [...WF_WERK_STATUSSEN].sort().join(",")) setQuickFilter("alle");
    else if (next.length === 1 && next[0] === "afwachten_contact") {
      setQuickFilter("te_bellen");
    } else if (next.length === 1 && next[0] === "afspraak_ingepland") {
      setQuickFilter("ingepland");
    } else setQuickFilter("custom");
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warmtefonds/${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Niet gevonden");
      setOperatorNaam(data.operator?.naam || "");
      setOrders(data.orders || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch(`/api/warmtefonds/${token}/account`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Account laden mislukt");
      setOperatorNaam(data.operator?.naam || "");
      setOperatorTarief(String(data.tarief?.per_aanvraag_inc ?? 375));
      setOperatorTariefExcl(
        typeof data.tarief?.per_aanvraag_excl === "number"
          ? data.tarief.per_aanvraag_excl
          : null
      );
    } catch {
      /* best-effort */
    }
  }, [token]);

  async function opslaanTarief() {
    setOperatorTariefBusy(true);
    setOperatorTariefMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/warmtefonds/${token}/account`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tarief_inc: Number(String(operatorTarief).replace(",", ".")),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      setOperatorTarief(String(data.tarief?.per_aanvraag_inc ?? operatorTarief));
      setOperatorTariefExcl(
        typeof data.tarief?.per_aanvraag_excl === "number"
          ? data.tarief.per_aanvraag_excl
          : null
      );
      setOperatorTariefMsg("Vergoeding opgeslagen.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setOperatorTariefBusy(false);
    }
  }

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  useEffect(() => {
    if (tab !== "account") return;
    const id = requestAnimationFrame(() => void loadAccount());
    return () => cancelAnimationFrame(id);
  }, [tab, loadAccount]);

  useEffect(() => {
    if (!contactId && !afspraakId && !openAfspraakId && !afspraakKiezerOpen) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [contactId, afspraakId, openAfspraakId, afspraakKiezerOpen]);

  useEffect(() => {
    const legs: {
      id: string;
      from: string;
      to: string;
      soort: ReisInfo["soort"];
    }[] = [];
    for (const order of orders) {
      if (!order.warmtefonds_afspraak_at) continue;
      const from = adresVanOrder(order);
      if (!from) continue;
      const next = volgendeZelfdeDag(order, orders);
      if (next) {
        const to = adresVanOrder(next);
        if (!to) continue;
        legs.push({ id: order.id, from, to, soort: "volgende" });
      } else {
        legs.push({
          id: order.id,
          from,
          to: EDERGY_THUIS_ADRES,
          soort: "huis",
        });
      }
    }
    if (!legs.length) {
      setReistijd({});
      return;
    }
    const soortVan = new Map(legs.map((leg) => [leg.id, leg.soort]));
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/warmtefonds/${token}/reistijd`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            legs: legs.map(({ id, from, to }) => ({ id, from, to })),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          legs?: { id: string; durationSec: number }[];
        };
        if (cancelled || !res.ok) return;
        const map: Record<string, ReisInfo> = {};
        for (const leg of data.legs || []) {
          const soort = soortVan.get(leg.id);
          if (leg?.id && soort && Number.isFinite(leg.durationSec)) {
            map[leg.id] = { sec: leg.durationSec, soort };
          }
        }
        setReistijd(map);
      } catch {
        /* reistijd blijft leeg */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orders, token]);

  const openQueue = useMemo(() => {
    const q = zoek.trim().toLowerCase();
    const gekozen = new Set(statusFilter);
    const list = orders.filter((o) => {
      const werk = wfWerkStatusVan(o);
      if (!werk || !gekozen.has(werk)) return false;
      if (!q) return true;
      const lead = leadOf(o);
      const blob = [
        lead?.naam,
        lead?.plaats,
        lead?.straat,
        lead?.postcode,
        o.project_nummer,
        lead?.telefoon,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
    return [...list].sort((a, b) => {
      const av = new Date(a.doorgestuurd_at || 0).getTime();
      const bv = new Date(b.doorgestuurd_at || 0).getTime();
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [orders, zoek, sortDir, statusFilter]);

  const alleCount = useMemo(
    () => orders.reduce((n, o) => (wfWerkStatusVan(o) ? n + 1 : n), 0),
    [orders]
  );

  const afspraakKandidaten = useMemo(() => {
    const q = afspraakKiezerZoek.trim().toLowerCase();
    const list = orders.filter((o) => {
      const werk = wfWerkStatusVan(o);
      if (werk !== "afspraak_inplannen" && werk !== "afspraak_ingepland") {
        return false;
      }
      if (!q) return true;
      const lead = leadOf(o);
      const blob = [lead?.naam, lead?.plaats, o.project_nummer, lead?.telefoon]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
    return [...list].sort((a, b) => {
      const aw = wfWerkStatusVan(a) === "afspraak_inplannen" ? 0 : 1;
      const bw = wfWerkStatusVan(b) === "afspraak_inplannen" ? 0 : 1;
      if (aw !== bw) return aw - bw;
      return (
        new Date(b.doorgestuurd_at || 0).getTime() -
        new Date(a.doorgestuurd_at || 0).getTime()
      );
    });
  }, [orders, afspraakKiezerZoek]);

  function zetStap(
    id: string,
    patch: {
      financiering_status?: string | null;
      warmtefonds_afspraak_at?: string | null;
      warmtefonds_contact_pogingen?: number | null;
    }
  ) {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== id) return o;
        const next = { ...o, ...patch };
        if (
          !o.doorgestuurd_at &&
          (patch.financiering_status === "doorgestuurd_naar_edwin" ||
            patch.financiering_status === "afspraak_ingepland" ||
            patch.financiering_status === "contact_verstuurd")
        ) {
          next.doorgestuurd_at = new Date().toISOString();
        }
        return next;
      })
    );
  }

  async function openContact(id: string) {
    setContactId(id);
    try {
      const res = await fetch(`/api/warmtefonds/${token}/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_poging: true }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        order?: OrderRow;
        error?: string;
      };
      if (!res.ok) return;
      const order = data.order;
      if (order) {
        zetStap(id, {
          financiering_status: order.financiering_status ?? "contact_verstuurd",
          warmtefonds_contact_pogingen:
            order.warmtefonds_contact_pogingen ?? null,
        });
      } else {
        const cur = orders.find((o) => o.id === id);
        const prev = Number(cur?.warmtefonds_contact_pogingen || 0);
        zetStap(id, {
          financiering_status: "contact_verstuurd",
          warmtefonds_contact_pogingen: prev + 1,
        });
      }
    } catch {
      /* best-effort */
    }
  }

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const agendaByDay = useMemo(() => {
    const map = new Map<string, OrderRow[]>();
    for (const d of weekDays) {
      map.set(agendaDagKey(d), []);
    }
    for (const o of orders) {
      if (!o.warmtefonds_afspraak_at) continue;
      const at = new Date(o.warmtefonds_afspraak_at);
      if (Number.isNaN(at.getTime())) continue;
      const key = agendaDagKey(at);
      const list = map.get(key);
      if (list) list.push(o);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.warmtefonds_afspraak_at!).getTime() -
          new Date(b.warmtefonds_afspraak_at!).getTime()
      );
    }
    return map;
  }, [orders, weekDays]);

  const openOrder = orders.find((o) => o.id === openAfspraakId) || null;
  const contactOrder = orders.find((o) => o.id === contactId) || null;
  const afspraakOrder = orders.find((o) => o.id === afspraakId) || null;

  const weekLabel = `${format(weekStart, "d MMM", { locale: nl })} – ${format(
    addDays(weekStart, 6),
    "d MMM yyyy",
    { locale: nl }
  )}`;

  return (
    <div className="crm-bg flex min-h-screen max-w-[100vw] flex-col overflow-x-hidden overscroll-x-none">
      <header className="sticky top-0 z-40 border-b border-green-deeper bg-green-dark pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 w-full max-w-full items-center justify-between gap-3 px-4 sm:h-16 sm:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Image
              src="/brands/warmtefonds-logo.png"
              alt="Nationaal Warmtefonds"
              width={120}
              height={36}
              className="h-8 w-auto shrink-0 object-contain brightness-0 invert"
              priority
            />
            <div className="min-w-0 border-l border-white/20 pl-3">
              <p className="truncate font-display text-sm font-bold text-white">
                Batterij<span className="text-orange">concept</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTab("account")}
            className="inline-flex min-w-0 max-w-[46%] items-center gap-2 text-left text-white/90 hover:text-white"
            aria-label="Account"
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15">
              <User className="h-4 w-4" aria-hidden />
            </span>
            <span className="truncate text-[12px] font-semibold">
              {operatorNaam || "Account"}
            </span>
          </button>
        </div>
      </header>

      <main className="w-full min-w-0 max-w-full flex-1 overflow-x-hidden px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-5">
        {error ? (
          <p className="mb-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
            {error}
          </p>
        ) : null}
        {afspraakMsg ? (
          <p className="mb-4 border border-green/30 bg-green-soft px-4 py-3 text-sm text-green-dark">
            {afspraakMsg}
          </p>
        ) : null}

        {loading && orders.length === 0 ? (
          <p className="border border-line bg-white px-5 py-14 text-center text-sm text-muted">
            Laden…
          </p>
        ) : tab === "creditfacturen" ? (
          <>
            <div className="mb-3">
              <h1 className="font-display text-[28px] font-bold leading-none text-ink">
                Creditfacturen
              </h1>
            </div>
            <WarmtefondsCreditfacturen token={token} />
          </>
        ) : tab === "agenda" ? (
          <>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="font-display text-[28px] font-bold leading-none text-ink">
                  Agenda
                </h1>
                <p className="mt-1.5 text-[13px] text-muted">
                  WF-afspraken deze week
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAfspraakKiezerZoek("");
                  setAfspraakKiezerOpen(true);
                }}
                className="inline-flex items-center gap-2 bg-green-dark px-3.5 py-2.5 text-[13px] font-semibold text-white hover:bg-green-deeper"
              >
                <CalendarPlus className="h-4 w-4" aria-hidden />
                Afspraak inplannen
              </button>
            </div>
            <WeekAgenda
              weekLabel={weekLabel}
              weekDays={weekDays}
              agendaByDay={agendaByDay}
              onPrev={() => setWeekStart((w) => addDays(w, -7))}
              onNext={() => setWeekStart((w) => addDays(w, 7))}
              onVandaag={() =>
                setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))
              }
              reistijd={reistijd}
              onOpen={setOpenAfspraakId}
            />
          </>
        ) : tab === "account" ? (
          <div className="mx-auto w-full max-w-md">
            <h1 className="font-display text-[28px] font-bold leading-none text-ink">
              Account
            </h1>
            <p className="mt-1.5 text-[13px] text-muted">Warmtefonds-portaal</p>
            <div className="mt-5 border border-line bg-white p-5">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-soft text-green-dark">
                  <User className="h-6 w-6" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-ink">
                    {operatorNaam || "Warmtefonds-adviseur"}
                  </p>
                  <p className="text-[12px] text-muted">Ingelogd via portaal-link</p>
                </div>
              </div>

              <div className="mt-6 border-t border-line pt-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Vergoeding per aanvraag
                </p>
                <p className="mt-1 text-[13px] text-muted">
                  Jouw tarief voor creditfacturen. Elke WF-persoon heeft een
                  eigen bedrag.
                </p>
                <label className="mt-3 block text-[12px] font-semibold text-ink">
                  Bedrag incl. btw (€)
                  <input
                    type="number"
                    min={1}
                    step={0.01}
                    value={operatorTarief}
                    onChange={(e) => {
                      setOperatorTarief(e.target.value);
                      setOperatorTariefMsg(null);
                    }}
                    className="mt-1.5 h-11 w-full border border-line bg-white px-3 text-sm outline-none focus:border-green-dark"
                  />
                </label>
                {operatorTariefExcl != null ? (
                  <p className="mt-1.5 text-[12px] text-muted">
                    Excl. btw ≈ {formatEuro(operatorTariefExcl)}
                  </p>
                ) : null}
                {operatorTariefMsg ? (
                  <p className="mt-2 text-[12px] font-semibold text-green-dark">
                    {operatorTariefMsg}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void opslaanTarief()}
                  disabled={operatorTariefBusy}
                  className="mt-3 w-full bg-green-dark px-4 py-3 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-50"
                >
                  {operatorTariefBusy ? "Bezig…" : "Tarief opslaan"}
                </button>
              </div>

              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="mt-5 w-full border border-line bg-wash px-4 py-3 text-sm font-semibold text-ink hover:bg-white disabled:opacity-50"
              >
                {loading ? "Bezig…" : "Vernieuwen"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <h1 className="font-display text-[28px] font-bold leading-none text-ink">
                Aanvragen
              </h1>
              <p className="mt-1.5 text-[13px] text-muted">
                {openQueue.length}{" "}
                {openQueue.length === 1
                  ? "aanvraag in je overzicht"
                  : "aanvragen in je overzicht"}
              </p>
            </div>

            <div className="relative mb-3">
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <input
                value={zoek}
                onChange={(e) => setZoek(e.target.value)}
                placeholder="Zoek op naam, adres of project"
                className="h-11 w-full rounded-full border border-line bg-white pr-4 pl-10 text-sm text-ink outline-none placeholder:text-muted focus:border-green-dark"
              />
            </div>

            <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-0.5">
              {(
                [
                  {
                    id: "alle" as const,
                    label: `Alle ${alleCount}`,
                  },
                  {
                    id: "te_bellen" as const,
                    label: "Te bellen",
                  },
                  {
                    id: "ingepland" as const,
                    label: "Ingepland",
                  },
                ] as const
              ).map((chip) => {
                const active = quickFilter === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setQuick(chip.id)}
                    className={[
                      "shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
                      active
                        ? "bg-green-dark text-white"
                        : "border border-line bg-white text-ink hover:bg-wash",
                    ].join(" ")}
                  >
                    {chip.label}
                  </button>
                );
              })}
              <StatusFilter
                selected={statusFilter}
                onChange={setStatusFilterFromUi}
              />
            </div>

            <div className="mb-3 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() =>
                  setSortDir((d) => (d === "desc" ? "asc" : "desc"))
                }
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink"
              >
                {sortDir === "desc" ? "Nieuwste eerst" : "Oudste eerst"}
                <ChevronDown className="h-4 w-4 text-muted" aria-hidden />
              </button>
              <div className="inline-flex h-9 items-center rounded-full border border-line bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => setAanvragenView("table")}
                  className={[
                    "inline-flex h-8 w-8 items-center justify-center rounded-full",
                    aanvragenView === "table"
                      ? "bg-green-dark text-white"
                      : "text-muted hover:text-ink",
                  ].join(" ")}
                  aria-label="Lijstweergave"
                  aria-pressed={aanvragenView === "table"}
                >
                  <List className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setAanvragenView("kanban")}
                  className={[
                    "inline-flex h-8 w-8 items-center justify-center rounded-full",
                    aanvragenView === "kanban"
                      ? "bg-green-dark text-white"
                      : "text-muted hover:text-ink",
                  ].join(" ")}
                  aria-label="Kanbanweergave"
                  aria-pressed={aanvragenView === "kanban"}
                >
                  <Columns3 className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>

            {aanvragenView === "kanban" ? (
              <AanvragenKanban
                rows={openQueue}
                statusFilter={statusFilter}
                token={token}
                onOpen={(id) =>
                  router.push(`/warmtefonds/${token}/orders/${id}`)
                }
                onMaakAfspraak={setAfspraakId}
                onStap={zetStap}
              />
            ) : (
              <AanvragenLijst
                rows={openQueue}
                sortDir={sortDir}
                onToggleSort={() =>
                  setSortDir((d) => (d === "desc" ? "asc" : "desc"))
                }
                onOpen={(id) =>
                  router.push(`/warmtefonds/${token}/orders/${id}`)
                }
                onContact={(id) => void openContact(id)}
                onMaakAfspraak={setAfspraakId}
              />
            )}
          </>
        )}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]"
        aria-label="Hoofdnavigatie"
      >
        <div className="grid h-[3.75rem] grid-cols-4">
          {(
            [
              { id: "aanvragen" as const, label: "Aanvragen", Icon: Columns3 },
              { id: "agenda" as const, label: "Agenda", Icon: Calendar },
              {
                id: "creditfacturen" as const,
                label: "Creditfacturen",
                Icon: FileText,
              },
              { id: "account" as const, label: "Account", Icon: User },
            ] as const
          ).map(({ id, label, Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={[
                  "flex flex-col items-center justify-center gap-1 pt-1.5 text-[10px] leading-none",
                  active
                    ? "font-semibold text-green-dark"
                    : "font-medium text-ink/70",
                ].join(" ")}
              >
                <Icon
                  className="h-[22px] w-[22px] stroke-[1.5]"
                  aria-hidden
                />
                <span className="relative px-0.5">
                  {label}
                  {active ? (
                    <span
                      className="absolute inset-x-0 -bottom-1.5 h-[2px] bg-green-dark"
                      aria-hidden
                    />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
      {afspraakKiezerOpen && !afspraakOrder ? (
        <div
          role="dialog"
          aria-label="Kies klant voor afspraak"
          className="fixed inset-0 z-[70] flex max-w-[100vw] flex-col overflow-x-hidden overscroll-none bg-white"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                WF-afspraak
              </p>
              <h2 className="mt-0.5 font-display text-lg font-semibold text-ink">
                Afspraak inplannen
              </h2>
              <p className="text-xs text-muted">
                Kies eerst een klant of project.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAfspraakKiezerOpen(false)}
              className="border border-line px-2.5 py-1 text-xs font-semibold hover:bg-wash"
            >
              Sluiten
            </button>
          </div>
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
            <input
              value={afspraakKiezerZoek}
              onChange={(e) => setAfspraakKiezerZoek(e.target.value)}
              placeholder="Zoek klant of project"
              autoFocus
              className="h-11 w-full border border-line bg-white px-4 text-sm text-ink outline-none placeholder:text-muted focus:border-green-dark"
            />
            {afspraakKandidaten.length === 0 ? (
              <p className="border border-line bg-wash px-4 py-8 text-center text-sm text-muted">
                Geen klanten klaar voor een afspraak.
              </p>
            ) : (
              <ul className="divide-y divide-line border border-line">
                {afspraakKandidaten.map((o) => {
                  const lead = leadOf(o);
                  const werk = wfWerkStatusVan(o);
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setAfspraakKiezerOpen(false);
                          setAfspraakId(o.id);
                        }}
                        className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-wash"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold text-ink">
                            {lead?.naam || o.titel || "Klant"}
                          </p>
                          <p className="truncate text-[12px] text-muted">
                            {[o.project_nummer, lead?.plaats]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {o.warmtefonds_afspraak_at ? (
                            <p className="mt-1 text-[12px] text-muted">
                              Nu: {formatDateTimeNl(o.warmtefonds_afspraak_at)}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={[
                            "shrink-0 px-2 py-1 text-[11px] font-semibold",
                            werkTone(werk),
                          ].join(" ")}
                        >
                          {werk ? WF_WERK_LABEL[werk] : "—"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
      {afspraakOrder ? (
        <div
          role="dialog"
          aria-label="Maak WF Afspraak"
          className="fixed inset-0 z-[70] flex max-w-[100vw] flex-col overflow-x-hidden overscroll-none bg-white"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                WF-afspraak
              </p>
              <h2 className="mt-0.5 font-display text-lg font-semibold text-ink">
                {leadOf(afspraakOrder)?.naam || afspraakOrder.titel || "Klant"}
              </h2>
              <p className="text-xs text-muted">{afspraakOrder.project_nummer}</p>
            </div>
            <button
              type="button"
              onClick={() => setAfspraakId(null)}
              className="border border-line px-2.5 py-1 text-xs font-semibold hover:bg-wash"
            >
              Sluiten
            </button>
          </div>
          <div className="mx-auto w-full max-w-xl flex-1 overflow-y-auto px-5 py-4">
            <p className="mb-4 text-sm text-muted">
              Kies datum en tijd. De klant krijgt een bevestiging per e-mail.
            </p>
            <WarmtefondsAfspraakForm
              token={token}
              projectId={afspraakOrder.id}
              huidige={afspraakOrder.warmtefonds_afspraak_at}
              onKlaar={(bericht) => {
                setAfspraakMsg(bericht);
                setAfspraakId(null);
                void load();
              }}
            />
          </div>
        </div>
      ) : null}
      {contactOrder ? (
        <WarmtefondsContactMail
          token={token}
          projectId={contactOrder.id}
          projectNummer={contactOrder.project_nummer}
          lead={leadOf(contactOrder)}
          onClose={() => {
            setContactId(null);
            void load();
          }}
        />
      ) : null}
      {openOrder ? (
        <AgendaAfspraakPaneel
          order={openOrder}
          reis={reisTekst(reistijd[openOrder.id])}
          onClose={() => setOpenAfspraakId(null)}
          onOpenOrder={() =>
            router.push(`/warmtefonds/${token}/orders/${openOrder.id}`)
          }
        />
      ) : null}
    </div>
  );
}

async function patchWfStatus(
  token: string,
  orderId: string,
  status: WfWerkStatus
): Promise<{
  financiering_status?: string | null;
  warmtefonds_afspraak_at?: string | null;
}> {
  const body = patchVoorWerkStatus(status);
  const res = await fetch(`/api/warmtefonds/${token}/orders/${orderId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || "Status wijzigen mislukt"
    );
  }
  return body;
}

function AanvragenKanban({
  rows,
  statusFilter,
  token,
  onOpen,
  onMaakAfspraak,
  onStap,
}: {
  rows: OrderRow[];
  statusFilter: WfWerkStatus[];
  token: string;
  onOpen: (id: string) => void;
  onMaakAfspraak: (id: string) => void;
  onStap: (
    id: string,
    patch: {
      financiering_status?: string | null;
      warmtefonds_afspraak_at?: string | null;
    }
  ) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<WfWerkStatus | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const columns = useMemo(() => {
    const gekozen =
      statusFilter.length > 0
        ? WF_WERK_STATUSSEN.filter((s) => statusFilter.includes(s))
        : [...WF_WERK_STATUSSEN];
    const map = new Map<WfWerkStatus, OrderRow[]>();
    for (const status of gekozen) map.set(status, []);
    for (const row of rows) {
      const werk = wfWerkStatusVan(row);
      if (!werk || !map.has(werk)) continue;
      map.get(werk)!.push(row);
    }
    return gekozen.map((status) => ({
      status,
      items: map.get(status) || [],
    }));
  }, [rows, statusFilter]);

  async function handleDrop(target: WfWerkStatus) {
    const id = dragId;
    setDragId(null);
    setOverStatus(null);
    if (!id) return;
    const order = rows.find((o) => o.id === id);
    if (!order) return;
    const current = wfWerkStatusVan(order);
    if (current === target) return;
    if (target === "afspraak_ingepland" && !order.warmtefonds_afspraak_at) {
      onMaakAfspraak(order.id);
      return;
    }
    setSavingId(id);
    setError(null);
    try {
      const body = await patchWfStatus(token, id, target);
      onStap(id, body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status wijzigen mislukt");
    } finally {
      setSavingId(null);
    }
  }

  if (columns.length === 0) {
    return (
      <div className="border border-line bg-white px-6 py-14 text-center">
        <p className="text-sm text-muted">Selecteer minstens één WF-status</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 pb-4">
      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3.5 py-2 text-sm text-[#C45A12]">
          {error}
        </p>
      ) : null}
      {columns.map(({ status, items }) => {
        const accent = WF_KANBAN_ACCENT[status];
        const isOver = overStatus === status;
        return (
          <div
            key={status}
            className={[
              "grid grid-cols-1 border bg-white md:grid-cols-[11.5rem_minmax(0,1fr)] lg:grid-cols-[13rem_minmax(0,1fr)]",
              isOver ? "border-green ring-2 ring-green/25" : "border-line",
            ].join(" ")}
            onDragOver={(e) => {
              e.preventDefault();
              setOverStatus(status);
            }}
            onDragLeave={() => {
              if (overStatus === status) setOverStatus(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              void handleDrop(status);
            }}
          >
            <div
              className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-1.5 md:border-b-0 md:border-r"
              style={{ borderLeft: `3px solid ${accent}` }}
            >
              <p className="truncate text-[13px] font-semibold leading-snug text-ink">
                {WF_WERK_LABEL[status]}
              </p>
              <span
                className="inline-flex min-w-[1.35rem] shrink-0 items-center justify-center px-1 py-0.5 text-[11px] font-bold tabular-nums text-white"
                style={{ background: accent }}
              >
                {items.length}
              </span>
            </div>
            <div className="flex min-h-11 items-center gap-0 overflow-x-auto overscroll-x-contain px-1.5 py-1 touch-pan-x">
              {items.length === 0 ? (
                <p className="px-1.5 text-[12px] text-muted">—</p>
              ) : (
                items.map((o, i) => {
                  const lead = leadOf(o);
                  const saving = savingId === o.id;
                  const afspraakLabel = o.warmtefonds_afspraak_at
                    ? formatDateTimeNl(o.warmtefonds_afspraak_at)
                    : null;
                  const pogingen = Number(o.warmtefonds_contact_pogingen) || 0;
                  const showChevron = i < items.length - 1;
                  return (
                    <article
                      key={o.id}
                      draggable={!saving}
                      onDragStart={() => setDragId(o.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStatus(null);
                      }}
                      className={[
                        "relative h-11 shrink-0 cursor-grab active:cursor-grabbing",
                        afspraakLabel ? "w-[15.5rem]" : "w-[12.5rem]",
                        dragId === o.id ? "z-10 opacity-60" : "",
                        saving ? "opacity-60" : "",
                      ].join(" ")}
                      title={
                        afspraakLabel
                          ? `WF-afspraak ${afspraakLabel}`
                          : undefined
                      }
                    >
                      <div
                        className={[
                          "absolute inset-y-0 left-0 right-2 border",
                          dragId === o.id
                            ? "border-green bg-green-soft ring-2 ring-green"
                            : "border-line bg-[#FAFBFA]",
                        ].join(" ")}
                      />
                      {showChevron ? (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute top-1/2 right-0 z-[1] -translate-y-1/2"
                          style={{
                            width: 0,
                            height: 0,
                            borderTop: "22px solid transparent",
                            borderBottom: "22px solid transparent",
                            borderLeft: "10px solid #E5E8E5",
                          }}
                        />
                      ) : null}
                      {showChevron ? (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute top-1/2 right-px z-[1] -translate-y-1/2"
                          style={{
                            width: 0,
                            height: 0,
                            borderTop: "20px solid transparent",
                            borderBottom: "20px solid transparent",
                            borderLeft: "9px solid #FAFBFA",
                          }}
                        />
                      ) : null}
                      <button
                        type="button"
                        className="relative z-[2] flex h-full w-[calc(100%-0.5rem)] items-center gap-1.5 px-2 text-left"
                        onClick={() => onOpen(o.id)}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-semibold leading-tight text-ink">
                            {lead?.naam || o.titel || "Klant"}
                          </p>
                          <p className="truncate font-mono text-[10px] leading-tight text-muted">
                            {o.project_nummer}
                            {lead?.plaats ? ` · ${lead.plaats}` : ""}
                            {afspraakLabel
                              ? ` · ${afspraakLabel}`
                              : o.bedragen?.warmtefondsInc != null
                                ? ` · ${formatEuro(o.bedragen.warmtefondsInc)}`
                                : ""}
                          </p>
                        </div>
                        {pogingen > 0 ? (
                          <span
                            className="shrink-0 rounded-sm bg-[#0F766E] px-1 py-0.5 text-[9px] font-bold tabular-nums text-white"
                            title={`${pogingen}× contact geprobeerd`}
                          >
                            ×{pogingen}
                          </span>
                        ) : null}
                      </button>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AanvragenLijst({
  rows,
  sortDir,
  onToggleSort,
  onOpen,
  onContact,
  onMaakAfspraak,
}: {
  rows: OrderRow[];
  sortDir: "desc" | "asc";
  onToggleSort: () => void;
  onOpen: (id: string) => void;
  onContact: (id: string) => void;
  onMaakAfspraak: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="border border-line bg-white px-6 py-14 text-center">
        <p className="text-sm text-muted">Geen aanvragen met deze status</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden border border-line bg-white">
      {/* Mobiel: compacte rijen */}
      <div className="divide-y divide-line md:hidden">
        {rows.map((o) => {
          const lead = leadOf(o);
          const werk = wfWerkStatusVan(o);
          const adres = lead ? adresRegel(lead) : "";
          const tel = lead?.telefoon?.replace(/\s/g, "") || "";
          const poort = poortVoorWerkStatus(werk);
          return (
            <div key={o.id} className="px-4 py-3.5">
              <button
                type="button"
                onClick={() => onOpen(o.id)}
                className="flex w-full items-start justify-between gap-2 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-ink">
                    {lead?.naam || o.titel || "Klant"}
                  </p>
                  <p className="mt-0.5 font-mono text-[12px] text-muted">
                    {o.project_nummer}
                  </p>
                  {adres && adres !== "—" ? (
                    <p className="mt-1 truncate text-[12px] text-muted">
                      {adres}
                    </p>
                  ) : null}
                </div>
                <span
                  className={[
                    "shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    werkTone(werk),
                  ].join(" ")}
                >
                  <span
                    className={["h-1.5 w-1.5 rounded-full", werkDot(werk)].join(
                      " "
                    )}
                    aria-hidden
                  />
                  {werk ? WF_PORTAL_BADGE[werk] : "Afgewezen"}
                </span>
              </button>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
                {lead?.telefoon ? <span>{lead.telefoon}</span> : null}
                {o.bedragen?.warmtefondsInc != null ? (
                  <span className="font-semibold text-ink">
                    {formatEuro(o.bedragen.warmtefondsInc)}
                  </span>
                ) : null}
                <span>{momentLabel(o.doorgestuurd_at)}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {poort.soort === "contact" ? (
                  <>
                    {tel ? (
                      <a
                        href={`tel:${tel}`}
                        className="inline-flex h-10 items-center justify-center gap-1.5 bg-green-dark text-[13px] font-semibold text-white"
                      >
                        <Phone className="h-3.5 w-3.5" aria-hidden />
                        Bellen
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onContact(o.id)}
                        className="inline-flex h-10 items-center justify-center bg-green-dark text-[13px] font-semibold text-white"
                      >
                        Contact
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onContact(o.id)}
                      className="inline-flex h-10 items-center justify-center border border-line text-[13px] font-semibold text-ink"
                    >
                      Mailen
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onMaakAfspraak(o.id)}
                      className="inline-flex h-10 items-center justify-center gap-1.5 bg-green-dark text-[13px] font-semibold text-white"
                    >
                      <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
                      Plan afspraak
                    </button>
                    {tel ? (
                      <a
                        href={`tel:${tel}`}
                        className="inline-flex h-10 items-center justify-center gap-1.5 border border-green-dark text-[13px] font-semibold text-green-dark"
                      >
                        <Phone className="h-3.5 w-3.5" aria-hidden />
                        Bellen
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpen(o.id)}
                        className="inline-flex h-10 items-center justify-center border border-line text-[13px] font-semibold text-ink"
                      >
                        Open
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: echte tabel, nieuwste eerst */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[64rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-wash/80 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-semibold text-ink">Project</th>
              <th className="px-3 py-3 font-semibold text-ink">Klant</th>
              <th className="px-3 py-3 font-semibold text-ink">Adres</th>
              <th className="px-3 py-3 font-semibold text-ink">Status</th>
              <th className="px-3 py-3 font-semibold text-ink">Telefoon</th>
              <th className="px-3 py-3 font-semibold text-ink">Afspraak</th>
              <th className="px-3 py-3 font-semibold text-ink">Bedrag</th>
              <th className="px-3 py-3 font-semibold text-ink">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-green-dark"
                  onClick={onToggleSort}
                >
                  Doorgestuurd {sortDir === "desc" ? "↓" : "↑"}
                </button>
              </th>
              <th className="px-3 py-3 font-semibold text-ink">Actie</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const lead = leadOf(o);
              const werk = wfWerkStatusVan(o);
              const adres = lead ? adresRegel(lead) : "";
              const tel = lead?.telefoon?.replace(/\s/g, "") || "";
              const poort = poortVoorWerkStatus(werk);
              return (
                <tr
                  key={o.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => onOpen(o.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(o.id);
                    }
                  }}
                  className="cursor-pointer border-b border-line last:border-b-0 hover:bg-wash/40"
                >
                  <td className="px-4 py-3 align-top font-mono text-[13px] font-semibold text-green-dark">
                    {o.project_nummer}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <p className="font-semibold text-ink">
                      {lead?.naam || o.titel || "Klant"}
                    </p>
                    {lead?.plaats ? (
                      <p className="text-[12px] text-muted">{lead.plaats}</p>
                    ) : null}
                  </td>
                  <td className="max-w-[14rem] px-3 py-3 align-top text-[13px] text-muted">
                    {adres && adres !== "—" ? adres : "—"}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span
                      className={[
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                        werkTone(werk),
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "h-1.5 w-1.5 rounded-full",
                          werkDot(werk),
                        ].join(" ")}
                        aria-hidden
                      />
                      {werk ? WF_PORTAL_BADGE[werk] : "Afgewezen"}
                    </span>
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-3 align-top"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {tel ? (
                      <a
                        href={`tel:${tel}`}
                        className="font-medium text-green-dark hover:underline"
                      >
                        {lead?.telefoon}
                      </a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-top text-[13px] text-ink">
                    {o.warmtefonds_afspraak_at
                      ? formatDateTimeNl(o.warmtefonds_afspraak_at)
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-top font-semibold tabular-nums text-ink">
                    {o.bedragen?.warmtefondsInc != null
                      ? formatEuro(o.bedragen.warmtefondsInc)
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-top text-[13px] text-muted">
                    {momentLabel(o.doorgestuurd_at)}
                  </td>
                  <td
                    className="px-3 py-3 align-top"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {poort.soort === "contact" ? (
                      tel ? (
                        <a
                          href={`tel:${tel}`}
                          className="inline-flex items-center gap-1.5 bg-green-dark px-3 py-2 text-[12px] font-semibold text-white hover:bg-green-deeper"
                        >
                          <Phone className="h-3.5 w-3.5" aria-hidden />
                          Bellen
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onContact(o.id)}
                          className="inline-flex items-center gap-1.5 bg-green-dark px-3 py-2 text-[12px] font-semibold text-white hover:bg-green-deeper"
                        >
                          Contact
                        </button>
                      )
                    ) : poort.soort === "afspraak" ||
                      !o.warmtefonds_afspraak_at ? (
                      <button
                        type="button"
                        onClick={() => onMaakAfspraak(o.id)}
                        className="inline-flex items-center gap-1.5 bg-green-dark px-3 py-2 text-[12px] font-semibold text-white hover:bg-green-deeper"
                      >
                        <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
                        Plan afspraak
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpen(o.id)}
                        className="inline-flex items-center gap-1.5 border border-line bg-white px-3 py-2 text-[12px] font-semibold text-ink hover:bg-wash"
                      >
                        Open
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AgendaAfspraakRij({
  order,
  idx,
  total,
  reistijd,
  compact,
  onOpen,
}: {
  order: OrderRow;
  idx: number;
  total: number;
  reistijd: Record<string, ReisInfo>;
  compact?: boolean;
  onOpen: (id: string) => void;
}) {
  const lead = leadOf(order);
  const iso = order.warmtefonds_afspraak_at!;
  const reis = reisTekst(reistijd[order.id]);
  const adres = adresVanOrder(order);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(order.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(order.id);
        }
      }}
      className={[
        "flex w-full cursor-pointer gap-3 text-left hover:bg-wash/60 sm:gap-5",
        compact ? "px-3 py-2.5 sm:px-4" : "px-4 py-4 sm:px-5",
      ].join(" ")}
    >
      <div className={compact ? "w-12 shrink-0 sm:w-14" : "w-16 shrink-0 sm:w-20"}>
        <p
          className={[
            "font-bold tabular-nums leading-none text-[#C45A12]",
            compact ? "text-base sm:text-lg" : "text-xl sm:text-2xl",
          ].join(" ")}
        >
          {agendaTijdLabel(iso)}
        </p>
        {!compact && idx < total - 1 ? (
          <p className="mt-2 text-[11px] text-muted">↓ volgende</p>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p
            className={[
              "font-semibold text-ink",
              compact ? "text-sm" : "text-base",
            ].join(" ")}
          >
            {lead?.naam || order.titel || "Klant"}
          </p>
          <p className="font-mono text-xs text-muted">{order.project_nummer}</p>
        </div>
        <p className={compact ? "mt-0.5 text-[12px] text-muted" : "mt-1 text-sm text-muted"}>
          {adres || lead?.plaats || "Geen adres"}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {lead?.telefoon ? (
            <a
              href={`tel:${lead.telefoon.replace(/\s/g, "")}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[12px] font-semibold text-green-dark hover:underline"
            >
              {lead.telefoon}
            </a>
          ) : null}
          {reis ? (
            <span className="text-[12px] font-semibold text-[#1A4A6E]">
              {reis}
            </span>
          ) : null}
        </div>
      </div>
      {!compact ? (
        <span className="hidden shrink-0 self-center text-sm font-semibold text-muted sm:inline">
          Open →
        </span>
      ) : null}
    </div>
  );
}

function WeekAgenda({
  weekLabel,
  weekDays,
  agendaByDay,
  reistijd,
  onPrev,
  onNext,
  onVandaag,
  onOpen,
}: {
  weekLabel: string;
  weekDays: Date[];
  agendaByDay: Map<string, OrderRow[]>;
  reistijd: Record<string, ReisInfo>;
  onPrev: () => void;
  onNext: () => void;
  onVandaag: () => void;
  onOpen: (id: string) => void;
}) {
  const weekKeys = useMemo(
    () => weekDays.map((d) => agendaDagKey(d)),
    [weekDays]
  );

  const weekOrders = useMemo(
    () => weekKeys.flatMap((key) => agendaByDay.get(key) || []),
    [weekKeys, agendaByDay]
  );

  const totaal = weekOrders.length;

  /** null = hele week; string = alleen die dag */
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const weekLabelRef = useRef(weekLabel);

  useEffect(() => {
    if (weekLabelRef.current === weekLabel) return;
    weekLabelRef.current = weekLabel;
    setSelectedDayKey(null);
  }, [weekLabel]);

  const selectDay = (key: string) => {
    setSelectedDayKey(key);
  };

  const showWeek = () => {
    setSelectedDayKey(null);
  };

  const handleVandaag = () => {
    onVandaag();
    setSelectedDayKey(agendaDagKey(new Date()));
  };

  const dayMode = selectedDayKey != null;
  const items = dayMode ? agendaByDay.get(selectedDayKey) || [] : [];
  const gekozenDagIdx = dayMode ? weekKeys.indexOf(selectedDayKey) : -1;
  const gekozenDag = gekozenDagIdx >= 0 ? weekDays[gekozenDagIdx] : null;

  return (
    <section className="overflow-hidden border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-base font-semibold capitalize text-ink sm:text-lg">
              {dayMode && gekozenDag
                ? format(gekozenDag, "EEEE d MMMM", { locale: nl })
                : weekLabel}
            </h2>
            <div className="inline-flex border border-line">
              <button
                type="button"
                onClick={showWeek}
                className={[
                  "h-7 px-2.5 text-[11px] font-semibold",
                  !dayMode
                    ? "bg-green-dark text-white"
                    : "bg-white text-muted hover:bg-wash",
                ].join(" ")}
              >
                Week
              </button>
              <button
                type="button"
                onClick={() => {
                  const key =
                    selectedDayKey ||
                    agendaDagKey(new Date()) ||
                    weekKeys.find(
                      (k) => (agendaByDay.get(k)?.length || 0) > 0
                    ) ||
                    weekKeys[0];
                  if (key && weekKeys.includes(key)) selectDay(key);
                  else if (weekKeys[0]) selectDay(weekKeys[0]);
                }}
                className={[
                  "h-7 border-l border-line px-2.5 text-[11px] font-semibold",
                  dayMode
                    ? "bg-green-dark text-white"
                    : "bg-white text-muted hover:bg-wash",
                ].join(" ")}
              >
                Dag
              </button>
            </div>
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {dayMode ? (
              <>
                {items.length}{" "}
                {items.length === 1 ? "afspraak" : "afspraken"}
              </>
            ) : (
              <>
                {totaal} {totaal === 1 ? "afspraak" : "afspraken"} deze week
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {dayMode ? (
            <button
              type="button"
              onClick={showWeek}
              className="h-9 border border-line px-3 text-sm font-semibold hover:bg-wash"
            >
              ← Week
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              showWeek();
              onPrev();
            }}
            className="h-9 w-9 border border-line text-sm font-semibold hover:bg-wash"
            aria-label="Vorige week"
          >
            ←
          </button>
          <button
            type="button"
            onClick={handleVandaag}
            className="h-9 border border-line px-3.5 text-sm font-semibold hover:bg-wash"
          >
            Vandaag
          </button>
          <button
            type="button"
            onClick={() => {
              showWeek();
              onNext();
            }}
            className="h-9 w-9 border border-line text-sm font-semibold hover:bg-wash"
            aria-label="Volgende week"
          >
            →
          </button>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-7 border-b border-line">
        {weekDays.map((day, i) => {
          const key = weekKeys[i];
          const dayOrders = agendaByDay.get(key) || [];
          const count = dayOrders.length;
          const vandaag = isSameDay(day, new Date());
          const active = key === selectedDayKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => selectDay(key)}
              aria-pressed={active}
              className={[
                "min-w-0 border-r border-line px-0.5 py-2.5 text-center last:border-r-0 transition-colors sm:px-1",
                active
                  ? "bg-green-dark text-white"
                  : vandaag
                    ? "bg-[#FFF7ED] hover:bg-[#FFE8CC]"
                    : "bg-white hover:bg-wash",
              ].join(" ")}
            >
              <p
                className={[
                  "text-[10px] font-semibold uppercase tracking-wide sm:text-[11px]",
                  active
                    ? "text-white/75"
                    : vandaag
                      ? "text-[#C45A12]"
                      : "text-muted",
                ].join(" ")}
              >
                {format(day, "EEE", { locale: nl })}
              </p>
              <p
                className={[
                  "mx-auto mt-1 flex h-7 w-7 items-center justify-center text-sm font-semibold",
                  active
                    ? "rounded-full bg-white/20 text-white"
                    : vandaag
                      ? "rounded-full bg-[#C45A12] text-white"
                      : "text-ink",
                ].join(" ")}
              >
                {format(day, "d")}
              </p>
              <p
                className={[
                  "mt-1 text-[11px] font-medium tabular-nums",
                  active ? "text-white/80" : "text-muted",
                ].join(" ")}
              >
                {count}
              </p>
            </button>
          );
        })}
      </div>

      {!dayMode ? (
        totaal === 0 ? (
          <div className="px-5 py-16 text-center">
            <p className="text-sm font-medium text-ink">
              Geen afspraken deze week
            </p>
            <p className="mt-1 text-sm text-muted">
              Ga naar een andere week, of plan een afspraak via Aanvragen.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {weekDays.map((day, i) => {
              const key = weekKeys[i];
              const dayOrders = agendaByDay.get(key) || [];
              if (dayOrders.length === 0) return null;
              return (
                <div key={key}>
                  <button
                    type="button"
                    onClick={() => selectDay(key)}
                    className="flex w-full items-center justify-between gap-3 border-b border-line bg-wash/50 px-4 py-2.5 text-left hover:bg-wash sm:px-5"
                  >
                    <p className="text-sm font-semibold capitalize text-ink">
                      {format(day, "EEEE d MMMM", { locale: nl })}
                      <span className="ml-2 font-normal text-muted">
                        · {dayOrders.length}{" "}
                        {dayOrders.length === 1 ? "afspraak" : "afspraken"}
                      </span>
                    </p>
                    <span className="shrink-0 text-xs font-semibold text-muted">
                      Dag →
                    </span>
                  </button>
                  <ul className="divide-y divide-line">
                    {dayOrders.map((order, idx) => (
                      <li key={order.id}>
                        <AgendaAfspraakRij
                          order={order}
                          idx={idx}
                          total={dayOrders.length}
                          reistijd={reistijd}
                          compact
                          onOpen={onOpen}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )
      ) : items.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <p className="text-sm font-medium text-ink">
            Geen afspraken op deze dag
          </p>
          <p className="mt-1 text-sm text-muted">
            Ga terug naar het weekoverzicht of kies een andere dag.
          </p>
          <button
            type="button"
            onClick={showWeek}
            className="mt-4 h-9 border border-line px-4 text-sm font-semibold hover:bg-wash"
          >
            ← Weekoverzicht
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((order, idx) => (
            <li key={order.id}>
              <AgendaAfspraakRij
                order={order}
                idx={idx}
                total={items.length}
                reistijd={reistijd}
                onOpen={onOpen}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AgendaAfspraakPaneel({
  order,
  reis,
  onClose,
  onOpenOrder,
}: {
  order: OrderRow;
  reis: string | null;
  onClose: () => void;
  onOpenOrder: () => void;
}) {
  const lead = leadOf(order);
  const adres = adresVanOrder(order);
  const straat = lead ? straatRegel(lead) : "";
  const pc = lead ? postcodePlaats(lead) : "";
  const wanneer = order.warmtefonds_afspraak_at
    ? formatDateTimeNl(order.warmtefonds_afspraak_at)
    : "—";

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/30 lg:flex lg:justify-end"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-label="Afspraak"
        className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-[#f6f7f6] lg:static lg:inset-auto lg:z-auto lg:h-full lg:w-full lg:max-w-md lg:shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Warmtefonds-afspraak
            </p>
            <h2 className="mt-1 truncate font-display text-lg font-semibold text-ink">
              {lead?.naam || order.titel || "Klant"}
            </h2>
            <p className="mt-0.5 text-sm text-muted">{wanneer}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-wash"
          >
            Sluiten
          </button>
        </div>

        <div className="space-y-3 p-4">
          <section className="rounded-2xl border border-line bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Klant
            </p>
            <p className="mt-1 text-lg font-semibold text-ink">
              {lead?.naam || "—"}
            </p>
            <p className="font-mono text-xs text-muted">{order.project_nummer}</p>
            {lead?.telefoon ? (
              <a
                href={`tel:${lead.telefoon.replace(/\s/g, "")}`}
                className="mt-3 inline-block text-sm text-muted hover:text-green"
              >
                {lead.telefoon}
              </a>
            ) : null}
          </section>

          <section className="rounded-2xl border border-line bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Adres
            </p>
            {adres ? (
              <>
                <p className="mt-1 text-base font-semibold text-ink">
                  {straat || adres}
                </p>
                {pc ? <p className="mt-0.5 text-sm text-muted">{pc}</p> : null}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <a
                    href={wazeUrl(adres)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#33CCFF] px-4 py-3 text-sm font-bold text-[#0A2A3A] hover:brightness-95"
                  >
                    <NavIcon kind="waze" />
                    <span>Navigeer met Waze</span>
                  </a>
                  <a
                    href={googleMapsUrl(adres)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green px-4 py-3 text-sm font-bold text-white hover:bg-green-dark"
                  >
                    <NavIcon kind="maps" />
                    <span>Navigeer met Google Maps</span>
                  </a>
                </div>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">Geen adres bekend</p>
            )}
          </section>

          {reis ? (
            <p className="rounded-lg border border-[#1A4A6E]/20 bg-[#E8F0F6] px-3 py-2 text-sm font-semibold text-[#1A4A6E]">
              {reis}
            </p>
          ) : null}

          <button
            type="button"
            onClick={onOpenOrder}
            className="w-full border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:border-green hover:text-green-dark"
          >
            Open aanvraag
          </button>
        </div>
      </aside>
    </div>
  );
}

function NavIcon({ kind }: { kind: "waze" | "maps" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden
    >
      {kind === "waze" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="9" cy="14" r="0.8" fill="currentColor" />
          <circle cx="15" cy="14" r="0.8" fill="currentColor" />
          <path d="M8.5 10.5c.9-1.2 2.1-1.8 3.5-1.8s2.6.6 3.5 1.8" />
        </>
      ) : (
        <>
          <path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z" />
          <circle cx="12" cy="10" r="2.2" />
        </>
      )}
    </svg>
  );
}
