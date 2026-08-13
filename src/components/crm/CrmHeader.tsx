"use client";

import Link from "next/link";

export function CrmHeader({
  onRefresh,
  loading,
}: {
  onRefresh?: () => void;
  loading?: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-green-deeper bg-green-dark">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex items-baseline gap-2 leading-none">
            <span className="font-display text-lg font-semibold tracking-tight text-white">
              Batterij<span className="text-orange">concept</span>
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/50">
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
              className="border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20 disabled:opacity-50"
            >
              {loading ? "Laden…" : "Vernieuwen"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
