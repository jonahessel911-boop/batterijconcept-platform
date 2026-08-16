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
import { ProjectenTable } from "./ProjectenTable";
import { FacturenTable } from "./FacturenTable";
import { RapportagePanel } from "./RapportagePanel";
import { AgendaPanel } from "./AgendaPanel";
import { InstellingenPanel } from "./InstellingenPanel";
import { LeadToevoegenModal } from "./LeadToevoegenModal";
import { LEAD_STATUSES } from "@/lib/labels";

const VALID_TABS: CrmTab[] = [
  "leads",
  "agenda",
  "offertes",
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
  } | null>(null);
  const orphanBackfillDone = useRef(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/auth/login");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.adviseur) {
          setSessionUser(data.adviseur);
        }
      } catch {
        /* ignore */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      const sb = getSupabaseBrowser();
      const [l, a, o, p, f] = await Promise.all([
        sb.from("leads").select("*").order("created_at", { ascending: false }),
        sb
          .from("afspraken")
          .select("id, start_at, status, adviseur_id, lead_id")
          .order("start_at", { ascending: true }),
        sb
          .from("offertes")
          .select(
            "*, leads(naam, email, lead_number, postcode, huisnummer, plaats)"
          )
          .order("created_at", { ascending: false }),
        sb
          .from("projecten")
          .select("*, leads(naam, lead_number)")
          .order("created_at", { ascending: false }),
        sb
          .from("facturen")
          .select("*, leads(naam, lead_number)")
          .order("created_at", { ascending: false }),
      ]);

      // Toon de echte PostgREST-fout i.p.v. generieke melding
      const firstErr = l.error || a.error || o.error || p.error || f.error;
      if (firstErr) throw firstErr;

      setLeads((l.data as Lead[]) || []);
      setAfspraken((a.data as Afspraak[]) || []);
      setOffertes((o.data as Offerte[]) || []);
      setProjecten((p.data as Project[]) || []);
      setFacturen((f.data as Factuur[]) || []);
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
    if (!adviseurFilter) return leads;
    const adminId = findAdminAdviseurId(adviseurs);
    // Admin-view: ook nog niet gekoppelde leads (tot backfill klaar is)
    if (adminId && adviseurFilter === adminId) {
      return leads.filter(
        (l) => l.adviseur_id === adviseurFilter || !l.adviseur_id
      );
    }
    return leads.filter((l) => l.adviseur_id === adviseurFilter);
  }, [leads, adviseurFilter, adviseurs]);

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
    return list.filter(
      (l) =>
        l.naam.toLowerCase().includes(q) ||
        l.lead_number.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q) ||
        l.utm_source?.toLowerCase().includes(q) ||
        l.postcode?.toLowerCase().includes(q)
    );
  }, [scopedLeads, search, statusFilter]);

  const scopedOffertes = useMemo(() => {
    if (!adviseurFilter) return offertes;
    return offertes.filter((o) => scopedLeadIds.has(o.lead_id));
  }, [offertes, adviseurFilter, scopedLeadIds]);

  const scopedProjecten = useMemo(() => {
    if (!adviseurFilter) return projecten;
    return projecten.filter((p) => scopedLeadIds.has(p.lead_id));
  }, [projecten, adviseurFilter, scopedLeadIds]);

  const scopedFacturen = useMemo(() => {
    if (!adviseurFilter) return facturen;
    return facturen.filter((f) => scopedLeadIds.has(f.lead_id));
  }, [facturen, adviseurFilter, scopedLeadIds]);

  const upcomingAfsprakenCount = useMemo(() => {
    const now = Date.now();
    return afspraken.filter((a) => {
      if (adviseurFilter && a.adviseur_id !== adviseurFilter) return false;
      if (a.status === "geannuleerd") {
        return new Date(a.start_at).getTime() >= now;
      }
      return new Date(a.start_at).getTime() >= now;
    }).length;
  }, [afspraken, adviseurFilter]);

  const counts = {
    leads: scopedLeads.length,
    agenda: upcomingAfsprakenCount,
    offertes: scopedOffertes.length,
    projecten: scopedProjecten.length,
    facturen: scopedFacturen.length,
  };

  function openSignLink(o: Offerte) {
    if (!o.sign_token) return;
    window.open(`/offerte/${o.sign_token}`, "_blank");
  }

  async function updateLeadStatus(leadId: string, status: LeadStatus) {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, status } : l))
    );
    try {
      const sb = getSupabaseBrowser();
      const { error: err } = await sb
        .from("leads")
        .update({ status })
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
    agenda: {
      title: "Agenda",
      sub: filterLabel
        ? `Agenda van ${filterLabel}`
        : "Plan afspraken en koppel adviseurs",
    },
    offertes: {
      title: "Offertes",
      sub: filterLabel
        ? `Sales van ${filterLabel}`
        : "Verstuurde en ondertekende offertes",
    },
    projecten: {
      title: "Projecten",
      sub: filterLabel
        ? `Projecten van ${filterLabel}`
        : "Installaties in planning en uitvoering",
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
      sub: "Beheer teamleden en hun portfolio",
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
                  placeholder="Zoek naam, lead ID…"
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
          <TabNav active={tab} onChange={changeTab} counts={counts} />
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
                {tab === "agenda" && (
                  <AgendaPanel
                    key={adviseurFilter || "all"}
                    leads={scopedLeads}
                    defaultAdviseurId={adviseurFilter || undefined}
                  />
                )}
                {tab === "offertes" && (
                  <OffertesTable
                    offertes={scopedOffertes}
                    onOpenSign={openSignLink}
                  />
                )}
                {tab === "projecten" && (
                  <ProjectenTable projecten={scopedProjecten} />
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
                  <InstellingenPanel onAdviseursChange={loadAdviseurs} />
                )}
              </>
            )}
          </div>
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
