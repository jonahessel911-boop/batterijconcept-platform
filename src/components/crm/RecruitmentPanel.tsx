"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  CalendarPlus,
  Check,
  Copy,
  Inbox,
  LayoutGrid,
  Mail,
  Phone,
  PhoneCall,
  Plus,
  Search,
  Table2,
  GraduationCap,
  Briefcase,
  ChartColumn,
  Trash2,
} from "lucide-react";
import type {
  Sollicitatie,
  SollicitatieAfspraak,
  SollicitatieStatus,
  TrainingMoment,
} from "@/types/database";
import {
  normalizeSollicitatieStatus,
  SOLLICITATIE_STATUS_LABEL,
  SOLLICITATIE_STATUS_MET_VERVOLG,
  SOLLICITATIE_STATUSES,
} from "@/lib/sollicitatie";
import {
  extractAdresFromNotitie,
  formatSollicitatieAdres,
  mergeSollicitatieAdres,
} from "@/lib/sollicitatie-adres";
import { formatDateShort, formatDateTimeNl } from "@/lib/format";
import { provincieVanPostcode } from "@/lib/postcode-provincie";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  SollicitatieStatusSelect,
  SOLLICITATIE_STATUS_TONE,
} from "@/components/crm/SollicitatieStatusSelect";
import { RecruitmentPlannenView } from "@/components/crm/recruitment/RecruitmentPlannenView";
import { RecruitmentTrainingenBoard } from "@/components/crm/recruitment/RecruitmentTrainingenBoard";
import { RecruitmentKpisView } from "@/components/crm/recruitment/RecruitmentKpisView";
import { RecruitmentJobsView } from "@/components/crm/recruitment/RecruitmentJobsView";
import { RecruitmentBelPanel } from "@/components/crm/recruitment/RecruitmentBelPanel";
import { RecruitmentInboxPanel } from "@/components/crm/recruitment/RecruitmentInboxPanel";
import { cn } from "@/lib/utils";

type ViewMode =
  | "tabel"
  | "bellen"
  | "inbox"
  | "trainingen"
  | "kpis"
  | "vacatures";

type AanmeldLayout = "lijst" | "kanban";

const AANMELDINGEN_PAGE_SIZE = 30;

const VIEW_NAV: Array<{
  id: ViewMode;
  label: string;
  icon: typeof PhoneCall;
  group: "werk" | "beheer";
}> = [
  { id: "bellen", label: "Bellen", icon: PhoneCall, group: "werk" },
  { id: "inbox", label: "Inbox", icon: Inbox, group: "werk" },
  { id: "tabel", label: "Aanmeldingen", icon: Table2, group: "werk" },
  {
    id: "trainingen",
    label: "Trainingen",
    icon: GraduationCap,
    group: "beheer",
  },
  { id: "vacatures", label: "Vacatures", icon: Briefcase, group: "beheer" },
  { id: "kpis", label: "KPI's", icon: ChartColumn, group: "beheer" },
];

const KANBAN_COLUMNS: SollicitatieStatus[] = [
  "nieuw",
  "geen_contact",
  "gesprek_gepland",
  "gesprek_gehad",
  "gesprek_gehad_diskwalificatie",
  "aangenomen_training_gepland",
  "aangenomen_actief",
  "diskwalificatie",
  "definitief_geen_contact",
];

