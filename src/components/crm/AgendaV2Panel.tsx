"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  addDays,
  addWeeks,
  format,
  startOfWeek,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type {
  Adviseur,
  Afspraak,
  AfspraakSoort,
  Lead,
  LeadStatus,
} from "@/types/database";
import { AMSTERDAM_TZ, formatTimeNl } from "@/lib/format";
import { isAdminAdviseur } from "@/lib/admin-adviseur";
import { isAgendaAdviseur } from "@/lib/rollen";
import {
  afspraakBlokkeertAgenda,
  afspraakMagOverBezetSlot,
  afspraakTypeLabel,
  afspraakZichtbaarInAgenda,
  needsVervolgPunt,
  normalizeAfspraakSoort,
} from "@/lib/afspraak-soort";
import {
  agendaWeekJumpOptions,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import { ADVISEUR_SLOT_HOURS } from "@/lib/slots";
import {
  afblokKey,
  isBeforeStartdatum,
  isSlotGeblokkeerd,
  magStandaardSlotOntblokken,
  standaardBlokkadeLabel,
} from "@/lib/adviseur-beschikbaarheid";
import { LeadZoekVeld } from "./LeadZoekVeld";
import { AfspraakDetail } from "./AgendaPanel";
import { LeadsTable } from "./LeadsTable";
import { ReistijdHint } from "./ReistijdHint";

/** Vaste afspraakblokken: 10:00, 13:00, 16:00, 19:00 */
const SLOT_ROWS: { label: string; hour: number; minute: number }[] =
  ADVISEUR_SLOT_HOURS.map((hour) => ({
    label: `${String(hour).padStart(2, "0")}:00`,
    hour,
    minute: 0,
  }));

type LegendItem = { color: string; label: string };

const LEGEND: LegendItem[] = [
  { color: "#94A3B8", label: "Afspraak ingepland" },
  { color: "#16A34A", label: "Doorgegaan" },
  { color: "#B91C1C", label: "Afgezegd" },
  { color: "#1E3A8A", label: "Deur niet open" },
  { color: "#7C3AED", label: "Verplaatsen" },
  { color: "#0F766E", label: "Doorgegaan + Vervolg" },
  { color: "#DB2777", label: "Doorgegaan + Sale" },
  { color: "#CA8A04", label: "Deal getekend" },
  { color: "#DC2626", label: "Niet goed gekwalificeerd" },
  { color: "#CA8A04", label: "Doorgegaan niet tijdig afgeboekt" },
  { color: "#6B7280", label: "Doorgegaan + Negatief" },
];

function dayKeyAmsterdam(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

/** Compacte kolomtitel: voornaam (+ initialen bij gelijke voornamen). */
function adviseurKortLabel(naam: string, allNames: string[]): string {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || naam;
  const sameFirst = allNames.filter(
    (n) => (n.trim().split(/\s+/)[0] || "") === first
  ).length;
  if (sameFirst <= 1 || parts.length < 2) return first;
  const initials = parts
    .slice(1)
    .map((p) => p[0]?.toUpperCase())
    .filter(Boolean)
    .join("");
  return initials ? `${first} ${initials}.` : first;
}

function agendaGridLayout(
  adviseurCount: number,
  narrow = false
): { cols: string; minWidthPx: number } {
  const n = Math.max(adviseurCount, 1);
  // Mobiel: 1 kolom = volle breedte (we tonen 1 adviseur tegelijk)
  if (narrow) {
    return { cols: "52px minmax(0, 1fr)", minWidthPx: 0 };
  }
  // Desktop: groeit mee, maar niet platter dan colMin (dan H-scroll)
  const timePx = n >= 8 ? 48 : 56;
  const colMin = n >= 10 ? 76 : n >= 7 ? 84 : 92;
  return {
    cols: `${timePx}px repeat(${n}, minmax(${colMin}px, 1fr))`,
    minWidthPx: timePx + n * colMin,
  };
}

function weekDaysFrom(anchor: Date) {
  const local = toZonedTime(anchor, AMSTERDAM_TZ);
  const monday = startOfWeek(local, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { key: format(date, "yyyy-MM-dd"), date };
  });
}

function appointmentHourLocal(startAt: string): number {
  const h = Number(formatInTimeZone(new Date(startAt), AMSTERDAM_TZ, "H"));
  const m = Number(formatInTimeZone(new Date(startAt), AMSTERDAM_TZ, "m"));
  return h + m / 60;
}

function nearestSlotIndex(startAt: string): number {
  const t = appointmentHourLocal(startAt);
  let best = 0;
  let bestDist = Infinity;
  SLOT_ROWS.forEach((row, i) => {
    const rowT = row.hour + row.minute / 60;
    const d = Math.abs(rowT - t);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

function isoForDaySlot(dayKey: string, hour: number, minute: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return fromZonedTime(
    new Date(y, m - 1, d, hour, minute, 0, 0),
    AMSTERDAM_TZ
  ).toISOString();
}

type StickerMeta = {
  badge: string;
  badgeClass: string;
  statusLabel: string;
  statusColor: string;
  tint: string;
  border: string;
};

function stickerMeta(
  a: Afspraak,
  leadStatus: string | null,
  vervolgIndex: number,
  needsCheckout: boolean
): StickerMeta {
  const soort = normalizeAfspraakSoort(a.soort);
  let badge = "Nieuw";
  let badgeClass = "bg-[#DBEAFE] text-[#1D4ED8]";
  if (soort === "vervolg_fysiek" || soort === "vervolg_tel" || soort === "vervolg_punt") {
    const n = Math.max(1, vervolgIndex);
    badge = n === 1 ? "1e Vervolg" : n === 2 ? "2e Vervolg" : `${n}e Vervolg`;
    badgeClass =
      n === 1
        ? "bg-[#EDE9FE] text-[#6D28D9]"
        : "bg-[#E0F2FE] text-[#0369A1]";
  } else if (soort === "bel" || soort === "warme_bel") {
    badge = "Bel";
    badgeClass = "bg-[#FEF3C7] text-[#B45309]";
  }

  // Default planned
  let statusLabel = "Afspraak ingepland";
  let statusColor = "#94A3B8";
  let tint = "#F8FAFC";
  let border = "#CBD5E1";

  if (a.status === "geannuleerd") {
    statusLabel = "Afgezegd";
    statusColor = "#B91C1C";
    tint = "#FEF2F2";
    border = "#FECACA";
  } else if (a.status === "voltooid" || leadStatus) {
    const ls = leadStatus || "";
    if (ls === "sale_financiering" || ls === "sale_eigen_middelen") {
      statusLabel = "Doorgegaan + Sale";
      statusColor = "#DB2777";
      tint = "#FDF2F8";
      border = "#F9A8D4";
    } else if (ls === "deal") {
      // Offerte getekend, maar uitkomst (financiering/eigen) nog niet afgerond
      statusLabel = "Deal getekend";
      statusColor = "#CA8A04";
      tint = "#FFFBEB";
      border = "#FCD34D";
    } else if (ls === "vervolg_fysiek" || ls === "vervolg_tel") {
      statusLabel = "Doorgegaan + Vervolg";
      statusColor = "#0F766E";
      tint = "#F0FDFA";
      border = "#99F6E4";
    } else if (ls === "deur_niet_open") {
      statusLabel = "Deur niet open";
      statusColor = "#1E3A8A";
      tint = "#EFF6FF";
      border = "#93C5FD";
    } else if (ls === "niet_gekwalificeerd") {
      statusLabel = "Niet goed gekwalificeerd";
      statusColor = "#DC2626";
      tint = "#FEF2F2";
      border = "#FECACA";
    } else if (
      ls === "geen_interesse" ||
      ls === "geen_interesse_al_batterij" ||
      ls === "geen_interesse_plugin" ||
      ls === "geen_interesse_alleen_info" ||
      ls === "geen_interesse_vertrouwt_niet" ||
      ls === "offerte_afgewezen" ||
      ls === "vervolg_geen_contact"
    ) {
      statusLabel = "Doorgegaan + Negatief";
      statusColor = "#6B7280";
      tint = "#F3F4F6";
      border = "#D1D5DB";
    } else if (ls === "afspraak_afgezegd_klant") {
      statusLabel = "Afgezegd";
      statusColor = "#B91C1C";
      tint = "#FEF2F2";
      border = "#FECACA";
    } else if (a.status === "voltooid") {
      statusLabel = "Doorgegaan";
      statusColor = "#16A34A";
      tint = "#F0FDF4";
      border = "#86EFAC";
    }
  }

  // Soft “verplaatsen” cue when lead still open after visit
  if (
    a.status !== "geannuleerd" &&
    a.status !== "voltooid" &&
    (leadStatus === "na_afspraak" || leadStatus === "afspraak")
  ) {
    // keep planned look unless explicitly something else
  }

  // Past visit/call not yet checked out → amber “niet tijdig afgeboekt”
  // (ook als cron status al op voltooid zette, of lead nog op vervolg_tel staat)
  if (
    needsCheckout &&
    a.status !== "geannuleerd" &&
    (statusLabel === "Afspraak ingepland" ||
      statusLabel === "Doorgegaan" ||
      statusLabel === "Doorgegaan + Vervolg")
  ) {
    statusLabel = "Doorgegaan niet tijdig afgeboekt";
    statusColor = "#CA8A04";
    tint = "#FFFBEB";
    border = "#FCD34D";
  }

  return { badge, badgeClass, statusLabel, statusColor, tint, border };
}

function StickerCard({
  a,
  leadStatus,
  vervolgIndex,
  needsCheckout,
  onClick,
}: {
  a: Afspraak;
  leadStatus: string | null;
  vervolgIndex: number;
  needsCheckout: boolean;
  onClick: () => void;
}) {
  const meta = stickerMeta(a, leadStatus, vervolgIndex, needsCheckout);
  const struck = a.status === "geannuleerd";
  const naam = a.leads?.naam || "Onbekend";
  const plaats = a.leads?.plaats || a.leads?.postcode || "—";
  const tijd = formatTimeNl(a.start_at);
  const typeLabel = afspraakTypeLabel(a.soort, leadStatus);
  const typeColor =
    typeLabel === "Tel" ? "#CA8A04" : "#16A34A";

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${needsCheckout ? "Nog niet afgeboekt · " : ""}${meta.badge} · ${typeLabel} · ${meta.statusLabel} · ${naam} · ${plaats} · ${tijd}`}
      className={[
        "relative w-full overflow-hidden rounded-md border px-1.5 py-1 text-left transition hover:brightness-[0.98]",
        struck ? "opacity-80" : "",
      ].join(" ")}
      style={{
        background: meta.tint,
        borderColor: meta.border,
        borderLeftWidth: 3,
        borderLeftColor: meta.statusColor,
      }}
    >
      {struck ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-2 top-1/2 z-[1] h-[1.5px] -translate-y-1/2 rotate-[-8deg]"
          style={{ background: meta.statusColor, opacity: 0.85 }}
        />
      ) : null}
      <div className="relative z-[2] flex min-w-0 items-center gap-1 overflow-hidden">
        <span
          className={`shrink-0 rounded px-1 py-px text-[9px] font-bold leading-tight ${meta.badgeClass}`}
        >
          {meta.badge}
        </span>
        {needsCheckout && !struck ? (
          <span
            className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#C45A12] text-[8px] font-bold leading-none text-white"
            title="Nog niet afgeboekt"
          >
            I
          </span>
        ) : null}
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[9px] font-medium text-[#4B5563]">
          <span
            className="inline-block h-1 w-1 rounded-full"
            style={{ background: typeColor }}
          />
          {typeLabel}
        </span>
        <span
          className={[
            "truncate text-[9px] font-medium",
            struck ? "line-through" : "",
          ].join(" ")}
          style={{ color: meta.statusColor }}
        >
          {meta.statusLabel}
        </span>
      </div>
      <p
        className={[
          "relative z-[2] mt-0.5 truncate text-[11px] font-bold leading-tight text-[#111827]",
          struck ? "line-through" : "",
        ].join(" ")}
      >
        {naam}
      </p>
      <p
        className={[
          "relative z-[2] truncate text-[9px] leading-tight text-[#6B7280]",
          struck ? "line-through" : "",
        ].join(" ")}
      >
        {plaats} · {tijd}
      </p>
    </button>
  );
}

function GeblokkeerdCell({
  onClick,
  hint,
}: {
  onClick?: () => void;
  hint?: string;
}) {
  const style = {
    background:
      "repeating-linear-gradient(135deg, #FEF2F2, #FEF2F2 6px, #FEE2E2 6px, #FEE2E2 12px)",
  };
  const className =
    "flex h-full min-h-[2.25rem] w-full items-center justify-center gap-0.5 rounded border border-[#FECACA] px-0.5 py-1 text-[#B91C1C]";
  const body = (
    <>
      <span className="text-[10px]">🔒</span>
      <span className="truncate text-[9px] font-semibold">Blok</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={hint || "Klik om te deblokkeren"}
        className={`${className} cursor-pointer transition hover:border-[#F87171]`}
        style={style}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={className} style={style}>
      {body}
    </div>
  );
}

export function AgendaPanel({
  leads,
  afspraken: afsprakenProp,
  defaultAdviseurId,
  adviseurs: adviseursProp = [],
  onStatusChange,
  onBellerChange,
  /** Admin: toon beschikbare slots voor de geselecteerde week. */
  showAdminSlots = false,
  /** Admin/backoffice: toon maandconversie (sales/gelopen) bij kolomnamen. */
  showConversie = false,
}: {
  leads: Lead[];
  afspraken?: Afspraak[];
  defaultAdviseurId?: string;
  adviseurs?: Adviseur[];
  onStatusChange?: (leadId: string, status: LeadStatus) => void;
  onBellerChange?: (leadId: string, bellerId: string | null) => void;
  showAdminSlots?: boolean;
  showConversie?: boolean;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const focusAfspraakId = searchParams.get("afspraak")?.trim() || null;
  const focusHandled = useRef<string | null>(null);

  const [afspraken, setAfspraken] = useState<Afspraak[]>(afsprakenProp || []);
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>(adviseursProp);
  const [loading, setLoading] = useState(!(afsprakenProp && afsprakenProp.length));
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [selectedDayKey, setSelectedDayKey] = useState(() =>
    dayKeyAmsterdam(new Date())
  );
  /** Leads-tab: welke dag (standaard vandaag; › = morgen, enz.). */
  const [leadsDayKey, setLeadsDayKey] = useState(() =>
    dayKeyAmsterdam(new Date())
  );
  const [calendarView, setCalendarView] = useState<"dag" | "week">("week");
  const [mainView, setMainView] = useState<"agenda" | "leads">("agenda");
  const slideRef = useRef<HTMLDivElement>(null);
  const ignoreScrollSync = useRef(false);
  const mobileViewInited = useRef(false);
  /** Telefoon: smalle viewport → 1 adviseur tegelijk (anders onleesbaar). */
  const [isNarrow, setIsNarrow] = useState(false);
  const [mobileAdviseurId, setMobileAdviseurId] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [adviseurMenuOpen, setAdviseurMenuOpen] = useState(false);
  const [beschikbaarMap, setBeschikbaarMap] = useState<Map<string, boolean>>(
    new Map()
  );
  /** Maandconversie sales/gelopen per adviseur (alleen admin/backoffice). */
  const [conversieByAdviseur, setConversieByAdviseur] = useState<
    Map<string, number>
  >(() => new Map());
  const [selected, setSelected] = useState<Afspraak | null>(null);
  const [planOpen, setPlanOpen] = useState(false);

  // Deep-link: /?tab=agenda&afspraak=<id> → spring naar week + open detail
  useEffect(() => {
    if (!focusAfspraakId) {
      focusHandled.current = null;
      return;
    }
    if (focusHandled.current === focusAfspraakId) return;
    const hit = afspraken.find((a) => a.id === focusAfspraakId);
    if (!hit) return;
    focusHandled.current = focusAfspraakId;
    setWeekAnchor(new Date(hit.start_at));
    setSelectedDayKey(dayKeyAmsterdam(hit.start_at));
    setMainView("agenda");
    setSelected(hit);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("afspraak");
    if (!params.get("tab")) params.set("tab", "agenda");
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [focusAfspraakId, afspraken, searchParams, router]);
  const [planSlot, setPlanSlot] = useState<{
    adviseurId: string;
    startAt: string;
    /** Slot heeft al een fysieke afspraak — alleen telefonisch/soft plannen */
    overBezet?: boolean;
  } | null>(null);
  const [pickedLead, setPickedLead] = useState<Lead | null>(null);
  const [planSoort, setPlanSoort] = useState<AfspraakSoort>("nieuw");
  /** Handmatig tijdstip (Amsterdam) — vooral voor terugbel */
  const [planStartLocal, setPlanStartLocal] = useState("");
  const [planNotitie, setPlanNotitie] = useState("");
  const [saving, setSaving] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  /** Klik op Afblokken → modus aan; daarna tijdslots aan/uit blokkeren. */
  const [afblokMode, setAfblokMode] = useState(false);
  const [afblokkingen, setAfblokkingen] = useState<Set<string>>(new Set());
  /** Standaard-vrijgaven (zondag / ma 10): key = afblokKey → slot is open */
  const [vrijgaven, setVrijgaven] = useState<Set<string>>(new Set());

  const todayKey = dayKeyAmsterdam(new Date());

  const days = useMemo(() => weekDaysFrom(weekAnchor), [weekAnchor]);
  const visibleDays = useMemo(() => {
    if (calendarView === "week") return days;
    const hit =
      days.find((d) => d.key === selectedDayKey) ||
      days.find((d) => d.key === todayKey) ||
      days[0];
    return [hit];
  }, [calendarView, days, selectedDayKey, todayKey]);

  const weekInfo = useMemo(() => schouwWeekFromDate(weekAnchor), [weekAnchor]);
  const weekJumpOptions = useMemo(() => agendaWeekJumpOptions(8, 40), []);

  // Inactieve adviseurs blijven zichtbaar (afblokken / eigen agenda),
  // bel-systeem filtert hen apart op actief.
  const planAdviseurs = useMemo(
    () =>
      adviseurs.filter(
        (a) => !isAdminAdviseur(a) && isAgendaAdviseur(a)
      ),
    [adviseurs]
  );

  const visibleAdviseurs = useMemo(() => {
    let list = planAdviseurs;
    if (defaultAdviseurId) {
      list = list.filter((a) => a.id === defaultAdviseurId);
    }
    return list.filter((a) => !hiddenIds.has(a.id));
  }, [planAdviseurs, defaultAdviseurId, hiddenIds]);

  // Mobiel: één adviseur in het grid (swipe Agenda↔Leads uit; chips om te wisselen)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!isNarrow) {
      mobileViewInited.current = false;
      return;
    }
    if (!mobileViewInited.current) {
      mobileViewInited.current = true;
      setCalendarView("dag");
    }
  }, [isNarrow]);

  useEffect(() => {
    if (!isNarrow || visibleAdviseurs.length === 0) return;
    if (
      mobileAdviseurId &&
      visibleAdviseurs.some((a) => a.id === mobileAdviseurId)
    ) {
      return;
    }
    setMobileAdviseurId(visibleAdviseurs[0]!.id);
  }, [isNarrow, visibleAdviseurs, mobileAdviseurId]);

  const displayAdviseurs = useMemo(() => {
    if (!isNarrow || defaultAdviseurId || visibleAdviseurs.length <= 1) {
      return visibleAdviseurs;
    }
    const id = mobileAdviseurId;
    const one = visibleAdviseurs.find((a) => a.id === id);
    return one ? [one] : visibleAdviseurs.slice(0, 1);
  }, [
    isNarrow,
    defaultAdviseurId,
    visibleAdviseurs,
    mobileAdviseurId,
  ]);

  /**
   * Per adviseur deze week: geplande blokken / totaal beschikbare blokken.
   * Beschikbaar = elk niet-geblokkeerd planbaar slot (ongeacht of er al iets in staat).
   * Gepland = zo’n slot met minstens één actieve fysieke afspraak.
   */
  const slotStatsByAdviseur = useMemo(() => {
    const gepland = new Map<string, number>();
    const beschikbaar = new Map<string, number>();
    const vrij = new Map<string, number>();

    for (const adv of planAdviseurs) {
      const weekKey = `${adv.id}:${weekInfo.jaar}-W${String(weekInfo.week).padStart(2, "0")}`;
      if (beschikbaarMap.get(weekKey) === false) {
        gepland.set(adv.id, 0);
        beschikbaar.set(adv.id, 0);
        vrij.set(adv.id, 0);
        continue;
      }
      let geplandN = 0;
      let beschikbaarN = 0;
      for (const day of days) {
        if (isBeforeStartdatum(`${day.key}T12:00:00`, adv.startdatum)) {
          continue;
        }
        for (let slotIdx = 0; slotIdx < SLOT_ROWS.length; slotIdx++) {
          const row = SLOT_ROWS[slotIdx]!;
          if (
            isSlotGeblokkeerd(
              adv.id,
              day.key,
              row.hour,
              afblokkingen,
              vrijgaven
            )
          ) {
            continue;
          }
          beschikbaarN += 1;
          const bezet = afspraken.some((a) => {
            if (a.status === "geannuleerd") return false;
            if (a.adviseur_id !== adv.id) return false;
            if (!afspraakBlokkeertAgenda(a.soort)) return false;
            if (dayKeyAmsterdam(a.start_at) !== day.key) return false;
            return nearestSlotIndex(a.start_at) === slotIdx;
          });
          if (bezet) geplandN += 1;
        }
      }
      gepland.set(adv.id, geplandN);
      beschikbaar.set(adv.id, beschikbaarN);
      vrij.set(adv.id, Math.max(0, beschikbaarN - geplandN));
    }

    return { gepland, beschikbaar, vrij };
  }, [
    planAdviseurs,
    weekInfo.jaar,
    weekInfo.week,
    days,
    beschikbaarMap,
    afblokkingen,
    vrijgaven,
    afspraken,
  ]);

  const afsprakenCountByAdviseur = slotStatsByAdviseur.gepland;
  const beschikbaarSlotsByAdviseur = slotStatsByAdviseur.beschikbaar;

  /**
   * Ingepland vs totaal planbare slots deze week (admin-kpi).
   */
  const slotsWeekTotals = useMemo(() => {
    if (!showAdminSlots) return { ingepland: 0, totaal: 0 };
    let ingepland = 0;
    let totaal = 0;
    // Alleen zichtbare adviseurs (filter Adviseurs)
    for (const adv of visibleAdviseurs) {
      ingepland += slotStatsByAdviseur.gepland.get(adv.id) || 0;
      totaal += slotStatsByAdviseur.beschikbaar.get(adv.id) || 0;
    }
    return { ingepland, totaal };
  }, [showAdminSlots, visibleAdviseurs, slotStatsByAdviseur]);

  /** Fysiek nieuwe huisbezoeken (soort=nieuw) in de geselecteerde week. */
  const nieuweHuisbezoekenWeek = useMemo(() => {
    if (!showAdminSlots) return 0;
    const dayKeys = new Set(days.map((d) => d.key));
    const advIds = new Set(visibleAdviseurs.map((a) => a.id));
    return afspraken.filter((a) => {
      if (a.status === "geannuleerd") return false;
      if (normalizeAfspraakSoort(a.soort) !== "nieuw") return false;
      if (!dayKeys.has(dayKeyAmsterdam(a.start_at))) return false;
      if (!advIds.has(a.adviseur_id)) return false;
      return true;
    }).length;
  }, [showAdminSlots, days, visibleAdviseurs, afspraken]);

  /** Leads met een zichtbare agenda-afspraak op de gekozen leads-dag. */
  const leadsVoorDag = useMemo(() => {
    const visibleAdvIds = new Set(visibleAdviseurs.map((a) => a.id));
    const opDag = afspraken
      .filter((a) => {
        if (a.status === "geannuleerd") return false;
        if (!afspraakZichtbaarInAgenda(a, afspraken)) return false;
        if (dayKeyAmsterdam(a.start_at) !== leadsDayKey) return false;
        if (defaultAdviseurId && a.adviseur_id !== defaultAdviseurId) {
          return false;
        }
        if (visibleAdvIds.size > 0 && !visibleAdvIds.has(a.adviseur_id)) {
          return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
      );

    const byId = new Map(leads.map((l) => [l.id, l]));
    const seen = new Set<string>();
    const out: Lead[] = [];
    for (const a of opDag) {
      if (seen.has(a.lead_id)) continue;
      seen.add(a.lead_id);
      const lead = byId.get(a.lead_id);
      if (lead) out.push(lead);
    }
    return out;
  }, [
    afspraken,
    leads,
    leadsDayKey,
    defaultAdviseurId,
    visibleAdviseurs,
  ]);

  const leadStatusById = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leads) if (l.id && l.status) m.set(l.id, l.status);
    return m;
  }, [leads]);

  const adviseurNaam = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of adviseurs) m.set(a.id, a.naam);
    return m;
  }, [adviseurs]);

  function scrollToView(view: "agenda" | "leads") {
    if (isNarrow) return; // Mobiel: tabs wisselen zonder swipe-container
    const el = slideRef.current;
    if (!el) return;
    ignoreScrollSync.current = true;
    const idx = view === "agenda" ? 0 : 1;
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
    window.setTimeout(() => {
      ignoreScrollSync.current = false;
    }, 350);
  }

  function selectMainView(view: "agenda" | "leads") {
    setMainView(view);
    scrollToView(view);
  }

  useEffect(() => {
    const el = slideRef.current;
    if (!el || isNarrow) return;
    const onScroll = () => {
      if (ignoreScrollSync.current) return;
      const w = el.clientWidth || 1;
      const idx = Math.round(el.scrollLeft / w);
      setMainView(idx <= 0 ? "agenda" : "leads");
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [isNarrow]);

  useEffect(() => {
    if (adviseursProp.length) setAdviseurs(adviseursProp);
  }, [adviseursProp]);

  /** Volgorde van vervolg-afspraken per lead. */
  const vervolgIndexByAfspraak = useMemo(() => {
    const byLead = new Map<string, Afspraak[]>();
    for (const a of afspraken) {
      const s = normalizeAfspraakSoort(a.soort);
      if (
        s !== "vervolg_fysiek" &&
        s !== "vervolg_tel" &&
        s !== "vervolg_punt"
      ) {
        continue;
      }
      const list = byLead.get(a.lead_id) || [];
      list.push(a);
      byLead.set(a.lead_id, list);
    }
    const out = new Map<string, number>();
    for (const [, list] of byLead) {
      list
        .slice()
        .sort(
          (x, y) =>
            new Date(x.start_at).getTime() - new Date(y.start_at).getTime()
        )
        .forEach((a, i) => out.set(a.id, i + 1));
    }
    return out;
  }, [afspraken]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, adv] = await Promise.all([
        fetch("/api/afspraken", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/adviseurs", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (!a.error) {
        const list = (a.afspraken || []) as Afspraak[];
        setAfspraken(
          defaultAdviseurId
            ? list.filter((x) => x.adviseur_id === defaultAdviseurId)
            : list
        );
      } else if (!afsprakenProp?.length) throw new Error(a.error);
      if (!adv.error) setAdviseurs(adv.adviseurs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [afsprakenProp, defaultAdviseurId]);

  // Props vanuit CRM (o.a. net gepland via Bel) meteen tonen — merge, niet wissen.
  useEffect(() => {
    if (!afsprakenProp?.length) return;
    setAfspraken((prev) => {
      const fromProp = defaultAdviseurId
        ? afsprakenProp.filter((x) => x.adviseur_id === defaultAdviseurId)
        : afsprakenProp;
      if (!prev.length) return fromProp;
      const byId = new Map(prev.map((a) => [a.id, a]));
      for (const a of fromProp) {
        const cur = byId.get(a.id);
        byId.set(a.id, cur ? { ...cur, ...a } : a);
      }
      return [...byId.values()].sort(
        (a, b) =>
          new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
      );
    });
  }, [afsprakenProp, defaultAdviseurId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Maandconversie (sales / gelopen) — alleen admin/backoffice in team-agenda
  useEffect(() => {
    if (!showConversie || defaultAdviseurId) {
      setConversieByAdviseur(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/maand-leaderboard", {
          credentials: "include",
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as {
          rows?: { adviseur_id: string; conversie_pct: number | null }[];
        };
        if (!res.ok || cancelled) return;
        const map = new Map<string, number>();
        for (const row of data.rows || []) {
          if (row.conversie_pct == null) continue;
          map.set(row.adviseur_id, Math.round(row.conversie_pct));
        }
        if (!cancelled) setConversieByAdviseur(map);
      } catch {
        if (!cancelled) setConversieByAdviseur(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showConversie, defaultAdviseurId]);

  // Beschikbaarheid alle zichtbare adviseurs voor dit jaar
  useEffect(() => {
    const ids = planAdviseurs.map((a) => a.id);
    if (!ids.length) return;
    let cancelled = false;
    const y = weekInfo.jaar;
    (async () => {
      const map = new Map<string, boolean>();
      await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(
              `/api/adviseurs/beschikbaarheid?adviseur_id=${id}&jaren=${y - 1},${y},${y + 1}`
            );
            const data = await res.json();
            for (const item of data.items || []) {
              const key = `${id}:${item.jaar}-W${String(item.week).padStart(2, "0")}`;
              map.set(key, item.beschikbaar !== false);
            }
          } catch {
            /* ignore */
          }
        })
      );
      if (!cancelled) setBeschikbaarMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [planAdviseurs, weekInfo.jaar]);

  // Slot-afblokkingen + standaard-vrijgaven (zondag / ma 10) voor de zichtbare week
  useEffect(() => {
    const ids = planAdviseurs.map((a) => a.id);
    if (!ids.length || !days.length) {
      setAfblokkingen(new Set());
      setVrijgaven(new Set());
      return;
    }
    let cancelled = false;
    const van = days[0].key;
    const tot = days[days.length - 1].key;
    (async () => {
      try {
        const res = await fetch(
          `/api/adviseurs/afblokkingen?adviseur_ids=${encodeURIComponent(ids.join(","))}&van=${van}&tot=${tot}`
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          if (data.migration_required) return;
          throw new Error(data.error || "Afblokkingen laden mislukt");
        }
        const next = new Set<string>();
        for (const item of data.items || []) {
          next.add(
            afblokKey(
              item.adviseur_id as string,
              item.dag as string,
              Number(item.slot_hour)
            )
          );
        }
        const nextVrij = new Set<string>();
        for (const item of data.vrijgaven || []) {
          nextVrij.add(
            afblokKey(
              item.adviseur_id as string,
              item.dag as string,
              Number(item.slot_hour)
            )
          );
        }
        setAfblokkingen(next);
        setVrijgaven(nextVrij);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Afblokkingen laden mislukt"
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planAdviseurs, days]);

  function isWeekBlocked(adviseurId: string): boolean {
    const key = `${adviseurId}:${weekInfo.jaar}-W${String(weekInfo.week).padStart(2, "0")}`;
    const v = beschikbaarMap.get(key);
    return v === false;
  }

  function isSlotBlocked(
    adviseurId: string,
    dayKey: string,
    hour: number
  ): boolean {
    return isSlotGeblokkeerd(
      adviseurId,
      dayKey,
      hour,
      afblokkingen,
      vrijgaven
    );
  }

  async function toggleSlotAfblok(
    adviseurId: string,
    dayKey: string,
    hour: number
  ) {
    const key = afblokKey(adviseurId, dayKey, hour);
    const currentlyBlocked = isSlotBlocked(adviseurId, dayKey, hour);
    const nextBlocked = !currentlyBlocked;
    const viaVrijgave = magStandaardSlotOntblokken(dayKey, hour, adviseurId);
    setBlockBusy(true);
    setError(null);
    setOkMsg(null);
    // Optimistic
    if (viaVrijgave) {
      setVrijgaven((prev) => {
        const copy = new Set(prev);
        if (nextBlocked) copy.delete(key); // dicht = geen vrijgave
        else copy.add(key); // open = vrijgave
        return copy;
      });
    } else {
      setAfblokkingen((prev) => {
        const copy = new Set(prev);
        if (nextBlocked) copy.add(key);
        else copy.delete(key);
        return copy;
      });
    }
    try {
      const res = await fetch("/api/adviseurs/afblokkingen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adviseur_id: adviseurId,
          dag: dayKey,
          slot_hour: hour,
          geblokkeerd: nextBlocked,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Blokkeren mislukt");
      setOkMsg(
        data.message ||
          (nextBlocked
            ? `${dayKey} ${String(hour).padStart(2, "0")}:00 geblokkeerd`
            : `${dayKey} ${String(hour).padStart(2, "0")}:00 weer open`)
      );
    } catch (e) {
      // Rollback
      if (viaVrijgave) {
        setVrijgaven((prev) => {
          const copy = new Set(prev);
          if (currentlyBlocked) copy.delete(key);
          else copy.add(key);
          return copy;
        });
      } else {
        setAfblokkingen((prev) => {
          const copy = new Set(prev);
          if (currentlyBlocked) copy.add(key);
          else copy.delete(key);
          return copy;
        });
      }
      setError(e instanceof Error ? e.message : "Blokkeren mislukt");
    } finally {
      setBlockBusy(false);
    }
  }

  function handleEmptySlotClick(
    adviseurId: string,
    dayKey: string,
    slotIdx: number
  ) {
    const row = SLOT_ROWS[slotIdx];
    if (afblokMode) {
      void toggleSlotAfblok(adviseurId, dayKey, row.hour);
      return;
    }
    openPlan(adviseurId, dayKey, slotIdx);
  }

  function appointmentsInCell(
    adviseurId: string,
    dayKey: string,
    slotIdx: number
  ): Afspraak[] {
    return afspraken.filter((a) => {
      if (a.adviseur_id !== adviseurId) return false;
      if (!afspraakZichtbaarInAgenda(a, afspraken)) return false;
      if (dayKeyAmsterdam(a.start_at) !== dayKey) return false;
      return nearestSlotIndex(a.start_at) === slotIdx;
    });
  }

  async function planAfspraak(e: React.FormEvent) {
    e.preventDefault();
    if (!planSlot || !pickedLead) return;
    if (planSlot.overBezet && !afspraakMagOverBezetSlot(planSoort)) {
      setError(
        "Op een bezet tijdblok kun je alleen een telefonisch/terugbel plannen"
      );
      return;
    }
    const isTerugbel = planSoort === "bel" || planSoort === "warme_bel";
    if (isTerugbel && !planNotitie.trim()) {
      setError("Vul een notitie in voor de terugbelafspraak");
      return;
    }
    const startAt =
      isTerugbel && planStartLocal.trim()
        ? planStartLocal.trim()
        : planSlot.startAt;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/afspraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: pickedLead.id,
          adviseur_id: planSlot.adviseurId,
          start_at: startAt,
          soort: planSoort,
          ...(planNotitie.trim() ? { notities: planNotitie.trim() } : {}),
          ...(planSoort === "nieuw"
            ? { partner_aanwezig: true, andere_offertes_gehad: false }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Plannen mislukt");
      setOkMsg(
        isTerugbel
          ? "Terugbelafspraak gepland (zichtbaar onder Bellen)"
          : planSoort === "vervolg_tel"
            ? "Telefonisch vervolg gepland"
            : "Afspraak gepland"
      );
      setPlanOpen(false);
      setPlanSlot(null);
      setPickedLead(null);
      setPlanNotitie("");
      setPlanStartLocal("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  function openPlan(
    adviseurId: string,
    dayKey: string,
    slotIdx: number,
    opts?: { overBezet?: boolean }
  ) {
    const overBezet = Boolean(opts?.overBezet);
    // Soft (tel/terugbel): mag ook in geblokkeerde week
    if (!overBezet && isWeekBlocked(adviseurId)) {
      setError("Deze week is geblokkeerd voor deze adviseur");
      return;
    }
    const row = SLOT_ROWS[slotIdx];
    // Over bezet slot: afblokkingen negeren — telefonisch/terugbel mag altijd
    if (!overBezet && isSlotBlocked(adviseurId, dayKey, row.hour)) {
      setError(
        magStandaardSlotOntblokken(dayKey, row.hour, adviseurId)
          ? `${standaardBlokkadeLabel(dayKey, row.hour, adviseurId) || "Standaard geblokkeerd"} — open eerst via Afblokken`
          : "Dit tijdslot is afgeblokt"
      );
      return;
    }
    const startAt = isoForDaySlot(dayKey, row.hour, row.minute);
    setPlanSlot({
      adviseurId,
      startAt,
      overBezet,
    });
    setPlanSoort(overBezet ? "bel" : "nieuw");
    setPlanStartLocal(
      formatInTimeZone(new Date(startAt), AMSTERDAM_TZ, "yyyy-MM-dd'T'HH:mm")
    );
    setPlanNotitie("");
    setPickedLead(null);
    setPlanOpen(true);
    setSelected(null);
  }

  const weekTitle = `Week ${weekInfo.week} — ${format(days[0].date, "d MMM.", { locale: nl })} t/m ${format(days[6].date, "d MMM. yyyy", { locale: nl })}`;
  const leadsDayDate = fromZonedTime(`${leadsDayKey}T12:00:00`, AMSTERDAM_TZ);
  const leadsIsToday = leadsDayKey === todayKey;
  const leadsDayLabel = format(leadsDayDate, "EEEE d MMMM", { locale: nl });
  const leadsTitle = leadsIsToday
    ? `Leads vandaag · ${leadsDayLabel}`
    : `Leads · ${leadsDayLabel}`;
  const { cols: gridCols, minWidthPx: gridMinWidth } = agendaGridLayout(
    displayAdviseurs.length,
    isNarrow
  );
  const adviseurNamen = displayAdviseurs.map((a) => a.naam);
  const hiddenCount = planAdviseurs.length - visibleAdviseurs.length;
  const showMobileAdviseurPicker =
    isNarrow && !defaultAdviseurId && visibleAdviseurs.length > 1;

  return (
    <div className="flex h-full min-h-[70vh] flex-col bg-white">
      {/* Header */}
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <div className="mb-3 flex w-fit rounded-lg border border-line p-0.5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => selectMainView("agenda")}
            className={[
              "rounded-md px-3 py-1.5",
              mainView === "agenda"
                ? "bg-green text-white"
                : "text-muted hover:text-ink",
            ].join(" ")}
          >
            Agenda
          </button>
          <button
            type="button"
            onClick={() => selectMainView("leads")}
            className={[
              "rounded-md px-3 py-1.5",
              mainView === "leads"
                ? "bg-green text-white"
                : "text-muted hover:text-ink",
            ].join(" ")}
          >
            {leadsIsToday ? "Leads vandaag" : "Leads"}
            {leadsVoorDag.length > 0 ? (
              <span className="ml-1.5 tabular-nums opacity-80">
                ({leadsVoorDag.length})
              </span>
            ) : null}
          </button>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {showAdminSlots && mainView === "agenda" ? (
              <div className="mb-1.5 flex flex-wrap gap-6 text-sm font-semibold tabular-nums text-ink">
                <p>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Totaal ingepland / Totaal slots
                  </span>
                  <span className="mt-0.5 block font-display text-2xl font-semibold sm:text-3xl">
                    {slotsWeekTotals.ingepland}/{slotsWeekTotals.totaal}
                  </span>
                </p>
                <p>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Fysiek nieuwe huisbezoeken
                  </span>
                  <span className="mt-0.5 block font-display text-2xl font-semibold sm:text-3xl">
                    {nieuweHuisbezoekenWeek}
                  </span>
                </p>
              </div>
            ) : null}
            <h1 className="font-display text-xl font-semibold text-ink sm:text-2xl">
              {mainView === "leads" ? leadsTitle : weekTitle}
            </h1>
            {mainView === "agenda" ? (
            <div className="mt-2 flex max-w-4xl flex-wrap gap-x-3 gap-y-1">
              {LEGEND.map((l) => (
                <span
                  key={l.label}
                  className="inline-flex items-center gap-1.5 text-[10px] text-muted"
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: l.color }}
                  />
                  {l.label}
                </span>
              ))}
            </div>
            ) : (
              <p className="mt-1 text-sm text-muted">
                Leads met een afspraak op deze dag — blader vooruit naar morgen
                of later.
              </p>
            )}
          </div>

          {mainView === "leads" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setLeadsDayKey(dayKeyAmsterdam(addDays(leadsDayDate, -1)))
              }
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line hover:bg-wash"
              title="Vorige dag"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setLeadsDayKey(todayKey)}
              className={[
                "rounded-lg border px-3 py-1.5 text-xs font-semibold",
                leadsIsToday
                  ? "border-green bg-green-soft text-green-dark"
                  : "border-line hover:bg-wash",
              ].join(" ")}
            >
              Vandaag
            </button>
            <button
              type="button"
              onClick={() =>
                setLeadsDayKey(dayKeyAmsterdam(addDays(leadsDayDate, 1)))
              }
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line hover:bg-wash"
              title="Volgende dag"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() =>
                setLeadsDayKey(
                  dayKeyAmsterdam(
                    addDays(
                      fromZonedTime(`${todayKey}T12:00:00`, AMSTERDAM_TZ),
                      1
                    )
                  )
                )
              }
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-wash"
            >
              Morgen
            </button>
          </div>
          ) : null}

          {mainView === "agenda" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex rounded-lg border border-line p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setCalendarView("dag")}
                className={[
                  "rounded-md px-2.5 py-1.5",
                  calendarView === "dag"
                    ? "bg-green text-white"
                    : "text-muted hover:text-ink",
                ].join(" ")}
              >
                Dag
              </button>
              <button
                type="button"
                onClick={() => setCalendarView("week")}
                className={[
                  "rounded-md px-2.5 py-1.5",
                  calendarView === "week"
                    ? "bg-green text-white"
                    : "text-muted hover:text-ink",
                ].join(" ")}
              >
                Week
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                if (calendarView === "dag") {
                  const next = addDays(
                    days.find((d) => d.key === selectedDayKey)?.date ||
                      weekAnchor,
                    -1
                  );
                  setSelectedDayKey(dayKeyAmsterdam(next));
                  setWeekAnchor(next);
                } else {
                  setWeekAnchor((d) => addWeeks(d, -1));
                }
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line hover:bg-wash"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setWeekAnchor(now);
                setSelectedDayKey(dayKeyAmsterdam(now));
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-wash"
            >
              Vandaag
            </button>
            <button
              type="button"
              onClick={() => {
                if (calendarView === "dag") {
                  const next = addDays(
                    days.find((d) => d.key === selectedDayKey)?.date ||
                      weekAnchor,
                    1
                  );
                  setSelectedDayKey(dayKeyAmsterdam(next));
                  setWeekAnchor(next);
                } else {
                  setWeekAnchor((d) => addWeeks(d, 1));
                }
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line hover:bg-wash"
            >
              ›
            </button>
            <select
              value={schouwWeekValue(weekInfo.jaar, weekInfo.week)}
              onChange={(e) => {
                const p = parseSchouwWeekValue(e.target.value);
                if (!p) return;
                setWeekAnchor(
                  new Date(schouwWeekToMondayIso(p.jaar, p.week))
                );
              }}
              className="min-h-9 rounded-lg border border-line bg-white px-2 text-xs font-semibold"
            >
              {weekJumpOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  W{o.week} · {o.jaar}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={blockBusy}
              onClick={() => {
                setAfblokMode((v) => {
                  const next = !v;
                  setOkMsg(
                    next
                      ? "Afblok-modus: klik op een tijdslot om te blokkeren of te openen"
                      : null
                  );
                  setError(null);
                  return next;
                });
              }}
              className={[
                "rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-60",
                afblokMode
                  ? "border-[#B91C1C] bg-[#FEF2F2] text-[#B91C1C]"
                  : "border-line hover:bg-wash",
              ].join(" ")}
            >
              {afblokMode ? "Klaar met afblokken" : "Afblokken"}
            </button>
            {!defaultAdviseurId && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAdviseurMenuOpen((v) => !v)}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-wash"
                >
                  Adviseurs
                  {hiddenCount > 0 ? (
                    <span className="ml-1 text-muted">
                      (−{hiddenCount})
                    </span>
                  ) : null}
                </button>
                {adviseurMenuOpen && (
                  <div className="absolute right-0 z-20 mt-1 max-h-72 w-60 overflow-auto border border-line bg-white p-2 shadow-lg">
                    <div className="mb-1 flex gap-1 border-b border-line pb-2">
                      <button
                        type="button"
                        className="flex-1 rounded border border-line px-2 py-1 text-[11px] font-semibold hover:bg-wash"
                        onClick={() => setHiddenIds(new Set())}
                      >
                        Alles
                      </button>
                      <button
                        type="button"
                        className="flex-1 rounded border border-line px-2 py-1 text-[11px] font-semibold hover:bg-wash"
                        onClick={() =>
                          setHiddenIds(
                            new Set(planAdviseurs.map((a) => a.id))
                          )
                        }
                      >
                        Geen
                      </button>
                    </div>
                    {planAdviseurs.map((a) => {
                      const hidden = hiddenIds.has(a.id);
                      const gepland = afsprakenCountByAdviseur.get(a.id) || 0;
                      const totaal = beschikbaarSlotsByAdviseur.get(a.id) || 0;
                      return (
                        <label
                          key={a.id}
                          className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-wash"
                        >
                          <input
                            type="checkbox"
                            checked={!hidden}
                            onChange={() => {
                              setHiddenIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(a.id)) next.delete(a.id);
                                else next.add(a.id);
                                return next;
                              });
                            }}
                          />
                          <span className="min-w-0 flex-1 truncate">{a.naam}</span>
                          <span className="shrink-0 tabular-nums text-[10px] text-muted">
                            {gepland}/{totaal}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          ) : null}
        </div>

        {(error || okMsg || afblokMode) && (
          <div className="mt-3 space-y-1">
            {afblokMode && (
              <p className="border border-[#B91C1C]/25 bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#B91C1C]">
                Afblok-modus actief — klik op een leeg tijdslot (10 / 13 / 16 /
                19) om te blokkeren of weer te openen. Klik op “Klaar met
                afblokken” als je klaar bent.
              </p>
            )}
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
      </div>

      {/* Desktop: swipe Agenda | Leads. Mobiel: tabs wisselen, geen swipe (voorkomt bugs). */}
      <div
        ref={slideRef}
        className={[
          "flex min-h-0 flex-1",
          isNarrow
            ? "overflow-hidden"
            : "snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-smooth",
        ].join(" ")}
      >
        {(!isNarrow || mainView === "agenda") && (
        <div
          className={[
            "min-h-0 shrink-0 overflow-y-auto overflow-x-auto",
            isNarrow ? "w-full" : "w-full min-w-full snap-start",
          ].join(" ")}
        >
        {loading ? (
          <p className="p-8 text-center text-sm text-muted">Laden…</p>
        ) : visibleAdviseurs.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">
            Geen adviseurs zichtbaar.
            {!defaultAdviseurId && hiddenCount > 0 ? (
              <>
                {" "}
                <button
                  type="button"
                  className="font-semibold text-green underline"
                  onClick={() => setHiddenIds(new Set())}
                >
                  Toon alle {planAdviseurs.length}
                </button>
              </>
            ) : null}
          </p>
        ) : (
          <div
            className="w-full"
            style={gridMinWidth > 0 ? { minWidth: gridMinWidth } : undefined}
          >
            {showMobileAdviseurPicker ? (
              <div className="sticky top-0 z-40 flex gap-1.5 overflow-x-auto border-b border-line bg-white px-2 py-2">
                {visibleAdviseurs.map((a) => {
                  const active = displayAdviseurs[0]?.id === a.id;
                  const gepland = afsprakenCountByAdviseur.get(a.id) || 0;
                  const totaal = beschikbaarSlotsByAdviseur.get(a.id) || 0;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setMobileAdviseurId(a.id)}
                      className={[
                        "shrink-0 rounded-lg border px-2.5 py-1.5 text-left text-[12px] font-semibold",
                        active
                          ? "border-green bg-green text-white"
                          : "border-line bg-[#FAFBFA] text-ink",
                      ].join(" ")}
                    >
                      {adviseurKortLabel(
                        a.naam,
                        visibleAdviseurs.map((x) => x.naam)
                      )}
                      <span
                        className={[
                          "ml-1 tabular-nums",
                          active ? "text-white/80" : "text-muted",
                        ].join(" ")}
                      >
                        {gepland}/{totaal}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {/* Sticky kolomheaders — desktop (mobiel: chips hierboven) */}
            {!showMobileAdviseurPicker ? (
              <div className="sticky top-0 z-30 border-b border-line bg-white">
                <div
                  className="grid bg-white"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <div className="border-r border-line bg-[#FAFBFA]" />
                  {displayAdviseurs.map((a) => {
                    const gepland = afsprakenCountByAdviseur.get(a.id) || 0;
                    const totaal = beschikbaarSlotsByAdviseur.get(a.id) || 0;
                    const cr = showConversie
                      ? conversieByAdviseur.get(a.id)
                      : undefined;
                    const label = adviseurKortLabel(a.naam, adviseurNamen);
                    return (
                      <div
                        key={a.id}
                        className="min-w-0 border-r border-line px-0.5 py-1.5 text-center"
                        title={
                          cr != null
                            ? `${a.naam} · ${gepland}/${totaal} · ${cr}% cr (maand)`
                            : `${a.naam} · ${gepland}/${totaal}`
                        }
                      >
                        <p className="truncate text-[11px] font-semibold leading-tight text-ink">
                          {label}
                          {cr != null ? (
                            <span className="font-medium text-muted">
                              {" "}
                              ({cr}% cr)
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-[10px] font-medium tabular-nums text-muted">
                          {gepland}/{totaal}
                        </p>
                        {isWeekBlocked(a.id) && (
                          <p className="mt-0.5 text-[9px] font-semibold text-[#B91C1C]">
                            Blok
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {visibleDays.map((day) => (
              <div key={day.key}>
                <div
                  className="grid border-b border-line bg-[#F3F4F6]"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <div className="flex items-center border-r border-line bg-[#F3F4F6] px-0.5 py-1">
                    <span className="w-full text-center text-[9px] font-bold uppercase leading-tight tracking-wide text-[#4B5563]">
                      {format(day.date, "EEE", { locale: nl })}
                      <span className="mt-0.5 block text-[10px] font-semibold tabular-nums normal-case tracking-normal">
                        {format(day.date, "d", { locale: nl })}
                      </span>
                    </span>
                  </div>
                  <div
                    className="flex items-center px-2 py-1 text-[11px] font-semibold capitalize text-[#4B5563]"
                    style={{ gridColumn: `2 / -1` }}
                  >
                    {format(day.date, "EEEE d MMM.", { locale: nl })}
                  </div>
                </div>
                {SLOT_ROWS.map((row, slotIdx) => (
                  <div
                    key={`${day.key}-${row.label}`}
                    className="grid border-b border-line"
                    style={{ gridTemplateColumns: gridCols }}
                  >
                    <div className="flex items-start justify-end border-r border-line bg-[#FAFBFA] px-1 py-1.5 text-[12px] font-bold tabular-nums leading-none text-ink">
                      {row.label}
                    </div>
                    {displayAdviseurs.map((adv) => {
                      const weekBlocked = isWeekBlocked(adv.id);
                      const slotBlocked = isSlotBlocked(
                        adv.id,
                        day.key,
                        row.hour
                      );
                      const blocked = weekBlocked || slotBlocked;
                      const items = appointmentsInCell(
                        adv.id,
                        day.key,
                        slotIdx
                      );
                      return (
                        <div
                          key={`${adv.id}-${day.key}-${slotIdx}`}
                          className={[
                            "min-h-[2.75rem] min-w-0 border-r border-line p-0.5",
                            afblokMode && items.length === 0
                              ? "bg-[#FFF7F7]/60"
                              : "",
                          ].join(" ")}
                        >
                          {blocked && items.length === 0 ? (
                            <div className="space-y-1">
                              <GeblokkeerdCell
                                onClick={
                                  afblokMode && !blockBusy && !weekBlocked
                                    ? () =>
                                        void toggleSlotAfblok(
                                          adv.id,
                                          day.key,
                                          row.hour
                                        )
                                    : afblokMode && weekBlocked
                                      ? () =>
                                          setError(
                                            "Hele week is geblokkeerd — slot-afblokken kan dan niet"
                                          )
                                      : magStandaardSlotOntblokken(
                                            day.key,
                                            row.hour,
                                            adv.id
                                          ) && !afblokMode
                                        ? () =>
                                            setError(
                                              standaardBlokkadeLabel(
                                                day.key,
                                                row.hour,
                                                adv.id
                                              ) ||
                                                "Standaard dicht — zet Afblokken aan om te openen"
                                            )
                                        : undefined
                                }
                                hint={
                                  afblokMode
                                    ? slotBlocked
                                      ? magStandaardSlotOntblokken(
                                          day.key,
                                          row.hour,
                                          adv.id
                                        )
                                        ? "Klik om standaard-blok te openen"
                                        : "Klik om dit slot weer te openen"
                                      : "Week geblokkeerd"
                                    : magStandaardSlotOntblokken(
                                          day.key,
                                          row.hour,
                                          adv.id
                                        )
                                      ? standaardBlokkadeLabel(
                                          day.key,
                                          row.hour,
                                          adv.id
                                        ) || "Standaard dicht"
                                      : undefined
                                }
                              />
                            </div>
                          ) : items.length > 0 ? (
                            <div className="space-y-1">
                              {items.map((a) => {
                                const ls =
                                  (a.status === "voltooid" && a.leads?.status
                                    ? a.leads.status
                                    : null) ||
                                  leadStatusById.get(a.lead_id) ||
                                  a.leads?.status ||
                                  null;
                                const needsCheckout = needsVervolgPunt(
                                  a,
                                  afspraken,
                                  new Date(),
                                  ls
                                );
                                return (
                                  <StickerCard
                                    key={a.id}
                                    a={a}
                                    leadStatus={ls}
                                    needsCheckout={needsCheckout}
                                    vervolgIndex={
                                      vervolgIndexByAfspraak.get(a.id) || 1
                                    }
                                    onClick={() => {
                                      if (afblokMode) {
                                        setError(
                                          "Dit slot heeft al een afspraak — kies een leeg tijdslot"
                                        );
                                        return;
                                      }
                                      setSelected(a);
                                      setPlanOpen(false);
                                    }}
                                  />
                                );
                              })}
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={blockBusy}
                              onClick={() =>
                                handleEmptySlotClick(adv.id, day.key, slotIdx)
                              }
                              className={[
                                "flex h-full min-h-[2.25rem] w-full items-center justify-center rounded text-[11px] disabled:opacity-50",
                                afblokMode
                                  ? "border border-dashed border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2]"
                                  : "text-transparent hover:bg-[#F0FDF4] hover:text-green-dark",
                              ].join(" ")}
                              title={
                                afblokMode
                                  ? "Slot afblokken"
                                  : "Afspraak plannen"
                              }
                            >
                              {afblokMode ? "Blokkeer" : "+"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        </div>
        )}

        {(!isNarrow || mainView === "leads") && (
        <div
          className={[
            "min-h-0 shrink-0 overflow-auto",
            isNarrow ? "w-full" : "w-full min-w-full snap-start",
          ].join(" ")}
        >
          {leadsVoorDag.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <p className="font-display text-base font-semibold text-ink">
                {leadsIsToday
                  ? "Geen leads vandaag op de agenda"
                  : `Geen leads op ${leadsDayLabel}`}
              </p>
              <p className="mt-1 text-sm text-muted">
                {leadsIsToday
                  ? "Zodra er huisbezoeken of vervolgafspraken voor vandaag staan, zie je ze hier. Gebruik › of Morgen om vooruit te kijken."
                  : "Geen huisbezoeken of vervolgafspraken op deze dag. Blader met ‹ › of spring naar Vandaag."}
              </p>
            </div>
          ) : (
            <LeadsTable
              leads={leadsVoorDag}
              adviseurs={adviseurs}
              afspraken={afspraken}
              onStatusChange={onStatusChange}
              onBellerChange={onBellerChange}
              showBellerColumn={Boolean(onBellerChange)}
              showAfspraakTijdFirst
            />
          )}
        </div>
        )}
      </div>

      {/* Detail drawer — zelfde als oude agenda */}
      {selected && (
        <AfspraakDetail
          afspraak={selected}
          allAfspraken={afspraken}
          leadStatus={
            (selected.status === "voltooid" && selected.leads?.status
              ? selected.leads.status
              : null) ||
            leadStatusById.get(selected.lead_id) ||
            selected.leads?.status ||
            null
          }
          onClose={() => setSelected(null)}
          onUpdated={(a) => {
            setAfspraken((prev) => prev.map((x) => (x.id === a.id ? a : x)));
            setSelected(a);
            const st = a.leads?.status;
            if (st && a.lead_id && onStatusChange) {
              onStatusChange(a.lead_id, st as LeadStatus);
            }
          }}
          onRemoved={(id) => {
            setAfspraken((prev) => prev.filter((x) => x.id !== id));
            setSelected(null);
          }}
          onCreated={(a) => {
            setAfspraken((prev) => [...prev, a]);
          }}
        />
      )}

      {/* Plan modal */}
      {planOpen && planSlot && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <form
            onSubmit={(e) => void planAfspraak(e)}
            className="w-full max-w-md space-y-3 border border-line bg-white p-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <p className="font-display text-base font-semibold">
                Afspraak plannen
              </p>
              <button
                type="button"
                onClick={() => setPlanOpen(false)}
                className="text-sm text-muted"
              >
                Sluiten
              </button>
            </div>
            <p className="text-xs text-muted">
              {adviseurNaam.get(planSlot.adviseurId)}
              {planSlot.overBezet
                ? " · bezet blok — alleen tel / terugbel"
                : ""}
            </p>
            <LeadZoekVeld
              value={pickedLead}
              onChange={setPickedLead}
              suggestions={leads}
            />
            <label className="block text-xs font-semibold uppercase text-muted">
              Soort
              <select
                value={planSoort}
                onChange={(e) =>
                  setPlanSoort(normalizeAfspraakSoort(e.target.value))
                }
                className="mt-1 w-full border border-line px-3 py-2 text-sm"
              >
                {planSlot.overBezet ? (
                  <>
                    <option value="bel">Terugbelafspraak</option>
                    <option value="vervolg_tel">Vervolg telefonisch</option>
                  </>
                ) : (
                  <>
                    <option value="nieuw">Nieuw (huisbezoek)</option>
                    <option value="bel">Terugbelafspraak</option>
                    <option value="vervolg_fysiek">Vervolg op locatie</option>
                    <option value="vervolg_tel">Vervolg telefonisch</option>
                  </>
                )}
              </select>
            </label>
            {planSoort === "bel" || planSoort === "warme_bel" ? (
              <>
                <label className="block text-xs font-semibold uppercase text-muted">
                  Datum &amp; tijd (handmatig)
                  <input
                    type="datetime-local"
                    required
                    value={planStartLocal}
                    onChange={(e) => setPlanStartLocal(e.target.value)}
                    className="mt-1 w-full border border-line px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs font-semibold uppercase text-muted">
                  Notitie
                  <textarea
                    required
                    rows={3}
                    value={planNotitie}
                    onChange={(e) => setPlanNotitie(e.target.value)}
                    placeholder="Bijv. bel terug over offerte, bereikbaar na 17:00…"
                    className="mt-1 w-full border border-line px-3 py-2 text-sm"
                  />
                </label>
                <p className="text-[11px] text-muted">
                  Geen klantmail. Terugbel verschijnt in Bellen vanaf de
                  geplande dag (niet als huisbezoek-sticker).
                </p>
              </>
            ) : (
              <>
                <p className="text-xs text-muted">
                  {formatInTimeZone(
                    new Date(planSlot.startAt),
                    AMSTERDAM_TZ,
                    "EEE d MMM HH:mm",
                    { locale: nl }
                  )}
                </p>
                <ReistijdHint
                  adviseurId={planSlot.adviseurId}
                  startAt={planSlot.startAt}
                  lead={pickedLead}
                  afspraken={afspraken}
                  allLeads={leads}
                  startAdres={
                    adviseurs.find((a) => a.id === planSlot.adviseurId)
                      ?.start_adres || null
                  }
                  startAdresLabel={
                    adviseurNaam.get(planSlot.adviseurId) || "Startadres"
                  }
                />
              </>
            )}
            <button
              type="submit"
              disabled={
                saving ||
                !pickedLead ||
                ((planSoort === "bel" || planSoort === "warme_bel") &&
                  (!planStartLocal || !planNotitie.trim()))
              }
              className="w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
            >
              {saving
                ? "Bezig…"
                : planSoort === "bel" || planSoort === "warme_bel"
                  ? "Terugbel opslaan"
                  : "Plannen"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
