"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type {
  Adviseur,
  Afspraak,
  Lead,
  LeadStatus,
} from "@/types/database";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import { formatDateTimeNl } from "@/lib/format";
import { leadStatusLabel, statusTone } from "@/lib/labels";
import { LeadStatusSelectOptions } from "./LeadStatusSelectOptions";
import {
  afspraakSoortLabel,
  isTerugbelSoort,
  normalizeAfspraakSoort,
} from "@/lib/afspraak-soort";
import { appendLeadNotitie } from "@/lib/lead-notitie";
import {
  MAX_BELPOGINGEN,
  buildGeenContactOutcomePatch,
} from "@/lib/bel-queue";
import { MaakOfferteModal } from "./MaakOfferteModal";
import { LeadAdresEditor } from "./LeadAdresEditor";
import { LeadContactEditor } from "./LeadContactEditor";
import { LeadAfspraakPlannen } from "./LeadAfspraakPlannen";
import { LeadTerugbelPlannen } from "./LeadTerugbelPlannen";
import { LeadActivityPanel } from "./LeadActivityPanel";
import {
  Breadcrumb,
  DetailShell,
  NotFoundState,
  TerugButton,
} from "./DetailChrome";
import { useCrmSession } from "@/hooks/useCrmSession";
import { alleenEigenLeads, magBekijkAls } from "@/lib/rollen";

const ACTIEVE_AFSPRAAK = new Set(["gepland", "bevestigd", "verzet"]);

function isActieveTerugbel(a: Afspraak): boolean {
  return ACTIEVE_AFSPRAAK.has(a.status) && isTerugbelSoort(a.soort);
}

function Icon({
  children,
  className = "h-4 w-4",
}: {
  children: React.ReactNode;
  className?: string;
}) {
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
      {children}
    </svg>
  );
}

function PencilIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
  );
}

function PhoneIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.74.32 1.53.55 2.34.68A2 2 0 0 1 22 16.92z" />
    </Icon>
  );
}

function MailIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </Icon>
  );
}

function MapPinIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </Icon>
  );
}

function CalendarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </Icon>
  );
}

function UserIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Icon>
  );
}

function NoteIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </Icon>
  );
}

function PlusIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

function FileIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </Icon>
  );
}