function initials(naam: string) {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] || ""}${parts[parts.length - 1]![0] || ""}`.toUpperCase();
}

function adresOf(s: Sollicitatie) {
  return mergeSollicitatieAdres(
    {
      postcode: s.postcode || null,
      huisnummer: s.huisnummer || null,
      toevoeging: s.toevoeging || null,
      straat: s.straat || null,
      plaats: s.plaats || null,
    },
    extractAdresFromNotitie(s.notitie)
  );
}

function plaatsOf(s: Sollicitatie) {
  const a = adresOf(s);
  if (a.plaats) return a.plaats;
  return (
    formatSollicitatieAdres(a).split(",").pop()?.trim() || a.postcode || ""
  );
}

function provincieOf(s: Sollicitatie) {
  const a = adresOf(s);
  if (!a.postcode) return "";
  const p = provincieVanPostcode(a.postcode);
  return !p || p === "(onbekend)" ? "" : p;
}

function StatusPill({ status }: { status: SollicitatieStatus }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full truncate rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        SOLLICITATIE_STATUS_TONE[status]
      )}
    >
      {SOLLICITATIE_STATUS_LABEL[status]}
    </span>
  );
}

function PhoneCopyCell({ telefoon }: { telefoon: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!telefoon?.trim()) {
    return <span className="text-muted">—</span>;
  }

  async function copy(e: ReactMouseEvent) {
    e.stopPropagation();
    const value = telefoon!.trim();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.createElement("textarea");
      el.value = value;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="tabular-nums text-ink">{telefoon}</span>
      <button
        type="button"
        onClick={(e) => void copy(e)}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted hover:bg-wash hover:text-green-dark"
        title={copied ? "Gekopieerd" : "Kopieer telefoonnummer"}
        aria-label={copied ? "Gekopieerd" : "Kopieer telefoonnummer"}
      >
        {copied ? (
          <Check className="size-3.5 text-green-dark" strokeWidth={2.5} />
        ) : (
          <Copy className="size-3.5" strokeWidth={2.25} />
        )}
      </button>
    </span>
  );
}

export function RecruitmentPanel() {
  const [view, setView] = useState<ViewMode>("tabel");
  const [aanmeldLayout, setAanmeldLayout] = useState<AanmeldLayout>("lijst");
  const [aanmeldPage, setAanmeldPage] = useState(1);
  const [items, setItems] = useState<Sollicitatie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | SollicitatieStatus>("");
  const [functieFilter, setFunctieFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<SollicitatieStatus | null>(null);

  const [sheetNaam, setSheetNaam] = useState("");
  const [sheetEmail, setSheetEmail] = useState("");
  const [sheetTelefoon, setSheetTelefoon] = useState("");
  const [sheetFunctie, setSheetFunctie] = useState("");
  const [sheetStatus, setSheetStatus] = useState<SollicitatieStatus>("nieuw");
  const [sheetNotitie, setSheetNotitie] = useState("");
  const [sheetAppend, setSheetAppend] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [newNaam, setNewNaam] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newTelefoon, setNewTelefoon] = useState("");
  const [newFunctie, setNewFunctie] = useState("");
  const [creating, setCreating] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [belAdvanceKey, setBelAdvanceKey] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deleting, setDeleting] = useState(false);
  const [afspraken, setAfspraken] = useState<SollicitatieAfspraak[]>([]);
  const [trainingen, setTrainingen] = useState<TrainingMoment[]>([]);
  const [beoordelingId, setBeoordelingId] = useState<string | null>(null);
  const [beoordelingNotitie, setBeoordelingNotitie] = useState("");
  const [beoordelingSaving, setBeoordelingSaving] = useState(false);
  const [inboxUnread, setInboxUnread] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/instroom");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      const list = ((data.sollicitaties || []) as Sollicitatie[]).map((s) => ({
        ...s,
        status: normalizeSollicitatieStatus(s.status),
      }));
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAfspraken = useCallback(async () => {
    try {
      const res = await fetch("/api/instroom/afspraken", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setAfspraken((data.afspraken || []) as SollicitatieAfspraak[]);
    } catch {
      /* non-blocking */
    }
  }, []);

  const loadTrainingen = useCallback(async () => {
    try {
      const res = await fetch("/api/instroom/trainingen", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setTrainingen((data.trainingen || []) as TrainingMoment[]);
    } catch {
      /* non-blocking */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadAfspraken();
    void loadTrainingen();
  }, [load, loadAfspraken, loadTrainingen]);

  const loadInboxUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/instroom/inbox?limit=200", {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      if (typeof data.unread_count === "number") {
        setInboxUnread(data.unread_count);
        return;
      }
      const list = (data.mails || []) as Array<{
        status?: string;
        folder?: string;
        fromEmail?: string;
      }>;
      setInboxUnread(
        list.filter(
          (m) =>
            m.status === "nieuw" &&
            m.folder !== "verzonden" &&
            !/@batterijconcept\.nl$/i.test(m.fromEmail || "")
        ).length
      );
    } catch {
      /* non-blocking */
    }
  }, []);

  useEffect(() => {
    if (view === "inbox") return;
    void loadInboxUnread();
    const t = window.setInterval(() => void loadInboxUnread(), 45_000);
    const onFocus = () => void loadInboxUnread();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [view, loadInboxUnread]);

  const trainingById = useMemo(() => {
    const map = new Map<string, TrainingMoment>();
    for (const t of trainingen) map.set(t.id, t);
    return map;
  }, [trainingen]);

  function trainingOf(s: Sollicitatie): TrainingMoment | null {
    const tid = s.training_moment_id;
    if (!tid) return null;
    return trainingById.get(tid) || s.training_moment || null;
  }

  const selected = useMemo(
    () => items.find((s) => s.id === selectedId) || null,
    [items, selectedId]
  );

  useEffect(() => {
    if (!selected) return;
    setSheetNaam(selected.naam || "");
    setSheetEmail(selected.email || "");
    setSheetTelefoon(selected.telefoon || "");
    setSheetFunctie(selected.functie || "");
    setSheetStatus(normalizeSollicitatieStatus(selected.status));
    setSheetNotitie(selected.notitie || "");
    setSheetAppend("");
  }, [selected]);

  const functieOpties = useMemo(() => {
    const set = new Set<string>();
    for (const s of items) {
      const f = (s.functie || "").trim();
      if (f) set.add(f);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "nl"));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const functieQ = functieFilter.trim().toLowerCase();
    return items.filter((s) => {
      const st = normalizeSollicitatieStatus(s.status);
      if (statusFilter && st !== statusFilter) return false;
      if (functieQ) {
        const f = (s.functie || "").trim().toLowerCase();
        if (f !== functieQ) return false;
      }
      if (!q) return true;
      const hay = [
        s.naam,
        s.email,
        s.telefoon,
        s.functie,
        s.notitie,
        plaatsOf(s),
        provincieOf(s),
        SOLLICITATIE_STATUS_LABEL[st],
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [items, search, statusFilter, functieFilter]);

  useEffect(() => {
    setAanmeldPage(1);
  }, [search, statusFilter, functieFilter, aanmeldLayout]);

  const aanmeldPageCount = Math.max(
    1,
    Math.ceil(filtered.length / AANMELDINGEN_PAGE_SIZE)
  );

  useEffect(() => {
    if (aanmeldPage > aanmeldPageCount) setAanmeldPage(aanmeldPageCount);
  }, [aanmeldPage, aanmeldPageCount]);

  const paged = useMemo(() => {
    const start = (aanmeldPage - 1) * AANMELDINGEN_PAGE_SIZE;
    return filtered.slice(start, start + AANMELDINGEN_PAGE_SIZE);
  }, [filtered, aanmeldPage]);

  const byStatus = useMemo(() => {
    const map = new Map<SollicitatieStatus, Sollicitatie[]>();
    for (const st of KANBAN_COLUMNS) map.set(st, []);
    for (const s of filtered) {
      const st = normalizeSollicitatieStatus(s.status);
      const list = map.get(st) || [];
      list.push(s);
      map.set(st, list);
    }
    return map;
  }, [filtered]);

  async function patchKandidaat(
    id: string,
    patch: Partial<Sollicitatie> & {
      notitie_append?: string;
      vervolg_taak?: { titel: string; due_at: string };
    }
  ) {
    setSaving(true);
    setError(null);
    const prev = items;
    setItems((list) =>
      list.map((s) =>
        s.id === id
          ? {
              ...s,
              ...patch,
              status: patch.status
                ? normalizeSollicitatieStatus(patch.status)
                : s.status,
            }
          : s
      )
    );
    try {
      const res = await fetch(`/api/instroom/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      const updated = data.sollicitatie as Sollicitatie;
      setItems((list) =>
        list.map((s) =>
          s.id === id
            ? {
                ...s,
                ...updated,
                status: normalizeSollicitatieStatus(updated.status),
              }
            : s
        )
      );
      if (selectedId === id && updated.notitie != null) {
        setSheetNotitie(updated.notitie || "");
      }
      if (
        selectedId === id &&
        updated.status &&
        normalizeSollicitatieStatus(updated.status) ===
          SOLLICITATIE_STATUS_MET_VERVOLG
      ) {
        setSheetStatus(SOLLICITATIE_STATUS_MET_VERVOLG);
      }
      setOkMsg("Opgeslagen");
      window.setTimeout(() => setOkMsg(null), 1800);
      return updated;
    } catch (e) {
      setItems(prev);
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
      throw e;
    } finally {
      setSaving(false);
    }
  }

  function openBeoordelingDialog(id: string) {
    setBeoordelingId(id);
    setBeoordelingNotitie("");
    setError(null);
  }

  function closeBeoordelingDialog() {
    if (beoordelingSaving) return;
    setBeoordelingId(null);
    setBeoordelingNotitie("");
  }

  async function requestStatusChange(id: string, next: SollicitatieStatus) {
    const item = items.find((s) => s.id === id);
    if (!item) return;
    const current = normalizeSollicitatieStatus(item.status);
    if (next === current) return;
    if (next === SOLLICITATIE_STATUS_MET_VERVOLG) {
      openBeoordelingDialog(id);
      return;
    }
    await patchKandidaat(id, { status: next });
  }

  async function confirmBeoordeling() {
    if (!beoordelingId) return;
    const note = beoordelingNotitie.trim();
    if (!note) {
      setError("Vul een notitie over het gesprek in");
      return;
    }
    setBeoordelingSaving(true);
    try {
      const due = new Date();
      due.setDate(due.getDate() + 3);
      due.setHours(17, 0, 0, 0);
      await patchKandidaat(beoordelingId, {
        status: SOLLICITATIE_STATUS_MET_VERVOLG,
        notitie_append: note,
        vervolg_taak: {
          titel: "Beoordeling afronden",
          due_at: due.toISOString(),
        },
      });
      setBeoordelingId(null);
      setBeoordelingNotitie("");
    } catch {
      /* error state set */
    } finally {
      setBeoordelingSaving(false);
    }
  }

  async function saveSheet() {
    if (!selected) return;
    const wasBeoordeling =
      normalizeSollicitatieStatus(selected.status) ===
      SOLLICITATIE_STATUS_MET_VERVOLG;
    if (
      sheetStatus === SOLLICITATIE_STATUS_MET_VERVOLG &&
      !wasBeoordeling &&
      !sheetAppend.trim()
    ) {
      openBeoordelingDialog(selected.id);
      return;
    }
    try {
      await patchKandidaat(selected.id, {
        naam: sheetNaam.trim() || selected.naam,
        email: sheetEmail.trim() || null,
        telefoon: sheetTelefoon.trim() || null,
        functie: sheetFunctie.trim() || null,
        status: sheetStatus,
        notitie: sheetNotitie,
        ...(sheetAppend.trim()
          ? { notitie_append: sheetAppend.trim() }
          : {}),
      });
      setSheetAppend("");
    } catch {
      /* error state set */
    }
  }

  async function createKandidaat() {
    if (!newNaam.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/instroom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naam: newNaam.trim(),
          email: newEmail.trim() || null,
          telefoon: newTelefoon.trim() || null,
          functie: newFunctie.trim() || null,
          bron: "crm",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Aanmaken mislukt");
      setAddOpen(false);
      setNewNaam("");
      setNewEmail("");
      setNewTelefoon("");
      setNewFunctie("");
      await load();
      if (data.sollicitatie?.id) setSelectedId(data.sollicitatie.id);
      setOkMsg("Kandidaat toegevoegd");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aanmaken mislukt");
    } finally {
      setCreating(false);
    }
  }

  function openDeleteConfirm() {
    setDeleteStep(1);
    setDeleteOpen(true);
  }

  async function deleteSollicitant() {
    if (!selectedId || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/instroom/${encodeURIComponent(selectedId)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      const naam = (data.naam as string) || selected?.naam || "Kandidaat";
      setItems((list) => list.filter((s) => s.id !== selectedId));
      setSelectedId(null);
      setDeleteOpen(false);
      setDeleteStep(1);
      setOkMsg(`${naam} verwijderd`);
      window.setTimeout(() => setOkMsg(null), 2800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    } finally {
      setDeleting(false);
    }
  }

  function openDetail(id: string) {
    setSelectedId(id);
  }

  function onDropStatus(status: SollicitatieStatus) {
    if (!dragId) return;
    const item = items.find((s) => s.id === dragId);
    setDragId(null);
    setOverStatus(null);
    if (!item) return;
    if (normalizeSollicitatieStatus(item.status) === status) return;
    void requestStatusChange(item.id, status).catch(() => {});
  }

  const beoordelingKandidaat = beoordelingId
    ? items.find((s) => s.id === beoordelingId) || null
    : null;

  const stopBtn = (e: ReactMouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest("button, select, a")) e.stopPropagation();
  };

  const showListTools = view === "tabel";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line bg-white">
        <div className="flex items-center gap-2 overflow-x-auto px-3 py-2 sm:px-4">
          <nav
            className="flex min-w-0 flex-1 items-center gap-1"
            aria-label="Recruitment menu"
          >
            {VIEW_NAV.filter((v) => v.group === "werk").map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              const showUnread =
                item.id === "inbox" && inboxUnread > 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition",
                    active
                      ? "bg-green text-white"
                      : "text-ink hover:bg-wash"
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                  {showUnread ? (
                    <span
                      className={cn(
                        "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums leading-none",
                        active
                          ? "bg-white/25 text-white"
                          : "bg-red-600 text-white"
                      )}
                      aria-label={`${inboxUnread} ongelezen`}
                    >
                      {inboxUnread > 99 ? "99+" : inboxUnread}
                    </span>
                  ) : null}
                </button>
              );
            })}
            <span
              className="mx-1 hidden h-6 w-px shrink-0 bg-line sm:block"
              aria-hidden
            />
            {VIEW_NAV.filter((v) => v.group === "beheer").map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition",
                    active
                      ? "bg-green text-white"
                      : "text-muted hover:bg-wash hover:text-ink"
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            onClick={() => setAddOpen(true)}
          >
            <Plus data-icon="inline-start" />
            Nieuw
          </Button>
        </div>

        {showListTools ? (
          <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5 sm:flex-row sm:items-center sm:px-4">
            <div className="relative w-full min-w-0 flex-1 sm:max-w-md">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Zoek naam, telefoon, plaats, functie…"
                className="bg-background pl-8"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                value={functieFilter}
                onChange={(e) => setFunctieFilter(e.target.value)}
                className="min-w-[9rem]"
                aria-label="Filter op functie"
              >
                <NativeSelectOption value="">Alle functies</NativeSelectOption>
                {functieOpties.map((f) => (
                  <NativeSelectOption key={f} value={f}>
                    {f}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as "" | SollicitatieStatus)
                }
                className="min-w-[9rem]"
                aria-label="Filter op status"
              >
                <NativeSelectOption value="">Alle statussen</NativeSelectOption>
                {SOLLICITATIE_STATUSES.map((st) => (
                  <NativeSelectOption key={st} value={st}>
                    {SOLLICITATIE_STATUS_LABEL[st]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {okMsg ? (
        <div className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {okMsg}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        {view === "tabel" ? (
          <div className="flex shrink-0 items-end justify-between gap-3 border-b border-line px-3 py-2.5 sm:px-4">
            <div>
              <p className="text-sm font-semibold text-ink">Aanmeldingen</p>
              <p className="text-[12px] text-muted">
                {filtered.length} kandidaat
                {filtered.length === 1 ? "" : "en"}
                {functieFilter ? ` · ${functieFilter}` : ""}
                {statusFilter
                  ? ` · ${SOLLICITATIE_STATUS_LABEL[statusFilter]}`
                  : ""}
                {search.trim() ? ` · zoek “${search.trim()}”` : ""}
              </p>
            </div>
            <div
              className="inline-flex shrink-0 rounded-lg border border-line bg-wash/60 p-0.5"
              role="group"
              aria-label="Weergave"
            >
              <button
                type="button"
                onClick={() => setAanmeldLayout("lijst")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition",
                  aanmeldLayout === "lijst"
                    ? "bg-white text-ink shadow-sm"
                    : "text-muted hover:text-ink"
                )}
              >
                <Table2 className="size-3.5" aria-hidden />
                Lijst
              </button>
              <button
                type="button"
                onClick={() => setAanmeldLayout("kanban")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition",
                  aanmeldLayout === "kanban"
                    ? "bg-white text-ink shadow-sm"
                    : "text-muted hover:text-ink"
                )}
              >
                <LayoutGrid className="size-3.5" aria-hidden />
                Kanban
              </button>
            </div>
          </div>
        ) : null}

        {view === "kpis" ? (
          <RecruitmentKpisView />
        ) : view === "vacatures" ? (
          <RecruitmentJobsView />
        ) : view === "bellen" ? (
          <RecruitmentBelPanel
            kandidaten={items}
            advanceAfterPlanKey={belAdvanceKey}
            onOpenKandidaat={openDetail}
            onPlanGesprek={(id) => {
              setSelectedId(id);
              void loadAfspraken();
              // Plan-sheet i.p.v. kandidaat-detail — agenda + slots meteen zichtbaar.
              setPlanOpen(true);
            }}
            onKandidaatUpdated={(updated) => {
              const normalized = {
                ...updated,
                status: normalizeSollicitatieStatus(updated.status),
              };
              setItems((list) =>
                list.map((s) => (s.id === normalized.id ? normalized : s))
              );
            }}
          />
        ) : view === "inbox" ? (
          <RecruitmentInboxPanel
            onOpenKandidaat={openDetail}
            onUnreadChange={setInboxUnread}
          />
        ) : view === "trainingen" ? (
          <RecruitmentTrainingenBoard
            kandidaten={items}
            onOpenKandidaat={openDetail}
            onKandidaatUpdated={(updated) => {
              const normalized = {
                ...updated,
                status: normalizeSollicitatieStatus(updated.status),
              };
              setItems((list) =>
                list.map((s) => (s.id === normalized.id ? normalized : s))
              );
              void loadTrainingen();
            }}
          />
        ) : loading ? (
          <p className="px-5 py-10 text-center text-sm text-muted">Laden…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            Geen kandidaten gevonden.
          </p>
        ) : view === "tabel" && aanmeldLayout === "lijst" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Naam</th>
                    <th>Functie</th>
                    <th>Status</th>
                    <th>Provincie</th>
                    <th>Telefoon</th>
                    <th>Binnengekomen</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((s) => {
                    const st = normalizeSollicitatieStatus(s.status);
                    return (
                      <tr
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openDetail(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openDetail(s.id);
                          }
                        }}
                      >
                        <td>
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar size="sm" className="size-8">
                              <AvatarFallback className="text-[11px]">
                                {initials(s.naam)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <span className="block truncate font-medium text-ink">
                                {s.naam}
                              </span>
                              {trainingOf(s) ? (
                                <span className="block truncate text-[11px] text-green-deeper">
                                  Training: {trainingOf(s)!.naam}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="text-muted whitespace-nowrap">
                          {s.functie || "—"}
                        </td>
                        <td onClick={stopBtn}>
                          <SollicitatieStatusSelect
                            status={st}
                            disabled={saving}
                            onChange={(next) =>
                              requestStatusChange(s.id, next)
                            }
                          />
                        </td>
                        <td className="text-muted whitespace-nowrap">
                          {provincieOf(s) || "—"}
                        </td>
                        <td onClick={stopBtn}>
                          <PhoneCopyCell telefoon={s.telefoon} />
                        </td>
                        <td className="text-muted whitespace-nowrap">
                          {formatDateShort(s.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length > 0 ? (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2.5 sm:px-4">
                <p className="text-xs text-muted">
                  {(aanmeldPage - 1) * AANMELDINGEN_PAGE_SIZE + 1}–
                  {Math.min(
                    aanmeldPage * AANMELDINGEN_PAGE_SIZE,
                    filtered.length
                  )}{" "}
                  van {filtered.length}
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={aanmeldPage <= 1}
                    onClick={() => setAanmeldPage((p) => Math.max(1, p - 1))}
                    className="min-h-8 rounded-md border border-line bg-white px-2.5 text-xs font-semibold text-ink hover:bg-wash disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Vorige
                  </button>
                  <span className="px-1 text-xs tabular-nums text-muted">
                    {aanmeldPage} / {aanmeldPageCount}
                  </span>
                  <button
                    type="button"
                    disabled={aanmeldPage >= aanmeldPageCount}
                    onClick={() =>
                      setAanmeldPage((p) =>
                        Math.min(aanmeldPageCount, p + 1)
                      )
                    }
                    className="min-h-8 rounded-md border border-line bg-white px-2.5 text-xs font-semibold text-ink hover:bg-wash disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Volgende
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 gap-0 overflow-x-auto">
            {KANBAN_COLUMNS.map((st) => {
              const col = byStatus.get(st) || [];
              const active = overStatus === st;
              return (
                <div
                  key={st}
                  className={cn(
                    "flex min-h-0 min-w-[12.5rem] flex-1 flex-col border-r border-line bg-wash/30 last:border-r-0",
                    active && "bg-green-soft/40 ring-1 ring-inset ring-green"
                  )}
                  onDragOver={(e: DragEvent) => {
                    e.preventDefault();
                    setOverStatus(st);
                  }}
                  onDragLeave={() => {
                    if (overStatus === st) setOverStatus(null);
                  }}
                  onDrop={(e: DragEvent) => {
                    e.preventDefault();
                    onDropStatus(st);
                  }}
                >
                  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2.5">
                    <span
                      className={cn(
                        "inline-flex max-w-[calc(100%-2rem)] truncate rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                        SOLLICITATIE_STATUS_TONE[st]
                      )}
                    >
                      {SOLLICITATIE_STATUS_LABEL[st]}
                    </span>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {col.length}
                    </Badge>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
                    {col.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        draggable
                        onDragStart={() => setDragId(s.id)}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverStatus(null);
                        }}
                        onClick={() => openDetail(s.id)}
                        className={cn(
                          "rounded-md border border-line bg-white px-2.5 py-2 text-left transition hover:border-green",
                          dragId === s.id && "opacity-50"
                        )}
                      >
                        <p className="truncate text-[13px] font-medium text-ink">
                          {s.naam}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-muted">
                          {[s.functie, provincieOf(s)].filter(Boolean).join(" · ") ||
                            "—"}
                        </p>
                      </button>
                    ))}
                    {col.length === 0 ? (
                      <p className="px-1 py-6 text-center text-[11px] text-muted">
                        Leeg
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Sheet
        open={selectedId != null && !planOpen}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          {selected ? (
            <>
              <SheetHeader className="border-b px-4 py-4 pr-12 text-left">
                <SheetTitle>Kandidaat</SheetTitle>
                <SheetDescription className="sr-only">
                  Detail voor {selected.naam}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-heading text-xl font-semibold tracking-tight">
                      {selected.naam}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {selected.functie || "Geen functie"} ·{" "}
                      {formatDateTimeNl(selected.created_at)}
                    </p>
                  </div>
                  <StatusPill status={sheetStatus} />
                </div>

                <div className="flex flex-wrap gap-2">
                  {selected.telefoon ? (
                    <a
                      href={`tel:${selected.telefoon}`}
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      <Phone data-icon="inline-start" />
                      Bellen
                    </a>
                  ) : null}
                  {selected.email ? (
                    <a
                      href={`mailto:${selected.email}`}
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      <Mail data-icon="inline-start" />
                      Mail
                    </a>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      void loadAfspraken();
                      setPlanOpen(true);
                    }}
                  >
                    <CalendarPlus data-icon="inline-start" />
                    Gesprek plannen
                  </Button>
                </div>

                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="rc-naam" className="text-sm">
                      Naam
                    </Label>
                    <Input
                      id="rc-naam"
                      value={sheetNaam}
                      onChange={(e) => setSheetNaam(e.target.value)}
                      className="h-12 px-3 text-base md:text-base"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="rc-tel" className="text-sm">
                        Telefoon
                      </Label>
                      <Input
                        id="rc-tel"
                        value={sheetTelefoon}
                        onChange={(e) => setSheetTelefoon(e.target.value)}
                        className="h-12 px-3 text-base md:text-base"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rc-mail" className="text-sm">
                        E-mail
                      </Label>
                      <Input
                        id="rc-mail"
                        value={sheetEmail}
                        onChange={(e) => setSheetEmail(e.target.value)}
                        className="h-12 px-3 text-base md:text-base"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rc-functie" className="text-sm">
                      Functie
                    </Label>
                    <Input
                      id="rc-functie"
                      value={sheetFunctie}
                      onChange={(e) => setSheetFunctie(e.target.value)}
                      className="h-12 px-3 text-base md:text-base"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Status</Label>
                    <div>
                      <SollicitatieStatusSelect
                        status={sheetStatus}
                        onChange={(next) => {
                          if (
                            next === SOLLICITATIE_STATUS_MET_VERVOLG &&
                            sheetStatus !== SOLLICITATIE_STATUS_MET_VERVOLG &&
                            selected
                          ) {
                            openBeoordelingDialog(selected.id);
                            return;
                          }
                          setSheetStatus(next);
                        }}
                      />
                    </div>
                  </div>
                  <div className="rounded-lg border bg-wash/40 px-3 py-2 text-xs text-muted-foreground">
                    {[
                      formatSollicitatieAdres(adresOf(selected)) || null,
                      provincieOf(selected) || null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Geen adres bekend"}
                  </div>
                  {trainingOf(selected) ? (
                    <div className="rounded-lg border border-green/40 bg-green-soft/30 px-3 py-2.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-green-deeper">
                        Training
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-ink">
                        {trainingOf(selected)!.naam}
                      </p>
                      <p className="mt-0.5 text-sm text-muted">
                        {formatDateShort(
                          `${trainingOf(selected)!.periode_van.slice(0, 10)}T12:00:00`
                        )}
                        {" – "}
                        {formatDateShort(
                          `${trainingOf(selected)!.periode_tot.slice(0, 10)}T12:00:00`
                        )}
                        {trainingOf(selected)!.adres
                          ? ` · ${trainingOf(selected)!.adres}`
                          : ""}
                      </p>
                      {(trainingOf(selected)!.dagen || []).length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {(trainingOf(selected)!.dagen || [])
                            .slice()
                            .sort((a, b) => a.dag_nummer - b.dag_nummer)
                            .map((d) => (
                              <li
                                key={d.id}
                                className="text-sm text-ink"
                              >
                                Dag {d.dag_nummer}:{" "}
                                {formatDateShort(
                                  `${d.datum.slice(0, 10)}T12:00:00`
                                )}{" "}
                                {(d.start_tijd || "").slice(0, 5)}–
                                {(d.eind_tijd || "").slice(0, 5)}
                              </li>
                            ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <Label htmlFor="rc-notitie" className="text-sm">
                      Notitie
                    </Label>
                    <Textarea
                      id="rc-notitie"
                      rows={6}
                      value={sheetNotitie}
                      onChange={(e) => setSheetNotitie(e.target.value)}
                      className="min-h-36 px-3 py-3 text-base md:text-base"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rc-append" className="text-sm">
                      Notitie toevoegen
                    </Label>
                    <Input
                      id="rc-append"
                      placeholder="Korte update…"
                      value={sheetAppend}
                      onChange={(e) => setSheetAppend(e.target.value)}
                      className="h-12 px-3 text-base md:text-base"
                    />
                  </div>
                </div>
              </div>
              <SheetFooter className="border-t px-4 py-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  title="Sollicitant verwijderen"
                  aria-label="Sollicitant verwijderen"
                  onClick={openDeleteConfirm}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-red-600 transition hover:bg-red-50 hover:text-red-700"
                >
                  <Trash2 className="size-4" strokeWidth={2.25} />
                </button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setSelectedId(null)}
                >
                  Sluiten
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={saving}
                  onClick={() => void saveSheet()}
                >
                  {saving ? "Opslaan…" : "Opslaan"}
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteStep(1);
        }}
      >
        <AlertDialogContent size="default">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteStep === 1
                ? "Sollicitant verwijderen?"
                : "Echt definitief verwijderen?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteStep === 1 ? (
                <>
                  Je staat op het punt{" "}
                  <span className="font-semibold text-ink">
                    {selected?.naam || "deze sollicitant"}
                  </span>{" "}
                  te verwijderen. Dit wist ook afspraken en bestanden.
                </>
              ) : (
                <>
                  Laatste check:{" "}
                  <span className="font-semibold text-ink">
                    {selected?.naam || "deze sollicitant"}
                  </span>{" "}
                  wordt permanent verwijderd. Dit kan niet ongedaan.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuleren</AlertDialogCancel>
            {deleteStep === 1 ? (
              <AlertDialogAction
                type="button"
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={(e) => {
                  e.preventDefault();
                  setDeleteStep(2);
                }}
              >
                Doorgaan
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                type="button"
                className="bg-red-600 text-white hover:bg-red-700"
                disabled={deleting}
                onClick={(e) => {
                  e.preventDefault();
                  void deleteSollicitant();
                }}
              >
                {deleting ? "Verwijderen…" : "Ja, definitief verwijderen"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet
        open={planOpen && selected != null}
        onOpenChange={(open) => {
          if (!open) {
            setPlanOpen(false);
            // Vanuit bellen: sluiten = klaar, geen detail openen.
            if (view === "bellen") setSelectedId(null);
          }
        }}
      >
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl md:max-w-2xl"
        >
          {selected ? (
            <div className="min-w-0 max-w-full overflow-x-hidden px-4 py-4 sm:px-5">
              <RecruitmentPlannenView
                lockedKandidaat={selected}
                afspraken={afspraken}
                onBack={() => {
                  setPlanOpen(false);
                  if (view === "bellen") setSelectedId(null);
                }}
                onCreated={(a, mail) => {
                  setAfspraken((prev) =>
                    [...prev, a].sort(
                      (x, y) =>
                        new Date(x.start_at).getTime() -
                        new Date(y.start_at).getTime()
                    )
                  );
                  setSheetStatus("gesprek_gepland");
                  setItems((list) =>
                    list.map((s) =>
                      s.id === selected.id
                        ? { ...s, status: "gesprek_gepland" }
                        : s
                    )
                  );
                  const mailBit = mail?.mailSent
                    ? " · bevestiging gemaild"
                    : mail?.mailSkipped
                      ? " · geen e-mail (overgeslagen)"
                      : mail?.mailError
                        ? ` · mailfout: ${mail.mailError}`
                        : "";
                  setOkMsg(`Gesprek ingepland${mailBit}`);
                  window.setTimeout(() => setOkMsg(null), 3500);
                  setPlanOpen(false);
                  if (view === "bellen") {
                    setSelectedId(null);
                    // Pas ná inplannen door naar de volgende bel-kandidaat.
                    setBelAdvanceKey((k) => k + 1);
                  }
                  void load();
                }}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-4 py-4 text-left">
            <SheetTitle>Nieuwe kandidaat</SheetTitle>
            <SheetDescription>
              Handmatig toevoegen aan de recruitment-pipeline.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-naam">Naam</Label>
              <Input
                id="new-naam"
                value={newNaam}
                onChange={(e) => setNewNaam(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-tel">Telefoon</Label>
              <Input
                id="new-tel"
                value={newTelefoon}
                onChange={(e) => setNewTelefoon(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-mail">E-mail</Label>
              <Input
                id="new-mail"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-functie">Functie</Label>
              <Input
                id="new-functie"
                value={newFunctie}
                onChange={(e) => setNewFunctie(e.target.value)}
              />
            </div>
          </div>
          <SheetFooter className="border-t px-4 py-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setAddOpen(false)}
            >
              Annuleren
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={creating || !newNaam.trim()}
              onClick={() => void createKandidaat()}
            >
              {creating ? "Bezig…" : "Toevoegen"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog
        open={beoordelingId != null}
        onOpenChange={(open) => {
          if (!open) closeBeoordelingDialog();
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Gespreknotitie</DialogTitle>
            <DialogDescription>
              {beoordelingKandidaat
                ? `Notitie over het gesprek met ${beoordelingKandidaat.naam}. Deze wordt toegevoegd aan het dossier.`
                : "Notitie over het gesprek. Deze wordt toegevoegd aan het dossier."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="rc-beoordeling-notitie">Notitie gesprek *</Label>
            <Textarea
              id="rc-beoordeling-notitie"
              value={beoordelingNotitie}
              onChange={(e) => setBeoordelingNotitie(e.target.value)}
              rows={5}
              autoFocus
              placeholder="Hoe ging het gesprek? Sterke/zwakke punten, indruk, vervolg…"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={beoordelingSaving}
              onClick={closeBeoordelingDialog}
            >
              Annuleren
            </Button>
            <Button
              type="button"
              disabled={beoordelingSaving || !beoordelingNotitie.trim()}
              onClick={() => void confirmBeoordeling()}
            >
              {beoordelingSaving ? "Opslaan…" : "Opslaan & status zetten"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
