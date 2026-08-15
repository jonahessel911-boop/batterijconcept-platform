"use client";

import { useEffect, useState } from "react";

type Slide = {
  id: number;
  badge: string;
  title: string;
  body: string;
  durationMs: number;
};

const SLIDES: Slide[] = [
  {
    id: 0,
    badge: "Nu",
    title: "Zo werkt salderen vandaag",
    body: "Zonnestroom die je teruglevert, streep je weg tegen stroom die je ’s avonds of ’s winters afneemt. Op papier is 1 kWh terug = 1 kWh minder betalen.",
    durationMs: 5500,
  },
  {
    id: 1,
    badge: "Vandaag",
    title: "Terugleveren heeft (bijna) volle waarde",
    body: "Overdag gaan de panelen aan, overtollige stroom gaat het net op. Dankzij saldering voelt dat nog als “gratis opslaan bij de energieleverancier”.",
    durationMs: 5500,
  },
  {
    id: 2,
    badge: "1 jan 2027",
    title: "Vanaf 1 januari 2027 stopt salderen",
    body: "De salderingsregeling wordt afgebouwd en verdwijnt. Teruggeleverde stroom mag je niet meer 1-op-1 wegstrepen. Die kWh is opeens veel minder waard — en je betaalt vaak terugleverkosten.",
    durationMs: 7000,
  },
  {
    id: 3,
    badge: "Zonder batterij",
    title: "Je energierekening stijgt",
    body: "Je koopt ’s avonds nog steeds dure stroom in, terwijl je overdag goedkope zonnestroom “weggeeft”. Het verschil per maand kan flink oplopen.",
    durationMs: 5500,
  },
  {
    id: 4,
    badge: "Met batterij",
    title: "Opslaan, zelf gebruiken of slim verkopen",
    body: "Een thuisbatterij + EMS bewaart jouw zonnestroom voor later, beperkt terugleverkosten, en kan handelen op de energiemarkt: goedkoop inkopen, duur verkopen.",
    durationMs: 6500,
  },
];

