"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatEuro } from "@/lib/format";

type SalesLeaderboardKind = "sale" | "netto";

type SalesLeaderboardSale = {
  id: string;
  kind: SalesLeaderboardKind;
  offerte_nummer: string | null;
  adviseur_naam: string;
  klant_naam: string | null;
  bedrag_inc: number;
  event_at: string;
};

type Celebration = {
  id: string;
  kind: SalesLeaderboardKind | "test";
  adviseur_naam: string;
  bedrag_inc: number;
  klant_naam?: string | null;
};

const POLL_MS = 4000;
const CELEBRATION_MS = 14000;
const BG = "/sales/leaderboard-bg.png";
const MONEY_SOUND = "/sales/money.mp3";

function celebrationLabel(kind: Celebration["kind"]): string {
  if (kind === "netto") return "Netto sale";
  if (kind === "test") return "Test sale";
  return "Sale";
}

function ConfettiBurst() {
  const pieces = Array.from({ length: 48 }, (_, i) => i);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {pieces.map((i) => {
        const left = (i * 17 + 7) % 100;
        const delay = (i % 12) * 0.07;
        const dur = 1.8 + (i % 5) * 0.25;
        const size = 6 + (i % 4) * 3;
        const colors = ["#F5C518", "#FFFFFF", "#FF3B3B", "#22C55E", "#38BDF8"];
        const color = colors[i % colors.length];
        return (
          <span
            key={i}
            className="sale-confetti absolute top-[-12%] rounded-sm"
            style={{
              left: `${left}%`,
              width: size,
              height: size * (0.6 + (i % 3) * 0.3),
              background: color,
              animationDelay: `${delay}s`,
              animationDuration: `${dur}s`,
              transform: `rotate(${(i * 37) % 360}deg)`,
            }}
          />
        );
      })}
    </div>
  );
}

