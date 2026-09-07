"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import type {
  Adviseur,
  Project,
  ProjectFoto,
  ProjectStatus,
  ProjectTaak,
} from "@/types/database";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import { formatDateShort, formatDateTimeNl } from "@/lib/format";
import { appendLeadNotitie } from "@/lib/lead-notitie";
import { PROJECT_AFDELINGEN } from "@/lib/project-afdeling";
import {
  formatProjectSchouwWeek,
  isSchouwdagDefinitief,
  schouwWeekEerder,
  schouwWeekFromDate,
} from "@/lib/schouw-week";
import {
  backofficeHref,
  parseBoView,
} from "./BackofficePanel";
import { ProjectStatusPath } from "./ProjectStatusPath";
import { ProjectFinancieelSection } from "./ProjectFinancieelSection";
import { ProjectAgendaAfspraakSection } from "./ProjectAgendaAfspraakSection";
import { Breadcrumb, DetailShell, NotFoundState } from "./DetailChrome";

type FeedItem = {
  key: string;
  at: string;
  title: string;
  body?: string;
};

function adresRegel(lead: Project["leads"]): string {
  if (!lead) return "—";
  const l = Array.isArray(lead) ? lead[0] : lead;
  if (!l) return "—";
  const straat = [l.straat, [l.huisnummer, l.toevoeging].filter(Boolean).join("")]
    .filter(Boolean)
    .join(" ");
  const plaats = [l.postcode, l.plaats].filter(Boolean).join(" ");
  return [straat, plaats].filter(Boolean).join(", ") || "—";
}

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const backView = parseBoView(searchParams.get("from"));
  const backHref = backofficeHref(backView);

  const [project, setProject] = useState<Project | null>(null);
  const [fotos, setFotos] = useState<ProjectFoto[]>([]);
  const [taken, setTaken] = useState<ProjectTaak[]>([]);
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [newTaakOpen, setNewTaakOpen] = useState(false);
  const [newTitel, setNewTitel] = useState("");
  const [newAfdeling, setNewAfdeling] = useState("");
  const [newPersonId, setNewPersonId] = useState("");
  const [newDue, setNewDue] = useState("");
  const [creatingTaak, setCreatingTaak] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    if (!hasSupabaseConfig()) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    try {
      const sb = getSupabaseBrowser();
      const { data, error: err } = await sb
        .from("projecten")
        .select(
          "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon)"
        )
        .eq("id", id)
        .single();

      if (err || !data) {
        setNotFound(true);
      } else {
        setProject(data as Project);
        const [fotoRes, takenRes, advRes] = await Promise.all([
          fetch(`/api/projecten/${id}/fotos`),
          fetch(`/api/taken?project_id=${id}&open=0`),
          sb
            .from("adviseurs")
            .select("id, naam, email, actief")
            .order("naam"),
        ]);
        const fotoData = await fotoRes.json().catch(() => ({}));
        const takenData = await takenRes.json().catch(() => ({}));
        setFotos((fotoData.fotos as ProjectFoto[]) || []);
        setTaken((takenData.taken as ProjectTaak[]) || []);
        setAdviseurs(
          ((advRes.data as Adviseur[]) || []).filter((a) => a.actief !== false)
        );
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  async function updateStatus(status: ProjectStatus) {
    if (!project) return;
    setStatusSaving(true);
    setError(null);
    const prev = project.status;
    setProject({ ...project, status });
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error);
      const updated = (data as { project?: Project }).project;
      if (updated) setProject((p) => (p ? { ...p, ...updated } : p));
      setOkMsg("Status bijgewerkt.");
      // Auto-taken herladen
      const takenRes = await fetch(`/api/taken?project_id=${project.id}&open=0`);
      const takenData = await takenRes.json().catch(() => ({}));
      if (takenRes.ok) setTaken((takenData.taken as ProjectTaak[]) || []);
    } catch (e) {
      setProject((p) => (p ? { ...p, status: prev } : p));
      setError(e instanceof Error ? e.message : "Status bijwerken mislukt");
    } finally {
      setStatusSaving(false);
    }
  }

  async function createTaak() {
    if (!project) return;
    if (!newTitel.trim() || !newAfdeling || !newPersonId || !newDue) {
      setError("Vul titel, afdeling, persoon en due date in.");
      return;
    }
    setCreatingTaak(true);
    setError(null);
    try {
      const due = new Date(`${newDue}T17:00:00`);
      const res = await fetch("/api/taken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: project.id,
          titel: newTitel.trim(),
          afdeling: newAfdeling,
          verantwoordelijke_id: newPersonId,
          due_at: due.toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Taak aanmaken mislukt"
        );
      }
      const taak = data.taak as ProjectTaak;
      setTaken((prev) => [taak, ...prev]);
      setNewTaakOpen(false);
      setNewTitel("");
      setNewAfdeling("");
      setNewPersonId("");
      setNewDue("");
      setOkMsg("Taak aangemaakt.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Taak aanmaken mislukt");
    } finally {
      setCreatingTaak(false);
    }
  }

  async function addNotitie() {
    if (!project) return;
    const text = noteDraft.trim();
    if (!text) return;
    setNoteBusy(true);
    setError(null);
    try {
      const merged = appendLeadNotitie(project.notities, text);
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notities: merged }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error);
      const updated = (data as { project?: Project }).project;
      if (updated) setProject((p) => (p ? { ...p, ...updated } : p));
      else setProject({ ...project, notities: merged });
      setNoteDraft("");
      setOkMsg("Notitie opgeslagen.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Notitie opslaan mislukt");
    } finally {
      setNoteBusy(false);
    }
  }

  async function uploadFoto(file: File) {
    if (!project) return;
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
      setFotos((prev) => [...prev, data.foto as ProjectFoto]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload mislukt");
    } finally {
      setUploading(false);
    }
  }

  if (loading && !project) {
    return (
      <DetailShell activeTab="projecten">
        <p className="py-20 text-center text-sm text-muted">Project laden…</p>
      </DetailShell>
    );
  }

  if (notFound || !project) {
    return (
      <NotFoundState
        title="Project niet gevonden"
        backHref={backHref}
        backLabel="Terug naar backoffice"
        activeTab="projecten"
      />
    );
  }

  const lead = Array.isArray(project.leads) ? project.leads[0] : project.leads;
  const klantNaam = lead?.naam || project.titel || "Klant";
  const partner =
    project.installatie_partners ||
    (project.monteur ? { naam: project.monteur } : null);

  const schouwWeekInfo = (() => {
    if (project.schouw_jaar && project.schouw_week) {
      return { jaar: project.schouw_jaar, week: project.schouw_week };
    }
    if (project.schouw_at) {
      return schouwWeekFromDate(project.schouw_at);
    }
    return null;
  })();

  const schouwDagDefinitief = isSchouwdagDefinitief(project);

  const schouwPlanHint = (() => {
    if (!schouwWeekInfo || schouwDagDefinitief) return null;
    const earlier = schouwWeekEerder(schouwWeekInfo.jaar, schouwWeekInfo.week);
    return `In week ${earlier.week}: schouwdag + schouwdatum inplannen`;
  })();

  const schouwValuePrimary = schouwWeekInfo
    ? `WEEK ${schouwWeekInfo.week}`
    : null;

  const schouwValueSecondary = (() => {
    if (!schouwWeekInfo) return null;
    if (schouwDagDefinitief && project.schouw_at) {
      return formatDateTimeNl(project.schouw_at);
    }
    return schouwPlanHint;
  })();

  const installatieLabel = project.installatie_at
    ? formatDateTimeNl(project.installatie_at)
    : null;

  const partnerLabel = partner
    ? [
        "naam" in partner && partner.naam ? partner.naam : null,
        "telefoon" in partner && partner.telefoon ? partner.telefoon : null,
        "email" in partner && partner.email ? partner.email : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const openTaken = taken.filter((t) => t.status !== "done");

  const feed: FeedItem[] = [
    {
      key: "created",
      at: project.created_at,
      title: "Project aangemaakt",
      body: project.project_nummer,
    },
  ];
  if (project.bel_schouw_aanbetaling_at) {
    feed.push({
      key: "bel",
      at: project.bel_schouw_aanbetaling_at,
      title: "Klant gebeld voor schouw",
    });
  }
  if (project.schouw_at || project.schouw_week) {
    feed.push({
      key: "schouw",
      at: project.schouw_at || project.created_at,
      title: schouwWeekInfo
        ? `Schouw week gepland ✅ WEEK ${schouwWeekInfo.week}`
        : "Schouw week gepland",
      body: schouwValueSecondary
        ? `(${schouwValueSecondary})`
        : formatProjectSchouwWeek(project) || undefined,
    });
  }
  if (project.installatie_at) {
    feed.push({
      key: "installatie",
      at: project.installatie_at,
      title: "Installatie gepland",
      body: project.installatie_partners?.naam || project.monteur || undefined,
    });
  }
  if (project.notities?.trim()) {
    feed.push({
      key: "notes",
      at: project.updated_at || project.created_at,
      title: "Notities",
      body: project.notities,
    });
  }
  feed.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <DetailShell onRefresh={load} loading={loading} activeTab="projecten">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Breadcrumb
          items={[
            { label: "Backoffice", href: backHref },
            { label: project.project_nummer },
          ]}
        />
        <Link
          href={backHref}
          className="border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:border-green/40"
        >
          ← Terug
        </Link>
      </div>

      {okMsg ? (
        <div className="mb-4 border border-green/30 bg-green-soft px-4 py-2.5 text-sm text-green-dark">
          {okMsg}
        </div>
      ) : null}
      {error ? (
        <div className="mb-4 border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {/* Header + status path */}
      <section className="border border-line bg-white">
        <div className="px-4 py-5 sm:px-6">
          <p className="font-mono text-[11px] font-semibold text-muted">
            {project.project_nummer}
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">
            {klantNaam}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {[adresRegel(project.leads), lead?.telefoon, lead?.email]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="border-t border-line px-3 py-3 sm:px-4">
          <ProjectStatusPath
            status={project.status}
            disabled={statusSaving}
            onChange={(s) => void updateStatus(s)}
          />
          <p className="mt-2 text-[11px] text-muted">
            Klik op een stap om de status te wijzigen.
          </p>
        </div>
      </section>

      {/* Taken voor dit project */}
      <section className="mt-4 border border-line bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            Taken ({openTaken.length} open)
          </h2>
          <button
            type="button"
            onClick={() => setNewTaakOpen((v) => !v)}
            className="bg-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e0651c]"
          >
            {newTaakOpen ? "Sluiten" : "+ Taak"}
          </button>
        </div>

        {newTaakOpen ? (
          <div className="space-y-3 border-b border-line bg-wash/40 px-4 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Nieuwe taak
            </p>
            <label className="block text-[10px] font-semibold uppercase text-muted">
              Titel
              <input
                value={newTitel}
                onChange={(e) => setNewTitel(e.target.value)}
                placeholder="Wat moet er gebeuren?"
                className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-[10px] font-semibold uppercase text-muted">
                Afdeling
                <select
                  value={newAfdeling}
                  onChange={(e) => setNewAfdeling(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
                >
                  <option value="">Kies…</option>
                  {PROJECT_AFDELINGEN.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[10px] font-semibold uppercase text-muted">
                Verantwoordelijke
                <select
                  value={newPersonId}
                  onChange={(e) => setNewPersonId(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
                >
                  <option value="">👤 Kies persoon…</option>
                  {adviseurs.map((a) => (
                    <option key={a.id} value={a.id}>
                      👤 {a.naam}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[10px] font-semibold uppercase text-muted">
                Due date
                <input
                  type="date"
                  value={newDue}
                  onChange={(e) => setNewDue(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
                />
              </label>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={creatingTaak}
                onClick={() => void createTaak()}
                className="bg-orange px-3 py-2 text-xs font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50"
              >
                {creatingTaak ? "Bezig…" : "Taak aanmaken"}
              </button>
            </div>
          </div>
        ) : null}

        {taken.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">
            Nog geen taken. Maak er zelf een aan met + Taak, of wijzig de
            projectstatus voor automatische taken.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {taken.map((t) => {
              const person = Array.isArray(t.verantwoordelijke)
                ? t.verantwoordelijke[0]
                : t.verantwoordelijke;
              return (
                <li
                  key={t.id}
                  className={[
                    "flex flex-wrap items-start justify-between gap-3 px-4 py-3",
                    t.status === "done" ? "opacity-50" : "",
                  ].join(" ")}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{t.titel}</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {t.afdeling}
                      {t.due_at ? ` · Due ${formatDateShort(t.due_at)}` : ""}
                      {t.auto_key ? " · Auto" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {person ? (
                      <span className="inline-flex items-center gap-1">
                        <span aria-hidden>👤</span>
                        {person.naam}
                      </span>
                    ) : (
                      <span className="text-[#C45A12]">👤 Niet toegewezen</span>
                    )}
                    <span className="rounded-full bg-wash px-2 py-0.5 font-semibold uppercase tracking-wide text-muted">
                      {t.status === "todo"
                        ? "Te doen"
                        : t.status === "doing"
                          ? "Bezig"
                          : "Klaar"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Notitie-cards verkoper */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <section className="border border-line bg-white px-4 py-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#1A4A6E]">
            Notitie backoffice
          </h2>
          {project.backoffice_notitie_door?.trim() ? (
            <p className="mt-1 text-[11px] text-muted">
              {project.backoffice_notitie_door}
            </p>
          ) : null}
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
            {project.backoffice_notitie?.trim() || "—"}
          </p>
        </section>
        <section className="border border-line bg-white px-4 py-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#C45A12]">
            Notitie installateur
          </h2>
          {project.installateur_notitie_door?.trim() ? (
            <p className="mt-1 text-[11px] text-muted">
              {project.installateur_notitie_door}
            </p>
          ) : null}
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
            {project.installateur_notitie?.trim() || "—"}
          </p>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Activiteit + notities toevoegen */}
        <section className="border border-line bg-white">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              Activiteit
            </h2>
          </div>
          <div className="px-4 py-4">
            {feed.length === 0 ? (
              <p className="text-sm text-muted">Nog geen activiteit.</p>
            ) : (
              <ul className="space-y-3">
                {feed.map((item) => (
                  <li key={item.key} className="border-l-2 border-green/40 pl-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {formatDateTimeNl(item.at)}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-ink">
                      {item.title}
                    </p>
                    {item.body ? (
                      <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted">
                        {item.body}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 border-t border-line pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Notitie toevoegen
              </p>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={3}
                placeholder="Nieuwe notitie…"
                className="mt-2 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={noteBusy || !noteDraft.trim()}
                  onClick={() => void addNotitie()}
                  className="bg-orange px-3 py-2 text-xs font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50"
                >
                  {noteBusy ? "Opslaan…" : "Notitie opslaan"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Klantgegevens + agenda + foto's */}
        <div className="space-y-4">
          <section className="border border-line bg-white">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                Klantgegevens
              </h2>
            </div>
            <dl className="divide-y divide-line px-4">
              {(
                [
                  ["Naam", klantNaam],
                  ["Telefoon", lead?.telefoon || "—"],
                  ["E-mail", lead?.email || "—"],
                  ["Adres", adresRegel(project.leads)],
                  ["Installateur", partnerLabel || "Nog niet gekoppeld"],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 py-2.5">
                  <dt className="shrink-0 text-xs text-muted">{label}</dt>
                  <dd className="max-w-[65%] text-right text-sm font-medium text-ink">
                    {label === "Telefoon" && lead?.telefoon ? (
                      <a
                        href={`tel:${lead.telefoon}`}
                        className="text-green-dark hover:underline"
                      >
                        {value}
                      </a>
                    ) : label === "E-mail" && lead?.email ? (
                      <a
                        href={`mailto:${lead.email}`}
                        className="text-green-dark hover:underline"
                      >
                        {value}
                      </a>
                    ) : label === "Installateur" &&
                      partner &&
                      "telefoon" in partner &&
                      partner.telefoon ? (
                      <span>
                        <span className="block">{partner.naam}</span>
                        <a
                          href={`tel:${partner.telefoon}`}
                          className="text-xs font-normal text-green-dark hover:underline"
                        >
                          {partner.telefoon}
                        </a>
                        {"email" in partner && partner.email ? (
                          <a
                            href={`mailto:${partner.email}`}
                            className="mt-0.5 block text-xs font-normal text-green-dark hover:underline"
                          >
                            {partner.email}
                          </a>
                        ) : null}
                      </span>
                    ) : (
                      <span
                        className={
                          value.startsWith("Nog niet")
                            ? "font-normal text-muted"
                            : undefined
                        }
                      >
                        {value}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 py-2.5">
                <dt className="shrink-0 text-xs text-muted">
                  Schouw week gepland {schouwValuePrimary ? "✅" : ""}
                </dt>
                <dd className="max-w-[65%] text-right text-sm font-medium text-ink">
                  {schouwValuePrimary ? (
                    <span className="block">
                      <span>{schouwValuePrimary}</span>
                      {schouwValueSecondary ? (
                        <span className="mt-0.5 block text-xs font-normal text-muted">
                          ({schouwValueSecondary})
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="font-normal text-muted">
                      Nog niet gepland
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-3 py-2.5">
                <dt className="shrink-0 text-xs text-muted">
                  Installatie gepland
                </dt>
                <dd className="max-w-[65%] text-right text-sm font-medium text-ink">
                  <span
                    className={
                      !installatieLabel
                        ? "font-normal text-muted"
                        : undefined
                    }
                  >
                    {installatieLabel || "Nog niet gepland"}
                  </span>
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
              <Link
                href={`/leads/${project.lead_id}`}
                className="border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
              >
                Open lead
              </Link>
              {project.offerte_id ? (
                <Link
                  href={`/offertes/${project.offerte_id}`}
                  className="border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                >
                  Open offerte
                </Link>
              ) : null}
            </div>
          </section>

          <ProjectFinancieelSection
            projectId={project.id}
            leadEmail={lead?.email}
          />

          <section className="border border-line bg-white">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                Foto&apos;s ({fotos.length})
              </h2>
              <label className="cursor-pointer border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash">
                {uploading ? "Bezig…" : "+ Upload"}
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
            <div className="px-4 py-4">
              {fotos.length === 0 ? (
                <p className="text-sm text-muted">Nog geen foto&apos;s.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {fotos.map((f) => (
                    <li key={f.id} className="overflow-hidden border border-line">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={f.url || undefined}
                        alt={f.bestandsnaam || "Foto"}
                        className="aspect-square w-full object-cover"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="mt-4">
        <ProjectAgendaAfspraakSection
          project={project}
          onChanged={() => void load()}
        />
      </div>
    </DetailShell>
  );
}
