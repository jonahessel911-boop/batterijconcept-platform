"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { InstallatiePartner, Project, ProjectFoto } from "@/types/database";
import {
  isWarmtefondsProject,
  recommendedSchouwWeekForProject,
} from "@/lib/backoffice-acties";
import { formatDateTimeNl } from "@/lib/format";
import { PlanningAgenda } from "@/components/planning/PlanningAgenda";
import {
  formatProjectSchouwWeek,
  isSchouwdagDefinitief,
  isSchouwweekGepland,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
  upcomingSchouwWeekOptions,
} from "@/lib/schouw-week";
import { Panel } from "./DetailChrome";

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initialSchouwWeekValue(project: Project): string {
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

function CheckRow({ done, label, detail }: { done: boolean; label: string; detail?: string | null }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span
        className={[
          "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          done
            ? "border-green bg-green text-white"
            : "border-[#c5cdc8] bg-white text-transparent",
        ].join(" ")}
        aria-hidden
      >
        <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none">
          <path
            d="M3.5 8.5 6.5 11.5 12.5 4.5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <div className="min-w-0">
        <p className={["text-sm", done ? "font-medium text-ink" : "text-muted"].join(" ")}>
          {label}
          {done ? (
            <span className="ml-1.5 text-[11px] font-semibold text-green-dark">✓</span>
          ) : null}
        </p>
        {detail ? (
          <p className="mt-0.5 text-xs text-muted">{detail}</p>
        ) : null}
      </div>
    </li>
  );
}

