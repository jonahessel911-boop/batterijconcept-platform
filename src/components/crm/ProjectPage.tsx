"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Factuur, Offerte, Project, ProjectStatus, ServiceVerzoek } from "@/types/database";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import { formatDateShort, formatDateTimeNl, formatEuro } from "@/lib/format";
import {
  aanbetalingVanOrder,
  openstaandOpOrder,
} from "@/lib/aanbetaling";
import { AanbetalingSamenvatting } from "./AanbetalingInstelling";
import { STANDAARD_INSTALLATIEKOSTEN } from "@/lib/project-kosten";
import {
  PROJECT_STATUSES,
  projectStatusLabel,
  statusTone,
} from "@/lib/labels";
import { StatusBadge } from "./StatusBadge";
import { ProjectServiceSection } from "./ProjectServiceSection";
import { ProjectSchouwSection } from "./ProjectSchouwSection";
import { Breadcrumb, DetailShell, NotFoundState } from "./DetailChrome";

type ProjectTab = "activiteit" | "schouw" | "betaling";

type FeedItem = {
  key: string;
  at: string;
  kind: "note" | "event";
  title: string;
  body?: string;
  author?: string;
};

function monthLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
}

function groupFeedByMonth(items: FeedItem[]) {
  const groups: { month: string; items: FeedItem[] }[] = [];
  for (const item of items) {
    const month = monthLabel(item.at);
    const last = groups[groups.length - 1];
    if (last?.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }
  return groups;
}

function SidebarField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="py-2.5">
      <p className="text-[11px] font-medium text-muted">{label}</p>
      <div className="mt-0.5 text-sm text-ink">{children}</div>
    </div>
  );
}

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [offerte, setOfferte] = useState<Offerte | null>(null);
  const [facturen, setFacturen] = useState<Factuur[]>([]);
  const [serviceVerzoeken, setServiceVerzoeken] = useState<ServiceVerzoek[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [kostenInput, setKostenInput] = useState("");
  const [kostenSaving, setKostenSaving] = useState(false);
  const [tab, setTab] = useState<ProjectTab>("activiteit");
  const [aboutOpen, setAboutOpen] = useState(true);

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
      const { data, error } = await sb
        .from("projecten")
        .select(
          "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon)"
        )
        .eq("id", id)
        .single();

      if (error || !data) {
        setNotFound(true);
      } else {
        const proj = data as Project;
        setProject(proj);
        setKostenInput(
          proj.projectkosten != null && Number(proj.projectkosten) !== 0
            ? String(proj.projectkosten)
            : String(STANDAARD_INSTALLATIEKOSTEN)
        );

        const [o, f, sv] = await Promise.all([
          proj.offerte_id
            ? sb
                .from("offertes")
                .select(
                  "*, leads(naam, email, lead_number, postcode, huisnummer, plaats), offerte_regels(omschrijving, aantal)"
                )
                .eq("id", proj.offerte_id)
                .single()
            : Promise.resolve({ data: null }),
          sb
            .from("facturen")
            .select("*, leads(naam, lead_number)")
            .eq("project_id", id),
          sb
            .from("service_verzoeken")
            .select("*")
            .eq("project_id", id)
            .order("created_at", { ascending: false }),
        ]);

        setOfferte((o.data as Offerte) || null);
        setFacturen((f.data as Factuur[]) || []);
        if (sv && "error" in sv && sv.error) {
          setServiceVerzoeken([]);
        } else {
          setServiceVerzoeken(
            ((sv as { data: ServiceVerzoek[] | null }).data as ServiceVerzoek[]) ||
              []
          );
        }
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
    const prev = project.status;
    setProject({ ...project, status });
    setStatusSaving(true);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Status bijwerken mislukt");
      if (data.project) setProject(data.project as Project);
    } catch {
      setProject({ ...project, status: prev });
    } finally {
      setStatusSaving(false);
    }
  }

  async function saveProjectkosten() {
    if (!project) return;
    const value = Number(kostenInput.replace(",", "."));
    if (Number.isNaN(value) || value < 0) return;
    setKostenSaving(true);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectkosten: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      if (data.project) {
        setProject(data.project as Project);
        setKostenInput(String(data.project.projectkosten ?? value));
      }
    } catch {
      /* ignore */
    } finally {
      setKostenSaving(false);
    }
  }

  const aanbetaling = offerte
    ? aanbetalingVanOrder({
        subtotaalExBtw: Number(offerte.subtotaal_ex_btw) || 0,
        btwBedrag: Number(offerte.btw_bedrag) || 0,
        totaalIncBtw: Number(offerte.totaal_inc_btw) || 0,
        modus: offerte.aanbetaling_modus,
        handmatigIncBtw: Number(offerte.aanbetaling_bedrag_inc) || 0,
        financieringVoorbehoud: Boolean(offerte.financiering_voorbehoud),
      })
    : null;
  const financieel = offerte
    ? openstaandOpOrder({
        orderIncBtw: Number(offerte.totaal_inc_btw) || 0,
        facturen,
      })
    : null;

  if (loading) {
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
        backHref="/?tab=projecten"
        backLabel="Terug naar backoffice"
        activeTab="projecten"
      />
    );
  }

  const klantAdres = [
    project.leads?.straat,
    [project.leads?.huisnummer, project.leads?.toevoeging]
      .filter(Boolean)
      .join(" "),
    [project.leads?.postcode, project.leads?.plaats]
      .filter(Boolean)
      .join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  const batterijRegel =
    offerte?.offerte_regels?.find((r) => /batterij/i.test(r.omschrijving)) || null;
  const omvormerRegel =
    offerte?.offerte_regels?.find((r) => /omvormer/i.test(r.omschrijving)) || null;

  const klantNaam = project.leads?.naam || project.titel || "Klant";
  const initial = klantNaam.charAt(0).toUpperCase();

  const feedItems: FeedItem[] = [
    {
      key: `project-created-${project.id}`,
      at: project.created_at,
      kind: "event",
      title: "Backoffice aangemaakt",
      body: project.project_nummer,
    },
    ...facturen.map((f) => ({
      key: `factuur-${f.id}`,
      at: f.factuurdatum || f.created_at!,
      kind: "event" as const,
      title: "Factuur gekoppeld",
      body: `${f.factuur_nummer} · ${formatEuro(f.bedrag_inc_btw)}`,
    })),
    ...serviceVerzoeken.map((v) => ({
      key: `service-${v.id}`,
      at: v.created_at!,
      kind: "event" as const,
      title: "Serviceverzoek",
      body: v.onderwerp || v.omschrijving || "Nieuw serviceverzoek",
    })),
  ];

  if (offerte?.ondertekend_op) {
    feedItems.push({
      key: `offerte-signed-${offerte.id}`,
      at: offerte.ondertekend_op,
      kind: "event",
      title: "Offerte ondertekend",
      body:
        offerte.ondertekend_naam && offerte.offerte_nummer
          ? `${offerte.ondertekend_naam} · ${offerte.offerte_nummer}`
          : offerte.offerte_nummer || undefined,
    });
  }
  if (project.schouw_at) {
    feedItems.push({
      key: `project-schouw-${project.id}`,
      at: project.schouw_at,
      kind: "event",
      title: "Schouw gepland",
      body: project.monteur || project.installatie_partners?.naam || undefined,
    });
  }
  if (project.installatie_at) {
    feedItems.push({
      key: `project-installatie-${project.id}`,
      at: project.installatie_at,
      kind: "event",
      title: "Installatie gepland",
      body: project.monteur || project.installatie_partners?.naam || undefined,
    });
  }
  if (project.opleverdatum) {
    feedItems.push({
      key: `project-oplevering-${project.id}`,
      at: project.opleverdatum,
      kind: "event",
      title: "Oplevering gepland",
    });
  }
  if (project.backoffice_afgerond_at) {
    feedItems.push({
      key: `backoffice-done-${project.id}`,
      at: project.backoffice_afgerond_at,
      kind: "event",
      title: "Backoffice afgerond",
    });
  }
  if (project.backoffice_notitie) {
    feedItems.push({
      key: "note-backoffice",
      at: project.updated_at || project.created_at,
      kind: "note",
      title: "Notitie backoffice",
      body: project.backoffice_notitie,
      author: "Backoffice",
    });
  }
  if (project.installateur_notitie) {
    feedItems.push({
      key: "note-installateur",
      at: project.updated_at || project.created_at,
      kind: "note",
      title: "Notitie installateur",
      body: project.installateur_notitie,
      author: "Installateur",
    });
  }

  feedItems.sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );

  const feedGroups = groupFeedByMonth(feedItems);

  const tabs: { id: ProjectTab; label: string }[] = [
    { id: "activiteit", label: "Activiteit" },
    { id: "schouw", label: "Schouw & installatie" },
    { id: "betaling", label: "Betaling" },
  ];

  return (
    <DetailShell onRefresh={load} loading={loading} activeTab="projecten">
      <Breadcrumb
        items={[
          { label: "Backoffice", href: "/?tab=projecten" },
          { label: project.project_nummer },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-[17rem_1fr] xl:grid-cols-[19rem_1fr]">
        {/* Linker sidebar — HubSpot-stijl */}
        <aside className="rounded-lg border border-line bg-white">
          <div className="border-b border-line px-4 py-5 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green/10 text-xl font-semibold text-green-dark">
              {initial}
            </div>
            <p className="mt-3 font-mono text-xs text-muted">{project.project_nummer}</p>
            <h2 className="mt-1 font-display text-lg font-semibold text-ink">{klantNaam}</h2>
            {project.leads?.email ? (
              <a
                href={`mailto:${project.leads.email}`}
                className="mt-1 inline-block text-sm text-green-dark hover:underline"
              >
                {project.leads.email}
              </a>
            ) : null}
            {project.leads?.telefoon ? (
              <a
                href={`tel:${project.leads.telefoon}`}
                className="mt-0.5 block text-sm text-muted hover:text-ink"
              >
                {project.leads.telefoon}
              </a>
            ) : null}
            <div className="mt-4 flex justify-center gap-2">
              <Link
                href={`/leads/${project.lead_id}`}
                className="rounded border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-green/40 hover:text-green-dark"
              >
                Lead
              </Link>
              {offerte ? (
                <Link
                  href={`/offertes/${offerte.id}`}
                  className="rounded border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-green/40 hover:text-green-dark"
                >
                  Offerte
                </Link>
              ) : null}
            </div>
          </div>

          <div className="px-4 py-3">
            <button
              type="button"
              onClick={() => setAboutOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left text-sm font-semibold text-ink"
            >
              Over dit project
              <span className="text-muted">{aboutOpen ? "−" : "+"}</span>
            </button>
            {aboutOpen ? (
              <div className="mt-1 divide-y divide-line">
                <SidebarField label="Status">
                  <select
                    value={project.status}
                    disabled={statusSaving}
                    onChange={(e) => updateStatus(e.target.value as ProjectStatus)}
                    className={`w-full cursor-pointer border bg-white px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide outline-none focus:border-green disabled:opacity-60 ${statusTone("project", project.status)}`}
                    aria-label="Projectstatus"
                  >
                    {PROJECT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {projectStatusLabel[s]}
                      </option>
                    ))}
                  </select>
                </SidebarField>
                <SidebarField label="Offerte">
                  {offerte ? (
                    <Link
                      href={`/offertes/${offerte.id}`}
                      className="font-semibold text-green-dark hover:underline"
                    >
                      {offerte.offerte_nummer}
                    </Link>
                  ) : (
                    "—"
                  )}
                </SidebarField>
                <SidebarField label="Installatiepartner">
                  {project.installatie_partners?.naam || project.monteur || "—"}
                </SidebarField>
                <SidebarField label="Schouwdatum">
                  {project.schouw_at
                    ? formatDateTimeNl(project.schouw_at)
                    : "Nog niet gepland"}
                </SidebarField>
                <SidebarField label="Installatie">
                  {project.installatie_at
                    ? formatDateTimeNl(project.installatie_at)
                    : "Nog niet gepland"}
                </SidebarField>
                <SidebarField label="Opleverdatum">
                  {formatDateShort(project.opleverdatum)}
                </SidebarField>
                <SidebarField label="Openstaand">
                  <span className="font-semibold text-[#C45A12]">
                    {formatEuro(financieel?.openstaand || 0)}
                  </span>
                </SidebarField>
              </div>
            ) : null}
          </div>
        </aside>

        {/* Rechter kolom — hoofdcontent */}
        <div className="min-w-0">
          <header className="mb-5">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-green-deeper sm:text-3xl">
              {klantNaam}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {[klantAdres, project.leads?.telefoon, project.leads?.email]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {(batterijRegel || omvormerRegel) && (
              <p className="mt-2 text-sm text-ink">
                {[
                  batterijRegel
                    ? `${batterijRegel.omschrijving}${batterijRegel.aantal > 1 ? ` (${batterijRegel.aantal}x)` : ""}`
                    : null,
                  omvormerRegel
                    ? `${omvormerRegel.omschrijving}${omvormerRegel.aantal > 1 ? ` (${omvormerRegel.aantal}x)` : ""}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span>
                <span className="text-muted">Order </span>
                <span className="font-medium">{formatEuro(financieel?.orderIncBtw || 0)}</span>
              </span>
              <span>
                <span className="text-muted">Betaald </span>
                <span className="font-medium">{formatEuro(financieel?.reedsBetaald || 0)}</span>
              </span>
              <span>
                <span className="text-muted">Openstaand </span>
                <span className="font-semibold text-[#C45A12]">
                  {formatEuro(financieel?.openstaand || 0)}
                </span>
              </span>
            </div>
          </header>

          <div className="border-b border-line">
            <nav className="-mb-px flex gap-6 overflow-x-auto">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 border-b-2 pb-2.5 text-sm font-medium transition ${
                    tab === t.id
                      ? "border-green-dark text-green-deeper"
                      : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="mt-4 rounded-lg border border-line bg-white">
            {tab === "activiteit" && (
              <div>
                {feedGroups.length === 0 ? (
                  <p className="px-5 py-8 text-sm text-muted">Nog geen activiteit.</p>
                ) : (
                  feedGroups.map((group) => (
                    <section key={group.month}>
                      <h3 className="border-b border-line bg-[#fafafa] px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                        {group.month}
                      </h3>
                      <ul>
                        {group.items.map((item) => (
                          <li
                            key={item.key}
                            className="border-b border-line px-5 py-4 last:border-b-0"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <p className="text-sm">
                                <span className="font-semibold text-green-dark">
                                  {item.kind === "note"
                                    ? item.author || "Notitie"
                                    : item.title}
                                </span>
                                {item.kind === "note" ? (
                                  <span className="text-muted"> · {item.title}</span>
                                ) : null}
                              </p>
                              <time className="shrink-0 text-xs text-muted">
                                {formatDateTimeNl(item.at)}
                              </time>
                            </div>
                            {item.body ? (
                              <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
                                {item.body}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))
                )}

                <details className="border-t border-line">
                  <summary className="cursor-pointer list-none px-5 py-3 text-sm font-semibold text-ink marker:content-none">
                    Serviceverzoeken ({serviceVerzoeken.length})
                  </summary>
                  <div className="border-t border-line px-4 pb-4">
                    <ProjectServiceSection
                      project={project}
                      verzoeken={serviceVerzoeken}
                      onChanged={() => void load()}
                    />
                  </div>
                </details>
              </div>
            )}

            {tab === "schouw" && (
              <div className="p-5">
                <div className="mb-5 max-w-sm">
                  <p className="text-[11px] font-medium text-muted">
                    Installatiekosten (ex btw)
                  </p>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={kostenInput}
                      onChange={(e) => setKostenInput(e.target.value)}
                      className="w-full border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-green"
                    />
                    <button
                      type="button"
                      disabled={kostenSaving}
                      onClick={saveProjectkosten}
                      className="shrink-0 bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                    >
                      {kostenSaving ? "…" : "Opslaan"}
                    </button>
                  </div>
                </div>
                <ProjectSchouwSection
                  project={project}
                  embedded
                  onChanged={() => void load()}
                />
              </div>
            )}

            {tab === "betaling" && (
              <div className="p-5">
                <div className="max-w-md space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted">Orderbedrag</span>
                    <span className="font-medium">
                      {formatEuro(financieel?.orderIncBtw || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Aanbetaling</span>
                    <span className="font-medium">
                      {formatEuro(aanbetaling?.bedragIncBtw || 0)}
                    </span>
                  </div>
                  {offerte?.financiering_voorbehoud ? (
                    <div className="flex justify-between">
                      <span className="text-muted">Warmtefonds</span>
                      <span className="font-medium">
                        {formatEuro(aanbetaling?.restantIncBtw || 0)}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <span className="text-muted">Reeds betaald</span>
                    <span className="font-medium">
                      {formatEuro(financieel?.reedsBetaald || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-line pt-3">
                    <span className="text-muted">Aanbetaling te innen</span>
                    <span className="font-medium">
                      {formatEuro(Number(project.aanbetaling_te_innen_inc || 0))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Openstaand</span>
                    <span className="text-lg font-semibold text-[#C45A12]">
                      {formatEuro(financieel?.openstaand || 0)}
                    </span>
                  </div>
                  {offerte?.financiering_voorbehoud ? (
                    <div className="pt-1">
                      <AanbetalingSamenvatting
                        modus={aanbetaling?.modus ?? "restant"}
                        handmatigIncBtw={Number(offerte.aanbetaling_bedrag_inc) || 0}
                        subtotaalExBtw={Number(offerte.subtotaal_ex_btw) || 0}
                        btwBedrag={Number(offerte.btw_bedrag) || 0}
                        totaalIncBtw={Number(offerte.totaal_inc_btw) || 0}
                      />
                      <Link
                        href={`/offertes/${offerte.id}`}
                        className="mt-1 inline-block text-xs text-green-dark hover:underline"
                      >
                        Instelling via offerte
                      </Link>
                    </div>
                  ) : null}
                </div>

                <div className="mt-8 border-t border-line pt-6">
                  <h3 className="text-sm font-semibold text-ink">
                    Facturen ({facturen.length})
                  </h3>
                  {facturen.length === 0 ? (
                    <p className="mt-3 text-sm text-muted">Nog geen facturen.</p>
                  ) : (
                    <table className="crm-table mt-3">
                      <thead>
                        <tr>
                          <th>Factuur</th>
                          <th>Status</th>
                          <th>Bedrag</th>
                          <th>Datum</th>
                        </tr>
                      </thead>
                      <tbody>
                        {facturen.map((f) => (
                          <tr key={f.id}>
                            <td>
                              <Link
                                href={`/facturen/${f.id}`}
                                className="font-mono text-xs font-semibold text-orange hover:underline"
                              >
                                {f.factuur_nummer}
                              </Link>
                            </td>
                            <td>
                              <StatusBadge kind="factuur" value={f.status} />
                            </td>
                            <td className="tabular-nums">{formatEuro(f.bedrag_inc_btw)}</td>
                            <td className="text-muted">{formatDateShort(f.factuurdatum)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DetailShell>
  );
}
