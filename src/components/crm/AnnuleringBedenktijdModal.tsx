"use client";

import { useEffect, useState } from "react";
import type { Project } from "@/types/database";
import {
  bedenktijdVanOndertekening,
  ondertekendOpVanProject,
} from "@/lib/bedenktijd";
import { isWarmtefondsProject } from "@/lib/backoffice-acties";

export type AnnuleringKeuze = {
  binnenBedenktijd: boolean;
  stuurMail: boolean;
};

type WarmtefondsVervolg = "meewerken" | "annuleren_kosten";

/**
 * Popup vóór order-annulering: bedenktijd-check bepaalt of
 * annuleringskosten in de klantmail komen.
 * Warmtefonds + na bedenktijd: eerst kiezen meewerken vs. kosten.
 */
export function AnnuleringBedenktijdModal({
  project,
  onClose,
  onConfirm,
  busy,
  /** Alleen mail versturen (status staat al op annulering). */
  mailOnly = false,
}: {
  project: Project;
  onClose: () => void;
  onConfirm: (keuze: AnnuleringKeuze) => void | Promise<void>;
  busy?: boolean;
  mailOnly?: boolean;
}) {
  const warmtefonds = isWarmtefondsProject(project);
  const [ondertekendOp, setOndertekendOp] = useState<string | null>(() =>
    ondertekendOpVanProject(project)
  );
  const [loadingDatum, setLoadingDatum] = useState(
    !ondertekendOpVanProject(project)
  );
  const [binnenBedenktijd, setBinnenBedenktijd] = useState<boolean | null>(
    null
  );
  const [wfVervolg, setWfVervolg] = useState<WarmtefondsVervolg | null>(null);
  const [stuurMail, setStuurMail] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  useEffect(() => {
    if (ondertekendOpVanProject(project)) {
      setOndertekendOp(ondertekendOpVanProject(project));
      setLoadingDatum(false);
      return;
    }
    let cancelled = false;
    setLoadingDatum(true);
    void (async () => {
      try {
        const res = await fetch(`/api/projecten/${project.id}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const p = (data as { project?: Project }).project;
        setOndertekendOp(p ? ondertekendOpVanProject(p) : null);
      } catch {
        if (!cancelled) setOndertekendOp(null);
      } finally {
        if (!cancelled) setLoadingDatum(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  const info = bedenktijdVanOndertekening(ondertekendOp);
  const toontWfFork =
    !mailOnly && warmtefonds && binnenBedenktijd === false;
  const wilMeewerken = toontWfFork && wfVervolg === "meewerken";
  const wilAnnulerenMetKosten =
    !toontWfFork || wfVervolg === "annuleren_kosten";

  async function submit() {
    if (binnenBedenktijd == null) {
      setError(
        "Kies of de klant binnen of na de bedenktijd heeft geannuleerd."
      );
      return;
    }
    if (toontWfFork && wfVervolg == null) {
      setError("Kies of de klant meewerkt met Warmtefonds of annuleert.");
      return;
    }
    if (wilMeewerken) {
      setError(null);
      onClose();
      return;
    }
    setError(null);
    await onConfirm({
      binnenBedenktijd,
      stuurMail: mailOnly ? true : stuurMail,
    });
  }

  const canSubmit =
    binnenBedenktijd != null &&
    (!toontWfFork || wfVervolg != null);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="annulering-bedenktijd-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md border border-line bg-white shadow-xl">
        <div className="border-b border-line px-4 py-3">
          <h2
            id="annulering-bedenktijd-title"
            className="font-display text-lg font-semibold text-ink"
          >
            {mailOnly ? "Annuleringsmail versturen" : "Order annuleren"}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {project.project_nummer || "Project"} ·{" "}
            {project.leads?.naam || "klant"}
            {warmtefonds ? " · Warmtefonds" : ""}
          </p>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div>
            <p className="text-sm font-semibold text-ink">
              Heeft de klant binnen zijn bedenktijd geannuleerd?
            </p>
            <p className="mt-2 text-sm text-muted">
              Schriftelijke annulering had moeten plaatsvinden vóór{" "}
              {loadingDatum ? (
                <span className="font-medium text-ink">…</span>
              ) : info ? (
                <span className="font-semibold text-ink">{info.eindLabel}</span>
              ) : (
                <span className="font-medium text-ink">
                  (ondertekeningsdatum onbekend)
                </span>
              )}
              {info && !loadingDatum ? (
                <>
                  {" "}
                  <span className="text-muted">
                    ({info.klaar
                      ? "bedenktijd is verlopen"
                      : `nog ${info.dagenOver} dag${info.dagenOver === 1 ? "" : "en"}`}
                    ).
                  </span>
                </>
              ) : null}
            </p>
          </div>

          <div className="grid gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBinnenBedenktijd(true);
                setWfVervolg(null);
                setError(null);
              }}
              className={[
                "border px-3 py-2.5 text-left text-sm transition",
                binnenBedenktijd === true
                  ? "border-green bg-green-soft/60 font-semibold text-green-deeper"
                  : "border-line bg-white text-ink hover:bg-wash",
              ].join(" ")}
            >
              <span className="block font-semibold">
                Ja — binnen bedenktijd
              </span>
              <span className="mt-0.5 block text-[11px] text-muted">
                Geen annuleringskosten in de mail
              </span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBinnenBedenktijd(false);
                setWfVervolg(null);
                setError(null);
              }}
              className={[
                "border px-3 py-2.5 text-left text-sm transition",
                binnenBedenktijd === false
                  ? "border-[#C45A12] bg-[#FFF0E6] font-semibold text-[#9A3B1A]"
                  : "border-line bg-white text-ink hover:bg-wash",
              ].join(" ")}
            >
              <span className="block font-semibold">
                Nee — na de bedenktijd
              </span>
              <span className="mt-0.5 block text-[11px] text-muted">
                {warmtefonds && !mailOnly
                  ? "Kies hieronder: meewerken of annuleringskosten"
                  : "Annuleringskosten (20%) wel in de mail"}
              </span>
            </button>
          </div>

          {toontWfFork ? (
            <div className="space-y-2 border-t border-line pt-4">
              <p className="text-sm font-semibold text-ink">
                Warmtefonds — wat wil de klant?
              </p>
              <p className="text-xs text-muted">
                Na de bedenktijd: meewerken met de Warmtefonds-aanvraag en
                verder inregelen, of annuleren met de kosten uit de AV.
              </p>
              <div className="grid gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setWfVervolg("meewerken");
                    setError(null);
                  }}
                  className={[
                    "border px-3 py-2.5 text-left text-sm transition",
                    wfVervolg === "meewerken"
                      ? "border-green bg-green-soft/60 font-semibold text-green-deeper"
                      : "border-line bg-white text-ink hover:bg-wash",
                  ].join(" ")}
                >
                  <span className="block font-semibold">
                    Meewerken met Warmtefonds
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    Order blijft staan — verder inregelen (aanvraag / schouw)
                  </span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setWfVervolg("annuleren_kosten");
                    setError(null);
                  }}
                  className={[
                    "border px-3 py-2.5 text-left text-sm transition",
                    wfVervolg === "annuleren_kosten"
                      ? "border-[#C45A12] bg-[#FFF0E6] font-semibold text-[#9A3B1A]"
                      : "border-line bg-white text-ink hover:bg-wash",
                  ].join(" ")}
                >
                  <span className="block font-semibold">
                    Annuleren met annuleringskosten
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    20% van het orderbedrag in de annuleringsmail (art. 4A AV)
                  </span>
                </button>
              </div>
            </div>
          ) : null}

          {wilAnnulerenMetKosten && !wilMeewerken ? (
            mailOnly ? (
              <p className="text-xs text-muted">
                De mail gaat naar de klant
                {binnenBedenktijd === true
                  ? " zonder annuleringskosten."
                  : binnenBedenktijd === false
                    ? " met annuleringskosten."
                    : "."}
              </p>
            ) : (
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={stuurMail}
                  disabled={busy}
                  onChange={(e) => setStuurMail(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Direct annuleringsmail naar de klant sturen
                  {binnenBedenktijd === true
                    ? " (zonder kosten)"
                    : binnenBedenktijd === false
                      ? " (met annuleringskosten)"
                      : ""}
                </span>
              </label>
            )
          ) : null}

          {wilMeewerken ? (
            <p className="text-xs text-muted">
              De order wordt niet geannuleerd. Sluit deze popup en regel de
              Warmtefonds-aanvraag verder.
            </p>
          ) : null}

          {error ? (
            <p className="text-sm text-[#C45A12]">{error}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50"
          >
            Annuleren
          </button>
          <button
            type="button"
            disabled={busy || !canSubmit}
            onClick={() => void submit()}
            className={[
              "px-3 py-2 text-sm font-semibold text-white disabled:opacity-50",
              wilMeewerken
                ? "bg-green hover:bg-green-deeper"
                : "bg-[#C45A12] hover:bg-[#a84c0f]",
            ].join(" ")}
          >
            {busy
              ? "Bezig…"
              : wilMeewerken
                ? "Verder met Warmtefonds"
                : mailOnly
                  ? "Mail versturen"
                  : "Order annuleren"}
          </button>
        </div>
      </div>
    </div>
  );
}
