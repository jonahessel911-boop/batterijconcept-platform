"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { addDays, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import {
  Calendar,
  CalendarDays,
  Hash,
  Link2,
  List,
  MoreHorizontal,
  Search,
  Tag,
  Type,
} from "lucide-react";
import type { Adviseur } from "@/types/database";
import { AMSTERDAM_TZ, formatDateShort, formatTimeNl } from "@/lib/format";
import { normalizeRol } from "@/lib/rollen";
import {
  defaultTaakCategorie,
  TAAK_CATEGORIE_LABEL,
  TAAK_CATEGORIE_PILL,
  TAAK_CATEGORIEEN,
  type TaakCategorie,
} from "@/lib/taak-categorie";

type AgendaItem = {
  id: string;
  titel: string;
  inhoud: string | null;
  soort: "taak" | "afspraak";
  start_at: string;
  end_at: string | null;
  status: "todo" | "done";
  adviseur_id: string;
  project_id?: string | null;
  categorie?: TaakCategorie | string | null;
  projecten?: {
    id?: string;
    project_nummer?: string | null;
    titel?: string | null;
    leads?:
      | { naam?: string | null; plaats?: string | null }
      | { naam?: string | null; plaats?: string | null }[]
      | null;
  } | null;
};

type ProjectTaakRow = {
  id: string;
  titel: string;
  status: string;
  due_at: string | null;
  afdeling: string | null;
  categorie?: TaakCategorie | string | null;
  project_id: string;
  projecten?: {
    id?: string;
    project_nummer?: string | null;
    titel?: string | null;
    leads?:
      | { naam?: string | null; plaats?: string | null }
      | { naam?: string | null; plaats?: string | null }[]
      | null;
  } | null;
};

type ViewMode = "week" | "list";

type ListRow = {
  key: string;
  source: "agenda" | "project";
  id: string;
  titel: string;
  startAt: string | null;
  projectId: string | null;
  projectNummer: string | null;
  categorie: TaakCategorie;
  overdue: boolean;
};

type DayCol = { key: string; label: string; sub: string; weekend: boolean };

type Chip =
  | {
      kind: "persoonlijk";
      id: string;
      dayKey: string;
      titel: string;
      timeLabel: string;
      detail: string | null;
      soort: "taak" | "afspraak";
      overdue: boolean;
      projectId?: string | null;
    }
  | {
      kind: "project";
      id: string;
      dayKey: string;
      titel: string;
      timeLabel: string;
      detail: string | null;
      projectId: string;
      overdue: boolean;
    };

function projectDetailLabel(
  p:
    | AgendaItem["projecten"]
    | ProjectTaakRow["projecten"]
    | null
    | undefined
): string | null {
  if (!p) return null;
  const leadRaw = p.leads;
  const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
  return (
    [p.project_nummer, lead?.naam].filter(Boolean).join(" · ") || null
  );
}

function weekDaysFrom(anchor: Date): DayCol[] {
  const local = toZonedTime(anchor, AMSTERDAM_TZ);
  const monday = startOfWeek(local, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const noon = fromZonedTime(
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0),
      AMSTERDAM_TZ
    );
    const key = formatInTimeZone(noon, AMSTERDAM_TZ, "yyyy-MM-dd");
    const dow = date.getDay();
    return {
      key,
      label: formatInTimeZone(noon, AMSTERDAM_TZ, "EEE", { locale: nl }),
      sub: formatInTimeZone(noon, AMSTERDAM_TZ, "d MMM", { locale: nl }),
      weekend: dow === 0 || dow === 6,
    };
  });
}

function dayKeyOf(iso: string): string {
  return formatInTimeZone(iso, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultDatetimeForDay(dayKey: string, hour = 9): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return toDatetimeLocalValue(new Date(y, m - 1, d, hour, 0, 0, 0));
}

function plusOneHour(local: string): string {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return local;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5])
  );
  d.setHours(d.getHours() + 1);
  return toDatetimeLocalValue(d);
}

function leadNaam(t: ProjectTaakRow): string | null {
  const join = t.projecten?.leads;
  const L = Array.isArray(join) ? join[0] : join;
  return L?.naam?.trim() || null;
}

function projectNummerOf(
  p: AgendaItem["projecten"] | ProjectTaakRow["projecten"] | null | undefined
): string | null {
  if (!p) return null;
  return p.project_nummer?.trim() || null;
}

