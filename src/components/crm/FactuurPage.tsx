"use client";

import { useCallback, useEffect, useState } from "react";
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
} from "./DetailChrome";

export function FactuurPage() {
  const { id } = useParams<{ id: string }>();
  const [factuur, setFactuur] = useState<Factuur | null>(null);
  const [offerte, setOfferte] = useState<Offerte | null>(null);
  const [project, setProject] = useState<Project | null>(null);
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
        .from("facturen")
        .select("*, leads(naam, lead_number)")
        .eq("id", id)
        .single();

      if (error || !data) {
        setNotFound(true);
      } else {
        const fac = data as Factuur;
        setFactuur(fac);

        const [o, p] = await Promise.all([
          fac.offerte_id
            ? sb.from("offertes").select("*").eq("id", fac.offerte_id).single()
            : Promise.resolve({ data: null }),
          fac.project_id
            ? sb.from("projecten").select("*").eq("id", fac.project_id).single()
            : Promise.resolve({ data: null }),
        ]);

        setOfferte((o.data as Offerte) || null);
        setProject((p.data as Project) || null);
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
      <DetailShell activeTab="facturen">
        <p className="py-20 text-center text-sm text-muted">Factuur laden…</p>
      </DetailShell>
    );
  }

  if (notFound || !factuur) {
    return (
      <NotFoundState
        title="Factuur niet gevonden"
        backHref="/?tab=facturen"
        backLabel="Terug naar facturen"
        activeTab="facturen"
      />
    );
  }

  return (
    <DetailShell onRefresh={load} loading={loading} activeTab="facturen">
      <Breadcrumb
        items={[
          { label: "Facturen", href: "/?tab=facturen" },
          { label: factuur.factuur_nummer },
        ]}
      />

      <HeroCard>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-semibold text-green-dark">
              {factuur.factuur_nummer}
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-green-deeper sm:text-4xl">
              {factuur.omschrijving || "Factuur"}
            </h1>
            <p className="mt-2 text-sm text-muted">
              Aangemaakt {formatDateTimeNl(factuur.created_at)}
            </p>
          </div>
          <StatusBadge kind="factuur" value={factuur.status} />
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoTile
            label="Lead"
            value={factuur.leads?.lead_number || factuur.lead_id.slice(0, 8)}
            href={`/leads/${factuur.lead_id}`}
            accent
          />
          <InfoTile label="Klant" value={factuur.leads?.naam} />
          <InfoTile
            label="Bedrag incl. btw"
            value={formatEuro(factuur.bedrag_inc_btw)}
          />
          <InfoTile
            label="Factuurdatum"
            value={formatDateShort(factuur.factuurdatum)}
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoTile
            label="Vervaldatum"
            value={formatDateShort(factuur.vervaldatum)}
          />
          <InfoTile
            label="Betaald op"
            value={formatDateShort(factuur.betaald_op)}
          />
          <InfoTile
            label="Excl. btw"
            value={formatEuro(factuur.bedrag_ex_btw)}
          />
          <InfoTile label="Btw" value={formatEuro(factuur.btw_bedrag)} />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {offerte && (
            <InfoTile
              label="Offerte"
              value={offerte.offerte_nummer}
              href={`/offertes/${offerte.id}`}
            />
          )}
          {project && (
            <InfoTile
              label="Project"
              value={project.project_nummer}
              href={`/projecten/${project.id}`}
            />
          )}
        </div>

        {factuur.notities && (
          <p className="mt-6 border-t border-line pt-6 text-sm leading-relaxed text-ink">
            {factuur.notities}
          </p>
        )}
      </HeroCard>

      <BackLink href="/?tab=facturen" label="Alle facturen" />
    </DetailShell>
  );
}
