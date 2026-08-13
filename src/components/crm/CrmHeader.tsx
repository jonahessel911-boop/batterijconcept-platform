"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Adviseur, CrmTab } from "@/types/database";
import { CRM_TABS } from "./TabNav";

export function CrmHeader({
  onRefresh,
  loading,
  adviseurs,
  selectedAdviseurId,
  onAdviseurChange,
  activeTab,
  onTabChange,
  tabCounts,
  userName,
  onLogout,
}: {
  onRefresh?: () => void;
  loading?: boolean;
  adviseurs?: Adviseur[];
  selectedAdviseurId?: string;
  onAdviseurChange?: (id: string) => void;
  activeTab?: CrmTab;
  onTabChange?: (tab: CrmTab) => void;
  tabCounts?: Partial<Record<CrmTab, number>>;
  userName?: string;
  onLogout?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const showNav = Boolean(onTabChange && activeTab);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-green-deeper bg-green-dark pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex min-h-14 max-w-[1440px] items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-6 sm:py-0 sm:h-14">
        <div className="flex min-w-0 items-center gap-2">
          {showNav && (
            <button
              type="button"
              className="flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-[5px] border border-white/25 bg-white/10 md:hidden"
              aria-label={menuOpen ? "Menu sluiten" : "Menu openen"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span
                className={[
                  "block h-0.5 w-4 bg-white transition",
                  menuOpen ? "translate-y-[7px] rotate-45" : "",
                ].join(" ")}
              />
              <span
                className={[
                  "block h-0.5 w-4 bg-white transition",
                  menuOpen ? "opacity-0" : "",
                ].join(" ")}
              />
              <span
                className={[
                  "block h-0.5 w-4 bg-white transition",
                  menuOpen ? "-translate-y-[7px] -rotate-45" : "",
                ].join(" ")}
              />
            </button>
          )}

          <Link href="/" className="min-w-0 shrink" onClick={() => setMenuOpen(false)}>
            <div className="flex items-baseline gap-1.5 leading-none sm:gap-2">
              <span className="font-display text-base font-semibold tracking-tight text-white sm:text-lg">
                Batterij<span className="text-orange">concept</span>
              </span>
              <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/50 sm:text-[10px] sm:tracking-[0.16em]">
                CRM
              </span>
            </div>
          </Link>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {adviseurs && onAdviseurChange && (
            <label className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">
              <span className="hidden sm:inline">Bekijk als</span>
              <select
                value={selectedAdviseurId || ""}
                onChange={(e) => onAdviseurChange(e.target.value)}
                className="max-w-[7.5rem] min-h-9 border border-white/25 bg-white/10 px-2 py-1.5 text-xs font-medium normal-case tracking-normal text-white outline-none focus:border-white/50 sm:max-w-none sm:min-h-0"
                aria-label="Bekijk als adviseur"
              >
                <option value="" className="text-ink">
                  Iedereen
                </option>
                {adviseurs.map((a) => (
                  <option key={a.id} value={a.id} className="text-ink">
                    {a.naam}
                  </option>
                ))}
              </select>
            </label>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="min-h-9 border border-white/25 bg-white/10 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-white/20 disabled:opacity-50 sm:px-3"
            >
              <span className="sm:hidden">{loading ? "…" : "↻"}</span>
              <span className="hidden sm:inline">
                {loading ? "Laden…" : "Vernieuwen"}
              </span>
            </button>
          )}
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="min-h-9 border border-white/25 bg-white/10 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-white/20 sm:px-3"
              title={userName ? `Uitloggen (${userName})` : "Uitloggen"}
            >
              <span className="sm:hidden">⎋</span>
              <span className="hidden sm:inline">Uitloggen</span>
            </button>
          )}
        </div>
      </div>

      {showNav && menuOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-ink/40 md:hidden"
            aria-label="Menu sluiten"
            onClick={() => setMenuOpen(false)}
          />
          <nav
            className="absolute inset-x-0 top-full z-50 border-b border-line bg-white shadow-lg md:hidden"
            aria-label="Hoofdmenu"
          >
            <ul className="mx-auto max-w-[1440px] py-1">
              {CRM_TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <li key={tab.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onTabChange?.(tab.id);
                        setMenuOpen(false);
                      }}
                      className={[
                        "flex w-full items-center justify-between px-4 py-3.5 text-left text-base font-medium",
                        isActive
                          ? "bg-green-soft text-green-deeper"
                          : "text-ink hover:bg-wash",
                      ].join(" ")}
                    >
                      <span className="font-display tracking-tight">
                        {tab.label}
                      </span>
                      {typeof tabCounts?.[tab.id] === "number" && (
                        <span
                          className={[
                            "inline-flex min-w-[1.5rem] items-center justify-center px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                            isActive
                              ? "bg-green text-white"
                              : "bg-[#eef1ef] text-muted",
                          ].join(" ")}
                        >
                          {tabCounts[tab.id]}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </>
      )}
    </header>
  );
}
