"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Adviseur, Factuur, Lead, LeadStatus, Offerte, Project } from "@/types/database";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import { adresRegel, formatDateTimeNl } from "@/lib/format";
import { LEAD_STATUSES, leadStatusLabel, statusTone } from "@/lib/labels";
import { OffertesTable } from "./OffertesTable";
import { ProjectenTable } from "./ProjectenTable";
import { FacturenTable } from "./FacturenTable";
import { MaakOfferteModal } from "./MaakOfferteModal";
import {
  BackLink,
  Breadcrumb,
  DetailShell,
  HeroCard,
  InfoTile,
  NotFoundState,
  Panel,
} from "./DetailChrome";

type Section = "offertes" | "projecten" | "facturen";

export function LeadPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [lead, setLead] = useState<Lead | null>(null);
  const [offertes, setOffertes] = useState<Offerte[]>([]);
  const [projecten, setProjecten] = useState<Project[]>([]);
  const [facturen, setFacturen] = useState<Factuur[]>([]);
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [section, setSection] = useState<Section>("offertes");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [maakOfferteOpen, setMaakOfferteOpen] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [notitiesDraft, setNotitiesDraft] = useState("");
  const [savingNotities, setSavingNotities] = useState(false);
  const [terugbelDraft, setTerugbelDraft] = useState("");
  const [savingTerugbel, setSavingTerugbel] = useState(false);

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
      const [l, o, p, f, advRes] = await Promise.all([
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
        setNotitiesDraft(leadData.notities || "");
        setTerugbelDraft(leadData.terugbel_notitie || "");
        setOffertes((o.data as Offerte[]) || []);
        setProjecten((p.data as Project[]) || []);
        setFacturen((f.data as Factuur[]) || []);
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

  async function updateStatus(status: LeadStatus) {
    if (!lead) return;
    const prev = lead.status;
    setLead({ ...lead, status });
    try {
      const sb = getSupabaseBrowser();
      const { error } = await sb
        .from("leads")
        .update({ status })
        .eq("id", lead.id);
      if (error) throw error;
    } catch {
      setLead({ ...lead, status: prev });
    }
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
      setLead({ ...lead, ...patch });
      if (!actief) setTerugbelDraft("");
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

  async function saveNotities() {
    if (!lead) return;
    const next = notitiesDraft.trim() || null;
    if ((lead.notities || null) === next) return;
    setSavingNotities(true);
    try {
      const sb = getSupabaseBrowser();
      const { error } = await sb
        .from("leads")
        .update({ notities: next })
        .eq("id", lead.id);
      if (error) throw error;
      setLead({ ...lead, notities: next });
      setOkMsg("Notitie opgeslagen.");
    } catch {
      setOkMsg(null);
    } finally {
      setSavingNotities(false);
    }
  }

  if (loading) {
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
    { id: "projecten", label: "Projecten", count: projecten.length },
    { id: "facturen", label: "Facturen", count: facturen.length },
  ];

  return (
    <DetailShell onRefresh={load} loading={loading} activeTab="leads">
      <Breadcrumb
        items={[{ label: "Leads", href: "/" }, { label: lead.lead_number }]}
      />

      <HeroCard>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-semibold text-green-dark">
              {lead.lead_number}
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-green-deeper sm:text-3xl">
              {lead.naam}
            </h1>
            {lead.terugbellen && (
              <p className="mt-2 inline-flex items-center rounded-full border border-[#C45A12]/30 bg-[#FFF0E6] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#C45A12]">
                Terugbellen
              </p>
            )}
            <p className="mt-2 text-sm text-muted">
              Aangemaakt {formatDateTimeNl(lead.created_at)}
              {lead.bron ? ` · via ${lead.bron}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/advies/${lead.id}`}
              className="bg-green px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-green-dark sm:text-xs sm:normal-case sm:tracking-normal"
            >
              Start adviesproces
            </Link>
            <button
              type="button"
              onClick={() => {
                setSection("offertes");
                setMaakOfferteOpen(true);
              }}
              className="bg-orange px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-[#e0651c] sm:text-xs sm:normal-case sm:tracking-normal"
            >
              Maak offerte
            </button>
            <select
              value={lead.adviseur_id || ""}
              onChange={(e) =>
                void updateAdviseur(e.target.value ? e.target.value : null)
              }
              className="cursor-pointer border border-line bg-white px-2.5 py-1.5 text-[11px] outline-none focus:border-green"
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
              onChange={(e) => updateStatus(e.target.value as LeadStatus)}
              className={`cursor-pointer border bg-white px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide outline-none focus:border-green ${statusTone("lead", lead.status)}`}
              aria-label="Lead status"
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {leadStatusLabel[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoTile label="E-mail" value={lead.email} />
          <InfoTile label="Telefoon" value={lead.telefoon} />
          <InfoTile label="Adres" value={adresRegel(lead)} />
          <InfoTile
            label="Adviseur"
            value={lead.adviseurs?.naam || "Niet gekoppeld"}
            accent={Boolean(lead.adviseur_id)}
          />
        </div>

        {(lead.utm_medium || lead.utm_campaign) && (
          <div className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-2">
            {lead.utm_medium && (
              <InfoTile label="utm_medium" value={lead.utm_medium} />
            )}
            {lead.utm_campaign && (
              <InfoTile label="utm_campaign" value={lead.utm_campaign} />
            )}
          </div>
        )}

        <div className="mt-5 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Terugbellen
            </p>
            <p className="text-[11px] text-muted">
              Zichtbaar in de leadlijst tot je het afvinkt
            </p>
          </div>
          {lead.terugbellen && lead.terugbel_notitie?.trim() && (
            <div className="mt-2 border border-[#C45A12]/30 bg-[#FFF0E6] px-3.5 py-3 text-sm leading-relaxed text-ink">
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
            className="mt-2 w-full border border-line bg-white px-3 py-2.5 text-sm leading-relaxed text-ink outline-none focus:border-green"
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

        <div className="mt-5 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Notities
            </p>
            <p className="text-[11px] text-muted">
              Zichtbaar bij afspraken in de agenda
            </p>
          </div>
          <textarea
            value={notitiesDraft}
            onChange={(e) => setNotitiesDraft(e.target.value)}
            rows={4}
            placeholder="Bijv. zonnepanelen aanwezig, bel vooraf, sleutel bij buren…"
            className="mt-2 w-full border border-line bg-white px-3 py-2.5 text-sm leading-relaxed text-ink outline-none focus:border-green"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void saveNotities()}
              disabled={
                savingNotities ||
                (lead.notities || "") === (notitiesDraft.trim() || "")
              }
              className="bg-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50"
            >
              {savingNotities ? "Opslaan…" : "Notitie opslaan"}
            </button>
          </div>
        </div>
      </HeroCard>

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
        onCreated={(signUrl) => {
          setOkMsg(
            signUrl
              ? "Offerte aangemaakt en naar de klant gemaild."
              : "Offerte aangemaakt."
          );
          setSection("offertes");
          void load();
        }}
      />
    </DetailShell>
  );
}
