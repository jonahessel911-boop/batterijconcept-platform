"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  CrmTab,
  Factuur,
  Lead,
  LeadStatus,
  Offerte,
  Project,
} from "@/types/database";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import { CrmHeader } from "./CrmHeader";
import { TabNav } from "./TabNav";
import { LeadsTable } from "./LeadsTable";
import { OffertesTable } from "./OffertesTable";
import { ProjectenTable } from "./ProjectenTable";
import { FacturenTable } from "./FacturenTable";
import { AgendaPanel } from "./AgendaPanel";

const VALID_TABS: CrmTab[] = [
  "leads",
  "agenda",
  "offertes",
  "projecten",
  "facturen",
];

function parseTab(value: string | null): CrmTab {
  if (value && VALID_TABS.includes(value as CrmTab)) return value as CrmTab;
  return "leads";
}

export function CrmShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));
  const [leads, setLeads] = useState<Lead[]>([]);
  const [offertes, setOffertes] = useState<Offerte[]>([]);
  const [projecten, setProjecten] = useState<Project[]>([]);
  const [facturen, setFacturen] = useState<Factuur[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  function changeTab(next: CrmTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "leads") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }

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
      const [l, o, p, f] = await Promise.all([
        sb.from("leads").select("*").order("created_at", { ascending: false }),
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

      if (l.error) throw l.error;
      setLeads((l.data as Lead[]) || []);
      setOffertes((o.data as Offerte[]) || []);
      setProjecten((p.data as Project[]) || []);
      setFacturen((f.data as Factuur[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kon data niet laden");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(id);
  }, [load]);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter(
      (l) =>
        l.naam.toLowerCase().includes(q) ||
        l.lead_number.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q) ||
        l.utm_source?.toLowerCase().includes(q) ||
        l.postcode?.toLowerCase().includes(q)
    );
  }, [leads, search]);

  const counts = {
    leads: leads.length,
    agenda: 0,
    offertes: offertes.length,
    projecten: projecten.length,
    facturen: facturen.length,
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
      setError(
        e instanceof Error ? e.message : "Status bijwerken mislukt"
      );
      void load();
    }
  }

  const titles: Record<CrmTab, { title: string; sub: string }> = {
    leads: { title: "Leads", sub: "Alle binnenkomende aanvragen" },
    agenda: {
      title: "Agenda",
      sub: "Plan afspraken en koppel adviseurs",
    },
    offertes: {
      title: "Offertes",
      sub: "Verstuurde en ondertekende offertes",
    },
    projecten: {
      title: "Projecten",
      sub: "Installaties in planning en uitvoering",
    },
    facturen: {
      title: "Facturen",
      sub: "Betalingen en openstaande posten",
    },
  };

  return (
    <div className="crm-bg flex min-h-screen flex-col">
      <CrmHeader onRefresh={load} loading={loading} />

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-green-deeper">
              {titles[tab].title}
            </h1>
            <p className="mt-0.5 text-sm text-muted">{titles[tab].sub}</p>
          </div>

          {tab === "leads" && (
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted/50">
                ⌕
              </span>
              <input
                type="search"
                placeholder="Zoek naam, lead ID, UTM…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64 border border-line bg-white py-2 pl-8 pr-3 text-sm outline-none transition placeholder:text-muted/60 focus:border-green"
              />
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
            {loading ? (
              <p className="px-6 py-14 text-center text-sm text-muted">Laden…</p>
            ) : (
              <>
                {tab === "leads" && (
                  <LeadsTable
                    leads={filteredLeads}
                    onStatusChange={updateLeadStatus}
                  />
                )}
                {tab === "agenda" && <AgendaPanel leads={leads} />}
                {tab === "offertes" && (
                  <OffertesTable
                    offertes={offertes}
                    onOpenSign={openSignLink}
                  />
                )}
                {tab === "projecten" && (
                  <ProjectenTable projecten={projecten} />
                )}
                {tab === "facturen" && <FacturenTable facturen={facturen} />}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
