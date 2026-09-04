"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Factuur, InstallatiePartner, Project } from "@/types/database";
import {
  FINANCIERINGSMAN_TEL,
  FINANCIERINGSMAN_TEL_HREF,
  financieringSchakelBericht,
  isWarmtefondsProject,
  openBackofficeActies,
  recommendedSchouwWeekForProject,
  saleMomentVanProject,
  type BackofficeActie,
} from "@/lib/backoffice-acties";
import { formatDateTimeNl, formatEuro } from "@/lib/format";
import {
  formatSchouwWeekLabel,
  schouwWeekFromDate,
  schouwWeekValue,
  upcomingSchouwWeekOptions,
} from "@/lib/schouw-week";

type SectionId = "warmtefonds" | "stap1" | "factuur";

type TaskRow = {
  key: string;
  section: SectionId;
  actie: BackofficeActie;
  kind: "financiering" | "factuur_versturen" | "schouw_week" | "nabellen";
  titel: string;
  klant: string;
  meta?: string;
  dueAt: string;
  overdue: boolean;
  done: boolean;
};

const SECTION_META: Record<
  SectionId,
  { label: string; accent: string }
> = {
  warmtefonds: {
    label: "Warmtefonds",
    accent: "bg-[#E8F0F6] text-[#1A4A6E]",
  },
  stap1: {
    label: "Schouw & aanbetaling",
    accent: "bg-green-soft text-green-dark",
  },
  factuur: {
    label: "Facturen",
    accent: "bg-[#FFF0E6] text-[#C45A12]",
  },
};

const TYPE_PILL: Record<TaskRow["kind"], { label: string; className: string }> =
  {
    financiering: {
      label: "Financiering",
      className: "bg-[#E8F0F6] text-[#1A4A6E]",
    },
    factuur_versturen: {
      label: "Factuur",
      className: "bg-[#FFF0E6] text-[#C45A12]",
    },
    schouw_week: {
      label: "Schouw",
      className: "bg-green-soft text-green-dark",
    },
    nabellen: {
      label: "Nabellen",
      className: "bg-[#FFF8D6] text-[#8A6D00]",
    },
  };

