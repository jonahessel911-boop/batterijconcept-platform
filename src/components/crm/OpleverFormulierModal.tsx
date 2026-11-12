"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  InstallatiePartnerTeamgenoot,
  Lead,
  Project,
} from "@/types/database";
import { SignaturePadField } from "@/components/offerte/SignaturePadField";
import {
  emptyOpleverFormulier,
  formatOpleverAdres,
  OPLEVER_AKKOORD_TEKST,
  OPLEVER_PUNTEN,
  type OpleverFormulierData,
  type OpleverPuntId,
  validateOpleverFormulier,
} from "@/lib/oplever-formulier";
import {
  medewerkerNaamVanProject,
  teamgenootVanProject,
} from "@/lib/project-medewerker";

type PrefillLead = Pick<
  Lead,
  | "naam"
  | "straat"
  | "huisnummer"
  | "toevoeging"
  | "postcode"
  | "plaats"
>;

type TeamOptie = Pick<
  InstallatiePartnerTeamgenoot,
  "id" | "naam" | "email" | "telefoon"
>;

function leadFromProject(project: Project): PrefillLead | null {
  const raw = Array.isArray(project.leads) ? project.leads[0] : project.leads;
  if (!raw || typeof raw !== "object") return null;
  return raw as PrefillLead;
}

function installatieDatumYmd(project: Project): string {
  if (project.installatie_at) {
    try {
      const d = new Date(project.installatie_at);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
      }
    } catch {
      /* fall through */
    }
  }
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "Europe/Amsterdam",
  });
}

function buildPrefill(
  project: Project,
  monteurOverride?: string | null
): OpleverFormulierData {
  const lead = leadFromProject(project);
  return emptyOpleverFormulier({
    klantNaam: lead?.naam?.trim() || project.titel || "",
    adres: lead ? formatOpleverAdres(lead) : "",
    datum: installatieDatumYmd(project),
    projectNummer: project.project_nummer || "",
    monteurNaam: medewerkerNaamVanProject(project, monteurOverride),
  });
}

