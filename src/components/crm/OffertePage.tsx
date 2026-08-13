"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Factuur, Offerte, OfferteRegel, Project } from "@/types/database";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import {
  formatDateNl,
  formatDateShort,
  formatDateTimeNl,
  formatEuro,
} from "@/lib/format";
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

export function OffertePage() {
  const { id } = useParams<{ id: string }>();
  const [offerte, setOfferte] = useState<Offerte | null>(null);
  const [regels, setRegels] = useState<OfferteRegel[]>([]);
  const [projecten, setProjecten] = useState<Project[]>([]);
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
      const [o, p, f] = await Promise.all([
        sb
          .from("offertes")
          .select(
            "*, leads(naam, email, lead_number, postcode, huisnummer, plaats), offerte_regels(*)"
          )
          .eq("id", id)
          .single(),
        sb
          .from("projecten")
          .select("*, leads(naam, lead_number)")
          .eq("offerte_id", id),
        sb
          .from("facturen")
          .select("*, leads(naam, lead_number)")
          .eq("offerte_id", id),
      ]);

      if (o.error || !o.data) {
        setNotFound(true);
      } else {
        const data = o.data as Offerte;
        setOfferte(data);
        setRegels(
          ((data.offerte_regels as OfferteRegel[]) || []).sort(
            (a, b) => a.sort_order - b.sort_order
          )
        );
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
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  if (loading) {
    return (
      <DetailShell>
        <p className="py-20 text-center text-sm text-muted">Offerte laden…</p>
      </DetailShell>
    );
  }

  if (notFound || !offerte) {
    return (
      <NotFoundState
        title="Offerte niet gevonden"
        backHref="/?tab=offertes"
        backLabel="Terug naar offertes"
      />
    );
  }

  return (
    <DetailShell onRefresh={load} loading={loading}>
      <Breadcrumb
        items={[
          { label: "Offertes", href: "/?tab=offertes" },
          { label: offerte.offerte_nummer },
        ]}
      />

      <HeroCard>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-semibold text-green-dark">
              {offerte.offerte_nummer}
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-green-deeper sm:text-4xl">
              {offerte.titel || "Offerte"}
            </h1>
            <p className="mt-2 text-sm text-muted">
              Aangemaakt {formatDateTimeNl(offerte.created_at)}
            </p>
          </div>
          <StatusBadge kind="offerte" value={offerte.status} />
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoTile
            label="Lead"
            value={offerte.leads?.lead_number || offerte.lead_id.slice(0, 8)}
            href={`/leads/${offerte.lead_id}`}
            accent
          />
          <InfoTile label="Klant" value={offerte.leads?.naam} />
          <InfoTile
            label="Totaal incl. btw"
            value={formatEuro(offerte.totaal_inc_btw)}
          />
          <InfoTile
            label="Geldig tot"
            value={formatDateShort(offerte.geldig_tot)}
          />
        </div>

        {offerte.intro_tekst && (
          <p className="mt-6 border-t border-line pt-6 text-sm leading-relaxed text-ink">
            {offerte.intro_tekst}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {offerte.sign_token && offerte.status !== "ondertekend" && (
            <a
              href={`/offerte/${offerte.sign_token}`}
              target="_blank"
              rel="noreferrer"
              className="bg-orange px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c]"
            >
              Open ondertekenlink →
            </a>
          )}
          {offerte.status === "ondertekend" && (
            <span className="border border-green/25 bg-green-soft px-3 py-1.5 text-sm font-medium text-green-dark">
              Ondertekend door {offerte.ondertekend_naam} op{" "}
              {formatDateNl(offerte.ondertekend_op)}
            </span>
          )}
        </div>
      </HeroCard>

      <Panel title="Regels" subtitle={`${regels.length} producten`}>
        {regels.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">
            Geen regels op deze offerte.
          </p>
        ) : (
          <table className="crm-table">
            <thead>
              <tr>
                <th>Omschrijving</th>
                <th>Aantal</th>
                <th>Prijs</th>
                <th>Totaal</th>
              </tr>
            </thead>
            <tbody>
              {regels.map((r) => (
                <tr key={r.id}>
                  <td>{r.omschrijving}</td>
                  <td>{r.aantal}</td>
                  <td>{formatEuro(r.prijs_ex_btw)}</td>
                  <td className="font-medium">
                    {formatEuro(r.totaal_ex_btw ?? r.aantal * r.prijs_ex_btw)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-4 space-y-1 border-t border-line px-3 pt-4 text-right text-sm">
          <p className="text-muted">
            Subtotaal excl. btw{" "}
            <span className="ml-4 inline-block w-28 text-ink">
              {formatEuro(offerte.subtotaal_ex_btw)}
            </span>
          </p>
          <p className="text-muted">
            Btw{" "}
            <span className="ml-4 inline-block w-28 text-ink">
              {formatEuro(offerte.btw_bedrag)}
            </span>
          </p>
          <p className="font-display text-lg font-semibold text-green-deeper">
            Totaal{" "}
            <span className="ml-4 inline-block w-28">
              {formatEuro(offerte.totaal_inc_btw)}
            </span>
          </p>
        </div>
      </Panel>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Panel title="Gekoppelde projecten" subtitle={`${projecten.length}`}>
          {projecten.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              Geen projecten
            </p>
          ) : (
            <ul className="space-y-2 px-2">
              {projecten.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projecten/${p.id}`}
                    className="flex items-center justify-between px-3 py-2.5 hover:bg-green-soft"
                  >
                    <span className="font-mono text-xs font-semibold text-green-dark">
                      {p.project_nummer}
                    </span>
                    <StatusBadge kind="project" value={p.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Gekoppelde facturen" subtitle={`${facturen.length}`}>
          {facturen.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              Geen facturen
            </p>
          ) : (
            <ul className="space-y-2 px-2">
              {facturen.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/facturen/${f.id}`}
                    className="flex items-center justify-between px-3 py-2.5 hover:bg-green-soft"
                  >
                    <span className="font-mono text-xs font-semibold text-green-dark">
                      {f.factuur_nummer}
                    </span>
                    <span className="text-sm font-medium">
                      {formatEuro(f.bedrag_inc_btw)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <BackLink href="/?tab=offertes" label="Alle offertes" />
    </DetailShell>
  );
}
