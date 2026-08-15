"use client";

import { useState } from "react";
import { AiAvatar } from "../AiAvatar";
import { btnPrimary, stepEyebrow, stepLead, stepTitle } from "../ui";

const SLIDES = [
  {
    title: "Noodstroom",
    text: "Bij stroomuitval blijft de woning (gedeeltelijk) van stroom voorzien. Denk aan verlichting, koelkast en internet — ook als het net eruit ligt.",
    avatarLine: "Zo blijft {naam} niet in het donker zitten.",
  },
  {
    title: "Handelen op de energiemarkt",
    text: "Met een EMS (Energy Management System) koop je automatisch goedkoop in en verkoop je duur. De batterij werkt voor je — 24/7.",
    avatarLine: "Slim handelen, zonder dat {naam} er iets voor hoeft te doen.",
  },
  {
    title: "Lagere terugleverkosten",
    text: "Minder terugleveren = minder kosten. Liever zelf gebruiken of verdienen dan betalen om stroom het net op te sturen.",
    avatarLine: "Terugleverkosten? Die drukken we zo omlaag.",
  },
  {
    title: "Maximaal eigen verbruik",
    text: "Zonnestroom die je overdag opwekt, gebruik je ’s avonds zelf. De batterij is je eigen energievoorraad in huis.",
    avatarLine: "Jouw zon van overdag, jouw stroom vanavond.",
  },
  {
    title: "Bescherming tegen 2027",
    text: "De afbouw van de salderingsregeling raakt je minder hard. Opslaan en slim sturen beschermt {naam} tegen hogere kosten.",
    avatarLine: "Klaar voor 1 januari 2027 — met een plan.",
  },
];

export function StepBatterij({
  leadNaam,
  onDone,
}: {
  leadNaam: string;
  onDone: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const slide = SLIDES[idx]!;
  const isLast = idx >= SLIDES.length - 1;
  const line = slide.avatarLine.replace(/\{naam\}/g, leadNaam);
  const text = slide.text.replace(/\{naam\}/g, leadNaam);

  function handleDuidelijk() {
    if (isLast) {
      onDone();
      return;
    }
    setIdx((i) => i + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className={stepEyebrow}>Stap 4 · Thuisbatterij</p>
        <h1 className={stepTitle}>
          Wat doet een thuisbatterij precies voor {leadNaam}?
        </h1>
        <p className={stepLead}>
          Eén voordeel per keer — klik op <strong>Duidelijk</strong> als het
          helder is.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_12px_40px_rgba(13,92,50,0.08)]">
        <div className="flex items-center justify-between border-b border-line bg-wash px-5 py-3">
          <p className="text-xs font-semibold text-muted">
            Voordeel {idx + 1} / {SLIDES.length}
          </p>
          <div className="flex gap-1.5">
            {SLIDES.map((_, i) => (
              <span
                key={i}
                className={[
                  "h-2 w-2 rounded-full transition-colors",
                  i < idx
                    ? "bg-green"
                    : i === idx
                      ? "bg-green-dark"
                      : "bg-line",
                ].join(" ")}
              />
            ))}
          </div>
        </div>

        <div className="grid gap-6 p-6 sm:grid-cols-[160px_1fr] sm:items-center sm:p-8">
          <AiAvatar speaking />
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-green-soft px-3 py-1 text-xs font-semibold text-green-dark">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green text-[10px] text-white">
                {idx + 1}
              </span>
              {slide.title}
            </div>
            <p className="font-display text-xl font-semibold text-ink sm:text-2xl">
              {line}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
              {text}
            </p>
          </div>
        </div>

        <div className="border-t border-line bg-wash/60 px-5 py-4 sm:px-8">
          <button
            type="button"
            onClick={handleDuidelijk}
            className={`${btnPrimary} w-full sm:w-auto sm:min-w-[200px]`}
          >
            {isLast ? "Duidelijk — verder →" : "Duidelijk"}
          </button>
        </div>
      </div>
    </div>
  );
}
