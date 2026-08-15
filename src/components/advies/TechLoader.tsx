"use client";

import { useEffect, useMemo, useState } from "react";

type Stage = {
  line: string;
  caption: string;
  /** Visual mode */
  visual: "map" | "battery" | "wishes" | "neighborhood" | "calc" | "brands";
};

export function TechLoader({
  lines,
  durationMs = 30000,
  onDone,
  addressQuery,
  plaatsNaam,
}: {
  lines?: string[];
  durationMs?: number;
  onDone: () => void;
  addressQuery?: string;
  plaatsNaam?: string;
}) {
  const stages: Stage[] = useMemo(() => {
    const L =
      lines && lines.length >= 6
        ? lines
        : [
            "Adres ophalen en buurtgegevens laden…",
            "Uitzoeken welke batterij het beste past…",
            "Beoordeelt op basis van wensen…",
            "Meest verkocht in de buurt…",
            "Voordeelberekening uitvoeren…",
            "Vergelijken van Alpha ESS, SolarEdge en Enphase…",
          ];
    return [
      {
        line: L[0]!,
        caption: "Kaart & adresgegevens",
        visual: "map",
      },
      {
        line: L[1]!,
        caption: "Batterijcapaciteit matchen",
        visual: "battery",
      },
      {
        line: L[2]!,
        caption: "Wensen & verbruik",
        visual: "wishes",
      },
      {
        line: L[3]!,
        caption: plaatsNaam
          ? `Populair in ${plaatsNaam}`
          : "Buurtanalyse",
        visual: "neighborhood",
      },
      {
        line: L[4]!,
        caption: "Live voordeelberekening",
        visual: "calc",
      },
      {
        line: L[5]!,
        caption: "Merken vergelijken",
        visual: "brands",
      },
    ];
  }, [lines, plaatsNaam]);

  const [progress, setProgress] = useState(0);
  const [lineIdx, setLineIdx] = useState(0);
  const [checks, setChecks] = useState<string[]>([]);
  const [brandPulse, setBrandPulse] = useState(0);

  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapUrl =
    mapsKey && addressQuery
      ? `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(addressQuery)}&zoom=16&size=640x360&scale=2&maptype=hybrid&markers=color:0x1A8A3E%7C${encodeURIComponent(addressQuery)}&key=${mapsKey}`
      : null;

  useEffect(() => {
    const start = Date.now();
    const tick = window.setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / durationMs) * 100);
      setProgress(p);
      const idx = Math.min(
        stages.length - 1,
        Math.floor((p / 100) * stages.length)
      );
      setLineIdx(idx);
      setChecks(stages.slice(0, idx).map((s) => s.line));
      if (p >= 100) {
        window.clearInterval(tick);
        setChecks(stages.map((s) => s.line));
        window.setTimeout(() => onDone(), 500);
      }
    }, 80);
    return () => window.clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs]);

  useEffect(() => {
    if (stages[lineIdx]?.visual !== "brands") return;
    const t = window.setInterval(() => {
      setBrandPulse((b) => (b + 1) % 3);
    }, 700);
    return () => window.clearInterval(t);
  }, [lineIdx, stages]);

  const stage = stages[lineIdx]!;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_12px_40px_rgba(13,92,50,0.08)]">
      {/* Live visual pane */}
      <div className="relative aspect-[16/9] bg-[#0d5c32] sm:aspect-[2/1]">
        <StageVisual
          visual={stage.visual}
          mapUrl={mapUrl}
          brandPulse={brandPulse}
          caption={stage.caption}
        />
        <div className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[11px] font-semibold text-green-dark shadow">
          Live scan · {stage.caption}
        </div>
        <div className="absolute bottom-3 right-3 rounded-full bg-black/50 px-3 py-1 text-[11px] font-semibold tabular-nums text-white backdrop-blur">
          {Math.round(progress)}%
        </div>
      </div>

      <div className="p-5 sm:p-7">
        <div className="mb-5 flex items-center gap-3">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-green/20 border-t-green" />
          <div>
            <p className="font-display text-lg font-semibold text-ink">
              Tech-check
            </p>
            <p className="text-sm text-muted">Analyse loopt — even geduld</p>
          </div>
        </div>

        <div className="mb-2 flex justify-between text-xs text-muted">
          <span>Voortgang</span>
          <span className="tabular-nums font-semibold text-ink">
            {Math.round(progress)}%
          </span>
        </div>
        <div className="mb-5 h-2 overflow-hidden rounded-full bg-green-soft">
          <div
            className="h-full rounded-full bg-green transition-[width] duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>

        <p className="mb-4 min-h-[1.5rem] font-display text-base font-medium text-green-dark sm:text-lg">
          {stage.line}
        </p>

        <ul className="space-y-2">
          {checks.map((c) => (
            <li
              key={c}
              className="flex items-start gap-2 text-sm text-ink/80 animate-[fadeIn_0.35s_ease]"
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green text-[10px] text-white">
                ✓
              </span>
              {c}
            </li>
          ))}
        </ul>

        {/* Thumbnail strip of what's being scanned */}
        <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {(
            [
              { src: mapUrl || "/products/advies.png", label: "Adres", i: 0 },
              { src: "/products/battery.png", label: "Batterij", i: 1 },
              { src: "/products/advies.png", label: "Wensen", i: 2 },
              { src: "/products/install.png", label: "Buurt", i: 3 },
              { src: "/products/inverter.png", label: "Rekenen", i: 4 },
              { src: "/brands/alpha-ess.svg", label: "Merken", i: 5 },
            ] as const
          ).map((t) => (
            <div
              key={t.label}
              className={[
                "overflow-hidden rounded-xl border bg-wash transition",
                lineIdx === t.i
                  ? "border-green ring-2 ring-green/30"
                  : lineIdx > t.i
                    ? "border-green/40 opacity-80"
                    : "border-line opacity-40",
              ].join(" ")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={t.src}
                alt={t.label}
                className="h-14 w-full object-cover sm:h-16"
              />
              <p className="truncate px-1.5 py-1 text-center text-[9px] font-semibold text-muted">
                {t.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StageVisual({
  visual,
  mapUrl,
  brandPulse,
  caption,
}: {
  visual: Stage["visual"];
  mapUrl: string | null;
  brandPulse: number;
  caption: string;
}) {
  if (visual === "map") {
    return (
      <>
        {mapUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mapUrl}
            alt="Adres scan"
            className="h-full w-full object-cover animate-[fadeIn_0.5s_ease]"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/products/advies.png"
            alt="Adres"
            className="h-full w-full object-cover opacity-90"
          />
        )}
        <ScanOverlay />
      </>
    );
  }

  if (visual === "battery") {
    return (
      <div className="flex h-full items-center justify-center bg-gradient-to-br from-[#0d5c32] to-[#071a12] p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/products/battery.png"
          alt="Batterij"
          className="max-h-full max-w-[280px] object-contain drop-shadow-2xl animate-[fadeIn_0.45s_ease]"
        />
        <ScanOverlay />
      </div>
    );
  }

  if (visual === "wishes") {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/products/advies.png"
          alt="Wensen"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[#0d5c32]/35" />
        <div className="relative z-[1] rounded-2xl bg-white/95 px-5 py-4 text-center shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wide text-green">
            Matchen
          </p>
          <p className="mt-1 font-display text-lg font-semibold text-ink">
            {caption}
          </p>
        </div>
        <ScanOverlay />
      </div>
    );
  }

  if (visual === "neighborhood") {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/products/install.png"
          alt="Buurt"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-black/25" />
        <div className="relative z-[1] grid grid-cols-3 gap-2 px-4">
          {["9,3 kWh", "Populair", "Buurt"].map((t) => (
            <div
              key={t}
              className="rounded-xl bg-white/95 px-3 py-3 text-center text-xs font-bold text-green-dark shadow animate-[fadeIn_0.4s_ease]"
            >
              {t}
            </div>
          ))}
        </div>
        <ScanOverlay />
      </div>
    );
  }

  if (visual === "calc") {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden bg-gradient-to-br from-[#0d5c32] to-[#1a8a3e]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/products/inverter.png"
          alt="Berekening"
          className="absolute inset-0 h-full w-full object-cover opacity-30"
        />
        <div className="relative z-[1] w-[90%] max-w-md space-y-2 rounded-2xl bg-white/95 p-5 shadow-xl">
          <p className="text-xs font-semibold uppercase text-muted">
            Voordeelcheck
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-green-soft">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-green" />
          </div>
          <div className="grid grid-cols-3 gap-2 pt-2 text-center text-[11px] font-semibold">
            <div className="rounded-lg bg-wash py-2 text-ink">Nu</div>
            <div className="rounded-lg bg-orange/15 py-2 text-orange">2027</div>
            <div className="rounded-lg bg-green-soft py-2 text-green-dark">
              Batterij
            </div>
          </div>
        </div>
        <ScanOverlay />
      </div>
    );
  }

  // brands
  const brands = [
    { src: "/brands/alpha-ess.svg", name: "Alpha ESS" },
    { src: "/brands/solaredge.svg", name: "SolarEdge" },
    { src: "/brands/enphase.svg", name: "Enphase" },
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-gradient-to-br from-[#f7faf8] to-[#e8f6ec] p-6">
      <p className="text-sm font-semibold text-green-dark">{caption}</p>
      <div className="grid w-full max-w-lg grid-cols-3 gap-3">
        {brands.map((b, i) => (
          <div
            key={b.name}
            className={[
              "rounded-2xl border bg-white p-3 shadow transition duration-300",
              brandPulse === i
                ? "scale-105 border-green ring-2 ring-green/40"
                : "border-line opacity-70",
            ].join(" ")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={b.src}
              alt={b.name}
              className="mx-auto h-10 w-full object-contain"
            />
            <p className="mt-2 text-center text-[10px] font-semibold text-ink">
              {b.name}
            </p>
          </div>
        ))}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/products/battery.png"
        alt="Vergelijking"
        className="max-h-24 object-contain opacity-90"
      />
    </div>
  );
}

function ScanOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-x-0 h-16 animate-[scanLine_2.2s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-[#9dffc4]/35 to-transparent" />
    </div>
  );
}
