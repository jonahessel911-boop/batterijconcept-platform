"use client";

import { useEffect, useState } from "react";
import {
  berekenKosten,
  formatEuroNl,
  maandprijsNaSubsidie,
  productPrijs,
} from "../calculations";
import type { AdviesAnswers } from "../types";
import { ALPHA_ESS_93 } from "../types";
import {
  btnPrimary,
  btnSecondary,
  card,
  fieldInput,
  fieldLabel,
  stepEyebrow,
  stepTitle,
} from "../ui";

export function StepPrijs({
  leadNaam,
  plaatsNaam,
  answers,
  onChange,
}: {
  leadNaam: string;
  plaatsNaam: string;
  answers: AdviesAnswers;
  onChange: (patch: Partial<AdviesAnswers>) => void;
}) {
  const [showPrijs, setShowPrijs] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const prijs = productPrijs();
  const calc = berekenKosten(answers);
  const maand = maandprijsNaSubsidie(answers.looptijdMaanden);
  const hasWarmtefonds = answers.financieringen.includes("warmtefonds");

  useEffect(() => {
    if (!loading) return;
    const start = Date.now();
    const duration = 15000;
    const tick = window.setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / duration) * 100);
      setLoadProgress(p);
      if (p >= 100) {
        window.clearInterval(tick);
        setLoading(false);
        onChange({
          subsidieCheckGedaan: true,
          subsidieAkkoord: true,
        });
      }
    }, 80);
    return () => window.clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const plaats = plaatsNaam || "deze plaats";
  const plekkenMsg =
    loadProgress < 35
      ? `Plekken controleren in ${plaats}…`
      : loadProgress < 70
        ? `Nog 17 vrije plekken gevonden in ${plaats}…`
        : `Controleren of ${leadNaam} in aanmerking komt…`;

  return (
    <div className="space-y-6">
      <div>
        <p className={stepEyebrow}>Prijs & subsidie checken</p>
        <h1 className={stepTitle}>Investering voor {leadNaam}</h1>
      </div>

      {!showPrijs ? (
        <button
          type="button"
          onClick={() => setShowPrijs(true)}
          className={`${btnPrimary} w-full`}
        >
          Toon prijs {ALPHA_ESS_93.naam} →
        </button>
      ) : (
        <div className={card}>
          <p className="text-sm text-muted">Richtprijs excl. BTW (incl. installatie)</p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums text-ink">
            {formatEuroNl(prijs.prijsEx, 0)}
          </p>
          <p className="text-sm text-muted">
            incl. BTW {formatEuroNl(prijs.prijsInc, 0)}
          </p>
          <p className="mt-2 text-xs font-semibold text-green-dark">
            Incl. BTW subsidie-aanvraag
          </p>
        </div>
      )}

      {showPrijs && !answers.subsidieCheckGedaan && !loading && (
        <div className="space-y-3 rounded-2xl border border-green/30 bg-green-soft p-5">
          <p className="font-medium text-ink">
            Wilt u beoordelen of {leadNaam} in aanmerking komt voor deze
            subsidie?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setLoadProgress(0);
                setLoading(true);
              }}
              className={btnPrimary}
            >
              Ja, check subsidie
            </button>
            <button
              type="button"
              onClick={() =>
                onChange({ subsidieCheckGedaan: true, subsidieAkkoord: false })
              }
              className={btnSecondary}
            >
              Nee, overslaan
            </button>
          </div>
        </div>
      )}

      {/* Loading popup */}
      {loading && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="subsidie-popup-title"
        >
          <div className="w-full max-w-md animate-[fadeIn_0.25s_ease] rounded-2xl border border-line bg-white p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:p-8">
            <div className="mb-5 flex items-center gap-3">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-green/20 border-t-green" />
              <div>
                <p
                  id="subsidie-popup-title"
                  className="font-display text-lg font-semibold text-green-dark"
                >
                  Plekken controleren in {plaats}…
                </p>
                <p className="text-xs text-muted">
                  {hasWarmtefonds
                    ? "Warmtefonds · beschikbaarheid"
                    : "Subsidie · beschikbaarheid"}
                </p>
              </div>
            </div>

            <p className="min-h-[2.5rem] text-sm leading-relaxed text-muted">
              {plekkenMsg}
            </p>

            {loadProgress >= 35 && (
              <div className="mt-3 rounded-xl border border-green/25 bg-green-soft px-4 py-3 text-sm font-semibold text-green-dark animate-[fadeIn_0.35s_ease]">
                Nog 17 vrije plekken gevonden
                {plaatsNaam ? ` in ${plaatsNaam}` : ""}.
              </div>
            )}

            <div className="mt-5">
              <div className="mb-1.5 flex justify-between text-[11px] text-muted">
                <span>Bezig met checken</span>
                <span className="tabular-nums font-semibold text-ink">
                  {Math.round(loadProgress)}%
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-green-soft">
                <div
                  className="h-full rounded-full bg-green transition-[width] duration-100"
                  style={{ width: `${loadProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {answers.subsidieCheckGedaan && answers.subsidieAkkoord && (
        <div className="space-y-5 rounded-2xl border border-green/30 bg-white p-6 shadow-[0_12px_40px_rgba(13,92,50,0.08)]">
          <p className="font-display text-2xl font-semibold text-green-dark">
            Gefeliciteerd! {leadNaam} komt in aanmerking.
          </p>
          {plaatsNaam && (
            <p className="text-sm text-muted">
              In {plaatsNaam} waren nog 17 vrije plekken beschikbaar.
            </p>
          )}

          <div className="space-y-2">
            <p className="text-muted line-through decoration-green decoration-2">
              Origineel incl. BTW: {formatEuroNl(prijs.prijsInc, 0)}
            </p>
            <p className="text-muted line-through decoration-green decoration-2">
              BTW ({ALPHA_ESS_93.btwPercentage}%): {formatEuroNl(prijs.btw, 0)}
            </p>
            <p className="font-display text-3xl font-bold text-green">
              {formatEuroNl(prijs.prijsEx, 0)}{" "}
              <span className="text-base font-medium">zonder BTW</span>
            </p>
          </div>

          <label className="block">
            <span className={fieldLabel}>Looptijd (maanden)</span>
            <input
              type="number"
              min={6}
              max={120}
              value={answers.looptijdMaanden}
              onChange={(e) =>
                onChange({ looptijdMaanden: Number(e.target.value) || 15 })
              }
              className={`${fieldInput} max-w-[8rem]`}
            />
          </label>
          <p className="text-lg text-ink">
            Maandprijs:{" "}
            <span className="font-display font-bold">
              {formatEuroNl(maand)}
            </span>{" "}
            <span className="text-sm text-muted">
              ({formatEuroNl(prijs.prijsEx, 0)} / {answers.looptijdMaanden})
            </span>
          </p>

          <div className="grid gap-3 border-t border-line pt-5 sm:grid-cols-3">
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase text-muted">
                Oud (na saldering)
              </p>
              <p className="font-display text-xl font-semibold text-red-600">
                {formatEuroNl(calc.kosten2027Maand)}/mnd
              </p>
            </div>
            <div className="rounded-xl border border-green/25 bg-green-soft px-4 py-3">
              <p className="text-[10px] font-semibold uppercase text-muted">
                Nieuw met batterij
              </p>
              <p className="font-display text-xl font-semibold text-green-dark">
                {formatEuroNl(calc.nieuweSituatieMaand)}/mnd
              </p>
            </div>
            <div className="rounded-xl border border-green/25 bg-green-soft px-4 py-3">
              <p className="text-[10px] font-semibold uppercase text-muted">
                Verschil
              </p>
              <p className="font-display text-xl font-semibold text-green">
                − {formatEuroNl(calc.besparingMetBatterijMaand)}/mnd
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
