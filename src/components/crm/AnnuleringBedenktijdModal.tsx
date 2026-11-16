"use client";

import { useEffect, useMemo, useState } from "react";
import type { Project } from "@/types/database";
import {
  bedenktijdVanOndertekening,
  ondertekendOpVanProject,
} from "@/lib/bedenktijd";
import { isWarmtefondsProject } from "@/lib/backoffice-acties";
import {
  annuleringAfrekening,
  type AnnuleringAfrekening,
} from "@/lib/av-annulering";
import { formatEuro } from "@/lib/format";

export type AnnuleringKeuze = {
  binnenBedenktijd: boolean;
  stuurMail: boolean;
  /** Binnen bedenktijd: verstuurde facturen meteen crediteren. */
  creditFacturen: boolean;
};

type WarmtefondsVervolg = "meewerken" | "annuleren_kosten";

type FactuurLike = {
  status: string;
  bedrag_inc_btw: number | null;
  credit_van_factuur_id?: string | null;
  omschrijving?: string | null;
};

function AfrekeningSheet({ afrekening }: { afrekening: AnnuleringAfrekening }) {
  const bij = afrekening.richting === "bijbetalen";
  const terug = afrekening.richting === "terugbetalen";
  return (
    <div className="border border-line bg-wash/50 px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        Rekensom · art. 4A AV
      </p>
      <dl className="mt-2 space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Order incl. btw</dt>
          <dd className="tabular-nums font-medium text-ink">
            {formatEuro(afrekening.orderInc)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">
            Annuleringskosten ({afrekening.pct}%)
          </dt>
          <dd className="tabular-nums font-medium text-ink">
            {formatEuro(afrekening.kostenInc)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Al betaald (aanbetaling e.d.)</dt>
          <dd className="tabular-nums font-medium text-ink">
            − {formatEuro(afrekening.alBetaaldInc)}
          </dd>
        </div>
        <div className="border-t border-line pt-1.5">
          {bij ? (
            <div className="flex justify-between gap-3">
              <dt className="font-semibold text-[#9A3B1A]">
                Nog bij te betalen
              </dt>
              <dd className="tabular-nums font-semibold text-[#9A3B1A]">
                {formatEuro(afrekening.saldoInc)}
              </dd>
            </div>
          ) : terug ? (
            <div className="flex justify-between gap-3">
              <dt className="font-semibold text-green-deeper">
                Terug te betalen aan klant
              </dt>
              <dd className="tabular-nums font-semibold text-green-deeper">
                {formatEuro(Math.abs(afrekening.saldoInc))}
              </dd>
            </div>
          ) : (
            <div className="flex justify-between gap-3">
              <dt className="font-semibold text-ink">Vereffend</dt>
              <dd className="tabular-nums font-semibold text-ink">
                {formatEuro(0)}
              </dd>
            </div>
          )}
        </div>
      </dl>
      <p className="mt-2 text-[11px] leading-snug text-muted">
        {bij
          ? "Bij doorzetten: factuur voor dit restant wordt automatisch aangemaakt en naar de klant gemaild."
          : terug
            ? "Klant heeft meer betaald dan de 20% — dit bedrag terugbetalen / crediteren (geen extra factuur)."
            : "Al betaald dekt precies de annuleringskosten — geen extra factuur."}
      </p>
    </div>
  );
}

/**
 * Popup vóór order-annulering: bedenktijd-check bepaalt of
 * annuleringskosten in de klantmail komen.
 * Warmtefonds + na bedenktijd: eerst kiezen meewerken vs. kosten.
 * Bij «na bedenktijd»: korte rekensom (bijbetalen / terugbetalen).
 */
export function AnnuleringBedenktijdModal({
  project,
  onClose,
  onConfirm,
  busy,
  /** Alleen mail versturen (status staat al op annulering). */
  mailOnly = false,
  orderIncBtw = 0,
  facturen = [],
}: {
  project: Project;
  onClose: () => void;
  onConfirm: (keuze: AnnuleringKeuze) => void | Promise<void>;
  busy?: boolean;
  mailOnly?: boolean;
  orderIncBtw?: number | null;
  facturen?: FactuurLike[];
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
  const [creditFacturen, setCreditFacturen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedOrderInc, setLoadedOrderInc] = useState<number | null>(null);
  const [loadedFacturen, setLoadedFacturen] = useState<FactuurLike[] | null>(
    null
  );

  const effectiveOrderInc =
    Number(orderIncBtw) > 0
      ? Number(orderIncBtw)
      : loadedOrderInc != null
        ? loadedOrderInc
        : Number(
            (Array.isArray(project.offertes)
              ? project.offertes[0]
              : project.offertes
            )?.totaal_inc_btw
          ) || 0;
  const effectiveFacturen = facturen.length
    ? facturen
    : loadedFacturen || [];

  const afrekening = useMemo(
    () =>
      annuleringAfrekening({
        orderIncBtw: effectiveOrderInc,
        facturen: effectiveFacturen,
      }),
    [effectiveOrderInc, effectiveFacturen]
  );

  // Laad order + facturen voor rekensom als parent ze niet doorgeeft.
  useEffect(() => {
    if (binnenBedenktijd !== false) return;
    if (Number(orderIncBtw) > 0 && facturen.length > 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const [pRes, fRes] = await Promise.all([
          Number(orderIncBtw) > 0
            ? null
            : fetch(`/api/projecten/${project.id}`),
          facturen.length > 0
            ? null
            : fetch(`/api/projecten/${project.id}/facturen`),
        ]);
        if (cancelled) return;
        if (pRes) {
          const data = await pRes.json().catch(() => ({}));
          const p = (data as { project?: Project }).project;
          const off = p
            ? Array.isArray(p.offertes)
              ? p.offertes[0]
              : p.offertes
            : null;
          setLoadedOrderInc(Number(off?.totaal_inc_btw) || 0);
        }
        if (fRes) {
          const data = await fRes.json().catch(() => ({}));
          setLoadedFacturen(
            ((data as { facturen?: FactuurLike[] }).facturen ||
              []) as FactuurLike[]
          );
        }
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [binnenBedenktijd, orderIncBtw, facturen.length, project.id]);

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
  const toontRekensom =
    binnenBedenktijd === false &&
    wilAnnulerenMetKosten &&
    !wilMeewerken &&
    afrekening.orderInc > 0;

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
      creditFacturen: binnenBedenktijd === true && creditFacturen,
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
                setCreditFacturen(true);
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
                  : "20% annuleringskosten · zie rekensom"}
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
                    20% van het orderbedrag (art. 4A AV) · zie rekensom
                  </span>
                </button>
              </div>
            </div>
          ) : null}

          {toontRekensom ? <AfrekeningSheet afrekening={afrekening} /> : null}

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

          {binnenBedenktijd === true && !wilMeewerken ? (
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={creditFacturen}
                disabled={busy}
                onChange={(e) => setCreditFacturen(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Facturen direct crediteren
                <span className="mt-0.5 block text-xs font-normal text-muted">
                  Binnen de 14 dagen: elke verstuurde factuur (betaald, deels
                  betaald of nog open) krijgt een eigen creditfactuur. Die gaat
                  naar de klant en wordt meteen geboekt. Conceptfacturen blijven
                  staan.
                </span>
              </span>
            </label>
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