function isBoMedewerker(a: Adviseur): boolean {
  if (a.actief === false) return false;
  const rol = normalizeRol(a.rol);
  return rol === "backoffice" || rol === "admin";
}

/** Notion multi-select-achtige categorie-pill. */
function CategoriePillSelect({
  value,
  disabled,
  onChange,
}: {
  value: TaakCategorie;
  disabled?: boolean;
  onChange: (next: TaakCategorie) => void;
}) {
  const pill = TAAK_CATEGORIE_PILL[value];
  return (
    <div className="relative inline-flex max-w-full">
      <span
        className="pointer-events-none inline-flex max-w-full items-center truncate rounded-[3px] px-1.5 py-[2px] text-[13px] font-medium leading-5"
        style={{ background: pill.bg, color: pill.text }}
      >
        {TAAK_CATEGORIE_LABEL[value]}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as TaakCategorie)}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
        aria-label="Categorie"
      >
        {TAAK_CATEGORIEEN.map((c) => (
          <option key={c} value={c}>
            {TAAK_CATEGORIE_LABEL[c]}
          </option>
        ))}
      </select>
    </div>
  );
}

function NotionColIcon({ children }: { children: ReactNode }) {
  return (
    <span className="mr-1.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[#9B9A97]">
      {children}
    </span>
  );
}

