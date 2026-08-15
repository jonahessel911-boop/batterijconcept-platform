"use client";

import { useMemo, useState } from "react";
import { berekenKosten, formatEuroNl } from "../calculations";
import type { AdviesAnswers } from "../types";
import {
  btnChoice,
  btnChoiceOff,
  btnChoiceOn,
  btnPrimary,
  card,
  fieldInput,
  fieldLabel,
  stepEyebrow,
  stepLead,
  stepTitle,
} from "../ui";

type QId =
  | "panelen_ja_nee"
  | "aantal_panelen"
  | "verbruik"
  | "teruglevering"
  | "prijs_kwh"
  | "terugleverkosten"
  | "kosten";

export function StepKwalificatie({
  leadNaam,
  answers,
  onChange,
}: {
  leadNaam: string;
  answers: AdviesAnswers;
  onChange: (patch: Partial<AdviesAnswers>) => void;
}) {
  const [qIdx, setQIdx] = useState(0);
  const [showKosten, setShowKosten] = useState(false);
  const calc = berekenKosten(answers);

  const questions = useMemo(() => {
    const list: { id: QId; title: string }[] = [
      { id: "panelen_ja_nee", title: `Heeft ${leadNaam} al zonnepanelen?` },
    ];
    if (answers.heeftZonnepanelen) {
      list.push({ id: "aantal_panelen", title: "Hoeveel zonnepanelen?" });
    }
    list.push(
      {
        id: "verbruik",
        title: "Wat is het jaarlijks stroomverbruik?",
      },
      {
        id: "teruglevering",
        title: "Hoeveel kWh wordt er gemiddeld teruggeleverd?",
      },
      {
        id: "prijs_kwh",
        title: "Wat betaalt de klant nu per kWh elektriciteit?",
      },
      {
        id: "terugleverkosten",
        title: "Wat zijn de terugleverkosten / inkoopprijs?",
      },
      { id: "kosten", title: "Kostenverschil bekijken" }
    );
    return list;
  }, [answers.heeftZonnepanelen, leadNaam]);

  const safeIdx = Math.min(qIdx, questions.length - 1);
  const current = questions[safeIdx]!;
  const isLast = safeIdx >= questions.length - 1;

  function canAdvance(): boolean {
    switch (current.id) {
      case "panelen_ja_nee":
        return answers.heeftZonnepanelen !== null;
      case "aantal_panelen":
        return (answers.aantalPanelen ?? 0) > 0;
      case "verbruik":
        return (answers.jaarverbruikKwh ?? 0) > 0;
      case "teruglevering":
        return answers.teruglevering !== null;
      case "prijs_kwh":
        return (answers.prijsPerKwh ?? 0) > 0;
      case "terugleverkosten":
        return answers.terugleverkostenPerKwh !== null;
      case "kosten":
        return showKosten;
      default:
        return false;
    }
  }

  function goNext() {
    if (!canAdvance()) return;
    if (current.id === "kosten") return;
    if (current.id === "terugleverkosten") {
      setQIdx((i) => i + 1);
      return;
    }
    // Bij wissel ja/nee panelen: index opnieuw laten kloppen
    setQIdx((i) => i + 1);
  }

  function goBack() {
    if (safeIdx <= 0) return;
    if (current.id === "kosten") setShowKosten(false);
    setQIdx((i) => Math.max(0, i - 1));
  }

  // Als panelen "nee" wordt gekozen terwijl we op aantal zaten → terug naar logische flow
  function setPanelen(v: boolean) {
    onChange({
      heeftZonnepanelen: v,
      ...(v ? {} : { aantalPanelen: null }),
    });
    setShowKosten(false);
  }

  return (
    <div className="space-y-6 lg:grid lg:grid-cols-[1fr_300px] lg:items-start lg:gap-6 lg:space-y-0">
      <div className="space-y-6">
        <div>
          <p className={stepEyebrow}>Stap 2 · Situatie checken</p>
          <h1 className={stepTitle}>De situatie van {leadNaam}</h1>
          <p className={stepLead}>
            Eén vraag per keer. Kosten komen pas aan het eind.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_12px_40px_rgba(13,92,50,0.08)]">
          <div className="flex items-center justify-between border-b border-line bg-wash px-5 py-3">
            <p className="text-xs font-semibold text-muted">
              Vraag {safeIdx + 1} / {questions.length}
            </p>
            <div className="flex gap-1.5">
              {questions.map((q, i) => (
                <span
                  key={q.id}
                  className={[
                    "h-2 w-2 rounded-full",
                    i < safeIdx
                      ? "bg-green"
                      : i === safeIdx
                        ? "bg-green-dark"
                        : "bg-line",
                  ].join(" ")}
                />
              ))}
            </div>
          </div>

          <div className="p-6 sm:p-8">
            <p className={`${fieldLabel} text-base !mb-4`}>{current.title}</p>

            {current.id === "panelen_ja_nee" && (
              <div className="flex gap-2">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    onClick={() => setPanelen(v)}
                    className={[
                      btnChoice,
                      answers.heeftZonnepanelen === v
                        ? btnChoiceOn
                        : btnChoiceOff,
                    ].join(" ")}
                  >
                    {v ? "Ja" : "Nee"}
                  </button>
                ))}
              </div>
            )}

            {current.id === "aantal_panelen" && (
              <div className="flex max-w-xs items-center gap-2">
                <input
                  type="number"
                  value={answers.aantalPanelen ?? ""}
                  onChange={(e) =>
                    onChange({ aantalPanelen: Number(e.target.value) })
                  }
                  className={fieldInput}
                  autoFocus
                />
                <span className="text-xs text-muted">panelen</span>
              </div>
            )}

            {current.id === "verbruik" && (
              <div className="flex max-w-xs items-center gap-2">
                <input
                  type="number"
                  value={answers.jaarverbruikKwh ?? ""}
                  onChange={(e) =>
                    onChange({ jaarverbruikKwh: Number(e.target.value) })
                  }
                  placeholder="Bijv. 3500"
                  className={fieldInput}
                  autoFocus
                />
                <span className="text-xs text-muted">kWh / jaar</span>
              </div>
            )}

            {current.id === "teruglevering" && (
              <div className="space-y-3">
                <div className="flex max-w-xs items-center gap-2">
                  <input
                    type="number"
                    value={answers.teruglevering ?? ""}
                    onChange={(e) =>
                      onChange({ teruglevering: Number(e.target.value) })
                    }
                    placeholder={
                      answers.terugleveringIsProcent ? "Bijv. 60" : "Bijv. 2000"
                    }
                    className={fieldInput}
                    autoFocus
                  />
                  <span className="text-xs font-semibold text-ink">
                    {answers.terugleveringIsProcent ? "%" : "kWh"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      terugleveringIsProcent: !answers.terugleveringIsProcent,
                    })
                  }
                  className="text-xs font-semibold text-green hover:underline"
                >
                  Wissel naar {answers.terugleveringIsProcent ? "kWh" : "%"}
                </button>
              </div>
            )}

            {current.id === "prijs_kwh" && (
              <div className="flex max-w-xs items-center gap-2">
                <input
                  type="number"
                  step={0.01}
                  value={answers.prijsPerKwh ?? ""}
                  onChange={(e) =>
                    onChange({ prijsPerKwh: Number(e.target.value) })
                  }
                  placeholder="Bijv. 0,28"
                  className={fieldInput}
                  autoFocus
                />
                <span className="text-xs text-muted">€ / kWh</span>
              </div>
            )}

            {current.id === "terugleverkosten" && (
              <div className="flex max-w-xs items-center gap-2">
                <input
                  type="number"
                  step={0.01}
                  value={answers.terugleverkostenPerKwh ?? ""}
                  onChange={(e) =>
                    onChange({
                      terugleverkostenPerKwh: Number(e.target.value),
                    })
                  }
                  placeholder="Bijv. 0,11"
                  className={fieldInput}
                  autoFocus
                />
                <span className="text-xs text-muted">€ / kWh</span>
              </div>
            )}

            {current.id === "kosten" && (
              <div className="space-y-4">
                {!showKosten ? (
                  <>
                    <p className="text-sm text-muted">
                      Alle antwoorden staan. Klaar om het kostenverschil te
                      tonen?
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowKosten(true)}
                      className={btnPrimary}
                    >
                      Toon kostenverschil
                    </button>
                  </>
                ) : (
                  <div className="space-y-3">
                    <Metric
                      label="Huidige kosten / maand"
                      value={formatEuroNl(calc.huidigeKostenMaand)}
                    />
                    <Metric
                      label="Kosten vanaf 1 jan 2027"
                      value={formatEuroNl(calc.kosten2027Maand)}
                      tone="warn"
                    />
                    <Metric
                      label="Verschil per maand"
                      value={`+ ${formatEuroNl(calc.verschilMaand)}`}
                      tone="danger"
                      big
                    />
                    <p className="rounded-xl bg-orange/10 px-3.5 py-3 text-xs leading-relaxed text-ink/80">
                      De salderingsregeling houdt in dat je teruggeleverde
                      stroom mag wegstrepen tegen afname. Vanaf 2027 stopt dit
                      geleidelijk. Zonder thuisbatterij wordt teruggeleverde
                      stroom veel minder waard.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line bg-wash/60 px-5 py-4">
            <button
              type="button"
              onClick={goBack}
              disabled={safeIdx === 0}
              className="rounded-full border border-line bg-white px-4 py-2 text-sm font-medium text-ink disabled:opacity-30"
            >
              Terug
            </button>
            {!isLast && (
              <button
                type="button"
                onClick={goNext}
                disabled={!canAdvance()}
                className={`${btnPrimary} disabled:opacity-40`}
              >
                Volgende vraag →
              </button>
            )}
            {isLast && showKosten && (
              <p className="text-sm font-medium text-green-dark">
                Klaar — ga verder onderaan
              </p>
            )}
          </div>
        </div>
      </div>

      <aside className="lg:sticky lg:top-28">
        <div className={`${card} space-y-2`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Voortgang vragen
          </p>
          {questions.map((q, i) => (
            <div
              key={q.id}
              className={[
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
                i === safeIdx
                  ? "bg-green-soft font-semibold text-green-dark"
                  : i < safeIdx
                    ? "text-ink"
                    : "text-muted",
              ].join(" ")}
            >
              <span className="w-4 tabular-nums">
                {i < safeIdx ? "✓" : i + 1}
              </span>
              <span className="truncate">{q.title}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string;
  tone?: "warn" | "danger";
  big?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-xl border px-4 py-3",
        tone === "danger"
          ? "border-red-200 bg-red-50"
          : tone === "warn"
            ? "border-orange/30 bg-orange/5"
            : "border-line bg-wash",
      ].join(" ")}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <p
        className={[
          "mt-1 font-display font-semibold tabular-nums",
          big ? "text-2xl" : "text-xl",
          tone === "danger"
            ? "text-red-600"
            : tone === "warn"
              ? "text-orange"
              : "text-ink",
        ].join(" ")}
      >
        {value}
      </p>
    </div>
  );
}
