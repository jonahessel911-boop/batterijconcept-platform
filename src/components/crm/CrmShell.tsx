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
import { CrmSidebar } from "./CrmSidebar";
import { rememberCrmReturnUrl } from "./DetailChrome";
import {
  hasCrmBootstrapCache,
  readCrmBootstrapCache,
  readCrmSessionCache,
  writeCrmBootstrapCache,
  writeCrmSessionCache,
  clearCrmShellCache,
} from "@/lib/crm-shell-cache";
import { LeadsTable } from "./LeadsTable";
import { OffertesTable } from "./OffertesTable";
import { BackofficePanel } from "./BackofficePanel";
import { useBoViewStore, setBoViewStore } from "@/lib/bo-view-store";
import { isOpenstaandeSchouwweek } from "./SchouwweekList";
import { FacturenTable } from "./FacturenTable";
import { AdviseurFacturenPanel } from "./AdviseurFacturenPanel";
import { PartnersPanel } from "./PartnersPanel";
import { PurchasingPanel } from "./PurchasingPanel";
import { RapportagePanel } from "./RapportagePanel";
import { AgendaPanel } from "./AgendaV2Panel";
import { BelPanel } from "./BelPanel";
import { RecruitmentPanel } from "./RecruitmentPanel";
import { InkomendPanel } from "./InkomendPanel";
import { AdminTargetsPanel } from "./AdminTargetsPanel";
import { LeadToevoegenModal } from "./LeadToevoegenModal";
import { LEAD_STATUSES } from "@/lib/labels";
import { inBelQueue, isTerugbelDue } from "@/lib/bel-queue";
import { normalizeAfspraakSoort } from "@/lib/afspraak-soort";
import { appendLeadNotitie } from "@/lib/lead-notitie";
import { openBackofficeActies } from "@/lib/backoffice-acties";
import {
  agendaIsInstallatie,
  alleenEigenLeads,
  isBellerRol,
  magBekijkAls,
  magTab,
  normalizeRol,
  tabsVoorRol,
  telefoonMatch,
  type GebruikerRol,
} from "@/lib/rollen";
import { CRM_TABS } from "./TabNav";
import { PlanningAgenda } from "@/components/planning/PlanningAgenda";
import { NettoBoord } from "./NettoBoord";
import { SalesLeaderboardPanel } from "./SalesLeaderboardPanel";
import { AdminTakenPanel } from "./AdminTakenPanel";

const VALID_TABS: CrmTab[] = [
  "taken",
  "leads",
  "bellen",
  "agenda",
  "offertes",
  "netto",
  "leaderboard",
  "instroom",
  "projecten",
  "facturen",
  "creditfacturen",
  "inkomend",
  "purchasing",
  "rapportage",
  "admin",
  "ai",
  "partners",
];

const ADVISEUR_FILTER_KEY = "bc_adviseur_filter_v3";

