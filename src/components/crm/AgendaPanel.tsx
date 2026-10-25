"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  addDays,
  addWeeks,
  format,
  startOfWeek,
} from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type {
  Adviseur,
  AdviseurBeschikbaarheid,
  Afspraak,
  AfspraakSoort,
  Lead,
  LeadStatus,
  Offerte,
} from "@/types/database";
import {
  AMSTERDAM_TZ,
  adresRegel,
  formatDateTimeLongNl,
  formatDateTimeNl,
  formatTimeNl,
} from "@/lib/format";
import { StatusBadge } from "./StatusBadge";
import { isAdminAdviseur } from "@/lib/admin-adviseur";
import {
  afspraakBlokkeertAgenda,
  afspraakSoortLabel,
  afspraakStuurtMail,
  afspraakZichtbaarInAgenda,
  isSaleUitkomst,
  isWarmtefondsAanvraagSoort,
  needsVervolgPunt,
  normalizeAfspraakSoort,
  soortVoorVervolgUitkomst,
  uitkomstVereistVervolgPunt,
} from "@/lib/afspraak-soort";
import {
  AFSPRAAK_UITKOMSTEN,
  afspraakAgendaAccent,
  leadStatusLabel,
  statusTone,
} from "@/lib/labels";
import {
  aanbetalingVanOrder,
  EIGEN_MIDDELEN_AANBETALING_MODUS,
  normalizeAanbetalingModus,
  parseEuroInput,
} from "@/lib/aanbetaling";
import {
  agendaWeekJumpOptions,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import { getSupabaseBrowser } from "@/lib/supabase";
import { LeadZoekVeld } from "./LeadZoekVeld";
import { ReistijdHint } from "./ReistijdHint";
import {
  BestSlotsOptionsList,
  bestSlotsHelpText,
  useBestSlots,
  type BestSlotOption,
} from "./BestSlotsOptions";
import {
  BackofficeActieForm,
  type BackofficeActieFormValues,
} from "./BackofficeActieForm";
import { planSaleOpbel } from "@/lib/sale-opbel";

type AgendaDay = { key: string; date: Date };

/** Dag-key van een echte UTC-instant (afspraak) in Amsterdam */
function dayKeyAmsterdam(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

/**
 * Weekdagen ma–zo als "wall clock" dates (via toZonedTime).
 * Labels/keys met date-fns format — niet opnieuw via formatInTimeZone.
 */
function weekDaysFrom(anchor: Date): AgendaDay[] {
  const local = toZonedTime(anchor, AMSTERDAM_TZ);
  const monday = startOfWeek(local, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { key: format(date, "yyyy-MM-dd"), date };
  });
}

function formatDayLabel(day: Date): string {
  return format(day, "EEEE", { locale: nl });
}

function formatDayShort(day: Date): string {
  return format(day, "EEE", { locale: nl });
}

function formatDayNum(day: Date): string {
  return format(day, "d");
}

function formatMonthYear(day: Date): string {
  return format(day, "MMMM yyyy", { locale: nl });
}

function formatWeekRange(days: AgendaDay[]): string {
  const a = format(days[0].date, "d MMM", { locale: nl });
  const b = format(days[6].date, "d MMM yyyy", { locale: nl });
  return `${a} – ${b}`;
}

function PencilIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function jaNeeLabel(v: boolean | null | undefined): string | null {
  if (v === true) return "Ja";
  if (v === false) return "Nee";
  return null;
}

function PlanSoortPicker({
  step,
  onPick,
}: {
  step: "kies" | "vervolg";
  onPick: (v: AfspraakSoort | "vervolg" | null) => void;
}) {
  if (step === "vervolg") {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => onPick(null)}
          className="text-xs font-medium text-green hover:underline"
        >
          ← Terug
        </button>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Vervolg
        </p>
        <button
          type="button"
          onClick={() => onPick("vervolg_fysiek")}
          className="w-full border border-line bg-white px-3 py-3 text-left hover:border-green/50"
        >
          <span className="block text-sm font-semibold text-ink">
            Vervolg fysiek
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            Blokkeert het slot — planning kan er niet overheen
          </span>
        </button>
        <button
          type="button"
          onClick={() => onPick("vervolg_tel")}
          className="w-full border border-line bg-white px-3 py-3 text-left hover:border-green/50"
        >
          <span className="block text-sm font-semibold text-ink">
            Vervolg telefonisch
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            Geen mail — planning mag er een afspraak overheen zetten
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => onPick("nieuw")}
        className="w-full border border-line bg-white px-3 py-3 text-left hover:border-green/50"
      >
        <span className="block text-sm font-semibold text-ink">
          Afspraak nieuw
        </span>
        <span className="mt-0.5 block text-xs text-muted">
          Huisbezoek, bevestigingsmail, blokkeert het slot
        </span>
      </button>
      <button
        type="button"
        onClick={() => onPick("bel")}
        className="w-full border border-line bg-white px-3 py-3 text-left hover:border-green/50"
      >
        <span className="block text-sm font-semibold text-ink">
          Belafspraak
        </span>
        <span className="mt-0.5 block text-xs text-muted">
          Geen mail nodig — planning mag eroverheen boeken
        </span>
      </button>
      <button
        type="button"
        onClick={() => onPick("warmtefonds_aanvraag")}
        className="w-full border border-line bg-white px-3 py-3 text-left hover:border-green/50"
      >
        <span className="block text-sm font-semibold text-ink">
          Warmtefonds aanvraag
        </span>
        <span className="mt-0.5 block text-xs text-muted">
          Geen klantmail — status wordt Warmtefonds afspraak ingepland
        </span>
      </button>
      <button
        type="button"
        onClick={() => onPick("vervolg")}
        className="w-full border border-line bg-white px-3 py-3 text-left hover:border-green/50"
      >
        <span className="block text-sm font-semibold text-ink">Vervolg</span>
        <span className="mt-0.5 block text-xs text-muted">
          Fysiek of telefonisch
        </span>
      </button>
    </div>
  );
}

function JaNeeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
        <span className="ml-1 font-normal normal-case tracking-normal text-[#C45A12]">
          *
        </span>
      </legend>
      <div className="flex gap-2">
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            className={[
              "min-h-11 flex-1 border px-3 py-2.5 text-sm font-semibold sm:min-h-0 sm:py-2",
              value === v
                ? "border-green bg-green-soft text-green-dark"
                : "border-line bg-white text-ink hover:border-green/50",
            ].join(" ")}
          >
            {v ? "Ja" : "Nee"}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function mapsQueryFromLead(lead: Afspraak["leads"]): string | null {
  if (!lead) return null;
  const line = adresRegel(lead);
  if (!line || line === "—") return null;
  return line;
}

