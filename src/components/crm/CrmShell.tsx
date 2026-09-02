"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  Adviseur,
  Afspraak,
  CrmTab,
  Factuur,
  Lead,
  LeadStatus,
  Offerte,
  Project,
} from "@/types/database";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import { findAdminAdviseurId } from "@/lib/admin-adviseur";
import { errMessage } from "@/lib/errors";
import { CrmHeader } from "./CrmHeader";
import { TabNav } from "./TabNav";
import { LeadsTable } from "./LeadsTable";
import { OffertesTable } from "./OffertesTable";
import { BackofficePanel } from "./BackofficePanel";
import { FacturenTable } from "./FacturenTable";
import { RapportagePanel } from "./RapportagePanel";
import { AgendaPanel } from "./AgendaPanel";
import { BelPanel } from "./BelPanel";
import { InstellingenPanel } from "./InstellingenPanel";
import { InstallatiePartnersPanel } from "./InstallatiePartnersPanel";
import { InstroomPanel } from "./InstroomPanel";
import { LeadToevoegenModal } from "./LeadToevoegenModal";
import { LEAD_STATUSES } from "@/lib/labels";
import { cancelledAppointmentLeadIds, inBelQueue, isTerugbelDue } from "@/lib/bel-queue";
import { normalizeAfspraakSoort } from "@/lib/afspraak-soort";
import { appendLeadNotitie } from "@/lib/lead-notitie";
import { openBackofficeActies } from "@/lib/backoffice-acties";
import {
  agendaIsInstallatie,
  alleenEigenLeads,
  magBekijkAls,
  magTab,
  normalizeRol,
  tabsVoorRol,
  telefoonMatch,
  type GebruikerRol,
} from "@/lib/rollen";
import { CRM_TABS } from "./TabNav";
import { PlanningAgenda } from "@/components/planning/PlanningAgenda";

const VALID_TABS: CrmTab[] = [
  "leads",
  "bellen",
  "agenda",
  "offertes",
  "instroom",
  "projecten",
  "facturen",
  "rapportage",
  "instellingen",
];

const ADVISEUR_FILTER_KEY = "bc_adviseur_filter_v3";

function parseTab(value: string | null): CrmTab {
  if (value && VALID_TABS.includes(value as CrmTab)) return value as CrmTab;
  return "leads";
}

function parseLeadStatus(value: string | null): LeadStatus | "" {
  if (value && LEAD_STATUSES.includes(value as LeadStatus)) {
    return value as LeadStatus;
  }
  return "";
}

