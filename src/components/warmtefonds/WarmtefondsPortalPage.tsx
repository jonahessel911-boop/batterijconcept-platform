"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { addDays, format, isSameDay, isToday, isYesterday, parseISO, startOfWeek } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { EDERGY_THUIS_ADRES } from "@/lib/edergy-tarief";
import { adresRegel, formatDateTimeNl, formatEuro, formatTimeNl } from "@/lib/format";
import { WarmtefondsAfspraakForm } from "@/components/warmtefonds/WarmtefondsAfspraakForm";
import { WarmtefondsContactMail } from "@/components/warmtefonds/WarmtefondsContactMail";
import { WarmtefondsCreditfacturen } from "@/components/warmtefonds/WarmtefondsCreditfacturen";
import { KlantDocumenten, type KlantDocument } from "@/components/warmtefonds/WarmtefondsDocumenten";
import { WarmtefondsInstellingen } from "@/components/warmtefonds/WarmtefondsInstellingen";
import {
  patchVoorWerkStatus,
  WF_WERK_LABEL,
  WF_WERK_STANDAARD,
  WF_WERK_STATUSSEN,
  wfWerkStatusVan,
  type WfWerkStatus,
} from "@/lib/warmtefonds-werkstatus";

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
  /** Eerste moment dat de aanvraag naar Edwin is doorgestuurd. */
  doorgestuurd_at?: string | null;
  leads?: LeadLite | LeadLite[] | null;
  bedragen?: {
    warmtefondsInc: number | null;
  } | null;
};

type TabId = "aanvragen" | "agenda" | "creditfacturen" | "instellingen";

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
  if (status === "declaratie" || status === "in_behandeling") {
    return "bg-[#FFF7ED] text-[#C45A12]";
  }
  if (status === "afspraak_ingepland") return "bg-[#EEF4FF] text-[#1D4ED8]";
  if (status === "afspraak_inplannen") return "bg-wash text-ink";
  return "bg-wash text-muted";
}

function werkLabelVan(order: {
  financiering_status?: string | null;
  warmtefonds_afspraak_at?: string | null;
}): string {
  const werk = wfWerkStatusVan(order);
  return werk ? WF_WERK_LABEL[werk] : "Afgewezen";
}

