"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Factuur, Lead, Offerte, Project } from "@/types/database";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import { adresRegel, formatDateTimeNl } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";
import { OffertesTable } from "./OffertesTable";
import { ProjectenTable } from "./ProjectenTable";
import { FacturenTable } from "./FacturenTable";
import {
  BackLink,
  Breadcrumb,
  DetailShell,
  HeroCard,
  InfoTile,
  NotFoundState,
  Panel,
} from "./DetailChrome";

type Section = "offertes" | "projecten" | "facturen";

export function LeadPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [lead, setLead] = useState<Lead | null>(null);
  const [offertes, setOffertes] = useState<Offerte[]>([]);
  const [projecten, setProjecten] = useState<Project[]>([]);
  const [facturen, setFacturen] = useState<Factuur[]>([]);
  const [section, setSection] = useState<Section>("offertes");
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
      const [l, o, p, f] = await Promise.all([
        sb.from("leads").select("*").eq("id", id).single(),
        sb
          .from("offertes")
          .select(
            "*, leads(naam, email, lead_number, postcode, huisnummer, plaats)"
          )
          .eq("lead_id", id)
          .order("created_at", { ascending: false }),
        sb
          .from("projecten")
          .select("*, leads(naam, lead_number)")
          .eq("lead_id", id)
          .order("created_at", { ascending: false }),
        sb
          .from("facturen")
          .select("*, leads(naam, lead_number)")
          .eq("lead_id", id)
          .order("created_at", { ascending: false }),
      ]);

      if (l.error || !l.data) {
        setNotFound(true);
      } else {
        setLead(l.data as Lead);
        setOffertes((o.data as Offerte[]) || []);
        setProjecten((p.data as Project[]) || []);
        setFacturen((f.data as Factuur[]) || []);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(frame);
  }, [load]);

  function openSignLink(o: Offerte) {
    if (!o.sign_token) return;
    window.open(`/offerte/${o.sign_token}`, "_blank");
  }

  if (loading) {
    return (
      <DetailShell>
        <p className="py-20 text-center text-sm text-muted">Lead laden…</p>
      </DetailShell>
    );
  }

  if (notFound || !lead) {
    return (
      <NotFoundState
        title="Lead niet gevonden"
        backHref="/"
        backLabel="Terug naar leads"
      />
    );
  }

  const sections: { id: Section; label: string; count: number }[] = [
    { id: "offertes", label: "Offertes", count: offertes.length },
    { id: "projecten", label: "Projecten", count: projecten.length },
    { id: "facturen", label: "Facturen", count: facturen.length },
  ];

  return (
    <DetailShell onRefresh={load} loading={loading}>
      <Breadcrumb
        items={[{ label: "Leads", href: "/" }, { label: lead.lead_number }]}
      />

      <HeroCard>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-semibold text-green-dark">
              {lead.lead_number}
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-green-deeper">
              {lead.naam}
            </h1>
            <p className="mt-2 text-sm text-muted">
              Aangemaakt {formatDateTimeNl(lead.created_at)}
              {lead.bron ? ` · via ${lead.bron}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge kind="lead" value={lead.status} />
            <StatusBadge kind="prioriteit" value={lead.prioriteit} />
          </div>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoTile label="E-mail" value={lead.email} />
          <InfoTile label="Telefoon" value={lead.telefoon} />
          <InfoTile label="Adres" value={adresRegel(lead)} />
          <InfoTile
            label="UTM source"
            value={lead.utm_source}
            accent={Boolean(lead.utm_source)}
          />
        </div>

        {(lead.utm_medium || lead.utm_campaign || lead.notities) && (
          <div className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-3">
            {lead.utm_medium && (
              <InfoTile label="utm_medium" value={lead.utm_medium} />
            )}
            {lead.utm_campaign && (
              <InfoTile label="utm_campaign" value={lead.utm_campaign} />
            )}
            {lead.notities && (
              <div className="border border-line bg-wash px-4 py-3 sm:col-span-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Notities
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink">
                  {lead.notities}
                </p>
              </div>
            )}
          </div>
        )}
      </HeroCard>

      <div className="mt-5 grid grid-cols-3 gap-3">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={[
              "border px-4 py-3.5 text-left transition",
              section === s.id
                ? "border-green bg-green-soft"
                : "border-line bg-white hover:border-green/40",
            ].join(" ")}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              {s.label}
            </p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-green-deeper">
              {s.count}
            </p>
          </button>
        ))}
      </div>

      <Panel
        title={sections.find((s) => s.id === section)?.label || ""}
        subtitle={`Gekoppeld aan ${lead.lead_number}`}
      >
        {section === "offertes" && (
          <OffertesTable offertes={offertes} onOpenSign={openSignLink} />
        )}
        {section === "projecten" && <ProjectenTable projecten={projecten} />}
        {section === "facturen" && <FacturenTable facturen={facturen} />}
      </Panel>

      <BackLink href="/" label="Alle leads" />
    </DetailShell>
  );
}
