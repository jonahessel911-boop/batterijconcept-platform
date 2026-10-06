"use client";

import { useEffect, useMemo, useState } from "react";
import type { Project } from "@/types/database";
import { useCrmSession } from "@/hooks/useCrmSession";
import { gebruikerRolLabel, normalizeRol } from "@/lib/rollen";

function firstName(naam: string | null | undefined): string {
  const t = naam?.trim() || "";
  if (!t) return "daar";
  return t.split(/\s+/)[0] || t;
}

export function KlantContactMailModal({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { session } = useCrmSession();
  const lead = project.leads || null;
  const klantNaam = lead?.naam?.trim() || project.titel?.trim() || "klant";

  const afdelingLabel = useMemo(() => {
    const rol = normalizeRol(session?.rol);
    return rol === "admin" ? "Backoffice" : gebruikerRolLabel[rol];
  }, [session?.rol]);

  const medewerkerNaam = session?.naam?.trim() || "Batterijconcept";

  const [to, setTo] = useState(lead?.email?.trim() || "");
  const [subject, setSubject] = useState(
    `Bericht over jouw project ${project.project_nummer || ""}`.trim()
  );
  const [bericht, setBericht] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    setTo(lead?.email?.trim() || "");
  }, [lead?.email]);

  async function verstuur() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}/contact-mail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to.trim(),
          subject: subject.trim(),
          bericht: bericht.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Versturen mislukt"
        );
      }
      setOk("Mail verstuurd.");
      window.setTimeout(() => onClose(), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Versturen mislukt");
    } finally {
      setBusy(false);
    }
  }

  const previewParas = bericht
    .trim()
    .split(/\n+/)
    .filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Sluiten"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col border border-line bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-ink">
              Mail naar klant
            </h2>
            <p className="mt-0.5 truncate text-sm text-muted">
              {klantNaam}
              {project.project_nummer ? ` · ${project.project_nummer}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 border border-line px-2.5 py-1.5 text-sm text-muted hover:bg-wash"
          >
            Sluiten
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-2">
          <div className="space-y-3 border-b border-line px-5 py-4 lg:border-b-0 lg:border-r">
            <label className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
              Naar (e-mail)
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                placeholder="klant@email.nl"
              />
            </label>
            <label className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
              Onderwerp
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
              />
            </label>
            <label className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
              Bericht
              <textarea
                value={bericht}
                onChange={(e) => setBericht(e.target.value)}
                rows={8}
                placeholder="Schrijf hier je bericht…"
                className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
              />
            </label>
            <p className="text-xs text-muted">
              Aanhef en afsluiting worden automatisch toegevoegd:
            </p>
            <div className="border border-line bg-[#FAFBFA] px-3 py-2.5 text-sm text-ink">
              <p>Beste {firstName(klantNaam)},</p>
              <p className="mt-2 text-muted">… jouw bericht …</p>
              <p className="mt-3">Met vriendelijke groet,</p>
              <p className="mt-1 font-semibold">{afdelingLabel}</p>
              <p>{medewerkerNaam}</p>
            </div>
          </div>

          <div className="bg-[#F4F8F5] px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
              Voorbeeld
            </p>
            <div className="mt-3 overflow-hidden border border-[#dce6df] bg-white">
              <div className="bg-[#0D5C32] px-4 py-3">
                <p className="font-display text-base font-bold text-white">
                  Batterij<span className="text-[#F37021]">concept</span>
                </p>
              </div>
              <div className="space-y-3 px-4 py-4 text-sm leading-relaxed text-ink">
                <p>Beste {firstName(klantNaam)},</p>
                {previewParas.length > 0 ? (
                  previewParas.map((p) => <p key={p}>{p}</p>)
                ) : (
                  <p className="text-muted italic">Jouw bericht komt hier…</p>
                )}
                <p>Met vriendelijke groet,</p>
                <div>
                  <p className="font-semibold">{afdelingLabel}</p>
                  <p>{medewerkerNaam}</p>
                </div>
              </div>
              <div className="border-t border-[#e2e8e4] bg-[#F4F8F5] px-4 py-3 text-[11px] text-muted">
                BatterijConcept · info@batterijconcept.nl · 085 800 1645
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-4">
          <div className="min-w-0 text-sm">
            {error ? <p className="text-[#C45A12]">{error}</p> : null}
            {ok ? <p className="text-green-dark">{ok}</p> : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-wash"
            >
              Annuleren
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void verstuur()}
              className="bg-[#0D5C32] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0A4A28] disabled:opacity-50"
            >
              {busy ? "Versturen…" : "Verstuur mail"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
