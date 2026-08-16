"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  addDays,
  addWeeks,
  format,
  startOfWeek,
} from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type { Adviseur, Afspraak, Lead } from "@/types/database";
import {
  AMSTERDAM_TZ,
  adresRegel,
  formatDateTimeLongNl,
  formatDateTimeNl,
  formatTimeNl,
} from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

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

function appointmentNote(a: Afspraak): string {
  return a.notities?.trim() || a.leads?.notities?.trim() || "";
}

function jaNeeLabel(v: boolean | null | undefined): string | null {
  if (v === true) return "Ja";
  if (v === false) return "Nee";
  return null;
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

function statusAccent(status: Afspraak["status"]): string {
  if (status === "geannuleerd") return "border-l-[#9aa39c] bg-[#f3f5f4]";
  if (status === "verzet") return "border-l-[#C45A12] bg-[#FFF8F3]";
  if (status === "voltooid") return "border-l-[#5a635c] bg-[#f5f7f6]";
  return "border-l-green bg-green-soft/70";
}

/** Compacte agenda-chip — klik opent detail */
function AfspraakChip({
  afspraak,
  variant = "week",
  onOpen,
}: {
  afspraak: Afspraak;
  variant?: "week" | "day";
  onOpen: (a: Afspraak) => void;
}) {
  const cancelled = afspraak.status === "geannuleerd";
  const naam = afspraak.leads?.naam || "—";

  if (variant === "day") {
    return (
      <button
        type="button"
        onClick={() => onOpen(afspraak)}
        className={[
          "flex w-full items-stretch gap-0 overflow-hidden rounded-xl border border-line text-left transition",
          "hover:border-green/35 hover:shadow-[0_4px_16px_rgba(13,92,50,0.08)]",
          "active:scale-[0.99]",
          cancelled ? "opacity-50" : "",
        ].join(" ")}
      >
        <span
          className={[
            "w-1.5 shrink-0",
            afspraak.status === "geannuleerd"
              ? "bg-[#9aa39c]"
              : afspraak.status === "verzet"
                ? "bg-[#C45A12]"
                : "bg-green",
          ].join(" ")}
        />
        <span className="flex min-w-0 flex-1 items-center gap-3 bg-white px-3.5 py-3">
          <span className="shrink-0">
            <span className="block font-display text-lg font-semibold tabular-nums leading-none text-ink">
              {formatTimeNl(afspraak.start_at)}
            </span>
            <span className="mt-1 block text-[11px] tabular-nums text-muted">
              {formatTimeNl(afspraak.end_at)}
            </span>
          </span>
          <span className="min-w-0 flex-1 border-l border-line pl-3">
            <span className="block truncate text-sm font-semibold text-ink">
              {naam}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted">
              {afspraak.adviseurs?.naam || "—"}
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
      title={`${formatTimeNl(afspraak.start_at)} · ${naam}`}
      className={[
        "group w-full rounded-lg border border-transparent border-l-[3px] px-2 py-1.5 text-left transition",
        statusAccent(afspraak.status),
        "hover:brightness-[0.98] hover:shadow-sm",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-green",
        cancelled ? "opacity-50 line-through" : "",
      ].join(" ")}
    >
      <span className="block text-[11px] font-bold tabular-nums leading-none text-green-dark">
        {formatTimeNl(afspraak.start_at)}
      </span>
      <span className="mt-1 block truncate text-[12px] font-semibold leading-tight text-ink">
        {naam}
      </span>
    </button>
  );
}

function AfspraakDetail({
  afspraak,
  onClose,
}: {
  afspraak: Afspraak;
  onClose: () => void;
}) {
  const note = appointmentNote(afspraak);
  const mailed = Boolean(afspraak.bevestiging_verstuurd);
  const lead = afspraak.leads;
  const adres = mapsQueryFromLead(lead);
  const straatNr = lead
    ? [lead.straat, [lead.huisnummer, lead.toevoeging].filter(Boolean).join("")]
        .filter(Boolean)
        .join(" ")
    : "";
  const postcodePlaats = lead
    ? [lead.postcode, lead.plaats].filter(Boolean).join(" ")
    : "";

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="afspraak-detail-title"
      className="fixed inset-0 z-50 flex flex-col bg-wash"
    >
      <header className="shrink-0 border-b border-line bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Afspraak
            </p>
            <h2
              id="afspraak-detail-title"
              className="mt-0.5 font-display text-xl font-semibold capitalize text-ink sm:text-2xl"
            >
              {formatDateTimeLongNl(afspraak.start_at)}
            </h2>
            <p className="mt-1 text-sm tabular-nums text-muted">
              {formatTimeNl(afspraak.start_at)} – {formatTimeNl(afspraak.end_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line text-lg text-muted hover:bg-wash hover:text-ink"
            aria-label="Sluiten"
          >
            ×
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="afspraak" value={afspraak.status} />
            {mailed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-soft px-2 py-0.5 text-[11px] font-semibold text-green-dark">
                Mail verstuurd
              </span>
            )}
          </div>

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
                    className="flex min-h-12 items-center justify-center rounded-xl bg-[#33CCFF] px-4 py-3 text-sm font-bold text-[#0A2A3A] hover:brightness-95"
                  >
                    Open in Waze
                  </a>
                  <a
                    href={googleMapsUrl(adres)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-12 items-center justify-center rounded-xl bg-green px-4 py-3 text-sm font-bold text-white hover:bg-green-dark"
                  >
                    Open in Google Maps
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
              {afspraak.adviseurs?.naam || "—"}
            </p>
          </section>

          {(jaNeeLabel(afspraak.partner_aanwezig) ||
            jaNeeLabel(afspraak.andere_offertes_gehad)) && (
            <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(13,92,50,0.04)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Checks
              </p>
              <dl className="mt-3 space-y-2 text-sm">
                {jaNeeLabel(afspraak.partner_aanwezig) && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted">Partner aanwezig</dt>
                    <dd className="font-semibold text-ink">
                      {jaNeeLabel(afspraak.partner_aanwezig)}
                    </dd>
                  </div>
                )}
                {jaNeeLabel(afspraak.andere_offertes_gehad) && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted">Andere offertes gehad</dt>
                    <dd className="font-semibold text-ink">
                      {jaNeeLabel(afspraak.andere_offertes_gehad)}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          {note ? (
            <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(13,92,50,0.04)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Notitie
              </p>
              <p className="mt-2 whitespace-pre-wrap rounded-xl bg-wash px-3.5 py-3 text-sm leading-relaxed text-ink">
                {note}
              </p>
            </section>
          ) : null}
        </div>
      </div>

      <footer className="shrink-0 border-t border-line bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 sm:flex-row-reverse">
          <Link
            href={`/leads/${afspraak.lead_id}`}
            className="flex min-h-12 flex-1 items-center justify-center bg-green px-4 py-3 text-sm font-semibold text-white hover:bg-green-dark"
          >
            Naar lead
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-12 flex-1 items-center justify-center border border-line px-4 py-3 text-sm font-semibold text-muted hover:bg-wash"
          >
            Sluiten
          </button>
        </div>
      </footer>
    </div>
  );
}

export function AgendaPanel({
  leads,
  defaultAdviseurId,
}: {
  leads: Lead[];
  defaultAdviseurId?: string;
}) {
  const [afspraken, setAfspraken] = useState<Afspraak[]>([]);
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [slots, setSlots] = useState<{ start_at: string; end_at: string }[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedAfspraak, setSelectedAfspraak] = useState<Afspraak | null>(
    null
  );

  const [leadId, setLeadId] = useState("");
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

  const days = useMemo(() => weekDaysFrom(weekAnchor), [weekAnchor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, adv] = await Promise.all([
        fetch("/api/afspraken").then((r) => r.json()),
        fetch("/api/adviseurs").then((r) => r.json()),
      ]);
      if (a.error) throw new Error(a.error);
      if (adv.error) throw new Error(adv.error);
      setAfspraken(a.afspraken || []);
      setAdviseurs(adv.adviseurs || []);
      setAdviseurId((prev) => {
        if (prev) return prev;
        if (defaultAdviseurId) return defaultAdviseurId;
        return adv.adviseurs?.[0]?.id || "";
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [defaultAdviseurId]);

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
      if (!cancelled) setSlots(data.slots || []);
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
        if (a.status === "geannuleerd") {
          return new Date(a.start_at) >= new Date();
        }
        if (new Date(a.start_at) < new Date()) return false;
        return true;
      }),
    [afspraken, defaultAdviseurId]
  );

  /** Alle afspraken in de zichtbare week */
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

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === leadId) || null,
    [leads, leadId]
  );

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

  async function plan(e: React.FormEvent) {
    e.preventDefault();
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
      if (partnerAanwezig === null) {
        throw new Error("Beantwoord: Partner aanwezig?");
      }
      if (andereOffertes === null) {
        throw new Error("Beantwoord: Andere offertes al gehad?");
      }

      const res = await fetch("/api/afspraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          adviseur_id: adviseurId,
          start_at: resolvedStart,
          notities: notities || undefined,
          partner_aanwezig: partnerAanwezig,
          andere_offertes_gehad: andereOffertes,
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
        setOkMsg("Afspraak gepland.");
      }
      setStartAt("");
      setCustomStart("");
      setNotities("");
      setPartnerAanwezig(null);
      setAndereOffertes(null);
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
      <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
        Lead
        <select
          required
          value={leadId}
          onChange={(e) => {
            setLeadId(e.target.value);
            setNotities("");
          }}
          className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green sm:py-2"
        >
          <option value="">Kies lead…</option>
          {leads.map((l) => (
            <option key={l.id} value={l.id}>
              {l.naam} ({l.lead_number})
            </option>
          ))}
        </select>
      </label>

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
          {adviseurs.map((a) => (
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
            {slots.slice(0, 80).map((s) => (
              <option key={s.start_at} value={s.start_at}>
                {formatDateTimeNl(s.start_at)}
              </option>
            ))}
          </select>
        )}
      </div>

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
          saving || partnerAanwezig === null || andereOffertes === null
        }
        className="min-h-11 w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60 sm:min-h-0"
      >
        {saving ? "Bezig…" : "Afspraak plannen"}
      </button>
    </form>
  );

  return (
    <div className="grid gap-0 lg:grid-cols-[300px_1fr]">
      {/* Desktop form */}
      <aside className="hidden border-b border-line p-5 lg:block lg:border-b-0 lg:border-r">
        <h2 className="font-display text-base font-semibold text-ink">
          Nieuwe afspraak
        </h2>
        <p className="mt-1 text-xs text-muted">
          Koppel een lead aan een adviseur en kies een slot.
        </p>
        <div className="mt-4">{planForm}</div>
      </aside>

      <div className="min-w-0">
        {/* Mobile: plan knop + sheet */}
        <div className="border-b border-line px-3 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setFormOpen((v) => !v)}
            className="min-h-11 w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c]"
          >
            {formOpen ? "Sluiten" : "Nieuwe afspraak"}
          </button>
          {formOpen && <div className="mt-4">{planForm}</div>}
        </div>

        {/* Week navigatie */}
        <div className="sticky top-0 z-10 border-b border-line bg-white/95 px-3 py-3 backdrop-blur sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setWeekAnchor((d) => addWeeks(d, -1))}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink hover:bg-wash"
                aria-label="Vorige week"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setWeekAnchor((d) => addWeeks(d, 1))}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink hover:bg-wash"
                aria-label="Volgende week"
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
            </div>
            <div className="min-w-0 text-right">
              <p className="truncate font-display text-sm font-semibold capitalize text-ink sm:text-base">
                {formatWeekRange(days)}
              </p>
              <p className="text-[11px] capitalize text-muted">
                {formatMonthYear(days[0].date)}
                {upcoming.length > 0
                  ? ` · ${upcoming.length} aankomend`
                  : ""}
              </p>
            </div>
          </div>

          {/* Dag-strip (mobiel + tablet) */}
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
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
                    "flex min-w-[3.25rem] flex-col items-center rounded-xl px-2 py-2 transition",
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
        ) : (
          <>
            {/* Mobiel: geselecteerde dag */}
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
                    return (
                      <div
                        key={day.key}
                        className={[
                          "border-r border-line px-1.5 py-3 last:border-r-0 sm:px-2",
                          isToday ? "bg-green-soft/50" : "",
                        ].join(" ")}
                      >
                        <p
                          className={[
                            "text-[10px] font-semibold uppercase tracking-wide",
                            isToday ? "text-green" : "text-muted",
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
                      </div>
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
          onClose={() => setSelectedAfspraak(null)}
        />
      )}
    </div>
  );
}
