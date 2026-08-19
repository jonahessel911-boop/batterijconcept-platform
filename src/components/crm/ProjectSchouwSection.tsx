"use client";

import { useCallback, useEffect, useState } from "react";
import type { InstallatiePartner, Project, ProjectFoto } from "@/types/database";
import { formatDateTimeLongNl } from "@/lib/format";
import { Panel } from "./DetailChrome";

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ProjectSchouwSection({
  project,
  onChanged,
  embedded = false,
}: {
  project: Project;
  onChanged: () => void;
  embedded?: boolean;
}) {
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [fotos, setFotos] = useState<ProjectFoto[]>([]);
  const [schouwAt, setSchouwAt] = useState(
    toDatetimeLocalValue(project.schouw_at)
  );
  const [partnerId, setPartnerId] = useState(
    project.installatie_partner_id || ""
  );
  const [notities, setNotities] = useState(project.schouw_notities || "");
  const [installatieAt, setInstallatieAt] = useState(
    toDatetimeLocalValue(project.installatie_at)
  );
  const [installatieNotities, setInstallatieNotities] = useState(
    project.installatie_notities || ""
  );
  const [saving, setSaving] = useState(false);
  const [installatieSaving, setInstallatieSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const loadPartnersAndFotos = useCallback(async () => {
    try {
      const [p, f] = await Promise.all([
        fetch("/api/installatie-partners").then((r) => r.json()),
        fetch(`/api/projecten/${project.id}/fotos`).then((r) => r.json()),
      ]);
      setPartners(p.partners || []);
      setFotos(f.fotos || []);
    } catch {
      /* ignore */
    }
  }, [project.id]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void loadPartnersAndFotos());
    return () => cancelAnimationFrame(id);
  }, [loadPartnersAndFotos]);

  useEffect(() => {
    setSchouwAt(toDatetimeLocalValue(project.schouw_at));
    setPartnerId(project.installatie_partner_id || "");
    setNotities(project.schouw_notities || "");
    setInstallatieAt(toDatetimeLocalValue(project.installatie_at));
    setInstallatieNotities(project.installatie_notities || "");
  }, [
    project.schouw_at,
    project.installatie_partner_id,
    project.schouw_notities,
    project.installatie_at,
    project.installatie_notities,
  ]);

  async function planSchouw(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      if (!schouwAt) throw new Error("Kies een schouwdatum");
      if (!partnerId) throw new Error("Kies een installatiepartner");
      const parsed = new Date(schouwAt);
      if (Number.isNaN(parsed.getTime())) throw new Error("Ongeldige datum");

      const res = await fetch(`/api/projecten/${project.id}/schouw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schouw_at: parsed.toISOString(),
          installatie_partner_id: partnerId,
          schouw_notities: notities || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Inplannen mislukt");

      const parts: string[] = ["Schouw ingepland."];
      if (data.mails?.klant?.ok) parts.push("Mail naar klant verstuurd.");
      else if (data.mails?.klant?.error)
        parts.push(`Klantmail: ${data.mails.klant.error}`);
      if (data.mails?.partner?.ok) parts.push("Mail naar partner verstuurd.");
      else if (data.mails?.partner?.error)
        parts.push(`Partnermail: ${data.mails.partner.error}`);
      setOkMsg(parts.join(" "));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  async function planInstallatie(e: React.FormEvent) {
    e.preventDefault();
    setInstallatieSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      if (!installatieAt) throw new Error("Kies een installatiedatum");
      if (!partnerId) throw new Error("Kies een installatiepartner");
      const parsed = new Date(installatieAt);
      if (Number.isNaN(parsed.getTime())) throw new Error("Ongeldige datum");

      const res = await fetch(`/api/projecten/${project.id}/installatie`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installatie_at: parsed.toISOString(),
          installatie_partner_id: partnerId,
          installatie_notities: installatieNotities || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Inplannen mislukt");

      const parts: string[] = ["Installatie ingepland."];
      if (data.mails?.klant?.ok) parts.push("Mail naar klant verstuurd.");
      else if (data.mails?.klant?.error)
        parts.push(`Klantmail: ${data.mails.klant.error}`);
      if (data.mails?.partner?.ok) parts.push("Mail naar partner verstuurd.");
      else if (data.mails?.partner?.error)
        parts.push(`Partnermail: ${data.mails.partner.error}`);
      setOkMsg(parts.join(" "));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setInstallatieSaving(false);
    }
  }

  async function uploadFoto(file: File) {
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
      setFotos((prev) => [...prev, data.foto]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload mislukt");
    } finally {
      setUploading(false);
    }
  }

  async function deleteFoto(fotoId: string) {
    if (!confirm("Foto verwijderen?")) return;
    try {
      const res = await fetch(
        `/api/projecten/${project.id}/fotos?foto_id=${encodeURIComponent(fotoId)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      setFotos((prev) => prev.filter((f) => f.id !== fotoId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    }
  }

  const body = (
    <>
      <form onSubmit={planSchouw} className="space-y-4 px-1 py-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Schouwdatum
            <input
              type="datetime-local"
              required
              value={schouwAt}
              onChange={(e) => setSchouwAt(e.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Installatiepartner
            <select
              required
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            >
              <option value="">Kies partner…</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.naam}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Schouw-notities
          <textarea
            value={notities}
            onChange={(e) => setNotities(e.target.value)}
            rows={3}
            placeholder="Bijv. meterkast in garage, sleutel bij buren…"
            className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
          />
        </label>

        {partners.length === 0 && (
          <p className="text-xs text-muted">
            Voeg eerst een installatiepartner toe onder Instellingen.
          </p>
        )}

        {error && (
          <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
            {error}
          </p>
        )}
        {okMsg && (
          <p className="border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
            {okMsg}
          </p>
        )}

        <button
          type="submit"
          disabled={saving || partners.length === 0}
          className="bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
        >
          {saving
            ? "Bezig…"
            : project.schouw_at
              ? "Schouw bijwerken & opnieuw mailen"
              : "Schouw inplannen & mailen"}
        </button>
      </form>

      <form
        onSubmit={planInstallatie}
        className="mt-8 space-y-4 border-t border-line px-1 pt-6"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Installatie plannen
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Installatiedatum
            <input
              type="datetime-local"
              required
              value={installatieAt}
              onChange={(e) => setInstallatieAt(e.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Installatiepartner
            <select
              required
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            >
              <option value="">Kies partner…</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.naam}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Installatie-notities
          <textarea
            value={installatieNotities}
            onChange={(e) => setInstallatieNotities(e.target.value)}
            rows={2}
            placeholder="Bijv. parkeerplek achterom, ladder nodig…"
            className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
          />
        </label>
        <button
          type="submit"
          disabled={installatieSaving || partners.length === 0}
          className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
        >
          {installatieSaving
            ? "Bezig…"
            : project.installatie_at
              ? "Installatie bijwerken & opnieuw mailen"
              : "Installatie inplannen & mailen"}
        </button>
      </form>

      <div className="mt-6 border-t border-line px-1 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Foto&apos;s ({fotos.length})
          </p>
          <label className="cursor-pointer text-xs font-semibold text-green-dark underline-offset-2 hover:underline">
            {uploading ? "Uploaden…" : "Foto toevoegen"}
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
        {fotos.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nog geen foto&apos;s.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {fotos.map((f) => (
              <div key={f.id} className="group relative border border-line bg-wash">
                {f.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.url}
                    alt={f.bestandsnaam || "Projectfoto"}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-xs text-muted">
                    Geen preview
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void deleteFoto(f.id)}
                  className="absolute right-1 top-1 bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-[#C45A12] opacity-0 group-hover:opacity-100"
                >
                  Verwijder
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  if (embedded) return <div>{body}</div>;

  return (
    <Panel
      title="Schouw & installatie"
      subtitle={
        project.schouw_at
          ? formatDateTimeLongNl(project.schouw_at)
          : "Nog niet gepland"
      }
    >
      {body}
    </Panel>
  );
}
