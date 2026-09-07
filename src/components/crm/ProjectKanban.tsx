"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  InstallatiePartner,
  OfferteRegel,
  Project,
  ProjectStatus,
} from "@/types/database";
import { PROJECT_STATUSES, projectStatusLabel } from "@/lib/labels";
import { formatDateTimeNl, formatEuro } from "@/lib/format";
import {
  formatProjectSchouwWeek,
  isInSchouwdagPlannenWindow,
  parseSchouwWeekValue,
  upcomingSchouwWeekOptions,
} from "@/lib/schouw-week";

const COLUMN_ACCENT: Record<ProjectStatus, string> = {
  schouw_aanbetaling: "#1A4A6E",
  aanbetaling_betaald: "#0D7A6F",
  schouw_in_afwachting: "#CA8A04",
  schouw_voltooid: "#1565C0",
  restfactuur_verstuurd: "#C45A12",
  restfactuur_betaald: "#C9A227",
  materiaal_installatie: "#7C3AED",
  installatie_voltooid: "#0D5C32",
  service: "#00695C",
};

function adresRegel(p: Project): string {
  const l = p.leads;
  if (!l) return "—";
  const parts = [
    l.straat,
    [l.huisnummer, l.toevoeging].filter(Boolean).join(""),
  ].filter(Boolean);
  const line = parts.length
    ? parts.join(" ")
    : [l.postcode, l.huisnummer].filter(Boolean).join(" ");
  return [line, l.plaats].filter(Boolean).join(", ") || "—";
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type PendingMove =
  | { type: "schouwweek"; project: Project }
  | { type: "schouwdag"; project: Project }
  | { type: "materiaal"; project: Project };

export function ProjectKanban({
  projecten,
  onProjectUpdated,
}: {
  projecten: Project[];
  onProjectUpdated?: (project: Project) => void;
}) {
  const router = useRouter();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<ProjectStatus | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoPromoted = useRef<Set<string>>(new Set());

  const byStatus = useMemo(() => {
    const map = new Map<ProjectStatus, Project[]>();
    for (const s of PROJECT_STATUSES) map.set(s, []);
    for (const p of projecten) {
      const list = map.get(p.status) || map.get("schouw_aanbetaling")!;
      list.push(p);
    }
    return map;
  }, [projecten]);

  // Legacy auto-promote uitgeschakeld (nieuwe pipeline)
  useEffect(() => {
    /* no-op */
  }, []);

  async function patchStatus(project: Project, status: ProjectStatus) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Status bijwerken mislukt");
      onProjectUpdated?.(data.project as Project);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  function handleDrop(status: ProjectStatus) {
    if (!dragId) return;
    const project = projecten.find((p) => p.id === dragId);
    setDragId(null);
    setOverStatus(null);
    if (!project || project.status === status) return;
    void patchStatus(project, status);
  }

  function scrollBy(dir: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(360, el.clientWidth * 0.7), behavior: "smooth" });
  }

  return (
    <div className="flex flex-col gap-3 pb-4">
      <div className="flex items-center justify-between gap-2 px-5">
        <p className="text-sm text-muted">
          Sleep kaarten tussen kolommen · swipe of pijlen voor meer statussen
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            className="flex h-9 w-9 items-center justify-center border border-line bg-white text-ink hover:bg-wash"
            aria-label="Scroll links"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            className="flex h-9 w-9 items-center justify-center border border-line bg-white text-ink hover:bg-wash"
            aria-label="Scroll rechts"
          >
            ›
          </button>
        </div>
      </div>

      {error && (
        <p className="mx-5 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      )}

      <div
        ref={scrollerRef}
        className="flex gap-3 overflow-x-auto px-5 pb-2 scroll-smooth snap-x snap-mandatory"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {PROJECT_STATUSES.map((status) => {
          const items = byStatus.get(status) || [];
          const accent = COLUMN_ACCENT[status];
          const isOver = overStatus === status;
          return (
            <section
              key={status}
              className={[
                "flex w-[280px] shrink-0 snap-start flex-col border bg-[#FAFBFA]",
                isOver ? "border-green ring-2 ring-green/30" : "border-line",
              ].join(" ")}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStatus(status);
              }}
              onDragLeave={() => {
                if (overStatus === status) setOverStatus(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(status);
              }}
            >
              <header
                className="sticky top-0 z-[1] flex items-center justify-between gap-2 border-b border-line bg-white px-3 py-2.5"
                style={{ borderTop: `3px solid ${accent}` }}
              >
                <h3 className="text-[12px] font-semibold text-ink">
                  {projectStatusLabel[status]}
                </h3>
                <span
                  className="inline-flex min-w-[1.5rem] items-center justify-center px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white"
                  style={{ background: accent }}
                >
                  {items.length}
                </span>
              </header>
              <div className="flex max-h-[min(70vh,720px)] flex-col gap-2 overflow-y-auto p-2">
                {items.length === 0 ? (
                  <p className="px-2 py-8 text-center text-[11px] text-muted">
                    Leeg
                  </p>
                ) : (
                  items.map((p) => (
                    <article
                      key={p.id}
                      draggable={!busy}
                      onDragStart={() => setDragId(p.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStatus(null);
                      }}
                      className={[
                        "cursor-grab border border-line bg-white p-2.5 active:cursor-grabbing",
                        dragId === p.id ? "opacity-60 ring-2 ring-green" : "",
                      ].join(" ")}
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() =>
                          router.push(`/projecten/${p.id}?from=orders`)
                        }
                      >
                        <p className="font-mono text-[10px] font-semibold text-green-dark">
                          {p.project_nummer}
                        </p>
                        <p className="mt-0.5 truncate text-sm font-semibold text-ink">
                          {p.leads?.naam || "—"}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">
                          {adresRegel(p)}
                        </p>
                        {(p.schouw_jaar && p.schouw_week) || p.schouw_at ? (
                          <p className="mt-1 text-[10px] font-medium text-[#1A4A6E]">
                            {p.schouw_at &&
                            p.status !== "schouw_aanbetaling" &&
                            p.status !== "aanbetaling_betaald"
                              ? formatDateTimeNl(p.schouw_at)
                              : formatProjectSchouwWeek(p)}
                          </p>
                        ) : null}
                        {p.installatie_partners?.naam ? (
                          <p className="mt-0.5 truncate text-[10px] text-muted">
                            {p.installatie_partners.naam}
                          </p>
                        ) : null}
                      </button>
                      {status === "materiaal_installatie" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPending({ type: "materiaal", project: p });
                          }}
                          className="mt-2 w-full border border-[#7C3AED]/35 bg-[#F5F3FF] px-2 py-1.5 text-[11px] font-semibold text-[#5B21B6] hover:bg-[#ede9fe]"
                        >
                          Materiaal / offerte PDF
                        </button>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      {pending?.type === "schouwweek" && (
        <SchouwweekModal
          project={pending.project}
          busy={busy}
          onClose={() => setPending(null)}
          onSave={async (jaar, week) => {
            setBusy(true);
            setError(null);
            try {
              const res = await fetch(`/api/projecten/${pending.project.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  status: "schouw_aanbetaling",
                  schouw_jaar: jaar,
                  schouw_week: week,
                }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
              onProjectUpdated?.(data.project as Project);
              setPending(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Fout");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {pending?.type === "schouwdag" && (
        <SchouwdagModal
          project={pending.project}
          busy={busy}
          onClose={() => setPending(null)}
          onSave={async (payload) => {
            setBusy(true);
            setError(null);
            try {
              const res = await fetch(
                `/api/projecten/${pending.project.id}/schouw`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(payload),
                }
              );
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Schouw plannen mislukt");
              if (data.project) onProjectUpdated?.(data.project as Project);
              setPending(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Fout");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {pending?.type === "materiaal" && (
        <MateriaalModal
          project={pending.project}
          onClose={() => setPending(null)}
          onUpdated={(p) => {
            onProjectUpdated?.(p);
            setPending({ type: "materiaal", project: p });
          }}
        />
      )}
    </div>
  );
}

function SchouwweekModal({
  project,
  busy,
  onClose,
  onSave,
}: {
  project: Project;
  busy: boolean;
  onClose: () => void;
  onSave: (jaar: number, week: number) => void;
}) {
  const options = useMemo(() => upcomingSchouwWeekOptions(52), []);
  const [value, setValue] = useState(() => {
    if (project.schouw_jaar && project.schouw_week) {
      return `${project.schouw_jaar}-W${String(project.schouw_week).padStart(2, "0")}`;
    }
    return options[0]?.value || "";
  });

  return (
    <ModalShell title="Schouwweek kiezen" onClose={onClose}>
      <p className="text-sm text-muted">
        {project.leads?.naam || project.project_nummer} — kies de week voor de
        schouw. Vanaf 7 dagen vóór die week komt het project automatisch in
        “Schouwdag plannen”.
      </p>
      <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-muted">
        Schouwweek
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const p = parseSchouwWeekValue(value);
            if (p) onSave(p.jaar, p.week);
          }}
          className="flex-1 bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
        >
          Opslaan
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 border border-line px-4 py-2.5 text-sm font-semibold text-muted hover:bg-wash"
        >
          Annuleren
        </button>
      </div>
    </ModalShell>
  );
}

function SchouwdagModal({
  project,
  busy,
  onClose,
  onSave,
}: {
  project: Project;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: {
    schouw_at: string;
    installatie_partner_id: string;
    schouw_notities?: string;
  }) => void;
}) {
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [partnerId, setPartnerId] = useState(
    project.installatie_partner_id || ""
  );
  const [schouwAt, setSchouwAt] = useState(
    toDatetimeLocalValue(project.schouw_at)
  );
  const [notities, setNotities] = useState(project.schouw_notities || "");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/installatie-partners");
        const data = await res.json();
        if (!cancelled) setPartners(data.partners || data.items || []);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ModalShell title="Schouwdag plannen + mail" onClose={onClose}>
      <p className="text-sm text-muted">
        Zet datum/tijd voor de schouw. De klant (en partner) krijgen een mail
        met de afspraak.
      </p>
      <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-muted">
        Datum & tijd
        <input
          type="datetime-local"
          value={schouwAt}
          onChange={(e) => setSchouwAt(e.target.value)}
          className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
        />
      </label>
      <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-muted">
        Installatiepartner
        <select
          value={partnerId}
          onChange={(e) => setPartnerId(e.target.value)}
          className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
        >
          <option value="">Kies partner…</option>
          {partners
            .filter((p) => p.actief !== false)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.naam}
              </option>
            ))}
        </select>
      </label>
      <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-muted">
        Notitie (optioneel)
        <textarea
          value={notities}
          onChange={(e) => setNotities(e.target.value)}
          rows={2}
          className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
        />
      </label>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          disabled={busy || !schouwAt || !partnerId}
          onClick={() => {
            const d = new Date(schouwAt);
            if (Number.isNaN(d.getTime())) return;
            onSave({
              schouw_at: d.toISOString(),
              installatie_partner_id: partnerId,
              schouw_notities: notities.trim() || undefined,
            });
          }}
          className="flex-1 bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
        >
          Plannen & mailen
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 border border-line px-4 py-2.5 text-sm font-semibold text-muted hover:bg-wash"
        >
          Annuleren
        </button>
      </div>
    </ModalShell>
  );
}

function MateriaalModal({
  project,
  onClose,
  onUpdated,
}: {
  project: Project;
  onClose: () => void;
  onUpdated: (p: Project) => void;
}) {
  const [regels, setRegels] = useState<OfferteRegel[]>([]);
  const [checks, setChecks] = useState<Record<string, boolean>>(
    () => project.materiaal_checks || {}
  );
  const [leveradres, setLeveradres] = useState(
    () => project.leveradres || adresRegel(project)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offerteId = project.offerte_id || project.offertes?.id;

  useEffect(() => {
    if (!offerteId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/offertes/${offerteId}`);
        const data = await res.json();
        if (!cancelled) {
          setRegels((data.offerte?.offerte_regels || []) as OfferteRegel[]);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [offerteId]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leveradres,
          materiaal_checks: checks,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      onUpdated(data.project as Project);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setSaving(false);
    }
  }, [project.id, leveradres, checks, onUpdated]);

  return (
    <ModalShell title="Materiaal inkopen" onClose={onClose} wide>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">
            {project.leads?.naam || project.project_nummer}
          </p>
          <p className="mt-0.5 text-sm text-muted">
            Partner:{" "}
            {project.installatie_partners?.naam ||
              project.monteur ||
              "Nog geen partner"}
          </p>
        </div>
        {offerteId ? (
          <a
            href={`/api/offertes/${offerteId}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="border border-orange bg-orange px-3 py-2 text-xs font-semibold text-white hover:bg-[#e0651c]"
          >
            Offerte downloaden (PDF)
          </a>
        ) : (
          <span className="text-xs text-muted">Geen offerte gekoppeld</span>
        )}
      </div>

      <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-muted">
        Leveradres
        <textarea
          value={leveradres}
          onChange={(e) => setLeveradres(e.target.value)}
          rows={2}
          className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
        />
      </label>

      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Producten
      </p>
      <ul className="mt-2 divide-y divide-line border border-line">
        {regels.length === 0 ? (
          <li className="px-3 py-4 text-sm text-muted">
            Geen regels geladen…
          </li>
        ) : (
          regels.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-3 py-2.5">
              <input
                type="checkbox"
                checked={Boolean(checks[r.id])}
                onChange={(e) =>
                  setChecks((prev) => ({
                    ...prev,
                    [r.id]: e.target.checked,
                  }))
                }
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{r.omschrijving}</p>
                <p className="text-xs text-muted">
                  {r.aantal}× · {formatEuro(r.totaal_ex_btw)}
                </p>
              </div>
            </li>
          ))
        )}
      </ul>

      {error && (
        <p className="mt-3 text-xs text-[#C45A12]">{error}</p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
        >
          Opslaan
        </button>
        <Link
          href={`/projecten/${project.id}?from=orders`}
          className="border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-wash"
        >
          Naar project
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="border border-line px-4 py-2.5 text-sm font-semibold text-muted hover:bg-wash"
        >
          Sluiten
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className={[
          "max-h-[90vh] w-full overflow-y-auto border border-line bg-white p-5 shadow-xl",
          wide ? "max-w-lg" : "max-w-md",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-semibold text-ink">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 text-xl text-muted hover:bg-wash"
            aria-label="Sluiten"
          >
            ×
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
