"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Sollicitatie,
  SollicitatieAfspraak,
  SollicitatieAfspraakSoort,
  SollicitatieBestand,
  SollicitatieStatus,
  SollicitatieTaak,
  TrainingMoment,
} from "@/types/database";
import {
  canAutoPromoteToGesprekGepland,
  normalizeSollicitatieStatus,
  SOLLICITATIE_STATUS_MET_TRAINING,
  SOLLICITATIE_STATUS_MET_VERVOLG,
  SOLLICITATIE_STATUSES,
  SOLLICITATIE_STATUS_LABEL,
} from "@/lib/sollicitatie";
import {
  TrainingMomentFormModal,
  TrainingMomentenView,
  TrainingToewijsModal,
  useTrainingMomenten,
} from "./TrainingMomentenPanel";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import {
  AMSTERDAM_TZ,
  formatDateShort,
  formatDateTimeNl,
  formatTimeNl,
} from "@/lib/format";

const STATUS_TONE: Record<
  SollicitatieStatus,
  { bar: string; soft: string; text: string }
> = {
  nieuw: { bar: "#1A4A6E", soft: "#E8F0F6", text: "#1A4A6E" },
  geen_contact: { bar: "#6B7280", soft: "#F3F4F6", text: "#4B5563" },
  diskwalificatie: { bar: "#9B2C2C", soft: "#FCEAEA", text: "#9B2C2C" },
  gesprek_gepland: { bar: "#A16207", soft: "#FEF7E6", text: "#854D0E" },
  gesprek_gehad: { bar: "#C2410C", soft: "#FFF4ED", text: "#9A3412" },
  aangenomen_training_gepland: {
    bar: "#0F766E",
    soft: "#E6F7F5",
    text: "#0F766E",
  },
  aangenomen_actief: { bar: "#166534", soft: "#DCFCE7", text: "#14532D" },
};