function SectionTitle({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
      <span className="text-green-dark/70">{icon}</span>
      {children}
    </h2>
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
  const searchParams = useSearchParams();
  const focusAfspraakId = searchParams.get("afspraak");
  const { session, rol } = useCrmSession();
  const eigenLeadsOnly = rol ? alleenEigenLeads(rol) : false;
  const kanToewijzen = rol ? magBekijkAls(rol) || rol === "backoffice" : false;
  /** Adviseurs boeken alleen af via de agenda — geen vrije status op leadpagina. */
  const kanStatusWijzigen = Boolean(rol) && !eigenLeadsOnly;

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
  /** null | huisbezoek | bel | warme_bel */
  const [planMode, setPlanMode] = useState<
    null | "huisbezoek" | "bel" | "warme_bel"
  >(null);
  const [kwalReden, setKwalReden] = useState("");
  const [showKwalForm, setShowKwalForm] = useState(false);
  const [activityKey, setActivityKey] = useState(0);
  const [completingAfspraakId, setCompletingAfspraakId] = useState<string | null>(
    null
  );
  const [annuleerAfspraakId, setAnnuleerAfspraakId] = useState<string | null>(
    null
  );
  const [annuleerNotitie, setAnnuleerNotitie] = useState("");
  const [annuleerBusy, setAnnuleerBusy] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
        sb
          .from("leads")
          .select("*, adviseurs!adviseur_id(id, naam)")
          .eq("id", id)
          .single(),
        sb
          .from("afspraken")
          .select("*, adviseurs!adviseur_id(naam)")
          .eq("lead_id", id)
          .order("start_at", { ascending: false })
          .limit(20),
        fetch("/api/adviseurs?include_inactive=1").then((r) => r.json()),
      ]);

      if (l.error || !l.data) {
        // Fallback zonder join (oudere schema's)
        const plain = await sb.from("leads").select("*").eq("id", id).single();
        if (plain.error || !plain.data) {
          setNotFound(true);
          return;
        }
        const leadData = plain.data as Lead;
        const advList = (advRes.adviseurs as Adviseur[]) || [];
        const linked = advList.find((x) => x.id === leadData.adviseur_id);
        setLead({
          ...leadData,
          adviseurs: linked ? { id: linked.id, naam: linked.naam } : null,
        });
        setNoteDraft("");
        setAfspraken((a.data as Afspraak[]) || []);
        setAdviseurs(advList);
        return;
      }

      let leadData = l.data as Lead;
      const advList = (advRes.adviseurs as Adviseur[]) || [];
      const joined = leadData.adviseurs;
      const linked =
        joined?.id && joined.naam
          ? joined
          : advList.find((x) => x.id === leadData.adviseur_id) || null;

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
    if (!kanStatusWijzigen) return;
    if (status === "niet_gekwalificeerd" && !extraNotitie?.trim()) {
      setShowKwalForm(true);
      return;
    }
    const prev = lead.status;
    const prevNotes = lead.notities;
    const prevBel = {
      belpogingen: lead.belpogingen,
      belpogingen_vandaag: lead.belpogingen_vandaag,
      laatst_gebeld_at: lead.laatst_gebeld_at,
      eerste_gebeld_at: lead.eerste_gebeld_at,
      beller_id: lead.beller_id,
      laatst_gebeld_door: lead.laatst_gebeld_door,
    };
    const notities = extraNotitie?.trim()
      ? appendLeadNotitie(lead.notities, extraNotitie.trim())
      : lead.notities;
    const gc =
      status === "geen_contact" ? buildGeenContactOutcomePatch(lead) : null;
    const patch: Partial<Lead> = gc
      ? { ...gc.patch, notities }
      : { status, notities };
    setLead({ ...lead, ...patch });
    setShowKwalForm(false);
    setKwalReden("");
    try {
      const sb = getSupabaseBrowser();
      let { error } = await sb.from("leads").update(patch).eq("id", lead.id);
      if (
        error &&
        (error.message?.includes("belpogingen_vandaag") ||
          error.code === "42703")
      ) {
        const { belpogingen_vandaag: _, ...withoutDay } = patch;
        const retry = await sb
          .from("leads")
          .update(withoutDay)
          .eq("id", lead.id);
        error = retry.error;
      }
      if (error) throw error;

      if (status === "geen_contact") {
        try {
          const res = await fetch("/api/bel/mark-called", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lead_id: lead.id,
              status: "geen_contact",
              eerste_gebeld: !lead.eerste_gebeld_at,
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            patch?: Partial<Lead>;
          };
          if (data.patch) {
            setLead((cur) => (cur ? { ...cur, ...data.patch } : cur));
          }
        } catch {
          /* non-blocking */
        }
      }

      void fetch(`/api/leads/${lead.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort: "status",
          titel: `Status → ${leadStatusLabel[status] || status}`,
          detail:
            status === "geen_contact" && gc
              ? `Belpoging ${gc.pogingen}/${MAX_BELPOGINGEN}`
              : extraNotitie?.trim() || null,
        }),
      }).catch(() => {});

      if (gc?.sendGeenContactMail && lead.email?.trim()) {
        void fetch(`/api/leads/${lead.id}/geen-contact-mail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ poging: gc.pogingen }),
        }).catch(() => {});
      }
      if (status === "foutief_nummer" && lead.email?.trim()) {
        void fetch(`/api/leads/${lead.id}/foutief-nummer-mail`, {
          method: "POST",
        }).catch(() => {});
      }

      const { fireMetaCapiSync } = await import("@/lib/meta-capi-client");
      fireMetaCapiSync(lead.id);
    } catch {
      setLead({
        ...lead,
        status: prev,
        notities: prevNotes,
        ...prevBel,
      });
    }
  }

  const salesAdviseurs = adviseurs.filter(
    (a) =>
      a.actief !== false &&
      (a.rol == null || a.rol === "adviseur" || a.rol === "admin")
  );

  async function updateAdviseur(adviseurId: string | null) {
    if (!lead) return;
    const prevId = lead.adviseur_id;
    const prevJoin = lead.adviseurs;
    const adv =
      adviseurs.find((a) => a.id === adviseurId) ||
      (session && session.id === adviseurId
        ? ({ id: session.id, naam: session.naam } as Adviseur)
        : null);
    setLead({
      ...lead,
      adviseur_id: adviseurId,
      adviseurs: adv ? { id: adv.id, naam: adv.naam } : null,
    });
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adviseur_id: adviseurId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      const moved = Number(
        (data as { afspraken_verplaatst?: number }).afspraken_verplaatst || 0
      );
      if (moved > 0) {
        setOkMsg(
          moved === 1
            ? "Adviseur bijgewerkt — 1 afspraak staat nu in die agenda."
            : `Adviseur bijgewerkt — ${moved} afspraken staan nu in die agenda.`
        );
      } else {
        setOkMsg(
          adviseurId
            ? `Toegewezen aan ${adv?.naam || "adviseur"}.`
            : "Adviseur verwijderd."
        );
      }
    } catch {
      setLead({ ...lead, adviseur_id: prevId, adviseurs: prevJoin });
      setOkMsg(null);
    }
  }

  async function claimLead() {
    if (!lead || !session) return;
    setClaimBusy(true);
    try {
      await updateAdviseur(session.id);
    } finally {
      setClaimBusy(false);
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

  function startAnnuleerAfspraak(afspraakId: string) {
    setAnnuleerAfspraakId(afspraakId);
    setAnnuleerNotitie("");
    setErrorMsg(null);
    setOkMsg(null);
  }

  function cancelAnnuleerForm() {
    setAnnuleerAfspraakId(null);
    setAnnuleerNotitie("");
  }

  async function bevestigAnnuleerAfspraak() {
    if (!annuleerAfspraakId) return;
    const notitie = annuleerNotitie.trim();
    if (notitie.length < 3) {
      setErrorMsg("Vul een notitie in bij annuleren (min. 3 tekens).");
      return;
    }
    setAnnuleerBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/afspraken", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: annuleerAfspraakId,
          action: "annuleer",
          notitie,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Annuleren mislukt"
        );
      }
      const next = (data as { afspraak?: Afspraak }).afspraak;
      setAfspraken((prev) =>
        prev.map((a) =>
          a.id === annuleerAfspraakId
            ? next || { ...a, status: "geannuleerd" }
            : a
        )
      );
      setAnnuleerAfspraakId(null);
      setAnnuleerNotitie("");
      setOkMsg("Afspraak geannuleerd.");
      setActivityKey((k) => k + 1);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Annuleren mislukt");
    } finally {
      setAnnuleerBusy(false);
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
  async function deleteLead() {
    if (!lead) return;
    if (
      !confirm(
        `Lead ${lead.lead_number} (${lead.naam}) definitief verwijderen?\n\nAfspraken, notities, offertes en conceptfacturen gaan mee. Dit kan niet ongedaan worden.`
      )
    ) {
      return;
    }
    setDeleteBusy(true);
    setErrorMsg(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Verwijderen mislukt"
        );
      }
      router.push("/?tab=leads");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Verwijderen mislukt");
      setDeleteBusy(false);
    }
  }

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

  useEffect(() => {
    if (!focusAfspraakId || loading || !lead) return;
    const el = document.getElementById(`afspraak-${focusAfspraakId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusAfspraakId, loading, lead, afspraken]);

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
  const focusAfspraak = focusAfspraakId
    ? afspraken.find((a) => a.id === focusAfspraakId)
    : undefined;
  const pastVisible = (() => {
    if (
      focusAfspraak &&
      !upcoming.some((a) => a.id === focusAfspraak.id)
    ) {
      return [
        focusAfspraak,
        ...past.filter((a) => a.id !== focusAfspraak.id),
      ].slice(0, 5);
    }
    return past.slice(0, 4);
  })();
  const openTerugbel = afspraken.filter(isActieveTerugbel);
  const showTerugbelBanner = Boolean(lead.terugbellen) || openTerugbel.length > 0;

  function afspraakRow(a: Afspraak, variant: "upcoming" | "past") {
    const terugbel = isActieveTerugbel(a);
    const kanAnnuleren = ACTIEVE_AFSPRAAK.has(a.status);
    const annuleerOpen = annuleerAfspraakId === a.id;
    const focused = focusAfspraakId === a.id;
    return (
      <li
        id={`afspraak-${a.id}`}
        key={a.id}
        className={[
          focused
            ? "bg-green-soft ring-2 ring-inset ring-green"
            : variant === "upcoming"
              ? "bg-green-soft/50"
              : "border-b border-line last:border-b-0",
        ].join(" ")}
      >
        <div className="flex items-start gap-3 px-3 py-2.5">
          <span
            className={[
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              variant === "upcoming"
                ? "bg-green text-white"
                : "bg-wash text-muted",
            ].join(" ")}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={[
                "text-sm tabular-nums",
                variant === "upcoming"
                  ? "font-semibold text-ink"
                  : "font-medium text-ink",
              ].join(" ")}
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
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 self-center">
            {terugbel ? (
              <button
                type="button"
                disabled={completingAfspraakId !== null || annuleerBusy}
                onClick={() => void voltooiTerugbel(a.id)}
                className="border border-[#C45A12]/40 bg-[#FFF0E6] px-2.5 py-1.5 text-xs font-semibold text-[#C45A12] hover:bg-[#FFE4D1] disabled:opacity-50"
              >
                {completingAfspraakId === a.id ? "Bezig…" : "Voltooid"}
              </button>
            ) : null}
            {kanAnnuleren ? (
              <button
                type="button"
                disabled={annuleerBusy || completingAfspraakId !== null}
                onClick={() =>
                  annuleerOpen
                    ? cancelAnnuleerForm()
                    : startAnnuleerAfspraak(a.id)
                }
                className="border border-line px-2.5 py-1.5 text-xs font-semibold text-muted hover:border-[#C45A12]/40 hover:bg-[#FFF0E6] hover:text-[#C45A12] disabled:opacity-50"
              >
                {annuleerOpen ? "Sluiten" : "Annuleren"}
              </button>
            ) : null}
          </div>
        </div>
        {annuleerOpen ? (
          <div className="border-t border-line/70 bg-white px-3 py-3 sm:px-4">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
              Reden annulering
              <textarea
                value={annuleerNotitie}
                onChange={(e) => setAnnuleerNotitie(e.target.value)}
                rows={2}
                placeholder="Waarom wordt deze afspraak geannuleerd?"
                className="mt-1.5 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              />
            </label>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={annuleerBusy}
                onClick={cancelAnnuleerForm}
                className="border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
              >
                Terug
              </button>
              <button
                type="button"
                disabled={annuleerBusy || annuleerNotitie.trim().length < 3}
                onClick={() => void bevestigAnnuleerAfspraak()}
                className="bg-[#C45A12] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#A84A0E] disabled:opacity-50"
              >
                {annuleerBusy ? "Bezig…" : "Afspraak annuleren"}
              </button>
            </div>
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <DetailShell onRefresh={load} loading={loading} activeTab="leads">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <TerugButton fallbackHref="/" />
        <Breadcrumb
          items={[{ label: "Leads", href: "/" }, { label: lead.lead_number }]}
        />
      </div>
      {okMsg && (
        <div className="mb-3 border border-green/30 bg-green-soft px-4 py-2.5 text-sm text-green-dark">
          {okMsg}
        </div>
      )}
      {errorMsg && (
        <div className="mb-3 border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-2.5 text-sm text-[#C45A12]">
          {errorMsg}
        </div>
      )}

      {showTerugbelBanner && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-[#C45A12]/30 bg-[#FFF8F3] px-4 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#C45A12] text-white">
              <PhoneIcon className="h-3.5 w-3.5" />
            </span>
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
      <section className="overflow-hidden border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-semibold tracking-wide text-muted">
              {lead.lead_number}
            </p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">
              {lead.naam}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <UserIcon className="h-3.5 w-3.5 shrink-0 text-muted/80" />
              {kanToewijzen ? (
                <select
                  value={lead.adviseur_id || ""}
                  onChange={(e) =>
                    void updateAdviseur(e.target.value ? e.target.value : null)
                  }
                  className="max-w-[14rem] cursor-pointer border border-line bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-green"
                  aria-label="Adviseur toewijzen"
                >
                  <option value="">Geen adviseur</option>
                  {salesAdviseurs.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.naam}
                      {session?.id === a.id ? " (jij)" : ""}
                    </option>
                  ))}
                  {lead.adviseur_id &&
                  !salesAdviseurs.some((a) => a.id === lead.adviseur_id) ? (
                    <option value={lead.adviseur_id}>
                      {lead.adviseurs?.naam || "Onbekend"} (inactief)
                    </option>
                  ) : null}
                </select>
              ) : eigenLeadsOnly && session ? (
                lead.adviseur_id === session.id ? (
                  <span className="text-sm font-medium text-ink">
                    Jij · {session.naam}
                  </span>
                ) : lead.adviseur_id ? (
                  <span className="text-sm text-muted">
                    {lead.adviseurs?.naam || "Andere adviseur"}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={claimBusy}
                    onClick={() => void claimLead()}
                    className="border border-green bg-green-soft px-2.5 py-1 text-xs font-semibold text-green-dark hover:bg-green hover:text-white disabled:opacity-60"
                  >
                    {claimBusy ? "Bezig…" : "Neem deze lead over"}
                  </button>
                )
              ) : (
                <span className="text-sm text-muted">
                  {lead.adviseurs?.naam || "Geen adviseur"}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {kanStatusWijzigen ? (
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
            ) : (
              <span
                className={`inline-block max-w-[14rem] border bg-white px-2.5 py-2 text-[11px] font-bold uppercase tracking-wide ${statusTone("lead", lead.status)}`}
                title="Status wijzigen alleen via afboeken in de agenda"
              >
                {leadStatusLabel[lead.status] || lead.status}
              </span>
            )}
            <button
              type="button"
              onClick={() => setMaakOfferteOpen(true)}
              className="inline-flex items-center gap-1.5 bg-orange px-4 py-2 text-sm font-semibold text-white hover:bg-[#e0651c]"
            >
              <FileIcon />
              Maak offerte
            </button>
            <button
              type="button"
              disabled={deleteBusy}
              onClick={() => void deleteLead()}
              className="border border-[#C45A12]/40 bg-white px-3 py-2 text-sm font-semibold text-[#C45A12] hover:bg-[#FFF0E6] disabled:opacity-60"
              title="Lead definitief verwijderen"
            >
              {deleteBusy ? "Bezig…" : "Verwijderen"}
            </button>
          </div>
        </div>

        {/* Quick contact strip / editor */}
        {editingGegevens ? (
          <div className="space-y-5 border-t border-line px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between">
              <SectionTitle icon={<UserIcon className="h-3.5 w-3.5" />}>
                Gegevens bewerken
              </SectionTitle>
              <button
                type="button"
                onClick={() => setEditingGegevens(false)}
                className="inline-flex items-center gap-1.5 border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
              >
                Klaar
              </button>
            </div>
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
            {kanToewijzen ? (
              <p className="text-xs text-muted">
                Adviseur pas je aan in de header hierboven.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="relative border-t border-line">
            <div className="grid gap-px bg-line sm:grid-cols-3">
              <a
                href={lead.telefoon ? `tel:${lead.telefoon}` : undefined}
                className={[
                  "flex items-center gap-3 bg-white px-4 py-3 sm:px-5",
                  lead.telefoon
                    ? "hover:bg-green-soft/40"
                    : "pointer-events-none",
                ].join(" ")}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-soft text-green-dark">
                  <PhoneIcon />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Telefoon
                  </p>
                  <p className="truncate text-sm font-medium text-ink">
                    {lead.telefoon || "—"}
                  </p>
                </div>
              </a>
              <a
                href={lead.email ? `mailto:${lead.email}` : undefined}
                className={[
                  "flex items-center gap-3 bg-white px-4 py-3 sm:px-5",
                  lead.email
                    ? "hover:bg-green-soft/40"
                    : "pointer-events-none",
                ].join(" ")}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-soft text-green-dark">
                  <MailIcon />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    E-mail
                  </p>
                  <p className="truncate text-sm font-medium text-ink">
                    {lead.email || "—"}
                  </p>
                </div>
              </a>
              <div className="flex items-center gap-3 bg-white px-4 py-3 pr-14 sm:px-5 sm:pr-16">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-soft text-green-dark">
                  <MapPinIcon />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Adres
                  </p>
                  <p className="truncate text-sm font-medium text-ink">
                    {adresRegel(lead)}
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEditingGegevens(true)}
              className="absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 border border-line bg-white px-2 py-1.5 text-xs font-semibold text-ink shadow-sm hover:bg-wash"
              title="Gegevens bewerken"
            >
              <PencilIcon />
              <span className="hidden sm:inline">Bewerken</span>
            </button>
          </div>
        )}

        {showKwalForm && kanStatusWijzigen && (
          <div className="border-t border-line bg-wash px-4 py-4 sm:px-5">
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

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {/* Afspraken */}
        <section className="border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5 sm:px-5">
            <SectionTitle icon={<CalendarIcon className="h-3.5 w-3.5" />}>
              Afspraken
              {upcoming.length > 0 ? (
                <span className="ml-1 rounded-full bg-green-soft px-1.5 py-0.5 text-[10px] font-bold normal-case tracking-normal text-green-dark">
                  {upcoming.length} gepland
                </span>
              ) : null}
            </SectionTitle>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {planOpen ? (
                <button
                  type="button"
                  onClick={() => {
                    setPlanOpen(false);
                    setPlanMode(null);
                  }}
                  className="border border-line px-2.5 py-1.5 text-xs font-semibold text-muted hover:text-ink"
                >
                  Sluiten
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setPlanMode("huisbezoek");
                      setPlanOpen(true);
                    }}
                    className="inline-flex items-center gap-1 border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                  >
                    <PlusIcon />
                    Huisbezoek
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlanMode("bel");
                      setPlanOpen(true);
                    }}
                    className="inline-flex items-center gap-1 border border-[#C45A12]/40 bg-[#FFF0E6] px-2.5 py-1.5 text-xs font-semibold text-[#C45A12] hover:bg-[#FFE4D4]"
                  >
                    Terugbel
                  </button>
                  {rol !== "adviseur" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPlanMode("warme_bel");
                        setPlanOpen(true);
                      }}
                      className="inline-flex items-center gap-1 border border-[#C9A227]/50 bg-[#FFF8D6] px-2.5 py-1.5 text-xs font-semibold text-[#8A6D00] hover:bg-[#fff0b8]"
                    >
                      Warme terugbel
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>

          <div>
            {planOpen && planMode === "huisbezoek" && (
              <div className="border-b border-line bg-wash/40 px-4 py-3 sm:px-5">
                <LeadAfspraakPlannen
                  lead={lead}
                  adviseurs={adviseurs}
                  lockAdviseur={rol === "adviseur"}
                  defaultAdviseurId={
                    rol === "adviseur"
                      ? session?.id
                      : lead.adviseur_id || undefined
                  }
                  onCancel={() => {
                    setPlanOpen(false);
                    setPlanMode(null);
                  }}
                  onPlanned={() => {
                    setOkMsg("Afspraak gepland.");
                    setPlanOpen(false);
                    setPlanMode(null);
                    setActivityKey((k) => k + 1);
                    void load();
                  }}
                />
              </div>
            )}
            {planOpen &&
              (planMode === "bel" || planMode === "warme_bel") && (
                <div className="border-b border-line bg-wash/40 px-4 py-3 sm:px-5">
                  <LeadTerugbelPlannen
                    key={planMode}
                    lead={lead}
                    adviseurs={adviseurs}
                    warm={planMode === "warme_bel"}
                    lockAdviseur={false}
                    defaultAdviseurId={
                      lead.beller_id ||
                      (rol === "adviseur" ? session?.id : null) ||
                      lead.adviseur_id ||
                      session?.id ||
                      undefined
                    }
                    onCancel={() => {
                      setPlanOpen(false);
                      setPlanMode(null);
                    }}
                    onPlanned={() => {
                      setOkMsg(
                        planMode === "warme_bel"
                          ? "Warme terugbelafspraak gepland."
                          : "Terugbelafspraak gepland."
                      );
                      setPlanOpen(false);
                      setPlanMode(null);
                      setActivityKey((k) => k + 1);
                      void load();
                    }}
                  />
                </div>
              )}

            {upcoming.length === 0 && past.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted sm:px-5">
                Nog geen afspraken met deze klant.
              </p>
            ) : (
              <ul>
                {upcoming.map((a) => afspraakRow(a, "upcoming"))}
                {pastVisible.map((a) => afspraakRow(a, "past"))}
              </ul>
            )}
          </div>
        </section>

        {/* Notities */}
        <section className="border border-line bg-white">
          <div className="border-b border-line px-4 py-2.5 sm:px-5">
            <SectionTitle icon={<NoteIcon className="h-3.5 w-3.5" />}>
              Notities
            </SectionTitle>
          </div>
          <div className="px-4 py-3 sm:px-5">
            {lead.notities?.trim() && (
              <div className="mb-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-wash/50 px-3.5 py-3 text-sm leading-relaxed text-ink">
                {lead.notities}
              </div>
            )}
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={2}
              placeholder="Nieuwe notitie…"
              className="w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
            />
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
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
      </div>

      <LeadActivityPanel leadId={lead.id} refreshKey={activityKey} />

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