export function SalesLeaderboardPanel() {
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const seenIds = useRef<Set<string>>(new Set());
  const bootstrapped = useRef(false);
  const sinceRef = useRef<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<Celebration[]>([]);
  const celebratingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopMoneySound = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }, []);

  const playMoneySound = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 1;
    void audio.play().catch(() => {
      /* Browser blokkeert autoplay tot er een klik is */
    });
  }, []);

  const playNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      celebratingRef.current = false;
      setCelebration(null);
      return;
    }
    celebratingRef.current = true;
    setCelebration(next);
    playMoneySound();
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      playNext();
    }, CELEBRATION_MS);
  }, [playMoneySound]);

  const enqueueCelebration = useCallback(
    (c: Celebration) => {
      queueRef.current.push(c);
      if (!celebratingRef.current) playNext();
    },
    [playNext]
  );

  const load = useCallback(
    async (opts?: { poll?: boolean }) => {
      try {
        const qs =
          opts?.poll && sinceRef.current
            ? `?since=${encodeURIComponent(sinceRef.current)}`
            : "";
        const res = await fetch(`/api/sales-leaderboard${qs}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Laden mislukt"
          );
        }
        const list = ((data as { sales?: SalesLeaderboardSale[] }).sales ||
          []) as SalesLeaderboardSale[];
        const serverTime =
          (data as { server_time?: string }).server_time ||
          new Date().toISOString();

        if (!bootstrapped.current) {
          for (const s of list) seenIds.current.add(s.id);
          sinceRef.current = serverTime;
          bootstrapped.current = true;
          setError(null);
          return;
        }

        if (opts?.poll) {
          const fresh = list
            .filter((s) => !seenIds.current.has(s.id))
            .sort((a, b) => a.event_at.localeCompare(b.event_at));
          for (const s of fresh) {
            seenIds.current.add(s.id);
            enqueueCelebration({
              id: s.id,
              kind: s.kind,
              adviseur_naam: s.adviseur_naam,
              bedrag_inc: s.bedrag_inc,
              klant_naam: s.klant_naam,
            });
          }
          sinceRef.current = serverTime;
        } else {
          for (const s of list) seenIds.current.add(s.id);
          sinceRef.current = serverTime;
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Laden mislukt");
      }
    },
    [enqueueCelebration]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load({ poll: true }), POLL_MS);
    return () => clearInterval(t);
  }, [live, load]);

  useEffect(() => {
    if (!celebration) stopMoneySound();
  }, [celebration, stopMoneySound]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      stopMoneySound();
    };
  }, [stopMoneySound]);

  function fireTestSale(kind: SalesLeaderboardKind = "sale") {
    enqueueCelebration({
      id: `test-${kind}-${Date.now()}`,
      kind: kind === "netto" ? "netto" : "test",
      adviseur_naam: "Jona Hessel",
      bedrag_inc: kind === "netto" ? 10250 : 8500,
      klant_naam: kind === "netto" ? "Netto test" : "Test sale",
    });
  }

  const isNetto = celebration?.kind === "netto";

  return (
    <div className="relative min-h-[calc(100dvh-7.5rem)] w-full overflow-hidden bg-black text-white sm:min-h-[calc(100dvh-8.5rem)]">
      <style>{`
        @keyframes sale-pop-in {
          0% {
            opacity: 0;
            transform: scale(0.35) translateY(40px);
            filter: blur(12px);
          }
          55% {
            opacity: 1;
            transform: scale(1.12) translateY(0);
            filter: blur(0);
          }
          75% {
            transform: scale(0.96);
          }
          100% {
            opacity: 1;
            transform: scale(1);
            filter: blur(0);
          }
        }
        @keyframes sale-flash {
          0% { opacity: 0.85; }
          100% { opacity: 0; }
        }
        @keyframes sale-shake {
          0%, 100% { transform: translate(0, 0) scale(1.02); }
          20% { transform: translate(-10px, 4px) scale(1.04); }
          40% { transform: translate(10px, -4px) scale(1.03); }
          60% { transform: translate(-6px, 2px) scale(1.04); }
          80% { transform: translate(6px, -2px) scale(1.02); }
        }
        @keyframes sale-pulse-ring {
          0% { transform: scale(0.4); opacity: 0.7; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        @keyframes sale-confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0.2; }
        }
        @keyframes sale-glow {
          0%, 100% {
            text-shadow:
              0 0 20px rgba(245, 197, 24, 0.55),
              0 0 60px rgba(255, 255, 255, 0.25),
              0 4px 0 rgba(0, 0, 0, 0.45);
          }
          50% {
            text-shadow:
              0 0 40px rgba(245, 197, 24, 0.9),
              0 0 90px rgba(255, 80, 80, 0.35),
              0 4px 0 rgba(0, 0, 0, 0.45);
          }
        }
        .sale-confetti {
          animation-name: sale-confetti-fall;
          animation-timing-function: cubic-bezier(0.22, 0.8, 0.35, 1);
          animation-fill-mode: forwards;
        }
        .sale-celebrate-root { animation: sale-shake 0.55s ease-out both; }
        .sale-pop { animation: sale-pop-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .sale-pop-delay { animation: sale-pop-in 0.75s cubic-bezier(0.16, 1, 0.3, 1) 0.12s both; }
        .sale-pop-delay-2 { animation: sale-pop-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.22s both; }
        .sale-flash { animation: sale-flash 0.55s ease-out forwards; }
        .sale-ring { animation: sale-pulse-ring 1.1s ease-out infinite; }
        .sale-glow-text { animation: sale-glow 1.4s ease-in-out infinite; }
      `}</style>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={BG}
        alt=""
        className={[
          "absolute inset-0 h-full w-full object-cover transition duration-700",
          celebration ? "scale-110 brightness-90" : "scale-100",
        ].join(" ")}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/25 to-black/70" />
      <audio ref={audioRef} src={MONEY_SOUND} preload="auto" />

      <div className="relative z-10 flex h-full min-h-[inherit] flex-col">
        <div className="flex flex-wrap items-start justify-end gap-2 px-4 pt-4 sm:px-6 sm:pt-5">
          {error ? (
            <p className="mr-auto max-w-sm text-sm text-[#FCA5A5]">{error}</p>
          ) : null}
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            className="border border-white/30 bg-black/40 px-3 py-2 text-xs font-semibold text-white backdrop-blur hover:bg-black/55"
          >
            {live ? "Pauzeer live" : "Live aan"}
          </button>
          <button
            type="button"
            onClick={() => fireTestSale("sale")}
            className="border border-white/30 bg-black/40 px-3 py-2 text-xs font-semibold text-white backdrop-blur hover:bg-black/55"
          >
            Test sale
          </button>
          <button
            type="button"
            onClick={() => fireTestSale("netto")}
            className="bg-[#F5C518] px-4 py-2.5 text-sm font-black uppercase tracking-wide text-black shadow-[0_0_24px_rgba(245,197,24,0.55)] hover:bg-[#ffd84a]"
          >
            Test netto
          </button>
        </div>
      </div>

      {celebration ? (
        <div
          key={celebration.id}
          className="sale-celebrate-root absolute inset-0 z-20 flex items-center justify-center"
        >
          <div className="sale-flash pointer-events-none absolute inset-0 bg-white" />
          <div
            className={[
              "pointer-events-none absolute inset-0 bg-gradient-to-b to-black/75",
              isNetto
                ? "from-[#14532d]/60 via-black/45"
                : "from-[#7f1d1d]/50 via-black/40",
            ].join(" ")}
          />
          <ConfettiBurst />

          <div
            className={[
              "pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 sale-ring sm:h-56 sm:w-56",
              isNetto ? "border-emerald-400/80" : "border-[#F5C518]/70",
            ].join(" ")}
          />

          <div className="relative mx-4 max-w-[95vw] text-center">
            <p
              className={[
                "sale-pop text-sm font-black uppercase tracking-[0.45em] sm:text-base",
                isNetto ? "text-emerald-300" : "text-[#F5C518]",
              ].join(" ")}
            >
              {celebrationLabel(celebration.kind)}
            </p>
            <p className="sale-pop-delay sale-glow-text mt-3 font-display text-[clamp(2.6rem,12vw,7.5rem)] font-black leading-[0.95] tracking-tight text-white">
              {celebration.adviseur_naam}
            </p>
            <p
              className={[
                "sale-pop-delay-2 mt-4 font-display text-[clamp(2.2rem,10vw,6rem)] font-black tabular-nums leading-none drop-shadow-[0_6px_0_rgba(0,0,0,0.45)]",
                isNetto ? "text-emerald-300" : "text-[#F5C518]",
              ].join(" ")}
            >
              {formatEuro(celebration.bedrag_inc)}
            </p>
            {celebration.klant_naam && celebration.kind !== "test" ? (
              <p className="sale-pop-delay-2 mt-3 text-base font-semibold text-white/80 sm:text-lg">
                {celebration.klant_naam}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => {
              if (hideTimer.current) clearTimeout(hideTimer.current);
              playNext();
            }}
            className="absolute bottom-5 right-5 z-30 border border-white/30 bg-black/50 px-3 py-2 text-xs font-semibold text-white backdrop-blur hover:bg-black/70"
          >
            Sluiten
          </button>
        </div>
      ) : null}
    </div>
  );
}
