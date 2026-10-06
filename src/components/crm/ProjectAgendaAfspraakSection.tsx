"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { InstallatiePartner, Project } from "@/types/database";
import { recommendedSchouwWeekForProject } from "@/lib/backoffice-acties";
import { formatDateTimeNl } from "@/lib/format";
import {
  formatProjectSchouwWeek,
  isSchouwdagDefinitief,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekValue,
  upcomingSchouwWeekOptions,
} from "@/lib/schouw-week";

type AfspraakSoort = "schouwweek" | "schouwdag" | "installatie" | "service";

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initialWeekValue(project: Project): string {
  if (project.schouw_jaar && project.schouw_week) {
    return schouwWeekValue(project.schouw_jaar, project.schouw_week);
  }
  if (project.schouw_at) {
    const { jaar, week } = schouwWeekFromDate(project.schouw_at);
    return schouwWeekValue(jaar, week);
  }
  const def = recommendedSchouwWeekForProject(project);
  return schouwWeekValue(def.jaar, def.week);
}

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

type PlannedRow = {
  key: string;
  type: string;
  wanneer: string;
  partner: string;
  notities: string | null;
  detail?: string | null;
};

function plannedRows(project: Project): PlannedRow[] {
  const partner =
    project.installatie_partners?.naam || project.monteur || "—";
  const rows: PlannedRow[] = [];

  const weekLabel = formatProjectSchouwWeek(project);
  const dagDefinitief = isSchouwdagDefinitief(project);

  if (project.schouw_at && dagDefinitief) {
    rows.push({
      key: "schouwdag",
      type: "Schouwdag",
      wanneer: formatDateTimeNl(project.schouw_at),
      partner,
      notities: project.schouw_notities?.trim() || null,
      detail: weekLabel,
    });
  } else if (project.schouw_jaar && project.schouw_week) {
    rows.push({
      key: "schouwweek",
      type: "Schouwweek",
      wanneer: weekLabel || `Week ${project.schouw_week} · ${project.schouw_jaar}`,
      partner,
      notities: project.schouw_notities?.trim() || null,
      detail: "Exacte dag nog niet vastgelegd",
    });
  } else if (project.schouw_at) {
    rows.push({
      key: "schouw-at",
      type: "Schouw",
      wanneer: formatDateTimeNl(project.schouw_at),
      partner,
      notities: project.schouw_notities?.trim() || null,
    });
  }

  if (project.installatie_at) {
    rows.push({
      key: "installatie",
      type: "Installatie",
      wanneer: formatDateTimeNl(project.installatie_at),
      partner,
      notities: project.installatie_notities?.trim() || null,
    });
  }

  if (project.service_at) {
    rows.push({
      key: "service",
      type: "Service",
      wanneer: formatDateTimeNl(project.service_at),
      partner,
      notities: project.service_notities?.trim() || null,
    });
  }

  return rows;
}