function parseTab(value: string | null): CrmTab {
  // Oude URL-tab → Partners (facturen / team zitten daar nu)
  if (value === "creditfacturen" || value === "instellingen") return "partners";
  // Service / AI zitten onder Backoffice
  if (value === "service" || value === "ai") return "projecten";
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
  const urlTab = parseTab(searchParams.get("tab"));
  const [tab, setTab] = useState<CrmTab>(urlTab);
  const [boView] = useBoViewStore();

  useEffect(() => {
    setTab(urlTab);
  }, [urlTab]);

  useEffect(() => {
    // Oude losse Service-tab → Backoffice › Service
    if (searchParams.get("tab") === "service") {
      setBoViewStore("service");
    }
    // Oude Instellingen-tab → Partners › Team
    if (searchParams.get("tab") === "instellingen") {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", "partners");
      params.set("partners", "team");
      router.replace(`/?${params.toString()}`, { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    rememberCrmReturnUrl();
  }, [tab, searchParams]);

  const statusFilter = parseLeadStatus(searchParams.get("status"));
  const [leads, setLeads] = useState<Lead[]>(
    () => readCrmBootstrapCache()?.leads ?? []
  );
  const [afspraken, setAfspraken] = useState<Afspraak[]>(
    () => readCrmBootstrapCache()?.afspraken ?? []
  );
  const [offertes, setOffertes] = useState<Offerte[]>(
    () => readCrmBootstrapCache()?.offertes ?? []
  );
  const [projecten, setProjecten] = useState<Project[]>(
    () => readCrmBootstrapCache()?.projecten ?? []
  );
  const [facturen, setFacturen] = useState<Factuur[]>(
    () => readCrmBootstrapCache()?.facturen ?? []
  );
  const [instroomCount, setInstroomCount] = useState(
    () => readCrmBootstrapCache()?.instroomCount ?? 0
  );
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>(
    () => readCrmBootstrapCache()?.adviseurs ?? []
  );
  const [adviseurFilter, setAdviseurFilter] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem(ADVISEUR_FILTER_KEY) || "";
    } catch {
      return "";
    }
  });
  const [loading, setLoading] = useState(() => !hasCrmBootstrapCache());
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("bc_crm_sidebar_rail_v1") === "1";
    } catch {
      return false;
    }
  });
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [adviseurFacturenPending, setAdviseurFacturenPending] = useState(0);
  const [sessionUser, setSessionUser] = useState<{
    id: string;
    naam: string;
    email: string;
    rol: GebruikerRol;
  } | null>(() => readCrmSessionCache());
  const [sessionReady, setSessionReady] = useState(
    () => readCrmSessionCache() !== null
  );
  const [impersonator, setImpersonator] = useState<{
    id: string;
    naam: string;
  } | null>(null);
  const [impersonateBusy, setImpersonateBusy] = useState(false);
  const orphanBackfillDone = useRef(false);

  // Nooit "admin" als fallback — tot sessie bekend is: geen tabs tonen
  const userRol: GebruikerRol | null = sessionUser
    ? normalizeRol(sessionUser.rol)
    : null;
  const visibleTabIds = userRol ? tabsVoorRol(userRol) : [];
  const visibleTabs = CRM_TABS.filter((t) => visibleTabIds.includes(t.id));

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/auth/login");
        if (!res.ok) {
          if (!cancelled) setSessionReady(true);
          return;
        }
        const data = await res.json();
        if (!cancelled && data.adviseur) {
          const next = {
            id: data.adviseur.id,
            naam: data.adviseur.naam,
            email: (data.adviseur.email || "").trim(),
            rol: normalizeRol(data.adviseur.rol),
          };
          setSessionUser(next);
          writeCrmSessionCache(next);
          setImpersonator(
            data.impersonating
              ? {
                  id: data.impersonating.id as string,
                  naam: (data.impersonating.naam as string) || "Admin",
                }
              : null
          );
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Adviseur: badge op Facturen met openstaande goedkeuringen
  useEffect(() => {
    if (userRol !== "adviseur") {
      setAdviseurFacturenPending(0);
      return;
    }
    let cancelled = false;
    void fetch("/api/adviseurs/creditfacturen/mijn")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list = (data.facturen || []) as { status?: string }[];
        setAdviseurFacturenPending(
          list.filter((f) => f.status === "verzonden").length
        );
      })
      .catch(() => {
        if (!cancelled) setAdviseurFacturenPending(0);
      });
    return () => {
      cancelled = true;
    };
  }, [userRol]);

  // Rol: ongeldige tab → eerste toegestane tab
  useEffect(() => {
    if (!sessionUser || !userRol) return;
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
    if (!sessionUser || !userRol || !alleenEigenLeads(userRol)) return;
    if (adviseurFilter === sessionUser.id) return;
    changeAdviseurFilter(sessionUser.id);
  }, [sessionUser, userRol, adviseurFilter]);

  // Admin/backoffice: ongeldige “Bekijk als”-filter (stale localStorage) → iedereen
  useEffect(() => {
    if (!userRol || alleenEigenLeads(userRol)) return;
    if (!adviseurFilter) return;
    if (adviseurs.length === 0) return;
    if (adviseurs.some((a) => a.id === adviseurFilter)) return;
    changeAdviseurFilter("");
  }, [adviseurs, adviseurFilter, userRol]);

  // Admin: bij rol-wissel niet blijven hangen op oude eigen-filter uit localStorage
  useEffect(() => {
    if (!sessionUser || !userRol) return;
    if (alleenEigenLeads(userRol)) return;
    if (adviseurFilter === sessionUser.id && magBekijkAls(userRol)) {
      changeAdviseurFilter("");
    }
  }, [sessionUser, userRol]);

  function changeTab(next: CrmTab) {
    if (userRol && !magTab(userRol, next)) return;
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    // Admin-home is Taken; leads altijd expliciet in de URL
    if (next === "leads" && userRol !== "admin") params.delete("tab");
    else params.set("tab", next);
    if (next !== "projecten") params.delete("bo");
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/", { scroll: false });
  }

  // Admin: start op Taken als er geen tab in de URL staat
  useEffect(() => {
    if (!sessionReady || userRol !== "admin") return;
    if (searchParams.get("tab")) return;
    if (searchParams.get("status")) return;
    if (searchParams.get("bo")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "taken");
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [sessionReady, userRol, searchParams, router]);

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
    const hadCache = hasCrmBootstrapCache();
    if (!hadCache) setLoading(true);
    setError(null);
    try {
      // Primair: service-role bootstrap (betrouwbaar voor admin / alle data)
      const boot = await fetch("/api/crm/bootstrap");
      const bootData = await boot.json();
      if (boot.ok) {
        const nextLeads = (bootData.leads as Lead[]) || [];
        const nextAfspraken = (bootData.afspraken as Afspraak[]) || [];
        const nextOffertes = (bootData.offertes as Offerte[]) || [];
        const nextProjecten = (bootData.projecten as Project[]) || [];
        const nextFacturen = (bootData.facturen as Factuur[]) || [];
        const nextInstroom = bootData.instroomCount || 0;
        setLeads(nextLeads);
        setAfspraken(nextAfspraken);
        setOffertes(nextOffertes);
        setProjecten(nextProjecten);
        setFacturen(nextFacturen);
        setInstroomCount(nextInstroom);
        let nextAdviseurs: Adviseur[] = [];
        const advRes = await fetch("/api/adviseurs");
        const advData = await advRes.json();
        if (advRes.ok) {
          nextAdviseurs = (advData.adviseurs as Adviseur[]) || [];
          setAdviseurs(nextAdviseurs);
        }
        writeCrmBootstrapCache({
          leads: nextLeads,
          afspraken: nextAfspraken,
          offertes: nextOffertes,
          projecten: nextProjecten,
          facturen: nextFacturen,
          instroomCount: nextInstroom,
          adviseurs: nextAdviseurs,
        });
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
            "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats, status, adviseur_id, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, ondertekend_op)"
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

      const nextLeads = (l.data as Lead[]) || [];
      const nextAfspraken = (a.data as Afspraak[]) || [];
      const nextOffertes = (o.data as Offerte[]) || [];
      const nextProjecten = (p.data as Project[]) || [];
      const nextFacturen = (f.data as Factuur[]) || [];
      const nextInstroom = sCount.count || 0;
      setLeads(nextLeads);
      setAfspraken(nextAfspraken);
      setOffertes(nextOffertes);
      setProjecten(nextProjecten);
      setFacturen(nextFacturen);
      setInstroomCount(nextInstroom);
      let nextAdviseurs: Adviseur[] = [];
      const advRes = await fetch("/api/adviseurs");
      const advData = await advRes.json();
      if (advRes.ok) {
        nextAdviseurs = (advData.adviseurs as Adviseur[]) || [];
        setAdviseurs(nextAdviseurs);
      }
      writeCrmBootstrapCache({
        leads: nextLeads,
        afspraken: nextAfspraken,
        offertes: nextOffertes,
        projecten: nextProjecten,
        facturen: nextFacturen,
        instroomCount: nextInstroom,
        adviseurs: nextAdviseurs,
      });
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
    if (!userRol) return [];
    // Beller: alleen leads die aan hen zijn toegewezen
    if (isBellerRol(userRol) && sessionUser?.id) {
      return leads.filter((l) => l.beller_id === sessionUser.id);
    }
    // Adviseur: strikt alleen eigen leads
    if (alleenEigenLeads(userRol) && sessionUser?.id) {
      return leads.filter((l) => l.adviseur_id === sessionUser.id);
    }
    if (!adviseurFilter) return leads;
    const selected = adviseurs.find((a) => a.id === adviseurFilter);
    if (selected && isBellerRol(selected.rol)) {
      return leads.filter((l) => l.beller_id === adviseurFilter);
    }
    const adminId = findAdminAdviseurId(adviseurs);
    // Admin-view: ook nog niet gekoppelde leads (tot backfill klaar is)
    if (adminId && adviseurFilter === adminId) {
      return leads.filter(
        (l) => l.adviseur_id === adviseurFilter || !l.adviseur_id
      );
    }
    return leads.filter((l) => l.adviseur_id === adviseurFilter);
  }, [leads, adviseurFilter, adviseurs, userRol, sessionUser]);

  /**
   * Bellijst: team-queue. “Bekijk als” (adviseur-filter) mag die niet leegtrekken —
   * anders zie je bv. alleen de 3 leads van één adviseur i.p.v. alle belbare.
   * Bellers blijven beperkt tot hun toegewezen leads.
   */
  const belLeads = useMemo(() => {
    if (!userRol) return [];
    if (isBellerRol(userRol) && sessionUser?.id) {
      return leads.filter((l) => l.beller_id === sessionUser.id);
    }
    if (alleenEigenLeads(userRol) && sessionUser?.id) {
      return leads.filter((l) => l.adviseur_id === sessionUser.id);
    }
    // Admin/backoffice: volle bellijst, ongeacht Bekijk-als
    return leads;
  }, [leads, userRol, sessionUser]);

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
          subtotaal_ex_btw: o.subtotaal_ex_btw,
          btw_bedrag: o.btw_bedrag,
          totaal_inc_btw: o.totaal_inc_btw,
          ondertekend_op: o.ondertekend_op,
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

  const projectIdByLeadId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projecten) {
      if (p.lead_id && !m.has(p.lead_id)) m.set(p.lead_id, p.id);
    }
    return m;
  }, [projecten]);

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

  const terugbelDueCount = useMemo(() => {
    const due = new Set(
      afspraken.filter((a) => isTerugbelDue(a)).map((a) => a.lead_id)
    );
    return [...due].filter((id) => {
      const lead = belLeads.find((l) => l.id === id);
      return Boolean(lead?.telefoon?.trim());
    }).length;
  }, [afspraken, belLeads]);

  const belQueueCount = useMemo(
    () =>
      belLeads.filter((l) => inBelQueue(l, appointmentLeadIds)).length +
      terugbelDueCount,
    [belLeads, appointmentLeadIds, terugbelDueCount]
  );

  const backofficeActieCount = useMemo(
    () =>
      openBackofficeActies(scopedProjecten, scopedFacturen, new Date(), {
        leads: scopedLeads,
        afspraken,
      }).length,
    [scopedProjecten, scopedFacturen, scopedLeads, afspraken]
  );

  const schouwweekCount = useMemo(
    () => scopedProjecten.filter(isOpenstaandeSchouwweek).length,
    [scopedProjecten]
  );

  const counts = {
    bellen: belQueueCount,
    projecten: backofficeActieCount,
    ...(userRol === "adviseur" && adviseurFacturenPending > 0
      ? { facturen: adviseurFacturenPending }
      : {}),
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
      // Sale-type syncen naar offerte, zodat schouw-mail/UI geen Warmtefonds-tekst tonen bij eigen middelen
      if (status === "sale_eigen_middelen" || status === "sale_financiering") {
        const warmtefonds = status === "sale_financiering";
        await sb
          .from("offertes")
          .update({ financiering_voorbehoud: warmtefonds })
          .eq("lead_id", leadId)
          .eq("status", "ondertekend");
        setOffertes((prev) =>
          prev.map((o) =>
            o.lead_id === leadId && o.status === "ondertekend"
              ? { ...o, financiering_voorbehoud: warmtefonds }
              : o
          )
        );
      }
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
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adviseur_id: adviseurId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Adviseur koppelen mislukt"
        );
      }
      if (adviseurId) {
        setAfspraken((prev) =>
          prev.map((a) =>
            a.lead_id === leadId &&
            (a.status === "gepland" ||
              a.status === "bevestigd" ||
              a.status === "verzet")
              ? { ...a, adviseur_id: adviseurId }
              : a
          )
        );
      }
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

  async function updateLeadBeller(leadId: string, bellerId: string | null) {
    const bel = adviseurs.find((a) => a.id === bellerId) || null;
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId
          ? {
              ...l,
              beller_id: bellerId,
              bellers: bel ? { id: bel.id, naam: bel.naam } : null,
            }
          : l
      )
    );
    try {
      const sb = getSupabaseBrowser();
      const { error: err } = await sb
        .from("leads")
        .update({ beller_id: bellerId })
        .eq("id", leadId);
      if (err) throw err;
    } catch (e) {
      const msg = errMessage(e, "Beller toewijzen mislukt");
      setError(
        msg.includes("beller_id") || msg.includes("42703")
          ? "Voer eerst supabase/migrate-beller-rol.sql uit in Supabase (SQL Editor)."
          : msg
      );
      void load();
    }
  }

  const filterLabel =
    adviseurs.find((a) => a.id === adviseurFilter)?.naam || null;

  const titles: Record<CrmTab, { title: string; sub: string }> = {
    taken: {
      title: "Agenda & taken",
      sub: "Persoonlijke agenda · taken en afspraken",
    },
    leads: {
      title: "Leads",
      sub: filterLabel
        ? `Leads van ${filterLabel}`
        : "Alle binnenkomende aanvragen",
    },
    bellen: {
      title: "Bellen",
      sub: userRol && isBellerRol(userRol)
        ? "Alleen leads die aan jou zijn toegewezen"
        : "Bel, plan in, daarna Volgende en kies de status",
    },
    agenda: {
      title: userRol && agendaIsInstallatie(userRol)
        ? "Agenda installatie"
        : "Agenda",
      sub: userRol && agendaIsInstallatie(userRol)
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
    netto: {
      title: "Netto-boord",
      sub: filterLabel
        ? `Commissie & voortgang · ${filterLabel}`
        : "Sales, fases, commissie en creditfacturen",
    },
    leaderboard: {
      title: "Sales Leaderboard",
      sub: "Live sale-momenten bij ondertekende offertes",
    },
    instroom: {
      title: "Recruitment",
      sub: "Kanban + agenda · bevestigingsmail bij gesprek",
    },
    projecten: {
      title:
        boView === "agenda"
          ? "Planbord"
          : boView === "acties"
            ? "Acties"
            : boView === "schouwweek"
              ? "Schouwweek"
              : boView === "service"
                ? "Service"
                : "Projecten",
      sub:
        boView === "agenda"
          ? "Schouw, installatie en service per week"
          : boView === "acties"
            ? backofficeActieCount > 0
              ? `${backofficeActieCount} openstaande ${backofficeActieCount === 1 ? "actie" : "acties"}`
              : "Herplannen, schouw, financiering en facturen"
            : boView === "schouwweek"
              ? schouwweekCount > 0
                ? `${schouwweekCount} openstaande schouwweek${schouwweekCount === 1 ? "" : "en"}`
                : "Orders met schouwweek · nog geen definitieve schouwdag"
              : boView === "service"
                ? "Service-desk · tickets inplannen op het planbord"
                : filterLabel
                  ? `Backoffice van ${filterLabel}`
                  : "Backoffice in planning en uitvoering",
    },
    facturen: {
      title: "Facturen",
      sub:
        userRol === "adviseur"
          ? "Jouw selfbilling-facturen · goedkeuren voor uitbetaling"
          : filterLabel
            ? `Facturen van ${filterLabel}`
            : "Betalingen en openstaande posten",
    },
    creditfacturen: {
      title: "Creditfacturen",
      sub: "Adviseurs en installatiepartners · versturen en goedkeuring",
    },
    inkomend: {
      title: "Inkomend",
      sub: "Maandmappen · mail wordt automatisch verwerkt",
    },
    purchasing: {
      title: "Purchasing",
      sub: "Materiaal inkopen bij Apex Power Supplies · status en levering",
    },
    rapportage: {
      title: "Rapportage",
      sub: "Dashboard en kaart",
    },
    admin: {
      title: "Admin",
      sub: "Standaard- en persoonsdoelen voor adviseurs, bellers en installatiepartners",
    },
    ai: {
      title: "AI interface",
      sub: "Verborgen",
    },
    partners: {
      title: "Partners",
      sub: "Team (adviseurs · installatiepartners) en uitbetalingen",
    },
    instellingen: {
      title: "Partners",
      sub: "Doorverwezen naar Partners → Team",
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
        showBekijkAls={
          Boolean(userRol && magBekijkAls(userRol)) &&
          !impersonator &&
          tab !== "rapportage"
        }
        hideTabNav
        onOpenSidebar={() => setSidebarMobileOpen(true)}
        userName={sessionUser?.naam}
        onLogout={() => {
          clearCrmShellCache();
          void fetch("/api/auth/login", { method: "DELETE" }).then(() => {
            router.replace("/login");
            router.refresh();
          });
        }}
      />

      {impersonator ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#854D0E]/30 bg-[#FFF8D6] px-4 py-2.5 sm:px-6">
          <p className="text-sm text-[#854D0E]">
            Ingelogd als{" "}
            <span className="font-semibold">{sessionUser?.naam}</span>
            <span className="text-[#854D0E]/80">
              {" "}
              · via {impersonator.naam}
            </span>
          </p>
          <button
            type="button"
            disabled={impersonateBusy}
            onClick={() => {
              setImpersonateBusy(true);
              void fetch("/api/auth/impersonate", { method: "DELETE" })
                .then(async (res) => {
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    throw new Error(
                      (data as { error?: string }).error ||
                        "Terugkeren mislukt"
                    );
                  }
                  clearCrmShellCache();
                  window.location.href = "/";
                })
                .catch((e) => {
                  setError(
                    e instanceof Error ? e.message : "Terugkeren mislukt"
                  );
                  setImpersonateBusy(false);
                });
            }}
            className="border border-[#854D0E]/40 bg-white px-3 py-1.5 text-xs font-semibold text-[#854D0E] hover:bg-[#FFF8D6] disabled:opacity-60"
          >
            {impersonateBusy ? "Bezig…" : "Terug naar admin"}
          </button>
        </div>
      ) : null}

      <div className="flex min-w-0 w-full flex-1">
        <CrmSidebar
          active={tab}
          onChange={changeTab}
          counts={counts}
          allowedTabs={visibleTabIds}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => {
            setSidebarCollapsed((v) => {
              const next = !v;
              try {
                localStorage.setItem(
                  "bc_crm_sidebar_rail_v1",
                  next ? "1" : "0"
                );
              } catch {
                /* ignore */
              }
              return next;
            });
          }}
          mobileOpen={sidebarMobileOpen}
          onMobileClose={() => setSidebarMobileOpen(false)}
          boCounts={{
            acties: backofficeActieCount,
            schouwweek: schouwweekCount,
          }}
        />

        <main
          className={[
            "flex min-w-0 flex-1 flex-col",
            tab === "leaderboard"
              ? "px-0 py-0"
              : "px-3 py-4 sm:px-5 sm:py-6 lg:px-6 lg:py-8",
          ].join(" ")}
        >
        {tab !== "leaderboard" ? (
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
        ) : null}

        {error && tab !== "leaderboard" && (
          <div className="mb-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
            {error}
          </div>
        )}

        <div
          className={[
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            tab === "leaderboard"
              ? "border-0 bg-black"
              : "border border-line bg-white",
          ].join(" ")}
        >
          {userRol === "installateur" ? (
            <div className="px-6 py-16 text-center">
              <p className="font-display text-lg font-semibold text-ink">
                Installateur
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted">
                Installateurs werken via het installatieportaal (aparte link per
                partner). Beheer partners onder Partners als admin.
              </p>
            </div>
          ) : (
            <>
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            {(!sessionReady || !userRol) && !sessionUser ? (
              <p className="px-6 py-14 text-center text-sm text-muted">Laden…</p>
            ) : loading &&
              !hasCrmBootstrapCache() &&
              projecten.length === 0 &&
              leads.length === 0 &&
              tab !== "taken" &&
              tab !== "partners" &&
              tab !== "purchasing" &&
              tab !== "ai" &&
              tab !== "admin" &&
              tab !== "netto" &&
              tab !== "leaderboard" &&
              tab !== "instroom" ? (
              <p className="px-6 py-14 text-center text-sm text-muted">Laden…</p>
            ) : !userRol || !magTab(userRol, tab) ? (
              <p className="px-6 py-14 text-center text-sm text-muted">
                Geen toegang tot dit menu.
              </p>
            ) : (
              <>
                {tab === "taken" && <AdminTakenPanel />}
                {tab === "leads" && (
                  <LeadsTable
                    leads={filteredLeads}
                    adviseurs={adviseurs}
                    afspraken={afspraken}
                    statusFilter={statusFilter}
                    onStatusFilterChange={changeStatusFilter}
                    onStatusChange={updateLeadStatus}
                    onAdviseurChange={
                      userRol && magBekijkAls(userRol)
                        ? updateLeadAdviseur
                        : undefined
                    }
                    onBellerChange={
                      userRol === "admin" ? updateLeadBeller : undefined
                    }
                    showBellerColumn={userRol === "admin"}
                    projectIdByLeadId={projectIdByLeadId}
                  />
                )}
                {tab === "bellen" && (
                  <BelPanel
                    leads={belLeads}
                    afspraken={afspraken}
                    adviseurs={adviseurs}
                    appointmentLeadIds={appointmentLeadIds}
                    defaultAdviseurId={
                      isBellerRol(userRol)
                        ? undefined
                        : alleenEigenLeads(userRol)
                          ? sessionUser?.id
                          : undefined
                    }
                    lockAdviseur={userRol === "adviseur"}
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
                        onOrderUpdated={(project) => {
                          setProjecten((prev) =>
                            prev.map((p) =>
                              p.id === project.id ? { ...p, ...project } : p
                            )
                          );
                        }}
                      />
                    </div>
                  ) : (
                    <AgendaPanel
                      key={adviseurFilter || "all"}
                      leads={scopedLeads}
                      afspraken={afspraken}
                      adviseurs={adviseurs}
                      defaultAdviseurId={
                        alleenEigenLeads(userRol)
                          ? sessionUser?.id
                          : adviseurFilter || undefined
                      }
                      onStatusChange={updateLeadStatus}
                      onBellerChange={
                        userRol === "admin" ? updateLeadBeller : undefined
                      }
                    />
                  ))}
                {tab === "offertes" && (
                  <OffertesTable
                    offertes={scopedOffertes}
                    onOpenSign={openSignLink}
                  />
                )}
                {tab === "netto" && (
                  <NettoBoord
                    adviseurId={
                      alleenEigenLeads(userRol)
                        ? sessionUser?.id
                        : adviseurFilter || undefined
                    }
                    lockAdviseur={alleenEigenLeads(userRol)}
                    projecten={scopedProjecten}
                    onProjectUpdated={(project) => {
                      setProjecten((prev) =>
                        prev.map((p) =>
                          p.id === project.id ? { ...p, ...project } : p
                        )
                      );
                    }}
                  />
                )}
                {tab === "leaderboard" && <SalesLeaderboardPanel />}
                {tab === "instroom" && <RecruitmentPanel />}
                {tab === "projecten" && (
                  <BackofficePanel
                    projecten={scopedProjecten}
                    facturen={scopedFacturen}
                    adviseurs={adviseurs}
                    leads={scopedLeads}
                    afspraken={afspraken}
                    adviseurId={sessionUser?.id || null}
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
                    onLeadUpdated={(id, patch) => {
                      setLeads((prev) =>
                        prev.map((l) => (l.id === id ? { ...l, ...patch } : l))
                      );
                    }}
                  />
                )}
                {tab === "facturen" &&
                  (userRol === "adviseur" ? (
                    <AdviseurFacturenPanel
                      onPendingChange={setAdviseurFacturenPending}
                    />
                  ) : (
                    <FacturenTable facturen={scopedFacturen} />
                  ))}
                {tab === "inkomend" && <InkomendPanel />}
                {tab === "purchasing" && <PurchasingPanel />}
                {tab === "rapportage" && (
                  <RapportagePanel />
                )}
                {tab === "admin" && <AdminTargetsPanel />}
                {tab === "partners" && (
                  <PartnersPanel onAdviseursChange={loadAdviseurs} />
                )}
              </>
            )}
          </div>
            </>
          )}
        </div>
      </main>
      </div>

      <LeadToevoegenModal
        open={addLeadOpen}
        onClose={() => setAddLeadOpen(false)}
        defaultAdviseurId={
          userRol && alleenEigenLeads(userRol)
            ? sessionUser?.id
            : adviseurFilter || sessionUser?.id || undefined
        }
        onCreated={(lead) => {
          setLeads((prev) => [lead, ...prev]);
        }}
      />
    </div>
  );
}
