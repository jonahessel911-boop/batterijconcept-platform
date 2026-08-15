"use client";

import { useMemo, useState } from "react";
import { AiAvatar } from "../AiAvatar";
import { TechLoader } from "../TechLoader";
import { ALPHA_ESS_93 } from "../types";
import { btnPrimary, stepEyebrow, stepLead, stepTitle } from "../ui";

export function StepTechCheck({
  leadNaam,
  plaatsNaam,
  adres,
  onDone,
}: {
  leadNaam: string;
  plaatsNaam: string;
  adres: string;
  onDone: () => void;
}) {
  const lines = [
    "Adres ophalen en buurtgegevens laden…",
    `Uitzoeken welke batterij het beste past bij ${leadNaam}…`,
    `Beoordeelt op basis van wensen van ${leadNaam}…`,
    `Meest verkocht in de buurt van ${plaatsNaam || "deze regio"}…`,
    "Voordeelberekening uitvoeren…",
    "Vergelijken van Alpha ESS, SolarEdge en Enphase…",
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className={stepEyebrow}>Productwijzer</p>
        <h1 className={stepTitle}>We zoeken de beste match…</h1>
        <p className={stepLead}>
          We laden kaart, producten en merken — even checken wat het best past.
        </p>
      </div>
      <TechLoader
        lines={lines}
        durationMs={30000}
        onDone={onDone}
        addressQuery={adres !== "—" ? adres : plaatsNaam || "Nederland"}
        plaatsNaam={plaatsNaam}
      />
    </div>
  );
}

type WhySlide = {
  title: string;
  headline: string;
  body: string;
  highlight?: string;
};

const PRODUCT_TABS = [
  {
    id: "specs",
    label: "Specificaties",
    title: "Technische specs",
    points: [
      "Bruikbare capaciteit: 9,3 kWh — ideaal voor een gemiddeld NL-huishouden",
      "Hoog rendement bij laden én ontladen",
      "Compacte wandmontage, past in veel bijkeukens / garages",
      "Modulaire uitbreiding later mogelijk",
    ],
  },
  {
    id: "ems",
    label: "EMS",
    title: "Energy Management System",
    points: [
      "Koopt automatisch goedkoop in, verkoopt duur",
      "Stuurt laden/ontladen op basis van prijs én zonnestroom",
      "Werkt op de achtergrond — geen gedoe voor de klant",
      "Extra verdienen naast zelfverbruik",
    ],
  },
  {
    id: "noodstroom",
    label: "Noodstroom",
    title: "Backup bij stroomuitval",
    points: [
      "Woning (gedeeltelijk) van stroom voorzien bij uitval",
      "Belangrijke groepen: verlichting, koelkast, internet",
      "Rust en zekerheid voor het gezin",
      "Optioneel uitbreidbaar afhankelijk van de meterkast",
    ],
  },
  {
    id: "installatie",
    label: "Installatie",
    title: "Schouw & installatie",
    points: [
      "Eerst schouw: plek, aansluiting, veiligheid",
      "Gecertificeerde monteurs",
      "Netjes afgewerkt en veilig aangesloten",
      "Uitleg op de opleveringsdag: hoe de app/EMS werkt",
    ],
  },
  {
    id: "garantie",
    label: "Garantie",
    title: "Garantie & service",
    points: [
      "Fabrikantgarantie op de Alpha ESS",
      "Service via Batterijconcept bij vragen",
      "Monitoring op afstand waar mogelijk",
      "Duidelijk aanspreekpunt na installatie",
    ],
  },
] as const;

