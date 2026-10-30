"use client";

import { useMemo, useState } from "react";
import type { Factuur, Project } from "@/types/database";
import {
  kickoffCompletionPatch,
  kickoffWarmtefondsBedragen,
  projectKickoffItems,
  showProjectKickoff,
} from "@/lib/project-kickoff";
import {
  FINANCIERINGSMAN_NAAM,
  edwinWarmtefondsWhatsappBericht,
  edwinWhatsappUrl,
  isWarmtefondsProject,
  recommendedSchouwWeekForProject,
  saleMomentVanProject,
} from "@/lib/backoffice-acties";
import {
  formatSchouwWeekLabel,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
  upcomingSchouwWeekOptions,
} from "@/lib/schouw-week";
import { isAanbetalingFactuurOmschrijving } from "@/lib/aanbetaling";
import { formatEuro } from "@/lib/format";

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Voorstel: maandag van de aanbevolen week om 10:00 (lokale tijd). */
function defaultSchouwdagLocal(
  jaar: number,
  week: number
): string {
  try {
    const monday = new Date(schouwWeekToMondayIso(jaar, week));
    monday.setHours(10, 0, 0, 0);
    return toDatetimeLocalValue(monday.toISOString());
  } catch {
    return "";
  }
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.85 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function aanbetalingConcept(facturen: Factuur[]): Factuur | null {
  const list = facturen.filter(
    (f) =>
      !f.credit_van_factuur_id &&
      isAanbetalingFactuurOmschrijving(f.omschrijving)
  );
  return (
    list.find((f) => f.status === "concept") ||
    list.find(
      (f) =>
        f.status !== "betaald" &&
        f.status !== "verzonden" &&
        f.status !== "deels_betaald"
    ) ||
    null
  );
}

/**
 * Focus tijdens opstart: WF parallel; EM sequentieel (factuur → betaling → schouw).
 */
export function ProjectKickoffChecklist({
  project,
  facturen,
  onFinancieringUpdated,
  onProjectUpdated,
  onFacturenChanged,
  onOmzettenNaarWarmtefonds,
}: {
  project: Project;
  facturen: Factuur[];
  onFinancieringUpdated?: (project: Project) => void;
  onProjectUpdated?: (project: Project) => void;
  onFacturenChanged?: () => void;
  /** Eigen middelen → Warmtefonds (opent modal op ProjectPage). */
  onOmzettenNaarWarmtefonds?: () => void;
}) {
  const [waBusy, setWaBusy] = useState(false);
  const [afvinkBusy, setAfvinkBusy] = useState(false);
  const [edwinGestuurd, setEdwinGestuurd] = useState(false);
  const [waHint, setWaHint] = useState<string | null>(null);
  const [facBusy, setFacBusy] = useState(false);
  const [weekBusy, setWeekBusy] = useState(false);
  const [actionHint, setActionHint] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const weekOptions = useMemo(() => upcomingSchouwWeekOptions(40), []);
  const recommended = useMemo(
    () => recommendedSchouwWeekForProject(project, saleMomentVanProject(project)),
    [project]
  );
  const [schouwWeek, setSchouwWeek] = useState(() =>
    schouwWeekValue(recommended.jaar, recommended.week)
  );
  const [schouwdagLocal, setSchouwdagLocal] = useState(() =>
    defaultSchouwdagLocal(recommended.jaar, recommended.week)
  );

  if (!showProjectKickoff(project, facturen)) return null;

  const items = projectKickoffItems(project, facturen);
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const lead = Array.isArray(project.leads) ? project.leads[0] : project.leads;
  const off = Array.isArray(project.offertes)
    ? project.offertes[0]
    : project.offertes;
  const offerteId = off?.id || project.offerte_id || null;
  const draftAanbetaling = aanbetalingConcept(facturen);
  const wf = isWarmtefondsProject(project);

  async function downloadOffertePdf(): Promise<boolean> {
    if (!offerteId) return false;
    const res = await fetch(`/api/offertes/${offerteId}/pdf`);
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${off?.offerte_nummer || project.project_nummer || "offerte"}-ondertekend.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  async function stuurNaarEdwin() {
    setWaBusy(true);
    setWaHint(null);
    try {
      const bedragen = kickoffWarmtefondsBedragen(project, facturen);
      const bericht = edwinWarmtefondsWhatsappBericht({
        leadNaam: lead?.naam || project.titel || "Klant",
        telefoon: lead?.telefoon,
        straat: lead?.straat,
        postcode: lead?.postcode,
        huisnummer: lead?.huisnummer,
        toevoeging: lead?.toevoeging,
        plaats: lead?.plaats,
        offerteNummer: off?.offerte_nummer,
        projectNummer: project.project_nummer,
        aanbetalingInc: bedragen.aanbetalingInc,
        warmtefondsInc: bedragen.warmtefondsInc,
      });

      try {
        await navigator.clipboard.writeText(bericht);
      } catch {
        /* ignore */
      }

      const pdfOk = await downloadOffertePdf();
      window.open(edwinWhatsappUrl(bericht), "_blank", "noopener,noreferrer");
      setEdwinGestuurd(true);

      setWaHint(
        pdfOk
          ? `Bericht naar ${FINANCIERINGSMAN_NAAM} klaar · PDF gedownload — voeg die toe in WhatsApp. Vink daarna de taak af.`
          : `Bericht in klembord. Voeg de offerte-PDF handmatig toe in WhatsApp. Vink daarna de taak af.`
      );
    } finally {
      setWaBusy(false);
    }
  }

  async function afvinkEdwinIntake() {
    setAfvinkBusy(true);
    setWaHint(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          financiering_status: "doorgestuurd_naar_edwin",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWaHint(
          (data as { error?: string }).error ||
            "Afvinken mislukt. Probeer opnieuw."
        );
        return;
      }
      const updated = (data as { project?: Project }).project;
      const base = updated || {
        ...project,
        financiering_status: "doorgestuurd_naar_edwin" as const,
      };
      const finalized = await finalizeKickoffIfReady(base, facturen);
      if (finalized) {
        /* onProjectUpdated al via finalize */
      } else if (updated) {
        onFinancieringUpdated?.(updated);
      } else {
        onFinancieringUpdated?.(base);
      }
    } finally {
      setAfvinkBusy(false);
    }
  }

  /** Alle stappen klaar → bel_schouw + bij WF status afwachten_wf. */
  async function finalizeKickoffIfReady(
    nextProject: Project,
    nextFacturen: Factuur[]
  ): Promise<Project | null> {
    const patch = kickoffCompletionPatch(nextProject, nextFacturen);
    if (!patch) return null;
    const res = await fetch(`/api/projecten/${nextProject.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const updated = (data as { project?: Project }).project;
    if (updated) {
      onProjectUpdated?.(updated);
      return updated;
    }
    return null;
  }

  async function verstuurAanbetaling() {
    setFacBusy(true);
    setActionError(null);
    setActionHint(null);
    try {
      let factuurId = draftAanbetaling?.id || null;
      let nummer = draftAanbetaling?.factuur_nummer || null;

      if (!factuurId) {
        if (!offerteId) {
          throw new Error("Geen offerte gekoppeld — kan geen factuur maken.");
        }
        const createRes = await fetch(`/api/offertes/${offerteId}/factuur`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ soort: "aanbetaling" }),
        });
        const createData = await createRes.json().catch(() => ({}));
        if (!createRes.ok) {
          throw new Error(
            (createData as { error?: string }).error ||
              "Conceptfactuur aanmaken mislukt"
          );
        }
        if ((createData as { skipped?: boolean }).skipped) {
          throw new Error(
            (createData as { reason?: string }).reason ||
              "Geen aanbetaling voor deze offerte"
          );
        }
        const created = (createData as {
          factuur?: { id?: string; factuur_nummer?: string };
        }).factuur;
        factuurId = created?.id || null;
        nummer = created?.factuur_nummer || null;
        if (!factuurId) {
          throw new Error("Geen factuur-id teruggekregen");
        }
      }

      const email = lead?.email?.trim();
      const facLabel = wf ? "BTW-factuur" : "50%-aanbetaling";
      if (
        !confirm(
          `${facLabel}${nummer ? ` ${nummer}` : ""} mailen${
            email ? ` naar ${email}` : " naar de klant"
          }?`
        )
      ) {
        return;
      }

      const res = await fetch(`/api/facturen/${factuurId}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Versturen mislukt"
        );
      }
      const sentFac = (data as { factuur?: Factuur }).factuur;
      const nextFac = sentFac
        ? [
            ...facturen.filter((f) => f.id !== sentFac.id),
            sentFac,
          ]
        : facturen.map((f) =>
            f.id === factuurId ? { ...f, status: "verzonden" as const } : f
          );
      const finalized = await finalizeKickoffIfReady(project, nextFac);
      setActionHint(
        finalized?.status === "opstarten_voltooid_afwachten_wf"
          ? `${facLabel}${nummer ? ` ${nummer}` : ""} verstuurd · status → Opstarten voltooid — afwachten WF`
          : `${facLabel}${nummer ? ` ${nummer}` : ""} verstuurd.`
      );
      onFacturenChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Versturen mislukt");
    } finally {
      setFacBusy(false);
    }
  }

  async function planSchouwdag() {
    const parsed = new Date(schouwdagLocal);
    if (!schouwdagLocal.trim() || Number.isNaN(parsed.getTime())) {
      setActionError("Kies een geldige schouwdag en tijd");
      return;
    }
    const derived = schouwWeekFromDate(parsed);
    const email = lead?.email?.trim();
    if (
      !confirm(
        `Schouwdag zetten${email ? ` en mail sturen naar ${email}` : ""}?\n\nDe klant krijgt de schouwdag + knop naar track & trace.`
      )
    ) {
      return;
    }
    setWeekBusy(true);
    setActionError(null);
    setActionHint(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}/schouw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schouw_at: parsed.toISOString(),
          schouw_jaar: derived.jaar,
          schouw_week: derived.week,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Schouwdag opslaan mislukt"
        );
      }
      const updated = (data as { project?: Project }).project;
      const base = updated || project;
      const finalized = await finalizeKickoffIfReady(base, facturen);
      const result = finalized || updated;
      if (result && !finalized) onProjectUpdated?.(result);
      const mailOk = (data as { mails?: { klant?: { ok?: boolean } } }).mails
        ?.klant?.ok;
      const dagLabel = parsed.toLocaleString("nl-NL", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      setActionHint(
        mailOk
          ? `Schouwdag gezet · ${dagLabel} — klantmail met track & trace verstuurd`
          : `Schouwdag gezet · ${dagLabel}`
      );
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Schouwdag opslaan mislukt"
      );
    } finally {
      setWeekBusy(false);
    }
  }

  async function planSchouwweek() {
    const opt = weekOptions.find((o) => o.value === schouwWeek);
    if (!opt) {
      setActionError("Kies een geldige schouwweek");
      return;
    }
    const email = lead?.email?.trim();
    if (
      !confirm(
        `Schouwweek zetten${email ? ` en mail sturen naar ${email}` : ""}?\n\nDe klant krijgt de schouwweek + knop naar track & trace.`
      )
    ) {
      return;
    }
    setWeekBusy(true);
    setActionError(null);
    setActionHint(null);
    try {
      // POST /schouw: plant week + stuurt klantmail met track & trace (geen aparte taak)
      const res = await fetch(`/api/projecten/${project.id}/schouw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schouw_jaar: opt.jaar,
          schouw_week: opt.week,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Schouwweek opslaan mislukt"
        );
      }
      const updated = (data as { project?: Project }).project;
      const base = updated || project;
      const finalized = await finalizeKickoffIfReady(base, facturen);
      const result = finalized || updated;
      if (result && !finalized) onProjectUpdated?.(result);
      const mailOk = (data as { mails?: { klant?: { ok?: boolean } } }).mails
        ?.klant?.ok;
      const weekLabel = formatSchouwWeekLabel(opt.jaar, opt.week);
      setActionHint(
        finalized?.status === "opstarten_voltooid_afwachten_wf"
          ? `Schouwweek gezet · ${weekLabel} — status → Opstarten voltooid — afwachten WF`
          : mailOk
            ? `Schouwweek gezet · ${weekLabel} — klantmail met track & trace verstuurd`
            : `Schouwweek gezet · ${weekLabel}`
      );
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Schouwweek opslaan mislukt"
      );
    } finally {
      setWeekBusy(false);
    }
  }

  const bedragen = kickoffWarmtefondsBedragen(project, facturen);

  return (
    <section
      id="project-kickoff"
      className="border border-line bg-white px-4 py-5 sm:px-5"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
        Direct na tekenen
      </p>
      <h2 className="mt-1 text-lg font-semibold text-ink">
        Dit moet nu gebeuren
      </h2>

      {!wf && onOmzettenNaarWarmtefonds ? (
        <div className="mt-3 flex flex-col gap-2 border border-[#0D9488]/35 bg-[#F0FDFA] px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#115E59]">
              Eigen middelen → Warmtefonds?
            </p>
            <p className="mt-0.5 text-[12px] text-[#0F766E]">
              Zet deze order om; standaard wordt de BTW de aanbetalingsfactuur.
            </p>
          </div>
          <button
            type="button"
            onClick={onOmzettenNaarWarmtefonds}
            className="shrink-0 bg-[#0D9488] px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-[#0F766E]"
          >
            Omzetten naar Warmtefonds →
          </button>
        </div>
      ) : null}

      {waHint || actionHint ? (
        <p className="mt-3 border border-[#0D9488]/25 bg-[#F0FDFA] px-3 py-2 text-[12px] text-[#115E59]">
          {actionHint || waHint}
        </p>
      ) : null}
      {actionError ? (
        <p className="mt-3 border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          {actionError}
        </p>
      ) : null}

      {open.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {open.map((item, idx) => (
            <li
              key={item.id}
              className={
                item.blocked
                  ? "flex flex-col gap-3 border border-line bg-[#F8FAFC] px-3.5 py-3 sm:flex-row sm:items-start"
                  : "flex flex-col gap-3 border border-[#FDBA74]/60 bg-[#FFF7ED] px-3.5 py-3 sm:flex-row sm:items-start"
              }
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  className={
                    item.blocked
                      ? "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#94A3B8] text-[11px] font-bold text-white"
                      : "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#C45A12] text-[11px] font-bold text-white"
                  }
                >
                  {idx + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-ink">
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted">
                    {item.blocked && item.blockedReason
                      ? item.blockedReason
                      : item.detail}
                    {!item.blocked &&
                    item.id === "aanbetaling" &&
                    bedragen.aanbetalingInc != null
                      ? ` · ${formatEuro(bedragen.aanbetalingInc)}`
                      : ""}
                  </span>
                </span>
              </div>

              {item.id === "aanbetaling" ? (
                <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                  <button
                    type="button"
                    disabled={facBusy || !offerteId}
                    onClick={() => void verstuurAanbetaling()}
                    className="inline-flex items-center gap-1.5 bg-[#C45A12] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#9A4510] disabled:opacity-60"
                  >
                    {facBusy
                      ? "Bezig…"
                      : draftAanbetaling
                        ? "Verstuur factuur"
                        : "Maak & verstuur"}
                  </button>
                  {!wf && onOmzettenNaarWarmtefonds ? (
                    <button
                      type="button"
                      onClick={onOmzettenNaarWarmtefonds}
                      className="text-[11px] font-semibold text-[#0D9488] hover:underline"
                    >
                      Liever Warmtefonds? Omzetten →
                    </button>
                  ) : null}
                  {!lead?.email ? (
                    <p className="max-w-[14rem] text-right text-[11px] text-[#C45A12]">
                      Let op: geen e-mail op de lead
                    </p>
                  ) : null}
                </div>
              ) : null}

              {item.id === "wf_afspraak" ? (
                <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                  <button
                    type="button"
                    disabled={waBusy}
                    onClick={() => void stuurNaarEdwin()}
                    className="inline-flex items-center gap-1.5 bg-[#25D366] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#1ebe57] disabled:opacity-60"
                    title={`WhatsApp naar ${FINANCIERINGSMAN_NAAM}`}
                  >
                    <WhatsAppIcon />
                    {waBusy
                      ? "Bezig…"
                      : edwinGestuurd
                        ? "Opnieuw sturen"
                        : "Stuur naar Edwin"}
                  </button>
                  {edwinGestuurd ? (
                    <button
                      type="button"
                      disabled={afvinkBusy}
                      onClick={() => void afvinkEdwinIntake()}
                      className="inline-flex items-center gap-1.5 border border-[#0D9488] bg-[#F0FDFA] px-3 py-2 text-[12px] font-semibold text-[#115E59] hover:bg-[#CCFBF1] disabled:opacity-60"
                      title="Intake afronden — start fase Financiering"
                    >
                      <svg
                        viewBox="0 0 12 12"
                        className="h-3 w-3"
                        aria-hidden
                      >
                        <path
                          d="M2.5 6.2 4.8 8.5 9.5 3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {afvinkBusy ? "Bezig…" : "Afvinken — intake klaar"}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {item.id === "schouwweek" ? (
                item.blocked ? (
                  <p className="shrink-0 text-[12px] font-medium text-muted sm:max-w-[14rem] sm:text-right">
                    Beschikbaar na 50% betaling
                  </p>
                ) : wf ? (
                  <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:min-w-[16rem] sm:items-stretch">
                    <select
                      value={schouwWeek}
                      onChange={(e) => setSchouwWeek(e.target.value)}
                      className="border border-line bg-white px-3 py-2 text-[12px] font-medium text-ink outline-none focus:border-green"
                    >
                      {weekOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                          {o.value ===
                          schouwWeekValue(recommended.jaar, recommended.week)
                            ? " · voorstel +5w"
                            : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={weekBusy || !schouwWeek}
                      onClick={() => void planSchouwweek()}
                      className="bg-[#0a4727] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#0D5C32] disabled:opacity-60"
                    >
                      {weekBusy ? "Bezig…" : "Zet schouwweek + mail"}
                    </button>
                    {!lead?.email ? (
                      <p className="max-w-[16rem] text-[11px] text-[#C45A12]">
                        Let op: geen e-mail op de lead — track & trace-mail kan
                        niet
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:min-w-[16rem] sm:items-stretch">
                    <input
                      type="datetime-local"
                      value={schouwdagLocal}
                      onChange={(e) => setSchouwdagLocal(e.target.value)}
                      className="border border-line bg-white px-3 py-2 text-[12px] font-medium text-ink outline-none focus:border-green"
                    />
                    <button
                      type="button"
                      disabled={weekBusy || !schouwdagLocal}
                      onClick={() => void planSchouwdag()}
                      className="bg-[#0a4727] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#0D5C32] disabled:opacity-60"
                    >
                      {weekBusy ? "Bezig…" : "Zet schouwdag + mail"}
                    </button>
                    {!lead?.email ? (
                      <p className="max-w-[16rem] text-[11px] text-[#C45A12]">
                        Let op: geen e-mail op de lead — track & trace-mail kan
                        niet
                      </p>
                    ) : null}
                  </div>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {done.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {done.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 px-1 py-1 text-[13px] text-[#0F766E]"
            >
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#0D9488] text-white"
                aria-hidden
              >
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5">
                  <path
                    d="M2.5 6.2 4.8 8.5 9.5 3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="font-medium">{item.label}</span>
              <span className="text-muted">· {item.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