export function TakenAgendaPanel({
  adviseurs,
  sessionAdviseurId,
  sessionRol,
}: {
  adviseurs: Adviseur[];
  sessionAdviseurId?: string | null;
  sessionRol?: string | null;
}) {
  const medewerkers = useMemo(
    () =>
      adviseurs
        .filter(isBoMedewerker)
        .sort((a, b) => a.naam.localeCompare(b.naam, "nl")),
    [adviseurs]
  );

  const isAdmin = normalizeRol(sessionRol) === "admin";
  const defaultId =
    (sessionAdviseurId &&
      medewerkers.some((m) => m.id === sessionAdviseurId) &&
      sessionAdviseurId) ||
    medewerkers[0]?.id ||
    "";

  const [medewerkerId, setMedewerkerId] = useState(defaultId);
  const [anchor, setAnchor] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [listSearch, setListSearch] = useState("");
  const [listSearchOpen, setListSearchOpen] = useState(false);
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [projectTaken, setProjectTaken] = useState<ProjectTaakRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [categorieBusyId, setCategorieBusyId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formDay, setFormDay] = useState<string | null>(null);
  const [titel, setTitel] = useState("");
  const [inhoud, setInhoud] = useState("");
  const [soort, setSoort] = useState<"taak" | "afspraak">("afspraak");
  const [categorie, setCategorie] = useState<TaakCategorie>("overig");
  const [startLocal, setStartLocal] = useState(() =>
    defaultDatetimeForDay(
      formatInTimeZone(new Date(), AMSTERDAM_TZ, "yyyy-MM-dd"),
      10
    )
  );
  const [endLocal, setEndLocal] = useState(() =>
    plusOneHour(
      defaultDatetimeForDay(
        formatInTimeZone(new Date(), AMSTERDAM_TZ, "yyyy-MM-dd"),
        10
      )
    )
  );

  useEffect(() => {
    if (!medewerkerId && defaultId) setMedewerkerId(defaultId);
  }, [defaultId, medewerkerId]);

  const days = useMemo(() => weekDaysFrom(anchor), [anchor]);
  const fromIso = useMemo(() => {
    if (viewMode === "list") {
      // List: open taken breed (60d terug → 120d vooruit)
      const local = toZonedTime(new Date(), AMSTERDAM_TZ);
      const from = addDays(local, -60);
      return fromZonedTime(
        `${formatInTimeZone(from, AMSTERDAM_TZ, "yyyy-MM-dd")}T00:00:00`,
        AMSTERDAM_TZ
      ).toISOString();
    }
    if (!days[0]) return null;
    return fromZonedTime(`${days[0].key}T00:00:00`, AMSTERDAM_TZ).toISOString();
  }, [days, viewMode]);
  const toIso = useMemo(() => {
    if (viewMode === "list") {
      const local = toZonedTime(new Date(), AMSTERDAM_TZ);
      const to = addDays(local, 120);
      return fromZonedTime(
        `${formatInTimeZone(to, AMSTERDAM_TZ, "yyyy-MM-dd")}T23:59:59`,
        AMSTERDAM_TZ
      ).toISOString();
    }
    const last = days[6];
    if (!last) return null;
    return fromZonedTime(`${last.key}T23:59:59`, AMSTERDAM_TZ).toISOString();
  }, [days, viewMode]);

  const weekLabel = useMemo(() => {
    if (!days[0] || !days[6]) return "";
    return `${days[0].sub} – ${days[6].sub}`;
  }, [days]);

  const load = useCallback(async () => {
    if (!medewerkerId || !fromIso || !toIso) {
      setItems([]);
      setProjectTaken([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        adviseur_id: medewerkerId,
        from: fromIso,
        to: toIso,
        open: "1",
      });
      const res = await fetch(`/api/bo-agenda?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Laden mislukt"
        );
      }
      if ((data as { error?: string }).error && !(data as { items?: unknown[] }).items) {
        setError((data as { error: string }).error);
      }
      setItems(((data as { items?: AgendaItem[] }).items || []) as AgendaItem[]);
      setProjectTaken(
        ((data as { project_taken?: ProjectTaakRow[] }).project_taken ||
          []) as ProjectTaakRow[]
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setItems([]);
      setProjectTaken([]);
    } finally {
      setLoading(false);
    }
  }, [medewerkerId, fromIso, toIso]);

  useEffect(() => {
    void load();
  }, [load]);

  const chipsByDay = useMemo(() => {
    const map = new Map<string, Chip[]>();
    for (const d of days) map.set(d.key, []);
    const now = Date.now();

    for (const it of items) {
      const key = dayKeyOf(it.start_at);
      const list = map.get(key);
      if (!list) continue;
      const end = it.end_at || it.start_at;
      const projectId =
        it.project_id || it.projecten?.id || null;
      const projectLabel = projectDetailLabel(it.projecten);
      list.push({
        kind: "persoonlijk",
        id: it.id,
        dayKey: key,
        titel: it.titel,
        timeLabel:
          it.soort === "afspraak" && it.end_at
            ? `${formatTimeNl(it.start_at)}–${formatTimeNl(it.end_at)}`
            : formatTimeNl(it.start_at),
        detail:
          [projectLabel, it.inhoud].filter(Boolean).join(" · ") || null,
        soort: it.soort,
        overdue: new Date(end).getTime() < now,
        projectId,
      });
    }

    for (const t of projectTaken) {
      if (!t.due_at) continue;
      const key = dayKeyOf(t.due_at);
      const list = map.get(key);
      if (!list) continue;
      list.push({
        kind: "project",
        id: t.id,
        dayKey: key,
        titel: t.titel,
        timeLabel: formatTimeNl(t.due_at),
        detail: projectDetailLabel(t.projecten) || leadNaam(t),
        projectId: t.project_id,
        overdue: new Date(t.due_at).getTime() < now,
      });
    }

    for (const [, list] of map) {
      list.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel));
    }
    return map;
  }, [days, items, projectTaken]);

  const listRows = useMemo((): ListRow[] => {
    const now = Date.now();
    const rows: ListRow[] = [];

    for (const it of items) {
      const projectId = it.project_id || it.projecten?.id || null;
      rows.push({
        key: `agenda-${it.id}`,
        source: "agenda",
        id: it.id,
        titel: it.titel,
        startAt: it.start_at,
        projectId,
        projectNummer: projectNummerOf(it.projecten),
        categorie: defaultTaakCategorie({
          hasProject: Boolean(projectId),
          categorie: it.categorie,
        }),
        overdue: new Date(it.end_at || it.start_at).getTime() < now,
      });
    }

    for (const t of projectTaken) {
      rows.push({
        key: `project-${t.id}`,
        source: "project",
        id: t.id,
        titel: t.titel,
        startAt: t.due_at,
        projectId: t.project_id || t.projecten?.id || null,
        projectNummer: projectNummerOf(t.projecten),
        categorie: defaultTaakCategorie({
          hasProject: true,
          categorie: t.categorie,
        }),
        overdue: t.due_at ? new Date(t.due_at).getTime() < now : false,
      });
    }

    rows.sort((a, b) => {
      if (!a.startAt && !b.startAt) return a.titel.localeCompare(b.titel, "nl");
      if (!a.startAt) return 1;
      if (!b.startAt) return -1;
      return a.startAt.localeCompare(b.startAt);
    });
    return rows;
  }, [items, projectTaken]);

  const filteredListRows = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return listRows;
    return listRows.filter((row) => {
      const hay = [
        row.titel,
        row.projectNummer,
        TAAK_CATEGORIE_LABEL[row.categorie],
        row.startAt ? formatDateShort(row.startAt) : "",
        row.startAt ? formatTimeNl(row.startAt) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [listRows, listSearch]);

  function openCreate(dayKey?: string) {
    const key =
      dayKey ||
      formatInTimeZone(new Date(), AMSTERDAM_TZ, "yyyy-MM-dd");
    const start = defaultDatetimeForDay(key, 10);
    setFormDay(key);
    setTitel("");
    setInhoud("");
    setSoort("afspraak");
    setCategorie("overig");
    setStartLocal(start);
    setEndLocal(plusOneHour(start));
    setShowForm(true);
  }

  async function createItem(e: React.FormEvent) {
    e.preventDefault();
    if (!titel.trim() || !medewerkerId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bo-agenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titel: titel.trim(),
          inhoud: inhoud.trim() || null,
          soort,
          categorie,
          start_at: startLocal,
          end_at: soort === "afspraak" ? endLocal : null,
          adviseur_id: medewerkerId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Aanmaken mislukt"
        );
      }
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aanmaken mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function markDone(id: string) {
    try {
      await fetch(`/api/bo-agenda/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      await load();
    } catch {
      /* ignore */
    }
  }

  async function removeItem(id: string) {
    if (!window.confirm("Agenda-item verwijderen?")) return;
    try {
      await fetch(`/api/bo-agenda/${id}`, { method: "DELETE" });
      await load();
    } catch {
      /* ignore */
    }
  }

  async function patchCategorie(row: ListRow, next: TaakCategorie) {
    if (row.categorie === next) return;
    setCategorieBusyId(row.key);
    setError(null);
    // Optimistic
    if (row.source === "agenda") {
      setItems((prev) =>
        prev.map((it) =>
          it.id === row.id ? { ...it, categorie: next } : it
        )
      );
    } else {
      setProjectTaken((prev) =>
        prev.map((t) =>
          t.id === row.id ? { ...t, categorie: next } : t
        )
      );
    }
    try {
      const url =
        row.source === "agenda"
          ? `/api/bo-agenda/${row.id}`
          : `/api/taken/${row.id}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categorie: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Categorie opslaan mislukt"
        );
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Categorie opslaan mislukt"
      );
      await load();
    } finally {
      setCategorieBusyId(null);
    }
  }

  const medewerkerNaam =
    medewerkers.find((m) => m.id === medewerkerId)?.naam || "—";

  return (
    <div className="space-y-0">
      {/* Notion-achtige view-tabs + toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9E9E7] pb-0">
        <div className="flex min-w-0 items-end gap-1">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={[
              "relative inline-flex items-center gap-1.5 px-2.5 pb-2.5 pt-1 text-[14px] font-medium",
              viewMode === "list"
                ? "text-[#37352F]"
                : "text-[#787774] hover:bg-[#F1F1EF] hover:text-[#37352F]",
            ].join(" ")}
          >
            <List className="h-3.5 w-3.5" aria-hidden />
            List
            {viewMode === "list" ? (
              <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#37352F]" />
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setViewMode("week")}
            className={[
              "relative inline-flex items-center gap-1.5 px-2.5 pb-2.5 pt-1 text-[14px] font-medium",
              viewMode === "week"
                ? "text-[#37352F]"
                : "text-[#787774] hover:bg-[#F1F1EF] hover:text-[#37352F]",
            ].join(" ")}
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            Week
            {viewMode === "week" ? (
              <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#37352F]" />
            ) : null}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-0.5 pb-1.5">
          {isAdmin ? (
            <select
              value={medewerkerId}
              onChange={(e) => setMedewerkerId(e.target.value)}
              className="mr-1 max-w-[11rem] truncate border-0 bg-transparent px-1.5 py-1 text-[13px] font-medium text-[#37352F] outline-none hover:bg-[#F1F1EF]"
              title="Medewerker"
            >
              {medewerkers.length === 0 ? (
                <option value="">Geen medewerkers</option>
              ) : (
                medewerkers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.naam}
                  </option>
                ))
              )}
            </select>
          ) : (
            <span className="mr-1 px-1.5 py-1 text-[13px] font-medium text-[#37352F]">
              {medewerkerNaam}
            </span>
          )}

          {viewMode === "week" ? (
            <>
              <button
                type="button"
                onClick={() => setAnchor((a) => addDays(a, -7))}
                className="rounded px-2 py-1 text-[13px] text-[#787774] hover:bg-[#F1F1EF] hover:text-[#37352F]"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => setAnchor(new Date())}
                className="rounded px-2 py-1 text-[13px] text-[#787774] hover:bg-[#F1F1EF] hover:text-[#37352F]"
              >
                Vandaag
              </button>
              <button
                type="button"
                onClick={() => setAnchor((a) => addDays(a, 7))}
                className="rounded px-2 py-1 text-[13px] text-[#787774] hover:bg-[#F1F1EF] hover:text-[#37352F]"
              >
                →
              </button>
              <span className="px-1.5 text-[12px] text-[#9B9A97]">
                {weekLabel}
              </span>
            </>
          ) : (
            <>
              {listSearchOpen ? (
                <input
                  autoFocus
                  type="search"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  onBlur={() => {
                    if (!listSearch.trim()) setListSearchOpen(false);
                  }}
                  placeholder="Zoeken…"
                  className="mr-0.5 w-40 border border-[#E9E9E7] bg-white px-2 py-1 text-[13px] text-[#37352F] outline-none placeholder:text-[#9B9A97] focus:border-[#2383E2]"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setListSearchOpen(true)}
                  className="rounded p-1.5 text-[#787774] hover:bg-[#F1F1EF]"
                  title="Zoeken"
                  aria-label="Zoeken"
                >
                  <Search className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                className="rounded p-1.5 text-[#787774] hover:bg-[#F1F1EF]"
                title="Meer"
                aria-label="Meer"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => openCreate()}
            className="ml-1 rounded-[4px] bg-[#2383E2] px-2.5 py-1 text-[13px] font-medium text-white hover:bg-[#1B6EC2]"
          >
            New
          </button>
        </div>
      </div>

      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {showForm ? (
        <form
          onSubmit={(e) => void createItem(e)}
          className="space-y-2 border border-line bg-wash px-3 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Nieuw · {formDay || "—"} · {medewerkerNaam}
            </p>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs text-muted hover:text-ink"
            >
              Annuleren
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["afspraak", "taak"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSoort(s)}
                className={[
                  "border px-2.5 py-1 text-xs font-semibold",
                  soort === s
                    ? "border-green bg-green-soft text-green-dark"
                    : "border-line bg-white text-ink",
                ].join(" ")}
              >
                {s === "afspraak" ? "Agenda-punt" : "Taak"}
              </button>
            ))}
          </div>
          <label className="block text-xs text-muted">
            Categorie
            <select
              value={categorie}
              onChange={(e) =>
                setCategorie(e.target.value as TaakCategorie)
              }
              className="mt-0.5 block w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
            >
              {TAAK_CATEGORIEEN.map((c) => (
                <option key={c} value={c}>
                  {TAAK_CATEGORIE_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <input
            value={titel}
            onChange={(e) => setTitel(e.target.value)}
            placeholder="Bijv. Overstap Frank Energie · bellen"
            required
            className="w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
          />
          <textarea
            value={inhoud}
            onChange={(e) => setInhoud(e.target.value)}
            placeholder="Notitie (optioneel)"
            rows={2}
            className="w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
          />
          <div className="flex flex-wrap gap-2">
            <label className="text-xs text-muted">
              Start
              <input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => {
                  setStartLocal(e.target.value);
                  if (soort === "afspraak") {
                    setEndLocal(plusOneHour(e.target.value));
                  }
                }}
                className="mt-0.5 block border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-green"
              />
            </label>
            {soort === "afspraak" ? (
              <label className="text-xs text-muted">
                Eind
                <input
                  type="datetime-local"
                  value={endLocal}
                  onChange={(e) => setEndLocal(e.target.value)}
                  className="mt-0.5 block border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-green"
                />
              </label>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={busy || !titel.trim()}
            className="bg-green px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Bezig…" : "Opslaan"}
          </button>
        </form>
      ) : null}

      {viewMode === "list" ? (
        <div className="mt-1 overflow-x-auto bg-white">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#E9E9E7] bg-[#F7F7F5]">
                <th className="border-r border-[#E9E9E7] px-3 py-1.5 text-[12px] font-medium text-[#787774]">
                  <span className="inline-flex items-center">
                    <NotionColIcon>
                      <Type className="h-3 w-3" strokeWidth={2} />
                    </NotionColIcon>
                    Name
                  </span>
                </th>
                <th className="w-[10.5rem] border-r border-[#E9E9E7] px-3 py-1.5 text-[12px] font-medium text-[#787774]">
                  <span className="inline-flex items-center">
                    <NotionColIcon>
                      <Calendar className="h-3 w-3" strokeWidth={2} />
                    </NotionColIcon>
                    Start date
                  </span>
                </th>
                <th className="w-[9.5rem] border-r border-[#E9E9E7] px-3 py-1.5 text-[12px] font-medium text-[#787774]">
                  <span className="inline-flex items-center">
                    <NotionColIcon>
                      <Hash className="h-3 w-3" strokeWidth={2} />
                    </NotionColIcon>
                    Projectnummer
                  </span>
                </th>
                <th className="w-[9rem] px-3 py-1.5 text-[12px] font-medium text-[#787774]">
                  <span className="inline-flex items-center">
                    <NotionColIcon>
                      <Tag className="h-3 w-3" strokeWidth={2} />
                    </NotionColIcon>
                    Categorie
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-10 text-center text-[14px] text-[#9B9A97]"
                  >
                    Laden…
                  </td>
                </tr>
              ) : filteredListRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-10 text-center text-[14px] text-[#9B9A97]"
                  >
                    {listSearch.trim()
                      ? "Geen resultaten"
                      : "Geen open taken"}
                  </td>
                </tr>
              ) : (
                filteredListRows.map((row) => (
                  <tr
                    key={row.key}
                    className={[
                      "group border-b border-[#E9E9E7] hover:bg-[#F7F7F5]",
                      row.overdue ? "bg-[#FFF8F5]" : "bg-white",
                    ].join(" ")}
                  >
                    <td className="max-w-[28rem] border-r border-[#E9E9E7] px-3 py-1.5 align-middle">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1">
                          {row.projectId ? (
                            <Link
                              href={`/projecten/${row.projectId}?from=taken-agenda`}
                              className="block truncate text-[14px] leading-6 text-[#37352F] hover:underline"
                            >
                              {row.titel}
                            </Link>
                          ) : (
                            <span className="block truncate text-[14px] leading-6 text-[#37352F]">
                              {row.titel}
                            </span>
                          )}
                        </div>
                        {row.source === "agenda" ? (
                          <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
                            <button
                              type="button"
                              onClick={() => void markDone(row.id)}
                              className="rounded px-1.5 py-0.5 text-[11px] text-[#0F7B6C] hover:bg-[#E8F6EC]"
                            >
                              Klaar
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeItem(row.id)}
                              className="rounded px-1.5 py-0.5 text-[11px] text-[#9B9A97] hover:bg-[#F1F1EF] hover:text-[#EB5757]"
                            >
                              Wis
                            </button>
                          </div>
                        ) : (
                          <Link2
                            className="hidden h-3.5 w-3.5 shrink-0 text-[#C0BFBC] group-hover:block"
                            aria-hidden
                          />
                        )}
                      </div>
                    </td>
                    <td className="border-r border-[#E9E9E7] px-3 py-1.5 align-middle text-[14px] tabular-nums leading-6 text-[#37352F]">
                      {row.startAt ? (
                        <span>
                          {formatDateShort(row.startAt)}{" "}
                          {formatTimeNl(row.startAt)}
                        </span>
                      ) : (
                        <span className="text-[#C0BFBC]">Empty</span>
                      )}
                    </td>
                    <td className="border-r border-[#E9E9E7] px-3 py-1.5 align-middle">
                      {row.projectId && row.projectNummer ? (
                        <Link
                          href={`/projecten/${row.projectId}?from=taken-agenda`}
                          className="inline-flex items-center gap-1 text-[14px] text-[#37352F] hover:underline"
                        >
                          <Link2 className="h-3 w-3 text-[#9B9A97]" aria-hidden />
                          {row.projectNummer}
                        </Link>
                      ) : row.projectNummer ? (
                        <span className="text-[14px] text-[#37352F]">
                          {row.projectNummer}
                        </span>
                      ) : (
                        <span className="text-[14px] text-[#C0BFBC]">Empty</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 align-middle">
                      <CategoriePillSelect
                        value={row.categorie}
                        disabled={categorieBusyId === row.key}
                        onChange={(next) => void patchCategorie(row, next)}
                      />
                    </td>
                  </tr>
                ))
              )}
              <tr className="border-b border-[#E9E9E7]">
                <td colSpan={4} className="px-2 py-1">
                  <button
                    type="button"
                    onClick={() => openCreate()}
                    className="rounded px-1.5 py-1 text-[14px] text-[#9B9A97] hover:bg-[#F1F1EF] hover:text-[#37352F]"
                  >
                    + New
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div className="flex items-center justify-between px-3 py-2 text-[12px] text-[#9B9A97]">
            <span>
              {filteredListRows.length}
              {listSearch.trim() && filteredListRows.length !== listRows.length
                ? ` van ${listRows.length}`
                : ""}{" "}
              count
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-3 border border-line md:overflow-x-auto">
          <div className="grid grid-cols-1 divide-y divide-line md:min-w-[720px] md:grid-cols-7 md:divide-x md:divide-y-0">
            {days.map((d) => {
              const chips = chipsByDay.get(d.key) || [];
              return (
                <div
                  key={d.key}
                  className={[
                    "min-h-0 bg-white md:min-h-[220px]",
                    d.weekend ? "bg-[#FAFAF8]" : "",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => openCreate(d.key)}
                    className="flex w-full items-baseline justify-between gap-1 border-b border-line px-2 py-1.5 text-left hover:bg-wash"
                    title="Agenda-punt toevoegen"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {d.label}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-ink">
                      {d.sub.split(" ")[0]}
                    </span>
                  </button>
                  <div className="space-y-1 p-1.5">
                    {loading ? (
                      <p className="px-1 py-2 text-[10px] text-muted">…</p>
                    ) : chips.length === 0 ? (
                      <p className="px-1 py-3 text-center text-[10px] text-muted/70">
                        —
                      </p>
                    ) : (
                      chips.map((c) => (
                        <div
                          key={`${c.kind}-${c.id}`}
                          className={[
                            "border px-1.5 py-1 text-left",
                            c.kind === "project"
                              ? "border-[#1A4A6E]/25 bg-[#E8F0F6]"
                              : c.soort === "taak"
                                ? "border-[#C9A227]/40 bg-[#FFF8D6]"
                                : "border-[#0D5C32]/25 bg-[#E8F6EC]",
                            c.overdue ? "ring-1 ring-[#C45A12]/40" : "",
                          ].join(" ")}
                        >
                          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">
                            {c.timeLabel}
                            {c.kind === "project" ? " · taak" : ""}
                          </p>
                          <p className="text-[11px] font-semibold leading-snug text-ink">
                            {c.projectId ? (
                              <a
                                href={`/projecten/${c.projectId}?from=taken-agenda`}
                                className="hover:underline"
                              >
                                {c.titel}
                              </a>
                            ) : (
                              c.titel
                            )}
                          </p>
                          {c.detail ? (
                            <p className="mt-0.5 text-[10px] leading-snug text-muted">
                              {c.detail}
                            </p>
                          ) : null}
                          {c.kind === "persoonlijk" ? (
                            <div className="mt-1 flex gap-1">
                              <button
                                type="button"
                                onClick={() => void markDone(c.id)}
                                className="text-[9px] font-semibold text-green-dark hover:underline"
                              >
                                Klaar
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeItem(c.id)}
                                className="text-[9px] font-semibold text-muted hover:text-[#C62828]"
                              >
                                Wis
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {viewMode === "week" ? (
        <p className="mt-2 text-[10px] text-muted">
          Groen = eigen agenda · geel = eigen taak · blauw = projecttaak
          (toegewezen). Klik op een dagkop om snel iets in te plannen.
        </p>
      ) : null}
    </div>
  );
}
