"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { OfferteRegel, Project, ProjectFoto } from "@/types/database";
import { projectStatusLabel } from "@/lib/labels";
import {
  adresRegel,
  formatDateTimeLongNl,
  formatEuro,
} from "@/lib/format";

type OrderDetail = Project & {
  leads?: Project["leads"];
};

type OfferteSummary = {
  offerte_nummer: string;
  titel: string | null;
  status: string;
  subtotaal_ex_btw: number;
  btw_bedrag: number;
  totaal_inc_btw: number;
  intro_tekst: string | null;
  offerte_regels?: Pick<
    OfferteRegel,
    "omschrijving" | "aantal" | "prijs_ex_btw" | "totaal_ex_btw" | "sort_order"
  >[];
};

export function InstallatieOrderDetailPage() {
  const { token, projectId } = useParams<{
    token: string;
    projectId: string;
  }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [fotos, setFotos] = useState<ProjectFoto[]>([]);
  const [offerte, setOfferte] = useState<OfferteSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/installatie/${token}/orders/${projectId}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Niet gevonden");
      setOrder(data.order);
      setFotos(data.fotos || []);
      setOfferte(data.offerte);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [token, projectId]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-wash">
        <p className="text-sm text-muted">Order laden…</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-wash px-4 py-16">
        <div className="mx-auto max-w-3xl">
          <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
            {error || "Order niet gevonden"}
          </p>
          <Link
            href={`/installatie/${token}`}
            className="mt-4 inline-block text-sm font-semibold text-green-dark hover:underline"
          >
            ← Terug naar orders
          </Link>
        </div>
      </div>
    );
  }

  const lead = Array.isArray(order.leads) ? order.leads[0] : order.leads;
  const adres = lead ? adresRegel(lead) : "—";
  const mapsQuery = adres !== "—" ? adres : null;

  return (
    <div className="min-h-screen bg-wash">
      <header className="border-b border-line bg-green-dark px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <Link
            href={`/installatie/${token}`}
            className="text-sm font-medium text-white/70 hover:text-white"
          >
            ← Alle orders
          </Link>
          <p className="mt-3 font-mono text-xs font-semibold text-orange">
            {order.project_nummer}
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-white">
            {lead?.naam || order.titel || "Order"}
          </h1>
          <p className="mt-1 text-sm text-white/70">
            {projectStatusLabel[order.status] || order.status}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        {order.schouw_at && (
          <section className="border border-line bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Schouw
            </p>
            <p className="mt-1 text-lg font-semibold capitalize text-ink">
              {formatDateTimeLongNl(order.schouw_at)}
            </p>
            {order.schouw_notities && (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {order.schouw_notities}
              </p>
            )}
          </section>
        )}

        <section className="border border-line bg-white p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Klantgegevens
          </p>
          <p className="mt-1 text-base font-semibold text-ink">
            {lead?.naam || "—"}
          </p>
          {lead?.lead_number && (
            <p className="font-mono text-xs text-muted">{lead.lead_number}</p>
          )}
          <div className="mt-3 space-y-1 text-sm text-ink">
            <p>{adres}</p>
            {lead?.telefoon && (
              <p>
                <a href={`tel:${lead.telefoon}`} className="hover:text-green">
                  {lead.telefoon}
                </a>
              </p>
            )}
            {lead?.email && (
              <p>
                <a href={`mailto:${lead.email}`} className="hover:text-green">
                  {lead.email}
                </a>
              </p>
            )}
          </div>
          {mapsQuery && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <a
                href={`https://waze.com/ul?q=${encodeURIComponent(mapsQuery)}&navigate=yes`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center justify-center bg-[#33CCFF] px-4 text-sm font-bold text-[#0A2A3A]"
              >
                Open in Waze
              </a>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsQuery)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center justify-center bg-green px-4 text-sm font-bold text-white"
              >
                Open in Google Maps
              </a>
            </div>
          )}
        </section>

        {(lead?.notities?.trim() || order.notities?.trim()) && (
          <section className="border border-line bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Notities
            </p>
            {lead?.notities?.trim() && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold text-muted">Lead</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {lead.notities}
                </p>
              </div>
            )}
            {order.notities?.trim() && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold text-muted">Project</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {order.notities}
                </p>
              </div>
            )}
          </section>
        )}

        <section className="border border-line bg-white p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Foto&apos;s ({fotos.length})
          </p>
          {fotos.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Geen foto&apos;s beschikbaar.</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {fotos.map((f) =>
                f.url ? (
                  <a
                    key={f.id}
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block border border-line"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={f.url}
                      alt={f.bestandsnaam || "Foto"}
                      className="aspect-square w-full object-cover"
                    />
                  </a>
                ) : null
              )}
            </div>
          )}
        </section>

        {offerte && (
          <section className="border border-line bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Offerte
            </p>
            <p className="mt-1 font-mono text-sm font-semibold text-ink">
              {offerte.offerte_nummer}
            </p>
            {offerte.titel && (
              <p className="text-sm text-muted">{offerte.titel}</p>
            )}
            {offerte.offerte_regels && offerte.offerte_regels.length > 0 && (
              <ul className="mt-3 space-y-2 border-t border-line pt-3">
                {offerte.offerte_regels.map((r, i) => (
                  <li
                    key={i}
                    className="flex justify-between gap-3 text-sm text-ink"
                  >
                    <span>
                      {r.aantal}× {r.omschrijving}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {formatEuro(r.totaal_ex_btw)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-right text-sm font-semibold text-ink">
              Totaal incl. btw {formatEuro(offerte.totaal_inc_btw)}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
