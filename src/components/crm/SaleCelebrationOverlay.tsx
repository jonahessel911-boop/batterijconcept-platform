"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatEuro } from "@/lib/format";

export type SaleCelebrationKind = "sale" | "netto" | "test";

export type SaleCelebration = {
  id: string;
  kind: SaleCelebrationKind;
  adviseur_naam: string;
  bedrag_inc: number;
  klant_naam?: string | null;
};

export const SALE_CELEBRATION_MS = 14_000;

/** Sale-sounds: bij elke celebration één random clip. */
export const MONEY_SOUNDS = [
  "/sales/money.mp3",
  "/sales/money-2.mp3",
  "/sales/money-3.mp3",
  "/sales/money-4.mp3",
] as const;

function celebrationLabel(kind: SaleCelebrationKind): string {
  if (kind === "netto") return "Netto sale";
  if (kind === "test") return "Test sale";
  return "Sale";
}

function ConfettiBurst() {
  const pieces = Array.from({ length: 48 }, (_, i) => i);
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
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

export function SaleCelebrationStyles() {
  return (
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
  );
}

export function SaleCelebrationOverlay({
  celebration,
  onDismiss,
}: {
  celebration: SaleCelebration;
  onDismiss: () => void;
}) {
  const isNetto = celebration.kind === "netto";

  return (
    <div
      key={celebration.id}
      className="sale-celebrate-root fixed inset-0 z-[95] flex items-center justify-center"
    >
      <SaleCelebrationStyles />
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
        onClick={onDismiss}
        className="absolute bottom-5 right-5 z-30 border border-white/30 bg-black/50 px-3 py-2 text-xs font-semibold text-white backdrop-blur hover:bg-black/70"
      >
        Sluiten
      </button>
    </div>
  );
}

/** Queue + random money-sound — zelfde gedrag als de live leaderboard. */
export function useSaleCelebrationQueue() {
  const [celebration, setCelebration] = useState<SaleCelebration | null>(null);
  const queueRef = useRef<SaleCelebration[]>([]);
  const celebratingRef = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const soundQueueRef = useRef<string[]>([]);
  const soundPlayingRef = useRef(false);
  const soundEndedHandlerRef = useRef<(() => void) | null>(null);

  const stopMoneySound = useCallback(() => {
    const audio = audioRef.current;
    if (audio && soundEndedHandlerRef.current) {
      audio.removeEventListener("ended", soundEndedHandlerRef.current);
      soundEndedHandlerRef.current = null;
    }
    soundQueueRef.current = [];
    soundPlayingRef.current = false;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }, []);

  const playNextMoneySound = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (soundPlayingRef.current && !audio.paused && !audio.ended) return;

    const next = soundQueueRef.current.shift();
    if (!next) return;

    if (audio.getAttribute("src") !== next) {
      audio.src = next;
    }
    audio.currentTime = 0;
    audio.volume = 1;

    if (soundEndedHandlerRef.current) {
      audio.removeEventListener("ended", soundEndedHandlerRef.current);
    }
    const onEnded = () => {
      soundPlayingRef.current = false;
      soundEndedHandlerRef.current = null;
      audio.removeEventListener("ended", onEnded);
      if (soundQueueRef.current.length > 0) {
        playNextMoneySound();
      }
    };
    soundEndedHandlerRef.current = onEnded;
    audio.addEventListener("ended", onEnded);
    soundPlayingRef.current = true;
    void audio.play().catch(() => {
      soundPlayingRef.current = false;
      soundEndedHandlerRef.current = null;
      audio.removeEventListener("ended", onEnded);
      // Probeer volgende clip als autoplay faalde.
      if (soundQueueRef.current.length > 0) {
        playNextMoneySound();
      }
    });
  }, []);

  const playMoneySound = useCallback(() => {
    const next =
      MONEY_SOUNDS[Math.floor(Math.random() * MONEY_SOUNDS.length)] ??
      MONEY_SOUNDS[0];
    soundQueueRef.current.push(next);
    playNextMoneySound();
  }, [playNextMoneySound]);

  const playNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      celebratingRef.current = false;
      setCelebration(null);
      // Geluid latendoorspelen tot het einde — niet afkappen bij sluiten overlay.
      return;
    }
    celebratingRef.current = true;
    setCelebration(next);
    playMoneySound();
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      playNext();
    }, SALE_CELEBRATION_MS);
  }, [playMoneySound]);

  const enqueueCelebration = useCallback(
    (c: SaleCelebration) => {
      queueRef.current.push(c);
      if (!celebratingRef.current) playNext();
    },
    [playNext]
  );

  const dismiss = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    playNext();
  }, [playNext]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      stopMoneySound();
    };
  }, [stopMoneySound]);

  const audioElements = (
    <>
      <audio ref={audioRef} src={MONEY_SOUNDS[0]} preload="auto" />
      {MONEY_SOUNDS.slice(1).map((src) => (
        <audio
          key={src}
          src={src}
          preload="auto"
          aria-hidden
          className="hidden"
        />
      ))}
    </>
  );

  return {
    celebration,
    enqueueCelebration,
    dismiss,
    audioElements,
  };
}
