"use client";

import Image from "next/image";
import Link from "next/link";

export function CrmHeader({
  onRefresh,
  loading,
}: {
  onRefresh?: () => void;
  loading?: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-[#1a1f1c] bg-charcoal">
      <div className="mx-auto flex h-12 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="Batterijconcept"
            width={28}
            height={28}
            className="h-7 w-7 object-contain"
            priority
          />
          <div className="flex items-baseline gap-2 leading-none">
            <span className="font-display text-[15px] font-semibold tracking-tight text-white">
              Batterij<span className="text-orange">concept</span>
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/35">
              CRM
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="border border-white/15 px-3 py-1 text-xs font-medium text-white/75 transition hover:border-white/30 hover:text-white disabled:opacity-50"
            >
              {loading ? "Laden…" : "Vernieuwen"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
