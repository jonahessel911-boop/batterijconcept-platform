"use client";

import type { AdviesAnswers, FinancieringOptie } from "../types";
import { card, stepEyebrow, stepLead, stepTitle } from "../ui";

const OPTIES: {
  id: FinancieringOptie;
  label: string;
  logo: string;
  beschrijving: string;
}[] = [
  {
    id: "eigen_geld",
    label: "Eigen geld",
    logo: "/logo.png",
    beschrijving: "Direct investeren zonder lening.",
  },
  {
    id: "warmtefonds",
    label: "Warmtefonds",
    logo: "/brands/warmtefonds.svg",
    beschrijving: "Duurzame lening via Nationaal Warmtefonds.",
  },
  {
    id: "svn",
    label: "SVN",
    logo: "/brands/svn.svg",
    beschrijving: "Gemeentelijke stimuleringslening (SVN).",
  },
];

export function StepFinanciering({
  answers,
  onChange,
  plaatsNaam,
}: {
  answers: AdviesAnswers;
  onChange: (patch: Partial<AdviesAnswers>) => void;
  plaatsNaam: string;
}) {
  function toggle(id: FinancieringOptie) {
    const has = answers.financieringen.includes(id);
    onChange({
      financieringen: has
        ? answers.financieringen.filter((x) => x !== id)
        : [...answers.financieringen, id],
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <p className={stepEyebrow}>Financiering checken</p>
        <h1 className={stepTitle}>Hoe wil de klant financieren?</h1>
        <p className={stepLead}>
          Meerdere opties mogelijk.
          {plaatsNaam ? ` Relevant voor ${plaatsNaam}.` : ""}
        </p>
      </div>

      <div className="grid gap-3">
        {OPTIES.map((o) => {
          const active = answers.financieringen.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => toggle(o.id)}
              className={[
                "flex items-center gap-4 rounded-2xl border p-4 text-left transition sm:p-5",
                active
                  ? "border-green bg-green-soft shadow-sm"
                  : "border-line bg-white hover:border-green/40",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                  active
                    ? "border-green bg-green text-white"
                    : "border-line text-transparent",
                ].join(" ")}
              >
                ✓
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={o.logo}
                alt={o.label}
                className="h-10 w-28 rounded-lg object-contain bg-white p-1"
              />
              <div>
                <p className="font-semibold text-ink">{o.label}</p>
                <p className="text-sm text-muted">{o.beschrijving}</p>
              </div>
            </button>
          );
        })}
      </div>

      {answers.financieringen.length > 0 && (
        <div className={card}>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
            Geselecteerd
          </p>
          <div className="flex flex-wrap gap-3">
            {answers.financieringen.map((id) => {
              const o = OPTIES.find((x) => x.id === id)!;
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={id}
                  src={o.logo}
                  alt={o.label}
                  className="h-12 w-36 rounded-lg border border-line bg-white object-contain p-2"
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