function googleMapsUrl(query: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

function wazeUrl(query: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`;
}

function AfspraakChip({
  afspraak,
  allAfspraken,
  leadStatus,
  variant = "week",
  onOpen,
}: {
  afspraak: Afspraak;
  allAfspraken: Afspraak[];
  /** Lead-afboekcode (uitkomst); fallback via afspraak.leads?.status */
  leadStatus?: string | null;
  variant?: "week" | "day";
  onOpen: (a: Afspraak) => void;
}) {
  const cancelled = afspraak.status === "geannuleerd";
  const struck = cancelled;
  const done = afspraak.status === "voltooid";
  const needsAction = needsVervolgPunt(afspraak, allAfspraken);
  const afboek =
    leadStatus ||
    (typeof afspraak.leads === "object" && afspraak.leads && "status" in afspraak.leads
      ? (afspraak.leads as { status?: string | null }).status
      : null) ||
    null;
  const accent = afspraakAgendaAccent(
    afspraak.status,
    normalizeAfspraakSoort(afspraak.soort),
    afboek
  );
  const naam = afspraak.leads?.naam || "—";
  const soortLabel =
    afspraakSoortLabel[normalizeAfspraakSoort(afspraak.soort)];
  const afboekLabel =
    done && afboek && leadStatusLabel[afboek as LeadStatus]
      ? leadStatusLabel[afboek as LeadStatus]
      : null;
  const statusNote = cancelled
    ? "Afgezegd"
    : afboekLabel
      ? afboekLabel
      : done
        ? "Voltooid"
        : null;

  if (variant === "day") {
    return (
      <button
        type="button"
        onClick={() => onOpen(afspraak)}
        className={[
          "flex w-full items-stretch gap-0 overflow-hidden rounded-xl border border-line text-left transition",
          accent.bg,
          "hover:brightness-[0.98] hover:shadow-[0_4px_16px_rgba(13,92,50,0.08)]",
          "active:scale-[0.99]",
          needsAction ? "ring-1 ring-[#C45A12]/40" : "",
        ].join(" ")}
      >
        <span className={["w-1.5 shrink-0", accent.bar].join(" ")} />
        <span className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3">
          <span className="shrink-0">
            <span
              className={[
                "block font-display text-lg font-semibold tabular-nums leading-none",
                accent.time,
                struck ? "line-through" : "",
              ].join(" ")}
            >
              {formatTimeNl(afspraak.start_at)}
            </span>
            <span
              className={[
                "mt-1 block text-[11px] tabular-nums text-muted",
                struck ? "line-through" : "",
              ].join(" ")}
            >
              {formatTimeNl(afspraak.end_at)}
            </span>
          </span>
          <span className="min-w-0 flex-1 border-l border-line/80 pl-3">
            <span className="flex items-center gap-2">
              <span
                className={[
                  "block truncate text-sm font-semibold text-ink",
                  struck ? "line-through" : "",
                ].join(" ")}
              >
                {naam}
              </span>
              {needsAction && (
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#C45A12] text-[11px] font-bold leading-none text-white"
                  title="Vervolg punt nodig"
                >
                  I
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted">
              {[
                statusNote,
                soortLabel,
                afspraak.adviseurs?.naam || null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <StatusBadge kind="afspraak" value={afspraak.status} />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(afspraak)}
      title={[
        needsAction ? "Vervolg punt nodig" : null,
        statusNote,
        formatTimeNl(afspraak.start_at),
        naam,
        soortLabel,
      ]
        .filter(Boolean)
        .join(" · ")}
      className={[
        "group relative flex w-full items-stretch overflow-hidden rounded-lg border border-line/70 text-left transition",
        accent.bg,
        "hover:brightness-[0.98] hover:shadow-sm",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-green",
        needsAction ? "ring-1 ring-[#C45A12]/35" : "",
      ].join(" ")}
    >
      <span className={["w-1 shrink-0", accent.bar].join(" ")} aria-hidden />
      <span className="min-w-0 flex-1 px-2 py-1.5">
        {needsAction && (
          <span
            className="absolute right-1 top-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#C45A12] text-[11px] font-bold leading-none text-white shadow-sm"
            aria-label="Vervolg punt nodig"
          >
            I
          </span>
        )}
        <span
          className={[
            "block text-[11px] font-bold tabular-nums leading-none",
            accent.time,
            struck ? "line-through" : "",
          ].join(" ")}
        >
          {formatTimeNl(afspraak.start_at)}
        </span>
        <span
          className={[
            "mt-1 block truncate pr-4 text-[12px] font-semibold leading-tight text-ink",
            struck ? "line-through" : "",
          ].join(" ")}
        >
          {naam}
        </span>
        <span className="mt-0.5 block truncate text-[10px] font-medium text-muted">
          {[
            statusNote,
            soortLabel,
            afspraak.adviseurs?.naam || null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    </button>
  );
}

function Icon({
  children,
  className = "h-6 w-6",
  strokeWidth = "2",
}: {
  children: ReactNode;
  className?: string;
  strokeWidth?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function FooterAction({
  label,
  icon,
  href,
  onClick,
  disabled,
  tone = "ink",
}: {
  label: string;
  icon: ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "ink" | "green" | "warn" | "danger" | "muted";
}) {
  const tones = {
    ink: "text-ink hover:bg-wash",
    green: "text-green-dark hover:bg-green-soft",
    warn: "text-[#C45A12] hover:bg-[#FFF0E6]",
    danger: "text-[#8B1E1E] hover:bg-[#FDECEC]",
    muted: "text-muted hover:bg-wash",
  };
  const className = [
    "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2.5",
    "text-[11px] font-semibold leading-tight",
    "disabled:opacity-40",
    tones[tone],
  ].join(" ");

  const inner = (
    <>
      {icon}
      <span className="text-center">{label}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      {inner}
    </button>
  );
}

export function AfspraakDetail({
  afspraak,
  allAfspraken,
  onClose,
  onUpdated,
  onRemoved,
  onCreated,
}: {
  afspraak: Afspraak;
  allAfspraken: Afspraak[];
  onClose: () => void;
  onUpdated: (a: Afspraak) => void;
  onRemoved: (id: string) => void;
  onCreated: (a: Afspraak) => void;
}) {
  const [current, setCurrent] = useState(afspraak);
  const [mode, setMode] = useState<
    "view" | "verzet" | "annuleer" | "adviseur"
  >("view");
  const [slots, setSlots] = useState<{ start_at: string; end_at: string }[]>(
    []
  );
  const [newStart, setNewStart] = useState("");
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [selectedBestSlotId, setSelectedBestSlotId] = useState<string | null>(
    null
  );
  const [showHandmatigVerzet, setShowHandmatigVerzet] = useState(false);
  const [voicePendingFiles, setVoicePendingFiles] = useState<File[]>([]);
  const [voiceQueueMsg, setVoiceQueueMsg] = useState<string | null>(null);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const [voiceBgBusy, setVoiceBgBusy] = useState(false);
  const voiceFileRef = useRef<HTMLInputElement | null>(null);
  const voicePendingRef = useRef<File[]>([]);
  const [mailKlant, setMailKlant] = useState<boolean | null>(null);
  const [annuleerNotitie, setAnnuleerNotitie] = useState("");
  const [vervolgAt, setVervolgAt] = useState("");
  const [vervolgNotitie, setVervolgNotitie] = useState("");
  const [uitkomst, setUitkomst] = useState<LeadStatus | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [adviseurKeuze, setAdviseurKeuze] = useState("");
  const [adviseurOpties, setAdviseurOpties] = useState<Adviseur[]>([]);
  const [adviseurOptiesLoading, setAdviseurOptiesLoading] = useState(false);
  const [saleOfferte, setSaleOfferte] = useState<Offerte | null>(null);
  const [saleOfferteLoading, setSaleOfferteLoading] = useState(false);
  const [sessionNaam, setSessionNaam] = useState<string | null>(null);
  const [sessionAdviseurId, setSessionAdviseurId] = useState<string | null>(
    null
  );
  const [boValues, setBoValues] = useState<BackofficeActieFormValues>({
    aanbetalingModus: "restant",
    aanbetalingHandmatig: "",
    backofficeNotitie: "",
    installateurNotitie: "",
    opbelMoment: null,
  });
  const [wfProjectId, setWfProjectId] = useState<string | null>(null);
  const [wfAangevraagdAt, setWfAangevraagdAt] = useState<string | null>(null);
  const [wfBusy, setWfBusy] = useState(false);
  const [editingNotitie, setEditingNotitie] = useState(false);
  const [notitieDraft, setNotitieDraft] = useState("");
  const [notitieSaving, setNotitieSaving] = useState(false);
  const [notitieSavedMsg, setNotitieSavedMsg] = useState<string | null>(null);
  const actionSectionRef = useRef<HTMLElement | null>(null);
  const saleFormRef = useRef<HTMLDivElement | null>(null);
  const notitieTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const afspraakNotitie = current.notities?.trim() || "";
  const leadFallbackNotitie =
    !afspraakNotitie && current.leads?.notities?.trim()
      ? current.leads.notities.trim()
      : null;
  const mailed = Boolean(current.bevestiging_verstuurd);
  const magKlantMail = afspraakStuurtMail(current.soort);
  const isWarmtefondsAfspraak = isWarmtefondsAanvraagSoort(current.soort);
  const lead = current.leads;
  const adres = mapsQueryFromLead(lead);
  const cancelled = current.status === "geannuleerd";
  const needsAction = needsVervolgPunt(
    current,
    allAfspraken,
    new Date(),
    current.leads?.status
  );
  const leadStatusNow = current.leads?.status || null;
  const dealNogAfboeken = leadStatusNow === "deal" && needsAction;
  const actionBadgeLabel = dealNogAfboeken
    ? "Uitkomst nodig"
    : "Vervolg punt nodig";
  const actionIntro = dealNogAfboeken
    ? "Offerte is getekend (deal). Kies sale met financiering of eigen middelen om de afspraak af te boeken."
    : isSaleUitkomst(uitkomst)
      ? "Sale geselecteerd — vul hieronder de backoffice in en rond de actie af."
      : "Fysieke afspraak is klaar. Kies of het een sale/deal is of niet. Bij een vervolg plan je hieronder ook het volgende moment; bij een eindstatus volstaat uitkomst + notitie.";
  const actionTitle = isSaleUitkomst(uitkomst)
    ? "Actie vereist"
    : dealNogAfboeken
      ? "Sale afronden"
      : "Uitkomst afspraak";
  const straatNr = lead
    ? [lead.straat, [lead.huisnummer, lead.toevoeging].filter(Boolean).join("")]
        .filter(Boolean)
        .join(" ")
    : "";
  const postcodePlaats = lead
    ? [lead.postcode, lead.plaats].filter(Boolean).join(" ")
    : "";

  useEffect(() => {
    setCurrent(afspraak);
    setMode("view");
    setError(null);
    setOkMsg(null);
    setAdviseurKeuze("");
    setNewStart("");
    setCustomStart("");
    setUseCustomTime(false);
    setSelectedBestSlotId(null);
    setShowHandmatigVerzet(false);
    setVoicePendingFiles([]);
    voicePendingRef.current = [];
    setVoiceQueueMsg(null);
    setVoiceErr(null);
    setVoiceBgBusy(false);
    setMailKlant(null);
    setAnnuleerNotitie("");
    setVervolgAt("");
    setVervolgNotitie("");
    setUitkomst("");
    setSaleOfferte(null);
    setWfProjectId(null);
    setWfAangevraagdAt(null);
    setEditingNotitie(false);
    setNotitieDraft(afspraak.notities?.trim() || "");
    setNotitieSavedMsg(null);
    setBoValues({
      aanbetalingModus: "restant",
      aanbetalingHandmatig: "",
      backofficeNotitie: "",
      installateurNotitie: "",
    });
  }, [afspraak]);

  useEffect(() => {
    if (!editingNotitie) return;
    const el = notitieTextareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editingNotitie]);

  useEffect(() => {
    if (!isWarmtefondsAanvraagSoort(afspraak.soort) || !afspraak.lead_id) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projecten/${afspraak.lead_id}`);
        const data = await res.json().catch(() => ({}));
        const project = data.project as
          | {
              id: string;
              status?: string;
              warmtefonds_aangevraagd_at?: string | null;
            }
          | undefined;
        if (cancelled || !project?.id) return;
        setWfProjectId(project.id);
        setWfAangevraagdAt(project.warmtefonds_aangevraagd_at || null);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [afspraak.id, afspraak.lead_id, afspraak.soort]);

  useEffect(() => {
    if (!needsAction || mode !== "view") return;
    window.requestAnimationFrame(() => {
      actionSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  }, [needsAction, mode, current.id]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/auth/login");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          if (data.adviseur?.naam) {
            setSessionNaam(data.adviseur.naam as string);
          }
          if (data.adviseur?.id) {
            setSessionAdviseurId(data.adviseur.id as string);
          }
        }
      } catch {
        /* ignore */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isSaleUitkomst(uitkomst) || !current.lead_id) {
      setSaleOfferte(null);
      setSaleOfferteLoading(false);
      return;
    }
    let cancelled = false;
    setSaleOfferteLoading(true);
    // Direct naar backoffice-blok scrollen zodra Sale gekozen is
    window.requestAnimationFrame(() => {
      saleFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
    queueMicrotask(async () => {
      try {
        const sb = getSupabaseBrowser();
        const { data } = await sb
          .from("offertes")
          .select(
            "*, leads(naam, adviseur_id, adviseurs!adviseur_id(id, naam))"
          )
          .eq("lead_id", current.lead_id)
          .eq("status", "ondertekend")
          .order("ondertekend_op", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (!data) {
          setSaleOfferte(null);
          return;
        }
        const o = data as Offerte;
        setSaleOfferte(o);
        setBoValues({
          aanbetalingModus: normalizeAanbetalingModus(o.aanbetaling_modus),
          aanbetalingHandmatig:
            o.aanbetaling_bedrag_inc != null
              ? String(o.aanbetaling_bedrag_inc)
              : "",
          backofficeNotitie: o.backoffice_notitie || "",
          installateurNotitie: o.installateur_notitie || "",
        });
        window.requestAnimationFrame(() => {
          saleFormRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        });
      } catch {
        if (!cancelled) setSaleOfferte(null);
      } finally {
        if (!cancelled) setSaleOfferteLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [uitkomst, current.lead_id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    if (!current.adviseur_id) return;
    let cancelledReq = false;
    queueMicrotask(async () => {
      const res = await fetch(
        `/api/adviseurs?adviseur_id=${current.adviseur_id}`
      );
      const data = await res.json();
      if (!cancelledReq) setSlots(data.slots || []);
    });
    return () => {
      cancelledReq = true;
    };
  }, [current.adviseur_id]);

  /** Lead-shape voor best-slots (reistijd) — id zit op afspraak.lead_id. */
  const verzetLead = useMemo(() => {
    if (!current.lead_id || !current.leads) return null;
    return {
      id: current.lead_id,
      straat: current.leads.straat ?? null,
      huisnummer: current.leads.huisnummer ?? null,
      toevoeging: current.leads.toevoeging ?? null,
      postcode: current.leads.postcode ?? null,
      plaats: current.leads.plaats ?? null,
    };
  }, [current.lead_id, current.leads]);

  const {
    bestSlots,
    bestSlotsLoading,
    bestSlotsLoadingMore,
    bestSlotsError,
    bestSlotsMode,
    bestSlotsLimit,
    loadMeerBestSlots,
  } = useBestSlots({
    lead: verzetLead,
    lockAdviseur: true,
    defaultAdviseurId: current.adviseur_id,
    enabled: mode === "verzet" && Boolean(verzetLead?.id && current.adviseur_id),
  });

  /** Huidige slot eruit — je kunt niet naar hetzelfde moment verzetten. */
  const verzetBestSlots = useMemo(
    () =>
      bestSlots.filter(
        (s) =>
          s.start_at !== current.start_at &&
          (!current.adviseur_id || s.adviseur_id === current.adviseur_id)
      ),
    [bestSlots, current.start_at, current.adviseur_id]
  );

  function selectVerzetBestSlot(slot: BestSlotOption) {
    setSelectedBestSlotId(slot.slot_id);
    setNewStart(slot.start_at);
    setUseCustomTime(false);
    setCustomStart("");
    setError(null);
  }

  const magVoiceUpload =
    !cancelled &&
    mode === "view" &&
    afspraakBlokkeertAgenda(current.soort);

  function onVoiceFilesChosen(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (picked.length === 0) return;
    setVoiceErr(null);
    setVoiceQueueMsg(null);
    setVoicePendingFiles((prev) => {
      const next = [...prev, ...picked];
      voicePendingRef.current = next;
      return next;
    });
  }

  function removeVoicePending(index: number) {
    setVoicePendingFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      voicePendingRef.current = next;
      return next;
    });
  }

  function startVoiceUploadsBackground(afspraakId: string, files: File[]) {
    if (files.length === 0) return;
    setVoiceBgBusy(true);
    setVoiceErr(null);
    setVoiceQueueMsg(
      files.length === 1
        ? "1 opname wordt op de achtergrond geüpload…"
        : `${files.length} opnames worden op de achtergrond geüpload…`
    );
    setVoicePendingFiles([]);
    voicePendingRef.current = [];
    void (async () => {
      try {
        const { uploadAfspraakVoiceNotesBackground } = await import(
          "@/lib/voice-ai-upload-client"
        );
        const result = await uploadAfspraakVoiceNotesBackground(
          afspraakId,
          files
        );
        if (result.errors.length > 0) {
          setVoiceErr(result.errors.join(" · "));
        }
        if (result.queued > 0) {
          setVoiceQueueMsg(
            result.queued === 1
              ? "Opname staat klaar — transcriptie loopt op de achtergrond."
              : `${result.queued} opnames staan klaar — transcriptie loopt op de achtergrond.`
          );
        } else if (result.errors.length > 0) {
          setVoiceQueueMsg(null);
        }
      } catch (err) {
        setVoiceErr(err instanceof Error ? err.message : "Upload mislukt");
        setVoiceQueueMsg(null);
      } finally {
        setVoiceBgBusy(false);
      }
    })();
  }

  const voiceUploadPanel = magVoiceUpload ? (
    <div
      className={
        needsAction
          ? "rounded-xl border border-[#C45A12]/25 bg-white p-3"
          : "rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(13,92,50,0.04)]"
      }
    >
      <p
        className={
          needsAction
            ? "text-[10px] font-semibold uppercase tracking-[0.08em] text-[#C45A12]"
            : "text-[10px] font-semibold uppercase tracking-[0.08em] text-muted"
        }
      >
        Voice uploaden
      </p>
      <p className="mt-1 text-[11px] text-muted">mp3 · m4a · wav · webm</p>
      <input
        ref={voiceFileRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.m4a,.wav,.webm,.ogg,.flac"
        className="hidden"
        onChange={onVoiceFilesChosen}
      />
      <button
        type="button"
        disabled={voiceBgBusy}
        onClick={() => voiceFileRef.current?.click()}
        className="mt-3 min-h-11 w-full border border-orange bg-white px-4 py-2.5 text-sm font-semibold text-orange hover:bg-[#FFF8F3] disabled:opacity-60"
      >
        {voicePendingFiles.length > 0
          ? "Meer voices toevoegen"
          : "Voice toevoegen"}
      </button>
      {voicePendingFiles.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {voicePendingFiles.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="flex items-center justify-between gap-2 text-xs text-ink"
            >
              <span className="min-w-0 truncate font-medium">{f.name}</span>
              <button
                type="button"
                onClick={() => removeVoicePending(i)}
                className="shrink-0 text-muted hover:text-[#C45A12]"
              >
                Weg
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {needsAction && voicePendingFiles.length > 0 ? (
        <p className="mt-2 text-[11px] text-muted">
          Wordt meegeüpload bij Opslaan (op de achtergrond).
        </p>
      ) : null}
      {!needsAction && voicePendingFiles.length > 0 ? (
        <button
          type="button"
          disabled={voiceBgBusy}
          onClick={() =>
            startVoiceUploadsBackground(current.id, voicePendingRef.current)
          }
          className="mt-3 min-h-11 w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
        >
          {voiceBgBusy ? "Bezig…" : "Uploaden op achtergrond"}
        </button>
      ) : null}
      {voiceQueueMsg ? (
        <p className="mt-2 text-xs font-medium text-green-deeper">
          {voiceQueueMsg}
        </p>
      ) : null}
      {voiceErr ? (
        <p className="mt-2 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {voiceErr}
        </p>
      ) : null}
    </div>
  ) : null;

  function startEditNotitie() {
    setNotitieDraft(current.notities?.trim() || "");
    setNotitieSavedMsg(null);
    setError(null);
    setEditingNotitie(true);
  }

  async function saveNotitie(nextRaw: string) {
    const next = nextRaw.trim() || null;
    const prev = current.notities?.trim() || null;
    if (next === prev) {
      setEditingNotitie(false);
      return;
    }
    setNotitieSaving(true);
    setError(null);
    setNotitieSavedMsg(null);
    try {
      const res = await fetch("/api/afspraken", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          action: "update_notities",
          notities: next,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Notitie opslaan mislukt");
      const updated = (data.afspraak as Afspraak) || {
        ...current,
        notities: next,
      };
      setCurrent(updated);
      onUpdated(updated);
      setEditingNotitie(false);
      setNotitieSavedMsg("Opgeslagen");
      window.setTimeout(() => setNotitieSavedMsg(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Notitie opslaan mislukt");
    } finally {
      setNotitieSaving(false);
    }
  }

  useEffect(() => {
    if (mode !== "adviseur") return;
    let cancelled = false;
    setAdviseurOptiesLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/adviseurs", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const list = ((data.adviseurs as Adviseur[]) || [])
          .filter((a) => a.actief !== false)
          .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
        setAdviseurOpties(list);
        if (!adviseurKeuze) {
          const other = list.find((a) => a.id !== current.adviseur_id);
          if (other) setAdviseurKeuze(other.id);
        }
      } catch {
        if (!cancelled) setAdviseurOpties([]);
      } finally {
        if (!cancelled) setAdviseurOptiesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alleen laden bij openen adviseur-modus
  }, [mode, current.adviseur_id]);

  async function overzettenAdviseur() {
    if (!adviseurKeuze) {
      setError("Kies een adviseur");
      return;
    }
    if (adviseurKeuze === current.adviseur_id) {
      setError("Kies een andere adviseur dan de huidige");
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/afspraken", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          action: "overzetten_adviseur",
          adviseur_id: adviseurKeuze,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Overzetten mislukt"
        );
      }
      const next = (data.afspraak as Afspraak) || {
        ...current,
        adviseur_id: adviseurKeuze,
        adviseurs:
          adviseurOpties.find((a) => a.id === adviseurKeuze) ||
          current.adviseurs,
      };
      setCurrent(next);
      onUpdated(next);
      setMode("view");
      const naam =
        next.adviseurs?.naam ||
        adviseurOpties.find((a) => a.id === adviseurKeuze)?.naam ||
        "andere adviseur";
      setOkMsg(
        `Overgezet naar ${naam} — lead + agenda. Geen mail naar de klant.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Overzetten mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function verzet() {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      let resolvedStart = newStart;
      if (useCustomTime) {
        if (!customStart) throw new Error("Kies een tijdstip");
        const parsed = new Date(customStart);
        if (Number.isNaN(parsed.getTime())) throw new Error("Ongeldig tijdstip");
        resolvedStart = parsed.toISOString();
      }
      if (!resolvedStart) throw new Error("Kies een tijdslot");
      if (magKlantMail && mailKlant === null) {
        throw new Error("Kies of de klant een mail moet krijgen (ja/nee)");
      }

      const res = await fetch("/api/afspraken", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          action: "verzet",
          start_at: resolvedStart,
          mail_klant: magKlantMail ? mailKlant : false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verzetten mislukt");
      const next = (data.afspraak as Afspraak) || current;
      setCurrent(next);
      onUpdated(next);
      setMode("view");
      setMailKlant(null);
      setOkMsg(
        data.mail_sent
          ? "Afspraak verzet — klant heeft een nieuwe bevestiging ontvangen."
          : "Afspraak verzet — geen mail naar de klant."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  async function annuleer() {
    if (annuleerNotitie.trim().length < 3) {
      setError("Vul een notitie in bij annuleren");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/afspraken", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          action: "annuleer",
          notitie: annuleerNotitie.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Annuleren mislukt");
      const next = (data.afspraak as Afspraak) || {
        ...current,
        status: "geannuleerd" as const,
      };
      setCurrent(next);
      onUpdated(next);
      setMode("view");
      setMailKlant(null);
      setOkMsg(
        magKlantMail
          ? "Afspraak geannuleerd. Verstuur desgewenst de annuleringsmail via de knop."
          : "Afspraak geannuleerd."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  async function verstuurAnnuleringsmail() {
    if (current.status !== "geannuleerd" || !magKlantMail) return;
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/afspraken", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          action: "send_annuleringsmail",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Mailen mislukt");
      setOkMsg(
        data.to
          ? `Annuleringsmail verstuurd naar ${data.to}.`
          : "Annuleringsmail verstuurd."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  async function verwijderDefinitief() {
    if (
      !confirm(
        "Afspraak definitief uit de agenda verwijderen? Dit kan niet ongedaan worden. De klant krijgt geen mail."
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/afspraken", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          action: "verwijder_definitief",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      onRemoved(current.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  async function planVervolgPunt(e: { preventDefault: () => void }) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      if (!uitkomst) throw new Error("Kies een uitkomst");
      const isSale = isSaleUitkomst(uitkomst);
      const noteText = vervolgNotitie.trim();
      if (!isSale && !noteText) throw new Error("Vul een notitie in");
      if (!current.adviseur_id) throw new Error("Geen adviseur op deze afspraak");

      const needsVervolg = uitkomstVereistVervolgPunt(uitkomst);
      let parsed: Date | null = null;
      if (needsVervolg) {
        if (!vervolgAt) throw new Error("Kies datum en tijd voor het vervolg");
        parsed = new Date(vervolgAt);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error("Ongeldige datum/tijd");
        }
      }

      if (isSale) {
        if (!saleOfferte) {
          throw new Error(
            "Geen ondertekende offerte gevonden voor deze lead — rond eerst de offerte af."
          );
        }
        const warmtefonds = uitkomst === "sale_financiering";
        const preview = aanbetalingVanOrder({
          subtotaalExBtw: Number(saleOfferte.subtotaal_ex_btw) || 0,
          btwBedrag: Number(saleOfferte.btw_bedrag) || 0,
          totaalIncBtw: Number(saleOfferte.totaal_inc_btw) || 0,
          modus: warmtefonds
            ? boValues.aanbetalingModus
            : EIGEN_MIDDELEN_AANBETALING_MODUS,
          handmatigIncBtw: parseEuroInput(boValues.aanbetalingHandmatig),
          financieringVoorbehoud: warmtefonds,
        });
        const res = await fetch(`/api/offertes/${saleOfferte.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actie_required: false,
            financiering_voorbehoud: warmtefonds,
            aanbetaling_modus: warmtefonds
              ? boValues.aanbetalingModus
              : EIGEN_MIDDELEN_AANBETALING_MODUS,
            aanbetaling_bedrag_inc:
              warmtefonds && boValues.aanbetalingModus === "handmatig"
                ? parseEuroInput(boValues.aanbetalingHandmatig)
                : null,
            aanbetaling_te_innen_inc: preview.bedragIncBtw,
            backoffice_notitie: boValues.backofficeNotitie || null,
            installateur_notitie: boValues.installateurNotitie || null,
            backoffice_notitie_door: boValues.backofficeNotitie.trim()
              ? sessionNaam || saleOfferte.backoffice_notitie_door || null
              : null,
            installateur_notitie_door: boValues.installateurNotitie.trim()
              ? sessionNaam || saleOfferte.installateur_notitie_door || null
              : null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Backoffice-actie afronden mislukt");
        }
        if (boValues.opbelMoment) {
          const opbelErr = await planSaleOpbel({
            leadId: current.lead_id,
            moment: boValues.opbelMoment,
            sessionAdviseurId,
          });
          if (opbelErr) throw new Error(opbelErr);
        }
      }

      const sb = getSupabaseBrowser();
      const { error: statusErr } = await sb
        .from("leads")
        .update({ status: uitkomst })
        .eq("id", current.lead_id);
      if (statusErr) throw statusErr;

      // Afspraak echt afboeken (anders blijft oranje “I” / telt niet in dashboard)
      const { error: afspraakErr } = await sb
        .from("afspraken")
        .update({ status: "voltooid" })
        .eq("id", current.id);
      if (afspraakErr) throw afspraakErr;

      const { fireMetaCapiSync } = await import("@/lib/meta-capi-client");
      fireMetaCapiSync(current.lead_id);

      if (needsVervolg && parsed) {
        const res = await fetch("/api/afspraken", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lead_id: current.lead_id,
            adviseur_id: current.adviseur_id,
            start_at: parsed.toISOString(),
            notities: noteText,
            soort: soortVoorVervolgUitkomst(uitkomst),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Vervolg punt opslaan mislukt");
        }
        if (data.afspraak) onCreated(data.afspraak as Afspraak);
      } else if (!isSale) {
        // Eindstatus: notitie op lead bewaren
        const { data: leadRow } = await sb
          .from("leads")
          .select("notities")
          .eq("id", current.lead_id)
          .maybeSingle();
        const stamp = new Date().toLocaleString("nl-NL", {
          timeZone: "Europe/Amsterdam",
        });
        const line = `[${stamp}] Uitkomst afspraak: ${leadStatusLabel[uitkomst] || uitkomst} — ${noteText}`;
        const prev = (leadRow?.notities || "").trim();
        await sb
          .from("leads")
          .update({
            notities: prev ? `${prev}\n${line}` : line,
          })
          .eq("id", current.lead_id);
      }

      const next: Afspraak = {
        ...current,
        status: "voltooid",
        leads: current.leads
          ? { ...current.leads, status: uitkomst }
          : current.leads,
      };
      setCurrent(next);
      onUpdated(next);

      void fetch(`/api/leads/${current.lead_id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort: "status",
          titel: `Status → ${leadStatusLabel[uitkomst] || uitkomst}`,
          detail: isSale
            ? "Via actiepunten na afspraak + backoffice afgerond"
            : needsVervolg
              ? "Via actiepunten na afspraak + vervolg punt"
              : "Via actiepunten na afspraak (eindstatus)",
        }),
      }).catch(() => {});

      setVervolgAt("");
      setVervolgNotitie("");
      setUitkomst("");
      setSaleOfferte(null);
      const plannedOpbel = isSale ? boValues.opbelMoment : null;
      setBoValues((prev) => ({ ...prev, opbelMoment: null }));

      const pendingVoices = [...voicePendingRef.current];
      const baseOk = isSale
        ? plannedOpbel
          ? `Sale opgeslagen, backoffice afgerond, opbel gepland (${plannedOpbel}).`
          : `Sale opgeslagen en backoffice-actie afgerond.`
        : needsVervolg
          ? `Uitkomst “${leadStatusLabel[uitkomst] || uitkomst}” opgeslagen en vervolg punt gepland.`
          : uitkomst === "deur_niet_open"
            ? `Uitkomst “${leadStatusLabel[uitkomst] || uitkomst}” opgeslagen — backoffice plant opnieuw in.`
            : `Uitkomst “${leadStatusLabel[uitkomst] || uitkomst}” opgeslagen.`;
      if (pendingVoices.length > 0) {
        startVoiceUploadsBackground(current.id, pendingVoices);
        setOkMsg(
          `${baseOk} ${pendingVoices.length === 1 ? "Voice" : `${pendingVoices.length} voices`} uploaden op de achtergrond.`
        );
      } else {
        setOkMsg(baseOk);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  async function markWarmtefondsAangevraagd() {
    if (!wfProjectId || wfBusy) return;
    setWfBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const nowIso = new Date().toISOString();
      const res = await fetch(`/api/projecten/${wfProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          financiering_status: "aanvraag_gedaan",
          warmtefonds_aangevraagd_at: nowIso,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Status bijwerken mislukt");
      }

      const sb = getSupabaseBrowser();
      const { error: afspraakErr } = await sb
        .from("afspraken")
        .update({ status: "voltooid" })
        .eq("id", current.id);
      if (afspraakErr) throw afspraakErr;

      const next: Afspraak = { ...current, status: "voltooid" };
      setCurrent(next);
      onUpdated(next);

      setWfAangevraagdAt(
        (data.project as { warmtefonds_aangevraagd_at?: string } | undefined)
          ?.warmtefonds_aangevraagd_at || nowIso
      );
      setOkMsg(
        `Warmtefonds aangevraagd op ${new Date(nowIso).toLocaleString("nl-NL", {
          timeZone: "Europe/Amsterdam",
        })}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setWfBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="afspraak-detail-title"
      className="fixed inset-0 z-50 flex flex-col bg-wash"
    >
      <header className="shrink-0 border-b border-line bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {afspraakSoortLabel[normalizeAfspraakSoort(current.soort)]}
            </p>
            <h2
              id="afspraak-detail-title"
              className="mt-0.5 font-display text-xl font-semibold capitalize text-ink sm:text-2xl"
            >
              {formatDateTimeLongNl(current.start_at)}
            </h2>
            <p className="mt-1 text-sm tabular-nums text-muted">
              {formatTimeNl(current.start_at)} – {formatTimeNl(current.end_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-ink hover:bg-wash"
            aria-label="Sluiten"
          >
            <Icon className="h-11 w-11" strokeWidth="2.5">
              <path d="M6 6l12 12M18 6 6 18" />
            </Icon>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="afspraak" value={current.status} />
            {needsAction && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#C45A12] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px]">
                  i
                </span>
                {actionBadgeLabel}
              </span>
            )}
            {mailed && magKlantMail && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-soft px-2 py-0.5 text-[11px] font-semibold text-green-dark">
                Mail verstuurd
              </span>
            )}
          </div>

          {isWarmtefondsAfspraak && mode === "view" && (
            <section className="rounded-2xl border border-[#1A4A6E]/30 bg-[#E8F0F6] p-5 shadow-[0_1px_2px_rgba(26,74,110,0.06)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#1A4A6E]">
                Warmtefonds aanvraag
              </p>
              <p className="mt-1 text-sm text-muted">
                Geen klantmail. Zodra de aanvraag is ingediend, springt de
                projectstatus naar Warmtefonds aangevraagd (met datum).
              </p>
              {wfAangevraagdAt ? (
                <p className="mt-3 rounded-lg border border-[#0D5C32]/25 bg-[#E8F6EC] px-3 py-2 text-sm font-medium text-[#0D5C32]">
                  Warmtefonds aangevraagd op{" "}
                  {formatDateTimeNl(wfAangevraagdAt)}
                </p>
              ) : (
                <button
                  type="button"
                  disabled={wfBusy || !wfProjectId}
                  onClick={() => void markWarmtefondsAangevraagd()}
                  className="mt-4 min-h-11 w-full bg-[#1A4A6E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#143a57] disabled:opacity-60"
                >
                  {wfBusy
                    ? "Bezig…"
                    : !wfProjectId
                      ? "Geen project gevonden voor deze lead"
                      : "Warmtefonds aangevraagd"}
                </button>
              )}
            </section>
          )}

          {needsAction && mode === "view" && (
            <section
              ref={actionSectionRef}
              className="rounded-2xl border border-[#C45A12]/35 bg-[#FFF8F3] p-5 shadow-[0_1px_2px_rgba(196,90,18,0.06)]"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#C45A12]">
                {actionTitle}
              </p>
              <p className="mt-1 text-sm text-muted">{actionIntro}</p>

              <form
                onSubmit={(e) => void planVervolgPunt(e)}
                className="mt-4 space-y-3"
              >
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                  Uitkomst afspraak
                  <select
                    required
                    disabled={busy}
                    value={uitkomst}
                    onChange={(e) => {
                      const next = (e.target.value as LeadStatus) || "";
                      setUitkomst(next);
                      if (isSaleUitkomst(next)) {
                        window.requestAnimationFrame(() => {
                          saleFormRef.current?.scrollIntoView({
                            behavior: "smooth",
                            block: "nearest",
                          });
                        });
                      }
                    }}
                    className={`mt-1 w-full cursor-pointer border bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-green disabled:opacity-60 ${
                      uitkomst
                        ? statusTone("lead", uitkomst)
                        : "border-line text-ink"
                    }`}
                    aria-label="Uitkomst afspraak"
                  >
                    <option value="">Kies uitkomst…</option>
                    {(dealNogAfboeken
                      ? AFSPRAAK_UITKOMSTEN.filter((s) => isSaleUitkomst(s))
                      : AFSPRAAK_UITKOMSTEN
                    ).map((s) => (
                      <option key={s} value={s}>
                        {leadStatusLabel[s]}
                      </option>
                    ))}
                  </select>
                </label>

                {isSaleUitkomst(uitkomst) ? (
                  <div
                    ref={saleFormRef}
                    className="rounded-xl border-2 border-[#C45A12]/40 bg-white p-4 shadow-sm"
                  >
                  {saleOfferteLoading ? (
                    <p className="text-sm text-muted">Offerte laden…</p>
                  ) : !saleOfferte ? (
                    <p className="rounded-lg border border-[#C45A12]/30 bg-[#FFF8F3] px-3 py-3 text-sm text-[#C45A12]">
                      Geen ondertekende offerte voor deze lead. Rond eerst een
                      offerte af, daarna kun je de backoffice hier invullen.
                    </p>
                  ) : (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#C45A12]">
                        Backoffice invullen
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        Offerte {saleOfferte.offerte_nummer} · Betaalroute:{" "}
                        <span className="font-semibold text-ink">
                          {uitkomst === "sale_financiering"
                            ? "Warmtefonds"
                            : "Eigen middelen"}
                        </span>
                      </p>
                      <div className="mt-3">
                        <BackofficeActieForm
                          compact
                          subtotaalExBtw={
                            Number(saleOfferte.subtotaal_ex_btw) || 0
                          }
                          btwBedrag={Number(saleOfferte.btw_bedrag) || 0}
                          totaalIncBtw={Number(saleOfferte.totaal_inc_btw) || 0}
                          financieringVoorbehoud={
                            uitkomst === "sale_financiering"
                          }
                          adviseurNaam={(() => {
                            const l = Array.isArray(saleOfferte.leads)
                              ? saleOfferte.leads[0]
                              : saleOfferte.leads;
                            const adv = l?.adviseurs;
                            const naam = Array.isArray(adv)
                              ? adv[0]?.naam
                              : adv?.naam;
                            return naam || null;
                          })()}
                          sessionNaam={sessionNaam}
                          values={boValues}
                          onChange={(patch) =>
                            setBoValues((prev) => ({ ...prev, ...patch }))
                          }
                          disabled={busy}
                        />
                      </div>
                    </div>
                  )}
                  </div>
                ) : (
                  <>
                    {uitkomstVereistVervolgPunt(uitkomst) && (
                      <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                        Datum &amp; tijd
                        <input
                          type="datetime-local"
                          required
                          value={vervolgAt}
                          onChange={(e) => setVervolgAt(e.target.value)}
                          className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                        />
                      </label>
                    )}
                    <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                      Notitie
                      <textarea
                        required
                        rows={3}
                        value={vervolgNotitie}
                        onChange={(e) => setVervolgNotitie(e.target.value)}
                        placeholder={
                          uitkomstVereistVervolgPunt(uitkomst)
                            ? "Wat moet er gebeuren bij dit vervolg?"
                            : "Korte toelichting bij de uitkomst…"
                        }
                        className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                      />
                    </label>
                  </>
                )}
                {voiceUploadPanel}

                <button
                  type="submit"
                  disabled={
                    busy ||
                    !uitkomst ||
                    (isSaleUitkomst(uitkomst)
                      ? !saleOfferte || saleOfferteLoading
                      : !vervolgNotitie.trim() ||
                        (uitkomstVereistVervolgPunt(uitkomst) && !vervolgAt))
                  }
                  className="min-h-11 w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
                >
                  {busy
                    ? "Bezig…"
                    : isSaleUitkomst(uitkomst)
                      ? "Actie afronden"
                      : "Opslaan"}
                </button>
              </form>
            </section>
          )}

          {magVoiceUpload && !needsAction ? voiceUploadPanel : null}

          <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(13,92,50,0.04)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Klant
            </p>
            <p className="mt-1 text-lg font-semibold text-ink">
              {lead?.naam || "—"}
            </p>
            <p className="font-mono text-xs text-muted">
              {lead?.lead_number || "—"}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {lead?.telefoon && (
                <a href={`tel:${lead.telefoon}`} className="hover:text-green">
                  {lead.telefoon}
                </a>
              )}
              {lead?.email && (
                <a
                  href={`mailto:${lead.email}`}
                  className="truncate hover:text-green"
                >
                  {lead.email}
                </a>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(13,92,50,0.04)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Adres
            </p>
            {adres ? (
              <>
                <p className="mt-1 text-base font-semibold text-ink">
                  {straatNr || adres}
                </p>
                {postcodePlaats && (
                  <p className="mt-0.5 text-sm text-muted">{postcodePlaats}</p>
                )}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <a
                    href={wazeUrl(adres)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#33CCFF] px-4 py-3 text-sm font-bold text-[#0A2A3A] hover:brightness-95"
                  >
                    <Icon className="h-5 w-5" strokeWidth="2.2">
                      <circle cx="12" cy="12" r="9" />
                      <circle cx="9" cy="14" r="0.8" />
                      <circle cx="15" cy="14" r="0.8" />
                      <path d="M8.5 10.5c.9-1.2 2.1-1.8 3.5-1.8s2.6.6 3.5 1.8" />
                    </Icon>
                    <span>Navigeer met Waze</span>
                  </a>
                  <a
                    href={googleMapsUrl(adres)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green px-4 py-3 text-sm font-bold text-white hover:bg-green-dark"
                  >
                    <Icon className="h-5 w-5" strokeWidth="2.2">
                      <path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z" />
                      <circle cx="12" cy="10" r="2.2" />
                    </Icon>
                    <span>Navigeer met Google Maps</span>
                  </a>
                </div>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">Geen adres bekend</p>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(13,92,50,0.04)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Adviseur
            </p>
            <p className="mt-1 text-sm font-medium text-ink">
              {current.adviseurs?.naam || "—"}
            </p>
          </section>

          {(jaNeeLabel(current.partner_aanwezig) ||
            jaNeeLabel(current.andere_offertes_gehad)) && (
            <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(13,92,50,0.04)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Checks
              </p>
              <dl className="mt-3 space-y-2 text-sm">
                {jaNeeLabel(current.partner_aanwezig) && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted">Partner aanwezig</dt>
                    <dd className="font-semibold text-ink">
                      {jaNeeLabel(current.partner_aanwezig)}
                    </dd>
                  </div>
                )}
                {jaNeeLabel(current.andere_offertes_gehad) && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted">Andere offertes gehad</dt>
                    <dd className="font-semibold text-ink">
                      {jaNeeLabel(current.andere_offertes_gehad)}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(13,92,50,0.04)]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Notitie
              </p>
              <div className="flex items-center gap-2">
                {notitieSaving ? (
                  <span className="text-[10px] font-semibold text-muted">
                    Opslaan…
                  </span>
                ) : notitieSavedMsg ? (
                  <span className="text-[10px] font-semibold text-green-dark">
                    {notitieSavedMsg}
                  </span>
                ) : null}
                {!editingNotitie ? (
                  <button
                    type="button"
                    onClick={startEditNotitie}
                    className="inline-flex h-7 w-7 items-center justify-center text-muted transition hover:bg-wash hover:text-ink"
                    title={
                      afspraakNotitie
                        ? "Notitie bewerken"
                        : "Notitie toevoegen"
                    }
                    aria-label={
                      afspraakNotitie
                        ? "Notitie bewerken"
                        : "Notitie toevoegen"
                    }
                  >
                    <PencilIcon />
                  </button>
                ) : null}
              </div>
            </div>
            {editingNotitie ? (
              <textarea
                ref={notitieTextareaRef}
                value={notitieDraft}
                onChange={(e) => setNotitieDraft(e.target.value)}
                onBlur={() => {
                  void saveNotitie(notitieDraft);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingNotitie(false);
                    setNotitieDraft(current.notities?.trim() || "");
                  }
                }}
                disabled={notitieSaving}
                rows={4}
                placeholder="Notitie bij deze afspraak…"
                className="mt-2 w-full resize-y rounded-xl border border-line bg-wash px-3.5 py-3 text-sm leading-relaxed text-ink outline-none focus:border-green focus:bg-white disabled:opacity-60"
              />
            ) : afspraakNotitie ? (
              <p className="mt-2 whitespace-pre-wrap rounded-xl bg-wash px-3.5 py-3 text-sm leading-relaxed text-ink">
                {afspraakNotitie}
              </p>
            ) : leadFallbackNotitie ? (
              <div className="mt-2 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Leadnotitie (nog geen afspraaknotitie)
                </p>
                <p className="whitespace-pre-wrap rounded-xl bg-wash px-3.5 py-3 text-sm leading-relaxed text-ink">
                  {leadFallbackNotitie}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">
                Geen notitie — klik het potloodje om er een toe te voegen.
              </p>
            )}
          </section>

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

          {!cancelled && mode === "adviseur" && (
            <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(13,92,50,0.04)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Adviseur wijzigen
              </p>
              <p className="mt-1 text-sm text-muted">
                Intern overzetten: lead + afspraak gaan naar de gekozen
                adviseur. Mag over bestaande afspraken heen. Geen mail naar de
                klant.
              </p>
              <p className="mt-3 text-xs text-muted">
                Nu:{" "}
                <span className="font-semibold text-ink">
                  {current.adviseurs?.naam || "—"}
                </span>
              </p>
              <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                Nieuwe adviseur
                <select
                  value={adviseurKeuze}
                  onChange={(e) => setAdviseurKeuze(e.target.value)}
                  disabled={busy || adviseurOptiesLoading}
                  className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-green disabled:opacity-60"
                >
                  <option value="">
                    {adviseurOptiesLoading ? "Laden…" : "Kies adviseur…"}
                  </option>
                  {adviseurOpties.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.naam}
                      {a.id === current.adviseur_id ? " (huidig)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={
                    busy ||
                    !adviseurKeuze ||
                    adviseurKeuze === current.adviseur_id
                  }
                  onClick={() => void overzettenAdviseur()}
                  className="min-h-11 bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
                >
                  {busy ? "Bezig…" : "Overzetten"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMode("view");
                    setError(null);
                  }}
                  className="min-h-11 border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-wash"
                >
                  Terug
                </button>
              </div>
            </section>
          )}

          {!cancelled && mode === "verzet" && (
            <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(13,92,50,0.04)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Afspraak verzetten
              </p>
              <p className="mt-1 text-sm text-muted">
                {magKlantMail
                  ? "Slimme slots op reistijd in de agenda van de adviseur. De herinnering van 24 uur schuift mee."
                  : "Slimme slots op reistijd in de agenda van de adviseur. De klant krijgt hier geen mail van."}
              </p>
              <p className="mt-1 text-xs text-muted">
                {bestSlotsHelpText({ lockAdviseur: true, limit: bestSlotsLimit })}
              </p>

              <div className="mt-4 space-y-3">
                <BestSlotsOptionsList
                  slots={verzetBestSlots}
                  selectedSlotId={selectedBestSlotId}
                  onSelect={selectVerzetBestSlot}
                  loading={bestSlotsLoading}
                  error={bestSlotsError}
                  mode={bestSlotsMode}
                  limit={bestSlotsLimit}
                  loadingMore={bestSlotsLoadingMore}
                  onLoadMore={() => void loadMeerBestSlots()}
                  lockAdviseur
                />

                <button
                  type="button"
                  onClick={() => {
                    setShowHandmatigVerzet((v) => !v);
                    if (showHandmatigVerzet) {
                      setUseCustomTime(false);
                      setCustomStart("");
                    } else {
                      setSelectedBestSlotId(null);
                    }
                  }}
                  className="text-xs font-medium text-green hover:underline"
                >
                  {showHandmatigVerzet
                    ? "Handmatig verbergen"
                    : "Handmatig tijdstip…"}
                </button>

                {showHandmatigVerzet ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Nieuw tijdstip
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setUseCustomTime((v) => !v);
                          setNewStart("");
                          setCustomStart("");
                          setSelectedBestSlotId(null);
                        }}
                        className="text-xs font-medium text-green hover:underline"
                      >
                        {useCustomTime ? "Kies vast slot" : "Ander tijdstip…"}
                      </button>
                    </div>
                    {useCustomTime ? (
                      <input
                        type="datetime-local"
                        value={customStart}
                        onChange={(e) => {
                          setCustomStart(e.target.value);
                          setSelectedBestSlotId(null);
                        }}
                        className="w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
                      />
                    ) : (
                      <select
                        value={newStart}
                        onChange={(e) => {
                          setNewStart(e.target.value);
                          setSelectedBestSlotId(null);
                        }}
                        className="w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
                      >
                        <option value="">Kies tijd…</option>
                        {slots
                          .filter((s) => s.start_at !== current.start_at)
                          .slice(0, 80)
                          .map((s) => (
                            <option key={s.start_at} value={s.start_at}>
                              {formatDateTimeNl(s.start_at)}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                ) : null}

                {!useCustomTime && newStart ? (
                  <ReistijdHint
                    adviseurId={current.adviseur_id || ""}
                    startAt={newStart}
                    lead={verzetLead}
                    afspraken={allAfspraken.filter((a) => a.id !== current.id)}
                    startAdres={null}
                    startAdresLabel={current.adviseurs?.naam || null}
                  />
                ) : null}
              </div>

              {magKlantMail && (
                <div className="mt-4">
                  <JaNeeField
                    label="Klant mailen over deze wijziging?"
                    value={mailKlant}
                    onChange={setMailKlant}
                  />
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void verzet()}
                  className="min-h-11 bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
                >
                  {busy ? "Bezig…" : "Opslaan"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMode("view");
                    setMailKlant(null);
                    setSelectedBestSlotId(null);
                    setShowHandmatigVerzet(false);
                    setError(null);
                  }}
                  className="min-h-11 border border-line px-4 py-2.5 text-sm font-semibold text-muted hover:bg-wash"
                >
                  Terug
                </button>
              </div>
            </section>
          )}

          {!cancelled && mode === "annuleer" && (
            <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(13,92,50,0.04)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Afspraak annuleren
              </p>
              <p className="mt-1 text-sm text-muted">
                De afspraak blijft zichtbaar in de agenda (met streep). Een
                notitie is verplicht. De klant krijgt niet automatisch een
                mail — die kun je daarna apart versturen.
              </p>
              <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted">
                Notitie / reden
                <textarea
                  value={annuleerNotitie}
                  onChange={(e) => setAnnuleerNotitie(e.target.value)}
                  rows={3}
                  required
                  placeholder="Waarom wordt deze afspraak geannuleerd?"
                  className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
                />
              </label>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void annuleer()}
                  className="min-h-11 bg-[#C45A12] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#a84c0f] disabled:opacity-60"
                >
                  {busy ? "Bezig…" : "Annuleren"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMode("view");
                    setMailKlant(null);
                    setAnnuleerNotitie("");
                    setError(null);
                  }}
                  className="min-h-11 border border-line px-4 py-2.5 text-sm font-semibold text-muted hover:bg-wash"
                >
                  Terug
                </button>
              </div>
            </section>
          )}

          {cancelled && magKlantMail ? (
            <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(13,92,50,0.04)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Annuleringsmail
              </p>
              <p className="mt-1 text-sm text-muted">
                Status is geannuleerd — verstuur desgewenst de bevestiging naar
                de klant.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void verstuurAnnuleringsmail()}
                className="mt-3 min-h-11 bg-[#C45A12] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#a84c0f] disabled:opacity-60"
              >
                {busy ? "Bezig…" : "Verstuur annuleringsmail"}
              </button>
            </section>
          ) : null}
        </div>
      </div>

      <footer className="shrink-0 border-t border-line bg-white px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 sm:px-4">
        <div className="mx-auto flex w-full max-w-3xl items-stretch">
          <FooterAction
            label="Lead"
            tone="green"
            href={`/leads/${current.lead_id}`}
            icon={
              <Icon>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </Icon>
            }
          />
          {!cancelled && (
            <FooterAction
              label="Adviseur"
              tone="ink"
              disabled={busy}
              onClick={() => {
                setMode((m) => (m === "adviseur" ? "view" : "adviseur"));
                setMailKlant(null);
                setError(null);
                setOkMsg(null);
              }}
              icon={
                <Icon>
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </Icon>
              }
            />
          )}
          {!cancelled && (
            <FooterAction
              label="Verzetten"
              tone="ink"
              disabled={busy}
              onClick={() => {
                setMode((m) => (m === "verzet" ? "view" : "verzet"));
                setMailKlant(null);
                setError(null);
                setOkMsg(null);
              }}
              icon={
                <Icon>
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </Icon>
              }
            />
          )}
          {!cancelled && (
            <FooterAction
              label="Annuleren"
              tone="warn"
              disabled={busy}
              onClick={() => {
                setMode((m) => (m === "annuleer" ? "view" : "annuleer"));
                setMailKlant(null);
                setError(null);
                setOkMsg(null);
              }}
              icon={
                <Icon>
                  <circle cx="12" cy="12" r="9" />
                  <path d="m9 9 6 6M15 9l-6 6" />
                </Icon>
              }
            />
          )}
          <FooterAction
            label="Verwijderen"
            tone="danger"
            disabled={busy}
            onClick={() => void verwijderDefinitief()}
            icon={
              <Icon>
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
              </Icon>
            }
          />
        </div>
      </footer>
    </div>
  );
}

export function AgendaPanel({
  leads,
  afspraken: afsprakenProp,
  defaultAdviseurId,
}: {
  leads: Lead[];
  afspraken?: Afspraak[];
  defaultAdviseurId?: string;
}) {
  const [afspraken, setAfspraken] = useState<Afspraak[]>(afsprakenProp || []);
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [slots, setSlots] = useState<{ start_at: string; end_at: string }[]>(
    []
  );
  const [blocks, setBlocks] = useState<
    { start_at: string; end_at: string; busy?: boolean }[]
  >([]);
  const [loading, setLoading] = useState(!(afsprakenProp && afsprakenProp.length > 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [planKeuze, setPlanKeuze] = useState<AfspraakSoort | "vervolg" | null>(
    null
  );
  const [selectedAfspraak, setSelectedAfspraak] = useState<Afspraak | null>(
    null
  );

  const [pickedLead, setPickedLead] = useState<Lead | null>(null);
  const [adviseurId, setAdviseurId] = useState(defaultAdviseurId || "");
  const [startAt, setStartAt] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [notities, setNotities] = useState("");
  const [partnerAanwezig, setPartnerAanwezig] = useState<boolean | null>(null);
  const [andereOffertes, setAndereOffertes] = useState<boolean | null>(null);

  const todayKey = useMemo(() => dayKeyAmsterdam(new Date()), []);
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [selectedDayKey, setSelectedDayKey] = useState(() =>
    dayKeyAmsterdam(new Date())
  );
  const [calendarView, setCalendarView] = useState<"dag" | "week">("week");

  useEffect(() => {
    try {
      const v = localStorage.getItem("bc_agenda_view");
      if (v === "dag" || v === "week") setCalendarView(v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (afsprakenProp) setAfspraken(afsprakenProp);
  }, [afsprakenProp]);

  function changeCalendarView(next: "dag" | "week") {
    setCalendarView(next);
    try {
      localStorage.setItem("bc_agenda_view", next);
    } catch {
      /* ignore */
    }
  }

  const days = useMemo(() => weekDaysFrom(weekAnchor), [weekAnchor]);

  const leadStatusById = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of leads) {
      if (l.id && l.status) map.set(l.id, l.status);
    }
    return map;
  }, [leads]);

  function resolveLeadStatus(a: Afspraak): string | null {
    if (a.lead_id && leadStatusById.has(a.lead_id)) {
      return leadStatusById.get(a.lead_id) || null;
    }
    const joined = a.leads;
    if (joined && typeof joined === "object" && "status" in joined) {
      return (joined as { status?: string | null }).status || null;
    }
    return null;
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, adv] = await Promise.all([
        fetch("/api/afspraken").then((r) => r.json()),
        fetch("/api/adviseurs").then((r) => r.json()),
      ]);
      // Afspraken: API of parent-prop; adviseurs-fout mag agenda niet leegmaken
      if (!a.error) {
        setAfspraken(a.afspraken || []);
      } else if (!afsprakenProp?.length) {
        throw new Error(a.error);
      }
      if (!adv.error) {
        setAdviseurs(adv.adviseurs || []);
        const planAdviseurs = ((adv.adviseurs || []) as Adviseur[]).filter(
          (x) => !isAdminAdviseur(x)
        );
        setAdviseurId((prev) => {
          if (defaultAdviseurId) return defaultAdviseurId;
          if (prev && planAdviseurs.some((x) => x.id === prev)) return prev;
          return planAdviseurs[0]?.id || "";
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [defaultAdviseurId, afsprakenProp]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  useEffect(() => {
    if (!adviseurId) return;
    let cancelled = false;
    queueMicrotask(async () => {
      const res = await fetch(`/api/adviseurs?adviseur_id=${adviseurId}`);
      const data = await res.json();
      if (!cancelled) {
        setSlots(data.slots || []);
        setBlocks(data.blocks || []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [adviseurId]);

  const upcoming = useMemo(
    () =>
      afspraken.filter((a) => {
        if (defaultAdviseurId && a.adviseur_id !== defaultAdviseurId) {
          return false;
        }
        if (!afspraakZichtbaarInAgenda(a, afspraken)) return false;
        if (a.status === "geannuleerd" || a.status === "voltooid") return false;
        if (new Date(a.start_at) < new Date()) return false;
        return true;
      }),
    [afspraken, defaultAdviseurId]
  );

  /** Afspraken in de zichtbare week (incl. geannuleerd én voltooid) */
  const weekAfspraken = useMemo(() => {
    const startKey = days[0].key;
    const endExclusive = format(
      addDays(days[6].date, 1),
      "yyyy-MM-dd"
    );
    return afspraken
      .filter((a) => {
        if (defaultAdviseurId && a.adviseur_id !== defaultAdviseurId) {
          return false;
        }
        if (!afspraakZichtbaarInAgenda(a, afspraken)) return false;
        const key = dayKeyAmsterdam(a.start_at);
        return key >= startKey && key < endExclusive;
      })
      .sort(
        (a, b) =>
          new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
      );
  }, [afspraken, days, defaultAdviseurId]);

  const byDay = useMemo(() => {
    const map = new Map<string, Afspraak[]>();
    for (const day of days) {
      map.set(day.key, []);
    }
    for (const a of weekAfspraken) {
      const key = dayKeyAmsterdam(a.start_at);
      const list = map.get(key);
      if (list) list.push(a);
    }
    return map;
  }, [days, weekAfspraken]);

  const selectedDay = useMemo(
    () => days.find((d) => d.key === selectedDayKey) ?? days[0],
    [days, selectedDayKey]
  );

  const selectedDayAfspraken = byDay.get(selectedDayKey) || [];

  const selectedLead = pickedLead;

  useEffect(() => {
    if (!selectedLead) return;
    if (selectedLead.notities?.trim()) {
      setNotities((prev) => prev || selectedLead.notities || "");
    }
  }, [selectedLead]);

  // Houd geselecteerde dag binnen de week
  useEffect(() => {
    const keys = days.map((d) => d.key);
    if (!keys.includes(selectedDayKey)) {
      setSelectedDayKey(keys[0]);
    }
  }, [days, selectedDayKey]);


  function goToday() {
    const now = new Date();
    setWeekAnchor(now);
    setSelectedDayKey(dayKeyAmsterdam(now));
  }

  function goPrev() {
    if (calendarView === "dag") {
      const cur = selectedDay.date;
      const prev = addDays(cur, -1);
      setSelectedDayKey(dayKeyAmsterdam(prev));
      setWeekAnchor(prev);
      return;
    }
    setWeekAnchor((d) => addWeeks(d, -1));
  }

  function goNext() {
    if (calendarView === "dag") {
      const cur = selectedDay.date;
      const next = addDays(cur, 1);
      setSelectedDayKey(dayKeyAmsterdam(next));
      setWeekAnchor(next);
      return;
    }
    setWeekAnchor((d) => addWeeks(d, 1));
  }

  const currentWeekValue = useMemo(() => {
    const w = schouwWeekFromDate(weekAnchor);
    return schouwWeekValue(w.jaar, w.week);
  }, [weekAnchor]);

  const currentWeekParsed = useMemo(
    () => schouwWeekFromDate(weekAnchor),
    [weekAnchor]
  );

  // Beschikbaarheid geldt altijd voor “deze agenda-adviseur”:
  // - verkoper: eigen id (defaultAdviseurId)
  // - admin met filter: die gefilterde adviseur
  // - admin zonder filter: de geselecteerde plan-adviseur
  const beschikbaarheidAdviseurId = defaultAdviseurId || adviseurId;
  const beschikbaarheidAdviseurNaam =
    adviseurs.find((a) => a.id === beschikbaarheidAdviseurId)?.naam || null;

  const [beschikbaarMap, setBeschikbaarMap] = useState<Map<string, boolean>>(
    new Map()
  );
  const [beschikbaarLoading, setBeschikbaarLoading] = useState(false);
  const [beschikbaarHint, setBeschikbaarHint] = useState<string | null>(null);

  const beschikbaarKey = useCallback(
    (jaar: number, week: number) => `${jaar}-W${String(week).padStart(2, "0")}`,
    []
  );

  const currentBeschikbaar = useMemo(() => {
    const k = beschikbaarKey(currentWeekParsed.jaar, currentWeekParsed.week);
    const v = beschikbaarMap.get(k);
    return v === undefined ? true : v;
  }, [beschikbaarMap, currentWeekParsed, beschikbaarKey]);

  useEffect(() => {
    if (!beschikbaarheidAdviseurId) return;
    let cancelled = false;
    const y = currentWeekParsed.jaar;
    (async () => {
      try {
        const res = await fetch(
          `/api/adviseurs/beschikbaarheid?adviseur_id=${beschikbaarheidAdviseurId}&jaren=${y - 1},${y},${y + 1}`
        );
        const data = await res.json();
        if (cancelled) return;
        if (data.migration_required) {
          setBeschikbaarHint(
            "Beschikbaarheid: run eerst migrate-adviseur-beschikbaarheid.sql in Supabase."
          );
        }
        const map = new Map<string, boolean>();
        for (const item of data.items || []) {
          map.set(
            beschikbaarKey(item.jaar, item.week),
            item.beschikbaar !== false
          );
        }
        setBeschikbaarMap(map);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    beschikbaarheidAdviseurId,
    currentWeekParsed.jaar,
    beschikbaarKey,
  ]);

  async function toggleBeschikbaar() {
    if (!beschikbaarheidAdviseurId) {
      setError("Selecteer eerst een adviseur om beschikbaarheid in te stellen.");
      return;
    }
    setBeschikbaarLoading(true);
    setError(null);
    setOkMsg(null);
    const { jaar, week } = currentWeekParsed;
    const next = !currentBeschikbaar;
    try {
      const res = await fetch("/api/adviseurs/beschikbaarheid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adviseur_id: beschikbaarheidAdviseurId,
          jaar,
          week,
          beschikbaar: next,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Beschikbaarheid opslaan mislukt");
      }
      setBeschikbaarMap((prev) => {
        const copy = new Map(prev);
        copy.set(beschikbaarKey(jaar, week), next);
        return copy;
      });
      setOkMsg(
        data.message ||
          (next
            ? `Week ${week}: beschikbaar`
            : `Week ${week}: niet beschikbaar`)
      );
      setBeschikbaarHint(null);
      // Slots opnieuw laden zodat geblokkeerde weken verdwijnen
      if (adviseurId === beschikbaarheidAdviseurId) {
        const slotRes = await fetch(`/api/adviseurs?adviseur_id=${adviseurId}`);
        const slotData = await slotRes.json();
        setSlots(slotData.slots || []);
        setBlocks(slotData.blocks || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Beschikbaarheid opslaan mislukt");
    } finally {
      setBeschikbaarLoading(false);
    }
  }

  const weekJumpOptions = useMemo(() => agendaWeekJumpOptions(8, 40), []);

  function goToWeek(value: string) {
    const parsed = parseSchouwWeekValue(value);
    if (!parsed) return;
    try {
      const monday = new Date(schouwWeekToMondayIso(parsed.jaar, parsed.week));
      setWeekAnchor(monday);
      setSelectedDayKey(dayKeyAmsterdam(monday));
      setCalendarView("week");
      try {
        localStorage.setItem("bc_agenda_view", "week");
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  }

  const planSoort: AfspraakSoort | null =
    planKeuze && planKeuze !== "vervolg" ? planKeuze : null;
  const isHuisbezoek = planSoort === "nieuw";
  const timeOptions =
    planSoort && !afspraakBlokkeertAgenda(planSoort) && blocks.length > 0
      ? blocks
      : slots;

  function resetPlanFields() {
    setStartAt("");
    setCustomStart("");
    setNotities("");
    setPickedLead(null);
    setPartnerAanwezig(null);
    setAndereOffertes(null);
  }

  async function plan(e: React.FormEvent) {
    e.preventDefault();
    if (!planSoort) return;
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      let resolvedStart = startAt;
      if (useCustomTime) {
        if (!customStart) throw new Error("Kies een tijdstip");
        const parsed = new Date(customStart);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error("Ongeldig tijdstip");
        }
        resolvedStart = parsed.toISOString();
      }
      if (!resolvedStart) throw new Error("Kies een tijdslot");
      if (!pickedLead?.id) throw new Error("Kies een lead");
      {
        const slotWeek = schouwWeekFromDate(resolvedStart);
        const key = beschikbaarKey(slotWeek.jaar, slotWeek.week);
        const open = beschikbaarMap.get(key);
        if (open === false) {
          throw new Error(
            `Week ${slotWeek.week} is geblokkeerd voor deze adviseur — zet eerst beschikbaarheid aan`
          );
        }
      }
      if (isHuisbezoek && partnerAanwezig === null) {
        throw new Error("Beantwoord: Partner aanwezig?");
      }
      if (isHuisbezoek && andereOffertes === null) {
        throw new Error("Beantwoord: Andere offertes al gehad?");
      }

      const res = await fetch("/api/afspraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: pickedLead.id,
          adviseur_id: adviseurId,
          start_at: resolvedStart,
          notities: notities || undefined,
          soort: planSoort,
          ...(isHuisbezoek
            ? {
                partner_aanwezig: partnerAanwezig,
                andere_offertes_gehad: andereOffertes,
              }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      if (data.bevestiging_direct) {
        setOkMsg("Afspraak gepland — bevestigingsmail is verstuurd.");
      } else if (data.bevestiging_error) {
        setOkMsg(
          `Afspraak gepland — mail niet verstuurd: ${data.bevestiging_error}`
        );
      } else {
        setOkMsg("Gepland.");
      }
      resetPlanFields();
      setPlanKeuze(null);
      const planned = new Date(resolvedStart);
      setWeekAnchor(planned);
      setSelectedDayKey(dayKeyAmsterdam(planned));
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  const planForm = (
    <form onSubmit={plan} className="space-y-3">
      <button
        type="button"
        onClick={() => {
          resetPlanFields();
          setPlanKeuze(null);
        }}
        className="text-xs font-medium text-green hover:underline"
      >
        ← Ander type
      </button>
      <p className="text-sm font-semibold text-ink">
        {afspraakSoortLabel[planSoort || "nieuw"]}
      </p>
      {isHuisbezoek ? (
        <p className="text-xs text-muted">
          Klant krijgt bevestiging, opwarm-mail en 24u-herinnering.
        </p>
      ) : (
        <p className="text-xs text-muted">
          Geen mail naar de klant.{" "}
          {planSoort && !afspraakBlokkeertAgenda(planSoort)
            ? "Planning mag hier een fysieke afspraak overheen zetten."
            : "Dit slot wordt geblokkeerd."}
        </p>
      )}

      <LeadZoekVeld
        value={pickedLead}
        onChange={(lead) => {
          setPickedLead(lead);
          setNotities("");
        }}
        suggestions={leads}
      />

      {selectedLead?.notities?.trim() && (
        <div className="border border-line bg-wash px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Lead-notitie
          </p>
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-ink">
            {selectedLead.notities}
          </p>
        </div>
      )}

      <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
        Adviseur
        <select
          required
          value={adviseurId}
          onChange={(e) => {
            setAdviseurId(e.target.value);
            setStartAt("");
            setCustomStart("");
          }}
          className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green sm:py-2"
        >
          <option value="">Kies adviseur…</option>
          {adviseurs
            .filter((a) => a.actief !== false && !isAdminAdviseur(a))
            .map((a) => (
            <option key={a.id} value={a.id}>
              {a.naam}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Tijdstip
          </span>
          <button
            type="button"
            onClick={() => {
              setUseCustomTime((v) => !v);
              setStartAt("");
              setCustomStart("");
            }}
            className="text-xs font-medium text-green hover:underline"
          >
            {useCustomTime ? "Kies vast slot" : "Ander tijdstip…"}
          </button>
        </div>
        {useCustomTime ? (
          <input
            type="datetime-local"
            required
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green sm:py-2"
          />
        ) : (
          <select
            required
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green sm:py-2"
          >
            <option value="">Kies tijd…</option>
            {timeOptions.slice(0, 80).map((s) => (
              <option key={s.start_at} value={s.start_at}>
                {formatDateTimeNl(s.start_at)}
                {"busy" in s && s.busy ? " (fysiek bezet)" : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      {isHuisbezoek && (
        <ReistijdHint
          adviseurId={adviseurId}
          startAt={useCustomTime ? customStart : startAt}
          lead={selectedLead}
          afspraken={afspraken}
          startAdres={
            adviseurs.find((a) => a.id === adviseurId)?.start_adres || null
          }
          startAdresLabel={
            adviseurs.find((a) => a.id === adviseurId)?.naam || null
          }
        />
      )}

      {isHuisbezoek && (
        <>
          <JaNeeField
            label="Partner aanwezig?"
            value={partnerAanwezig}
            onChange={setPartnerAanwezig}
          />
          <JaNeeField
            label="Andere offertes al gehad?"
            value={andereOffertes}
            onChange={setAndereOffertes}
          />
        </>
      )}

      <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
        Interne notitie
        <span className="ml-1 font-normal normal-case tracking-normal text-muted/80">
          (niet voor de klant)
        </span>
        <textarea
          value={notities}
          onChange={(e) => setNotities(e.target.value)}
          rows={3}
          placeholder="Bijv. bel vooraf, sleutel bij buren…"
          className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
        />
      </label>

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

      <button
        type="submit"
        disabled={
          saving ||
          (isHuisbezoek &&
            (partnerAanwezig === null || andereOffertes === null))
        }
        className="min-h-11 w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60 sm:min-h-0"
      >
        {saving
          ? "Bezig…"
          : planSoort === "bel"
            ? "Belafspraak plannen"
            : planSoort === "warmtefonds_aanvraag"
              ? "Warmtefonds-afspraak plannen"
              : planSoort === "vervolg_fysiek"
                ? "Vervolg fysiek plannen"
                : planSoort === "vervolg_tel"
                  ? "Vervolg telefonisch plannen"
                  : "Afspraak plannen"}
      </button>
    </form>
  );

  const planSidebar = !planSoort ? (
    <PlanSoortPicker
      step={planKeuze === "vervolg" ? "vervolg" : "kies"}
      onPick={setPlanKeuze}
    />
  ) : (
    planForm
  );

  return (
    <div className="grid gap-0 lg:grid-cols-[300px_1fr]">
      {/* Desktop form */}
      <aside className="hidden border-b border-line p-5 lg:block lg:border-b-0 lg:border-r">
        <h2 className="font-display text-base font-semibold text-ink">Nieuw</h2>
        <p className="mt-1 text-xs text-muted">
          Kies het type, koppel een lead en een tijdstip.
        </p>
        <div className="mt-4">{planSidebar}</div>
        {!planSoort && okMsg && (
          <p className="mt-3 border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
            {okMsg}
          </p>
        )}
        {!planSoort && error && (
          <p className="mt-3 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
            {error}
          </p>
        )}
      </aside>

      <div className="min-w-0">
        {/* Mobile: plan knop + sheet */}
        <div className="border-b border-line px-3 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => {
              setFormOpen((v) => {
                if (v) setPlanKeuze(null);
                return !v;
              });
            }}
            className="min-h-11 w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c]"
          >
            {formOpen ? "Sluiten" : "Nieuw"}
          </button>
          {formOpen && <div className="mt-4">{planSidebar}</div>}
        </div>

        {/* Navigatie */}
        <div className="sticky top-0 z-10 border-b border-line bg-white/95 px-3 py-3 backdrop-blur sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={goPrev}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink hover:bg-wash"
                aria-label={calendarView === "dag" ? "Vorige dag" : "Vorige week"}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={goNext}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink hover:bg-wash"
                aria-label={calendarView === "dag" ? "Volgende dag" : "Volgende week"}
              >
                ›
              </button>
              <button
                type="button"
                onClick={goToday}
                className="ml-1 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
              >
                Vandaag
              </button>
              <label className="ml-1 flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Week
                </span>
                <select
                  value={currentWeekValue}
                  onChange={(e) => goToWeek(e.target.value)}
                  className="min-h-9 max-w-[10rem] cursor-pointer rounded-lg border border-line bg-white px-2 text-xs font-semibold tabular-nums text-ink outline-none focus:border-green sm:max-w-[14rem]"
                  aria-label="Ga naar weeknummer"
                >
                  {weekJumpOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      W{o.week} · {o.jaar}
                      {o.value === currentWeekValue ? " (nu)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="ml-1 flex rounded-lg border border-line p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => changeCalendarView("dag")}
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
                  onClick={() => changeCalendarView("week")}
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
              {/* Beschikbaarheid toggle */}
              <button
                type="button"
                disabled={beschikbaarLoading || !beschikbaarheidAdviseurId}
                onClick={() => void toggleBeschikbaar()}
                className={[
                  "ml-2 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                  currentBeschikbaar
                    ? "border-green/30 bg-green/10 text-green"
                    : "border-red-300 bg-red-50 text-red-600",
                  beschikbaarLoading || !beschikbaarheidAdviseurId
                    ? "opacity-60"
                    : "",
                ].join(" ")}
                title={
                  !beschikbaarheidAdviseurId
                    ? "Selecteer eerst een adviseur"
                    : currentBeschikbaar
                      ? `Week ${currentWeekParsed.week}: beschikbaar — klik om te blokkeren`
                      : `Week ${currentWeekParsed.week}: geblokkeerd — klik om beschikbaar te zetten`
                }
              >
                <span
                  className={[
                    "inline-block h-2.5 w-2.5 rounded-full",
                    currentBeschikbaar ? "bg-green" : "bg-red-500",
                  ].join(" ")}
                />
                {currentBeschikbaar
                  ? `W${currentWeekParsed.week} beschikbaar`
                  : `W${currentWeekParsed.week} geblokkeerd`}
              </button>
            </div>
            <div className="min-w-0 text-right">
              <p className="truncate font-display text-sm font-semibold capitalize text-ink sm:text-base">
                {calendarView === "dag"
                  ? `${formatDayLabel(selectedDay.date)} ${formatDayNum(selectedDay.date)} ${format(selectedDay.date, "MMMM yyyy", { locale: nl })}`
                  : formatWeekRange(days)}
              </p>
              <p className="text-[11px] capitalize text-muted">
                {calendarView === "dag"
                  ? selectedDayAfspraken.length === 0
                    ? "Geen afspraken"
                    : `${selectedDayAfspraken.length} afspraak${selectedDayAfspraken.length === 1 ? "" : "en"}`
                  : `${formatMonthYear(days[0].date)}${
                      upcoming.length > 0
                        ? ` · ${upcoming.length} aankomend`
                        : ""
                    }`}
              </p>
            </div>
          </div>

          {(beschikbaarHint || !currentBeschikbaar) && (
            <div
              className={[
                "mt-3 border px-3 py-2 text-xs",
                !currentBeschikbaar
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-[#C45A12]/30 bg-[#FFF0E6] text-[#C45A12]",
              ].join(" ")}
            >
              {!currentBeschikbaar ? (
                <>
                  <strong>
                    Week {currentWeekParsed.week}
                    {beschikbaarheidAdviseurNaam
                      ? ` · ${beschikbaarheidAdviseurNaam}`
                      : ""}
                  </strong>{" "}
                  is geblokkeerd. Er kunnen geen nieuwe afspraken in deze week
                  worden gepland. Klik op de knop hierboven om weer beschikbaar
                  te zetten.
                </>
              ) : (
                beschikbaarHint
              )}
            </div>
          )}

          {/* Dag-strip: in dagweergave altijd; in week alleen mobiel (desktop heeft kolomkoppen) */}
          <div
            className={[
              "mt-3 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              calendarView === "week" ? "md:hidden" : "",
            ].join(" ")}
          >
            {days.map((day) => {
              const count = byDay.get(day.key)?.length ?? 0;
              const isToday = day.key === todayKey;
              const selected = day.key === selectedDayKey;
              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => setSelectedDayKey(day.key)}
                  className={[
                    "flex min-w-[3.25rem] flex-1 flex-col items-center rounded-xl px-2 py-2 transition sm:min-w-0",
                    selected
                      ? "bg-green text-white"
                      : isToday
                        ? "bg-green-soft text-green-dark"
                        : "bg-wash text-ink hover:bg-line/60",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "text-[10px] font-semibold uppercase tracking-wide",
                      selected ? "text-white/80" : "text-muted",
                    ].join(" ")}
                  >
                    {formatDayShort(day.date)}
                  </span>
                  <span className="mt-0.5 text-lg font-semibold tabular-nums leading-none">
                    {formatDayNum(day.date)}
                  </span>
                  <span
                    className={[
                      "mt-1 h-1 w-1 rounded-full",
                      count > 0
                        ? selected
                          ? "bg-white"
                          : "bg-green"
                        : "bg-transparent",
                    ].join(" ")}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <p className="px-6 py-14 text-center text-sm text-muted">Laden…</p>
        ) : calendarView === "dag" ? (
          <div className="px-3 py-4 sm:px-5">
            {selectedDayAfspraken.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line bg-wash/60 px-4 py-10 text-center text-sm text-muted">
                Geen afspraken op deze dag
              </div>
            ) : (
              <div className="mx-auto max-w-2xl space-y-2.5">
                {selectedDayAfspraken.map((a) => (
                  <AfspraakChip
                    key={a.id}
                    afspraak={a}
                    allAfspraken={afspraken}
                    leadStatus={resolveLeadStatus(a)}
                    variant="day"
                    onOpen={setSelectedAfspraak}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Mobiel week: geselecteerde dag */}
            <div className="px-3 py-4 md:hidden">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3 className="font-display text-base font-semibold capitalize text-ink">
                  {formatDayLabel(selectedDay.date)}{" "}
                  <span className="font-normal text-muted">
                    {formatDayNum(selectedDay.date)}{" "}
                    {format(selectedDay.date, "MMMM", { locale: nl })}
                  </span>
                </h3>
                <span className="text-xs text-muted">
                  {selectedDayAfspraken.length === 0
                    ? "Leeg"
                    : `${selectedDayAfspraken.length} afspraak${
                        selectedDayAfspraken.length === 1 ? "" : "en"
                      }`}
                </span>
              </div>
              {selectedDayAfspraken.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line bg-wash/60 px-4 py-10 text-center text-sm text-muted">
                  Geen afspraken op deze dag
                </div>
              ) : (
                <div className="space-y-2.5">
                  {selectedDayAfspraken.map((a) => (
                    <AfspraakChip
                      key={a.id}
                      afspraak={a}
                      allAfspraken={afspraken}
                      leadStatus={resolveLeadStatus(a)}
                      variant="day"
                      onOpen={setSelectedAfspraak}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Desktop / tablet: weekkolommen */}
            <div className="hidden overflow-x-auto md:block">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-7 border-b border-line bg-wash/50">
                  {days.map((day) => {
                    const isToday = day.key === todayKey;
                    const count = byDay.get(day.key)?.length ?? 0;
                    const selected = day.key === selectedDayKey;
                    return (
                      <button
                        key={day.key}
                        type="button"
                        onClick={() => setSelectedDayKey(day.key)}
                        className={[
                          "border-r border-line px-1.5 py-3 text-left last:border-r-0 sm:px-2",
                          selected
                            ? "bg-green-soft"
                            : isToday
                              ? "bg-green-soft/50"
                              : "hover:bg-wash",
                        ].join(" ")}
                      >
                        <p
                          className={[
                            "text-[10px] font-semibold uppercase tracking-wide",
                            isToday || selected ? "text-green" : "text-muted",
                          ].join(" ")}
                        >
                          {formatDayShort(day.date)}
                        </p>
                        <p
                          className={[
                            "mt-0.5 font-display text-xl font-semibold tabular-nums leading-none",
                            isToday
                              ? "inline-flex h-8 w-8 items-center justify-center rounded-full bg-green text-base text-white"
                              : "text-ink",
                          ].join(" ")}
                        >
                          {formatDayNum(day.date)}
                        </p>
                        <p className="mt-1 text-[10px] text-muted">
                          {count > 0 ? `${count}×` : "—"}
                        </p>
                      </button>
                    );
                  })}
                </div>
                <div className="grid min-h-[420px] grid-cols-7">
                  {days.map((day) => {
                    const list = byDay.get(day.key) || [];
                    const isToday = day.key === todayKey;
                    return (
                      <div
                        key={day.key}
                        className={[
                          "min-h-[420px] border-r border-line p-1.5 last:border-r-0 sm:p-2",
                          isToday ? "bg-green-soft/20" : "bg-white",
                        ].join(" ")}
                      >
                        {list.length === 0 ? (
                          <p className="px-1 py-6 text-center text-[11px] text-muted/70">
                            —
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {list.map((a) => (
                              <AfspraakChip
                                key={a.id}
                                afspraak={a}
                                allAfspraken={afspraken}
                                leadStatus={resolveLeadStatus(a)}
                                variant="week"
                                onOpen={setSelectedAfspraak}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {selectedAfspraak && (
        <AfspraakDetail
          afspraak={selectedAfspraak}
          allAfspraken={afspraken}
          onClose={() => setSelectedAfspraak(null)}
          onUpdated={(a) => {
            setSelectedAfspraak(a);
            setAfspraken((prev) =>
              prev.map((x) => (x.id === a.id ? a : x))
            );
            const planned = new Date(a.start_at);
            setWeekAnchor(planned);
            setSelectedDayKey(dayKeyAmsterdam(planned));
          }}
          onCreated={(a) => {
            setAfspraken((prev) => [...prev, a]);
            void load();
            const planned = new Date(a.start_at);
            setWeekAnchor(planned);
            setSelectedDayKey(dayKeyAmsterdam(planned));
          }}
          onRemoved={(id) => {
            setSelectedAfspraak(null);
            setAfspraken((prev) => prev.filter((x) => x.id !== id));
          }}
        />
      )}
    </div>
  );
}