export function OpleverFormulierModal({
  open,
  project,
  submitUrl,
  monteurDefault: monteurOverride,
  teamgenoten = [],
  onClose,
  onCreated,
}: {
  open: boolean;
  project: Project;
  /** POST endpoint that accepts { form } */
  submitUrl: string;
  monteurDefault?: string | null;
  /** Medewerkers van de installatiepartner — selecteerbaar als uitvoerder. */
  teamgenoten?: TeamOptie[];
  onClose: () => void;
  onCreated: (result: {
    foto: { url?: string | null; bestandsnaam?: string | null };
    status_advance?: {
      advanced?: boolean;
      to?: string;
    };
    project?: Project | null;
  }) => void;
}) {
  const gekoppeld = teamgenootVanProject(project);
  const [form, setForm] = useState<OpleverFormulierData>(() =>
    buildPrefill(project, monteurOverride)
  );
  const [teamgenootId, setTeamgenootId] = useState(
    () => gekoppeld?.id || ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(buildPrefill(project, monteurOverride));
    setTeamgenootId(teamgenootVanProject(project)?.id || "");
    setError(null);
    setBusy(false);
  }, [open, project.id, monteurOverride]);

  const onSigChange = useCallback((dataUrl: string | null) => {
    setForm((prev) => ({
      ...prev,
      handtekeningDataUrl: dataUrl || "",
    }));
  }, []);

  if (!open) return null;

  function togglePunt(id: OpleverPuntId) {
    setForm((prev) => {
      const has = prev.afgevinkt.includes(id);
      return {
        ...prev,
        afgevinkt: has
          ? prev.afgevinkt.filter((x) => x !== id)
          : [...prev.afgevinkt, id],
      };
    });
  }

  function kiesMedewerker(id: string) {
    setTeamgenootId(id);
    const tg = teamgenoten.find((t) => t.id === id);
    if (tg?.naam) {
      setForm((p) => ({ ...p, monteurNaam: tg.naam }));
    }
  }

  async function submit() {
    if (teamgenoten.length > 0 && !teamgenootId) {
      setError("Kies wie de installatie heeft uitgevoerd.");
      return;
    }
    const invalid = validateOpleverFormulier(form);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form,
          teamgenootId: teamgenootId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "PDF maken mislukt");
      }
      onCreated({
        foto: data.foto || {},
        status_advance: data.status_advance,
        project: data.project || null,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF maken mislukt");
    } finally {
      setBusy(false);
    }
  }

  const alleAf =
    form.afgevinkt.length === OPLEVER_PUNTEN.length &&
    OPLEVER_PUNTEN.every((p) => form.afgevinkt.includes(p.id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="oplever-form-title"
    >
      <div className="flex max-h-[95vh] w-full max-w-lg flex-col overflow-hidden bg-white shadow-xl sm:max-h-[90vh]">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <p
              id="oplever-form-title"
              className="text-base font-semibold text-ink"
            >
              Opleverformulier
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Vink alle punten af en zet je handtekening. Upload daarnaast de
              foto batterij op de order — beide zijn verplicht.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-10 px-2 text-sm font-medium text-muted hover:text-ink"
          >
            Sluiten
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
                Klant
              </span>
              <input
                value={form.klantNaam}
                onChange={(e) =>
                  setForm((p) => ({ ...p, klantNaam: e.target.value }))
                }
                className="w-full border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-[#0D9488]"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
                Adres
              </span>
              <input
                value={form.adres}
                onChange={(e) =>
                  setForm((p) => ({ ...p, adres: e.target.value }))
                }
                className="w-full border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-[#0D9488]"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
                Datum
              </span>
              <input
                type="date"
                value={form.datum}
                onChange={(e) =>
                  setForm((p) => ({ ...p, datum: e.target.value }))
                }
                className="w-full border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-[#0D9488]"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
                Uitvoerend monteur *
              </span>
              {teamgenoten.length > 0 ? (
                <select
                  value={teamgenootId}
                  onChange={(e) => kiesMedewerker(e.target.value)}
                  className="w-full border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-[#0D9488]"
                >
                  <option value="">Kies medewerker…</option>
                  {teamgenoten.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.naam}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.monteurNaam}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, monteurNaam: e.target.value }))
                  }
                  placeholder="Voor- en achternaam"
                  className="w-full border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-[#0D9488]"
                />
              )}
              {teamgenoten.length > 0 && form.monteurNaam ? (
                <span className="mt-1 block text-[11px] text-muted">
                  Op formulier: {form.monteurNaam}
                </span>
              ) : null}
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
                SIN * · precies 15 tekens (AlphaESS, bijv. ALD…)
              </span>
              <input
                required
                value={form.sin}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    sin: e.target.value
                      .replace(/\s+/g, "")
                      .toUpperCase()
                      .slice(0, 15),
                  }))
                }
                placeholder="ALDXXXXXXXXXXXX"
                maxLength={15}
                minLength={15}
                autoComplete="off"
                spellCheck={false}
                className="w-full border border-line bg-white px-2.5 py-1.5 font-mono text-sm tracking-wide text-ink outline-none focus:border-[#0D9488]"
              />
              <span className="mt-1 block text-[11px] text-muted">
                {form.sin.length}/15 · uniek per systeem · start met AL
              </span>
            </label>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
              Opleverpunten
            </p>
            <ul className="mt-2 divide-y divide-line border border-line">
              {OPLEVER_PUNTEN.map((punt) => {
                const checked = form.afgevinkt.includes(punt.id);
                return (
                  <li key={punt.id}>
                    <label className="flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-wash">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePunt(punt.id)}
                        className="mt-0.5 h-5 w-5 shrink-0 accent-[#1A8A3E]"
                      />
                      <span className="text-sm leading-snug text-ink">
                        {punt.label}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {!alleAf ? (
              <p className="mt-1.5 text-xs text-[#C45A12]">
                Alle punten moeten afgevinkt zijn.
              </p>
            ) : null}
          </div>

          <label className="flex cursor-pointer items-start gap-3 border border-line bg-wash px-3 py-3">
            <input
              type="checkbox"
              checked={form.akkoord}
              onChange={(e) =>
                setForm((p) => ({ ...p, akkoord: e.target.checked }))
              }
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#1A8A3E]"
            />
            <span className="text-sm font-semibold leading-snug text-ink">
              {OPLEVER_AKKOORD_TEKST}
            </span>
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
              Opmerkingen (optioneel)
            </span>
            <textarea
              value={form.opmerkingen}
              onChange={(e) =>
                setForm((p) => ({ ...p, opmerkingen: e.target.value }))
              }
              rows={2}
              className="w-full border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-[#0D9488]"
            />
          </label>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
              Handtekening installateur
            </p>
            <div className="mt-2 border border-line bg-white p-2">
              <SignaturePadField onChange={onSigChange} />
            </div>
          </div>

          {error ? (
            <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 flex-1 border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50"
          >
            Annuleren
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="min-h-11 flex-1 bg-green px-4 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
          >
            {busy ? "Opslaan…" : "Oplevering afronden"}
          </button>
        </div>
      </div>
    </div>
  );
}