export function SalderingScene({
  playing,
  leadNaam,
}: {
  playing: boolean;
  leadNaam?: string;
}) {
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!playing || paused) return;
    const ms = SLIDES[slide]?.durationMs ?? 5000;
    const t = window.setTimeout(() => {
      setSlide((s) => (s + 1) % SLIDES.length);
    }, ms);
    return () => window.clearTimeout(t);
  }, [playing, paused, slide]);

  const current = SLIDES[slide]!;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_12px_40px_rgba(13,92,50,0.08)]">
      <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
        {/* Visual */}
        <div className="relative min-h-[280px] bg-gradient-to-b from-[#0d5c32] to-[#071a12] sm:min-h-[340px]">
          <div className="pointer-events-none absolute inset-0 opacity-25">
            <div className="advies-grid absolute inset-0" />
          </div>

          <div className="absolute left-4 top-4 z-10 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur">
            {current.badge}
          </div>

          <SceneArt phase={slide} />
        </div>

        {/* Copy / slides */}
        <div className="flex flex-col justify-between border-t border-line p-5 sm:p-6 lg:border-l lg:border-t-0">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-green">
              Slide {slide + 1} / {SLIDES.length}
            </p>
            <h3 className="mt-2 font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
              {current.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {current.body}
            </p>
            {slide === 2 && (
              <div className="mt-4 rounded-xl border border-orange/30 bg-orange/10 px-4 py-3 text-sm font-medium text-ink">
                Let op: vanaf{" "}
                <span className="font-bold text-orange">1 januari 2027</span>{" "}
                verdwijnt het salderingsvoordeel
                {leadNaam ? ` voor ${leadNaam}` : ""}. Zonder oplossing wordt
                teruggeleverde stroom veel minder waard.
              </div>
            )}
            {slide === 4 && (
              <ul className="mt-4 space-y-2 text-sm text-ink">
                {[
                  "Zonnestroom opslaan i.p.v. weggeven",
                  "’s Avonds zelf gebruiken",
                  "EMS: handelen op de markt",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green text-[10px] text-white">
                      ✓
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-1.5">
              {SLIDES.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSlide(i);
                    setPaused(true);
                  }}
                  className={[
                    "h-2 flex-1 rounded-full transition-all",
                    i === slide ? "bg-green" : "bg-line hover:bg-green/40",
                  ].join(" ")}
                  aria-label={`Ga naar slide ${i + 1}`}
                />
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setPaused(true);
                  setSlide((s) => (s - 1 + SLIDES.length) % SLIDES.length);
                }}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:border-green/40"
              >
                ← Vorige
              </button>
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                className="text-xs font-medium text-muted hover:text-ink"
              >
                {paused ? "Afspelen" : "Pauzeren"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPaused(true);
                  setSlide((s) => (s + 1) % SLIDES.length);
                }}
                className="rounded-full bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-dark"
              >
                Volgende →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SceneArt({ phase }: { phase: number }) {
  return (
    <svg
      viewBox="0 0 640 400"
      className="relative mx-auto h-full w-full max-h-[380px]"
      aria-hidden
    >
      <defs>
        <linearGradient id="roofG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3dd68c" />
          <stop offset="100%" stopColor="#1a8a3e" />
        </linearGradient>
        <linearGradient id="sunG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f7d060" />
          <stop offset="100%" stopColor="#f37021" />
        </linearGradient>
        <filter id="glowG">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <ellipse cx="320" cy="355" rx="240" ry="22" fill="#0a2418" opacity="0.9" />

      {/* Sun pulses harder on solar phases */}
      <circle
        cx="520"
        cy="72"
        r={phase <= 1 ? 32 : 26}
        fill="url(#sunG)"
        filter="url(#glowG)"
        className={phase <= 1 ? "origin-center animate-pulse" : ""}
      />

      {/* House */}
      <g transform="translate(190,100)">
        <polygon points="130,18 240,95 20,95" fill="url(#roofG)" />
        <rect x="40" y="95" width="180" height="120" fill="#e8f6ec" />
        <rect x="110" y="145" width="42" height="70" fill="#0d5c32" />
        <rect x="58" y="120" width="32" height="30" fill="#7ec8ff" opacity="0.9" />
        <rect x="170" y="120" width="32" height="30" fill="#7ec8ff" opacity="0.9" />
        <g fill="#0a4727" stroke="#9dffc4" strokeWidth="1.2">
          <rect x="55" y="48" width="44" height="24" rx="2" />
          <rect x="110" y="48" width="44" height="24" rx="2" />
          <rect x="165" y="58" width="44" height="24" rx="2" />
        </g>
      </g>

      {/* Phase 0–1: flow to grid, saldering badge */}
      {(phase === 0 || phase === 1) && (
        <g>
          <path
            d="M370 145 C430 125, 500 165, 555 210"
            fill="none"
            stroke="#3dd68c"
            strokeWidth="3.5"
            strokeDasharray="10 7"
            className="advies-dash"
            filter="url(#glowG)"
          />
          <circle cx="560" cy="220" r="28" fill="#123526" stroke="#3dd68c" strokeWidth="2" />
          <text x="560" y="224" textAnchor="middle" fill="#9dffc4" fontSize="12" fontFamily="sans-serif" fontWeight="700">
            Net
          </text>
          {phase === 0 && (
            <g>
              <rect x="40" y="40" width="150" height="44" rx="10" fill="#1a8a3e" />
              <text x="115" y="67" textAnchor="middle" fill="#fff" fontSize="13" fontFamily="sans-serif" fontWeight="700">
                1 kWh ↔ 1 kWh
              </text>
            </g>
          )}
          {phase === 1 && (
            <g>
              <rect x="40" y="40" width="170" height="44" rx="10" fill="#ffffff" opacity="0.95" />
              <text x="125" y="67" textAnchor="middle" fill="#0d5c32" fontSize="13" fontFamily="sans-serif" fontWeight="700">
                Terugleveren = waarde
              </text>
            </g>
          )}
        </g>
      )}

      {/* Phase 2: 2027 break */}
      {phase === 2 && (
        <g>
          <path
            d="M370 145 C430 125, 500 165, 555 210"
            fill="none"
            stroke="#f37021"
            strokeWidth="2.5"
            strokeDasharray="4 12"
            className="advies-dash-slow"
            opacity="0.55"
          />
          <circle cx="560" cy="220" r="28" fill="#3a1a0a" stroke="#f37021" strokeWidth="2" />
          <text x="560" y="224" textAnchor="middle" fill="#ffb087" fontSize="11" fontFamily="sans-serif" fontWeight="700">
            Net
          </text>
          {/* Big 2027 callout */}
          <g filter="url(#glowG)">
            <rect x="180" y="250" width="280" height="70" rx="14" fill="#f37021" />
            <text x="320" y="278" textAnchor="middle" fill="#fff" fontSize="20" fontFamily="sans-serif" fontWeight="800">
              1 januari 2027
            </text>
            <text x="320" y="302" textAnchor="middle" fill="#fff" fontSize="13" fontFamily="sans-serif" fontWeight="600">
              Salderen stopt · terugleveren ↓ waard
            </text>
          </g>
          {/* Broken equals */}
          <g>
            <rect x="40" y="40" width="160" height="48" rx="10" fill="#ffffff" />
            <text x="120" y="70" textAnchor="middle" fill="#c0392b" fontSize="14" fontFamily="sans-serif" fontWeight="800">
              1 kWh ≠ 1 kWh
            </text>
          </g>
        </g>
      )}

      {/* Phase 3: cost up */}
      {phase === 3 && (
        <g>
          <path
            d="M370 145 C430 125, 500 165, 555 210"
            fill="none"
            stroke="#f37021"
            strokeWidth="2"
            strokeDasharray="3 10"
            opacity="0.35"
          />
          {/* Cost arrow */}
          <g transform="translate(470,90)">
            <rect x="0" y="0" width="120" height="100" rx="12" fill="#fff" />
            <text x="60" y="28" textAnchor="middle" fill="#5a635c" fontSize="11" fontFamily="sans-serif" fontWeight="600">
              Rekening
            </text>
            <path d="M60 40 L60 72" stroke="#e74c3c" strokeWidth="4" strokeLinecap="round" />
            <path d="M48 60 L60 78 L72 60" fill="none" stroke="#e74c3c" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <text x="60" y="94" textAnchor="middle" fill="#e74c3c" fontSize="13" fontFamily="sans-serif" fontWeight="800">
              + kosten
            </text>
          </g>
          <rect x="40" y="40" width="200" height="48" rx="10" fill="#fff0ee" stroke="#e74c3c" />
          <text x="140" y="70" textAnchor="middle" fill="#c0392b" fontSize="13" fontFamily="sans-serif" fontWeight="700">
            Weggeven overdag · kopen ’s avonds
          </text>
        </g>
      )}

      {/* Phase 4: battery + EMS */}
      {phase === 4 && (
        <g filter="url(#glowG)">
          <rect
            x="145"
            y="250"
            width="78"
            height="56"
            rx="10"
            fill="#1a8a3e"
            stroke="#9dffc4"
            strokeWidth="2.5"
          />
          <rect x="172" y="240" width="24" height="10" rx="2" fill="#3dd68c" />
          <text x="184" y="285" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="sans-serif" fontWeight="700">
            kWh
          </text>

          {/* Solar → battery */}
          <path
            d="M330 155 C280 190, 230 220, 200 255"
            fill="none"
            stroke="#3dd68c"
            strokeWidth="3.5"
            strokeDasharray="8 6"
            className="advies-dash"
          />

          {/* Battery → home evening use */}
          <path
            d="M223 270 C280 290, 340 270, 360 230"
            fill="none"
            stroke="#f7d060"
            strokeWidth="2.5"
            strokeDasharray="6 5"
            className="advies-dash"
          />

          {/* EMS avatar */}
          <circle cx="470" cy="175" r="30" fill="#0d5c32" stroke="#9dffc4" strokeWidth="2" />
          <circle cx="470" cy="166" r="9" fill="#9dffc4" />
          <ellipse cx="470" cy="190" rx="12" ry="9" fill="#9dffc4" />
          <text x="470" y="230" textAnchor="middle" fill="#9dffc4" fontSize="12" fontFamily="sans-serif" fontWeight="700">
            EMS
          </text>

          {/* Trade spark to market */}
          <path
            d="M500 170 C540 150, 560 190, 575 210"
            fill="none"
            stroke="#f37021"
            strokeWidth="2.5"
            strokeDasharray="5 5"
            className="advies-dash"
          />
          <rect x="40" y="40" width="190" height="48" rx="10" fill="#1a8a3e" />
          <text x="135" y="70" textAnchor="middle" fill="#fff" fontSize="13" fontFamily="sans-serif" fontWeight="700">
            Opslaan · gebruiken · verdienen
          </text>
        </g>
      )}
    </svg>
  );
}