export function ProjectSchouwSection({
  project,
  onChanged,
  embedded = false,
}: {
  project: Project;
  onChanged: () => void;
  embedded?: boolean;
}) {
  const weekOptions = useMemo(() => upcomingSchouwWeekOptions(60), []);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [fotos, setFotos] = useState<ProjectFoto[]>([]);
  const [schouwWeek, setSchouwWeek] = useState(() =>
    initialSchouwWeekValue(project)
  );
  const [partnerId, setPartnerId] = useState(
    project.installatie_partner_id || ""
  );
  const [notities, setNotities] = useState(project.schouw_notities || "");
  const [schouwAtLocal, setSchouwAtLocal] = useState(
    isSchouwdagDefinitief(project)
      ? toDatetimeLocalValue(project.schouw_at)
      : ""
  );
  const [installatieAt, setInstallatieAt] = useState(
    toDatetimeLocalValue(project.installatie_at)
  );
  const [installatieNotities, setInstallatieNotities] = useState(
    project.installatie_notities || ""
  );
  const [saving, setSaving] = useState(false);
  const [installatieSaving, setInstallatieSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);

  const loadPartnersAndFotos = useCallback(async () => {
    try {
      const [p, f] = await Promise.all([
        fetch("/api/installatie-partners").then((r) => r.json()),
        fetch(`/api/projecten/${project.id}/fotos`).then((r) => r.json()),
      ]);
      setPartners(p.partners || []);
      setFotos(f.fotos || []);
    } catch {
      /* ignore */
    }
  }, [project.id]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void loadPartnersAndFotos());
    return () => cancelAnimationFrame(id);
  }, [loadPartnersAndFotos]);

  useEffect(() => {
    setSchouwWeek(initialSchouwWeekValue(project));
    setPartnerId(project.installatie_partner_id || "");
    setNotities(project.schouw_notities || "");
    setSchouwAtLocal(
      isSchouwdagDefinitief(project)
        ? toDatetimeLocalValue(project.schouw_at)
        : ""
    );
    setInstallatieAt(toDatetimeLocalValue(project.installatie_at));
    setInstallatieNotities(project.installatie_notities || "");
  }, [
    project.schouw_at,
    project.schouw_jaar,
    project.schouw_week,
    project.installatie_partner_id,
    project.schouw_notities,
    project.installatie_at,
    project.installatie_notities,
  ]);

  const schouwSelectOptions = useMemo(() => {
    const base = [...weekOptions];
    if (schouwWeek && !base.some((o) => o.value === schouwWeek)) {
      const m = /^(\d{4})-W(\d{1,2})$/i.exec(schouwWeek);
      if (m) {
        const jaar = Number(m[1]);
        const week = Number(m[2]);
        base.unshift({
          value: schouwWeek,
          label:
            formatProjectSchouwWeek({
              schouw_jaar: jaar,
              schouw_week: week,
            }) || schouwWeek,
          jaar,
          week,
        });
      }
    }
    return base;
  }, [weekOptions, schouwWeek]);

  const weekGepland = isSchouwweekGepland(project);
  const dagDefinitief = isSchouwdagDefinitief(project);
  const installatieGepland = Boolean(project.installatie_at);
  const installatieVoltooid = project.status === "installatie_voltooid";

  const agendaAnchor = useMemo(() => {
    if (project.schouw_at) return project.schouw_at;
    if (project.schouw_jaar && project.schouw_week) {
      try {
        return schouwWeekToMondayIso(project.schouw_jaar, project.schouw_week);
      } catch {
        /* ignore */
      }
    }
    if (project.installatie_at) return project.installatie_at;
    return null;
  }, [
    project.schouw_at,
    project.schouw_jaar,
    project.schouw_week,
    project.installatie_at,
  ]);

  async function planSchouw(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      if (!schouwWeek) throw new Error("Kies een schouwweek");
      if (!partnerId) throw new Error("Kies een installatiepartner");
      const opt = schouwSelectOptions.find((o) => o.value === schouwWeek);
      if (!opt) throw new Error("Ongeldige schouwweek");

      const payload: Record<string, unknown> = {
        schouw_jaar: opt.jaar,
        schouw_week: opt.week,
        installatie_partner_id: partnerId || null,
        schouw_notities: notities || null,
      };
      if (schouwAtLocal.trim()) {
        const parsed = new Date(schouwAtLocal);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error("Ongeldige schouwdag");
        }
        payload.schouw_at = parsed.toISOString();
        const derived = schouwWeekFromDate(parsed);
        payload.schouw_jaar = derived.jaar;
        payload.schouw_week = derived.week;
      }

      const res = await fetch(`/api/projecten/${project.id}/schouw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Inplannen mislukt");

      const mailOk = data.mails?.klant?.ok;
      const mailSkipped = data.mails?.klant?.skipped;
      const mailErr = data.mails?.klant?.error as string | undefined;
      if (mailOk) {
        setOkMsg(
          schouwAtLocal.trim()
            ? "Schouwdag gezet — bevestiging naar klant verstuurd."
            : "Schouwweek ingepland — bevestiging naar klant verstuurd."
        );
      } else if (mailSkipped) {
        setOkMsg(
          schouwAtLocal.trim()
            ? "Schouwdag gezet."
            : "Schouwweek ingepland."
        );
        setError(
          mailErr ||
            "Geen bevestigingsmail: vul een e-mailadres in bij de lead."
        );
      } else {
        setOkMsg(
          schouwAtLocal.trim()
            ? "Schouwdag gezet."
            : "Schouwweek ingepland."
        );
        setError(mailErr || "Bevestigingsmail naar klant is mislukt.");
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  async function planInstallatie(e: React.FormEvent) {
    e.preventDefault();
    setInstallatieSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      if (!installatieAt) throw new Error("Kies een installatiedatum");
      if (!partnerId) throw new Error("Kies een installatiepartner");
      const parsed = new Date(installatieAt);
      if (Number.isNaN(parsed.getTime())) throw new Error("Ongeldige datum");

      const res = await fetch(`/api/projecten/${project.id}/installatie`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installatie_at: parsed.toISOString(),
          installatie_partner_id: partnerId,
          installatie_notities: installatieNotities || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Inplannen mislukt");

      setOkMsg("Installatie ingepland.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setInstallatieSaving(false);
    }
  }

  async function markInstallatieVoltooid() {
    setInstallatieSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "installatie_voltooid" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Status bijwerken mislukt");
      setOkMsg("Installatie gemarkeerd als voltooid.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setInstallatieSaving(false);
    }
  }

  async function uploadFoto(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/projecten/${project.id}/fotos`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload mislukt");
      setFotos((prev) => [...prev, data.foto]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload mislukt");
    } finally {
      setUploading(false);
    }
  }

  async function deleteFoto(fotoId: string) {
    if (!confirm("Foto verwijderen?")) return;
    try {
      const res = await fetch(
        `/api/projecten/${project.id}/fotos?foto_id=${encodeURIComponent(fotoId)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      setFotos((prev) => prev.filter((f) => f.id !== fotoId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    }
  }

  const body = (
    <>
      <ul className="mb-5 border border-line bg-wash/40 px-3.5 py-2">
        <CheckRow
          done={weekGepland}
          label="Schouwweek gepland"
          detail={formatProjectSchouwWeek(project)}
        />
        <CheckRow
          done={dagDefinitief}
          label="Schouwdag definitief"
          detail={
            dagDefinitief && project.schouw_at
              ? formatDateTimeNl(project.schouw_at)
              : null
          }
        />
        <CheckRow
          done={installatieGepland}
          label="Installatie gepland"
          detail={
            installatieGepland && project.installatie_at
              ? formatDateTimeNl(project.installatie_at)
              : null
          }
        />
        <CheckRow done={installatieVoltooid} label="Installatie voltooid" />
      </ul>

      <div className="mb-5 overflow-hidden border border-line">
        <PlanningAgenda
          key={agendaAnchor || "now"}
          orders={[project]}
          showPartner
          initialWeekAnchor={agendaAnchor}
        />
      </div>

      <button
        type="button"
        onClick={() => setPlanOpen((o) => !o)}
        className="mb-3 text-xs font-semibold text-green-dark hover:underline"
      >
        {planOpen ? "Plannen verbergen" : "Schouw / installatie plannen of wijzigen"}
      </button>

      {planOpen ? (
        <>
          <form onSubmit={planSchouw} className="space-y-4 px-1 py-2">
            <p className="text-sm text-muted">
              {isWarmtefondsProject(project)
                ? "Sale met financiering: eerst een week (±5 wkn vooruit). Exacte dag ±1 week van tevoren. Bij inplannen krijgt de klant een bevestigingsmail."
                : "Eigen middelen: schouw zo snel mogelijk. Je kunt meteen een exacte schouwdag zetten. Bij inplannen krijgt de klant een bevestigingsmail."}
            </p>
            {isWarmtefondsProject(project) ? (
              <p className="text-sm text-muted">
                We plannen ±5 weken vooruit zodat er ruimte is om het Warmtefonds
                te regelen. Hierover wordt apart contact met de klant opgenomen.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                Schouwweek
                <select
                  required
                  value={schouwWeek}
                  onChange={(e) => setSchouwWeek(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                >
                  <option value="">Kies week…</option>
                  {schouwSelectOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                Exacte schouwdag (optioneel)
                <input
                  type="datetime-local"
                  value={schouwAtLocal}
                  onChange={(e) => setSchouwAtLocal(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                />
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                Installatiepartner
                <select
                  required
                  value={partnerId}
                  onChange={(e) => setPartnerId(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                >
                  <option value="">Kies partner…</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.naam}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Schouw-notities
              <textarea
                value={notities}
                onChange={(e) => setNotities(e.target.value)}
                rows={2}
                placeholder="Bijv. meterkast in garage, sleutel bij buren…"
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              />
            </label>

            <button
              type="submit"
              disabled={saving}
              className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
            >
              {saving
                ? "Bezig…"
                : schouwAtLocal.trim()
                  ? "Schouwdag opslaan"
                  : weekGepland
                    ? "Schouwweek bijwerken"
                    : "Schouwweek inplannen"}
            </button>
          </form>

          <form
            onSubmit={planInstallatie}
            className="mt-6 space-y-4 border-t border-line px-1 pt-5"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Installatie plannen
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                Installatiedatum
                <input
                  type="datetime-local"
                  required
                  value={installatieAt}
                  onChange={(e) => setInstallatieAt(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                />
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                Installatiepartner
                <select
                  required
                  value={partnerId}
                  onChange={(e) => setPartnerId(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                >
                  <option value="">Kies partner…</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.naam}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Installatie-notities
              <textarea
                value={installatieNotities}
                onChange={(e) => setInstallatieNotities(e.target.value)}
                rows={2}
                placeholder="Bijv. parkeerplek achterom, ladder nodig…"
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={installatieSaving || partners.length === 0}
                className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
              >
                {installatieSaving
                  ? "Bezig…"
                  : project.installatie_at
                    ? "Installatie bijwerken"
                    : "Installatie inplannen"}
              </button>
              {installatieGepland && !installatieVoltooid ? (
                <button
                  type="button"
                  disabled={installatieSaving}
                  onClick={() => void markInstallatieVoltooid()}
                  className="border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-60"
                >
                  Markeer voltooid
                </button>
              ) : null}
            </div>
          </form>
        </>
      ) : null}

      {error && (
        <p className="mt-3 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      )}
      {okMsg && (
        <p className="mt-3 border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
          {okMsg}
        </p>
      )}

      <div className="mt-6 border-t border-line px-1 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Foto&apos;s ({fotos.length})
          </p>
          <label className="cursor-pointer text-xs font-semibold text-green-dark underline-offset-2 hover:underline">
            {uploading ? "Uploaden…" : "Foto toevoegen"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadFoto(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {fotos.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nog geen foto&apos;s.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {fotos.map((f) => (
              <div key={f.id} className="group relative border border-line bg-wash">
                {f.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.url}
                    alt={f.bestandsnaam || "Projectfoto"}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-xs text-muted">
                    Geen preview
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void deleteFoto(f.id)}
                  className="absolute right-1 top-1 bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-[#C45A12] opacity-0 group-hover:opacity-100"
                >
                  Verwijder
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  if (embedded) return body;

  return (
    <Panel title="Schouw & installatie" subtitle={project.project_nummer}>
      {body}
    </Panel>
  );
}
