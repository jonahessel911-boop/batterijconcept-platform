"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Adviseur, Afspraak, Lead, LeadStatus } from "@/types/database";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { getSupabaseBrowser } from "@/lib/supabase";
import { isAdminAdviseur } from "@/lib/admin-adviseur";
import { normalizeAfspraakSoort } from "@/lib/afspraak-soort";
import {
  gebruikerRolLabel,
  isBelPlanAdviseur,
  isTerugbelPlanbaar,
  normalizeRol,
  type GebruikerRol,
} from "@/lib/rollen";
import { AMSTERDAM_TZ, adresRegel, formatDateTimeNl, formatTimeNl } from "@/lib/format";
import {
  MAX_BELPOGINGEN,
  MAX_BELPOGINGEN_PER_DAG,
  MIN_UREN_TUSSEN_BELPOGINGEN,
  activeBelAfspraak,
  belpogingenOf,
  belpogingenVandaagOf,
  geenContactPogingLabel,
  inBelQueue,
  isTerugbelDue,
  leadInProvincie,
  sortBelQueue,
} from "@/lib/bel-queue";
import {
  NL_PROVINCIES,
  adviseurVoorProvincie,
  provincieVanPostcode,
  type NlProvincie,
} from "@/lib/postcode-provincie";
import { leadStatusLabel } from "@/lib/labels";
import { FastDirectionButton } from "./FastDirectionButton";
import { LeadAdresEditor } from "./LeadAdresEditor";
import { LeadContactEditor } from "./LeadContactEditor";
import { LeadTimeline } from "./LeadTimeline";
import { ReistijdHint } from "./ReistijdHint";
import {
  BestSlotsOptionsList,
  bestSlotsHelpText,
  useBestSlots,
  type BestSlotOption,
} from "./BestSlotsOptions";

function PencilIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
async function clientLogLeadEvent(
  leadId: string,
  opts: {
    soort: string;
    titel: string;
    detail?: string | null;
  }
) {
  try {
    await fetch(`/api/leads/${leadId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
  } catch {
    /* non-blocking */
  }
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function JaNeeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
        <span className="ml-1 font-normal normal-case tracking-normal text-[#C45A12]">
          *
        </span>
      </legend>
      <div className="flex gap-2">
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            className={[
              "min-h-11 flex-1 border px-3 py-2.5 text-sm font-semibold",
              value === v
                ? "border-green bg-green-soft text-green-dark"
                : "border-line bg-white text-ink hover:border-green/50",
            ].join(" ")}
          >
            {v ? "Ja" : "Nee"}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function BelPanel({
  leads,
  afspraken = [],
  adviseurs,
  appointmentLeadIds,
  defaultAdviseurId,
  lockAdviseur = false,
  onLeadUpdated,
  onAfspraakCreated,
  onNeedReload,
}: {
  leads: Lead[];
  afspraken?: Afspraak[];
  adviseurs: Adviseur[];
  appointmentLeadIds: Set<string>;
  defaultAdviseurId?: string;
  /** Adviseur-rol: alleen eigen agenda, geen adviseur-wisselaar. */
  lockAdviseur?: boolean;
  onLeadUpdated: (id: string, patch: Partial<Lead>) => void;
  /** Direct agenda bijwerken na inplannen (zonder te wachten op full reload). */
  onAfspraakCreated?: (afspraak: Afspraak) => void;
  onNeedReload?: () => void | Promise<void>;
}) {
  /** null = bak kiezen; daarna normaal of provincie. */
  const [bakMode, setBakMode] = useState<"normaal" | "provincie" | null>(null);
  const [selectedProvincie, setSelectedProvincie] =
    useState<NlProvincie | null>(null);
  /** Sync bron voor claim-requests (voorkomt stale state / race). */
  const bakFilterRef = useRef<{
    mode: "normaal" | "provincie" | null;
    provincie: NlProvincie | null;
  }>({ mode: null, provincie: null });
  const claimGenRef = useRef(0);
  const [currentId, setCurrentId] = useState<string | null>(null);
  /** Snapshot van geclaimde lead (server is bron van waarheid). */
  const [claimedLead, setClaimedLead] = useState<Lead | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  /** null = Volgende-knop · status = uitkomsten · geen_interesse = subredenen · terugbel */
  const [nextMode, setNextMode] = useState<
    "status" | "geen_interesse" | "terugbel" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [adviseurId, setAdviseurId] = useState(defaultAdviseurId || "");
  const [slots, setSlots] = useState<
    { start_at: string; end_at: string; busy?: boolean }[]
  >([]);
  const [startAt, setStartAt] = useState("");
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [notities, setNotities] = useState("");
  const [partnerAanwezig, setPartnerAanwezig] = useState<boolean | null>(null);
  const [andereOffertes, setAndereOffertes] = useState<boolean | null>(null);
  const [selectedBestSlotId, setSelectedBestSlotId] = useState<string | null>(
    null
  );
  const [showHandmatig, setShowHandmatig] = useState(false);
  const [terugbelAt, setTerugbelAt] = useState("");
  const [terugbelNotitie, setTerugbelNotitie] = useState("");
  const [terugbelWarm, setTerugbelWarm] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  /** Contact/adres bewerken (postcode, huisnr, e-mail, …). */
  const [editingGegevens, setEditingGegevens] = useState(false);
  /** Leads die deze sessie al via Volgende zijn doorgeschoven. */
  const [uitgesteldIds, setUitgesteldIds] = useState(() => new Set<string>());
  const [timelineTick, setTimelineTick] = useState(0);

  const planAdviseurs = useMemo(() => {
    const list = adviseurs.filter(
      (a) => a.actief && !isAdminAdviseur(a) && isBelPlanAdviseur(a)
    );
    if (lockAdviseur && defaultAdviseurId) {
      const self = list.find((a) => a.id === defaultAdviseurId);
      if (self) return [self];
      const raw = adviseurs.find((a) => a.id === defaultAdviseurId);
      return raw ? [raw] : [];
    }
    return list;
  }, [adviseurs, lockAdviseur, defaultAdviseurId]);

  /** Terugbel/warme terugbel: adviseur, callcenter én backoffice. */
  const terugbelMedewerkers = useMemo(() => {
    const list = adviseurs.filter(
      (a) => a.actief && !isAdminAdviseur(a) && isTerugbelPlanbaar(a)
    );
    if (lockAdviseur && defaultAdviseurId) {
      const self = list.find((a) => a.id === defaultAdviseurId);
      if (self) return [self];
      const raw = adviseurs.find((a) => a.id === defaultAdviseurId);
      return raw ? [raw] : [];
    }
    return list.sort((a, b) => {
      const order = (rol: string | null | undefined) => {
        const r = normalizeRol(rol);
        if (r === "beller") return 0;
        if (r === "backoffice") return 1;
        return 2;
      };
      const d = order(a.rol) - order(b.rol);
      if (d !== 0) return d;
      return a.naam.localeCompare(b.naam, "nl");
    });
  }, [adviseurs, lockAdviseur, defaultAdviseurId]);

  const terugbelGroepen = useMemo(() => {
    const groups: { rol: GebruikerRol; label: string; items: Adviseur[] }[] = [
      { rol: "beller", label: "Callcenter", items: [] },
      { rol: "backoffice", label: "Backoffice", items: [] },
      { rol: "admin", label: "Admin", items: [] },
      { rol: "adviseur", label: "Adviseurs", items: [] },
    ];
    for (const a of terugbelMedewerkers) {
      const rol = normalizeRol(a.rol);
      const g = groups.find((x) => x.rol === rol);
      if (g) g.items.push(a);
      else groups[3].items.push(a);
    }
    return groups.filter((g) => g.items.length > 0);
  }, [terugbelMedewerkers]);

  function pickTerugbelAssignee(preferred?: string | null): string {
    if (preferred && terugbelMedewerkers.some((a) => a.id === preferred)) {
      return preferred;
    }
    if (defaultAdviseurId && terugbelMedewerkers.some((a) => a.id === defaultAdviseurId)) {
      return defaultAdviseurId;
    }
    return terugbelMedewerkers[0]?.id || "";
  }

  const allBelQueue = useMemo(
    () => sortBelQueue(leads.filter((l) => inBelQueue(l, appointmentLeadIds))),
    [leads, appointmentLeadIds]
  );

  const provincieCounts = useMemo(() => {
    const map = new Map<NlProvincie, number>();
    for (const p of NL_PROVINCIES) map.set(p, 0);
    for (const l of allBelQueue) {
      for (const p of NL_PROVINCIES) {
        if (leadInProvincie(l, p)) {
          map.set(p, (map.get(p) || 0) + 1);
          break;
        }
      }
    }
    return map;
  }, [allBelQueue]);

  /** Per provincie: adviseur in regio of dichtstbij (via startadres). */
  const provincieAdviseurs = useMemo(() => {
    const map = new Map<
      NlProvincie,
      ReturnType<typeof adviseurVoorProvincie>
    >();
    for (const p of NL_PROVINCIES) {
      map.set(p, adviseurVoorProvincie(p, planAdviseurs));
    }
    return map;
  }, [planAdviseurs]);

  const normalQueue = useMemo(() => {
    if (bakMode === "provincie" && selectedProvincie) {
      return allBelQueue.filter((l) => leadInProvincie(l, selectedProvincie));
    }
    return allBelQueue;
  }, [allBelQueue, bakMode, selectedProvincie]);

  /** Openstaande terugbel-afspraken (vanaf geplande dag tot afgehandeld). */
  const terugbelDue = useMemo(() => {
    const items: { lead: Lead; afspraak: Afspraak; warm: boolean }[] = [];
    for (const a of afspraken) {
      if (!isTerugbelDue(a)) continue;
      const lead = leads.find((l) => l.id === a.lead_id);
      if (!lead?.telefoon?.trim()) continue;
      items.push({
        lead,
        afspraak: a,
        warm: normalizeAfspraakSoort(a.soort) === "warme_bel",
      });
    }
    items.sort((a, b) => {
      if (a.warm !== b.warm) return a.warm ? -1 : 1;
      return (
        new Date(a.afspraak.start_at).getTime() -
        new Date(b.afspraak.start_at).getTime()
      );
    });
    return items;
  }, [afspraken, leads]);

  /**
   * Alleen de normale bellijst. Openstaande terugbel-afspraken staan
   * apart bovenaan (chip → lead), niet in de queue.
   */
  const queue = useMemo(() => {
    const terugbelIds = new Set(terugbelDue.map((t) => t.lead.id));
    return normalQueue.filter(
      (l) => !terugbelIds.has(l.id) && !uitgesteldIds.has(l.id)
    );
  }, [terugbelDue, normalQueue, uitgesteldIds]);

  const current = useMemo(() => {
    if (!currentId) return null;
    return (
      leads.find((l) => l.id === currentId) ||
      queue.find((l) => l.id === currentId) ||
      (claimedLead?.id === currentId ? claimedLead : null)
    );
  }, [leads, queue, currentId, claimedLead]);

  const currentTerugbel = current
    ? activeBelAfspraak(afspraken, current.id)
    : null;
  const currentIsTerugbelDue = Boolean(
    currentTerugbel && isTerugbelDue(currentTerugbel)
  );

  const slotsByDay = useMemo(() => {
    const map = new Map<
      string,
      { start_at: string; end_at: string; busy?: boolean }[]
    >();
    for (const s of slots) {
      const key = formatInTimeZone(s.start_at, AMSTERDAM_TZ, "yyyy-MM-dd");
      const list = map.get(key) || [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [slots]);

  async function releaseClaim(leadId?: string | null) {
    try {
      await fetch("/api/bel/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId || null }),
        keepalive: true,
      });
    } catch {
      /* ignore */
    }
  }

  async function claimNext(
    excludeLeadId?: string | null,
    opts?: {
      provincie?: NlProvincie | null;
      forceNew?: boolean;
      /** Al overgeslagen ids bij provincie-mismatch retry */
      skipIds?: string[];
    }
  ) {
    const gen = ++claimGenRef.current;
    setClaiming(true);
    setClaimError(null);
    try {
      const filter = bakFilterRef.current;
      const provincie =
        opts && "provincie" in opts
          ? opts.provincie || null
          : filter.mode === "provincie"
            ? filter.provincie
            : null;
      const res = await fetch("/api/bel/claim-next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exclude_lead_id: excludeLeadId || null,
          provincie: provincie || null,
          force_new: Boolean(opts?.forceNew),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        lead?: Lead | null;
        error?: string;
      };
      if (gen !== claimGenRef.current) return; // verouderde response
      if (!res.ok) {
        setCurrentId(null);
        setClaimedLead(null);
        setClaimError(data.error || "Claimen mislukt");
        return;
      }
      const lead = data.lead || null;
      if (lead && provincie && !leadInProvincie(lead, provincie)) {
        // Server gaf lead buiten provincie → overslaan en opnieuw
        const skips = [...(opts?.skipIds || []), lead.id];
        if (skips.length <= 8) {
          await releaseClaim(lead.id);
          if (gen !== claimGenRef.current) return;
          await claimNext(lead.id, {
            provincie,
            forceNew: true,
            skipIds: skips,
          });
          return;
        }
        setClaimedLead(null);
        setCurrentId(null);
        setClaimError(
          `Geen passende lead in ${provincie} gevonden (verkeerde provincie gefilterd).`
        );
        return;
      }
      if (lead) {
        setClaimedLead(lead);
        setCurrentId(lead.id);
        onLeadUpdated(lead.id, lead);
      } else {
        setClaimedLead(null);
        setCurrentId(null);
      }
    } catch {
      if (gen !== claimGenRef.current) return;
      setClaimError("Claimen mislukt");
      setCurrentId(null);
      setClaimedLead(null);
    } finally {
      if (gen === claimGenRef.current) setClaiming(false);
    }
  }

  async function startNormaleBak() {
    bakFilterRef.current = { mode: "normaal", provincie: null };
    setBakMode("normaal");
    setSelectedProvincie(null);
    setClaimError(null);
    await releaseClaim();
    await claimNext(null, { provincie: null, forceNew: true });
  }

  async function startProvincieBak(provincie: NlProvincie) {
    bakFilterRef.current = { mode: "provincie", provincie };
    setBakMode("provincie");
    setSelectedProvincie(provincie);
    setClaimError(null);
    setCurrentId(null);
    setClaimedLead(null);
    await releaseClaim();
    await claimNext(null, { provincie, forceNew: true });
  }

  function resetBakKeuze() {
    claimGenRef.current += 1;
    bakFilterRef.current = { mode: null, provincie: null };
    void releaseClaim();
    setBakMode(null);
    setSelectedProvincie(null);
    setCurrentId(null);
    setClaimedLead(null);
    setClaimError(null);
    setClaiming(false);
  }

  // Release claim bij tabblad sluiten / pagina verlaten.
  // Geen auto-claim bij mount — eerst bak kiezen.
  useEffect(() => {
    const onUnload = () => {
      void releaseClaim();
    };
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  // Heartbeat: claim verlengen zolang lead open staat
  useEffect(() => {
    if (!currentId) return;
    const tick = () => {
      void fetch("/api/bel/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: currentId }),
      });
    };
    tick();
    const id = window.setInterval(tick, 2 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [currentId]);

  useEffect(() => {
    if (!current) return;
    setNextMode(null);
    setError(null);
    setCopied(false);
    setStartAt("");
    setCustomStart("");
    setUseCustomTime(false);
    setNotities(current.notities || "");
    setPartnerAanwezig(null);
    setAndereOffertes(null);
    setTerugbelAt("");
    setTerugbelNotitie(current.terugbel_notitie || "");
    setNoteDraft("");
    setSavingNote(false);
    setEditingGegevens(false);
    setSelectedBestSlotId(null);
    setShowHandmatig(false);
    setTimelineTick((t) => t + 1);
    const preferred =
      (lockAdviseur && defaultAdviseurId) ||
      current.adviseur_id ||
      defaultAdviseurId ||
      "";
    const allowed = planAdviseurs.some((a) => a.id === preferred)
      ? preferred
      : planAdviseurs[0]?.id || "";
    setAdviseurId(allowed);
  }, [current?.id, defaultAdviseurId, lockAdviseur, planAdviseurs]);

  const {
    bestSlots,
    bestSlotsLoading,
    bestSlotsLoadingMore,
    bestSlotsError,
    bestSlotsMode,
    bestSlotsLimit,
    loadMeerBestSlots,
  } = useBestSlots({
    lead: current,
    lockAdviseur,
    defaultAdviseurId,
    enabled: Boolean(current?.id),
  });

  useEffect(() => {
    if (!adviseurId) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    queueMicrotask(async () => {
      const res = await fetch(`/api/adviseurs?adviseur_id=${adviseurId}`);
      const data = await res.json();
      if (!cancelled) setSlots(data.blocks || data.slots || []);
    });
    return () => {
      cancelled = true;
    };
  }, [adviseurId]);

  function selectBestSlot(slot: BestSlotOption) {
    if (
      lockAdviseur &&
      defaultAdviseurId &&
      slot.adviseur_id !== defaultAdviseurId
    ) {
      return;
    }
    setSelectedBestSlotId(slot.slot_id);
    setAdviseurId(
      lockAdviseur && defaultAdviseurId
        ? defaultAdviseurId
        : slot.adviseur_id
    );
    setUseCustomTime(false);
    setCustomStart("");
    setStartAt(slot.start_at);
    setShowHandmatig(false);
  }
  function goNextLead(excludeId: string) {
    setUitgesteldIds((prev) => {
      const next = new Set(prev);
      next.add(excludeId);
      return next;
    });
    setNextMode(null);
    void (async () => {
      await releaseClaim(excludeId);
      await claimNext(excludeId);
    })();
  }

  async function completeTerugbelAfspraak(leadId: string) {
    const afspraak = activeBelAfspraak(afspraken, leadId);
    if (!afspraak) return;
    const sb = getSupabaseBrowser();
    await sb
      .from("afspraken")
      .update({ status: "voltooid" })
      .eq("id", afspraak.id);
  }

  /** Terugbel afvinken zonder status te wijzigen — uit prioriteit, terug naar normale regels. */
  async function dismissTerugbel() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await completeTerugbelAfspraak(current.id);
      const patch: Partial<Lead> = {
        terugbellen: false,
        terugbel_notitie: null,
      };
      const sb = getSupabaseBrowser();
      const { error: err } = await sb
        .from("leads")
        .update(patch)
        .eq("id", current.id);
      if (err) throw err;
      onLeadUpdated(current.id, patch);
      onNeedReload?.();
      goNextLead(current.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Afvinken mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function addLeadNotitie() {
    if (!current) return;
    const text = noteDraft.trim();
    if (!text) return;
    setSavingNote(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${current.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort: "notitie",
          titel: "Notitie",
          detail: text,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setNoteDraft("");
      setTimelineTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Notitie opslaan mislukt");
    } finally {
      setSavingNote(false);
    }
  }

  async function copyPhone(nummer: string) {
    const value = nummer.trim();
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

  async function stampGebeldDoor(opts: {
    leadId: string;
    status?: string | null;
    eersteGebeld?: boolean;
  }): Promise<Partial<Lead>> {
    try {
      const res = await fetch("/api/bel/mark-called", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: opts.leadId,
          status: opts.status ?? undefined,
          eerste_gebeld: Boolean(opts.eersteGebeld),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        patch?: Partial<Lead>;
      };
      return data.patch || {};
    } catch {
      return {};
    }
  }

  async function saveOutcome(status: LeadStatus) {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const pogingen =
        status === "geen_contact"
          ? Math.min(belpogingenOf(current) + 1, MAX_BELPOGINGEN)
          : belpogingenOf(current);
      const vandaag =
        status === "geen_contact"
          ? belpogingenVandaagOf(current) + 1
          : belpogingenVandaagOf(current);
      const patch: Partial<Lead> = {
        status,
        belpogingen: pogingen,
        belpogingen_vandaag: Math.min(vandaag, MAX_BELPOGINGEN_PER_DAG),
        terugbellen: false,
        terugbel_notitie: null,
      };
      const sb = getSupabaseBrowser();
      let { error: err } = await sb
        .from("leads")
        .update(patch)
        .eq("id", current.id);
      if (
        err &&
        (err.message?.includes("belpogingen_vandaag") || err.code === "42703")
      ) {
        const { belpogingen_vandaag: _, ...withoutDay } = patch;
        const retry = await sb
          .from("leads")
          .update(withoutDay)
          .eq("id", current.id);
        err = retry.error;
      }
      if (err) {
        if (
          err.message?.includes("belpogingen") ||
          err.message?.includes("laatst_gebeld_at") ||
          err.code === "42703"
        ) {
          throw new Error(
            "Voer eerst supabase/migrate-lead-belpogingen.sql uit in Supabase."
          );
        }
        throw err;
      }
      // Ingelogde medewerker = beller (server-side, geen RLS/claim-issues)
      const stamped = await stampGebeldDoor({
        leadId: current.id,
        status,
        eersteGebeld: !current.eerste_gebeld_at,
      });
      Object.assign(patch, stamped);
      await completeTerugbelAfspraak(current.id);
      onLeadUpdated(current.id, patch);
      void clientLogLeadEvent(current.id, {
        soort: "status",
        titel: `Status → ${leadStatusLabel[status] || status}`,
        detail:
          status === "geen_contact"
            ? `Belpoging ${pogingen}/${MAX_BELPOGINGEN}`
            : null,
      });
      if (
        status === "geen_contact" &&
        (pogingen === 1 || pogingen === 3) &&
        current.email?.trim()
      ) {
        void fetch(`/api/leads/${current.id}/geen-contact-mail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ poging: pogingen }),
        }).catch(() => {
          /* non-blocking */
        });
      }
      if (status === "foutief_nummer" && current.email?.trim()) {
        void fetch(`/api/leads/${current.id}/foutief-nummer-mail`, {
          method: "POST",
        }).catch(() => {
          /* non-blocking */
        });
      }
      const { fireMetaCapiSync } = await import("@/lib/meta-capi-client");
      fireMetaCapiSync(current.id);
      onNeedReload?.();
      goNextLead(current.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function plan(e: React.FormEvent) {
    e.preventDefault();
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      let resolvedStart = startAt;
      if (useCustomTime) {
        if (!customStart) throw new Error("Kies een tijdstip");
        const parsed = new Date(customStart);
        if (Number.isNaN(parsed.getTime())) throw new Error("Ongeldig tijdstip");
        resolvedStart = parsed.toISOString();
      }
      if (!resolvedStart) throw new Error("Kies een tijdslot");
      const planAdviseurId =
        lockAdviseur && defaultAdviseurId ? defaultAdviseurId : adviseurId;
      if (!planAdviseurId) throw new Error("Kies een adviseur");
      if (partnerAanwezig === null) {
        throw new Error("Beantwoord: Partner aanwezig?");
      }
      if (andereOffertes === null) {
        throw new Error("Beantwoord: Andere offertes al gehad?");
      }

      const res = await fetch("/api/afspraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: current.id,
          adviseur_id: planAdviseurId,
          start_at: resolvedStart,
          notities: notities || undefined,
          soort: "nieuw",
          partner_aanwezig: partnerAanwezig,
          andere_offertes_gehad: andereOffertes,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        afspraak?: Afspraak;
      };
      if (!res.ok) throw new Error(data.error || "Inplannen mislukt");

      const leadPatch: Partial<Lead> = {
        status: "afspraak",
        ...(await stampGebeldDoor({
          leadId: current.id,
          status: "afspraak",
          eersteGebeld: !current.eerste_gebeld_at,
        })),
      };

      if (data.afspraak) {
        onAfspraakCreated?.(data.afspraak);
      }
      onLeadUpdated(current.id, leadPatch);
      await completeTerugbelAfspraak(current.id);
      // Full reload op de achtergrond (joins); agenda heeft de afspraak al
      void onNeedReload?.();
      goNextLead(current.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  async function planTerugbel(e: React.FormEvent) {
    e.preventDefault();
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      if (!terugbelAt) throw new Error("Kies datum en tijd");
      const planAdviseurId = pickTerugbelAssignee(
        lockAdviseur && defaultAdviseurId ? defaultAdviseurId : adviseurId
      );
      if (!planAdviseurId) throw new Error("Kies een medewerker");
      const note = terugbelNotitie.trim();
      if (!note) throw new Error("Vul een notitie in");

      // Amsterdam-lokale string → server parseert correct (geen browser-Date-offset)
      const res = await fetch("/api/afspraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: current.id,
          adviseur_id: planAdviseurId,
          start_at: terugbelAt,
          notities: note,
          soort: terugbelWarm ? "warme_bel" : "bel",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Terugbel-afspraak mislukt"
        );
      }

      const assignee = terugbelMedewerkers.find((a) => a.id === planAdviseurId);
      const assigneeRol = normalizeRol(assignee?.rol);
      const leadPatch: Partial<Lead> = {
        terugbellen: true,
        terugbel_notitie: note,
        ...(await stampGebeldDoor({
          leadId: current.id,
          eersteGebeld: !current.eerste_gebeld_at,
        })),
      };
      if (assigneeRol === "beller") {
        leadPatch.beller_id = planAdviseurId;
        const sb = getSupabaseBrowser();
        await sb
          .from("leads")
          .update({
            terugbellen: true,
            terugbel_notitie: note,
            beller_id: planAdviseurId,
          })
          .eq("id", current.id);
      } else {
        const sb = getSupabaseBrowser();
        await sb
          .from("leads")
          .update({ terugbellen: true, terugbel_notitie: note })
          .eq("id", current.id);
      }

      onLeadUpdated(current.id, leadPatch);
      void clientLogLeadEvent(current.id, {
        soort: "terugbel",
        titel: terugbelWarm
          ? "Warme terugbelafspraak gepland"
          : "Terugbelafspraak gepland",
        detail: `${note} · ${terugbelAt.replace("T", " ")}`,
      });
      onNeedReload?.();
      goNextLead(current.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  // Stap 1: kies belbak
  if (bakMode === null) {
    return (
      <div className="px-6 py-10 sm:px-8">
        <div className="mx-auto max-w-xl text-center">
          <p className="font-display text-xl font-semibold text-ink">
            Welke belbak?
          </p>
          <p className="mt-2 text-sm text-muted">
            Kies de normale wachtrij of bel alleen leads uit één provincie.
          </p>
        </div>
        <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void startNormaleBak()}
            className="rounded-xl border border-line bg-white px-5 py-5 text-left transition hover:border-green/50 hover:bg-green-soft/40"
          >
            <p className="font-display text-base font-semibold text-ink">
              Normale belbak
            </p>
            <p className="mt-1 text-sm text-muted">
              Alle belbare leads in de standaard volgorde.
            </p>
            <p className="mt-3 text-xs font-semibold text-green-dark">
              {allBelQueue.length} in de wachtrij
            </p>
          </button>
          <button
            type="button"
            onClick={() => {
              setBakMode("provincie");
              setSelectedProvincie(null);
              setClaimError(null);
            }}
            className="rounded-xl border border-line bg-white px-5 py-5 text-left transition hover:border-green/50 hover:bg-green-soft/40"
          >
            <p className="font-display text-base font-semibold text-ink">
              Provincie belbak
            </p>
            <p className="mt-1 text-sm text-muted">
              Alleen leads uit een gekozen provincie, zelfde belvolgorde.
            </p>
            <p className="mt-3 text-xs font-semibold text-green-dark">
              Kies daarna een provincie →
            </p>
          </button>
        </div>
      </div>
    );
  }

  // Stap 2 (provincie): kies provincie
  if (bakMode === "provincie" && !selectedProvincie) {
    return (
      <div className="px-6 py-10 sm:px-8">
        <div className="mx-auto max-w-2xl">
          <button
            type="button"
            onClick={resetBakKeuze}
            className="text-sm font-medium text-green-dark hover:underline"
          >
            ← Andere belbak
          </button>
          <p className="mt-3 font-display text-xl font-semibold text-ink">
            Kies een provincie
          </p>
          <p className="mt-1 text-sm text-muted">
            Je krijgt alleen leads met een postcode in die provincie.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {NL_PROVINCIES.map((p) => {
              const n = provincieCounts.get(p) || 0;
              const adv = provincieAdviseurs.get(p);
              return (
                <button
                  key={p}
                  type="button"
                  disabled={n === 0}
                  onClick={() => void startProvincieBak(p)}
                  title={
                    adv
                      ? adv.inRegio
                        ? `Adviseur in regio: ${adv.naam}`
                        : `Dichtstbij (startadres): ${adv.naam}${
                            adv.startProvincie
                              ? ` · ${adv.startProvincie}`
                              : ""
                          }`
                      : undefined
                  }
                  className={[
                    "group rounded-xl border px-4 py-3 text-left transition",
                    n === 0
                      ? "cursor-not-allowed border-line/60 bg-[#F7F8F7] text-muted opacity-60"
                      : "border-line bg-white hover:border-green/50 hover:bg-green-soft/40",
                  ].join(" ")}
                >
                  <p className="text-sm font-semibold text-ink">{p}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {n === 0 ? "Geen leads" : `${n} in de wachtrij`}
                  </p>
                  {adv && n > 0 ? (
                    <p className="mt-1.5 max-h-0 overflow-hidden text-[11px] leading-snug text-green-dark opacity-0 transition-all duration-150 group-hover:max-h-10 group-hover:opacity-100 group-focus-visible:max-h-10 group-focus-visible:opacity-100">
                      {adv.inRegio ? (
                        <>
                          Adviseur ·{" "}
                          <span className="font-semibold">{adv.naam}</span>
                        </>
                      ) : (
                        <>
                          Dichtstbij ·{" "}
                          <span className="font-semibold">{adv.naam}</span>
                          {adv.startProvincie
                            ? ` (${adv.startProvincie})`
                            : ""}
                        </>
                      )}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (claiming && !current) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-sm text-muted">Volgende lead ophalen…</p>
      </div>
    );
  }

  if (claimError && !current) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="font-display text-lg font-semibold text-ink">
          Bel-claim mislukt
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[#C45A12]">
          {claimError}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => void claimNext()}
            className="border border-green bg-green px-4 py-2 text-sm font-semibold text-white"
          >
            Opnieuw proberen
          </button>
          <button
            type="button"
            onClick={resetBakKeuze}
            className="border border-line bg-white px-4 py-2 text-sm font-semibold text-ink"
          >
            Andere belbak
          </button>
        </div>
      </div>
    );
  }

  if (!current && queue.length === 0 && terugbelDue.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="font-display text-lg font-semibold text-ink">
          {bakMode === "provincie" && selectedProvincie
            ? `Geen leads in ${selectedProvincie}`
            : "Bellijst is leeg"}
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          {bakMode === "provincie" && selectedProvincie
            ? "In deze provincie staan nu geen belbare leads. Kies een andere provincie of de normale belbak."
            : `Alleen leads zonder afspraak, deal of “geen interesse” staan hier. Max ${MAX_BELPOGINGEN_PER_DAG} belpogingen per lead per dag, met min. ${MIN_UREN_TUSSEN_BELPOGINGEN} uur ertussen — daarna komen ze later terug. Na ${MAX_BELPOGINGEN} keer geen contact vallen ze eruit.`}
        </p>
        <button
          type="button"
          onClick={resetBakKeuze}
          className="mt-4 border border-green bg-green px-4 py-2 text-sm font-semibold text-white"
        >
          Andere belbak
        </button>
      </div>
    );
  }

  const terugbelBanner =
    terugbelDue.length > 0 ? (
      <div className="border-b border-[#C45A12]/25 bg-[#FFF8F3] px-4 py-2.5 sm:px-5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C45A12]">
          Terugbellen ({terugbelDue.length}) — bovenaan tot afgevinkt
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {terugbelDue.map(({ lead, afspraak, warm }) => (
            <Link
              key={afspraak.id}
              href={`/leads/${lead.id}`}
              className={[
                "inline-flex max-w-full items-center gap-2 border px-2.5 py-1 text-left text-xs transition",
                warm
                  ? "border-[#C9A227]/50 bg-[#FFF8D6] text-[#8A6D00] hover:border-[#C9A227]"
                  : "border-[#C45A12]/35 bg-white text-ink hover:border-[#C45A12]",
              ].join(" ")}
            >
              <span
                className={[
                  "shrink-0 font-bold tabular-nums",
                  warm ? "text-[#8A6D00]" : "text-[#C45A12]",
                ].join(" ")}
              >
                {formatTimeNl(afspraak.start_at)}
              </span>
              <span className="truncate font-medium">
                {warm ? "★ " : ""}
                {lead.naam}
              </span>
            </Link>
          ))}
        </div>
      </div>
    ) : null;

  if (!current) {
    return (
      <div>
        {terugbelBanner}
        <div className="px-6 py-14 text-center">
          <p className="font-display text-lg font-semibold text-ink">
            {queue.length > 0
              ? "Geen vrije lead"
              : "Geen leads in de bellijst"}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            {queue.length > 0
              ? "Andere bellers hebben de openstaande leads nu vast. Klik op opnieuw om de volgende vrije te pakken."
              : bakMode === "provincie" && selectedProvincie
                ? `Geen belbare leads meer in ${selectedProvincie}. Wissel van belbak of kies een andere provincie.`
                : "Openstaande terugbel-afspraken staan hierboven — klik om naar de lead te gaan."}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {queue.length > 0 ? (
              <button
                type="button"
                onClick={() => void claimNext()}
                className="border border-green bg-green px-4 py-2 text-sm font-semibold text-white"
              >
                Opnieuw proberen
              </button>
            ) : null}
            <button
              type="button"
              onClick={resetBakKeuze}
              className="border border-line bg-white px-4 py-2 text-sm font-semibold text-ink"
            >
              Andere belbak
            </button>
          </div>
        </div>
      </div>
    );
  }

  const pogingen = belpogingenOf(current);
  const pogingenVandaag = belpogingenVandaagOf(current);
  const nextPoging = Math.min(pogingen + 1, MAX_BELPOGINGEN);
  const phone = current.telefoon!.trim();
  const position = queue.findIndex((l) => l.id === current.id) + 1;

  return (
    <div>
      {terugbelBanner}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-[#F7FBF8] px-4 py-2 sm:px-5">
        <p className="text-xs text-muted">
          <span className="font-semibold text-ink">
            {bakMode === "provincie" && selectedProvincie
              ? `Provincie belbak · ${selectedProvincie}`
              : "Normale belbak"}
          </span>
          <span className="ml-1.5">
            · {queue.length} in deze wachtrij
          </span>
        </p>
        <button
          type="button"
          onClick={resetBakKeuze}
          className="text-xs font-semibold text-green-dark hover:underline"
        >
          Wissel belbak
        </button>
      </div>

      <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
      <section className="border-b border-line p-4 sm:p-6 lg:border-b-0 lg:border-r">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {`${position > 0 ? position : "—"} van ${queue.length} in de bellijst`}
          <span className="ml-2 font-normal normal-case tracking-normal">
            · van jou (andere bellers krijgen de volgende)
          </span>
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {current.status === "geen_contact" || pogingen > 0 ? (
            <span className="rounded-full border border-[#C45A12]/30 bg-[#FFF0E6] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#C45A12]">
              {geenContactPogingLabel(pogingen)}
            </span>
          ) : (
            <span className="rounded-full bg-green-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-green-dark">
              Nieuw
            </span>
          )}
          {current.terugbellen && (
            <span className="rounded-full border border-[#C45A12]/30 bg-[#FFF0E6] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#C45A12]">
              Terugbellen
            </span>
          )}
          <span className="rounded-full border border-line bg-wash px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">
            Vandaag {pogingenVandaag}/{MAX_BELPOGINGEN_PER_DAG}
          </span>
        </div>

        <h2 className="mt-3 font-display text-2xl font-semibold text-ink sm:text-3xl">
          {current.naam}
        </h2>
        <p className="font-mono text-xs text-muted">{current.lead_number}</p>
        <p className="mt-1 text-sm text-muted">
          Aangemeld {formatDateTimeNl(current.created_at)}
        </p>

        {editingGegevens ? (
          <div className="mt-3 space-y-4 border border-line bg-wash/40 p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Contactgegevens bewerken
              </p>
              <button
                type="button"
                onClick={() => setEditingGegevens(false)}
                className="border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
              >
                Klaar
              </button>
            </div>
            <LeadContactEditor
              lead={current}
              onSaved={(patch) => {
                onLeadUpdated(current.id, patch);
                setClaimedLead((prev) =>
                  prev?.id === current.id ? { ...prev, ...patch } : prev
                );
              }}
            />
            <LeadAdresEditor
              lead={current}
              onSaved={(patch) => {
                onLeadUpdated(current.id, patch);
                setClaimedLead((prev) =>
                  prev?.id === current.id ? { ...prev, ...patch } : prev
                );
              }}
            />
          </div>
        ) : (
          <div className="relative mt-3 border border-line bg-white px-3.5 py-3 pr-12">
            <p className="text-sm text-ink">{adresRegel(current) || "Geen adres"}</p>
            {bakMode === "provincie" && selectedProvincie ? (
              <p className="mt-1 text-xs text-muted">
                Provincie lead:{" "}
                <span className="font-semibold text-ink">
                  {provincieVanPostcode(current.postcode)}
                </span>
                {leadInProvincie(current, selectedProvincie) ? null : (
                  <span className="ml-1 font-semibold text-[#C45A12]">
                    · hoort niet bij {selectedProvincie}
                  </span>
                )}
              </p>
            ) : null}
            <p className="mt-1 text-sm text-muted">
              {current.email?.trim() || "Geen e-mail"}
            </p>
            <button
              type="button"
              onClick={() => setEditingGegevens(true)}
              className="absolute right-2.5 top-2.5 inline-flex items-center justify-center border border-line bg-white p-1.5 text-ink hover:bg-wash"
              title="Contactgegevens bewerken"
              aria-label="Contactgegevens bewerken"
            >
              <PencilIcon />
            </button>
          </div>
        )}

        {currentIsTerugbelDue && currentTerugbel && (
          <div className="mt-3 border border-[#C45A12]/30 bg-[#FFF0E6] px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C45A12]">
              Gepland terugbelmoment · {formatDateTimeNl(currentTerugbel.start_at)}
            </p>
            {(currentTerugbel.notities || current.terugbel_notitie)?.trim() ? (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {currentTerugbel.notities || current.terugbel_notitie}
              </p>
            ) : null}
          </div>
        )}
        {!currentIsTerugbelDue && current.terugbel_notitie?.trim() && (
          <div className="mt-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C45A12]">
              Terugbelnotitie
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {current.terugbel_notitie}
            </p>
          </div>
        )}
        <div className="mt-4 rounded-xl bg-wash px-3.5 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Notitie toevoegen
          </p>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={3}
            placeholder="Schrijf een notitie…"
            className="mt-2 w-full border border-line bg-white px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-green"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={savingNote || !noteDraft.trim()}
              onClick={() => void addLeadNotitie()}
              className="bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
            >
              {savingNote ? "Opslaan…" : "Notitie toevoegen"}
            </button>
          </div>
          {current.notities?.trim() && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Intake / vaste info
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {current.notities}
              </p>
            </div>
          )}
        </div>

        <a
          href={`tel:${phone.replace(/[\s().-]/g, "")}`}
          className="mt-5 block font-mono text-lg font-semibold tabular-nums text-ink underline-offset-2 hover:text-green-dark hover:underline"
        >
          {phone}
        </a>
        <button
          type="button"
          onClick={() => void copyPhone(phone)}
          className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 border border-green bg-white px-4 text-sm font-semibold text-green-dark hover:bg-green-soft"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Gekopieerd" : "Copy phone"}
        </button>

        <div className="mt-6 border-t border-line pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Activiteit
          </p>
          <div className="mt-2 max-h-72 overflow-y-auto border border-line bg-wash/40 px-3 py-3">
            <LeadTimeline leadId={current.id} refreshKey={timelineTick} />
          </div>
        </div>
      </section>

      <aside className="flex flex-col bg-wash/40 p-4 sm:p-5">
        <div className="lg:sticky lg:top-0">
          {!nextMode ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setNextMode("status");
                setError(null);
              }}
              className="flex min-h-12 w-full items-center justify-center bg-orange px-4 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60 sm:min-h-14 sm:text-base"
            >
              Volgende
            </button>
          ) : nextMode === "status" ? (
            <div className="space-y-2 rounded-2xl border border-line bg-white p-4">
              <p className="text-sm font-semibold text-ink">Kies de status</p>
              <p className="text-xs text-muted">
                Daarna komt de volgende lead in de bellijst.
              </p>
              {currentIsTerugbelDue && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void dismissTerugbel()}
                  className="flex min-h-12 w-full items-center justify-center border border-[#C45A12] bg-[#FFF0E6] px-4 text-sm font-semibold text-[#C45A12] hover:bg-[#FFE4D4] disabled:opacity-60"
                >
                  Terugbel afgevinkt
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveOutcome("geen_contact")}
                className="flex min-h-12 w-full items-center justify-center bg-orange px-4 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
              >
                {geenContactPogingLabel(nextPoging)}
                {nextPoging >= MAX_BELPOGINGEN ? " — uit bellijst" : ""}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveOutcome("foutief_nummer")}
                className="flex min-h-11 w-full items-center justify-center border border-line px-4 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-60"
              >
                Foutief nummer
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveOutcome("gegevens_niet_overeen")}
                className="flex min-h-11 w-full items-center justify-center border border-line px-4 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-60"
              >
                Gegevens komen niet overeen
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setNextMode("geen_interesse");
                  setError(null);
                }}
                className="flex min-h-11 w-full items-center justify-center border border-line px-4 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-60"
              >
                Geen interesse
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAdviseurId(pickTerugbelAssignee(adviseurId));
                  setNextMode("terugbel");
                  setTerugbelWarm(false);
                  setError(null);
                }}
                className="flex min-h-12 w-full items-center justify-center border border-[#C45A12]/40 bg-[#FFF0E6] px-4 text-sm font-semibold text-[#C45A12] hover:bg-[#FFE4D4] disabled:opacity-60"
              >
                {currentIsTerugbelDue
                  ? "Nieuwe terugbelafspraak"
                  : "Terugbelafspraak"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAdviseurId(pickTerugbelAssignee(adviseurId));
                  setNextMode("terugbel");
                  setTerugbelWarm(true);
                  setError(null);
                }}
                className="flex min-h-12 w-full items-center justify-center border border-[#C9A227]/50 bg-[#FFF8D6] px-4 text-sm font-semibold text-[#8A6D00] hover:bg-[#fff0b8] disabled:opacity-60"
              >
                Warme terugbelafspraak
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setNextMode(null)}
                className="flex min-h-10 w-full items-center justify-center text-sm font-medium text-muted hover:text-ink"
              >
                Terug
              </button>
            </div>
          ) : nextMode === "geen_interesse" ? (
            <div className="space-y-2 rounded-2xl border border-line bg-white p-4">
              <p className="text-sm font-semibold text-ink">Geen interesse</p>
              <p className="text-xs text-muted">Kies de reden · lead verdwijnt uit de bellijst.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveOutcome("geen_interesse_al_batterij")}
                className="flex min-h-11 w-full items-center justify-center border border-line px-4 text-left text-sm font-semibold text-ink hover:bg-wash disabled:opacity-60"
              >
                Heeft al een batterij
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveOutcome("geen_interesse_plugin")}
                className="flex min-h-11 w-full items-center justify-center border border-line px-4 text-left text-sm font-semibold text-ink hover:bg-wash disabled:opacity-60"
              >
                Interesse in een plugin batterij
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveOutcome("geen_interesse_alleen_info")}
                className="flex min-h-11 w-full items-center justify-center border border-line px-4 text-left text-sm font-semibold text-ink hover:bg-wash disabled:opacity-60"
              >
                Wilde alleen informatie
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveOutcome("geen_interesse")}
                className="flex min-h-11 w-full items-center justify-center border border-line px-4 text-left text-sm font-semibold text-ink hover:bg-wash disabled:opacity-60"
              >
                Overig
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setNextMode("status")}
                className="flex min-h-10 w-full items-center justify-center text-sm font-medium text-muted hover:text-ink"
              >
                Terug
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => void planTerugbel(e)}
              className="space-y-3 rounded-2xl border border-line bg-white p-4"
            >
              <p className="text-sm font-semibold text-ink">
                {terugbelWarm ? "Warme terugbelafspraak" : "Terugbel afspraak"}
              </p>
              <p className="text-xs text-muted">
                {terugbelWarm
                  ? "Prioriteit in de bellijst — bijv. klant pakt agenda erbij maar wil al een afspraak. Intern, geen mail."
                  : "Alleen intern — de klant krijgt geen mail. De lead verdwijnt uit de belwachtrij; vanaf de geplande dag staat er bovenaan een chip (klik → lead) tot je afvinkt."}
              </p>
              {lockAdviseur ? (
                <p className="text-xs text-muted">
                  Agenda:{" "}
                  <span className="font-semibold text-ink">
                    {terugbelMedewerkers.find((a) => a.id === adviseurId)
                      ?.naam || "Jij"}
                  </span>
                </p>
              ) : (
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                  Toewijzen aan
                  <select
                    required
                    value={adviseurId}
                    onChange={(e) => setAdviseurId(e.target.value)}
                    className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
                  >
                    <option value="">Kies medewerker…</option>
                    {terugbelGroepen.map((g) => (
                      <optgroup key={g.rol} label={g.label}>
                        {g.items.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.naam}
                            {g.rol !== "adviseur"
                              ? ` (${gebruikerRolLabel[g.rol]})`
                              : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                Datum &amp; tijd
                <input
                  type="datetime-local"
                  required
                  value={terugbelAt}
                  onChange={(e) => setTerugbelAt(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
                />
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                Notitie
                <textarea
                  required
                  value={terugbelNotitie}
                  onChange={(e) => setTerugbelNotitie(e.target.value)}
                  rows={3}
                  placeholder="Bijv. bel terug over offerte, bereikbaar na 17:00…"
                  className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !adviseurId || !terugbelAt || !terugbelNotitie.trim()}
                className="flex min-h-12 w-full items-center justify-center bg-[#C45A12] px-4 text-sm font-semibold text-white hover:bg-[#a84a0e] disabled:opacity-60"
              >
                {busy
                  ? "Bezig…"
                  : terugbelWarm
                    ? "Warme terugbel opslaan"
                    : "Terugbel afspraak opslaan"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setNextMode("status")}
                className="flex min-h-10 w-full items-center justify-center text-sm font-medium text-muted hover:text-ink"
              >
                Terug
              </button>
            </form>
          )}

          {error && (
            <p className="mt-3 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              {error}
            </p>
          )}

          <form
            onSubmit={(e) => void plan(e)}
            className="mt-4 space-y-3 rounded-2xl border border-line bg-white p-5"
          >
            <p className="font-display text-base font-semibold text-ink">
              Direct inplannen
            </p>
            <p className="text-xs text-muted">
              {bestSlotsHelpText({ lockAdviseur, limit: bestSlotsLimit })}
            </p>

            <BestSlotsOptionsList
              slots={bestSlots}
              selectedSlotId={selectedBestSlotId}
              onSelect={selectBestSlot}
              loading={bestSlotsLoading}
              error={bestSlotsError}
              mode={bestSlotsMode}
              limit={bestSlotsLimit}
              loadingMore={bestSlotsLoadingMore}
              onLoadMore={() => void loadMeerBestSlots()}
              lockAdviseur={lockAdviseur}
            />

            <button
              type="button"
              onClick={() => setShowHandmatig((v) => !v)}
              className="text-xs font-medium text-green hover:underline"
            >
              {showHandmatig
                ? "Handmatig verbergen"
                : lockAdviseur
                  ? "Handmatig tijdstip…"
                  : "Handmatig adviseur + tijd kiezen…"}
            </button>

            {showHandmatig ? (
              <>
            {lockAdviseur ? (
              <p className="text-xs text-muted">
                Agenda:{" "}
                <span className="font-semibold text-ink">
                  {planAdviseurs.find((a) => a.id === adviseurId)?.naam ||
                    "Jij"}
                </span>
              </p>
            ) : (
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Adviseur
              <select
                required
                value={adviseurId}
                onChange={(e) => {
                  setAdviseurId(e.target.value);
                  setStartAt("");
                  setCustomStart("");
                  setSelectedBestSlotId(null);
                }}
                className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
              >
                <option value="">Kies adviseur…</option>
                {planAdviseurs.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.naam}
                    </option>
                  ))}
              </select>
            </label>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Tijdstip
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setUseCustomTime((v) => !v);
                    setStartAt("");
                    setCustomStart("");
                    setSelectedBestSlotId(null);
                  }}
                  className="text-xs font-medium text-green hover:underline"
                >
                  {useCustomTime ? "Kies vast slot" : "Ander tijdstip…"}
                </button>
              </div>
              {useCustomTime ? (
                <input
                  type="datetime-local"
                  required
                  value={customStart}
                  onChange={(e) => {
                    setCustomStart(e.target.value);
                    setSelectedBestSlotId(null);
                  }}
                  className="w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
                />
              ) : !adviseurId ? (
                <p className="text-sm text-muted">Kies eerst een adviseur.</p>
              ) : slotsByDay.length === 0 ? (
                <p className="text-sm text-muted">Geen slots.</p>
              ) : (
                <div className="max-h-64 space-y-3 overflow-y-auto pr-0.5">
                  <p className="text-[11px] text-muted">
                    Groen = vrij · rood = al ingepland · 2 uur afspraak, 1 uur
                    reistijd ertussen
                  </p>
                  {slotsByDay.map(([day, daySlots]) => (
                    <div key={day}>
                      <p className="mb-1.5 text-[11px] font-semibold capitalize text-muted">
                        {formatInTimeZone(
                          daySlots[0].start_at,
                          AMSTERDAM_TZ,
                          "EEE d MMM",
                          { locale: nl }
                        )}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {daySlots.map((s) => {
                          const taken = Boolean(s.busy);
                          const selected = !taken && startAt === s.start_at;
                          return (
                            <button
                              key={s.start_at}
                              type="button"
                              disabled={taken}
                              onClick={() => {
                                setStartAt(s.start_at);
                                setSelectedBestSlotId(null);
                              }}
                              className={[
                                "min-h-9 min-w-[3.5rem] border px-2.5 py-1.5 text-sm font-semibold tabular-nums disabled:cursor-not-allowed",
                                taken
                                  ? "border-[#C62828]/40 bg-[#FDECEA] text-[#C62828]"
                                  : selected
                                    ? "border-green bg-green text-white"
                                    : "border-green/40 bg-green-soft text-green-dark hover:border-green",
                              ].join(" ")}
                            >
                              {formatTimeNl(s.start_at)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {adviseurId && !useCustomTime && (
              <FastDirectionButton
                key={`${current.id}-${adviseurId}`}
                adviseurId={adviseurId}
                lead={current}
                afspraken={afspraken}
                allLeads={leads}
                startAdres={
                  planAdviseurs.find((a) => a.id === adviseurId)?.start_adres ||
                  null
                }
                startAdresLabel={
                  planAdviseurs.find((a) => a.id === adviseurId)?.naam || null
                }
                freeSlots={slots
                  .filter((s) => !s.busy)
                  .map((s) => ({
                    start_at: s.start_at,
                    end_at: s.end_at,
                  }))}
                onSelectSlot={(iso) => {
                  setUseCustomTime(false);
                  setCustomStart("");
                  setStartAt(iso);
                  setSelectedBestSlotId(null);
                }}
              />
            )}
            <ReistijdHint
              adviseurId={adviseurId}
              startAt={useCustomTime ? customStart : startAt}
              lead={current}
              afspraken={afspraken}
              allLeads={leads}
              startAdres={
                planAdviseurs.find((a) => a.id === adviseurId)?.start_adres ||
                null
              }
              startAdresLabel={
                planAdviseurs.find((a) => a.id === adviseurId)?.naam || null
              }
            />
              </>
            ) : selectedBestSlotId && startAt ? (
              <p className="text-xs text-muted">
                Gekozen:{" "}
                <span className="font-medium text-ink">
                  {bestSlots.find((s) => s.slot_id === selectedBestSlotId)
                    ?.label_kort || formatDateTimeNl(startAt)}
                </span>
                {" · "}
                {
                  bestSlots.find((s) => s.slot_id === selectedBestSlotId)
                    ?.adviseur_naam
                }
              </p>
            ) : (
              <p className="text-xs text-muted">
                Kies een optie hierboven, of open handmatig.
              </p>
            )}

            <JaNeeField
              label="Partner aanwezig?"
              value={partnerAanwezig}
              onChange={setPartnerAanwezig}
            />
            <JaNeeField
              label="Andere offertes al gehad?"
              value={andereOffertes}
              onChange={setAndereOffertes}
            />
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Interne notitie
              <span className="ml-1 font-normal normal-case tracking-normal text-muted/80">
                (niet voor de klant)
              </span>
              <textarea
                value={notities}
                onChange={(e) => setNotities(e.target.value)}
                rows={3}
                placeholder="Bijv. bel vooraf, sleutel bij buren…"
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              />
            </label>
            <button
              type="submit"
              disabled={
                busy ||
                partnerAanwezig === null ||
                andereOffertes === null ||
                (!startAt && !(useCustomTime && customStart))
              }
              className="min-h-11 w-full bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
            >
              {busy ? "Bezig…" : "Afspraak plannen"}
            </button>
          </form>        </div>
      </aside>
    </div>
    </div>
  );
}