export function StepProduct({
  leadNaam,
  plaatsNaam,
  heeftZonnepanelen,
  onDone,
}: {
  leadNaam: string;
  plaatsNaam: string;
  heeftZonnepanelen: boolean | null;
  onDone: () => void;
}) {
  const whySlides: WhySlide[] = useMemo(
    () => [
      {
        title: "De winnaar",
        headline: `Beste match voor ${leadNaam}`,
        body: "Na vergelijking van Alpha ESS, SolarEdge en Enphase komt de 9,3 kWh Alpha ESS als sterkste allrounder uit de bus voor deze situatie.",
        highlight: "Uitgelicht advies",
      },
      {
        title: "Verbruik",
        headline: `Past bij het verbruik van ${leadNaam}`,
        body: "9,3 kWh dekt typisch avondverbruik na zonnige dagen: koken, TV, warmtepomp-hulp, laden van apparaten — zonder overdimensioneren.",
      },
      {
        title: "Buurt",
        headline: plaatsNaam
          ? `Veel gekozen in en rond ${plaatsNaam}`
          : "Bewezen in de Nederlandse markt",
        body: "Dit formaat zien we vaak terug bij vergelijkbare woningen in de regio. Praktisch, betrouwbaar en goed te installeren.",
      },
      {
        title: "Zonnestroom",
        headline: heeftZonnepanelen
          ? "Haalt meer uit bestaande panelen"
          : "Klaar voor panelen + EMS later",
        body: heeftZonnepanelen
          ? "Overtollige zonnestroom gaat de batterij in i.p.v. het net. ’s Avonds gebruikt de woning die stroom zelf — minder terugleveren, meer eigen verbruik."
          : "Het systeem is voorbereid op zonnepanelen én EMS. Zo groeit de oplossing mee met de woning.",
      },
      {
        title: "2027",
        headline: "Bescherming tegen einde salderen",
        body: "Vanaf 1 januari 2027 is terugleveren minder waard. Opslaan + EMS dempt die klap: minder weggeven, meer zelf gebruiken of slim handelen.",
      },
    ],
    [heeftZonnepanelen, leadNaam, plaatsNaam]
  );

  const [phase, setPhase] = useState<"why" | "tabs">("why");
  const [whyIdx, setWhyIdx] = useState(0);
  const [tabId, setTabId] = useState<(typeof PRODUCT_TABS)[number]["id"]>(
    "specs"
  );
  const [seenTabs, setSeenTabs] = useState<Set<string>>(
    () => new Set(["specs"])
  );

  const why = whySlides[whyIdx]!;
  const activeTab =
    PRODUCT_TABS.find((t) => t.id === tabId) || PRODUCT_TABS[0]!;
  const allTabsSeen = PRODUCT_TABS.every((t) => seenTabs.has(t.id));

  function selectTab(id: (typeof PRODUCT_TABS)[number]["id"]) {
    setTabId(id);
    setSeenTabs((prev) => new Set(prev).add(id));
  }

  function handleDuidelijk() {
    if (phase === "why") {
      if (whyIdx < whySlides.length - 1) {
        setWhyIdx((i) => i + 1);
        return;
      }
      setPhase("tabs");
      return;
    }
    if (!allTabsSeen) {
      const nextTab = PRODUCT_TABS.find((t) => !seenTabs.has(t.id));
      if (nextTab) {
        selectTab(nextTab.id);
        return;
      }
    }
    onDone();
  }

  return (
    <div className="space-y-6">
      <div>
        <p className={stepEyebrow}>Advies · uitgelicht</p>
        <h1 className={stepTitle}>Beste match voor {leadNaam}</h1>
        <p className={stepLead}>
          {phase === "why"
            ? "Eerst waarom dit de beste keuze is — daarna alle productinfo per tab."
            : "Klik de tabs om het product goed uit te leggen. Daarna: Duidelijk."}
        </p>
      </div>

      {/* Hero product spotlight — always visible */}
      <div className="relative overflow-hidden rounded-3xl border-2 border-green bg-gradient-to-br from-green-soft via-white to-white p-5 shadow-[0_20px_50px_rgba(26,138,62,0.18)] sm:p-8">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-green/15 blur-2xl" />
        <div className="absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-orange/10 blur-2xl" />

        <div className="relative grid items-center gap-6 sm:grid-cols-[1fr_220px]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-green px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
              ★ Aanbevolen match
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brands/alpha-ess.svg"
              alt="Alpha ESS"
              className="mt-4 h-10 w-auto rounded-lg"
            />
            <p className="mt-4 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              {ALPHA_ESS_93.capaciteitKwh.toString().replace(".", ",")} kWh
            </p>
            <p className="mt-1 text-lg font-semibold text-green-dark">
              {ALPHA_ESS_93.naam}
            </p>
            <p className="mt-3 max-w-md text-sm text-muted">
              Gekozen na vergelijking van merken — afgestemd op verbruik,
              {plaatsNaam ? ` regio ${plaatsNaam}` : " de regio"} en 2027.
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/products/battery.png"
            alt="Alpha ESS batterij"
            className="mx-auto max-h-52 object-contain drop-shadow-xl sm:max-h-60"
          />
        </div>
      </div>

      {phase === "why" ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_12px_40px_rgba(13,92,50,0.08)]">
          <div className="flex items-center justify-between border-b border-line bg-wash px-5 py-3">
            <p className="text-xs font-semibold text-muted">
              Waarom deze keuze · {whyIdx + 1} / {whySlides.length}
            </p>
            <div className="flex gap-1.5">
              {whySlides.map((_, i) => (
                <span
                  key={i}
                  className={[
                    "h-2 w-2 rounded-full",
                    i < whyIdx
                      ? "bg-green"
                      : i === whyIdx
                        ? "bg-green-dark"
                        : "bg-line",
                  ].join(" ")}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-6 p-6 sm:grid-cols-[140px_1fr] sm:items-center sm:p-8">
            <AiAvatar speaking />
            <div>
              {why.highlight && (
                <span className="mb-2 inline-block rounded-full bg-orange/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange">
                  {why.highlight}
                </span>
              )}
              <p className="text-[10px] font-semibold uppercase tracking-wider text-green">
                {why.title}
              </p>
              <p className="mt-1 font-display text-xl font-semibold text-ink sm:text-2xl">
                {why.headline}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
                {why.body}
              </p>
            </div>
          </div>

          <div className="border-t border-line bg-wash/60 px-5 py-4 sm:px-8">
            <button
              type="button"
              onClick={handleDuidelijk}
              className={`${btnPrimary} w-full sm:w-auto sm:min-w-[220px]`}
            >
              {whyIdx >= whySlides.length - 1
                ? "Duidelijk — product uitleggen →"
                : "Duidelijk"}
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_12px_40px_rgba(13,92,50,0.08)]">
          <div className="border-b border-line bg-wash px-3 pt-3 sm:px-4">
            <div className="flex gap-1 overflow-x-auto pb-0">
              {PRODUCT_TABS.map((t) => {
                const active = t.id === tabId;
                const seen = seenTabs.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => selectTab(t.id)}
                    className={[
                      "relative shrink-0 rounded-t-xl px-3.5 py-2.5 text-xs font-semibold transition sm:text-sm",
                      active
                        ? "bg-white text-green-dark"
                        : "text-muted hover:text-ink",
                    ].join(" ")}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {seen && !active && (
                        <span className="text-[10px] text-green">✓</span>
                      )}
                      {t.label}
                    </span>
                    {active && (
                      <span className="absolute inset-x-2 -bottom-px h-0.5 bg-green" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-6 p-6 sm:grid-cols-[140px_1fr] sm:items-start sm:p-8">
            <AiAvatar speaking />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-green">
                Productinfo · {activeTab.label}
              </p>
              <h3 className="mt-1 font-display text-xl font-semibold text-ink sm:text-2xl">
                {activeTab.title}
              </h3>
              <ul className="mt-4 space-y-3">
                {activeTab.points.map((p) => (
                  <li
                    key={p}
                    className="flex gap-3 rounded-xl border border-line bg-wash/70 px-3.5 py-3 text-sm text-ink"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green text-[10px] text-white">
                      ✓
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
              {!allTabsSeen && (
                <p className="mt-4 text-xs text-muted">
                  Tip: open alle tabs zodat je het product volledig kunt
                  toelichten (
                  {seenTabs.size}/{PRODUCT_TABS.length}).
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-line bg-wash/60 px-5 py-4 sm:px-8">
            <button
              type="button"
              onClick={handleDuidelijk}
              className={`${btnPrimary} w-full sm:w-auto sm:min-w-[220px]`}
            >
              {allTabsSeen
                ? "Duidelijk — naar prijs →"
                : "Duidelijk — volgende tab"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
