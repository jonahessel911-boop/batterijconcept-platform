"use client";

import { useEffect, useState } from "react";
import { berekenKosten, formatEuroNl } from "../calculations";
import type { AdviesAnswers } from "../types";
import {
  btnPrimary,
  card,
  fieldInput,
  fieldLabel,
  stepEyebrow,
  stepLead,
  stepTitle,
} from "../ui";

export function StepBevestiging({
  leadNaam,
  answers,
  onChange,
}: {
  leadNaam: string;
  answers: AdviesAnswers;
  onChange: (patch: Partial<AdviesAnswers>) => void;
}) {
  const [goedVoorstel, setGoedVoorstel] = useState<boolean | null>(null);
  const [offerteOk, setOfferteOk] = useState(false);
  const [subsidieOk, setSubsidieOk] = useState(false);
  const [subsidiePopup, setSubsidiePopup] = useState<
    null | "loading" | "done"
  >(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const calc = berekenKosten(answers);
  const hasWarmtefonds = answers.financieringen.includes("warmtefonds");

  const oud =
    answers.termijnbedragHuidig != null && answers.termijnbedragHuidig > 0
      ? answers.termijnbedragHuidig
      : calc.kosten2027Maand;

  useEffect(() => {
    if (subsidiePopup !== "loading") return;
    const start = Date.now();
    const duration = 2800;
    const tick = window.setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / duration) * 100);
      setLoadProgress(p);
      if (p >= 100) {
        window.clearInterval(tick);
        setSubsidiePopup("done");
        setSubsidieOk(true);
      }
    }, 50);
    return () => window.clearInterval(tick);
  }, [subsidiePopup]);

  function startReserveer() {
    if (subsidieOk) return;
    setLoadProgress(0);
    setSubsidiePopup("loading");
  }

  return (
    <div className="space-y-6">
      <div>
        <p className={stepEyebrow}>Afronden</p>
        <h1 className={stepTitle}>Voorstel voor {leadNaam}</h1>
        <p className={stepLead}>
          Intern adviesproces — er wordt niets naar de klant gemaild of
          geappt.
        </p>
      </div>

      <div className={`${card} max-w-sm`}>
        <label className="block">
          <span className={fieldLabel}>
            Huidig termijnbedrag energie (€ / maand)
          </span>
          <input
            type="number"
            step={1}
            value={answers.termijnbedragHuidig ?? ""}
            onChange={(e) =>
              onChange({
                termijnbedragHuidig: e.target.value
                  ? Number(e.target.value)
                  : null,
              })
            }
            placeholder={formatEuroNl(calc.kosten2027Maand, 0)}
            className={fieldInput}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="text-[10px] font-semibold uppercase text-muted">
            Nu / oud
          </p>
          <p className="mt-1 font-display text-2xl font-semibold text-red-600">
            {formatEuroNl(oud)}/mnd
          </p>
        </div>
        <div className="rounded-2xl border border-green/25 bg-green-soft p-5">
          <p className="text-[10px] font-semibold uppercase text-muted">
            Met batterij
          </p>
          <p className="mt-1 font-display text-2xl font-semibold text-green-dark">
            {formatEuroNl(calc.nieuweSituatieMaand)}/mnd
          </p>
        </div>
      </div>

      {goedVoorstel === null ? (
        <button
          type="button"
          onClick={() => setGoedVoorstel(true)}
          className={`${btnPrimary} w-full`}
        >
          Vindt de klant dit een goed voorstel?
        </button>
      ) : (
        <div className="space-y-4">
          <p className="text-center text-sm font-medium text-green-dark">
            Mooi — leg het voorstel intern vast.
          </p>

          {/* Subsidie checker — prominent */}
          <div className="rounded-2xl border-2 border-orange bg-gradient-to-br from-[#fff4ec] to-white p-5 shadow-[0_12px_40px_rgba(243,112,33,0.2)] sm:p-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-orange">
              Subsidie reserveren
            </p>
            <p className="mt-1 font-display text-xl font-semibold text-ink">
              BTW{hasWarmtefonds ? " + Warmtefonds" : ""} voor {leadNaam}
            </p>
            <p className="mt-2 text-sm text-muted">
              Reserveer nu intern de subsidie(s), zodat de plek vastligt.
            </p>
            <button
              type="button"
              onClick={startReserveer}
              disabled={subsidieOk}
              className="mt-4 w-full rounded-full bg-orange px-5 py-4 text-base font-bold text-white shadow-lg shadow-orange/30 hover:brightness-110 disabled:opacity-70"
            >
              {subsidieOk
                ? "✓ Subsidie intern gereserveerd"
                : "Reserveer subsidie nu"}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setOfferteOk(true)}
            disabled={offerteOk}
            className="w-full rounded-full border border-line bg-white px-5 py-3.5 text-base font-semibold text-ink hover:border-green/40 disabled:opacity-70"
          >
            {offerteOk
              ? "✓ Offerte intern genoteerd"
              : "Offerte vastleggen (intern)"}
          </button>

          {(offerteOk || subsidieOk) && (
            <p className="rounded-xl border border-green/30 bg-green-soft px-4 py-3 text-center text-sm text-green-dark">
              Adviesproces afgerond voor {leadNaam}. Ga terug naar de lead om
              een echte offerte te maken wanneer je wilt.
            </p>
          )}
        </div>
      )}

      {/* Subsidie popup */}
      {subsidiePopup && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md animate-[fadeIn_0.25s_ease] rounded-2xl border border-line bg-white p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:p-8">
            {subsidiePopup === "loading" ? (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-orange/25 border-t-orange" />
                  <div>
                    <p className="font-display text-lg font-semibold text-ink">
                      Subsidie reserveren…
                    </p>
                    <p className="text-xs text-muted">
                      BTW{hasWarmtefonds ? " & Warmtefonds" : ""} vastleggen
                    </p>
                  </div>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-orange/15">
                  <div
                    className="h-full rounded-full bg-orange transition-[width]"
                    style={{ width: `${loadProgress}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green text-2xl text-white">
                  ✓
                </div>
                <p className="text-center font-display text-xl font-semibold text-green-dark sm:text-2xl">
                  Uw BTW en Warmtefonds subsidie is voltooid
                </p>
                <p className="mt-3 text-center text-sm text-muted">
                  Intern gereserveerd voor {leadNaam}.
                </p>
                <button
                  type="button"
                  onClick={() => setSubsidiePopup(null)}
                  className={`${btnPrimary} mt-6 w-full`}
                >
                  Sluiten
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
