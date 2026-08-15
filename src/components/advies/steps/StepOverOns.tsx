"use client";

import { useState } from "react";
import { AiAvatar } from "../AiAvatar";
import { btnPrimary, card, stepEyebrow, stepLead, stepTitle } from "../ui";

const SLIDES = [
  {
    n: "01",
    title: "Ons verhaal",
    avatarLine: "Duurzame energie moet ook slim zijn.",
    text: "Batterijconcept is ontstaan vanuit één overtuiging: opwekken is niet genoeg. Opslaan, sturen en verdienen maakt het verschil — voor elk huishouden.",
  },
  {
    n: "02",
    title: "Adviesgesprek",
    avatarLine: "Eerst luisteren, dan rekenen.",
    text: "We brengen de situatie in kaart: verbruik, panelen, doelen. Geen standaardpraatje — een persoonlijke check.",
  },
  {
    n: "03",
    title: "Wij vergelijken alles",
    avatarLine: "Geen vast merk. Wel de beste match.",
    text: "Alpha ESS, SolarEdge, Enphase — wij vergelijken wat écht bij deze woning past. Jij krijgt het advies, niet het merk dat toevallig op voorraad ligt.",
  },
  {
    n: "04",
    title: "Schouw",
    avatarLine: "We checken de plek vóór we installeren.",
    text: "We kijken waar de batterij komt te staan: ruimte, aansluiting, veiligheid. Zo voorkom je verrassingen op de installatiedag.",
  },
  {
    n: "05",
    title: "Installatie",
    avatarLine: "Netjes, veilig, gecertificeerd.",
    text: "Gecertificeerde monteurs sluiten alles veilig aan — strak afgewerkt, zodat jij meteen kunt profiteren.",
  },
];

export function StepOverOns({ onDone }: { onDone: () => void }) {
  const [idx, setIdx] = useState(0);
  const slide = SLIDES[idx]!;
  const isLast = idx >= SLIDES.length - 1;

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
        <p className={stepEyebrow}>Over Batterijconcept</p>
        <h1 className={stepTitle}>Ons verhaal — stap voor stap</h1>
        <p className={stepLead}>
          Eén slide per keer. Klik op <strong>Duidelijk</strong> als het helder
          is.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_12px_40px_rgba(13,92,50,0.08)]">
        <div className="flex items-center justify-between border-b border-line bg-wash px-5 py-3">
          <p className="text-xs font-semibold text-muted">
            Slide {idx + 1} / {SLIDES.length}
          </p>
          <div className="flex gap-1.5">
            {SLIDES.map((_, i) => (
              <span
                key={i}
                className={[
                  "h-2 w-2 rounded-full",
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
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green font-display text-sm text-white">
                {slide.n}
              </span>
              {slide.title}
            </div>
            <p className="font-display text-xl font-semibold text-ink sm:text-2xl">
              {slide.avatarLine}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
              {slide.text}
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

export function StepMensen({ onDone }: { onDone: () => void }) {
  const slides = [
    {
      label: "Adviseurs",
      labelColor: "text-green",
      title: "Persoonlijk & technisch",
      avatarLine: "Uitleg in klare taal — en live meerekenen.",
      text: "Onze adviseurs lichten de situatie toe in begrijpelijke taal. Geen druk, wel duidelijkheid over besparing, EMS en financiering.",
    },
    {
      label: "Installateurs",
      labelColor: "text-orange",
      title: "Gecertificeerd & zorgvuldig",
      avatarLine: "Netjes, veilig, met oog voor jouw huis.",
      text: "Monteurs met ervaring in batterijsystemen. Altijd met aandacht voor de plek waar de batterij komt te staan.",
    },
  ];

  const [idx, setIdx] = useState(0);
  const slide = slides[idx]!;
  const isLast = idx >= slides.length - 1;

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
        <p className={stepEyebrow}>Ons team</p>
        <h1 className={stepTitle}>Onze mensen</h1>
        <p className={stepLead}>
          Eén slide per keer — klik op <strong>Duidelijk</strong> als het
          helder is.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_12px_40px_rgba(13,92,50,0.08)]">
        <div className="flex items-center justify-between border-b border-line bg-wash px-5 py-3">
          <p className="text-xs font-semibold text-muted">
            Slide {idx + 1} / {slides.length}
          </p>
          <div className="flex gap-1.5">
            {slides.map((_, i) => (
              <span
                key={i}
                className={[
                  "h-2 w-2 rounded-full",
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
            <p
              className={`text-[10px] font-semibold uppercase tracking-wider ${slide.labelColor}`}
            >
              {slide.label}
            </p>
            <p className="mt-2 font-display text-xl font-semibold text-ink sm:text-2xl">
              {slide.avatarLine}
            </p>
            <h3 className="mt-2 font-display text-lg font-semibold text-ink">
              {slide.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
              {slide.text}
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

export function StepTrustpilot() {
  const reviews = [
    {
      naam: "Marieke van D.",
      score: 5,
      tekst: "Duidelijk advies, nette installatie. Batterij draait perfect met onze panelen.",
    },
    {
      naam: "Peter H.",
      score: 5,
      tekst: "Eindelijk begrijp ik wat er in 2027 verandert. Fijn dat ze alles uitrekenden.",
    },
    {
      naam: "Sandra & Tom",
      score: 5,
      tekst: "Snel geschakeld, fijne monteurs. App laat precies zien wat we verdienen.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brands/trustpilot.svg"
          alt="Trustpilot"
          className="h-10 w-auto rounded-lg"
        />
        <div>
          <p className="font-display text-2xl font-semibold text-ink">
            4,8 / 5
          </p>
          <p className="text-sm text-muted">Op basis van klantreviews</p>
        </div>
      </div>

      <div className="grid gap-3">
        {reviews.map((r) => (
          <div key={r.naam} className={card}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-ink">{r.naam}</p>
              <p className="text-sm text-[#00B67A]">{"★".repeat(r.score)}</p>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">{r.tekst}</p>
          </div>
        ))}
      </div>

      <a
        href="https://www.trustpilot.com"
        target="_blank"
        rel="noreferrer"
        className="inline-flex rounded-full border border-[#00B67A]/40 bg-[#00B67A]/10 px-4 py-2.5 text-sm font-semibold text-[#008f5d] hover:bg-[#00B67A]/15"
      >
        Lees meer reviews
      </a>
    </div>
  );
}
