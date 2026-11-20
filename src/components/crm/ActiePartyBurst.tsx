"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

const COLORS = ["#F5C518", "#16A34A", "#0EA5E9", "#EF4444", "#F97316", "#A855F7"];

export const ACTIE_PARTY_MS = 2000;

/** Korte confetti-burst over het scherm na Afronden. */
export function ActiePartyBurst({
  nonce,
  onDone,
}: {
  nonce: number;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = window.setTimeout(onDone, ACTIE_PARTY_MS);
    return () => window.clearTimeout(t);
    // nonce herstart de burst; onDone is alleen unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const pieces = Array.from({ length: 72 }, (_, i) => i);

  const node = (
    <div
      key={nonce}
      className="pointer-events-none fixed inset-0 z-[200] overflow-hidden"
      aria-hidden
    >
      <style>{`
        @keyframes actie-party-fall {
          0% { transform: translate3d(0, -8vh, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate3d(var(--dx), 108vh, 0) rotate(720deg); opacity: 0.15; }
        }
        @keyframes actie-party-flash {
          0% { opacity: 0.28; }
          100% { opacity: 0; }
        }
        @keyframes actie-party-pop {
          0% { opacity: 0; transform: scale(0.6) translateY(12px); }
          18% { opacity: 1; transform: scale(1.08) translateY(0); }
          72% { opacity: 1; transform: scale(1) translateY(0); }
          100% { opacity: 0; transform: scale(1) translateY(-10px); }
        }
      `}</style>
      <div className="absolute inset-0 bg-white/40 [animation:actie-party-flash_0.45s_ease-out_forwards]" />
      {pieces.map((i) => {
        const left = (i * 19 + 5) % 100;
        const delay = (i % 10) * 0.035;
        const dur = 1.15 + (i % 6) * 0.12;
        const size = 9 + (i % 5) * 4;
        const dx = ((i % 7) - 3) * 18;
        return (
          <span
            key={i}
            className="absolute top-[-4%] rounded-[2px]"
            style={{
              left: `${left}%`,
              width: size,
              height: size * (0.55 + (i % 3) * 0.28),
              background: COLORS[i % COLORS.length],
              animation: `actie-party-fall ${dur}s cubic-bezier(0.22, 0.8, 0.35, 1) ${delay}s both`,
              ["--dx" as string]: `${dx}px`,
              transform: `rotate(${(i * 41) % 360}deg)`,
            }}
          />
        );
      })}
      <p className="absolute left-1/2 top-[38%] -translate-x-1/2 font-display text-3xl font-black tracking-tight text-ink [animation:actie-party-pop_1.15s_ease-out_both] sm:text-4xl">
        Klaar! 🎉
      </p>
    </div>
  );

  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}
