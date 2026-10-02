"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addDays, addWeeks, format, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type { InstallatiePartner, Project } from "@/types/database";
import {
  AMSTERDAM_TZ,
  adresRegel,
  formatDateShort,
  formatDateTimeNl,
  formatTimeNl,
} from "@/lib/format";
import { projectStatusLabel, normalizeProjectStatus } from "@/lib/labels";
import { isSchouwFormulier } from "@/lib/project-documenten";
import {
  agendaWeekJumpOptions,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";

type PlanSoort = "schouwweek" | "schouwdag" | "installatie";

type PlanbordBar = {
  key: string;
  project: Project;
  kind: "schouwweek" | "schouw" | "installatie";
  /** Inclusive day keys in the visible week */
  dayKeys: string[];
  label: string;
  /** Exacte datum/tijd voor weergave */
  whenLabel: string | null;
  partnerId: string | null;
};

type DayCol = { key: string; date: Date; weekend: boolean };

/** Geannuleerde orders horen niet op het planbord. */
function isActiefOpPlanbord(p: Project): boolean {
  return normalizeProjectStatus(p.status) !== "annulering";
}

function leadOf(p: Project) {
  return Array.isArray(p.leads) ? p.leads[0] : p.leads;
}

function partnerOf(p: Project) {
  return Array.isArray(p.installatie_partners)
    ? p.installatie_partners[0]
    : p.installatie_partners;
}

function weekDaysFrom(anchor: Date): DayCol[] {
  const local = toZonedTime(anchor, AMSTERDAM_TZ);
  const monday = startOfWeek(local, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const dow = date.getDay();
    return {
      key: format(date, "yyyy-MM-dd"),
      date,
      weekend: dow === 0 || dow === 6,
    };
  });
}

function dayKeyAmsterdam(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultDatetimeForDay(dayKey: string, hour = 9): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const local = new Date(y, m - 1, d, hour, 0, 0, 0);
  return toDatetimeLocalValue(local);
}

function projectTitle(p: Project): string {
  const lead = leadOf(p);
  return p.titel?.trim() || lead?.naam || p.project_nummer || "Project";
}

