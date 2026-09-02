"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type {
  Adviseur,
  Afspraak,
  Factuur,
  Lead,
  LeadStatus,
  Offerte,
  Project,
} from "@/types/database";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import { formatDateTimeNl } from "@/lib/format";
import { statusTone } from "@/lib/labels";
import { LeadStatusSelectOptions } from "./LeadStatusSelectOptions";
import { geenContactPogingLabel } from "@/lib/bel-queue";
import { normalizeAfspraakSoort } from "@/lib/afspraak-soort";
import { appendLeadNotitie } from "@/lib/lead-notitie";
import { OffertesTable } from "./OffertesTable";
import { ProjectenTable } from "./ProjectenTable";
import { FacturenTable } from "./FacturenTable";
import { MaakOfferteModal } from "./MaakOfferteModal";
import { LeadAdresEditor } from "./LeadAdresEditor";
import { LeadContactEditor } from "./LeadContactEditor";
import { LeadTimeline } from "./LeadTimeline";
import { LeadAfspraakPlannen } from "./LeadAfspraakPlannen";
import {
  BackLink,
  Breadcrumb,
  DetailShell,
  NotFoundState,
  Panel,
} from "./DetailChrome";

type Section = "offertes" | "projecten" | "facturen";

export function LeadPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [lead, setLead] = useState<Lead | null>(null);
  const [offertes, setOffertes] = useState<Offerte[]>([]);
  const [projecten, setProjecten] = useState<Project[]>([]);
  const [facturen, setFacturen] = useState<Factuur[]>([]);
  const [afspraken, setAfspraken] = useState<Afspraak[]>([]);
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [section, setSection] = useState<Section>("offertes");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [maakOfferteOpen, setMaakOfferteOpen] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [timelineTick, setTimelineTick] = useState(0);
  const [terugbelDraft, setTerugbelDraft] = useState("");
  const [savingTerugbel, setSavingTerugbel] = useState(false);
  const [kwalReden, setKwalReden] = useState("");
  const [showKwalForm, setShowKwalForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);

    if (!hasSupabaseConfig()) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      const sb = getSupabaseBrowser();
      const [l, o, p, f, a, advRes] = await Promise.all([
        sb.from("leads").select("*").eq("id", id).single(),
        sb
          .from("offertes")
          .select(
            "*, leads(naam, email, lead_number, postcode, huisnummer, plaats)"
          )
          .eq("lead_id", id)
          .order("created_at", { ascending: false }),
        sb
          .from("projecten")
          .select("*, leads(naam, lead_number)")
          .eq("lead_id", id)
          .order("created_at", { ascending: false }),
        sb
          .from("facturen")
          .select("*, leads(naam, lead_number)")
          .eq("lead_id", id)
          .order("created_at", { ascending: false }),
        sb
          .from("afspraken")
          .select("*")
          .eq("lead_id", id)
          .in("status", ["gepland", "bevestigd"])
          .gte("start_at", new Date().toISOString())
          .order("start_at", { ascending: true })
          .limit(8),
        fetch("/api/adviseurs").then((r) => r.json()),
      ]);

      if (l.error || !l.data) {
        setNotFound(true);
      } else {
        let leadData = l.data as Lead;
        const advList = (advRes.adviseurs as Adviseur[]) || [];
        const linked = advList.find((a) => a.id === leadData.adviseur_id);

        // Adres leeg + postcode/huisnr bekend → vul straat/plaats via API en sla op
        if (
          (!leadData.straat?.trim() || !leadData.plaats?.trim()) &&
          leadData.postcode?.trim() &&
          leadData.huisnummer?.trim()
        ) {
          try {
            const qs = new URLSearchParams({
              postcode: leadData.postcode,
              number: leadData.huisnummer,
            });
            if (leadData.toevoeging?.trim()) {
              qs.set("toevoeging", leadData.toevoeging.trim());
            }
            const pcRes = await fetch(`/api/postcode?${qs}`);
            if (pcRes.ok) {
              const pc = await pcRes.json();
              const patch: Partial<Lead> = {};
              if (!leadData.straat?.trim() && pc.straat) patch.straat = pc.straat;
              if (!leadData.plaats?.trim() && pc.plaats) patch.plaats = pc.plaats;
              if (Object.keys(patch).length > 0) {
                const sb = getSupabaseBrowser();
                await sb.from("leads").update(patch).eq("id", leadData.id);
                leadData = { ...leadData, ...patch };
              }
            }
          } catch {
            /* non-blocking */
          }
        }

        setLead({
          ...leadData,
          adviseurs: linked
            ? { id: linked.id, naam: linked.naam }
            : null,
        });
        setNoteDraft("");
        setTerugbelDraft(leadData.terugbel_notitie || "");
        setOffertes((o.data as Offerte[]) || []);
        setProjecten((p.data as Project[]) || []);
        setFacturen((f.data as Factuur[]) || []);
        setAfspraken((a.data as Afspraak[]) || []);
        setAdviseurs(advList);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void load();
    });
    return () => cancelAnimationFrame(frame);
  }, [load]);

  function openSignLink(o: Offerte) {
    if (!o.sign_token) return;
    window.open(`/offerte/${o.sign_token}`, "_blank");
  }

  async function updateStatus(status: LeadStatus, extraNotitie?: string) {
    if (!lead) return;
    if (status === "niet_gekwalificeerd" && !extraNotitie?.trim()) {
      setShowKwalForm(true);
      return;
    }
    const prev = lead.status;
    const prevNotes = lead.notities;
    const notities = extraNotitie?.trim()
      ? appendLeadNotitie(lead.notities, extraNotitie.trim())
      : lead.notities;
    setLead({ ...lead, status, notities });
    setShowKwalForm(false);
    setKwalReden("");
    try {
      const sb = getSupabaseBrowser();
      const { error } = await sb
        .from("leads")
        .update({ status, notities })
        .eq("id", lead.id);
      if (error) throw error;
      void fetch(`/api/leads/${lead.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort: "status",
          titel: `Status → ${status}`,
          detail: extraNotitie?.trim() || null,
        }),
      }).catch(() => {});
      const { fireMetaCapiSync } = await import("@/lib/meta-capi-client");
      fireMetaCapiSync(lead.id);
    } catch {
      setLead({ ...lead, status: prev, notities: prevNotes });
    }
  }

  async function moveToCallcenter() {
    if (!lead) return;
    const reden = window.prompt("Notitie voor callcenter (verplicht):");
    if (reden === null) return;
    const note = reden.trim();
    if (!note) return;
    await updateStatus("vervolg_geen_contact", `Callcenter: ${note}`);
  }

  async function updateAdviseur(adviseurId: string | null) {
    if (!lead) return;
    const prevId = lead.adviseur_id;
    const prevJoin = lead.adviseurs;
    const adv = adviseurs.find((a) => a.id === adviseurId) || null;
    setLead({
      ...lead,
      adviseur_id: adviseurId,
      adviseurs: adv ? { id: adv.id, naam: adv.naam } : null,
    });
    try {
      const sb = getSupabaseBrowser();
      const { error } = await sb
        .from("leads")
        .update({ adviseur_id: adviseurId })
        .eq("id", lead.id);
      if (error) throw error;
    } catch {
      setLead({ ...lead, adviseur_id: prevId, adviseurs: prevJoin });
    }
  }

  async function saveTerugbel(actief: boolean) {
    if (!lead) return;
    const note = terugbelDraft.trim() || null;
    if (actief && !note) {
      setOkMsg("Vul een terugbelnotitie in.");
      return;
    }
    setSavingTerugbel(true);
    try {
      const sb = getSupabaseBrowser();
      const patch = {
        terugbellen: actief,
        terugbel_notitie: actief ? note : null,
      };
      const { error } = await sb.from("leads").update(patch).eq("id", lead.id);
      if (error) {
        if (
          error.message?.includes("terugbellen") ||
          error.message?.includes("terugbel_notitie") ||
          error.code === "42703"
        ) {
          throw new Error(
            "Voer eerst supabase/migrate-lead-terugbellen.sql uit in Supabase."
          );
        }
        throw error;
      }
      if (!actief) {
        const openBel = afspraken.filter(
          (a) =>
            (a.status === "gepland" ||
              a.status === "bevestigd" ||
              a.status === "verzet") &&
            (normalizeAfspraakSoort(a.soort) === "bel" ||
              normalizeAfspraakSoort(a.soort) === "warme_bel")
        );
        for (const a of openBel) {
          await sb.from("afspraken").update({ status: "voltooid" }).eq("id", a.id);
        }
        if (openBel.length > 0) {
          setAfspraken((prev) =>
            prev.map((a) =>
              openBel.some((o) => o.id === a.id)
                ? { ...a, status: "voltooid" }
                : a
            )
          );
        }
      }
      setLead({ ...lead, ...patch });
      if (!actief) setTerugbelDraft("");
      setTimelineTick((t) => t + 1);
      void fetch(`/api/leads/${lead.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort: "terugbel",
          titel: actief
            ? "Terugbelnotitie gezet"
            : "Terugbellen afgevinkt",
          detail: actief ? note : null,
        }),
      }).catch(() => {});
      setOkMsg(
        actief
          ? "Terugbelnotitie gezet — lead staat gemarkeerd om terug te bellen."
          : "Terugbellen afgevinkt."
      );
    } catch (e) {
      setOkMsg(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSavingTerugbel(false);
    }
  }

  async function addNotitie() {
    if (!lead) return;
    const text = noteDraft.trim();
    if (!text) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/events`, {
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
      setOkMsg("Notitie toegevoegd.");
    } catch (e) {
      setOkMsg(e instanceof Error ? e.message : "Notitie opslaan mislukt");
    } finally {
      setSavingNote(false);
    }
  }

  if (loading && !lead) {
    return (
      <DetailShell activeTab="leads">
        <p className="py-20 text-center text-sm text-muted">Lead laden…</p>
      </DetailShell>
    );
  }

  if (notFound || !lead) {
    return (
      <NotFoundState
        title="Lead niet gevonden"
        backHref="/"
        backLabel="Terug naar leads"
        activeTab="leads"
      />
    );
  }

  const sections: { id: Section; label: string; count: number }[] = [
    { id: "offertes", label: "Offertes", count: offertes.length },
    { id: "projecten", label: "Backoffice", count: projecten.length },
    { id: "facturen", label: "Facturen", count: facturen.length },
  ];

  const statusLabel: Record<Afspraak["status"], string> = {
    gepland: "Gepland",
    bevestigd: "Bevestigd",
    verzet: "Verzet",
    voltooid: "Voltooid",
    geannuleerd: "Geannuleerd",
  };

  return (
    <DetailShell onRefresh={load} loading={loading} activeTab="leads">
      <Breadcrumb
        items={[{ label: "Leads", href: "/" }, { label: lead.lead_number }]}
      />

      <section className="border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-4 py-5 sm:px-6">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-semibold tracking-wide text-green-dark">
              {lead.lead_number}
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-green-deeper sm:text-3xl">
              {lead.naam}
            </h1>
            {(lead.terugbellen ||
              lead.status === "geen_contact" ||
              (lead.belpogingen ?? 0) > 0) && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {lead.terugbellen && (
                  <span className="inline-flex items-center border border-[#C45A12]/30 bg-[#FFF0E6] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#C45A12]">
                    Terugbellen
                  </span>
                )}
                {(lead.status === "geen_contact" ||
                  (lead.belpogingen ?? 0) > 0) && (
                  <span className="inline-flex items-center border border-line bg-wash px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                    {geenContactPogingLabel(lead.belpogingen ?? 0)}
                  </span>
                )}
              </div>
            )}
            <p className="mt-2 text-sm text-muted">
              Aangemaakt {formatDateTimeNl(lead.created_at)}
              {lead.bron ? ` · via ${lead.bron}` : ""}
            </p>
          </div>
          <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
            <Link
              href={`/advies/${lead.id}`}
              className="bg-green px-3.5 py-2 text-xs font-semibold text-white hover:bg-green-dark"
            >
              Start adviesproces
            </Link>
            <button
              type="button"
              onClick={() => {
                setSection("offertes");
                setMaakOfferteOpen(true);
              }}
              className="bg-orange px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#e0651c]"
            >
              Maak offerte
            </button>
            <select
              value={lead.adviseur_id || ""}
              onChange={(e) =>
                void updateAdviseur(e.target.value ? e.target.value : null)
              }
              className="max-w-[10rem] cursor-pointer border border-line bg-white px-2.5 py-2 text-xs outline-none focus:border-green"
              aria-label="Koppel adviseur"
            >
              <option value="">Geen adviseur</option>
              {adviseurs.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.naam}
                </option>
              ))}
            </select>
            <select
              value={lead.status}
              onChange={(e) => {
                const next = e.target.value as LeadStatus;
                if (next === "niet_gekwalificeerd") {
                  setShowKwalForm(true);
                  return;
                }
                void updateStatus(next);
              }}
              className={`max-w-[14rem] cursor-pointer border bg-white px-2.5 py-2 text-[11px] font-bold uppercase tracking-wide outline-none focus:border-green ${statusTone("lead", lead.status)}`}
              aria-label="Lead status"
            >
              <LeadStatusSelectOptions />
            </select>
          </div>
        </div>

        {lead.status === "na_afspraak" && (
          <div className="mx-4 mt-5 border border-[#C45A12]/25 bg-[#FFF0E6] px-4 py-4 sm:mx-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#C45A12]">
              Uitkomst afspraak
            </p>
            <p className="mt-1 text-sm text-ink">
              Kies wat er na het bezoek volgt. Vervolg plan je in de agenda.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/?tab=agenda"
                className="border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-green/50"
              >
                Vervolg afspraak (agenda)
              </Link>
              <button
                type="button"
                onClick={() => void updateStatus("offerte_afgewezen")}
                className="border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-green/50"
              >
                Offerte afgewezen
              </button>
              <button
                type="button"
                onClick={() => void moveToCallcenter()}
                className="border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-green/50"
              >
                Callcenter
              </button>
              <button
                type="button"
                onClick={() => setShowKwalForm(true)}
                className="border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:border-green/50"
              >
                Niet goed gekwalificeerd
              </button>
            </div>
          </div>
        )}

        {showKwalForm && (
          <div className="mx-4 mt-4 border border-line bg-wash px-4 py-4 sm:mx-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Reden niet gekwalificeerd
            </p>
            <textarea
              value={kwalReden}
              onChange={(e) => setKwalReden(e.target.value)}
              rows={3}
              placeholder="Waarom is deze lead niet goed gekwalificeerd?"
              className="mt-2 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={!kwalReden.trim()}
                onClick={() =>
                  void updateStatus(
                    "niet_gekwalificeerd",
                    `Niet gekwalificeerd: ${kwalReden.trim()}`
                  )
                }
                className="bg-orange px-3 py-2 text-xs font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
              >
                Opslaan
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowKwalForm(false);
                  setKwalReden("");
                }}
                className="border border-line px-3 py-2 text-xs font-semibold text-muted hover:bg-white"
              >
                Annuleren
              </button>
            </div>
          </div>
        )}

        <div className="grid items-stretch gap-0 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-0 border-b border-line lg:border-b-0 lg:border-r">
            <div className="border-b border-line px-4 py-5 sm:px-6">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                Contact
              </h2>
              <div className="mt-4">
                <LeadContactEditor
                  lead={lead}
                  onSaved={(patch) =>
                    setLead((prev) => (prev ? { ...prev, ...patch } : prev))
                  }
                />
              </div>
            </div>

            <div className="border-b border-line px-4 py-5 sm:px-6">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                Adres
              </h2>
              <div className="mt-4">
                <LeadAdresEditor
                  lead={lead}
                  onSaved={(patch) =>
                    setLead((prev) => (prev ? { ...prev, ...patch } : prev))
                  }
                />
              </div>
            </div>

            <div className="grid gap-0 sm:grid-cols-2">
              <div className="border-b border-line px-4 py-4 sm:border-b-0 sm:border-r sm:px-6 sm:py-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Adviseur
                </p>
                <p
                  className={`mt-1.5 text-sm font-medium ${lead.adviseur_id ? "text-orange" : "text-ink"}`}
                >
                  {lead.adviseurs?.naam || "Niet gekoppeld"}
                </p>
              </div>
              <div className="px-4 py-4 sm:px-6 sm:py-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Bron / ads
                </p>
                {(lead.lander ||
                  lead.campaign_name ||
                  lead.ad_name ||
                  lead.utm_medium ||
                  lead.utm_campaign ||
                  lead.utm_source) ? (
                  <div className="mt-1.5 space-y-0.5 text-sm text-ink">
                    {lead.lander && <p>{lead.lander}</p>}
                    {(lead.campaign_name || lead.utm_campaign) && (
                      <p className="text-muted">
                        {lead.campaign_name || lead.utm_campaign}
                      </p>
                    )}
                    {lead.ad_name && (
                      <p className="text-xs text-muted">{lead.ad_name}</p>
                    )}
                    {(lead.utm_source || lead.utm_medium) && (
                      <p className="text-xs text-muted">
                        {[lead.utm_source, lead.utm_medium]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-1.5 text-sm text-muted">—</p>
                )}
              </div>
            </div>
          </div>

          <aside className="flex min-w-0 flex-col bg-wash/40 px-4 py-5 sm:px-6">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                Geplande afspraken
              </h2>
              {afspraken.length > 0 && (
                <span className="text-[11px] tabular-nums text-muted">
                  {afspraken.length}
                </span>
              )}
            </div>
            {afspraken.length === 0 ? (
              <div className="mt-4 flex flex-1 flex-col gap-3">
                <div className="border border-dashed border-line bg-white px-4 py-6 text-center">
                  <p className="text-sm font-medium text-ink">Nog geen afspraken</p>
                  <p className="mt-1 text-xs text-muted">
                    Plan hieronder direct in — bevestigingsmail gaat mee.
                  </p>
                </div>
                <LeadAfspraakPlannen
                  lead={lead}
                  adviseurs={adviseurs}
                  onPlanned={() => {
                    setOkMsg("Afspraak gepland.");
                    setTimelineTick((t) => t + 1);
                    void load();
                  }}
                />
              </div>
            ) : (
              <div className="mt-4 flex flex-1 flex-col gap-3">
                <ul className="divide-y divide-line border border-line bg-white">
                  {afspraken.map((afspraak) => (
                    <li key={afspraak.id} className="px-3.5 py-3">
                      <p className="text-sm font-semibold text-ink">
                        {formatDateTimeNl(afspraak.start_at)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {statusLabel[afspraak.status]}
                        {afspraak.soort ? ` · ${afspraak.soort}` : ""}
                      </p>
                      {afspraak.notities?.trim() && (
                        <p className="mt-1 text-xs text-muted">
                          {afspraak.notities}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                <LeadAfspraakPlannen
                  lead={lead}
                  adviseurs={adviseurs}
                  onPlanned={() => {
                    setOkMsg("Afspraak gepland.");
                    setTimelineTick((t) => t + 1);
                    void load();
                  }}
                />
              </div>
            )}
          </aside>
        </div>

        <div className="border-t border-line px-4 py-5 sm:px-6">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            Notitie toevoegen
          </h2>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={3}
            placeholder="Schrijf een notitie…"
            className="mt-3 w-full border border-line bg-wash px-3 py-2.5 text-sm leading-relaxed text-ink outline-none transition focus:border-green focus:bg-white"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void addNotitie()}
              disabled={savingNote || !noteDraft.trim()}
              className="bg-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50"
            >
              {savingNote ? "Opslaan…" : "Notitie toevoegen"}
            </button>
          </div>
          {lead.notities?.trim() && (
            <div className="mt-4 border border-line bg-wash/30 px-3.5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Intake / vaste info
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {lead.notities}
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-line px-4 py-5 sm:px-6">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            Geschiedenis
          </h2>
          <div className="mt-3 border border-line bg-wash/30 px-4 py-4">
            <LeadTimeline leadId={lead.id} refreshKey={timelineTick} />
          </div>
        </div>

        <div className="border-t border-line px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              Terugbellen
            </p>
            <p className="text-[11px] text-muted">
              Zichtbaar in de leadlijst tot je het afvinkt
            </p>
          </div>
          {lead.terugbellen && lead.terugbel_notitie?.trim() && (
            <div className="mt-3 border border-[#C45A12]/30 bg-[#FFF0E6] px-3.5 py-3 text-sm leading-relaxed text-ink">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C45A12]">
                Terugbelnotitie
              </p>
              <p className="mt-1 whitespace-pre-wrap">{lead.terugbel_notitie}</p>
            </div>
          )}
          <textarea
            value={terugbelDraft}
            onChange={(e) => setTerugbelDraft(e.target.value)}
            rows={3}
            placeholder="Bijv. niet opgenomen, bel morgenavond terug…"
            className="mt-3 w-full border border-line bg-wash px-3 py-2.5 text-sm leading-relaxed text-ink outline-none transition focus:border-green focus:bg-white"
          />
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {lead.terugbellen && (
              <button
                type="button"
                onClick={() => void saveTerugbel(false)}
                disabled={savingTerugbel}
                className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-muted hover:bg-wash disabled:opacity-50"
              >
                Afgevinkt — gebeld
              </button>
            )}
            <button
              type="button"
              onClick={() => void saveTerugbel(true)}
              disabled={savingTerugbel || !terugbelDraft.trim()}
              className="bg-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50"
            >
              {savingTerugbel
                ? "Opslaan…"
                : lead.terugbellen
                  ? "Notitie bijwerken"
                  : "Zet terugbellen"}
            </button>
          </div>
        </div>
      </section>

      {okMsg && (
        <div className="mb-4 border border-green/30 bg-green-soft px-4 py-3 text-sm text-green-dark">
          {okMsg}
        </div>
      )}

      <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={[
              "border px-2 py-3 text-left transition sm:px-4 sm:py-3.5",
              section === s.id
                ? "border-green bg-green-soft"
                : "border-line bg-white hover:border-green/40",
            ].join(" ")}
          >
            <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted sm:text-[10px]">
              {s.label}
            </p>
            <p className="mt-1 font-display text-xl font-semibold tabular-nums text-green-deeper sm:text-2xl">
              {s.count}
            </p>
          </button>
        ))}
      </div>

      <Panel
        title={sections.find((s) => s.id === section)?.label || ""}
        subtitle={`Gekoppeld aan ${lead.lead_number}`}
      >
        {section === "offertes" && (
          <>
            <div className="flex justify-end border-b border-line px-4 py-3">
              <button
                type="button"
                onClick={() => setMaakOfferteOpen(true)}
                className="bg-orange px-4 py-2 text-sm font-semibold text-white hover:bg-[#e0651c]"
              >
                Maak offerte
              </button>
            </div>
            <OffertesTable offertes={offertes} onOpenSign={openSignLink} />
          </>
        )}
        {section === "projecten" && <ProjectenTable projecten={projecten} />}
        {section === "facturen" && <FacturenTable facturen={facturen} />}
      </Panel>

      <BackLink href="/" label="Alle leads" />

      <MaakOfferteModal
        open={maakOfferteOpen}
        leadId={lead.id}
        leadNaam={lead.naam}
        onClose={() => setMaakOfferteOpen(false)}
        onCreated={(offerteId) => {
          setMaakOfferteOpen(false);
          router.push(`/offertes/${offerteId}`);
        }}
      />
    </DetailShell>
  );
}
