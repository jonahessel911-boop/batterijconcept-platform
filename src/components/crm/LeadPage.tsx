"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type {
  Adviseur,
  Afspraak,
  Lead,
  LeadStatus,
} from "@/types/database";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import { formatDateTimeNl } from "@/lib/format";
import { statusTone } from "@/lib/labels";
import { LeadStatusSelectOptions } from "./LeadStatusSelectOptions";
import {
  afspraakSoortLabel,
  isTerugbelSoort,
  normalizeAfspraakSoort,
} from "@/lib/afspraak-soort";
import { appendLeadNotitie } from "@/lib/lead-notitie";
import { MaakOfferteModal } from "./MaakOfferteModal";
import { LeadAdresEditor } from "./LeadAdresEditor";
import { LeadContactEditor } from "./LeadContactEditor";
import { LeadAfspraakPlannen } from "./LeadAfspraakPlannen";
import { LeadActivityPanel } from "./LeadActivityPanel";
import {
  BackLink,
  Breadcrumb,
  DetailShell,
  NotFoundState,
} from "./DetailChrome";

const ACTIEVE_AFSPRAAK = new Set(["gepland", "bevestigd", "verzet"]);

function isActieveTerugbel(a: Afspraak): boolean {
  return ACTIEVE_AFSPRAAK.has(a.status) && isTerugbelSoort(a.soort);
}

function PencilIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function adresRegel(lead: Lead): string {
  const straat = [lead.straat, [lead.huisnummer, lead.toevoeging].filter(Boolean).join("")]
    .filter(Boolean)
    .join(" ");
  const plaats = [lead.postcode, lead.plaats].filter(Boolean).join(" ");
  return [straat, plaats].filter(Boolean).join(", ") || "—";
}