export function ProjectAgendaAfspraakSection({
  project,
  onChanged,
  openSoortRequest = null,
}: {
  project: Project;
  onChanged: () => void;
  /** Verhoog/zet om formulier te openen met dit type (bijv. vanuit Volgende stap). */
  openSoortRequest?: { soort: AfspraakSoort; nonce: number } | null;
}) {
  const weekOptions = useMemo(() => upcomingSchouwWeekOptions(60), []);
  const [open, setOpen] = useState(false);
  const [soort, setSoort] = useState<AfspraakSoort>("schouwweek");
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [schouwWeek, setSchouwWeek] = useState(() =>
    initialWeekValue(project)
  );
  const [schouwAtLocal, setSchouwAtLocal] = useState(
    isSchouwdagDefinitief(project)
      ? toDatetimeLocalValue(project.schouw_at)
      : ""
  );
  const [installatieAt, setInstallatieAt] = useState(
    toDatetimeLocalValue(project.installatie_at)
  );
  const [serviceAt, setServiceAt] = useState(
    toDatetimeLocalValue(project.service_at)
  );
  const [partnerId, setPartnerId] = useState(
    project.installatie_partner_id || ""
  );
  const [notities, setNotities] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const selectedPartner = useMemo(
    () => partners.find((p) => p.id === partnerId) || null,
    [partners, partnerId]
  );

  const rows = useMemo(() => plannedRows(project), [project]);

  const loadPartners = useCallback(async () => {
    try {
      const res = await fetch("/api/installatie-partners");
      const data = await res.json().catch(() => ({}));
      const list = (data.partners as InstallatiePartner[]) || [];
      setPartners(list);
      setPartnerId((prev) => {
        if (prev) return prev;
        if (project.installatie_partner_id) return project.installatie_partner_id;
        return list[0]?.id || "";
      });
    } catch {
      /* ignore */
    }
  }, [project.installatie_partner_id]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void loadPartners());
    return () => cancelAnimationFrame(id);
  }, [loadPartners]);

  useEffect(() => {
    if (!openSoortRequest) return;
    setSoort(openSoortRequest.soort);
    setOpen(true);
    setError(null);
    setOkMsg(null);
    const t = window.setTimeout(() => {
      document
        .getElementById("project-afspraken")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => window.clearTimeout(t);
  }, [openSoortRequest]);

  useEffect(() => {
    setSchouwWeek(initialWeekValue(project));
    setSchouwAtLocal(
      isSchouwdagDefinitief(project)
        ? toDatetimeLocalValue(project.schouw_at)
        : ""
    );
    setInstallatieAt(toDatetimeLocalValue(project.installatie_at));
    setServiceAt(toDatetimeLocalValue(project.service_at));
    if (project.installatie_partner_id) {
      setPartnerId(project.installatie_partner_id);
    }
  }, [
    project.id,
    project.schouw_at,
    project.schouw_jaar,
    project.schouw_week,
    project.installatie_at,
    project.service_at,
    project.installatie_partner_id,
  ]);

  const schouwSelectOptions = useMemo(() => {
    const base = [...weekOptions];
    if (schouwWeek && !base.some((o) => o.value === schouwWeek)) {
      const parsed = parseSchouwWeekValue(schouwWeek);
      if (parsed) {
        base.unshift({
          value: schouwWeek,
          label:
            formatProjectSchouwWeek({
              schouw_jaar: parsed.jaar,
              schouw_week: parsed.week,
            }) || schouwWeek,
          jaar: parsed.jaar,
          week: parsed.week,
        });
      }
    }
    return base;
  }, [weekOptions, schouwWeek]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      if (!partnerId) throw new Error("Kies een installatiepartner");

      if (soort === "schouwweek" || soort === "schouwdag") {
        const payload: Record<string, unknown> = {
          installatie_partner_id: partnerId,
          schouw_notities: notities.trim() || null,
        };

        if (soort === "schouwdag") {
          if (!schouwAtLocal.trim()) {
            throw new Error("Kies schouwdatum + tijd");
          }
          const parsed = new Date(schouwAtLocal);
          if (Number.isNaN(parsed.getTime())) {
            throw new Error("Ongeldige schouwdatum");
          }
          payload.schouw_at = parsed.toISOString();
          const derived = schouwWeekFromDate(parsed);
          payload.schouw_jaar = derived.jaar;
          payload.schouw_week = derived.week;
        } else {
          const opt = schouwSelectOptions.find((o) => o.value === schouwWeek);
          if (!opt) throw new Error("Kies een schouwweek");
          payload.schouw_jaar = opt.jaar;
          payload.schouw_week = opt.week;
        }

        const res = await fetch(`/api/projecten/${project.id}/schouw`, {
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
        setOkMsg(
          `${soort === "schouwdag" ? "Schouwdag" : "Schouwweek"} ingepland. ${summary.ok}`
        );
        if (summary.warn) setError(summary.warn);
        setOpen(false);
        setNotities("");
        onChanged();
        return;
      }

      if (soort === "service") {
        if (!serviceAt.trim()) {
          throw new Error("Kies servicedatum + tijd");
        }
        const parsed = new Date(serviceAt);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error("Ongeldige servicedatum");
        }
        const res = await fetch(`/api/projecten/${project.id}/service`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_at: parsed.toISOString(),
            installatie_partner_id: partnerId,
            service_notities: notities.trim() || null,
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
        setOkMsg(`Service-afspraak ingepland. ${summary.ok}`);
        if (summary.warn) setError(summary.warn);
        setOpen(false);
        setNotities("");
        onChanged();
        return;
      }

      if (!installatieAt.trim()) {
        throw new Error("Kies installatiedatum + tijd");
      }
      const parsed = new Date(installatieAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error("Ongeldige installatiedatum");
      }
      const res = await fetch(`/api/projecten/${project.id}/installatie`, {
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
      setOkMsg(`Installatie ingepland. ${summary.ok}`);
      if (summary.warn) setError(summary.warn);
      setOpen(false);
      setNotities("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="project-afspraken" className="scroll-mt-4 border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            Afspraken
          </h2>
          {selectedPartner ? (
            <p className="mt-0.5 text-xs text-muted">{selectedPartner.naam}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setError(null);
            setOkMsg(null);
          }}
          className="bg-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e0651c]"
        >
          {open ? "Sluiten" : "+ Afspraak"}
        </button>
      </div>

      {(okMsg || error) && !open ? (
        <div className="space-y-1 border-b border-line px-4 py-2.5">
          {okMsg ? (
            <p className="text-sm text-green-dark">{okMsg}</p>
          ) : null}
          {error ? <p className="text-sm text-[#C45A12]">{error}</p> : null}
        </div>
      ) : null}

      {open ? (
        <form
          onSubmit={(e) => void submit(e)}
          className="space-y-3 border-b border-line px-4 py-4"
        >
          <p className="text-xs text-muted">
            Plan een schouw of installatie. Klant en installateur krijgen een
            bevestigingsmail.
          </p>

          <label className="block text-[10px] font-semibold uppercase text-muted">
            Installateur
            <select
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
            >
              <option value="">Kies installateur…</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.naam}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Type afspraak
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  {
                    id: "schouwweek" as const,
                    label: "Schouwweek",
                    hint: "Week selecteren",
                  },
                  {
                    id: "schouwdag" as const,
                    label: "Schouwdag",
                    hint: "Datum + tijd",
                  },
                  {
                    id: "installatie" as const,
                    label: "Installatie",
                    hint: "Datum + tijd",
                  },
                  {
                    id: "service" as const,
                    label: "Service",
                    hint: "Datum + tijd",
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSoort(opt.id)}
                  className={[
                    "border px-3 py-2.5 text-left transition-colors",
                    soort === opt.id
                      ? "border-green bg-[#E6F7F5]"
                      : "border-line bg-white hover:bg-wash",
                  ].join(" ")}
                >
                  <span className="block text-sm font-semibold text-ink">
                    {opt.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    {opt.hint}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          {soort === "schouwweek" ? (
            <label className="block text-[10px] font-semibold uppercase text-muted">
              Schouwweek
              <select
                required
                value={schouwWeek}
                onChange={(e) => setSchouwWeek(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              >
                <option value="">Kies week…</option>
                {schouwSelectOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {soort === "schouwdag" ? (
            <label className="block text-[10px] font-semibold uppercase text-muted">
              Schouwdatum + tijd
              <input
                type="datetime-local"
                required
                value={schouwAtLocal}
                onChange={(e) => setSchouwAtLocal(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              />
            </label>
          ) : null}

          {soort === "installatie" ? (
            <label className="block text-[10px] font-semibold uppercase text-muted">
              Installatiedatum + tijd
              <input
                type="datetime-local"
                required
                value={installatieAt}
                onChange={(e) => setInstallatieAt(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              />
            </label>
          ) : null}

          {soort === "service" ? (
            <label className="block text-[10px] font-semibold uppercase text-muted">
              Servicedatum + tijd
              <input
                type="datetime-local"
                required
                value={serviceAt}
                onChange={(e) => setServiceAt(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              />
            </label>
          ) : null}

          <label className="block text-[10px] font-semibold uppercase text-muted">
            Notities (optioneel)
            <textarea
              value={notities}
              onChange={(e) => setNotities(e.target.value)}
              rows={2}
              placeholder="Bijv. meterkast, parkeerplek…"
              className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
            />
          </label>

          {error ? <p className="text-sm text-[#C45A12]">{error}</p> : null}
          {okMsg ? <p className="text-sm text-green-dark">{okMsg}</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-wash"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={busy || !partnerId}
              className="bg-green px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy
                ? "Bezig…"
                : soort === "schouwweek"
                  ? "Schouwweek inplannen"
                  : soort === "schouwdag"
                    ? "Schouwdag inplannen"
                    : soort === "service"
                      ? "Service inplannen"
                      : "Installatie inplannen"}
            </button>
          </div>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">
          Nog geen schouw, installatie of service gepland voor deze klant.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-wash/80 text-[11px] font-semibold text-muted">
                <th className="px-4 py-2.5 font-semibold text-ink">Type</th>
                <th className="px-3 py-2.5 font-semibold text-ink">Wanneer</th>
                <th className="px-3 py-2.5 font-semibold text-ink">
                  Installateur
                </th>
                <th className="px-3 py-2.5 font-semibold text-ink">Notitie</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-3 align-top">
                    <p className="font-semibold text-ink">{r.type}</p>
                    {r.detail ? (
                      <p className="mt-0.5 text-[11px] text-muted">{r.detail}</p>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-top text-ink">
                    {r.wanneer}
                  </td>
                  <td className="px-3 py-3 align-top text-ink">{r.partner}</td>
                  <td className="max-w-[14rem] px-3 py-3 align-top text-muted">
                    {r.notities ? (
                      <span className="whitespace-pre-wrap text-ink/90">
                        {r.notities}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