export function CrmShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));
  const statusFilter = parseLeadStatus(searchParams.get("status"));
  const [leads, setLeads] = useState<Lead[]>([]);
  const [afspraken, setAfspraken] = useState<Afspraak[]>([]);
  const [offertes, setOffertes] = useState<Offerte[]>([]);
  const [projecten, setProjecten] = useState<Project[]>([]);
  const [facturen, setFacturen] = useState<Factuur[]>([]);
  const [instroomCount, setInstroomCount] = useState(0);
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [adviseurFilter, setAdviseurFilter] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem(ADVISEUR_FILTER_KEY) || "";
    } catch {
      return "";
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [sessionUser, setSessionUser] = useState<{
    id: string;
    naam: string;
    email: string;
    rol: GebruikerRol;
  } | null>(null);
  const orphanBackfillDone = useRef(false);

  const userRol: GebruikerRol = sessionUser
    ? normalizeRol(sessionUser.rol)
    : "admin";
  const visibleTabIds = tabsVoorRol(userRol);
  const visibleTabs = CRM_TABS.filter((t) => visibleTabIds.includes(t.id));

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/auth/login");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.adviseur) {
          setSessionUser({
            id: data.adviseur.id,
            naam: data.adviseur.naam,
            email: data.adviseur.email,
            rol: normalizeRol(data.adviseur.rol),
          });
        }
      } catch {
        /* ignore */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Rol: ongeldige tab → eerste toegestane tab
  useEffect(() => {
    if (!sessionUser) return;
    if (magTab(userRol, tab)) return;
    const first = visibleTabIds[0];
    if (!first) return;
    const params = new URLSearchParams(searchParams.toString());
    if (first === "leads") params.delete("tab");
    else params.set("tab", first);
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }, [sessionUser, userRol, tab, visibleTabIds, searchParams, router]);

  // Ongkoppelde leads eenmalig → Admin
  useEffect(() => {
    if (orphanBackfillDone.current) return;
    if (adviseurs.length === 0 || leads.length === 0) return;
    const adminId = findAdminAdviseurId(adviseurs);
    if (!adminId) return;
    const orphanIds = leads.filter((l) => !l.adviseur_id).map((l) => l.id);
    if (orphanIds.length === 0) {
      orphanBackfillDone.current = true;
      return;
    }

    orphanBackfillDone.current = true;
    const admin = adviseurs.find((a) => a.id === adminId);
    setLeads((prev) =>
      prev.map((l) =>
        l.adviseur_id
          ? l
          : {
              ...l,
              adviseur_id: adminId,
              adviseurs: admin
                ? { id: admin.id, naam: admin.naam }
                : l.adviseurs,
            }
      )
    );

    void (async () => {
      try {
        const sb = getSupabaseBrowser();
        await sb
          .from("leads")
          .update({ adviseur_id: adminId })
          .in("id", orphanIds);
      } catch {
        orphanBackfillDone.current = false;
      }
    })();
  }, [adviseurs, leads]);

  function changeAdviseurFilter(id: string) {
    setAdviseurFilter(id);
    try {
      if (id) localStorage.setItem(ADVISEUR_FILTER_KEY, id);
      else localStorage.removeItem(ADVISEUR_FILTER_KEY);
    } catch {
      /* ignore */
    }
  }

  // Adviseur: altijd eigen leads
  useEffect(() => {
    if (!sessionUser || !alleenEigenLeads(userRol)) return;
    if (adviseurFilter === sessionUser.id) return;
    changeAdviseurFilter(sessionUser.id);
  }, [sessionUser, userRol, adviseurFilter]);

  // Admin/backoffice: ongeldige “Bekijk als”-filter (stale localStorage) → iedereen
  useEffect(() => {
    if (alleenEigenLeads(userRol)) return;
    if (!adviseurFilter) return;
    if (adviseurs.length === 0) return;
    if (adviseurs.some((a) => a.id === adviseurFilter)) return;
    changeAdviseurFilter("");
  }, [adviseurs, adviseurFilter, userRol]);

  // Admin: bij rol-wissel niet blijven hangen op oude eigen-filter uit localStorage
  useEffect(() => {
    if (!sessionUser) return;
    if (alleenEigenLeads(userRol)) return;
    if (adviseurFilter === sessionUser.id && magBekijkAls(userRol)) {
      // Was waarschijnlijk vastgezet als adviseur; admin moet standaard alles zien
      changeAdviseurFilter("");
    }
  }, [sessionUser, userRol]);

  function changeTab(next: CrmTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "leads") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }

  function changeStatusFilter(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!next) params.delete("status");
    else params.set("status", next);
    // Filter hoort bij leads-tab
    params.delete("tab");
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }

  const loadAdviseurs = useCallback(async () => {
    try {
      const res = await fetch("/api/adviseurs");
      const data = await res.json();
      if (res.ok) setAdviseurs(data.adviseurs || []);
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    if (!hasSupabaseConfig()) {
      setError("Koppel Supabase via .env.local om data te laden.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Primair: service-role bootstrap (betrouwbaar voor admin / alle data)
      const boot = await fetch("/api/crm/bootstrap");
      const bootData = await boot.json();
      if (boot.ok) {
        setLeads((bootData.leads as Lead[]) || []);
        setAfspraken((bootData.afspraken as Afspraak[]) || []);
        setOffertes((bootData.offertes as Offerte[]) || []);
        setProjecten((bootData.projecten as Project[]) || []);
        setFacturen((bootData.facturen as Factuur[]) || []);
        setInstroomCount(bootData.instroomCount || 0);
        await loadAdviseurs();
        return;
      }

      // Fallback: browser-client (anon)
      const sb = getSupabaseBrowser();
      const [l, a, o, p, f, sCount] = await Promise.all([
        sb.from("leads").select("*").order("created_at", { ascending: false }),
        sb
          .from("afspraken")
          .select(
            "id, start_at, end_at, status, adviseur_id, lead_id, soort, notities"
          )
          .order("start_at", { ascending: true }),
        sb
          .from("offertes")
          .select(
            "*, leads(naam, email, lead_number, postcode, huisnummer, plaats), installatie_partners(id, naam)"
          )
          .order("created_at", { ascending: false }),
        sb
          .from("projecten")
          .select(
            "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, ondertekend_op)"
          )
          .order("created_at", { ascending: false }),
        sb
          .from("facturen")
          .select(
            "*, leads(naam, email, telefoon, lead_number), offertes(id, offerte_nummer)"
          )
          .order("created_at", { ascending: false }),
        sb.from("sollicitaties").select("id", { count: "exact", head: true }),
      ]);

      const firstErr = l.error || a.error || o.error || p.error || f.error;
      if (firstErr) throw firstErr;

      setLeads((l.data as Lead[]) || []);
      setAfspraken((a.data as Afspraak[]) || []);
      setOffertes((o.data as Offerte[]) || []);
      setProjecten((p.data as Project[]) || []);
      setFacturen((f.data as Factuur[]) || []);
      setInstroomCount(sCount.count || 0);
      await loadAdviseurs();
    } catch (e) {
      setError(errMessage(e, "Kon data niet laden"));
    } finally {
      setLoading(false);
    }
  }, [loadAdviseurs]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(id);
  }, [load]);

  const scopedLeads = useMemo(() => {
    // Adviseur: strikt alleen eigen leads
    if (alleenEigenLeads(userRol) && sessionUser?.id) {
      return leads.filter((l) => l.adviseur_id === sessionUser.id);
    }
    if (!adviseurFilter) return leads;
    const adminId = findAdminAdviseurId(adviseurs);
    // Admin-view: ook nog niet gekoppelde leads (tot backfill klaar is)
    if (adminId && adviseurFilter === adminId) {
      return leads.filter(
        (l) => l.adviseur_id === adviseurFilter || !l.adviseur_id
      );
    }
    return leads.filter((l) => l.adviseur_id === adviseurFilter);
  }, [leads, adviseurFilter, adviseurs, userRol, sessionUser]);

  const scopedLeadIds = useMemo(
    () => new Set(scopedLeads.map((l) => l.id)),
    [scopedLeads]
  );

  const filteredLeads = useMemo(() => {
    let list = scopedLeads;
    if (statusFilter) {
      list = list.filter((l) => l.status === statusFilter);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;

    const scored = list
      .map((l) => {
        let score = 0;
        if (telefoonMatch(l.telefoon, q)) {
          score += 100;
          const digits = q.replace(/\D/g, "");
          if (
            digits.length >= 3 &&
            (l.telefoon || "").replace(/\D/g, "").endsWith(digits)
          ) {
            score += 50;
          }
        }
        if (l.naam.toLowerCase().includes(q)) score += 40;
        if (l.lead_number.toLowerCase().includes(q)) score += 35;
        if (l.email?.toLowerCase().includes(q)) score += 25;
        if (l.postcode?.toLowerCase().includes(q)) score += 20;
        if (l.plaats?.toLowerCase().includes(q)) score += 15;
        if (l.utm_source?.toLowerCase().includes(q)) score += 5;
        if (l.lander?.toLowerCase().includes(q)) score += 5;
        if (l.campaign_name?.toLowerCase().includes(q)) score += 5;
        if (l.ad_name?.toLowerCase().includes(q)) score += 5;
        return { lead: l, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map((x) => x.lead);
  }, [scopedLeads, search, statusFilter]);

  const scopedOffertes = useMemo(() => {
    if (!adviseurFilter) return offertes;
    return offertes.filter((o) => scopedLeadIds.has(o.lead_id));
  }, [offertes, adviseurFilter, scopedLeadIds]);

  const offerteActieOpen = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const o of offertes) {
      m.set(o.id, Boolean(o.actie_required));
    }
    return m;
  }, [offertes]);

  const scopedProjecten = useMemo(() => {
    // Pas zichtbaar in backoffice nadat offerte-actie is afgerond
    let list = projecten.filter((p) => {
      if (!p.offerte_id) return true;
      return offerteActieOpen.get(p.offerte_id) !== true;
    });
    if (adviseurFilter) {
      list = list.filter((p) => scopedLeadIds.has(p.lead_id));
    }
    // Offerte-meta voor actietekst (Warmtefonds vs eigen middelen)
    return list.map((p) => {
      if (p.offertes || !p.offerte_id) return p;
      const o = offertes.find((x) => x.id === p.offerte_id);
      if (!o) return p;
      return {
        ...p,
        offertes: {
          id: o.id,
          offerte_nummer: o.offerte_nummer,
          financiering_voorbehoud: o.financiering_voorbehoud,
          aanbetaling_te_innen_inc: o.aanbetaling_te_innen_inc,
        },
        aanbetaling_te_innen_inc:
          p.aanbetaling_te_innen_inc ?? o.aanbetaling_te_innen_inc ?? null,
      };
    });
  }, [projecten, adviseurFilter, scopedLeadIds, offerteActieOpen, offertes]);

  const scopedFacturen = useMemo(() => {
    let list = adviseurFilter
      ? facturen.filter((f) => scopedLeadIds.has(f.lead_id))
      : facturen;
    return list.map((f) => {
      if (f.offertes?.offerte_nummer || !f.offerte_id) return f;
      const o = offertes.find((x) => x.id === f.offerte_id);
      if (!o) return f;
      return {
        ...f,
        offertes: { id: o.id, offerte_nummer: o.offerte_nummer },
      };
    });
  }, [facturen, adviseurFilter, scopedLeadIds, offertes]);

  const appointmentLeadIds = useMemo(() => {
    const ids = new Set<string>();
    const now = Date.now();
    for (const a of afspraken) {
      if (a.status === "geannuleerd" || a.status === "voltooid") continue;
      // Terugbel-afspraken: altijd uit de normale bellijst (aparte sectie tot afgehandeld)
      if (
        normalizeAfspraakSoort(a.soort) === "bel" ||
        normalizeAfspraakSoort(a.soort) === "warme_bel"
      ) {
        ids.add(a.lead_id);
        continue;
      }
      if (new Date(a.start_at).getTime() < now) continue;
      ids.add(a.lead_id);
    }
    return ids;
  }, [afspraken]);

  const cancelledOutOfBelIds = useMemo(
    () => cancelledAppointmentLeadIds(afspraken),
    [afspraken]
  );

  const terugbelDueCount = useMemo(() => {
    const due = new Set(
      afspraken.filter((a) => isTerugbelDue(a)).map((a) => a.lead_id)
    );
    return [...due].filter((id) => {
      const lead = scopedLeads.find((l) => l.id === id);
      return Boolean(lead?.telefoon?.trim());
    }).length;
  }, [afspraken, scopedLeads]);

  const belQueueCount = useMemo(
    () =>
      scopedLeads.filter((l) =>
        inBelQueue(l, appointmentLeadIds, cancelledOutOfBelIds)
      ).length + terugbelDueCount,
    [scopedLeads, appointmentLeadIds, cancelledOutOfBelIds, terugbelDueCount]
  );

  const backofficeActieCount = useMemo(
    () => openBackofficeActies(scopedProjecten, scopedFacturen).length,
    [scopedProjecten, scopedFacturen]
  );

  const counts = {
    bellen: belQueueCount,
    projecten: backofficeActieCount,
  };

  function openSignLink(o: Offerte) {
    if (!o.sign_token) return;
    window.open(`/offerte/${o.sign_token}`, "_blank");
  }

  async function updateLeadStatus(leadId: string, status: LeadStatus) {
    const current = leads.find((l) => l.id === leadId);
    let notities = current?.notities ?? null;
    if (status === "niet_gekwalificeerd") {
      const reden = window.prompt("Reden: niet goed gekwalificeerd");
      if (reden === null) return;
      if (!reden.trim()) {
        setError("Vul een reden in bij niet gekwalificeerd.");
        return;
      }
      notities = appendLeadNotitie(
        notities,
        `Niet gekwalificeerd: ${reden.trim()}`
      );
    }
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId ? { ...l, status, notities } : l
      )
    );
    try {
      const sb = getSupabaseBrowser();
      const { error: err } = await sb
        .from("leads")
        .update({ status, notities })
        .eq("id", leadId);
      if (err) throw err;
    } catch (e) {
      setError(errMessage(e, "Status bijwerken mislukt"));
      void load();
    }
  }

  async function updateLeadAdviseur(
    leadId: string,
    adviseurId: string | null
  ) {
    const adv = adviseurs.find((a) => a.id === adviseurId) || null;
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId
          ? {
              ...l,
              adviseur_id: adviseurId,
              adviseurs: adv ? { id: adv.id, naam: adv.naam } : null,
            }
          : l
      )
    );
    try {
      const sb = getSupabaseBrowser();
      const { error: err } = await sb
        .from("leads")
        .update({ adviseur_id: adviseurId })
        .eq("id", leadId);
      if (err) throw err;
    } catch (e) {
      const msg = errMessage(e, "Adviseur koppelen mislukt");
      setError(
        msg.includes("adviseur_id") || msg.includes("42703")
          ? "Voer eerst supabase/migrate-lead-adviseur.sql uit in Supabase (SQL Editor)."
          : msg
      );
      void load();
    }
  }

  const filterLabel =
    adviseurs.find((a) => a.id === adviseurFilter)?.naam || null;

  const titles: Record<CrmTab, { title: string; sub: string }> = {
    leads: {
      title: "Leads",
      sub: filterLabel
        ? `Leads van ${filterLabel}`
        : "Alle binnenkomende aanvragen",
    },
    bellen: {
      title: "Bellen",
      sub: "Bel, plan in, daarna Volgende en kies de status",
    },
    agenda: {
      title: agendaIsInstallatie(userRol)
        ? "Agenda installatie"
        : "Agenda",
      sub: agendaIsInstallatie(userRol)
        ? "Schouwen en installaties"
        : filterLabel
          ? `Agenda van ${filterLabel}`
          : "Plan afspraken en koppel adviseurs",
    },
    offertes: {
      title: "Offertes",
      sub: filterLabel
        ? `Sales van ${filterLabel}`
        : "Verstuurde en ondertekende offertes",
    },
    instroom: {
      title: "Instroom",
      sub: "Sollicitaties, status, notities en bestanden",
    },
    projecten: {
      title: "Backoffice",
      sub: filterLabel
        ? `Backoffice van ${filterLabel}`
        : backofficeActieCount > 0
          ? `${backofficeActieCount} openstaande ${backofficeActieCount === 1 ? "actie" : "acties"}`
          : "Backoffice in planning en uitvoering",
    },
    facturen: {
      title: "Facturen",
      sub: filterLabel
        ? `Facturen van ${filterLabel}`
        : "Betalingen en openstaande posten",
    },
    rapportage: {
      title: "Rapportage",
      sub: "Omzet, kosten en winst per periode",
    },
    instellingen: {
      title: "Instellingen",
      sub: "Teamleden, installatiepartners en portaal",
    },
  };

  return (
    <div className="crm-bg flex min-h-screen flex-col">
      <CrmHeader
        onRefresh={load}
        loading={loading}
        adviseurs={adviseurs}
        selectedAdviseurId={adviseurFilter}
        onAdviseurChange={changeAdviseurFilter}
        activeTab={tab}
        onTabChange={changeTab}
        tabCounts={counts}
        tabs={visibleTabs}
        showBekijkAls={magBekijkAls(userRol)}
        userName={sessionUser?.naam}
        onLogout={() => {
          void fetch("/api/auth/login", { method: "DELETE" }).then(() => {
            router.replace("/login");
            router.refresh();
          });
        }}
      />

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-3 py-4 sm:px-6 sm:py-8">
        <div className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-[1.4rem] font-semibold tracking-tight text-green-deeper sm:text-[1.75rem]">
              {titles[tab].title}
            </h1>
            <p className="mt-0.5 text-sm text-muted">{titles[tab].sub}</p>
          </div>

          {tab === "leads" && (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
              <div className="relative w-full sm:w-64">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted/50">
                  ⌕
                </span>
                <input
                  type="search"
                  inputMode="search"
                  placeholder="Zoek naam, tel, lead ID…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full border border-line bg-white py-2.5 pl-8 pr-3 text-sm outline-none transition placeholder:text-muted/60 focus:border-green sm:py-2"
                />
              </div>
              <button
                type="button"
                onClick={() => setAddLeadOpen(true)}
                className="min-h-11 w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] sm:min-h-0 sm:w-auto sm:py-2"
              >
                Lead toevoegen
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
            {error}
          </div>
        )}

        <div className="flex flex-1 flex-col overflow-hidden border border-line bg-white">
          {userRol === "installateur" ? (
            <div className="px-6 py-16 text-center">
              <p className="font-display text-lg font-semibold text-ink">
                Installateur
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted">
                Installateurs werken via het installatieportaal (aparte link per
                partner). Beheer partners onder Instellingen als admin.
              </p>
            </div>
          ) : (
            <>
          <TabNav
            active={tab}
            onChange={changeTab}
            counts={counts}
            tabs={visibleTabs}
          />
          <div className="flex-1 overflow-auto">
            {loading && tab !== "instellingen" ? (
              <p className="px-6 py-14 text-center text-sm text-muted">Laden…</p>
            ) : (
              <>
                {tab === "leads" && (
                  <LeadsTable
                    leads={filteredLeads}
                    adviseurs={adviseurs}
                    statusFilter={statusFilter}
                    onStatusFilterChange={changeStatusFilter}
                    onStatusChange={updateLeadStatus}
                    onAdviseurChange={updateLeadAdviseur}
                  />
                )}
                {tab === "bellen" && magTab(userRol, "bellen") && (
                  <BelPanel
                    leads={scopedLeads}
                    afspraken={afspraken}
                    adviseurs={adviseurs}
                    appointmentLeadIds={appointmentLeadIds}
                    cancelledAppointmentLeadIds={cancelledOutOfBelIds}
                    defaultAdviseurId={
                      alleenEigenLeads(userRol)
                        ? sessionUser?.id
                        : adviseurFilter || undefined
                    }
                    onLeadUpdated={(id, patch) => {
                      setLeads((prev) =>
                        prev.map((l) => (l.id === id ? { ...l, ...patch } : l))
                      );
                    }}
                    onNeedReload={() => void load()}
                  />
                )}
                {tab === "agenda" &&
                  (agendaIsInstallatie(userRol) ? (
                    <div className="p-5">
                      <PlanningAgenda
                        orders={scopedProjecten}
                        showPartner
                        linkHref={(event) => `/projecten/${event.order.id}`}
                      />
                    </div>
                  ) : (
                    <AgendaPanel
                      key={adviseurFilter || "all"}
                      leads={scopedLeads}
                      afspraken={afspraken}
                      defaultAdviseurId={
                        alleenEigenLeads(userRol)
                          ? sessionUser?.id
                          : adviseurFilter || undefined
                      }
                    />
                  ))}
                {tab === "offertes" && (
                  <OffertesTable
                    offertes={scopedOffertes}
                    onOpenSign={openSignLink}
                  />
                )}
                {tab === "instroom" && <InstroomPanel />}
                {tab === "projecten" && (
                  <BackofficePanel
                    projecten={scopedProjecten}
                    facturen={scopedFacturen}
                    onProjectUpdated={(project) => {
                      setProjecten((prev) =>
                        prev.map((p) =>
                          p.id === project.id ? { ...p, ...project } : p
                        )
                      );
                    }}
                    onFactuurUpdated={(factuur) => {
                      setFacturen((prev) =>
                        prev.map((f) =>
                          f.id === factuur.id ? { ...f, ...factuur } : f
                        )
                      );
                    }}
                  />
                )}
                {tab === "facturen" && (
                  <FacturenTable facturen={scopedFacturen} />
                )}
                {tab === "rapportage" && (
                  <RapportagePanel
                    adviseurs={adviseurs}
                    defaultAdviseurId={adviseurFilter || undefined}
                  />
                )}
                {tab === "instellingen" && (
                  <div>
                    <InstellingenPanel onAdviseursChange={loadAdviseurs} />
                    <InstallatiePartnersPanel />
                  </div>
                )}
              </>
            )}
          </div>
            </>
          )}
        </div>
      </main>

      <LeadToevoegenModal
        open={addLeadOpen}
        onClose={() => setAddLeadOpen(false)}
        defaultAdviseurId={adviseurFilter || undefined}
        onCreated={(lead) => {
          setLeads((prev) => [lead, ...prev]);
        }}
      />
    </div>
  );
}
