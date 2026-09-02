"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Project, ProjectFoto } from "@/types/database";
import { projectStatusLabel } from "@/lib/labels";
import { adresRegel, formatDateTimeLongNl } from "@/lib/format";
import { formatProjectSchouwWeek } from "@/lib/schouw-week";

type OrderDetail = Project & {
  leads?: Project["leads"];
};

export function InstallatieOrderDetailPage() {
  const { token, projectId } = useParams<{
    token: string;
    projectId: string;
  }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [fotos, setFotos] = useState<ProjectFoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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

  async function uploadFoto(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/installatie/${token}/orders/${projectId}/fotos`,
        { method: "POST", body: form }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload mislukt");
      if (data.foto) setFotos((prev) => [...prev, data.foto]);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload mislukt");
    } finally {
      setUploading(false);
    }
  }

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
        <section className="border border-line bg-white p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Schouw
          </p>
          {formatProjectSchouwWeek(order) ? (
            <p className="mt-1 text-lg font-semibold text-ink">
              {formatProjectSchouwWeek(order)}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">Nog geen schouwweek.</p>
          )}
          {order.schouw_notities?.trim() ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {order.schouw_notities}
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted">Geen schouw-notities.</p>
          )}

          <div className="mt-5 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Foto&apos;s ({fotos.length})
              </p>
              <label className="cursor-pointer text-xs font-semibold text-green-dark underline-offset-2 hover:underline">
                {uploading ? "Uploaden…" : "Foto toevoegen"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
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
            <p className="mt-1 text-[11px] text-muted">
              Inclusief foto&apos;s van de adviseur. Jij kunt er zelf ook
              toevoegen.
            </p>
            {uploadError && (
              <p className="mt-2 text-xs text-[#C62828]">{uploadError}</p>
            )}
            {fotos.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Nog geen foto&apos;s.</p>
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
          </div>
        </section>

        <section className="border border-line bg-white p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Installatie
          </p>
          {order.installatie_at ? (
            <p className="mt-1 text-lg font-semibold capitalize text-ink">
              {formatDateTimeLongNl(order.installatie_at)}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">
              Nog geen installatiedatum.
            </p>
          )}
          {order.installatie_notities?.trim() ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {order.installatie_notities}
            </p>
          ) : null}
        </section>

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

        {order.installateur_notitie?.trim() && (
          <section className="border border-line bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Notitie voor installateur
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {order.installateur_notitie}
            </p>
            {order.installateur_notitie_door?.trim() && (
              <p className="mt-2 text-[11px] text-muted">
                — {order.installateur_notitie_door}
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
