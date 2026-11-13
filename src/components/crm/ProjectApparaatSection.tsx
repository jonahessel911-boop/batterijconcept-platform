"use client";

import { useEffect, useState } from "react";
import type { Project } from "@/types/database";
import {
  normalizeSysteemSin,
  SYSTEEM_SIN_LENGTH,
  validateSysteemSin,
} from "@/lib/systeem-sin";

/** AlphaESS portaal: https://portal.alphaess.com/b/ess/{SIN}/ess-site */
export function alphaEssPortalUrl(systeemSin: string): string | null {
  const sin = normalizeSysteemSin(systeemSin);
  if (!sin) return null;
  return `https://portal.alphaess.com/b/ess/${encodeURIComponent(sin)}/ess-site`;
}

export function ProjectApparaatSection({
  project,
  onChanged,
}: {
  project: Project;
  onChanged: () => void;
}) {
  const [sin, setSin] = useState(project.systeem_sin || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    setSin(project.systeem_sin || "");
  }, [project.id, project.systeem_sin]);

  async function opslaan() {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const normalized = normalizeSysteemSin(sin);
      if (normalized) {
        const err = validateSysteemSin(normalized);
        if (err) throw new Error(err);
      }
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systeem_sin: normalized || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setSin(normalized);
      setOkMsg("Systeem SIN opgeslagen.");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  }

  const dirty =
    normalizeSysteemSin(sin) !==
    normalizeSysteemSin(project.systeem_sin || "");
  /** Link op basis van opgeslagen SIN (opleverformulier), niet het draft-veld. */
  const alphaUrl = alphaEssPortalUrl(project.systeem_sin || "");

  return (
    <section className="border border-line bg-white px-4 py-5 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
          Apparaat
        </h2>
        <p className="mt-1 text-sm text-muted">
          Systeemgegevens van de installatie. Het SIN-nummer komt uit het
          opleverformulier (AlphaESS · precies {SYSTEEM_SIN_LENGTH} tekens,
          start met AL).
        </p>
      </div>

      <div className="mt-5 max-w-md space-y-3">
        <label className="block space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
            Systeem SIN-nummer
          </span>
          <input
            value={sin}
            onChange={(e) => {
              setSin(
                e.target.value
                  .replace(/\s+/g, "")
                  .toUpperCase()
                  .slice(0, SYSTEEM_SIN_LENGTH)
              );
              setOkMsg(null);
            }}
            placeholder="ALDXXXXXXXXXXXX"
            maxLength={SYSTEEM_SIN_LENGTH}
            autoComplete="off"
            spellCheck={false}
            className="w-full border border-line bg-white px-3 py-2.5 font-mono text-sm tracking-wide text-ink outline-none focus:border-green-dark"
          />
          <span className="block text-[11px] text-muted">
            {normalizeSysteemSin(sin).length}/{SYSTEEM_SIN_LENGTH}
          </span>
        </label>

        {error ? (
          <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
            {error}
          </p>
        ) : null}
        {okMsg ? (
          <p className="border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
            {okMsg}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={() => void opslaan()}
            className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
          >
            {busy ? "Opslaan…" : "Opslaan"}
          </button>
          {alphaUrl ? (
            <a
              href={alphaUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:border-green hover:text-green-dark"
            >
              Bekijk in Alpha Portaal
            </a>
          ) : (
            <span className="inline-flex items-center px-1 text-xs text-muted">
              Vul eerst het SIN-nummer in om Alpha te openen.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