function projectSearchText(p: Project): string {
  const lead = leadOf(p);
  const adres = lead ? adresRegel(lead) : "";
  return [
    p.project_nummer,
    p.titel,
    lead?.naam,
    lead?.plaats,
    lead?.straat,
    lead?.postcode,
    adres,
    partnerOf(p)?.naam,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function barsForWeek(
  projects: Project[],
  days: DayCol[],
  weekInfo: { jaar: number; week: number }
): PlanbordBar[] {
  if (!days.length) return [];
  const daySet = new Set(days.map((d) => d.key));
  const bars: PlanbordBar[] = [];

  for (const p of projects) {
    if (!isActiefOpPlanbord(p)) continue;
    const partnerId = p.installatie_partner_id || partnerOf(p)?.id || null;
    const title = projectTitle(p);

    if (p.schouw_at) {
      const key = dayKeyAmsterdam(p.schouw_at);
      if (daySet.has(key)) {
        bars.push({
          key: `${p.id}-schouw`,
          project: p,
          kind: "schouw",
          dayKeys: [key],
          label: `Schouw · ${formatTimeNl(p.schouw_at)} · ${title}`,
          whenLabel: formatDateTimeNl(p.schouw_at),
          partnerId,
        });
      }
    } else if (
      p.schouw_jaar === weekInfo.jaar &&
      p.schouw_week === weekInfo.week
    ) {
      bars.push({
        key: `${p.id}-schouwweek`,
        project: p,
        kind: "schouwweek",
        dayKeys: days.map((d) => d.key),
        label: `Schouwweek · ${title}`,
        whenLabel: `Week ${p.schouw_week} · ${p.schouw_jaar}`,
        partnerId,
      });
    }

    if (p.installatie_at) {
      const key = dayKeyAmsterdam(p.installatie_at);
      if (daySet.has(key)) {
        bars.push({
          key: `${p.id}-installatie`,
          project: p,
          kind: "installatie",
          dayKeys: [key],
          label: `Installatie · ${formatTimeNl(p.installatie_at)} · ${title}`,
          whenLabel: formatDateTimeNl(p.installatie_at),
          partnerId,
        });
      }
    }
  }

  return bars;
}

const KIND_STYLE: Record<
  PlanbordBar["kind"],
  { bg: string; text: string; border: string }
> = {
  schouwweek: {
    bg: "bg-green-soft",
    text: "text-green-deeper",
    border: "border-green/40",
  },
  schouw: {
    bg: "bg-green-soft",
    text: "text-green-deeper",
    border: "border-green/50",
  },
  installatie: {
    bg: "bg-[#FFF0E6]",
    text: "text-[#C45A12]",
    border: "border-[#F37021]/40",
  },
};

function mailSummary(mails: {
  klant?: { ok?: boolean; skipped?: boolean; error?: string };
  partner?: { ok?: boolean; skipped?: boolean; error?: string };
}): { ok: string; warn: string | null } {
  const parts: string[] = [];
  const warns: string[] = [];
  if (mails.klant?.ok) parts.push("klant");
  else if (mails.klant?.skipped)
    warns.push(mails.klant.error || "geen klantmail");
  else if (mails.klant?.error) warns.push(`klant: ${mails.klant.error}`);

  if (mails.partner?.ok) parts.push("installateur");
  else if (mails.partner?.skipped)
    warns.push(mails.partner.error || "geen partnermail");
  else if (mails.partner?.error) warns.push(`partner: ${mails.partner.error}`);

  return {
    ok:
      parts.length > 0
        ? `Bevestiging verstuurd naar ${parts.join(" + ")}.`
        : "Afspraak opgeslagen.",
    warn: warns.length ? warns.join(" · ") : null,
  };
}

function PlanInplannenPanel({
  open,
  dayKey,
  defaultPartnerId,
  projects,
  partners,
  onClose,
  onSaved,
}: {
  open: boolean;
  dayKey: string | null;
  defaultPartnerId: string | null;
  projects: Project[];
  partners: InstallatiePartner[];
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [soort, setSoort] = useState<PlanSoort>("schouwdag");
  const [partnerId, setPartnerId] = useState("");
  const [datetimeLocal, setDatetimeLocal] = useState("");
  const [schouwWeek, setSchouwWeek] = useState("");
  const [notities, setNotities] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!open || !dayKey) return;
    setQuery("");
    setSelectedId(null);
    setSoort("schouwdag");
    setPartnerId(defaultPartnerId || "");
    setDatetimeLocal(defaultDatetimeForDay(dayKey, 9));
    const w = schouwWeekFromDate(dayKey + "T12:00:00");
    setSchouwWeek(schouwWeekValue(w.jaar, w.week));
    setNotities("");
    setError(null);
    setPickerOpen(true);
  }, [open, dayKey, defaultPartnerId]);

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) || null,
    [projects, selectedId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects.slice(0, 40);
    return projects
      .filter((p) => projectSearchText(p).includes(q))
      .slice(0, 40);
  }, [projects, query]);

  useEffect(() => {
    if (!selected) return;
    if (!partnerId && selected.installatie_partner_id) {
      setPartnerId(selected.installatie_partner_id);
    }
  }, [selected, partnerId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      setError("Kies een project");
      return;
    }
    if (!partnerId) {
      setError("Kies een installatiepartner");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (soort === "schouwweek" || soort === "schouwdag") {
        const payload: Record<string, unknown> = {
          installatie_partner_id: partnerId,
          schouw_notities: notities.trim() || null,
        };
        if (soort === "schouwdag") {
          if (!datetimeLocal.trim()) throw new Error("Kies schouwdatum + tijd");
          const parsed = new Date(datetimeLocal);
          if (Number.isNaN(parsed.getTime())) {
            throw new Error("Ongeldige schouwdatum");
          }
          payload.schouw_at = parsed.toISOString();
          const derived = schouwWeekFromDate(parsed);
          payload.schouw_jaar = derived.jaar;
          payload.schouw_week = derived.week;
        } else {
          const opt = parseSchouwWeekValue(schouwWeek);
          if (!opt) throw new Error("Kies een schouwweek");
          payload.schouw_jaar = opt.jaar;
          payload.schouw_week = opt.week;
        }
        const res = await fetch(`/api/projecten/${selected.id}/schouw`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Inplannen mislukt"
          );
        }
        const summary = mailSummary(
          (data as { mails?: Parameters<typeof mailSummary>[0] }).mails || {}
        );
        if (summary.warn) setError(summary.warn);
        onSaved((data as { project: Project }).project);
        onClose();
        return;
      }

      if (!datetimeLocal.trim()) {
        throw new Error("Kies installatiedatum + tijd");
      }
      const parsed = new Date(datetimeLocal);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error("Ongeldige installatiedatum");
      }
      const res = await fetch(`/api/projecten/${selected.id}/installatie`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installatie_at: parsed.toISOString(),
          installatie_partner_id: partnerId,
          installatie_notities: notities.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Inplannen mislukt"
        );
      }
      const summary = mailSummary(
        (data as { mails?: Parameters<typeof mailSummary>[0] }).mails || {}
      );
      if (summary.warn) setError(summary.warn);
      onSaved((data as { project: Project }).project);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const lead = selected ? leadOf(selected) : null;
  const status = selected
    ? normalizeProjectStatus(selected.status)
    : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Sluiten"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-3xl flex-col border-l border-line bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">
              Project inplannen
            </h2>
            {dayKey ? (
              <p className="mt-0.5 text-xs text-muted">
                {formatDateShort(dayKey + "T12:00:00")}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-line px-2.5 py-1.5 text-sm text-muted hover:bg-wash"
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={(e) => void submit(e)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1fr_16rem]">
            <div className="space-y-4 overflow-auto border-b border-line p-5 lg:border-b-0 lg:border-r">
              <div className="relative">
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Project *
                </label>
                <input
                  value={
                    selected && !pickerOpen
                      ? projectTitle(selected)
                      : query
                  }
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPickerOpen(true);
                    if (selected) setSelectedId(null);
                  }}
                  onFocus={() => setPickerOpen(true)}
                  placeholder="Zoeken…"
                  className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                />
                {pickerOpen && (
                  <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto border border-line bg-white shadow-lg">
                    {filtered.length === 0 ? (
                      <li className="px-3 py-3 text-sm text-muted">
                        Geen projecten gevonden.
                      </li>
                    ) : (
                      filtered.map((p) => {
                        const l = leadOf(p);
                        return (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedId(p.id);
                                setQuery("");
                                setPickerOpen(false);
                              }}
                              className="w-full border-b border-line px-3 py-2.5 text-left hover:bg-wash"
                            >
                              <p className="text-sm font-semibold text-ink">
                                {projectTitle(p)}
                              </p>
                              <p className="truncate text-xs text-muted">
                                {p.project_nummer}
                                {l ? ` · ${adresRegel(l)}` : ""}
                              </p>
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                )}
              </div>

              <fieldset>
                <legend className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Type
                </legend>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {(
                    [
                      ["schouwweek", "Schouwweek"],
                      ["schouwdag", "Schouwdag"],
                      ["installatie", "Installatie"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSoort(id)}
                      className={[
                        "border px-2 py-2 text-xs font-semibold",
                        soort === id
                          ? "border-green bg-green-soft text-green-deeper"
                          : "border-line text-muted hover:bg-wash",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {soort === "schouwweek" ? (
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Schouwweek
                  <select
                    value={schouwWeek}
                    onChange={(e) => setSchouwWeek(e.target.value)}
                    className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                    required
                  >
                    {agendaWeekJumpOptions(4, 40).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  {soort === "schouwdag"
                    ? "Schouwdatum + tijd"
                    : "Installatiedatum + tijd"}
                  <input
                    type="datetime-local"
                    value={datetimeLocal}
                    onChange={(e) => setDatetimeLocal(e.target.value)}
                    required
                    className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                  />
                </label>
              )}

              <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Installatiepartner *
                <select
                  value={partnerId}
                  onChange={(e) => setPartnerId(e.target.value)}
                  required
                  className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                >
                  <option value="">Kies…</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.naam}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Label / notities
                <input
                  value={notities}
                  onChange={(e) => setNotities(e.target.value)}
                  placeholder="Optioneel"
                  className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                />
              </label>

              {error ? (
                <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="overflow-auto bg-wash p-4">
              {!selected ? (
                <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 px-2 text-center">
                  <p className="text-sm text-muted">
                    Selecteer een project om de details te zien
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="border border-line bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="font-display text-base font-semibold text-ink">
                        {projectTitle(selected)}
                      </h3>
                      {status ? (
                        <span className="bg-[#FFF0E6] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#C45A12]">
                          {projectStatusLabel[status]}
                        </span>
                      ) : null}
                    </div>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Klant
                        </dt>
                        <dd className="text-ink">{lead?.naam || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Locatie
                        </dt>
                        <dd className="text-ink">
                          {lead ? adresRegel(lead) : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Nummer
                        </dt>
                        <dd className="tabular-nums text-ink">
                          {selected.project_nummer}
                        </dd>
                      </div>
                    </dl>
                    <Link
                      href={`/projecten/${selected.id}?from=agenda`}
                      className="mt-4 inline-block text-sm font-semibold text-green-deeper hover:underline"
                    >
                      Open project →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-wash"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={busy || !selected}
              className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-50"
            >
              {busy ? "Bezig…" : "Opslaan"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function CopyField({
  value,
  label,
  href,
}: {
  value: string;
  label: string;
  href?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      {href ? (
        <a
          href={href}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 truncate underline decoration-transparent hover:decoration-current"
          title={`${label}: ${value}`}
        >
          {value}
        </a>
      ) : (
        <span className="min-w-0 truncate" title={`${label}: ${value}`}>
          {value}
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        className="shrink-0 border border-current/20 bg-white/70 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide hover:bg-white"
        title={`${label} kopiëren`}
      >
        {copied ? "✓" : "Kopieer"}
      </button>
    </div>
  );
}

type SchouwDocInfo = {
  url: string;
  bestandsnaam: string | null;
};

function BarChip({
  bar,
  href,
  schouwDoc,
}: {
  bar: PlanbordBar;
  href: string;
  schouwDoc?: SchouwDocInfo | null;
}) {
  const style = KIND_STYLE[bar.kind];
  const lead = leadOf(bar.project);
  const tel = lead?.telefoon?.trim() || null;
  const email = lead?.email?.trim() || null;
  const isSchouwBar = bar.kind === "schouw" || bar.kind === "schouwweek";
  const kindLabel =
    bar.kind === "installatie"
      ? "Installatie"
      : bar.kind === "schouwweek"
        ? "Schouwweek"
        : "Schouw";

  return (
    <div
      className={[
        "border px-1.5 py-1.5 text-[10px] leading-tight",
        style.bg,
        style.text,
        style.border,
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="min-w-0 font-semibold">
          {kindLabel}
          {bar.whenLabel ? (
            <span className="font-medium"> · {bar.whenLabel}</span>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {isSchouwBar ? (
            schouwDoc?.url ? (
              <a
                href={schouwDoc.url}
                target="_blank"
                rel="noreferrer"
                download={schouwDoc.bestandsnaam || "schouwformulier.pdf"}
                onClick={(e) => e.stopPropagation()}
                className="border border-current/25 bg-white/80 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide hover:bg-white"
                title="Schouwformulier downloaden"
              >
                PDF
              </a>
            ) : (
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#C45A12]/40 bg-[#FFF0E6] text-[9px] font-bold text-[#C45A12]"
                title="Schouwformulier ontbreekt — nog uploaden"
              >
                I
              </span>
            )
          ) : null}
          <Link
            href={href}
            className="text-[9px] font-semibold underline decoration-transparent hover:decoration-current"
            title="Open project"
          >
            Open
          </Link>
        </div>
      </div>
      <p
        className="mt-0.5 truncate font-medium opacity-90"
        title={projectTitle(bar.project)}
      >
        {projectTitle(bar.project)}
      </p>
      {tel || email ? (
        <div className="mt-1 space-y-0.5 font-medium opacity-95">
          {tel ? (
            <CopyField value={tel} label="Telefoon" href={`tel:${tel}`} />
          ) : null}
          {email ? (
            <CopyField value={email} label="E-mail" href={`mailto:${email}`} />
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-[9px] opacity-70">Geen tel/e-mail</p>
      )}
    </div>
  );
}

function ProjectContactAside({ project }: { project: Project }) {
  const lead = leadOf(project);
  const tel = lead?.telefoon?.trim() || null;
  const email = lead?.email?.trim() || null;
  return (
    <div className="border-r border-line px-3 py-2">
      <p className="truncate text-xs font-semibold text-ink">
        {projectTitle(project)}
      </p>
      <p className="truncate text-[10px] text-muted">{project.project_nummer}</p>
      {tel || email ? (
        <div className="mt-1.5 space-y-1 text-[10px] text-ink">
          {tel ? (
            <CopyField value={tel} label="Telefoon" href={`tel:${tel}`} />
          ) : null}
          {email ? (
            <CopyField value={email} label="E-mail" href={`mailto:${email}`} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Planbord({
  projecten,
  onProjectUpdated,
}: {
  projecten: Project[];
  onProjectUpdated?: (project: Project) => void;
}) {
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [peopleOpen, setPeopleOpen] = useState(true);
  const [planOpen, setPlanOpen] = useState(false);
  const [planDayKey, setPlanDayKey] = useState<string | null>(null);
  const [planPartnerId, setPlanPartnerId] = useState<string | null>(null);
  const [localProjects, setLocalProjects] = useState(projecten);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [schouwDocs, setSchouwDocs] = useState<
    Record<string, SchouwDocInfo | null>
  >({});

  useEffect(() => {
    setLocalProjects(projecten);
  }, [projecten]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/installatie-partners");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setPartners((data.partners as InstallatiePartner[]) || []);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const days = useMemo(() => weekDaysFrom(weekAnchor), [weekAnchor]);
  const weekInfo = useMemo(() => schouwWeekFromDate(weekAnchor), [weekAnchor]);
  const weekJumpOptions = useMemo(() => agendaWeekJumpOptions(8, 40), []);
  const monthLabel = useMemo(
    () =>
      formatInTimeZone(
        fromZonedTime(
          new Date(
            Number(days[0]?.key.slice(0, 4)),
            Number(days[0]?.key.slice(5, 7)) - 1,
            Number(days[0]?.key.slice(8, 10)),
            12,
            0,
            0
          ),
          AMSTERDAM_TZ
        ),
        AMSTERDAM_TZ,
        "MMMM yyyy",
        { locale: nl }
      ),
    [days]
  );

  const planProjects = useMemo(
    () => localProjects.filter(isActiefOpPlanbord),
    [localProjects]
  );

  const bars = useMemo(
    () => barsForWeek(planProjects, days, weekInfo),
    [planProjects, days, weekInfo]
  );

  const schouwProjectIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const bar of bars) {
      if (bar.kind === "schouw" || bar.kind === "schouwweek") {
        ids.add(bar.project.id);
      }
    }
    return [...ids].sort().join(",");
  }, [bars]);

  useEffect(() => {
    const schouwProjectIds = schouwProjectIdsKey
      ? schouwProjectIdsKey.split(",")
      : [];
    if (schouwProjectIds.length === 0) {
      setSchouwDocs({});
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        schouwProjectIds.map(async (id) => {
          try {
            const res = await fetch(`/api/projecten/${id}/fotos`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) return [id, null] as const;
            const fotos = (data.fotos || []) as Array<{
              omschrijving: string | null;
              url: string | null;
              bestandsnaam: string | null;
              created_at: string;
            }>;
            const docs = fotos
              .filter((f) => isSchouwFormulier(f.omschrijving) && f.url)
              .sort((a, b) => a.created_at.localeCompare(b.created_at));
            const first = docs[0];
            return [
              id,
              first?.url
                ? { url: first.url, bestandsnaam: first.bestandsnaam }
                : null,
            ] as const;
          } catch {
            return [id, null] as const;
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, SchouwDocInfo | null> = {};
      for (const [id, doc] of entries) next[id] = doc;
      setSchouwDocs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [schouwProjectIdsKey]);

  const projectBars = useMemo(() => bars, [bars]);

  const barsByPartnerDay = useMemo(() => {
    const map = new Map<string, PlanbordBar[]>();
    for (const bar of bars) {
      if (!bar.partnerId) continue;
      for (const dayKey of bar.dayKeys) {
        const k = `${bar.partnerId}:${dayKey}`;
        const list = map.get(k) || [];
        list.push(bar);
        map.set(k, list);
      }
    }
    return map;
  }, [bars]);

  const barsByProjectDay = useMemo(() => {
    const map = new Map<string, PlanbordBar[]>();
    for (const bar of projectBars) {
      for (const dayKey of bar.dayKeys) {
        // Only show single-day bars in day cells; week bars handled separately
        if (bar.kind === "schouwweek") continue;
        const k = `${bar.project.id}:${dayKey}`;
        const list = map.get(k) || [];
        list.push(bar);
        map.set(k, list);
      }
    }
    return map;
  }, [projectBars]);

  const weekOnlyBars = useMemo(
    () => projectBars.filter((b) => b.kind === "schouwweek"),
    [projectBars]
  );

  const openPlan = useCallback((dayKey: string, partnerId?: string | null) => {
    setPlanDayKey(dayKey);
    setPlanPartnerId(partnerId || null);
    setPlanOpen(true);
    setOkMsg(null);
  }, []);

  function handleSaved(updated: Project) {
    setLocalProjects((prev) => {
      const idx = prev.findIndex((p) => p.id === updated.id);
      if (idx < 0) return [updated, ...prev];
      const next = [...prev];
      next[idx] = { ...next[idx], ...updated };
      return next;
    });
    onProjectUpdated?.(updated);
    setOkMsg("Project ingepland");
  }

  const gridCols = `minmax(12.5rem, 16rem) repeat(7, minmax(7rem, 1fr))`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-white px-4 py-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            Planbord
          </h2>
          <p className="mt-0.5 text-sm capitalize text-muted">
            {monthLabel} · KW {weekInfo.week}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekAnchor((d) => addWeeks(d, -1))}
            className="flex h-9 w-9 items-center justify-center border border-line hover:bg-wash"
            aria-label="Vorige week"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setWeekAnchor(new Date())}
            className="border border-line px-3 py-1.5 text-xs font-semibold hover:bg-wash"
          >
            Vandaag
          </button>
          <button
            type="button"
            onClick={() => setWeekAnchor((d) => addWeeks(d, 1))}
            className="flex h-9 w-9 items-center justify-center border border-line hover:bg-wash"
            aria-label="Volgende week"
          >
            ›
          </button>
          <select
            value={schouwWeekValue(weekInfo.jaar, weekInfo.week)}
            onChange={(e) => {
              const p = parseSchouwWeekValue(e.target.value);
              if (!p) return;
              setWeekAnchor(new Date(schouwWeekToMondayIso(p.jaar, p.week)));
            }}
            className="min-h-9 border border-line bg-white px-2 text-xs font-semibold"
          >
            {weekJumpOptions.map((o) => (
              <option key={o.value} value={o.value}>
                W{o.week} · {o.jaar}
              </option>
            ))}
          </select>
        </div>
      </div>

      {okMsg ? (
        <p className="border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
          {okMsg}
        </p>
      ) : null}

      <div className="overflow-x-auto border border-line bg-white">
        <div className="min-w-[52rem]">
          {/* Day headers */}
          <div
            className="sticky top-0 z-10 grid border-b border-line bg-white"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div className="border-r border-line bg-[#FAFBFA] px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                {monthLabel}
              </p>
              <p className="text-xs font-semibold text-ink">
                KW {weekInfo.week}
              </p>
            </div>
            {days.map((d) => (
              <div
                key={d.key}
                className={[
                  "border-r border-line px-2 py-2.5 text-center last:border-r-0",
                  d.weekend ? "bg-[#F3F4F6]" : "bg-white",
                ].join(" ")}
              >
                <p className="text-[10px] font-semibold uppercase text-muted">
                  {format(d.date, "EEE", { locale: nl })}
                </p>
                <p className="text-sm font-semibold tabular-nums text-ink">
                  {format(d.date, "d")}
                </p>
              </div>
            ))}
          </div>

          {/* Projecten section */}
          <div className="border-b border-line">
            <div
              className="grid items-center bg-[#F9FAFB]"
              style={{ gridTemplateColumns: gridCols }}
            >
              <div className="flex items-center justify-between gap-2 border-r border-line px-3 py-2">
                <button
                  type="button"
                  onClick={() => setProjectsOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-sm font-semibold text-ink"
                >
                  <span className="text-xs text-muted">
                    {projectsOpen ? "▾" : "▸"}
                  </span>
                  Projecten
                </button>
                <button
                  type="button"
                  onClick={() => openPlan(days[0]?.key || dayKeyAmsterdam(new Date()))}
                  className="text-sm font-semibold text-muted hover:text-green-deeper"
                  title="Project inplannen"
                >
                  +
                </button>
              </div>
              {days.map((d) => (
                <div
                  key={`ph-${d.key}`}
                  className={[
                    "min-h-[2.25rem] border-r border-line last:border-r-0",
                    d.weekend ? "bg-[#F3F4F6]" : "",
                  ].join(" ")}
                />
              ))}
            </div>

            {projectsOpen && weekOnlyBars.length > 0 ? (
              <div className="space-y-1 border-b border-line bg-white px-2 py-2">
                {weekOnlyBars.map((bar) => (
                  <BarChip
                    key={bar.key}
                    bar={bar}
                    href={`/projecten/${bar.project.id}?from=agenda`}
                    schouwDoc={schouwDocs[bar.project.id]}
                  />
                ))}
              </div>
            ) : null}

            {projectsOpen
              ? planProjects
                  .filter((p) =>
                    projectBars.some(
                      (b) => b.project.id === p.id && b.kind !== "schouwweek"
                    )
                  )
                  .map((p) => (
                    <div
                      key={p.id}
                      className="grid border-b border-line last:border-b-0"
                      style={{ gridTemplateColumns: gridCols }}
                    >
                      <ProjectContactAside project={p} />
                      {days.map((d) => {
                        const cellBars =
                          barsByProjectDay.get(`${p.id}:${d.key}`) || [];
                        return (
                          <div
                            key={`${p.id}-${d.key}`}
                            className={[
                              "group relative min-h-[4.5rem] border-r border-line p-1 last:border-r-0",
                              d.weekend ? "bg-[#F3F4F6]/80" : "",
                            ].join(" ")}
                          >
                            {cellBars.length > 0 ? (
                              <div className="space-y-1">
                                {cellBars.map((bar) => (
                                  <BarChip
                                    key={bar.key}
                                    bar={bar}
                                    href={`/projecten/${bar.project.id}?from=agenda`}
                                    schouwDoc={schouwDocs[bar.project.id]}
                                  />
                                ))}
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  openPlan(d.key, p.installatie_partner_id)
                                }
                                className="flex h-full min-h-[2.25rem] w-full items-center justify-center text-transparent hover:bg-wash hover:text-muted"
                                title="Inplannen"
                              >
                                +
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))
              : null}

            {projectsOpen &&
            planProjects.filter((p) =>
              projectBars.some(
                (b) => b.project.id === p.id && b.kind !== "schouwweek"
              )
            ).length === 0 &&
            weekOnlyBars.length === 0 ? (
              <div
                className="grid border-b border-line"
                style={{ gridTemplateColumns: gridCols }}
              >
                <div className="border-r border-line px-3 py-4 text-xs text-muted">
                  Geen projecten deze week
                </div>
                {days.map((d) => (
                  <div
                    key={`empty-p-${d.key}`}
                    className={[
                      "min-h-[2.75rem] border-r border-line p-1 last:border-r-0",
                      d.weekend ? "bg-[#F3F4F6]/80" : "",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      onClick={() => openPlan(d.key)}
                      className="flex h-full min-h-[2.25rem] w-full items-center justify-center text-[#9CA3AF] hover:bg-wash hover:text-ink"
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Medewerkers section */}
          <div>
            <div
              className="grid items-center bg-[#F9FAFB]"
              style={{ gridTemplateColumns: gridCols }}
            >
              <div className="flex items-center justify-between gap-2 border-r border-line px-3 py-2">
                <button
                  type="button"
                  onClick={() => setPeopleOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-sm font-semibold text-ink"
                >
                  <span className="text-xs text-muted">
                    {peopleOpen ? "▾" : "▸"}
                  </span>
                  Medewerkers
                </button>
              </div>
              {days.map((d) => (
                <div
                  key={`mh-${d.key}`}
                  className={[
                    "min-h-[2.25rem] border-r border-line last:border-r-0",
                    d.weekend ? "bg-[#F3F4F6]" : "",
                  ].join(" ")}
                />
              ))}
            </div>

            {peopleOpen &&
              partners.map((partner) => (
                <div
                  key={partner.id}
                  className="grid border-b border-line last:border-b-0"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <div className="border-r border-line px-3 py-2">
                    <p className="truncate text-xs font-semibold text-ink">
                      {partner.naam}
                    </p>
                  </div>
                  {days.map((d) => {
                    const cellBars =
                      barsByPartnerDay.get(`${partner.id}:${d.key}`) || [];
                    return (
                      <div
                        key={`${partner.id}-${d.key}`}
                        className={[
                          "group relative min-h-[4.5rem] border-r border-line p-1 last:border-r-0",
                          d.weekend ? "bg-[#F3F4F6]/80" : "",
                        ].join(" ")}
                      >
                        {cellBars.length > 0 ? (
                          <div className="space-y-1">
                            {cellBars.map((bar) => (
                              <BarChip
                                key={bar.key}
                                bar={bar}
                                href={`/projecten/${bar.project.id}?from=agenda`}
                                schouwDoc={schouwDocs[bar.project.id]}
                              />
                            ))}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openPlan(d.key, partner.id)}
                            className="flex h-full min-h-[3.5rem] w-full items-center justify-center text-transparent hover:bg-wash hover:text-muted"
                            title="Project inplannen"
                          >
                            +
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

            {peopleOpen && partners.length === 0 ? (
              <p className="px-3 py-6 text-sm text-muted">
                Geen actieve installatiepartners.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <PlanInplannenPanel
        open={planOpen}
        dayKey={planDayKey}
        defaultPartnerId={planPartnerId}
        projects={planProjects}
        partners={partners}
        onClose={() => setPlanOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  );
}
