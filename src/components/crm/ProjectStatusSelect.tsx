"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Project, ProjectStatus } from "@/types/database";
import {
  normalizeProjectStatus,
  projectStatusLabel,
  statusTone,
} from "@/lib/labels";
import {
  BETAALWIJZE_LABEL,
  PROJECT_STATUS_BY_KEY,
  PROJECT_STATUS_DEFS,
  PROJECT_STATUS_FASE_LABEL,
  projectStatusesFor,
  resolveBetaalwijze,
  type Betaalwijze,
  type ProjectStatusFase,
  type ProjectStatusKey,
} from "@/lib/project-status-config";

type MenuPos = { top: number; left: number; minWidth: number };

function betaalwijzeOf(project: Project): Betaalwijze {
  const off = Array.isArray(project.offertes)
    ? project.offertes[0]
    : project.offertes;
  return resolveBetaalwijze({
    betaalwijze: project.betaalwijze,
    leadStatus: project.leads?.status ?? null,
    financieringVoorbehoud: off?.financiering_voorbehoud,
  });
}

export function ProjectStatusSelect({
  project,
  onUpdated,
}: {
  project: Project;
  onUpdated?: (project: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState(project.status);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const betaalwijze = betaalwijzeOf(project);
  const allowed = projectStatusesFor(betaalwijze);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setLocalStatus(project.status);
  }, [project.status]);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null);
      return;
    }
    function place() {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight ?? 320;
      const gap = 4;
      const spaceBelow = window.innerHeight - r.bottom - gap;
      const openUp = spaceBelow < menuH && r.top > spaceBelow;
      const next: MenuPos = {
        top: openUp ? Math.max(8, r.top - gap - menuH) : r.bottom + gap,
        left: Math.max(8, Math.min(r.left, window.innerWidth - 280)),
        minWidth: Math.max(r.width, 260),
      };
      setPos((prev) =>
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.minWidth === next.minWidth
          ? prev
          : next
      );
    }
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
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

  const current = normalizeProjectStatus(localStatus);

  async function selectStatus(next: ProjectStatus) {
    if (next === current || saving) {
      setOpen(false);
      return;
    }
    if (
      next === "annulering" &&
      !window.confirm(
        "Weet je zeker dat je deze order definitief wilt annuleren?"
      )
    ) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setError(null);
    const prev = localStatus;
    setLocalStatus(next);
    setOpen(false);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Status wijzigen mislukt"
        );
      }
      const updated = (data as { project?: Project }).project;
      if (updated) onUpdated?.(updated);
      else onUpdated?.({ ...project, status: next });
    } catch (e) {
      setLocalStatus(prev);
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  const grouped = (() => {
    const order: ProjectStatusFase[] = [
      "voorbereiding",
      "financiering",
      "schouw",
      "eindafrekening",
      "uitvoering",
      "afronding",
      "nazorg",
      "overig",
    ];
    const byFase = new Map<ProjectStatusFase, ProjectStatusKey[]>();
    for (const key of allowed) {
      const fase = PROJECT_STATUS_BY_KEY[key].fase;
      const list = byFase.get(fase) || [];
      list.push(key);
      byFase.set(fase, list);
    }
    return order
      .filter((f) => byFase.has(f))
      .map((f) => ({ fase: f, keys: byFase.get(f)! }));
  })();

  const menu =
    open && mounted
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            className="fixed z-[80] max-h-[70vh] overflow-y-auto border border-line bg-white py-1.5 shadow-lg"
            style={{
              top: pos?.top ?? -9999,
              left: pos?.left ?? 0,
              minWidth: pos?.minWidth ?? 260,
              visibility: pos ? "visible" : "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              {BETAALWIJZE_LABEL[betaalwijze]}
            </p>
            {grouped.map(({ fase, keys }) => (
              <div key={fase}>
                <p className="border-t border-line px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {PROJECT_STATUS_FASE_LABEL[fase]}
                </p>
                {keys.map((st) => {
                  const active = st === current;
                  return (
                    <button
                      key={st}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => void selectStatus(st)}
                      className={[
                        "flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-wash",
                        active ? "bg-wash/80" : "",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "w-4 shrink-0 text-center text-[11px] font-bold text-green-deeper",
                          active ? "opacity-100" : "opacity-0",
                        ].join(" ")}
                        aria-hidden
                      >
                        ✓
                      </span>
                      <span
                        className={[
                          "inline-flex max-w-full truncate rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                          statusTone("project", st),
                        ].join(" ")}
                      >
                        {projectStatusLabel[st] ||
                          PROJECT_STATUS_DEFS.find((d) => d.key === st)?.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        disabled={saving}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
          setError(null);
        }}
        className={[
          "inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold disabled:opacity-60",
          statusTone("project", current),
        ].join(" ")}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Status wijzigen"
      >
        <span className="truncate">
          {projectStatusLabel[current] || current}
        </span>
        <span className="text-[9px] opacity-70" aria-hidden>
          ▾
        </span>
      </button>

      {error ? (
        <p className="mt-1 max-w-[12rem] text-[10px] text-[#C45A12]">{error}</p>
      ) : null}

      {menu}
    </div>
  );
}