function CheckDot({ done }: { done: boolean }) {
  return (
    <span
      className={[
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
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
  );
}

function draftFacturenVoorActie(actie: BackofficeActie, facturen: Factuur[]) {
  return facturen.filter((f) => {
    if (f.lead_id !== actie.leadId) return false;
    if (f.status !== "concept") return false;
    if (actie.offerteId && f.offerte_id && f.offerte_id !== actie.offerteId) {
      return false;
    }
    return true;
  });
}

function verzondenFacturenVoorActie(
  actie: BackofficeActie,
  facturen: Factuur[]
) {
  return facturen.filter((f) => {
    if (f.lead_id !== actie.leadId) return false;
    if (f.status === "concept") return false;
    if (actie.offerteId && f.offerte_id && f.offerte_id !== actie.offerteId) {
      return false;
    }
    return true;
  });
}

function SaleNotities({
  actie,
  projecten,
}: {
  actie: BackofficeActie;
  projecten: Project[];
}) {
  const project =
    actie.project ||
    (actie.projectId
      ? projecten.find((p) => p.id === actie.projectId)
      : projecten.find((p) => p.lead_id === actie.leadId));
  if (!project) return null;

  const backoffice = project.backoffice_notitie?.trim() || "";
  const installateur = project.installateur_notitie?.trim() || "";
  if (!backoffice && !installateur) return null;

  return (
    <div className="mt-1.5 space-y-1 rounded border border-line/80 bg-wash/40 px-2 py-1.5 text-[11px] leading-snug text-muted">
      {backoffice ? (
        <p>
          <span className="font-semibold text-ink">Backoffice</span>
          {project.backoffice_notitie_door?.trim() ? (
            <span className="text-[10px] text-muted">
              {" "}
              · {project.backoffice_notitie_door.trim()}
            </span>
          ) : null}
          <span className="mt-0.5 block whitespace-pre-wrap text-ink/90">
            {backoffice}
          </span>
        </p>
      ) : null}
      {installateur ? (
        <p className={backoffice ? "border-t border-line/60 pt-1" : ""}>
          <span className="font-semibold text-ink">Installateur</span>
          {project.installateur_notitie_door?.trim() ? (
            <span className="text-[10px] text-muted">
              {" "}
              · {project.installateur_notitie_door.trim()}
            </span>
          ) : null}
          <span className="mt-0.5 block whitespace-pre-wrap text-ink/90">
            {installateur}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function buildTaskRows(
  acties: BackofficeActie[],
  facturen: Factuur[]
): TaskRow[] {
  const rows: TaskRow[] = [];
  for (const actie of acties) {
    if (actie.soort === "schakel_financiering") {
      rows.push({
        key: `${actie.id}-fin`,
        section: "warmtefonds",
        actie,
        kind: "financiering",
        titel: "Schakelen met financieringsman",
        klant: actie.leadNaam,
        meta: actie.offerteNummer || actie.projectNummer || undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue,
        done: false,
      });
      continue;
    }
    if (actie.soort === "nabellen_factuur") {
      rows.push({
        key: `${actie.id}-nabellen`,
        section: "factuur",
        actie,
        kind: "nabellen",
        titel: `Nabellen ${actie.factuurNummer || "factuur"}`,
        klant: actie.leadNaam,
        meta: actie.factuurNummer || undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue,
        done: false,
      });
      continue;
    }
    if (actie.soort === "bel_schouw_aanbetaling") {
      const drafts = draftFacturenVoorActie(actie, facturen);
      const sent = verzondenFacturenVoorActie(actie, facturen);
      const needsFactuur =
        Number(actie.project?.aanbetaling_te_innen_inc) > 0 ||
        drafts.length > 0 ||
        sent.length > 0;
      const factuurDone = !needsFactuur || sent.length > 0;
      const schouwDone = Boolean(
        actie.project?.schouw_week || actie.project?.schouw_at
      );

      if (needsFactuur) {
        rows.push({
          key: `${actie.id}-factuur`,
          section: "stap1",
          actie,
          kind: "factuur_versturen",
          titel: "Aanbetalingsfactuur versturen",
          klant: actie.leadNaam,
          meta: actie.projectNummer || undefined,
          dueAt: actie.deadlineAt,
          overdue: actie.overdue && !factuurDone,
          done: factuurDone,
        });
      }
      rows.push({
        key: `${actie.id}-schouw`,
        section: "stap1",
        actie,
        kind: "schouw_week",
        titel: "Schouwweek plannen",
        klant: actie.leadNaam,
        meta: actie.projectNummer || undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue && !schouwDone,
        done: schouwDone,
      });
    }
  }
  return rows;
}

export function BackofficeActiesList({
  projecten,
  facturen = [],
  onProjectUpdated,
  onFactuurUpdated,
}: {
  projecten: Project[];
  facturen?: Factuur[];
  onProjectUpdated?: (project: Project) => void;
  onFactuurUpdated?: (factuur: Factuur) => void;
}) {
  const acties = useMemo(
    () => openBackofficeActies(projecten, facturen),
    [projecten, facturen]
  );
  const rows = useMemo(
    () => buildTaskRows(acties, facturen),
    [acties, facturen]
  );
  const weekOptions = useMemo(() => upcomingSchouwWeekOptions(40), []);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    warmtefonds: true,
    stap1: true,
    factuur: true,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [factuurKeuze, setFactuurKeuze] = useState<Record<string, string>>({});
  const [weekKeuze, setWeekKeuze] = useState<Record<string, string>>({});
  const [schouwAtKeuze, setSchouwAtKeuze] = useState<Record<string, string>>(
    {}
  );
  const [partnerKeuze, setPartnerKeuze] = useState<Record<string, string>>({});
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/installatie-partners");
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setPartners(data.partners || []);
      } catch {
        if (!cancelled) setPartners([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const defaultPartnerId = partners.length === 1 ? partners[0].id : "";

  const sections = useMemo(() => {
    const order: SectionId[] = ["warmtefonds", "stap1", "factuur"];
    return order
      .map((id) => ({
        id,
        ...SECTION_META[id],
        rows: rows.filter((r) => r.section === id && !r.done),
        doneCount: rows.filter((r) => r.section === id && r.done).length,
      }))
      .filter((s) => s.rows.length > 0);
  }, [rows]);

  function toggleSection(id: SectionId) {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function patchProject(
    actie: BackofficeActie,
    body: Record<string, string | number | null>
  ) {
    if (!actie.projectId) return null;
    setBusyId(actie.id);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${actie.projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      const project = data.project as Project;
      onProjectUpdated?.(project);
      return project;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function maybeCompleteStap1(
    actie: BackofficeActie,
    opts: {
      factuurDone?: boolean;
      schouwDone?: boolean;
      project?: Project;
    }
  ) {
    const project = opts.project || actie.project;
    const schouwDone =
      opts.schouwDone || Boolean(project?.schouw_week || project?.schouw_at);
    const drafts = draftFacturenVoorActie(actie, facturen);
    const sent = verzondenFacturenVoorActie(actie, facturen);
    const needsFactuur =
      Number(project?.aanbetaling_te_innen_inc) > 0 || drafts.length > 0;
    const factuurDone =
      opts.factuurDone || !needsFactuur || sent.length > 0 || drafts.length === 0;
    if (schouwDone && factuurDone && actie.projectId) {
      await patchProject(actie, {
        bel_schouw_aanbetaling_at: new Date().toISOString(),
      });
    }
  }

  async function markFinancieringGeschakeld(actie: BackofficeActie) {
    await patchProject(actie, {
      financiering_geschakeld_at: new Date().toISOString(),
    });
  }

  async function markFactuurBetaald(actie: BackofficeActie) {
    if (!actie.factuurId) return;
    if (!confirm(`Factuur ${actie.factuurNummer || ""} markeren als betaald?`)) {
      return;
    }
    setBusyId(actie.id);
    setError(null);
    try {
      const res = await fetch(`/api/facturen/${actie.factuurId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "betaald",
          betaald_op: new Date().toISOString().slice(0, 10),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Markeren als betaald mislukt");
      if (data.factuur) onFactuurUpdated?.(data.factuur as Factuur);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Markeren mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function verstuurFactuur(actie: BackofficeActie) {
    const drafts = draftFacturenVoorActie(actie, facturen);
    const chosen =
      factuurKeuze[actie.id] || (drafts.length === 1 ? drafts[0].id : "");
    if (!chosen) {
      setError("Kies eerst een conceptfactuur");
      return;
    }
    const f = drafts.find((x) => x.id === chosen);
    if (!confirm(`Factuur ${f?.factuur_nummer || ""} versturen?`)) return;
    setBusyId(`${actie.id}-factuur`);
    setError(null);
    try {
      const res = await fetch(`/api/facturen/${chosen}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Versturen mislukt");
      if (data.factuur) onFactuurUpdated?.(data.factuur as Factuur);
      setExpandedRow(null);
      await maybeCompleteStap1(actie, { factuurDone: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Versturen mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function planSchouwWeek(actie: BackofficeActie) {
    if (!actie.projectId || !actie.project) return;
    const saleAt = actie.saleAt
      ? new Date(actie.saleAt)
      : saleMomentVanProject(actie.project);
    const recommended = recommendedSchouwWeekForProject(actie.project, saleAt);
    const recommendedValue = schouwWeekValue(recommended.jaar, recommended.week);
    const exactLocal = schouwAtKeuze[actie.id]?.trim() || "";
    let payload: Record<string, unknown> = {};

    if (exactLocal) {
      const parsed = new Date(exactLocal);
      if (Number.isNaN(parsed.getTime())) {
        setError("Ongeldige schouwdag");
        return;
      }
      const derived = schouwWeekFromDate(parsed);
      payload = {
        schouw_at: parsed.toISOString(),
        schouw_jaar: derived.jaar,
        schouw_week: derived.week,
      };
    } else {
      const chosen = weekKeuze[actie.id] || recommendedValue;
      const opt = weekOptions.find((o) => o.value === chosen);
      if (!opt) {
        setError("Kies een geldige schouwweek");
        return;
      }
      payload = {
        schouw_jaar: opt.jaar,
        schouw_week: opt.week,
      };
    }

    const partnerId =
      partnerKeuze[actie.id] ||
      actie.project.installatie_partner_id ||
      defaultPartnerId;
    if (!partnerId) {
      setError("Kies een installatiepartner");
      return;
    }

    setBusyId(`${actie.id}-schouw`);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${actie.projectId}/schouw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          installatie_partner_id: partnerId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Schouw opslaan mislukt");
      if (data.project) onProjectUpdated?.(data.project as Project);
      if (data.mails?.klant?.ok) {
        // ok — klantmail verstuurd
      } else if (data.mails?.klant?.skipped) {
        setError(
          data.mails.klant.error ||
            "Schouw gezet, maar geen klantmail (geen e-mailadres op de lead)"
        );
      } else if (data.mails?.klant?.ok === false) {
        setError(
          data.mails.klant.error ||
            "Schouw gezet, maar mail naar klant mislukt"
        );
      }
      setExpandedRow(null);
      setSchouwAtKeuze((p) => {
        const next = { ...p };
        delete next[actie.id];
        return next;
      });
      await maybeCompleteStap1(actie, {
        schouwDone: true,
        project: data.project as Project,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function copyBericht(actie: BackofficeActie) {
    try {
      await navigator.clipboard.writeText(financieringSchakelBericht(actie));
      setCopiedId(actie.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError("Kopiëren mislukt");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-sm text-muted">Geen openstaande acties.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-5 pb-6">
      {error && (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
          {error}
        </p>
      )}

      {sections.map((section) => {
        const open = openSections[section.id];
        const openCount = section.rows.length;
        return (
          <section key={section.id} className="border-b border-line pb-4">
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              className="flex w-full items-center gap-2 py-1.5 text-left"
            >
              <span
                className={[
                  "text-muted transition",
                  open ? "" : "-rotate-90",
                ].join(" ")}
              >
                ▾
              </span>
              <span className="text-sm font-semibold text-ink">
                {section.label}
              </span>
              <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[#eef1ef] px-1.5 text-[10px] font-semibold tabular-nums text-muted">
                {openCount}
              </span>
              <span
                className={[
                  "ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                  section.accent,
                ].join(" ")}
              >
                {section.label}
              </span>
            </button>

            {open ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-wide text-muted">
                      <th className="pb-2 pr-3 font-semibold">Taak</th>
                      <th className="pb-2 pr-3 font-semibold">Type</th>
                      <th className="pb-2 pr-3 font-semibold">Due date</th>
                      <th className="pb-2 font-semibold">Actie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row) => {
                      const pill = TYPE_PILL[row.kind];
                      const isOpen = expandedRow === row.key;
                      const actie = row.actie;
                      const drafts = draftFacturenVoorActie(actie, facturen);
                      const saleAt = actie.saleAt
                        ? new Date(actie.saleAt)
                        : actie.project
                          ? saleMomentVanProject(actie.project)
                          : new Date();
                      const warmtefonds = actie.project
                        ? isWarmtefondsProject(actie.project)
                        : false;
                      const recommended = actie.project
                        ? recommendedSchouwWeekForProject(actie.project, saleAt)
                        : {
                            jaar: saleAt.getFullYear(),
                            week: 1,
                          };
                      const recommendedValue = schouwWeekValue(
                        recommended.jaar,
                        recommended.week
                      );
                      const selectedWeek =
                        weekKeuze[actie.id] || recommendedValue;
                      const selectedFactuur =
                        factuurKeuze[actie.id] ||
                        (drafts.length === 1 ? drafts[0].id : "");
                      const selectedSchouwAt = schouwAtKeuze[actie.id] || "";

                      return (
                        <tr
                          key={row.key}
                          className="border-b border-line/80 align-top last:border-b-0"
                        >
                          <td className="py-2.5 pr-3">
                            <div className="flex items-start gap-2">
                              <CheckDot done={row.done} />
                              <div className="min-w-0">
                                <p className="font-medium text-ink">
                                  {row.titel}
                                </p>
                                <p className="mt-0.5 text-xs text-muted">
                                  {row.klant}
                                  {actie.telefoon?.trim() ? (
                                    <>
                                      {" · "}
                                      <a
                                        href={`tel:${actie.telefoon.trim()}`}
                                        className="font-medium text-green-dark hover:underline"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {actie.telefoon.trim()}
                                      </a>
                                    </>
                                  ) : null}
                                  {row.meta ? (
                                    <span className="ml-1.5 font-mono text-[10px] text-green-dark">
                                      {row.meta}
                                    </span>
                                  ) : null}
                                </p>
                                <SaleNotities actie={actie} projecten={projecten} />
                                {isOpen && row.kind === "financiering" ? (
                                  <div className="mt-2 space-y-0.5 rounded border border-line bg-wash/50 px-2 py-1.5 text-[11px] text-muted">
                                    <p>
                                      {actie.leadNaam} · {actie.telefoon || "—"} ·{" "}
                                      {actie.plaats || "—"}
                                    </p>
                                    <p>
                                      Offerte {actie.offerteNummer || "—"} · bel{" "}
                                      <a
                                        href={FINANCIERINGSMAN_TEL_HREF}
                                        className="font-semibold text-green-dark"
                                      >
                                        {FINANCIERINGSMAN_TEL}
                                      </a>
                                    </p>
                                  </div>
                                ) : null}
                                {isOpen && row.kind === "factuur_versturen" ? (
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    <select
                                      value={selectedFactuur}
                                      onChange={(e) =>
                                        setFactuurKeuze((p) => ({
                                          ...p,
                                          [actie.id]: e.target.value,
                                        }))
                                      }
                                      className="min-h-8 border border-line bg-white px-2 text-xs text-ink outline-none focus:border-green"
                                    >
                                      <option value="">Draft…</option>
                                      {drafts.map((f) => (
                                        <option key={f.id} value={f.id}>
                                          {f.factuur_nummer} ·{" "}
                                          {formatEuro(f.bedrag_inc_btw)}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      disabled={
                                        busyId === `${actie.id}-factuur` ||
                                        !selectedFactuur
                                      }
                                      onClick={() => void verstuurFactuur(actie)}
                                      className="min-h-8 bg-green px-2.5 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                                    >
                                      {busyId === `${actie.id}-factuur`
                                        ? "…"
                                        : "Versturen"}
                                    </button>
                                  </div>
                                ) : null}
                                {isOpen && row.kind === "schouw_week" ? (
                                  <div className="mt-2 space-y-1.5">
                                    <p className="max-w-md text-[11px] leading-snug text-muted">
                                      {warmtefonds
                                        ? "Sale met financiering: eerst een week (±5 wkn vooruit i.v.m. Warmtefonds). Exacte dag communiceren we ±1 week van tevoren; hierover wordt contact opgenomen om het Warmtefonds in te regelen."
                                        : "Eigen middelen: schouw zo snel mogelijk. Je kunt meteen een exacte schouwdag zetten (of alleen een week — dan volgt de dag ±1 week van tevoren)."}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <select
                                        value={selectedWeek}
                                        onChange={(e) =>
                                          setWeekKeuze((p) => ({
                                            ...p,
                                            [actie.id]: e.target.value,
                                          }))
                                        }
                                        disabled={Boolean(selectedSchouwAt)}
                                        className="min-h-8 max-w-[14rem] border border-line bg-white px-2 text-xs text-ink outline-none focus:border-green disabled:opacity-50"
                                      >
                                        {weekOptions.map((o) => (
                                          <option key={o.value} value={o.value}>
                                            {o.value === recommendedValue
                                              ? `Aanbevolen · W${o.week}`
                                              : `W${o.week} · ${o.jaar}`}
                                          </option>
                                        ))}
                                      </select>
                                      <input
                                        type="datetime-local"
                                        value={selectedSchouwAt}
                                        onChange={(e) =>
                                          setSchouwAtKeuze((p) => ({
                                            ...p,
                                            [actie.id]: e.target.value,
                                          }))
                                        }
                                        title={
                                          warmtefonds
                                            ? "Optioneel: exacte schouwdag"
                                            : "Exacte schouwdag"
                                        }
                                        className="min-h-8 border border-line bg-white px-2 text-xs text-ink outline-none focus:border-green"
                                      />
                                      <select
                                        value={
                                          partnerKeuze[actie.id] ||
                                          actie.project
                                            ?.installatie_partner_id ||
                                          defaultPartnerId
                                        }
                                        onChange={(e) =>
                                          setPartnerKeuze((p) => ({
                                            ...p,
                                            [actie.id]: e.target.value,
                                          }))
                                        }
                                        className="min-h-8 max-w-[12rem] border border-line bg-white px-2 text-xs text-ink outline-none focus:border-green"
                                      >
                                        <option value="">Partner…</option>
                                        {partners.map((p) => (
                                          <option key={p.id} value={p.id}>
                                            {p.naam}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        type="button"
                                        disabled={
                                          busyId === `${actie.id}-schouw`
                                        }
                                        onClick={() =>
                                          void planSchouwWeek(actie)
                                        }
                                        className="min-h-8 bg-green px-2.5 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                                      >
                                        {busyId === `${actie.id}-schouw`
                                          ? "…"
                                          : "Zet in agenda"}
                                      </button>
                                    </div>
                                    {selectedSchouwAt ? (
                                      <p className="text-[10px] text-muted">
                                        Exacte schouwdag gezet — week volgt uit
                                        deze datum. Leegmaken om alleen een week
                                        te plannen.
                                      </p>
                                    ) : (
                                      <p className="text-[10px] text-muted">
                                        {warmtefonds
                                          ? "Optioneel: vul een exacte schouwdag in als die al bekend is."
                                          : "Tip: vul de schouwdag in als die al met de klant is afgesproken."}
                                      </p>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 pr-3">
                            <span
                              className={[
                                "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold",
                                pill.className,
                              ].join(" ")}
                            >
                              {pill.label}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 whitespace-nowrap">
                            <span
                              className={[
                                "text-xs tabular-nums",
                                row.overdue
                                  ? "font-semibold text-[#C45A12]"
                                  : "text-muted",
                              ].join(" ")}
                            >
                              {formatDateTimeNl(row.dueAt)}
                              {row.overdue ? " · te laat" : ""}
                            </span>
                          </td>
                          <td className="py-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedRow(isOpen ? null : row.key)
                                }
                                className="min-h-8 border border-line px-2 text-[11px] font-semibold text-ink hover:bg-wash"
                              >
                                {isOpen ? "Sluiten" : "Open"}
                              </button>
                              {row.kind === "financiering" && isOpen ? (
                                <>
                                  <a
                                    href={FINANCIERINGSMAN_TEL_HREF}
                                    className="min-h-8 bg-green px-2 text-[11px] font-semibold leading-8 text-white hover:bg-green-dark"
                                  >
                                    Bel
                                  </a>
                                  {actie.offerteId ? (
                                    <a
                                      href={`/api/offertes/${actie.offerteId}/pdf`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="min-h-8 border border-line px-2 text-[11px] font-semibold leading-8 text-ink hover:bg-wash"
                                    >
                                      PDF
                                    </a>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => void copyBericht(actie)}
                                    className="min-h-8 border border-line px-2 text-[11px] font-semibold text-ink hover:bg-wash"
                                  >
                                    {copiedId === actie.id ? "OK" : "Kopieer"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyId === actie.id}
                                    onClick={() =>
                                      void markFinancieringGeschakeld(actie)
                                    }
                                    className="min-h-8 border border-line px-2 text-[11px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
                                  >
                                    Afgerond
                                  </button>
                                </>
                              ) : null}
                              {row.kind === "nabellen" && isOpen ? (
                                <button
                                  type="button"
                                  disabled={busyId === actie.id}
                                  onClick={() => void markFactuurBetaald(actie)}
                                  className="min-h-8 bg-green px-2 text-[11px] font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                                >
                                  Betaald
                                </button>
                              ) : null}
                              {actie.projectId ? (
                                <Link
                                  href={`/projecten/${actie.projectId}?from=acties`}
                                  className="text-[11px] font-semibold text-green-dark hover:underline"
                                >
                                  Project
                                </Link>
                              ) : actie.factuurId ? (
                                <Link
                                  href={`/facturen/${actie.factuurId}`}
                                  className="text-[11px] font-semibold text-green-dark hover:underline"
                                >
                                  Factuur
                                </Link>
                              ) : null}
                            </div>
                            {row.kind === "schouw_week" &&
                            row.done &&
                            actie.project?.schouw_jaar &&
                            actie.project?.schouw_week ? (
                              <p className="mt-1 text-[10px] text-muted">
                                {formatSchouwWeekLabel(
                                  actie.project.schouw_jaar,
                                  actie.project.schouw_week
                                )}
                              </p>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
