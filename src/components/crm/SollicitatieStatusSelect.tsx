"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SollicitatieStatus } from "@/types/database";
import {
  normalizeSollicitatieStatus,
  SOLLICITATIE_STATUS_LABEL,
  SOLLICITATIE_STATUSES,
} from "@/lib/sollicitatie";
import { cn } from "@/lib/utils";

export const SOLLICITATIE_STATUS_TONE: Record<SollicitatieStatus, string> = {
  nieuw: "border border-[#1A4A6E]/25 bg-[#E8F0F6] text-[#1A4A6E]",
  geen_contact: "border border-[#37474F]/30 bg-[#ECEFF1] text-[#37474F]",
  definitief_geen_contact:
    "border border-[#455A64]/35 bg-[#CFD8DC] text-[#263238]",
  gesprek_gepland: "border border-[#C9A227]/40 bg-[#FFF8D6] text-[#8A6D00]",
  gesprek_gehad: "border border-[#C45A12]/30 bg-[#FFF0E6] text-[#C45A12]",
  gesprek_gehad_diskwalificatie:
    "border border-[#9B2C2C]/30 bg-[#FCEAEA] text-[#9B2C2C]",
  aangenomen_training_gepland:
    "border border-[#0D7A6F]/30 bg-[#E6F7F5] text-[#0D5C54]",
  aangenomen_actief: "border border-[#0D5C32]/30 bg-[#E8F6EC] text-[#0D5C32]",
  diskwalificatie: "border border-[#C62828]/30 bg-[#FDECEA] text-[#C62828]",
};

type MenuPos = {
  top: number;
  left: number;
  minWidth: number;
  maxHeight: number;
};

export function SollicitatieStatusSelect({
  status,
  disabled,
  onChange,
  className,
}: {
  status: SollicitatieStatus | string;
  disabled?: boolean;
  onChange: (next: SollicitatieStatus) => void | Promise<void>;
  className?: string;
}) {
  const current = normalizeSollicitatieStatus(status);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null);
      return;
    }
    function place() {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const gap = 4;
      const edge = 8;
      const spaceBelow = window.innerHeight - r.bottom - gap - edge;
      const spaceAbove = r.top - gap - edge;
      const preferred = Math.min(window.innerHeight * 0.7, 360);
      const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(
        160,
        Math.min(preferred, openUp ? spaceAbove : spaceBelow)
      );
      const next: MenuPos = {
        top: openUp
          ? Math.max(edge, r.top - gap - maxHeight)
          : r.bottom + gap,
        left: Math.max(edge, Math.min(r.left, window.innerWidth - 260)),
        minWidth: Math.max(r.width, 220),
        maxHeight,
      };
      setPos((prev) =>
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.minWidth === next.minWidth &&
        prev.maxHeight === next.maxHeight
          ? prev
          : next
      );
    }
    function onScroll(e: Event) {
      const t = e.target;
      if (t instanceof Node && menuRef.current?.contains(t)) return;
      place();
    }
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function selectStatus(next: SollicitatieStatus) {
    if (next === current || saving) return;
    setSaving(true);
    setOpen(false);
    try {
      await onChange(next);
    } finally {
      setSaving(false);
    }
  }

  const menu =
    mounted && open && pos
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            className="fixed z-[80] overflow-y-auto border border-line bg-white py-1 shadow-lg"
            style={{
              top: pos.top,
              left: pos.left,
              minWidth: pos.minWidth,
              maxHeight: pos.maxHeight,
            }}
          >
            {SOLLICITATIE_STATUSES.map((st) => {
              const active = st === current;
              return (
                <button
                  key={st}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => void selectStatus(st)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-wash",
                    active && "bg-wash/80"
                  )}
                >
                  <span
                    className={cn(
                      "w-4 shrink-0 text-center text-[11px] font-bold text-green-deeper",
                      active ? "opacity-100" : "opacity-0"
                    )}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span
                    className={cn(
                      "inline-flex max-w-full truncate rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                      SOLLICITATIE_STATUS_TONE[st]
                    )}
                  >
                    {SOLLICITATIE_STATUS_LABEL[st]}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body
        )
      : null;

  return (
    <div className={cn("relative inline-block max-w-full", className)}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled || saving}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold disabled:opacity-60",
          SOLLICITATIE_STATUS_TONE[current]
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Status wijzigen"
      >
        <span className="truncate">{SOLLICITATIE_STATUS_LABEL[current]}</span>
        <span className="text-[9px] opacity-70" aria-hidden>
          ▾
        </span>
      </button>
      {menu}
    </div>
  );
}
