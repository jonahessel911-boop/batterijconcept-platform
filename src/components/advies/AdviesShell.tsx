"use client";

import Image from "next/image";
import Link from "next/link";
import type { AdviesStepId } from "./types";
import { STEP_LABELS, STEP_ORDER } from "./types";
import { btnPrimary, btnSecondary } from "./ui";

export function AdviesShell({
  leadNaam,
  leadId,
  step,
  children,
  onBack,
  onNext,
  nextLabel = "Verder",
  nextDisabled = false,
  hideNav = false,
}: {
  leadNaam: string;
  leadId: string;
  step: AdviesStepId;
  children: React.ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  hideNav?: boolean;
}) {
  const idx = STEP_ORDER.indexOf(step);
  const progress = ((idx + 1) / STEP_ORDER.length) * 100;

  return (
    <div className="advies-root flex min-h-dvh flex-col bg-[#f7faf8] text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="Batterijconcept"
              width={36}
              height={36}
              className="rounded-lg"
            />
            <div>
              <p className="font-display text-sm font-semibold tracking-tight text-ink">
                Adviesproces
              </p>
              <p className="text-[11px] text-muted">Check voor {leadNaam}</p>
            </div>
          </div>
          <Link
            href={`/leads/${leadId}`}
            className="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-muted hover:border-green/40 hover:text-ink"
          >
            Afsluiten
          </Link>
        </div>
        <div className="h-1 w-full bg-green-soft">
          <div
            className="h-full bg-green transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 sm:gap-2.5 sm:px-6">
          {STEP_ORDER.map((s, i) => {
            const done = i < idx;
            const active = i === idx;
            return (
              <span
                key={s}
                className={[
                  "inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold sm:px-3.5 sm:py-2.5 sm:text-sm",
                  done
                    ? "bg-green-soft text-green-dark"
                    : active
                      ? "bg-green text-white shadow-sm shadow-green/25"
                      : "bg-wash text-muted",
                ].join(" ")}
              >
                <span
                  className={[
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold sm:h-7 sm:w-7 sm:text-xs",
                    done
                      ? "bg-green text-white"
                      : active
                        ? "bg-white text-green"
                        : "border border-line bg-white text-muted",
                  ].join(" ")}
                >
                  {done ? "✓" : i + 1}
                </span>
                {STEP_LABELS[s]}
              </span>
            );
          })}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex-1">{children}</div>

        {!hideNav && (
          <div className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-5">
            <button
              type="button"
              onClick={onBack}
              disabled={!onBack}
              className={btnSecondary}
            >
              Terug
            </button>
            {onNext && (
              <button
                type="button"
                onClick={onNext}
                disabled={nextDisabled}
                className={btnPrimary}
              >
                {nextLabel}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
