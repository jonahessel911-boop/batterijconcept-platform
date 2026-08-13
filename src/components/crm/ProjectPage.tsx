"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Factuur, Offerte, Project } from "@/types/database";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import { formatDateShort, formatDateTimeNl, formatEuro } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";
import {
  BackLink,
  Breadcrumb,
  DetailShell,
  HeroCard,
  InfoTile,
  NotFoundState,
  Panel,
} from "./DetailChrome";

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [offerte, setOfferte] = useState<Offerte | null>(null);
  const [facturen, setFacturen] = useState<Factuur[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
        .select("*, leads(naam, lead_number)")
        .eq("id", id)
        .single();

      if (error || !data) {
        setNotFound(true);
      } else {
        const proj = data as Project;
        setProject(proj);

        const [o, f] = await Promise.all([
          proj.offerte_id
            ? sb
                .from("offertes")
                .select(
                  "*, leads(naam, email, lead_number, postcode, huisnummer, plaats)"
                )
                .eq("id", proj.offerte_id)
                .single()
            : Promise.resolve({ data: null }),
          sb
            .from("facturen")
            .select("*, leads(naam, lead_number)")
            .eq("project_id", id),
        ]);

        setOfferte((o.data as Offerte) || null);
        setFacturen((f.data as Factuur[]) || []);
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

  if (loading) {
    return (
      <DetailShell>
        <p className="py-20 text-center text-sm text-muted">Project laden…</p>
      </DetailShell>
    );
  }

  if (notFound || !project) {
    return (
      <NotFoundState
        title="Project niet gevonden"
        backHref="/?tab=projecten"
        backLabel="Terug naar projecten"
      />
    );
  }

  return (
    <DetailShell onRefresh={load} loading={loading}>
      <Breadcrumb
        items={[
          { label: "Projecten", href: "/?tab=projecten" },
          { label: project.project_nummer },
        ]}
      />

      <HeroCard>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-semibold text-green-dark">
              {project.project_nummer}
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-green-deeper sm:text-4xl">
              {project.titel || "Project"}
            </h1>
            <p className="mt-2 text-sm text-muted">
              Aangemaakt {formatDateTimeNl(project.created_at)}
            </p>
          </div>
          <StatusBadge kind="project" value={project.status} />
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoTile
            label="Lead"
            value={project.leads?.lead_number || project.lead_id.slice(0, 8)}
            href={`/leads/${project.lead_id}`}
            accent
          />
          <InfoTile label="Klant" value={project.leads?.naam} />
          <InfoTile label="Monteur" value={project.monteur} />
          <InfoTile
            label="Startdatum"
            value={formatDateShort(project.startdatum)}
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoTile
            label="Opleverdatum"
            value={formatDateShort(project.opleverdatum)}
          />
          {offerte && (
            <InfoTile
              label="Offerte"
              value={offerte.offerte_nummer}
              href={`/offertes/${offerte.id}`}
            />
          )}
        </div>

        {project.notities && (
          <p className="mt-6 border-t border-line pt-6 text-sm leading-relaxed text-ink">
            {project.notities}
          </p>
        )}
      </HeroCard>

      <Panel title="Gekoppelde facturen" subtitle={`${facturen.length}`}>
        {facturen.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted">
            Nog geen facturen op dit project.
          </p>
        ) : (
          <table className="crm-table">
            <thead>
              <tr>
                <th>Factuur</th>
                <th>Omschrijving</th>
                <th>Status</th>
                <th>Bedrag</th>
                <th>Vervaldatum</th>
              </tr>
            </thead>
            <tbody>
              {facturen.map((f) => (
                <tr key={f.id}>
                  <td className="font-mono text-[11px] font-semibold text-green-dark">
                    <Link
                      href={`/facturen/${f.id}`}
                      className="hover:underline"
                    >
                      {f.factuur_nummer}
                    </Link>
                  </td>
                  <td className="text-muted">{f.omschrijving || "—"}</td>
                  <td>
                    <StatusBadge kind="factuur" value={f.status} />
                  </td>
                  <td className="font-medium">{formatEuro(f.bedrag_inc_btw)}</td>
                  <td className="text-muted">
                    {formatDateShort(f.vervaldatum)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <BackLink href="/?tab=projecten" label="Alle projecten" />
    </DetailShell>
  );
}