function WfStapSelect({
  token,
  order,
  onUpdated,
  onInplannen,
}: {
  token: string;
  order: OrderRow;
  onUpdated: (
    id: string,
    patch: {
      financiering_status?: string | null;
      warmtefonds_afspraak_at?: string | null;
    }
  ) => void;
  onInplannen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    minWidth: number;
    maxHeight: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null);
      return;
    }
    function place() {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const gap = 4;
      const edge = 8;
      const spaceBelow = window.innerHeight - r.bottom - gap - edge;
      const spaceAbove = r.top - gap - edge;
      const preferred = 360;
      const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(
        160,
        Math.min(preferred, openUp ? spaceAbove : spaceBelow)
      );
      setPos({
        top: openUp ? Math.max(edge, r.top - gap - maxHeight) : r.bottom + gap,
        left: Math.max(edge, Math.min(r.left, window.innerWidth - 280)),
        minWidth: Math.max(r.width, 240),
        maxHeight,
      });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
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

  const werk = wfWerkStatusVan(order);
  const label = werk ? WF_WERK_LABEL[werk] : "Afgewezen";

  async function kies(next: WfWerkStatus) {
    if (next === werk) {
      setOpen(false);
      return;
    }
    if (next === "afspraak_ingepland" && !order.warmtefonds_afspraak_at) {
      setOpen(false);
      onInplannen(order.id);
      return;
    }
    const body = patchVoorWerkStatus(next);
    setSaving(true);
    setError(null);
    setOpen(false);
    try {
      const res = await fetch(`/api/warmtefonds/${token}/orders/${order.id}`, {
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
      onUpdated(order.id, body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status wijzigen mislukt");
    } finally {
      setSaving(false);
    }
  }

  const menu =
    open && mounted
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            className="fixed z-[80] overflow-y-auto overscroll-contain border border-line bg-white py-1 shadow-lg"
            style={{
              top: pos?.top ?? -9999,
              left: pos?.left ?? 0,
              minWidth: pos?.minWidth ?? 240,
              maxHeight: pos?.maxHeight ?? 360,
              visibility: pos ? "visible" : "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Status
            </p>
            {WF_WERK_STATUSSEN.map((opt) => {
              const active = opt === werk;
              return (
                <button
                  key={opt}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => void kies(opt)}
                  className={[
                    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-wash",
                    active ? "bg-wash/80" : "",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "w-4 shrink-0 text-center text-[11px] font-bold text-green-deeper",
                      active ? "opacity-100" : "opacity-0",
                    ].join(" ")}
                  >
                    ✓
                  </span>
                  <span
                    className={[
                      "inline-flex max-w-full truncate rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                      werkTone(opt),
                    ].join(" ")}
                  >
                    {WF_WERK_LABEL[opt]}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body
        )
      : null;

  return (
    <div className="relative inline-block max-w-full">
      <button
        ref={btnRef}
        type="button"
        disabled={saving}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
          setError(null);
        }}
        className={[
          "inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold disabled:opacity-60",
          werkTone(werk),
        ].join(" ")}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Stap wijzigen"
      >
        <span className="truncate">{label}</span>
        <span className="text-[9px] opacity-70" aria-hidden>
          ▾
        </span>
      </button>
      {error ? (
        <p className="mt-1 max-w-[16rem] text-[10px] text-[#C45A12]">{error}</p>
      ) : null}
      {menu}
    </div>
  );
}

const AGENDA_START = 8;
const AGENDA_END = 19;
const UUR_PX = 56;
const AGENDA_UREN = Array.from(
  { length: AGENDA_END - AGENDA_START },
  (_, i) => AGENDA_START + i
);

function minutenVanDag(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function plaatsOpDag(items: OrderRow[]): {
  order: OrderRow;
  col: number;
  cols: number;
}[] {
  const sorted = [...items].sort(
    (a, b) =>
      new Date(a.warmtefonds_afspraak_at!).getTime() -
      new Date(b.warmtefonds_afspraak_at!).getTime()
  );
  const colEind: number[] = [];
  const geplaatst: { order: OrderRow; col: number }[] = [];
  for (const order of sorted) {
    const start = new Date(order.warmtefonds_afspraak_at!).getTime();
    const eind = start + 45 * 60 * 1000;
    let col = colEind.findIndex((t) => t <= start);
    if (col < 0) {
      col = colEind.length;
      colEind.push(eind);
    } else {
      colEind[col] = eind;
    }
    geplaatst.push({ order, col });
  }
  const cols = Math.max(1, colEind.length);
  return geplaatst.map((p) => ({ ...p, cols }));
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
  const dag = format(new Date(order.warmtefonds_afspraak_at), "yyyy-MM-dd");
  const start = new Date(order.warmtefonds_afspraak_at).getTime();
  const later = orders
    .filter(
      (o) =>
        o.id !== order.id &&
        o.warmtefonds_afspraak_at &&
        format(new Date(o.warmtefonds_afspraak_at), "yyyy-MM-dd") === dag &&
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

  const label =
    selected.length === 0
      ? "Geen status"
      : selected.length === WF_WERK_STATUSSEN.length
        ? "Alle statussen"
        : selected.length === 1
          ? WF_WERK_LABEL[selected[0]]
          : `${selected.length} statussen`;

  function toggle(status: WfWerkStatus) {
    onChange(
      selected.includes(status)
        ? selected.filter((s) => s !== status)
        : [...selected, status]
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-wash"
        aria-expanded={open}
      >
        <span className="max-w-[180px] truncate">{label}</span>
        <span className="text-[10px] text-muted" aria-hidden>
          ▾
        </span>
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
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoek, setZoek] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<WfWerkStatus[]>(WF_WERK_STANDAARD);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [contactId, setContactId] = useState<string | null>(null);
  const [afspraakId, setAfspraakId] = useState<string | null>(null);
  const [afspraakMsg, setAfspraakMsg] = useState<string | null>(null);
  const [openAfspraakId, setOpenAfspraakId] = useState<string | null>(null);
  const [reistijd, setReistijd] = useState<Record<string, ReisInfo>>({});
  const [documenten, setDocumenten] = useState<Record<string, KlantDocument[]>>(
    {}
  );
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );

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

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/warmtefonds/${token}/documenten`);
        const data = (await res.json().catch(() => ({}))) as {
          documenten?: (KlantDocument & {
            projectNummer?: string;
            klant?: string | null;
          })[];
        };
        if (cancelled || !res.ok) return;
        const map: Record<string, KlantDocument[]> = {};
        for (const doc of data.documenten || []) {
          const list = map[doc.projectId] || [];
          list.push(doc);
          map[doc.projectId] = list;
        }
        setDocumenten(map);
      } catch {
        /* documenten blijven leeg */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

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
      const blob = [lead?.naam, lead?.plaats, o.project_nummer, lead?.telefoon]
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

  function zetStap(
    id: string,
    patch: {
      financiering_status?: string | null;
      warmtefonds_afspraak_at?: string | null;
    }
  ) {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== id) return o;
        const next = { ...o, ...patch };
        if (
          !o.doorgestuurd_at &&
          (patch.financiering_status === "doorgestuurd_naar_edwin" ||
            patch.financiering_status === "afspraak_ingepland")
        ) {
          next.doorgestuurd_at = new Date().toISOString();
        }
        return next;
      })
    );
  }

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const agendaByDay = useMemo(() => {
    const map = new Map<string, OrderRow[]>();
    for (const d of weekDays) {
      map.set(format(d, "yyyy-MM-dd"), []);
    }
    for (const o of orders) {
      if (!o.warmtefonds_afspraak_at) continue;
      const at = new Date(o.warmtefonds_afspraak_at);
      if (Number.isNaN(at.getTime())) continue;
      const key = format(at, "yyyy-MM-dd");
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
    <div className="crm-bg flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-green-deeper bg-green-dark pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/brands/warmtefonds-logo.png"
              alt="Nationaal Warmtefonds"
              width={120}
              height={36}
              className="h-8 w-auto object-contain brightness-0 invert"
              priority
            />
            <div className="min-w-0 border-l border-white/20 pl-3">
              <p className="font-display text-sm font-bold text-white">
                Batterij<span className="text-orange">concept</span>
              </p>
              {operatorNaam ? (
                <p className="truncate text-[11px] text-white/55">
                  {operatorNaam}
                </p>
              ) : (
                <p className="text-[11px] text-white/55">Warmtefonds-portaal</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="shrink-0 border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-50"
          >
            {loading ? "…" : "Vernieuwen"}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-full bg-white p-1 ring-1 ring-line">
              {(
                [
                  { id: "aanvragen" as const, label: "Aanvragen" },
                  { id: "agenda" as const, label: "Agenda" },
                  { id: "creditfacturen" as const, label: "Creditfacturen" },
                  { id: "instellingen" as const, label: "Instellingen" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={[
                    "rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
                    tab === t.id
                      ? "bg-green-dark text-white"
                      : "text-muted hover:bg-wash hover:text-ink",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-[13px] text-muted">
              {tab === "aanvragen" ? (
                <>
                  <span className="font-semibold text-ink">{openQueue.length}</span>{" "}
                  {openQueue.length === 1 ? "aanvraag" : "aanvragen"}
                </>
              ) : tab === "creditfacturen" ? (
                "Edergy · €375 per aanvraag"
              ) : tab === "agenda" ? (
                "Interne afspraken"
              ) : (
                "Mails naar de klant"
              )}
            </p>
          </div>
          {tab === "aanvragen" ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              <StatusFilter selected={statusFilter} onChange={setStatusFilter} />
              <input
                value={zoek}
                onChange={(e) => setZoek(e.target.value)}
                placeholder="Zoek klant of project"
                className="h-9 w-full max-w-[240px] rounded-full border border-line bg-white px-4 text-sm text-ink outline-none placeholder:text-muted focus:border-green-dark sm:w-60"
              />
            </div>
          ) : null}
        </div>

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

        {loading ? (
          <p className="border border-line bg-white px-5 py-14 text-center text-sm text-muted">
            Laden…
          </p>
        ) : tab === "instellingen" ? (
          <WarmtefondsInstellingen token={token} />
        ) : tab === "creditfacturen" ? (
          <WarmtefondsCreditfacturen token={token} />
        ) : tab === "agenda" ? (
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
        ) : (
          <AanvragenLijst
            rows={openQueue}
            token={token}
            sortDir={sortDir}
            onToggleSort={() =>
              setSortDir((d) => (d === "desc" ? "asc" : "desc"))
            }
            onOpen={(id) => router.push(`/warmtefonds/${token}/orders/${id}`)}
            onContact={setContactId}
            onMaakAfspraak={setAfspraakId}
            onStap={zetStap}
            documenten={documenten}
          />
        )}
      </main>
      {afspraakOrder ? (
        <div
          role="dialog"
          aria-label="Maak WF Afspraak"
          className="fixed inset-0 z-[70] flex flex-col bg-white"
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
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <p className="mb-4 text-sm text-muted">
              De klant krijgt een bevestiging per e-mail.
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
          onClose={() => setContactId(null)}
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

function AanvragenLijst({
  rows,
  token,
  sortDir,
  onToggleSort,
  onOpen,
  onContact,
  onMaakAfspraak,
  onStap,
  documenten,
}: {
  rows: OrderRow[];
  token: string;
  sortDir: "desc" | "asc";
  onToggleSort: () => void;
  onOpen: (id: string) => void;
  onContact: (id: string) => void;
  onMaakAfspraak: (id: string) => void;
  onStap: (
    id: string,
    patch: {
      financiering_status?: string | null;
      warmtefonds_afspraak_at?: string | null;
    }
  ) => void;
  documenten: Record<string, KlantDocument[]>;
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
      <div className="divide-y divide-line md:hidden">
        {rows.map((o) => {
          const lead = leadOf(o);
          return (
            <div
              key={o.id}
              role="link"
              tabIndex={0}
              className="flex cursor-pointer flex-col gap-2 px-4 py-3"
              onClick={() => onOpen(o.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(o.id);
                }
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">
                    {lead?.naam || o.titel || "Klant"}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {lead ? adresRegel(lead) : "—"}
                  </p>
                  <KlantDocumenten docs={documenten[o.id] || []} />
                </div>
                <WfStapSelect
                  token={token}
                  order={o}
                  onUpdated={onStap}
                  onInplannen={onMaakAfspraak}
                />
              </div>
              <p className="text-xs text-muted">
                <span className="font-mono">{o.project_nummer}</span>
                {" · "}
                {o.bedragen?.warmtefondsInc != null
                  ? formatEuro(o.bedragen.warmtefondsInc)
                  : "—"}
                {lead?.telefoon ? ` · ${lead.telefoon}` : ""}
              </p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted">
                  {o.warmtefonds_afspraak_at
                    ? formatDateTimeNl(o.warmtefonds_afspraak_at)
                    : "Geen afspraak"}
                  {" · "}
                  {momentLabel(o.doorgestuurd_at)}
                </p>
                <div className="flex shrink-0 gap-1">
                  {o.warmtefonds_afspraak_at ? null : (
                    <button
                      type="button"
                      className="border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink hover:border-green hover:text-green-dark"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMaakAfspraak(o.id);
                      }}
                    >
                      Maak WF Afspraak
                    </button>
                  )}
                  <button
                    type="button"
                    className="border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink hover:border-green hover:text-green-dark"
                    onClick={(e) => {
                      e.stopPropagation();
                      onContact(o.id);
                    }}
                  >
                    Contact
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[64rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-wash/80 text-[11px] font-semibold text-ink">
              <th className="px-4 py-3 font-semibold">Naam</th>
              <th className="px-3 py-3 font-semibold">Nummer</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="px-3 py-3 font-semibold">Afspraak</th>
              <th className="px-3 py-3 font-semibold">Warmtefonds</th>
              <th className="px-3 py-3 font-semibold">Contact</th>
              <th className="px-3 py-3 font-semibold">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-green-dark"
                  onClick={onToggleSort}
                >
                  Doorgestuurd {sortDir === "desc" ? "↓" : "↑"}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const lead = leadOf(o);
              return (
                <tr
                  key={o.id}
                  className="cursor-pointer border-b border-line last:border-b-0 hover:bg-wash/50"
                  onClick={() => onOpen(o.id)}
                >
                  <td className="px-4 py-3">
                    <p className="truncate font-semibold text-ink">
                      {lead?.naam || o.titel || "Klant"}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {lead ? adresRegel(lead) : "—"}
                    </p>
                    <KlantDocumenten docs={documenten[o.id] || []} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-muted">
                    {o.project_nummer}
                  </td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <WfStapSelect
                      token={token}
                      order={o}
                      onUpdated={onStap}
                      onInplannen={onMaakAfspraak}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink">
                    <div className="flex flex-col items-start gap-1">
                      <span>
                        {o.warmtefonds_afspraak_at
                          ? formatDateTimeNl(o.warmtefonds_afspraak_at)
                          : "—"}
                      </span>
                      {o.warmtefonds_afspraak_at ? null : (
                        <button
                          type="button"
                          className="text-xs font-semibold text-green-dark hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            onMaakAfspraak(o.id);
                          }}
                        >
                          Maak WF Afspraak
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-medium text-ink">
                    {o.bedragen?.warmtefondsInc != null
                      ? formatEuro(o.bedragen.warmtefondsInc)
                      : "—"}
                  </td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:border-green hover:text-green-dark"
                      onClick={() => onContact(o.id)}
                    >
                      Contact
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 font-medium text-ink">
                    {momentLabel(o.doorgestuurd_at)}
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
  const totaal = weekDays.reduce(
    (n, d) => n + (agendaByDay.get(format(d, "yyyy-MM-dd"))?.length || 0),
    0
  );
  const hoogte = (AGENDA_END - AGENDA_START) * UUR_PX;

  return (
    <section className="overflow-hidden border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h2 className="font-display text-base font-semibold text-ink">
            {weekLabel}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {totaal} {totaal === 1 ? "afspraak" : "afspraken"} deze week
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrev}
            className="h-8 w-8 border border-line text-sm font-semibold hover:bg-wash"
            aria-label="Vorige week"
          >
            ←
          </button>
          <button
            type="button"
            onClick={onVandaag}
            className="h-8 border border-line px-3 text-xs font-semibold hover:bg-wash"
          >
            Vandaag
          </button>
          <button
            type="button"
            onClick={onNext}
            className="h-8 w-8 border border-line text-sm font-semibold hover:bg-wash"
            aria-label="Volgende week"
          >
            →
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[920px]">
          <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-b border-line">
            <div />
            {weekDays.map((day) => {
              const vandaag = isSameDay(day, new Date());
              return (
                <div
                  key={format(day, "yyyy-MM-dd")}
                  className={[
                    "px-2 py-2.5 text-center",
                    vandaag ? "bg-[#FFF7ED]" : "",
                  ].join(" ")}
                >
                  <p
                    className={[
                      "text-[11px] font-semibold uppercase tracking-wide",
                      vandaag ? "text-[#C45A12]" : "text-muted",
                    ].join(" ")}
                  >
                    {format(day, "EEE", { locale: nl })}
                  </p>
                  <p
                    className={[
                      "mx-auto mt-1 flex h-7 w-7 items-center justify-center text-sm font-semibold",
                      vandaag
                        ? "rounded-full bg-[#C45A12] text-white"
                        : "text-ink",
                    ].join(" ")}
                  >
                    {format(day, "d")}
                  </p>
                </div>
              );
            })}
          </div>

          <div
            className="relative grid grid-cols-[52px_repeat(7,minmax(0,1fr))]"
            style={{ height: hoogte }}
          >
            <div className="relative border-r border-line">
              {AGENDA_UREN.map((uur) => (
                <div
                  key={uur}
                  className="absolute right-1.5 text-[10px] font-medium tabular-nums text-muted"
                  style={{ top: (uur - AGENDA_START) * UUR_PX + 4 }}
                >
                  {String(uur).padStart(2, "0")}:00
                </div>
              ))}
            </div>
            {weekDays.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const items = agendaByDay.get(key) || [];
              const vandaag = isSameDay(day, new Date());
              const geplaatst = plaatsOpDag(items);
              return (
                <div
                  key={key}
                  className={[
                    "relative border-r border-line last:border-r-0",
                    vandaag ? "bg-[#FFF7ED]/60" : "bg-white",
                  ].join(" ")}
                >
                  {AGENDA_UREN.map((uur) => (
                    <div
                      key={uur}
                      className="pointer-events-none absolute inset-x-0 border-t border-line/80"
                      style={{ top: (uur - AGENDA_START) * UUR_PX }}
                    />
                  ))}
                  {geplaatst.map(({ order, col, cols }) => {
                    const at = new Date(order.warmtefonds_afspraak_at!);
                    const min = minutenVanDag(order.warmtefonds_afspraak_at!);
                    const startMin = AGENDA_START * 60;
                    const eindMin = AGENDA_END * 60;
                    const geklemd = Math.min(eindMin - 40, Math.max(startMin, min));
                    const top = ((geklemd - startMin) / 60) * UUR_PX;
                    const lead = leadOf(order);
                    const buiten = min < startMin || min >= eindMin;
                    const reis = reisTekst(reistijd[order.id]);
                    return (
                      <button
                        key={order.id}
                        type="button"
                        onClick={() => onOpen(order.id)}
                        className="absolute overflow-hidden rounded-md border border-[#FDBA74] bg-white px-1.5 py-1 text-left shadow-sm hover:border-[#C45A12] hover:shadow"
                        style={{
                          top: top + 2,
                          height: reis ? 62 : 48,
                          left: `calc(${(col / cols) * 100}% + 3px)`,
                          width: `calc(${100 / cols}% - 6px)`,
                        }}
                        title={lead?.naam || order.project_nummer}
                      >
                        <p className="text-[10px] font-bold leading-none text-[#C45A12]">
                          {format(at, "HH:mm")}
                          {buiten ? " ·" : ""}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] font-semibold leading-tight text-ink">
                          {lead?.naam || order.project_nummer}
                        </p>
                        <p className="truncate text-[10px] leading-tight text-muted">
                          {werkLabelVan(order)}
                        </p>
                        {reis ? (
                          <p className="truncate text-[10px] font-semibold leading-tight text-[#1A4A6E]">
                            {reis}
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
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
            <p className="mt-1 text-sm font-medium text-ink">
              {werkLabelVan(order)}
            </p>
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