export function LeadPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [lead, setLead] = useState<Lead | null>(null);
  const [afspraken, setAfspraken] = useState<Afspraak[]>([]);
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [maakOfferteOpen, setMaakOfferteOpen] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [editingGegevens, setEditingGegevens] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [kwalReden, setKwalReden] = useState("");
  const [showKwalForm, setShowKwalForm] = useState(false);
  const [activityKey, setActivityKey] = useState(0);
  const [completingAfspraakId, setCompletingAfspraakId] = useState<string | null>(
    null
  );

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
      const [l, a, advRes] = await Promise.all([
        sb.from("leads").select("*").eq("id", id).single(),
        sb
          .from("afspraken")
          .select("*, adviseurs!adviseur_id(naam)")
          .eq("lead_id", id)
          .order("start_at", { ascending: false })
          .limit(20),
        fetch("/api/adviseurs").then((r) => r.json()),
      ]);

      if (l.error || !l.data) {
        setNotFound(true);
      } else {
        let leadData = l.data as Lead;
        const advList = (advRes.adviseurs as Adviseur[]) || [];
        const linked = advList.find((x) => x.id === leadData.adviseur_id);

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
          adviseurs: linked ? { id: linked.id, naam: linked.naam } : null,
        });
        setNoteDraft("");
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
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

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

      // Ook op lead.notities zetten zodat het meteen zichtbaar blijft
      const merged = appendLeadNotitie(lead.notities, text);
      const sb = getSupabaseBrowser();
      await sb.from("leads").update({ notities: merged }).eq("id", lead.id);
      setLead({ ...lead, notities: merged });
      setNoteDraft("");
      setOkMsg("Notitie opgeslagen.");
      setActivityKey((k) => k + 1);
    } catch (e) {
      setOkMsg(e instanceof Error ? e.message : "Notitie opslaan mislukt");
    } finally {
      setSavingNote(false);
    }
  }

  /** Terugbel-afspraak afvinken + lead-vlag wissen (zelfde flow als Bellen). */
  async function voltooiTerugbel(afspraakId: string) {
    if (!lead) return;
    setCompletingAfspraakId(afspraakId);
    setOkMsg(null);
    try {
      const sb = getSupabaseBrowser();
      const { error: afErr } = await sb
        .from("afspraken")
        .update({ status: "voltooid" })
        .eq("id", afspraakId);
      if (afErr) throw afErr;

      const otherOpen = afspraken.some(
        (a) => a.id !== afspraakId && isActieveTerugbel(a)
      );
      const patch: Partial<Lead> = otherOpen
        ? {}
        : { terugbellen: false, terugbel_notitie: null };
      if (Object.keys(patch).length > 0) {
        const { error: leadErr } = await sb
          .from("leads")
          .update(patch)
          .eq("id", lead.id);
        if (leadErr) throw leadErr;
        setLead({ ...lead, ...patch });
      }

      setAfspraken((prev) =>
        prev.map((a) =>
          a.id === afspraakId ? { ...a, status: "voltooid" } : a
        )
      );
      void fetch(`/api/leads/${lead.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort: "terugbel",
          titel: "Terugbelafspraak voltooid",
          detail: null,
        }),
      }).catch(() => {});
      setOkMsg("Terugbelafspraak gemarkeerd als voltooid.");
      setActivityKey((k) => k + 1);
    } catch (e) {
      setOkMsg(
        e instanceof Error ? e.message : "Voltooien van terugbel mislukt"
      );
    } finally {
      setCompletingAfspraakId(null);
    }
  }

  /** Alleen de terugbellen-vlag wissen (als er geen openstaande terugbel meer is). */
  async function wisTerugbelVlag() {
    if (!lead) return;
    setCompletingAfspraakId("flag");
    setOkMsg(null);
    try {
      const open = afspraken.filter(isActieveTerugbel);
      const sb = getSupabaseBrowser();
      for (const a of open) {
        const { error } = await sb
          .from("afspraken")
          .update({ status: "voltooid" })
          .eq("id", a.id);
        if (error) throw error;
      }
      const { error: leadErr } = await sb
        .from("leads")
        .update({ terugbellen: false, terugbel_notitie: null })
        .eq("id", lead.id);
      if (leadErr) throw leadErr;
      setLead({ ...lead, terugbellen: false, terugbel_notitie: null });
      setAfspraken((prev) =>
        prev.map((a) =>
          isActieveTerugbel(a) ? { ...a, status: "voltooid" } : a
        )
      );
      void fetch(`/api/leads/${lead.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort: "terugbel",
          titel: "Terugbelafspraak voltooid",
          detail: null,
        }),
      }).catch(() => {});
      setOkMsg("Terugbellen afgevinkt.");
      setActivityKey((k) => k + 1);
    } catch (e) {
      setOkMsg(e instanceof Error ? e.message : "Afvinken mislukt");
    } finally {
      setCompletingAfspraakId(null);
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

  const upcoming = afspraken.filter(
    (a) =>
      new Date(a.start_at) >= new Date() &&
      a.status !== "geannuleerd" &&
      a.status !== "voltooid"
  );
  const past = afspraken.filter(
    (a) =>
      !(
        new Date(a.start_at) >= new Date() &&
        a.status !== "geannuleerd" &&
        a.status !== "voltooid"
      )
  );
  const openTerugbel = afspraken.filter(isActieveTerugbel);
  const showTerugbelBanner = Boolean(lead.terugbellen) || openTerugbel.length > 0;

  function afspraakRow(a: Afspraak, variant: "upcoming" | "past") {
    const terugbel = isActieveTerugbel(a);
    return (
      <li
        key={a.id}
        className={
          variant === "upcoming"
            ? "flex flex-wrap items-center justify-between gap-2 border border-green/25 bg-green-soft/40 px-3 py-2.5"
            : "flex flex-wrap items-center justify-between gap-2 border border-line px-3 py-2.5"
        }
      >
        <div className="min-w-0">
          <p
            className={
              variant === "upcoming"
                ? "text-sm font-semibold text-ink"
                : "text-sm font-medium text-ink"
            }
          >
            {formatDateTimeNl(a.start_at)}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {afspraakSoortLabel[normalizeAfspraakSoort(a.soort)]}
            {variant === "upcoming" && a.adviseurs?.naam
              ? ` · ${a.adviseurs.naam}`
              : ""}
            {" · "}
            {a.status}
          </p>
        </div>
        {terugbel && (
          <button
            type="button"
            disabled={completingAfspraakId !== null}
            onClick={() => void voltooiTerugbel(a.id)}
            className="shrink-0 border border-[#C45A12]/40 bg-[#FFF0E6] px-2.5 py-1.5 text-xs font-semibold text-[#C45A12] hover:bg-[#FFE4D1] disabled:opacity-50"
          >
            {completingAfspraakId === a.id ? "Bezig…" : "Markeer voltooid"}
          </button>
        )}
      </li>
    );
  }

  return (
    <DetailShell onRefresh={load} loading={loading} activeTab="leads">
      <Breadcrumb
        items={[{ label: "Leads", href: "/" }, { label: lead.lead_number }]}
      />

      {okMsg && (
        <div className="mb-4 border border-green/30 bg-green-soft px-4 py-2.5 text-sm text-green-dark">
          {okMsg}
        </div>
      )}

      {showTerugbelBanner && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-[#C45A12]/30 bg-[#FFF8F3] px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#C45A12]">
              Openstaande terugbelafspraak
            </p>
            {lead.terugbel_notitie?.trim() ? (
              <p className="mt-0.5 text-xs text-[#C45A12]/90">
                {lead.terugbel_notitie}
              </p>
            ) : openTerugbel[0] ? (
              <p className="mt-0.5 text-xs text-[#C45A12]/90">
                Gepland: {formatDateTimeNl(openTerugbel[0].start_at)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={completingAfspraakId !== null}
            onClick={() => void wisTerugbelVlag()}
            className="shrink-0 bg-[#C45A12] px-3 py-2 text-xs font-semibold text-white hover:bg-[#A84A0E] disabled:opacity-50"
          >
            {completingAfspraakId === "flag"
              ? "Bezig…"
              : "Markeer als voltooid"}
          </button>
        </div>
      )}

      {/* Header */}
      <section className="border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-5 sm:px-6">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-semibold text-muted">
              {lead.lead_number}
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">
              {lead.naam}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {lead.adviseurs?.naam || "Geen adviseur"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            >
              <LeadStatusSelectOptions />
            </select>
            <button
              type="button"
              onClick={() => setMaakOfferteOpen(true)}
              className="bg-orange px-4 py-2 text-sm font-semibold text-white hover:bg-[#e0651c]"
            >
              Maak offerte
            </button>
          </div>
        </div>

        {showKwalForm && (
          <div className="border-t border-line bg-wash px-4 py-4 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Reden niet gekwalificeerd
            </p>
            <textarea
              value={kwalReden}
              onChange={(e) => setKwalReden(e.target.value)}
              rows={2}
              className="mt-2 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
              placeholder="Waarom?"
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
                className="bg-orange px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                Opslaan
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowKwalForm(false);
                  setKwalReden("");
                }}
                className="border border-line px-3 py-2 text-xs font-semibold text-muted"
              >
                Annuleren
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        {/* Gegevens */}
        <section className="border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              Gegevens
            </h2>
            <button
              type="button"
              onClick={() => setEditingGegevens((v) => !v)}
              className="inline-flex items-center gap-1.5 border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
              title={editingGegevens ? "Sluiten" : "Bewerken"}
            >
              <PencilIcon />
              {editingGegevens ? "Klaar" : "Bewerken"}
            </button>
          </div>

          {editingGegevens ? (
            <div className="space-y-5 px-4 py-4 sm:px-5">
              <LeadContactEditor
                lead={lead}
                onSaved={(patch) =>
                  setLead((prev) => (prev ? { ...prev, ...patch } : prev))
                }
              />
              <LeadAdresEditor
                lead={lead}
                onSaved={(patch) =>
                  setLead((prev) => (prev ? { ...prev, ...patch } : prev))
                }
              />
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                Adviseur
                <select
                  value={lead.adviseur_id || ""}
                  onChange={(e) =>
                    void updateAdviseur(e.target.value ? e.target.value : null)
                  }
                  className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                >
                  <option value="">Geen adviseur</option>
                  {adviseurs.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.naam}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="space-y-4 px-4 py-4 sm:px-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Telefoon
                  </p>
                  <p className="mt-1 text-sm font-medium text-ink">
                    {lead.telefoon ? (
                      <a href={`tel:${lead.telefoon}`} className="hover:underline">
                        {lead.telefoon}
                      </a>
                    ) : (
                      "—"
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    E-mail
                  </p>
                  <p className="mt-1 truncate text-sm font-medium text-ink">
                    {lead.email ? (
                      <a href={`mailto:${lead.email}`} className="hover:underline">
                        {lead.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Adres
                </p>
                <p className="mt-1 text-sm font-medium text-ink">
                  {adresRegel(lead)}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Afspraken */}
        <section className="border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              Afspraken
            </h2>
            <button
              type="button"
              onClick={() => setPlanOpen((v) => !v)}
              className="border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
            >
              {planOpen ? "Sluiten" : "+ Plannen"}
            </button>
          </div>

          <div className="px-4 py-4 sm:px-5">
            {planOpen && (
              <div className="mb-4 border border-line bg-wash/40 p-3">
                <LeadAfspraakPlannen
                  lead={lead}
                  adviseurs={adviseurs}
                  onPlanned={() => {
                    setOkMsg("Afspraak gepland.");
                    setPlanOpen(false);
                    setActivityKey((k) => k + 1);
                    void load();
                  }}
                />
              </div>
            )}

            {upcoming.length === 0 && past.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                Nog geen afspraken met deze klant.
              </p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((a) => afspraakRow(a, "upcoming"))}
                {past.slice(0, 4).map((a) => afspraakRow(a, "past"))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Notities */}
      <section className="mt-4 border border-line bg-white">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            Notities
          </h2>
        </div>
        <div className="px-4 py-4 sm:px-5">
          {lead.notities?.trim() && (
            <div className="mb-4 whitespace-pre-wrap border border-line bg-wash/30 px-3.5 py-3 text-sm leading-relaxed text-ink">
              {lead.notities}
            </div>
          )}
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={3}
            placeholder="Nieuwe notitie…"
            className="w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void addNotitie()}
              disabled={savingNote || !noteDraft.trim()}
              className="bg-orange px-3 py-2 text-xs font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50"
            >
              {savingNote ? "Opslaan…" : "Notitie opslaan"}
            </button>
          </div>
        </div>
      </section>

      <LeadActivityPanel leadId={lead.id} refreshKey={activityKey} />

      <div className="mt-4 flex flex-wrap gap-3">
        <BackLink href="/" label="Alle leads" />
        <Link
          href={`/advies/${lead.id}`}
          className="text-sm font-medium text-green-dark underline-offset-2 hover:underline"
        >
          Start adviesproces →
        </Link>
      </div>

      <MaakOfferteModal
        open={maakOfferteOpen}
        leadId={lead.id}
        leadNaam={lead.naam}
        onClose={() => setMaakOfferteOpen(false)}
        onCreated={(offerteId) => {
          setMaakOfferteOpen(false);
          setActivityKey((k) => k + 1);
          router.push(`/offertes/${offerteId}`);
        }}
      />
    </DetailShell>
  );
}
