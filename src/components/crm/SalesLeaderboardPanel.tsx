"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatEuro } from "@/lib/format";

type SalesLeaderboardSale = {
  id: string;
  offerte_nummer: string | null;
  adviseur_naam: string;
  klant_naam: string | null;
  bedrag_inc: number;
  ondertekend_op: string;
};

type Celebration = {
  id: string;
  adviseur_naam: string;
  bedrag_inc: number;
  klant_naam?: string | null;
  test?: boolean;
};

const POLL_MS = 4000;
const CELEBRATION_MS = 14000;
const BG = "/sales/leaderboard-bg.png";
const MONEY_SOUND = "/sales/money.mp3";

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
  const [sales, setSales] = useState<SalesLeaderboardSale[]>([]);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const seenIds = useRef<Set<string>>(new Set());
  const bootstrapped = useRef(false);
  const sinceRef = useRef<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const showCelebration = useCallback(
    (c: Celebration) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setCelebration(c);
      playMoneySound();
      hideTimer.current = setTimeout(() => setCelebration(null), CELEBRATION_MS);
    },
    [playMoneySound]
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
          setSales(list);
          sinceRef.current = serverTime;
          bootstrapped.current = true;
          setError(null);
          return;
        }

        if (opts?.poll) {
          const fresh = list.filter((s) => !seenIds.current.has(s.id));
          for (const s of fresh) {
            seenIds.current.add(s.id);
            showCelebration({
              id: s.id,
              adviseur_naam: s.adviseur_naam,
              bedrag_inc: s.bedrag_inc,
              klant_naam: s.klant_naam,
            });
          }
          if (fresh.length) {
            setSales((prev) => {
              const map = new Map(prev.map((p) => [p.id, p]));
              for (const s of fresh) map.set(s.id, s);
              return [...map.values()].sort((a, b) =>
                b.ondertekend_op.localeCompare(a.ondertekend_op)
              );
            });
          }
          sinceRef.current = serverTime;
        } else {
          for (const s of list) seenIds.current.add(s.id);
          setSales(list);
          sinceRef.current = serverTime;
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Laden mislukt");
      }
    },
    [showCelebration]
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

  function fireTestSale() {
    showCelebration({
      id: `test-${Date.now()}`,
      adviseur_naam: "Jona Hessel",
      bedrag_inc: 8500,
      klant_naam: "Test sale",
      test: true,
    });
  }

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

      {/* Idle chrome — alleen orders + knoppen */}
      <div className="relative z-10 flex h-full min-h-[inherit] flex-col">
        <div className="flex justify-end gap-2 px-4 pt-4 sm:px-6 sm:pt-5">
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            className="border border-white/30 bg-black/40 px-3 py-2 text-xs font-semibold text-white backdrop-blur hover:bg-black/55"
          >
            {live ? "Pauzeer live" : "Live aan"}
          </button>
          <button
            type="button"
            onClick={fireTestSale}
            className="bg-[#F5C518] px-4 py-2.5 text-sm font-black uppercase tracking-wide text-black shadow-[0_0_24px_rgba(245,197,24,0.55)] hover:bg-[#ffd84a]"
          >
            Test sale
          </button>
        </div>

        {!celebration ? (
          <div className="mt-auto px-4 pb-5 sm:px-6 sm:pb-6">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
              Orders
            </p>
            {error ? (
              <p className="text-sm text-[#FCA5A5]">{error}</p>
            ) : sales.filter((s) => s.klant_naam?.trim()).length === 0 ? (
              <p className="text-sm text-white/65">
                Nog geen getekende orders — druk op Test sale voor een preview.
              </p>
            ) : (
              <ul className="grid max-h-[38vh] gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
                {sales
                  .filter((s) => s.klant_naam?.trim())
                  .slice(0, 12)
                  .map((s) => (
                    <li
                      key={s.id}
                      className="border border-white/15 bg-black/45 px-3 py-2.5 backdrop-blur-sm"
                    >
                      <p className="truncate text-sm font-bold text-white">
                        {s.klant_naam}
                      </p>
                      <p className="mt-0.5 text-lg font-black tabular-nums text-[#F5C518]">
                        {formatEuro(s.bedrag_inc)}
                      </p>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      {/* Celebration overlay */}
      {celebration ? (
        <div
          key={celebration.id}
          className="sale-celebrate-root absolute inset-0 z-20 flex items-center justify-center"
        >
          <div className="sale-flash pointer-events-none absolute inset-0 bg-white" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#7f1d1d]/50 via-black/40 to-black/75" />
          <ConfettiBurst />

          <div className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-[#F5C518]/70 sale-ring sm:h-56 sm:w-56" />

          <div className="relative mx-4 max-w-[95vw] text-center">
            <p className="sale-pop text-sm font-black uppercase tracking-[0.45em] text-[#F5C518] sm:text-base">
              {celebration.test ? "Test sale" : "Sale"}
            </p>
            <p className="sale-pop-delay sale-glow-text mt-3 font-display text-[clamp(2.6rem,12vw,7.5rem)] font-black leading-[0.95] tracking-tight text-white">
              {celebration.adviseur_naam}
            </p>
            <p className="sale-pop-delay-2 mt-4 font-display text-[clamp(2.2rem,10vw,6rem)] font-black tabular-nums leading-none text-[#F5C518] drop-shadow-[0_6px_0_rgba(0,0,0,0.45)]">
              {formatEuro(celebration.bedrag_inc)}
            </p>
            {celebration.klant_naam && !celebration.test ? (
              <p className="sale-pop-delay-2 mt-3 text-base font-semibold text-white/80 sm:text-lg">
                {celebration.klant_naam}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setCelebration(null)}
            className="absolute bottom-5 right-5 z-30 border border-white/30 bg-black/50 px-3 py-2 text-xs font-semibold text-white backdrop-blur hover:bg-black/70"
          >
            Sluiten
          </button>
        </div>
      ) : null}
    </div>
  );
}
