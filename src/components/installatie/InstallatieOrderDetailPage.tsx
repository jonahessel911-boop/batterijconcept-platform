"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Project, ProjectFoto, ProjectStatus } from "@/types/database";
import { adresRegel, formatDateTimeLongNl } from "@/lib/format";
import {
  formatProjectSchouwWeek,
  isSchouwdagDefinitief,
} from "@/lib/schouw-week";

type OrderDetail = Project & {
  leads?: Project["leads"];
};

/** Alleen installatie-statussen — geen backoffice-pipeline. */
const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "schouw_in_afwachting", label: "Schouw gepland" },
  { value: "schouw_voltooid", label: "Schouw voltooid" },
  { value: "materiaal_installatie", label: "Installatie gepland" },
];

function installerStatusOf(order: {
  status: string;
  installatie_at?: string | null;
  schouw_at?: string | null;
  schouw_week?: number | null;
}): ProjectStatus {
  if (STATUS_OPTIONS.some((o) => o.value === order.status)) {
    return order.status as ProjectStatus;
  }
  if (order.installatie_at) return "materiaal_installatie";
  if (order.schouw_at || order.schouw_week) return "schouw_in_afwachting";
  return "schouw_in_afwachting";
}

function installerStatusLabel(status: ProjectStatus): string {
  return (
    STATUS_OPTIONS.find((o) => o.value === status)?.label || "Schouw gepland"
  );
}

export function InstallatieOrderDetailPage() {
  const { token, projectId } = useParams<{
    token: string;
    projectId: string;
  }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [offerte, setOfferte] = useState<{
    id: string;
    offerte_nummer: string;
    status: string;
    ondertekend_op: string | null;
  } | null>(null);
  const [fotos, setFotos] = useState<ProjectFoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [status, setStatus] = useState<ProjectStatus>("schouw_in_afwachting");
  const [schouwNotities, setSchouwNotities] = useState("");
  const [installatieNotities, setInstallatieNotities] = useState("");

  const syncForm = useCallback((o: OrderDetail) => {
    setStatus(installerStatusOf(o));
    setSchouwNotities(o.schouw_notities || "");
    setInstallatieNotities(o.installatie_notities || "");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/installatie/${token}/orders/${projectId}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Niet gevonden");
      const o = data.order as OrderDetail;
      setOrder(o);
      setOfferte(data.offerte || null);
      setFotos(data.fotos || []);
      syncForm(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [token, projectId, syncForm]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  async function patchOrder(
    body: Record<string, unknown>,
    busyKey: string,
    ok: string
  ) {
    setBusy(busyKey);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie/${token}/orders/${projectId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      const o = data.order as OrderDetail;
      setOrder(o);
      syncForm(o);
      setOkMsg(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function saveStatus() {
    await patchOrder({ status }, "status", "Status opgeslagen.");
  }

  async function saveNotities() {
    await patchOrder(
      {
        schouw_notities: schouwNotities,
        installatie_notities: installatieNotities,
      },
      "notities",
      "Notities opgeslagen."
    );
  }

  async function uploadFotos(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of list) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(
          `/api/installatie/${token}/orders/${projectId}/fotos`,
          { method: "POST", body: form }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload mislukt");
        if (data.foto) setFotos((prev) => [...prev, data.foto]);
      }
      setOkMsg(
        list.length === 1
          ? "Foto toegevoegd."
          : `${list.length} foto's toegevoegd.`
      );
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

  if (error && !order) {
    return (
      <div className="min-h-screen bg-wash px-4 py-16">
        <div className="mx-auto max-w-3xl">
          <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
            {error}
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

  if (!order) return null;

  const lead = Array.isArray(order.leads) ? order.leads[0] : order.leads;
  const adres = lead ? adresRegel(lead) : "—";
  const mapsQuery = adres !== "—" ? adres : null;
  const shownStatus = installerStatusOf(order);

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
            {installerStatusLabel(shownStatus)}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        {okMsg && (
          <p className="border border-green/30 bg-green-soft px-4 py-3 text-sm text-green-dark">
            {okMsg}
          </p>
        )}
        {error && (
          <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
            {error}
          </p>
        )}

        <section className="border border-line bg-white p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Installatie status
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              className="min-h-11 flex-1 border border-line bg-white px-3 text-sm text-ink"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy === "status"}
              onClick={() => void saveStatus()}
              className="min-h-11 bg-green px-4 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
            >
              {busy === "status" ? "Opslaan…" : "Status opslaan"}
            </button>
          </div>
        </section>

        {offerte ? (
          <section className="border border-line bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Getekende offerte
            </p>
            <p className="mt-1 font-mono text-sm font-semibold text-ink">
              {offerte.offerte_nummer}
            </p>
            <a
              href={`/api/installatie/${token}/orders/${projectId}/offerte`}
              className="mt-3 inline-flex min-h-11 items-center justify-center bg-green px-4 text-sm font-semibold text-white hover:bg-green-dark"
            >
              Download PDF
            </a>
          </section>
        ) : null}

        <section className="border border-line bg-white p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Schouw
          </p>
          {formatProjectSchouwWeek(order) ? (
            <p className="mt-1 text-lg font-semibold text-ink">
              {formatProjectSchouwWeek(order)}
              {order.schouw_at && isSchouwdagDefinitief(order)
                ? ` · ${formatDateTimeLongNl(order.schouw_at)}`
                : ""}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">Nog geen schouwweek.</p>
          )}

          <label className="mt-4 block text-[11px] font-semibold text-muted">
            Schouw-notities
            <textarea
              value={schouwNotities}
              onChange={(e) => setSchouwNotities(e.target.value)}
              rows={3}
              placeholder="Notities over de schouw…"
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </label>
        </section>

        <section className="border border-line bg-white p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Foto&apos;s ({fotos.length})
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Inclusief foto&apos;s van de adviseur. Maak een foto of kies uit je
            galerij.
          </p>
          {uploadError && (
            <p className="mt-2 text-xs text-[#C62828]">{uploadError}</p>
          )}

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label
              className={[
                "flex min-h-14 cursor-pointer items-center justify-center border border-green bg-green px-4 text-sm font-bold text-white",
                uploading ? "opacity-50" : "hover:bg-green-dark",
              ].join(" ")}
            >
              {uploading ? "Uploaden…" : "Camera / foto maken"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  if (e.target.files) void uploadFotos(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <label
              className={[
                "flex min-h-14 cursor-pointer items-center justify-center border border-line bg-white px-4 text-sm font-semibold text-ink",
                uploading ? "opacity-50" : "hover:bg-wash",
              ].join(" ")}
            >
              {uploading ? "Uploaden…" : "Galerij (meerdere)"}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  if (e.target.files) void uploadFotos(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

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
            <p className="mt-1 text-sm text-muted">Nog geen installatiedatum.</p>
          )}

          <label className="mt-4 block text-[11px] font-semibold text-muted">
            Installatie-notities
            <textarea
              value={installatieNotities}
              onChange={(e) => setInstallatieNotities(e.target.value)}
              rows={3}
              placeholder="Notities over de installatie…"
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </label>

          <button
            type="button"
            disabled={busy === "notities"}
            onClick={() => void saveNotities()}
            className="mt-4 min-h-11 w-full bg-green px-4 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50 sm:w-auto"
          >
            {busy === "notities" ? "Opslaan…" : "Notities opslaan"}
          </button>
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
              Notitie van Batterijconcept
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