function initials(naam: string) {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function amsterdamDayKey(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function dayHeaderParts(dayKey: string): {
  weekday: string;
  dayNum: string;
  month: string;
  label: string;
} {
  const [y, m, d] = dayKey.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
  return {
    weekday: formatInTimeZone(noon, AMSTERDAM_TZ, "EEE", { locale: nl }),
    dayNum: formatInTimeZone(noon, AMSTERDAM_TZ, "d"),
    month: formatInTimeZone(noon, AMSTERDAM_TZ, "MMM", { locale: nl }),
    label: formatInTimeZone(noon, AMSTERDAM_TZ, "EEEE d MMMM", { locale: nl }),
  };
}

function addAmsterdamDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const local = new Date(y, m - 1, d + days, 12, 0, 0, 0);
  return formatInTimeZone(
    fromZonedTime(local, AMSTERDAM_TZ),
    AMSTERDAM_TZ,
    "yyyy-MM-dd"
  );
}

type AgendaDayGroup = {
  key: string;
  items: SollicitatieAfspraak[];
};

function groupAfsprakenByDay(
  afspraken: SollicitatieAfspraak[]
): AgendaDayGroup[] {
  const map = new Map<string, SollicitatieAfspraak[]>();
  for (const a of afspraken) {
    const key = amsterdamDayKey(a.start_at);
    const list = map.get(key) || [];
    list.push(a);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({
      key,
      items: [...items].sort(
        (x, y) =>
          new Date(x.start_at).getTime() - new Date(y.start_at).getTime()
      ),
    }));
}

function RecruitmentAgendaView({
  afspraken,
  onOpen,
  onDelete,
  onPlan,
}: {
  afspraken: SollicitatieAfspraak[];
  onOpen: (sollicitatieId: string) => void;
  onDelete: (id: string) => void;
  onPlan: () => void;
}) {
  const todayKey = amsterdamDayKey(new Date());
  const tomorrowKey = addAmsterdamDays(todayKey, 1);

  const { upcoming, past } = useMemo(() => {
    const groups = groupAfsprakenByDay(afspraken);
    return {
      upcoming: groups.filter((g) => g.key >= todayKey),
      past: groups.filter((g) => g.key < todayKey).reverse(),
    };
  }, [afspraken, todayKey]);

  const upcomingCount = useMemo(
    () => upcoming.reduce((n, g) => n + g.items.length, 0),
    [upcoming]
  );

  const nextAfspraak = upcoming[0]?.items[0] || null;

  function dayBadge(key: string): string | null {
    if (key === todayKey) return "Vandaag";
    if (key === tomorrowKey) return "Morgen";
    return null;
  }

  function renderDay(group: AgendaDayGroup, muted = false) {
    const parts = dayHeaderParts(group.key);
    const badge = dayBadge(group.key);
    return (
      <section
        key={group.key}
        className={[
          "overflow-hidden border border-line bg-white",
          muted ? "opacity-70" : "",
        ].join(" ")}
      >
        <header className="flex items-center gap-3 border-b border-line bg-wash/70 px-4 py-3 sm:px-5">
          <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center bg-white text-center shadow-[inset_0_0_0_1px_var(--line)]">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              {parts.weekday}
            </span>
            <span className="font-display text-lg font-semibold leading-none text-green-deeper tabular-nums">
              {parts.dayNum}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-base font-semibold capitalize text-ink">
                {parts.label}
              </h3>
              {badge ? (
                <span className="bg-green px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  {badge}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {group.items.length} gesprek
              {group.items.length === 1 ? "" : "ken"}
            </p>
          </div>
        </header>

        <ul className="divide-y divide-line">
          {group.items.map((a) => {
            const k = a.sollicitaties;
            return (
              <li
                key={a.id}
                className="group grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-stretch gap-0 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]"
              >
                <button
                  type="button"
                  onClick={() => onOpen(a.sollicitatie_id)}
                  className="flex flex-col items-center justify-center border-r border-line bg-[#fafbfa] px-2 py-4 text-center hover:bg-wash"
                >
                  <span className="font-display text-base font-semibold tabular-nums text-ink sm:text-lg">
                    {formatTimeNl(a.start_at)}
                  </span>
                  <span
                    className={[
                      "mt-1.5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                      a.soort === "fysiek"
                        ? "bg-[#FEF7E6] text-[#854D0E]"
                        : "bg-[#E8F0F6] text-[#1A4A6E]",
                    ].join(" ")}
                  >
                    {a.soort === "fysiek" ? "Fysiek" : "Tel"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpen(a.sollicitatie_id)}
                  className="flex min-w-0 items-center gap-3 px-3 py-3.5 text-left hover:bg-wash/60 sm:gap-3.5 sm:px-4"
                >
                  <div
                    className="hidden h-10 w-10 shrink-0 items-center justify-center text-xs font-semibold sm:flex"
                    style={{
                      background: STATUS_TONE.gesprek_gepland.soft,
                      color: STATUS_TONE.gesprek_gepland.text,
                    }}
                  >
                    {initials(k?.naam || "?")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {k?.naam || "Onbekend"}
                    </p>
                    {k?.functie ? (
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {k.functie}
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      {k?.telefoon ? (
                        <span className="tabular-nums">{k.telefoon}</span>
                      ) : null}
                      {k?.email ? (
                        <span className="truncate">{k.email}</span>
                      ) : null}
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-1 px-2 sm:px-3">
                  {k?.telefoon ? (
                    <a
                      href={`tel:${k.telefoon.replace(/\s+/g, "")}`}
                      className="hidden border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-wash sm:inline-block"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Bel
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onDelete(a.id)}
                    className="px-2 py-1.5 text-xs font-medium text-muted opacity-0 transition group-hover:opacity-100 hover:text-[#9B2C2C]"
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border border-line bg-white px-4 py-3.5 sm:px-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Planning
          </p>
          <p className="mt-0.5 font-display text-lg font-semibold text-ink">
            {upcomingCount === 0
              ? "Geen komende gesprekken"
              : `${upcomingCount} komend gesprek${upcomingCount === 1 ? "" : "ken"}`}
          </p>
          {nextAfspraak ? (
            <p className="mt-1 text-sm text-muted">
              Volgende:{" "}
              <span className="font-medium text-ink">
                {formatTimeNl(nextAfspraak.start_at)}
              </span>
              {" · "}
              {nextAfspraak.sollicitaties?.naam || "Kandidaat"}
              {" · "}
              {(() => {
                const key = amsterdamDayKey(nextAfspraak.start_at);
                return dayBadge(key) || dayHeaderParts(key).label;
              })()}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">
              Plan een gesprek om de agenda te vullen.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onPlan}
          className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-deeper"
        >
          Gesprek plannen
        </button>
      </div>

      {upcoming.length > 0 ? (
        <div className="flex flex-col gap-3">{upcoming.map((g) => renderDay(g))}</div>
      ) : (
        <div className="border border-line bg-white px-6 py-12 text-center">
          <p className="font-display text-lg text-ink">Agenda is leeg</p>
          <p className="mt-1 text-sm text-muted">
            Geen geplande gesprekken vanaf vandaag.
          </p>
        </div>
      )}

      {past.length > 0 ? (
        <details className="group border border-line bg-white open:pb-0">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-muted marker:content-none hover:bg-wash/60 sm:px-5 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2">
              <span className="text-ink group-open:hidden">▶</span>
              <span className="hidden text-ink group-open:inline">▼</span>
              Eerdere gesprekken ({past.reduce((n, g) => n + g.items.length, 0)})
            </span>
          </summary>
          <div className="flex flex-col gap-3 border-t border-line p-3 sm:p-4">
            {past.map((g) => renderDay(g, true))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function toLocalInputValue(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalDateValue(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function defaultVervolgDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return toLocalDateValue(d);
}

/** yyyy-MM-dd → 17:00 Amsterdam als ISO deadline */
function dateInputToDueAt(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return fromZonedTime(
    new Date(y, m - 1, d, 17, 0, 0, 0),
    AMSTERDAM_TZ
  ).toISOString();
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
      {children}
    </span>
  );
}

function SoftInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-green",
        props.className || "",
      ].join(" ")}
    />
  );
}

function SoftTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={[
        "w-full resize-y border border-line bg-wash/40 px-3.5 py-3 text-sm leading-relaxed text-ink outline-none transition focus:border-green focus:bg-white disabled:opacity-50",
        props.className || "",
      ].join(" ")}
    />
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function PhoneCopyButton({ telefoon }: { telefoon: string }) {
  const [copied, setCopied] = useState(false);
  const phone = telefoon.trim();
  if (!phone) return null;

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(phone);
    } catch {
      const el = document.createElement("textarea");
      el.value = phone;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={(e) => void copy(e)}
      onMouseDown={(e) => e.stopPropagation()}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-muted hover:bg-white hover:text-green-deeper"
      title={copied ? "Gekopieerd" : "Kopieer telefoonnummer"}
      aria-label={copied ? "Gekopieerd" : "Kopieer telefoonnummer"}
    >
      {copied ? <CheckIcon className="text-green-deeper" /> : <CopyIcon />}
    </button>
  );
}

function PhoneCopyLine({
  telefoon,
  email,
}: {
  telefoon: string | null;
  email?: string | null;
}) {
  const phone = telefoon?.trim() || "";

  if (!phone) {
    return (
      <p className="mt-1.5 truncate text-xs text-muted">
        {email || "Geen contact"}
      </p>
    );
  }

  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-1">
      <span className="truncate text-xs tabular-nums text-muted">{phone}</span>
      <PhoneCopyButton telefoon={phone} />
    </div>
  );
}

function RecruitmentAddModal({
  open,
  onClose,
  onCreated,
  functieSuggestions,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (s: Sollicitatie) => void;
  functieSuggestions: string[];
}) {
  const [naam, setNaam] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [email, setEmail] = useState("");
  const [functie, setFunctie] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setNaam("");
    setTelefoon("");
    setEmail("");
    setFunctie("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!naam.trim()) {
      setError("Naam is verplicht");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/instroom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naam,
          telefoon,
          email,
          functie,
          bron: "crm",
          status: "nieuw",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Aanmaken mislukt");
      onCreated(data.sollicitatie as Sollicitatie);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aanmaken mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Sluiten"
        onClick={() => {
          reset();
          onClose();
        }}
      />
      <form
        onSubmit={submit}
        className="relative z-10 w-full max-w-md border border-line bg-white p-6 shadow-lg"
      >
        <h2 className="font-display text-xl tracking-tight text-ink">
          Kandidaat toevoegen
        </h2>
        <p className="mt-1 text-sm text-muted">
          Verschijnt direct in de kolom Nieuw.
        </p>
        <div className="mt-5 flex flex-col gap-3.5">
          <label className="block">
            <FieldLabel>Naam *</FieldLabel>
            <SoftInput
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              autoFocus
              required
            />
          </label>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <label className="block">
              <FieldLabel>Telefoon</FieldLabel>
              <SoftInput
                value={telefoon}
                onChange={(e) => setTelefoon(e.target.value)}
                inputMode="tel"
              />
            </label>
            <label className="block">
              <FieldLabel>E-mail</FieldLabel>
              <SoftInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          </div>
          <label className="block">
            <FieldLabel>Functie</FieldLabel>
            <SoftInput
              value={functie}
              onChange={(e) => setFunctie(e.target.value)}
              list="recruitment-functies"
              placeholder="Bijv. Adviseur, Beller…"
            />
            <datalist id="recruitment-functies">
              {functieSuggestions.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
        </div>
        {error && (
          <p className="mt-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-wash"
          >
            Annuleren
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-60"
          >
            {saving ? "Bezig…" : "Toevoegen"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PlanGesprekModal({
  open,
  onClose,
  kandidaten,
  defaultSollicitatieId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  kandidaten: Sollicitatie[];
  defaultSollicitatieId?: string | null;
  onCreated: (
    a: SollicitatieAfspraak,
    mail?: {
      mailSent: boolean;
      mailSkipped: boolean;
      mailError: string | null;
    }
  ) => void;
}) {
  const [sollicitatieId, setSollicitatieId] = useState("");
  const [soort, setSoort] = useState<SollicitatieAfspraakSoort>("fysiek");
  const [startAt, setStartAt] = useState(toLocalInputValue());
  const [notitie, setNotitie] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSollicitatieId(defaultSollicitatieId || kandidaten[0]?.id || "");
    setSoort("fysiek");
    setStartAt(toLocalInputValue());
    setNotitie("");
    setError(null);
  }, [open, defaultSollicitatieId, kandidaten]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sollicitatieId || !startAt) {
      setError("Kies een kandidaat en datum/tijd");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/instroom/afspraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sollicitatie_id: sollicitatieId,
          start_at: startAt,
          soort,
          notitie,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Plannen mislukt");
      onCreated(data.afspraak as SollicitatieAfspraak, {
        mailSent: Boolean(data.mail_sent),
        mailSkipped: Boolean(data.mail_skipped),
        mailError: (data.mail_error as string) || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plannen mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Sluiten"
        onClick={onClose}
      />
      <form
        onSubmit={submit}
        className="relative z-10 w-full max-w-md border border-line bg-white p-6 shadow-lg"
      >
        <h2 className="font-display text-xl tracking-tight text-ink">
          Gesprek plannen
        </h2>
        <p className="mt-1 text-sm text-muted">
          Kandidaat krijgt een bevestigingsmail (als er een e-mailadres is) met
          datum, tijd en locatie Daltonlaan 500, 3584 BK Utrecht.
        </p>

        <div className="mt-5 flex flex-col gap-3.5">
          <label className="block">
            <FieldLabel>Kandidaat *</FieldLabel>
            <select
              value={sollicitatieId}
              onChange={(e) => setSollicitatieId(e.target.value)}
              className="w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
              required
            >
              <option value="">Kies…</option>
              {kandidaten.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.naam}
                  {k.functie ? ` · ${k.functie}` : ""}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <FieldLabel>Type *</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["telefonisch", "Telefonisch"],
                  ["fysiek", "Fysiek"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSoort(value)}
                  className={[
                    "border px-3 py-2.5 text-sm font-medium transition",
                    soort === value
                      ? "border-green bg-green-soft text-green-deeper"
                      : "border-line text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <FieldLabel>Datum & tijd *</FieldLabel>
            <SoftInput
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              required
            />
          </label>

          <label className="block">
            <FieldLabel>Notitie</FieldLabel>
            <SoftTextarea
              value={notitie}
              onChange={(e) => setNotitie(e.target.value)}
              rows={3}
              placeholder="Bijv. tweede ronde, meenemen CV…"
              className="bg-white"
            />
          </label>
        </div>

        {error && (
          <p className="mt-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-wash"
          >
            Annuleren
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-60"
          >
            {saving ? "Bezig…" : "Inplannen"}
          </button>
        </div>
      </form>
    </div>
  );
}

function BeoordelingModal({
  open,
  kandidaat,
  onClose,
  onConfirm,
}: {
  open: boolean;
  kandidaat: Sollicitatie | null;
  onClose: () => void;
  onConfirm: (payload: {
    notitie: string;
    taakTitel: string;
    dueAt: string;
  }) => Promise<void>;
}) {
  const [notitie, setNotitie] = useState("");
  const [taakTitel, setTaakTitel] = useState("Vervolg beoordeling");
  const [deadline, setDeadline] = useState(defaultVervolgDeadline());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNotitie("");
    setTaakTitel("Vervolg beoordeling");
    setDeadline(defaultVervolgDeadline());
    setError(null);
  }, [open, kandidaat?.id]);

  if (!open || !kandidaat) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!notitie.trim()) {
      setError("Noteer hoe het gesprek is gegaan.");
      return;
    }
    if (!taakTitel.trim()) {
      setError("Vul een vervolgtaak in.");
      return;
    }
    if (!deadline) {
      setError("Kies een deadline voor de opvolging.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm({
        notitie: notitie.trim(),
        taakTitel: taakTitel.trim(),
        dueAt: dateInputToDueAt(deadline),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Sluiten"
        onClick={onClose}
      />
      <form
        onSubmit={submit}
        className="relative z-10 w-full max-w-md border border-line bg-white p-6 shadow-lg"
      >
        <h2 className="font-display text-xl tracking-tight text-ink">
          Gesprek in beoordeling
        </h2>
        <p className="mt-1 text-sm text-muted">
          Voor <span className="font-medium text-ink">{kandidaat.naam}</span>:
          noteer de uitkomst en plan de opvolging met deadline.
        </p>

        <div className="mt-5 flex flex-col gap-3.5">
          <label className="block">
            <FieldLabel>Notitie gesprek *</FieldLabel>
            <SoftTextarea
              value={notitie}
              onChange={(e) => setNotitie(e.target.value)}
              rows={5}
              autoFocus
              required
              placeholder="Hoe ging het gesprek? Sterke/zwakke punten, twijfels…"
              className="bg-white"
            />
          </label>
          <label className="block">
            <FieldLabel>Vervolgtaak *</FieldLabel>
            <SoftInput
              value={taakTitel}
              onChange={(e) => setTaakTitel(e.target.value)}
              required
              placeholder="Bijv. Referenties checken, tweede gesprek…"
            />
          </label>
          <label className="block">
            <FieldLabel>Deadline opvolging *</FieldLabel>
            <SoftInput
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              required
            />
          </label>
        </div>

        {error && (
          <p className="mt-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-wash"
          >
            Annuleren
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-60"
          >
            {saving ? "Bezig…" : "Naar beoordeling"}
          </button>
        </div>
      </form>
    </div>
  );
}

function RecruitmentActiesView({
  taken,
  loading,
  onOpen,
  onVoltooi,
}: {
  taken: SollicitatieTaak[];
  loading: boolean;
  onOpen: (sollicitatieId: string) => void;
  onVoltooi: (taakId: string) => void;
}) {
  const now = Date.now();
  const overdue = taken.filter(
    (t) => new Date(t.due_at).getTime() < now
  ).length;

  if (loading) {
    return <p className="py-10 text-center text-sm text-muted">Laden…</p>;
  }

  if (taken.length === 0) {
    return (
      <div className="border border-line bg-white px-6 py-12 text-center">
        <p className="font-display text-lg text-ink">Geen open acties</p>
        <p className="mt-1 text-sm text-muted">
          Vervolgacties verschijnen hier wanneer een kandidaat naar
          &ldquo;Gesprek gehad - in beoordeling&rdquo; gaat.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>
          {taken.length} open actie{taken.length === 1 ? "" : "s"}
        </span>
        {overdue > 0 && (
          <span className="border border-[#9B2C2C]/30 bg-[#FCEAEA] px-2 py-0.5 text-xs font-semibold text-[#9B2C2C]">
            {overdue} over deadline
          </span>
        )}
      </div>

      <div className="overflow-hidden border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-wash/70 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Deadline</th>
              <th className="px-4 py-3 font-semibold">Kandidaat</th>
              <th className="px-4 py-3 font-semibold">Actie</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {taken.map((taak) => {
              const isOverdue = new Date(taak.due_at).getTime() < now;
              const sol = taak.sollicitaties;
              return (
                <tr key={taak.id} className="hover:bg-wash/40">
                  <td className="px-4 py-3 align-top">
                    <span
                      className={[
                        "font-semibold tabular-nums",
                        isOverdue ? "text-[#9B2C2C]" : "text-ink",
                      ].join(" ")}
                    >
                      {formatDateShort(taak.due_at)}
                    </span>
                    {isOverdue && (
                      <span className="mt-0.5 block text-[11px] font-medium text-[#9B2C2C]">
                        Te laat
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <button
                      type="button"
                      onClick={() => onOpen(taak.sollicitatie_id)}
                      className="text-left font-semibold text-ink hover:text-green-deeper hover:underline"
                    >
                      {sol?.naam || "Kandidaat"}
                    </button>
                    {sol?.functie && (
                      <span className="mt-0.5 block text-xs text-muted">
                        {sol.functie}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p className="font-medium text-ink">{taak.titel}</p>
                    {taak.notities && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted">
                        {taak.notities}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {sol?.status ? (
                      <span
                        className="inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          background:
                            STATUS_TONE[
                              normalizeSollicitatieStatus(sol.status)
                            ].soft,
                          color:
                            STATUS_TONE[
                              normalizeSollicitatieStatus(sol.status)
                            ].text,
                        }}
                      >
                        {
                          SOLLICITATIE_STATUS_LABEL[
                            normalizeSollicitatieStatus(sol.status)
                          ]
                        }
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <button
                      type="button"
                      onClick={() => onVoltooi(taak.id)}
                      className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-green/40 hover:text-green-deeper"
                    >
                      Voltooid
                    </button>
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

function AfspraakRow({
  afspraak,
  muted,
  onDelete,
}: {
  afspraak: SollicitatieAfspraak;
  muted?: boolean;
  onDelete: () => void;
}) {
  return (
    <li
      className={[
        "group flex items-start justify-between gap-3 px-4 py-3.5",
        muted ? "opacity-70" : "",
      ].join(" ")}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-ink">
            {formatDateTimeNl(afspraak.start_at)}
          </p>
          <span className="border border-line bg-wash px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            {afspraak.soort === "fysiek" ? "Fysiek" : "Telefonisch"}
          </span>
        </div>
        {afspraak.notitie && (
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted">
            {afspraak.notitie}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 text-xs font-medium text-muted opacity-0 transition group-hover:opacity-100 hover:text-[#9B2C2C]"
      >
        Verwijderen
      </button>
    </li>
  );
}

function KandidaatDetail({
  kandidaat,
  afspraken,
  afsprakenLoading,
  saving,
  uploading,
  onBack,
  onSave,
  onRequestBeoordeling,
  onRequestTraining,
  onPlan,
  onDeleteAfspraak,
  onUpload,
  onDeleteFile,
}: {
  kandidaat: Sollicitatie;
  afspraken: SollicitatieAfspraak[];
  afsprakenLoading: boolean;
  saving: boolean;
  uploading: boolean;
  onBack: () => void;
  onSave: (patch: Partial<Sollicitatie>) => Promise<void>;
  onRequestBeoordeling: () => void;
  onRequestTraining: () => void;
  onPlan: () => void;
  onDeleteAfspraak: (id: string) => void;
  onUpload: (file: File) => void;
  onDeleteFile: (fileId: string) => void;
}) {
  const status = normalizeSollicitatieStatus(kandidaat.status);
  const tone = STATUS_TONE[status];
  const bestanden = kandidaat.sollicitatie_bestanden || [];
  const now = Date.now();
  const upcoming = afspraken.filter(
    (a) => new Date(a.start_at).getTime() >= now - 60_000
  );
  const past = afspraken.filter(
    (a) => new Date(a.start_at).getTime() < now - 60_000
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <nav className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <button
          type="button"
          onClick={onBack}
          className="font-medium hover:text-green-deeper"
        >
          Recruitment
        </button>
        <span className="text-line">/</span>
        <span className="font-medium text-ink">{kandidaat.naam}</span>
      </nav>

      <section className="border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-5 border-b border-line px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex min-w-0 items-start gap-4">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center text-base font-semibold"
              style={{ background: tone.soft, color: tone.text }}
            >
              {initials(kandidaat.naam)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-display text-2xl tracking-tight text-ink sm:text-[1.75rem]">
                  {kandidaat.naam}
                </h1>
                <span
                  className="px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                  style={{ background: tone.soft, color: tone.text }}
                >
                  {SOLLICITATIE_STATUS_LABEL[status]}
                </span>
              </div>
              {kandidaat.functie && (
                <p className="mt-1 text-sm font-medium text-green-deeper">
                  {kandidaat.functie}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <FieldLabel>Status</FieldLabel>
              <select
                value={status}
                disabled={saving}
                onChange={(e) => {
                  const next = e.target.value as SollicitatieStatus;
                  if (
                    next === SOLLICITATIE_STATUS_MET_VERVOLG &&
                    status !== SOLLICITATIE_STATUS_MET_VERVOLG
                  ) {
                    onRequestBeoordeling();
                    return;
                  }
                  if (
                    next === SOLLICITATIE_STATUS_MET_TRAINING &&
                    status !== SOLLICITATIE_STATUS_MET_TRAINING
                  ) {
                    onRequestTraining();
                    return;
                  }
                  void onSave({ status: next });
                }}
                className="cursor-pointer border border-line bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-green disabled:opacity-50"
              >
                {SOLLICITATIE_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {SOLLICITATIE_STATUS_LABEL[st]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={onPlan}
              className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-deeper"
            >
              Gesprek plannen
            </button>
          </div>
        </div>

        <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-wash px-5 py-4">
            <FieldLabel>Telefoon</FieldLabel>
            {kandidaat.telefoon ? (
              <div className="flex min-w-0 items-center gap-1.5">
                <a
                  href={`tel:${kandidaat.telefoon}`}
                  className="block truncate text-sm font-medium text-ink hover:text-green-deeper"
                >
                  {kandidaat.telefoon}
                </a>
                <PhoneCopyButton telefoon={kandidaat.telefoon} />
              </div>
            ) : (
              <p className="text-sm text-muted">—</p>
            )}
          </div>
          <div className="bg-wash px-5 py-4">
            <FieldLabel>E-mail</FieldLabel>
            {kandidaat.email ? (
              <a
                href={`mailto:${kandidaat.email}`}
                className="block truncate text-sm font-medium text-ink hover:text-green-deeper"
              >
                {kandidaat.email}
              </a>
            ) : (
              <p className="text-sm text-muted">—</p>
            )}
          </div>
          <div className="bg-wash px-5 py-4">
            <FieldLabel>Bron</FieldLabel>
            <p className="truncate text-sm font-medium text-ink">
              {kandidaat.bron || "—"}
            </p>
          </div>
          <div className="bg-wash px-5 py-4">
            <FieldLabel>Binnengekomen</FieldLabel>
            <p className="truncate text-sm font-medium text-ink">
              {formatDateTimeNl(kandidaat.created_at)}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-5">
        <section className="border border-line bg-white lg:col-span-3">
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="font-display text-base font-semibold text-ink">
              Notities
            </h2>
          </div>
          <div className="p-5">
            <SoftTextarea
              key={`${kandidaat.id}-notitie`}
              defaultValue={kandidaat.notitie || ""}
              rows={12}
              disabled={saving}
              onBlur={(e) => {
                const next = e.target.value.trim() || null;
                if ((kandidaat.notitie || null) === next) return;
                void onSave({ notitie: next });
              }}
              placeholder="Interne notities over deze kandidaat…"
            />
            <p className="mt-2 text-xs text-muted">
              Automatisch opgeslagen wanneer je het veld verlaat.
            </p>
          </div>
        </section>

        <section className="border border-line bg-white lg:col-span-2">
          <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
            <h2 className="font-display text-base font-semibold text-ink">
              Afspraken
            </h2>
            <button
              type="button"
              onClick={onPlan}
              className="text-xs font-semibold text-green-deeper hover:underline"
            >
              + Plannen
            </button>
          </div>

          <div className="min-h-[220px]">
            {afsprakenLoading ? (
              <p className="px-5 py-8 text-sm text-muted">Laden…</p>
            ) : afspraken.length === 0 ? (
              <div className="flex flex-col items-start gap-3 px-5 py-8">
                <p className="text-sm text-muted">
                  Nog geen gesprekken gepland.
                </p>
                <button
                  type="button"
                  onClick={onPlan}
                  className="border border-line bg-wash px-3 py-2 text-xs font-semibold text-ink hover:border-green/40"
                >
                  Eerste gesprek plannen
                </button>
              </div>
            ) : (
              <div>
                {upcoming.length > 0 && (
                  <div>
                    <p className="bg-[#fafbfa] px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Gepland
                    </p>
                    <ul className="divide-y divide-line">
                      {upcoming.map((a) => (
                        <AfspraakRow
                          key={a.id}
                          afspraak={a}
                          onDelete={() => onDeleteAfspraak(a.id)}
                        />
                      ))}
                    </ul>
                  </div>
                )}
                {past.length > 0 && (
                  <div>
                    <p className="bg-[#fafbfa] px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Eerder
                    </p>
                    <ul className="divide-y divide-line">
                      {past.map((a) => (
                        <AfspraakRow
                          key={a.id}
                          afspraak={a}
                          muted
                          onDelete={() => onDeleteAfspraak(a.id)}
                        />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 className="font-display text-base font-semibold text-ink">
            Bestanden
          </h2>
          <label className="cursor-pointer border border-line bg-wash px-3 py-1.5 text-xs font-semibold text-ink hover:border-green/40">
            {uploading ? "Uploaden…" : "Uploaden"}
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {bestanden.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Nog geen bestanden.</p>
        ) : (
          <ul className="divide-y divide-line">
            {bestanden.map((file) => (
              <li
                key={file.id}
                className="group flex items-center justify-between gap-3 px-5 py-3"
              >
                <a
                  href={file.url || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm font-medium text-green-deeper hover:underline"
                >
                  {file.bestandsnaam || "Bestand"}
                </a>
                <button
                  type="button"
                  onClick={() => onDeleteFile(file.id)}
                  className="shrink-0 text-xs font-medium text-muted opacity-0 transition group-hover:opacity-100 hover:text-[#9B2C2C]"
                >
                  Verwijderen
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-2 border border-line bg-white px-4 py-2.5 text-sm font-medium text-muted transition hover:border-green/40 hover:text-green-deeper"
      >
        ← Alle kandidaten
      </button>
    </div>
  );
}

export function RecruitmentPanel() {
  const [view, setView] = useState<
    "kanban" | "agenda" | "acties" | "trainingen"
  >("agenda");
  const [items, setItems] = useState<Sollicitatie[]>([]);
  const [afspraken, setAfspraken] = useState<SollicitatieAfspraak[]>([]);
  const [taken, setTaken] = useState<SollicitatieTaak[]>([]);
  const [detailAfspraken, setDetailAfspraken] = useState<SollicitatieAfspraak[]>(
    []
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [takenLoading, setTakenLoading] = useState(false);
  const [detailAfsprakenLoading, setDetailAfsprakenLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [functieFilter, setFunctieFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planForId, setPlanForId] = useState<string | null>(null);
  const [beoordelingId, setBeoordelingId] = useState<string | null>(null);
  const [trainingAssignId, setTrainingAssignId] = useState<string | null>(null);
  const [trainingFormOpen, setTrainingFormOpen] = useState(false);
  const [trainingEdit, setTrainingEdit] = useState<TrainingMoment | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<SollicitatieStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const draggedRef = useRef(false);
  const {
    trainingen,
    setTrainingen,
    loading: trainingenLoading,
    error: trainingenError,
    setError: setTrainingenError,
    load: loadTrainingen,
  } = useTrainingMomenten();

  const selected = useMemo(
    () => items.find((s) => s.id === selectedId) || null,
    [items, selectedId]
  );

  const loadKandidaten = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/instroom");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      const list = ((data.sollicitaties || []) as Sollicitatie[]).map((s) => ({
        ...s,
        status: normalizeSollicitatieStatus(s.status),
      }));
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAgenda = useCallback(async () => {
    setAgendaLoading(true);
    setError(null);
    try {
      const from = new Date();
      from.setDate(from.getDate() - 30);
      const res = await fetch(
        `/api/instroom/afspraken?from=${encodeURIComponent(from.toISOString())}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Agenda laden mislukt");
      setAfspraken((data.afspraken || []) as SollicitatieAfspraak[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agenda laden mislukt");
    } finally {
      setAgendaLoading(false);
    }
  }, []);

  const loadTaken = useCallback(async () => {
    setTakenLoading(true);
    try {
      const res = await fetch("/api/instroom/taken");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Acties laden mislukt");
      setTaken((data.taken || []) as SollicitatieTaak[]);
      if (data.error && !(data.taken || []).length) {
        setError(data.error as string);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Acties laden mislukt");
    } finally {
      setTakenLoading(false);
    }
  }, []);

  const loadDetailAfspraken = useCallback(async (sollicitatieId: string) => {
    setDetailAfsprakenLoading(true);
    try {
      const res = await fetch(
        `/api/instroom/afspraken?sollicitatie_id=${encodeURIComponent(sollicitatieId)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Afspraken laden mislukt");
      setDetailAfspraken((data.afspraken || []) as SollicitatieAfspraak[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Afspraken laden mislukt");
      setDetailAfspraken([]);
    } finally {
      setDetailAfsprakenLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadKandidaten();
      void loadAgenda();
      void loadTaken();
      void loadTrainingen();
    });
    return () => cancelAnimationFrame(frame);
  }, [loadKandidaten, loadAgenda, loadTaken, loadTrainingen]);

  useEffect(() => {
    if (view === "agenda" && !selectedId) void loadAgenda();
    if (view === "acties" && !selectedId) void loadTaken();
    if (view === "trainingen" && !selectedId) void loadTrainingen();
  }, [view, loadAgenda, loadTaken, loadTrainingen, selectedId]);

  const nextAfspraakBySollicitatie = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, SollicitatieAfspraak>();
    const sorted = [...afspraken].sort(
      (a, b) =>
        new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
    );
    // Eerst eerstvolgende (nu / toekomst)
    for (const a of sorted) {
      if (new Date(a.start_at).getTime() < now - 30 * 60 * 1000) continue;
      if (!map.has(a.sollicitatie_id)) map.set(a.sollicitatie_id, a);
    }
    // Anders meest recente in het verleden
    for (const a of [...sorted].reverse()) {
      if (map.has(a.sollicitatie_id)) continue;
      map.set(a.sollicitatie_id, a);
    }
    return map;
  }, [afspraken]);

  useEffect(() => {
    if (!selectedId) {
      setDetailAfspraken([]);
      return;
    }
    void loadDetailAfspraken(selectedId);
  }, [selectedId, loadDetailAfspraken]);

  const functies = useMemo(() => {
    const set = new Set<string>();
    for (const s of items) {
      const f = (s.functie || "").trim();
      if (f) set.add(f);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "nl"));
  }, [items]);

  const filtered = useMemo(() => {
    if (!functieFilter) return items;
    return items.filter(
      (s) =>
        (s.functie || "").trim().toLowerCase() === functieFilter.toLowerCase()
    );
  }, [items, functieFilter]);

  const byStatus = useMemo(() => {
    const map = new Map<SollicitatieStatus, Sollicitatie[]>();
    for (const st of SOLLICITATIE_STATUSES) map.set(st, []);
    for (const s of filtered) {
      map.get(normalizeSollicitatieStatus(s.status))!.push(s);
    }
    return map;
  }, [filtered]);

  async function patchKandidaat(
    id: string,
    patch: Partial<Sollicitatie> & {
      notitie_append?: string;
      vervolg_taak?: { titel: string; due_at: string };
      training_moment_id?: string | null;
    }
  ) {
    setSaving(true);
    setBusy(true);
    setError(null);
    const prev = items;
    const { notitie_append: _na, vervolg_taak: _vt, ...solPatch } = patch;
    const optimisticStatus = solPatch.status
      ? normalizeSollicitatieStatus(solPatch.status)
      : null;
    setItems((list) =>
      list.map((s) =>
        s.id === id
          ? {
              ...s,
              ...solPatch,
              status: optimisticStatus || s.status,
            }
          : s
      )
    );
    try {
      const res = await fetch(`/api/instroom/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      const updated = data.sollicitatie as Sollicitatie;
      setItems((list) =>
        list.map((s) =>
          s.id === id
            ? {
                ...s,
                ...updated,
                status: normalizeSollicitatieStatus(updated.status),
                sollicitatie_bestanden: s.sollicitatie_bestanden,
              }
            : s
        )
      );
      if (data.taak) {
        const taak = data.taak as SollicitatieTaak;
        setTaken((list) =>
          [...list.filter((t) => t.id !== taak.id), taak].sort(
            (a, b) =>
              new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
          )
        );
      }
      return data as {
        sollicitatie: Sollicitatie;
        mail_sent?: boolean;
        mail_skipped?: boolean;
        mail_error?: string | null;
      };
    } catch (e) {
      setItems(prev);
      setError(e instanceof Error ? e.message : "Fout");
      throw e instanceof Error ? e : new Error("Fout");
    } finally {
      setSaving(false);
      setBusy(false);
    }
  }

  function handleDrop(status: SollicitatieStatus) {
    if (!dragId) return;
    const item = items.find((s) => s.id === dragId);
    setDragId(null);
    setOverStatus(null);
    if (!item || normalizeSollicitatieStatus(item.status) === status) return;
    if (
      status === SOLLICITATIE_STATUS_MET_VERVOLG &&
      normalizeSollicitatieStatus(item.status) !== SOLLICITATIE_STATUS_MET_VERVOLG
    ) {
      setBeoordelingId(item.id);
      return;
    }
    if (
      status === SOLLICITATIE_STATUS_MET_TRAINING &&
      normalizeSollicitatieStatus(item.status) !== SOLLICITATIE_STATUS_MET_TRAINING
    ) {
      setTrainingAssignId(item.id);
      return;
    }
    void patchKandidaat(item.id, { status }).catch(() => {
      /* error state is al gezet */
    });
  }

  async function voltooiTaak(taakId: string) {
    try {
      const res = await fetch(`/api/instroom/taken/${taakId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Voltooien mislukt");
      setTaken((list) => list.filter((t) => t.id !== taakId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voltooien mislukt");
    }
  }

  async function deleteAfspraak(id: string) {
    if (!window.confirm("Dit gesprek uit de agenda verwijderen?")) return;
    try {
      const res = await fetch(`/api/instroom/afspraken/${id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      setAfspraken((list) => list.filter((a) => a.id !== id));
      setDetailAfspraken((list) => list.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  async function uploadFile(file: File) {
    if (!selectedId) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/instroom/${selectedId}/files`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          [data.error || "Upload mislukt", data.detail]
            .filter(Boolean)
            .join(": ")
        );
      }
      const bestand = data.bestand as SollicitatieBestand;
      setItems((prev) =>
        prev.map((item) =>
          item.id === selectedId
            ? {
                ...item,
                sollicitatie_bestanden: [
                  ...(item.sollicitatie_bestanden || []),
                  bestand,
                ],
              }
            : item
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload mislukt");
    } finally {
      setUploading(false);
    }
  }

  async function deleteFile(fileId: string) {
    if (!selectedId) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/instroom/${selectedId}/files?file_id=${encodeURIComponent(fileId)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      setItems((prev) =>
        prev.map((item) =>
          item.id === selectedId
            ? {
                ...item,
                sollicitatie_bestanden: (
                  item.sollicitatie_bestanden || []
                ).filter((file) => file.id !== fileId),
              }
            : item
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  function handleAfspraakCreated(
    a: SollicitatieAfspraak,
    mail?: {
      mailSent: boolean;
      mailSkipped: boolean;
      mailError: string | null;
    }
  ) {
    setAfspraken((prev) =>
      [...prev, a].sort(
        (x, y) =>
          new Date(x.start_at).getTime() - new Date(y.start_at).getTime()
      )
    );
    setDetailAfspraken((prev) =>
      [...prev, a].sort(
        (x, y) =>
          new Date(x.start_at).getTime() - new Date(y.start_at).getTime()
      )
    );
    const sid = a.sollicitatie_id;
    setItems((prev) =>
      prev.map((s) =>
        s.id === sid &&
        canAutoPromoteToGesprekGepland(normalizeSollicitatieStatus(s.status))
          ? { ...s, status: "gesprek_gepland" }
          : s
      )
    );
    setError(null);
    if (mail?.mailSent) {
      setInfo("Gesprek gepland — bevestiging gemaild naar de kandidaat.");
    } else if (mail?.mailSkipped) {
      setInfo("Gesprek gepland — geen e-mailadres, dus geen mail verstuurd.");
    } else if (mail?.mailError) {
      setInfo(`Gesprek gepland, maar mail mislukt: ${mail.mailError}`);
    } else {
      setInfo("Gesprek gepland.");
    }
  }

  function openPlan(sollicitatieId?: string) {
    setPlanForId(sollicitatieId || selectedId || null);
    setPlanOpen(true);
  }

  function openKandidaat(id: string) {
    setSelectedId(id);
  }

  if (selected) {
    return (
      <div className="flex flex-col gap-4">
        {error && (
          <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
            {error}
          </p>
        )}
        <KandidaatDetail
          kandidaat={selected}
          afspraken={detailAfspraken}
          afsprakenLoading={detailAfsprakenLoading}
          saving={saving}
          uploading={uploading}
          onBack={() => setSelectedId(null)}
          onSave={async (patch) => {
            try {
              await patchKandidaat(selected.id, patch);
            } catch {
              /* error state is al gezet */
            }
          }}
          onRequestBeoordeling={() => setBeoordelingId(selected.id)}
          onRequestTraining={() => setTrainingAssignId(selected.id)}
          onPlan={() => openPlan(selected.id)}
          onDeleteAfspraak={(id) => void deleteAfspraak(id)}
          onUpload={(file) => void uploadFile(file)}
          onDeleteFile={(fileId) => void deleteFile(fileId)}
        />
        <PlanGesprekModal
          open={planOpen}
          onClose={() => setPlanOpen(false)}
          kandidaten={items}
          defaultSollicitatieId={planForId}
          onCreated={handleAfspraakCreated}
        />
        <BeoordelingModal
          open={Boolean(beoordelingId)}
          kandidaat={
            items.find((s) => s.id === beoordelingId) || selected || null
          }
          onClose={() => setBeoordelingId(null)}
          onConfirm={async ({ notitie, taakTitel, dueAt }) => {
            if (!beoordelingId) return;
            await patchKandidaat(beoordelingId, {
              status: SOLLICITATIE_STATUS_MET_VERVOLG,
              notitie_append: notitie,
              vervolg_taak: { titel: taakTitel, due_at: dueAt },
            });
            setInfo("Kandidaat in beoordeling — vervolgactie aangemaakt.");
          }}
        />
        <TrainingToewijsModal
          open={Boolean(trainingAssignId)}
          kandidaatNaam={
            items.find((s) => s.id === trainingAssignId)?.naam || selected?.naam || ""
          }
          trainingen={trainingen}
          onClose={() => setTrainingAssignId(null)}
          onConfirm={async (trainingMomentId) => {
            if (!trainingAssignId) return;
            const data = await patchKandidaat(trainingAssignId, {
              status: SOLLICITATIE_STATUS_MET_TRAINING,
              training_moment_id: trainingMomentId,
            });
            if (data.mail_sent) {
              setInfo("Training gepland — bevestiging gemaild naar de kandidaat.");
            } else if (data.mail_skipped) {
              setInfo(
                "Training gepland — geen e-mailadres, dus geen mail verstuurd."
              );
            } else if (data.mail_error) {
              setInfo(`Training gepland, maar mail mislukt: ${data.mail_error}`);
            } else {
              setInfo("Training gepland.");
            }
          }}
        />
      </div>
    );
  }

  const openActiesCount = taken.length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-white px-4 py-3">
        <div className="flex border border-line p-0.5">
          {(
            [
              ["kanban", "Kanban"],
              ["agenda", "Agenda"],
              ["acties", "Acties"],
              ["trainingen", "Trainingmomenten"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={[
                "px-3.5 py-1.5 text-sm font-medium transition",
                view === id
                  ? "bg-green text-white"
                  : "bg-white text-ink hover:bg-wash",
              ].join(" ")}
            >
              {label}
              {id === "acties" && openActiesCount > 0 ? (
                <span
                  className={[
                    "ml-1.5 inline-block min-w-5 px-1 text-center text-[11px] font-semibold tabular-nums",
                    view === id
                      ? "bg-white/20 text-white"
                      : "bg-wash text-muted",
                  ].join(" ")}
                >
                  {openActiesCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {view === "kanban" && (
            <>
              <select
                value={functieFilter}
                onChange={(e) => setFunctieFilter(e.target.value)}
                className="border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                aria-label="Filter op functie"
              >
                <option value="">Alle functies</option>
                {functies.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <span className="text-xs tabular-nums text-muted">
                {filtered.length} kandidaat{filtered.length === 1 ? "" : "en"}
              </span>
            </>
          )}
          <button
            type="button"
            onClick={() => openPlan()}
            className="border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-wash"
          >
            Gesprek plannen
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-deeper"
          >
            + Kandidaat
          </button>
        </div>
      </div>

      {error && (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      )}
      {info && (
        <p className="border border-green/30 bg-[#E8F6EC] px-3 py-2 text-xs text-green-deeper">
          {info}
        </p>
      )}

      {view === "kanban" &&
        (loading ? (
          <p className="py-10 text-center text-sm text-muted">Laden…</p>
        ) : (
          <div
            className="flex gap-3 overflow-x-auto pb-1"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {SOLLICITATIE_STATUSES.map((status) => {
              const column = byStatus.get(status) || [];
              const tone = STATUS_TONE[status];
              const isOver = overStatus === status;
              return (
                <section
                  key={status}
                  className={[
                    "flex w-[280px] shrink-0 flex-col border bg-white transition",
                    isOver
                      ? "border-green ring-2 ring-green/20"
                      : "border-line",
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
                    handleDrop(status);
                  }}
                >
                  <header
                    className="flex items-center justify-between gap-2 px-3.5 py-3"
                    style={{
                      borderTop: `3px solid ${tone.bar}`,
                      background: tone.soft,
                    }}
                  >
                    <h3
                      className="text-sm font-semibold tracking-tight"
                      style={{ color: tone.text }}
                    >
                      {SOLLICITATIE_STATUS_LABEL[status]}
                    </h3>
                    <span
                      className="min-w-6 rounded-sm px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums"
                      style={{ background: "white", color: tone.text }}
                    >
                      {column.length}
                    </span>
                  </header>
                  <ul className="flex min-h-[220px] flex-col gap-2 bg-[#fafbfa] p-2.5">
                    {column.map((s) => (
                      <li
                        key={s.id}
                        draggable={!busy}
                        onDragStart={() => {
                          draggedRef.current = false;
                          setDragId(s.id);
                        }}
                        onDrag={() => {
                          draggedRef.current = true;
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverStatus(null);
                        }}
                        onClick={() => {
                          if (draggedRef.current) return;
                          openKandidaat(s.id);
                        }}
                        className={[
                          "group cursor-pointer border border-line bg-white p-3 transition hover:border-green/50 hover:shadow-[0_1px_0_rgba(13,92,50,0.06)]",
                          dragId === s.id ? "opacity-40" : "",
                        ].join(" ")}
                      >
                        <div className="flex items-start gap-2.5">
                          <div
                            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-[11px] font-semibold"
                            style={{
                              background: tone.soft,
                              color: tone.text,
                            }}
                          >
                            {initials(s.naam)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-ink">
                              {s.naam}
                            </p>
                            {s.functie ? (
                              <p className="mt-0.5 truncate text-xs text-green-deeper">
                                {s.functie}
                              </p>
                            ) : null}
                            <PhoneCopyLine telefoon={s.telefoon} email={s.email} />
                            {(() => {
                              const af = nextAfspraakBySollicitatie.get(s.id);
                              if (!af) return null;
                              return (
                                <p
                                  className="mt-2 rounded-sm px-2 py-1.5 text-[11px] font-semibold leading-snug"
                                  style={{
                                    background: STATUS_TONE.gesprek_gepland.soft,
                                    color: STATUS_TONE.gesprek_gepland.text,
                                  }}
                                >
                                  {af.soort === "fysiek" ? "Fysiek" : "Telefonisch"}
                                  {" · "}
                                  {formatDateShort(af.start_at)}
                                  {" · "}
                                  {formatTimeNl(af.start_at)}
                                </p>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="mt-2.5 flex items-center justify-between border-t border-line/80 pt-2">
                          <span className="text-[11px] font-medium text-muted group-hover:text-green-deeper">
                            Openen →
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openPlan(s.id);
                            }}
                            className="text-[11px] font-semibold text-muted hover:text-green-deeper"
                          >
                            Plannen
                          </button>
                        </div>
                      </li>
                    ))}
                    {column.length === 0 && (
                      <li className="flex flex-1 items-center justify-center px-2 py-10 text-center text-xs text-muted">
                        Sleep hierheen
                      </li>
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        ))}

      {view === "agenda" &&
        (agendaLoading ? (
          <p className="py-10 text-center text-sm text-muted">Agenda laden…</p>
        ) : afspraken.length === 0 ? (
          <div className="border border-line bg-white px-6 py-14 text-center">
            <p className="font-display text-lg text-ink">Nog geen gesprekken</p>
            <p className="mt-1 text-sm text-muted">
              Plan een gesprek — dan zie je hier de planning per dag.
            </p>
            <button
              type="button"
              onClick={() => openPlan()}
              className="mt-5 bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-deeper"
            >
              Gesprek plannen
            </button>
          </div>
        ) : (
          <RecruitmentAgendaView
            afspraken={afspraken}
            onOpen={openKandidaat}
            onDelete={(id) => void deleteAfspraak(id)}
            onPlan={() => openPlan()}
          />
        ))}

      {view === "acties" && (
        <RecruitmentActiesView
          taken={taken}
          loading={takenLoading}
          onOpen={openKandidaat}
          onVoltooi={(id) => void voltooiTaak(id)}
        />
      )}

      {view === "trainingen" && (
        <>
          {(error || trainingenError) && (
            <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              {error || trainingenError}
            </p>
          )}
          <TrainingMomentenView
            trainingen={trainingen}
            loading={trainingenLoading}
            onRefresh={() => void loadTrainingen()}
            onCreate={() => {
              setTrainingEdit(null);
              setTrainingFormOpen(true);
            }}
            onEdit={(t) => {
              setTrainingEdit(t);
              setTrainingFormOpen(true);
            }}
            onDelete={(id) => {
              if (!window.confirm("Dit trainingmoment verwijderen?")) return;
              void (async () => {
                try {
                  const res = await fetch(`/api/instroom/trainingen/${id}`, {
                    method: "DELETE",
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
                  setTrainingen((list) => list.filter((t) => t.id !== id));
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Verwijderen mislukt"
                  );
                }
              })();
            }}
          />
        </>
      )}

      <RecruitmentAddModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        functieSuggestions={functies}
        onCreated={(s) => {
          setItems((prev) => [
            { ...s, status: normalizeSollicitatieStatus(s.status) },
            ...prev,
          ]);
        }}
      />

      <PlanGesprekModal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        kandidaten={items}
        defaultSollicitatieId={planForId}
        onCreated={(a, mail) => {
          handleAfspraakCreated(a, mail);
          if (view !== "agenda") setView("agenda");
        }}
      />

      <BeoordelingModal
        open={Boolean(beoordelingId)}
        kandidaat={items.find((s) => s.id === beoordelingId) || null}
        onClose={() => setBeoordelingId(null)}
        onConfirm={async ({ notitie, taakTitel, dueAt }) => {
          if (!beoordelingId) return;
          await patchKandidaat(beoordelingId, {
            status: SOLLICITATIE_STATUS_MET_VERVOLG,
            notitie_append: notitie,
            vervolg_taak: { titel: taakTitel, due_at: dueAt },
          });
          setInfo("Kandidaat in beoordeling — vervolgactie aangemaakt.");
          if (view !== "acties") setView("acties");
        }}
      />

      <TrainingToewijsModal
        open={Boolean(trainingAssignId)}
        kandidaatNaam={
          items.find((s) => s.id === trainingAssignId)?.naam || ""
        }
        trainingen={trainingen}
        onClose={() => setTrainingAssignId(null)}
        onConfirm={async (trainingMomentId) => {
          if (!trainingAssignId) return;
          const data = await patchKandidaat(trainingAssignId, {
            status: SOLLICITATIE_STATUS_MET_TRAINING,
            training_moment_id: trainingMomentId,
          });
          if (data.mail_sent) {
            setInfo("Training gepland — bevestiging gemaild naar de kandidaat.");
          } else if (data.mail_skipped) {
            setInfo(
              "Training gepland — geen e-mailadres, dus geen mail verstuurd."
            );
          } else if (data.mail_error) {
            setInfo(`Training gepland, maar mail mislukt: ${data.mail_error}`);
          } else {
            setInfo("Training gepland.");
          }
        }}
      />

      <TrainingMomentFormModal
        open={trainingFormOpen}
        initial={trainingEdit}
        onClose={() => {
          setTrainingFormOpen(false);
          setTrainingEdit(null);
        }}
        onSaved={(t) => {
          setTrainingen((list) => {
            const without = list.filter((x) => x.id !== t.id);
            return [...without, t].sort((a, b) =>
              a.periode_van.localeCompare(b.periode_van)
            );
          });
          setTrainingenError(null);
          setInfo(
            trainingEdit
              ? "Trainingmoment bijgewerkt."
              : "Trainingmoment aangemaakt."
          );
        }}
      />
    </div>
  );
}
