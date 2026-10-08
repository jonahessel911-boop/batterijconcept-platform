"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type {
  Adviseur,
  Factuur,
  InstallatiePartner,
  LeadEvent,
  Project,
  ProjectFoto,
  ProjectStatus,
  ProjectTaak,
  ServiceVerzoek,
} from "@/types/database";
import { formatDateShort, formatDateTimeNl, formatEuro } from "@/lib/format";
import { factuurDisplayStatus } from "@/lib/factuur-betaling";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { appendStampedNotitie, parseProjectNotitieEntries } from "@/lib/lead-notitie";
import { openActiesVoorProject, isWarmtefondsProject } from "@/lib/backoffice-acties";
import { PROJECT_AFDELINGEN } from "@/lib/project-afdeling";
import { projectStatusLabel } from "@/lib/labels";
import {
  formatProjectSchouwWeek,
  isSchouwdagDefinitief,
  schouwWeekFromDate,
} from "@/lib/schouw-week";
import { useCrmSession } from "@/hooks/useCrmSession";
import { backofficeHref, parseBoView } from "@/lib/bo-view";
import { ProjectStatusPath } from "./ProjectStatusPath";
import { ProjectFinancieringPath } from "./ProjectFinancieringPath";
import { ProjectKickoffChecklist } from "./ProjectKickoffChecklist";
import { ProjectAfrondingChecklist } from "./ProjectAfrondingChecklist";
import { ProjectVolgendeStap } from "./ProjectVolgendeStap";
import { ProjectStatusSelect } from "./ProjectStatusSelect";
import { ProjectFinancieelSection } from "./ProjectFinancieelSection";
import { ProjectInkoopSection } from "./ProjectInkoopSection";
import { batterijPurchasingStatus } from "@/lib/project-inkoop-checklist";
import { ProjectAgendaAfspraakSection } from "./ProjectAgendaAfspraakSection";
import { ProjectServiceSection } from "./ProjectServiceSection";
import { Breadcrumb, DetailShell, NotFoundState, TerugButton } from "./DetailChrome";
import { StatusBadge } from "./StatusBadge";
import {
  isSchouwFormulier,
  SCHOUW_FORMULIER_OMSCHRIJVING,
} from "@/lib/project-documenten";
import {
  resolveFinancieringStatus,
  type FinancieringStatus,
} from "@/lib/financiering-status";
import {
  isKickoffComplete,
  kickoffWarmtefondsBedragen,
} from "@/lib/project-kickoff";
import {
  isRestantFactuurOmschrijving,
} from "@/lib/aanbetaling";
import { KlantContactMailModal } from "./KlantContactMailModal";

const BEDENKTIJD_DAGEN = 14;

type FeedIcon =
  | "calendar"
  | "installatie"
  | "payment"
  | "inkoop"
  | "status"
  | "factuur"
  | "note"
  | "default";

type FeedItem = {
  key: string;
  at: string;
  title: string;
  body?: string;
  /** Notitie: inhoud is het hoofdbericht (groot). */
  kind?: "note" | "event";
  author?: string | null;
  icon?: FeedIcon;
};

function FeedSvg({
  children,
  className = "h-3.5 w-3.5",
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

function CalendarFeedIcon({ className }: { className?: string }) {
  return (
    <FeedSvg className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </FeedSvg>
  );
}

function InstallatieFeedIcon({ className }: { className?: string }) {
  return (
    <FeedSvg className={className}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </FeedSvg>
  );
}

function MoneyBagFeedIcon({ className }: { className?: string }) {
  return (
    <FeedSvg className={className}>
      <path d="M8 10c0-2.2 1.8-4 4-4s4 1.8 4 4" />
      <path d="M6 10h12l-1 9H7l-1-9Z" />
      <path d="M10 13.5h4M12 12v4" />
    </FeedSvg>
  );
}

function InkoopFeedIcon({ className }: { className?: string }) {
  return (
    <FeedSvg className={className}>
      <path d="M6 6h15l-1.5 9h-12z" />
      <path d="M6 6 5 3H2" />
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
    </FeedSvg>
  );
}

function StatusFeedIcon({ className }: { className?: string }) {
  return (
    <FeedSvg className={className}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </FeedSvg>
  );
}

function FactuurFeedIcon({ className }: { className?: string }) {
  return (
    <FeedSvg className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </FeedSvg>
  );
}

function NoteFeedIcon({ className }: { className?: string }) {
  return (
    <FeedSvg className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </FeedSvg>
  );
}

function DotFeedIcon({ className }: { className?: string }) {
  return (
    <FeedSvg className={className}>
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </FeedSvg>
  );
}

function feedIconEl(icon: FeedIcon | undefined) {
  const cls = "h-3.5 w-3.5";
  switch (icon) {
    case "calendar":
      return <CalendarFeedIcon className={cls} />;
    case "installatie":
      return <InstallatieFeedIcon className={cls} />;
    case "payment":
      return <MoneyBagFeedIcon className={cls} />;
    case "inkoop":
      return <InkoopFeedIcon className={cls} />;
    case "status":
      return <StatusFeedIcon className={cls} />;
    case "factuur":
      return <FactuurFeedIcon className={cls} />;
    case "note":
      return <NoteFeedIcon className={cls} />;
    default:
      return <DotFeedIcon className={cls} />;
  }
}

function feedIconTone(_icon: FeedIcon | undefined, _isNote: boolean): string {
  return "border-line bg-white text-muted";
}

function iconForLeadEvent(ev: LeadEvent): FeedIcon {
  const t = (ev.titel || "").toLowerCase();
  const s = (ev.soort || "").toLowerCase();
  if (s === "betaling" || t.includes("betaling") || t.includes("betaald")) {
    return "payment";
  }
  if (s === "inkoop" || t.includes("bestelling") || t.includes("inkoop") || t.includes("materiaal")) {
    return "inkoop";
  }
  if (
    s === "installatie" ||
    t.includes("installatie")
  ) {
    return "installatie";
  }
  if (
    s === "afspraak" ||
    s === "schouw" ||
    t.includes("afspraak") ||
    t.includes("schouw") ||
    t.includes("warmtefonds")
  ) {
    return "calendar";
  }
  if (s === "status" || t.startsWith("projectstatus")) return "status";
  if (s === "factuur" || t.includes("factuur")) return "factuur";
  if (s === "notitie") return "note";
  return "default";
}

function resolveOfferte(
  project: Project
): NonNullable<Project["offertes"]> | null {
  const raw = project.offertes as
    | Project["offertes"]
    | Project["offertes"][]
    | null
    | undefined;
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] || null : raw;
}

function bedenktijdState(ondertekendOp: string | null | undefined): {
  pct: number;
  klaar: boolean;
  startLabel: string;
  eindLabel: string;
  dagenOver: number;
} | null {
  if (!ondertekendOp) return null;
  const start = new Date(ondertekendOp);
  if (Number.isNaN(start.getTime())) return null;
  const eind = new Date(start.getTime() + BEDENKTIJD_DAGEN * 24 * 60 * 60 * 1000);
  const now = Date.now();
  const span = eind.getTime() - start.getTime();
  const pct = Math.min(1, Math.max(0, (now - start.getTime()) / span));
  const klaar = now >= eind.getTime();
  const dagenOver = klaar
    ? 0
    : Math.max(1, Math.ceil((eind.getTime() - now) / (24 * 60 * 60 * 1000)));
  return {
    pct,
    klaar,
    startLabel: formatDateShort(start),
    eindLabel: formatDateShort(eind),
    dagenOver,
  };
}

type GegevensDraft = {
  naam: string;
  email: string;
  telefoon: string;
  straat: string;
  huisnummer: string;
  toevoeging: string;
  postcode: string;
  plaats: string;
  omschrijving: string;
};

function adresRegel(lead: Project["leads"]): string {
  if (!lead) return "—";
  const l = Array.isArray(lead) ? lead[0] : lead;
  if (!l) return "—";
  const straat = [l.straat, [l.huisnummer, l.toevoeging].filter(Boolean).join("")]
    .filter(Boolean)
    .join(" ");
  const plaats = [l.postcode, l.plaats].filter(Boolean).join(" ");
  return [straat, plaats].filter(Boolean).join(", ") || "—";
}

function PencilIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
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

export function ProjectPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const backView = parseBoView(searchParams.get("from"));
  const backHref = backofficeHref(backView);
  const { session } = useCrmSession();

  const [project, setProject] = useState<Project | null>(null);
  const [fotos, setFotos] = useState<ProjectFoto[]>([]);
  const [taken, setTaken] = useState<ProjectTaak[]>([]);
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingSchouw, setUploadingSchouw] = useState(false);
  const [mainTab, setMainTab] = useState<
    "overzicht" | "financieel" | "medewerkers" | "service"
  >("overzicht");
  const [docsTab, setDocsTab] = useState<
    "documenten" | "rapporten" | "bestanden"
  >("documenten");
  const [facturen, setFacturen] = useState<Factuur[]>([]);
  const [leadEvents, setLeadEvents] = useState<LeadEvent[]>([]);
  const [serviceVerzoeken, setServiceVerzoeken] = useState<ServiceVerzoek[]>(
    []
  );
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [medewerkerBusy, setMedewerkerBusy] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  const [newTaakOpen, setNewTaakOpen] = useState(false);
  const [newTitel, setNewTitel] = useState("");
  const [newAfdeling, setNewAfdeling] = useState("");
  const [newPersonId, setNewPersonId] = useState("");
  const [newDue, setNewDue] = useState("");
  const [creatingTaak, setCreatingTaak] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [trackLinkCopied, setTrackLinkCopied] = useState(false);
  const [trackLinkBusy, setTrackLinkBusy] = useState(false);
  const [wfPortalBusy, setWfPortalBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [editingGegevens, setEditingGegevens] = useState(false);
  const [gegevensDraft, setGegevensDraft] = useState<GegevensDraft | null>(
    null
  );
  const [gegevensSaving, setGegevensSaving] = useState(false);
  const [gegevensError, setGegevensError] = useState<string | null>(null);
  const [afspraakOpenRequest, setAfspraakOpenRequest] = useState<{
    soort: "schouwweek" | "schouwdag" | "installatie";
    nonce: number;
  } | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    try {
      const res = await fetch(`/api/projecten/${id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !(data as { project?: Project }).project) {
        setNotFound(true);
        setProject(null);
        return;
      }
      const loaded = (data as { project: Project; redirectTo?: string }).project;
      const redirectTo = (data as { redirectTo?: string }).redirectTo;
      if (redirectTo && redirectTo !== id) {
        const from = searchParams.get("from");
        const q = from ? `?from=${encodeURIComponent(from)}` : "";
        router.replace(`/projecten/${redirectTo}${q}`);
        return;
      }
      setProject(loaded);
      const projectId = loaded.id;
      const resolvedLeadId = loaded.lead_id || null;
      const [
        fotoRes,
        takenRes,
        advRes,
        factRes,
        partnerRes,
        eventsRes,
        serviceRes,
      ] = await Promise.all([
        fetch(`/api/projecten/${projectId}/fotos`),
        fetch(`/api/taken/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId }),
        }).then(() => fetch(`/api/taken?project_id=${projectId}&open=0`)),
        fetch("/api/adviseurs"),
        fetch(`/api/projecten/${projectId}/facturen`),
        fetch("/api/installatie-partners"),
        resolvedLeadId
          ? fetch(`/api/leads/${resolvedLeadId}/events`)
          : Promise.resolve(null),
        fetch(`/api/service-verzoeken?project_id=${projectId}`),
      ]);
      const fotoData = await fotoRes.json().catch(() => ({}));
      const takenData = await takenRes.json().catch(() => ({}));
      const advData = await advRes.json().catch(() => ({}));
      const factData = await factRes.json().catch(() => ({}));
      const partnerData = await partnerRes.json().catch(() => ({}));
      const eventsData = eventsRes
        ? await eventsRes.json().catch(() => ({}))
        : {};
      const serviceData = await serviceRes.json().catch(() => ({}));
      setFotos((fotoData.fotos as ProjectFoto[]) || []);
      setTaken((takenData.taken as ProjectTaak[]) || []);
      if (factRes.ok) {
        setFacturen((factData.facturen as Factuur[]) || []);
      }
      setLeadEvents(
        eventsRes && eventsRes.ok
          ? ((eventsData.events as LeadEvent[]) || [])
          : []
      );
      setServiceVerzoeken(
        serviceRes.ok
          ? ((serviceData.verzoeken as ServiceVerzoek[]) || [])
          : []
      );
      const list = ((advData.adviseurs as Adviseur[]) || []).filter(
        (a) => a.actief !== false
      );
      setAdviseurs(list);
      setPartners(
        ((partnerData.partners as InstallatiePartner[]) || []).filter(
          (p) => p.actief !== false
        )
      );
    } catch {
      setNotFound(true);
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [id, router, searchParams]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const refreshLeadEvents = useCallback(async (leadId: string | null | undefined) => {
    if (!leadId) {
      setLeadEvents([]);
      return;
    }
    try {
      const res = await fetch(`/api/leads/${leadId}/events`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setLeadEvents((data.events as LeadEvent[]) || []);
      }
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [project?.id, project?.notities, facturen.length]);

  async function updateStatus(status: ProjectStatus) {
    if (!project) return;
    if (
      status === "annulering" &&
      !window.confirm(
        "Weet je zeker dat je deze order definitief wilt annuleren?"
      )
    ) {
      return;
    }
    setStatusSaving(true);
    setError(null);
    const prev = project.status;
    setProject({ ...project, status });
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error);
      const updated = (data as { project?: Project }).project;
      if (updated) setProject((p) => (p ? { ...p, ...updated } : p));
      void refreshLeadEvents(project.lead_id);
      const mail = (
        data as {
          annulering_mail?: { sent?: boolean; skipped?: boolean; error?: string };
        }
      ).annulering_mail;
      if (status === "annulering") {
        if (mail?.sent) {
          setOkMsg("Order geannuleerd — bevestiging gemaild naar de klant.");
        } else if (mail?.skipped) {
          setOkMsg(
            "Order geannuleerd — geen e-mailadres, dus geen mail verstuurd."
          );
        } else if (mail?.error) {
          setOkMsg(`Order geannuleerd, maar mail mislukt: ${mail.error}`);
        } else {
          setOkMsg("Order geannuleerd.");
        }
      } else {
        setOkMsg("Status bijgewerkt.");
      }
      // Auto-taken herladen
      const takenRes = await fetch(`/api/taken?project_id=${project.id}&open=0`);
      const takenData = await takenRes.json().catch(() => ({}));
      if (takenRes.ok) setTaken((takenData.taken as ProjectTaak[]) || []);
    } catch (e) {
      setProject((p) => (p ? { ...p, status: prev } : p));
      setError(e instanceof Error ? e.message : "Status bijwerken mislukt");
    } finally {
      setStatusSaving(false);
    }
  }

  async function updateFinancieringStatus(
    status: FinancieringStatus | null,
    extra?: { warmtefonds_afspraak_at?: string | null }
  ) {
    if (!project) return;
    setStatusSaving(true);
    setError(null);
    const prevFs = project.financiering_status ?? null;
    const prevAt = project.warmtefonds_afspraak_at ?? null;
    setProject({
      ...project,
      financiering_status: status,
      ...(extra?.warmtefonds_afspraak_at !== undefined
        ? { warmtefonds_afspraak_at: extra.warmtefonds_afspraak_at }
        : status === null
          ? { warmtefonds_afspraak_at: null }
          : {}),
    });
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          financiering_status: status,
          ...(extra?.warmtefonds_afspraak_at !== undefined
            ? { warmtefonds_afspraak_at: extra.warmtefonds_afspraak_at }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error);
      const updated = (data as { project?: Project }).project;
      if (updated) setProject((p) => (p ? { ...p, ...updated } : p));
      void refreshLeadEvents(project.lead_id);
      // Bij goedkeuring: restantconcept laden
      if (status === "aanvraag_goedgekeurd") {
        try {
          const fRes = await fetch(`/api/projecten/${project.id}/facturen`);
          const fData = await fRes.json().catch(() => ({}));
          if (fRes.ok) {
            setFacturen((fData.facturen as Factuur[]) || []);
          }
        } catch {
          /* ignore */
        }
        setOkMsg(
          "Financiering goedgekeurd — restantfactuur klaargezet (Financieel)."
        );
      } else {
        setOkMsg("Financieringsfase bijgewerkt.");
      }
    } catch (e) {
      setProject((p) =>
        p
          ? {
              ...p,
              financiering_status: prevFs,
              warmtefonds_afspraak_at: prevAt,
            }
          : p
      );
      setError(
        e instanceof Error ? e.message : "Financieringsfase bijwerken mislukt"
      );
    } finally {
      setStatusSaving(false);
    }
  }

  async function saveSalesAdviseur(adviseurId: string | null) {
    if (!project?.lead_id) return;
    setMedewerkerBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${project.lead_id}`, {
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
      const adv = adviseurs.find((a) => a.id === adviseurId) || null;
      setProject((prev) => {
        if (!prev) return prev;
        const prevLead = Array.isArray(prev.leads) ? prev.leads[0] : prev.leads;
        return {
          ...prev,
          leads: {
            ...(prevLead || {}),
            adviseur_id: adviseurId,
            adviseurs: adv ? { id: adv.id, naam: adv.naam } : null,
          } as Project["leads"],
        };
      });
      setOkMsg("Sales-adviseur bijgewerkt.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setMedewerkerBusy(false);
    }
  }

  async function saveBackofficeMedewerker(personId: string | null) {
    if (!project) return;
    setMedewerkerBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verantwoordelijke_id: personId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      const updated = (data as { project?: Project }).project;
      if (updated) {
        setProject((p) => (p ? { ...p, ...updated } : p));
      } else {
        const person = adviseurs.find((a) => a.id === personId) || null;
        setProject((p) =>
          p
            ? {
                ...p,
                verantwoordelijke_id: personId,
                verantwoordelijke: person
                  ? { id: person.id, naam: person.naam, email: person.email }
                  : null,
              }
            : p
        );
      }
      setOkMsg("Backoffice-medewerker bijgewerkt.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setMedewerkerBusy(false);
    }
  }

  async function saveInstallateur(partnerId: string | null) {
    if (!project) return;
    setMedewerkerBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installatie_partner_id: partnerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      const updated = (data as { project?: Project }).project;
      if (updated) {
        setProject((p) => (p ? { ...p, ...updated } : p));
      } else {
        const partner = partners.find((p) => p.id === partnerId) || null;
        setProject((p) =>
          p
            ? {
                ...p,
                installatie_partner_id: partnerId,
                installatie_partners: partner
                  ? {
                      id: partner.id,
                      naam: partner.naam,
                      email: partner.email,
                      telefoon: partner.telefoon,
                    }
                  : null,
                monteur: partner?.naam || p.monteur,
              }
            : p
        );
      }
      setOkMsg("Installateur bijgewerkt.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setMedewerkerBusy(false);
    }
  }

  function openGegevensEditor() {
    if (!project) return;
    const l = Array.isArray(project.leads) ? project.leads[0] : project.leads;
    setGegevensDraft({
      naam: l?.naam || "",
      email: l?.email || "",
      telefoon: l?.telefoon || "",
      straat: l?.straat || "",
      huisnummer: l?.huisnummer || "",
      toevoeging: l?.toevoeging || "",
      postcode: l?.postcode || "",
      plaats: l?.plaats || "",
      omschrijving: project.titel || "",
    });
    setGegevensError(null);
    setEditingGegevens(true);
  }

  function closeGegevensEditor() {
    setEditingGegevens(false);
    setGegevensDraft(null);
    setGegevensError(null);
  }

  async function saveGegevens() {
    if (!project || !gegevensDraft) return;
    const naam = gegevensDraft.naam.trim();
    if (!naam) {
      setGegevensError("Naam is verplicht");
      return;
    }
    const email = gegevensDraft.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setGegevensError("Ongeldig e-mailadres");
      return;
    }

    setGegevensSaving(true);
    setGegevensError(null);
    setError(null);
    try {
      const leadPatch = {
        naam,
        email: email || null,
        telefoon: gegevensDraft.telefoon.trim() || null,
        straat: gegevensDraft.straat.trim() || null,
        huisnummer: gegevensDraft.huisnummer.trim() || null,
        toevoeging: gegevensDraft.toevoeging.trim() || null,
        postcode: gegevensDraft.postcode.trim() || null,
        plaats: gegevensDraft.plaats.trim() || null,
      };
      const titel = gegevensDraft.omschrijving.trim() || null;

      const leadRes = await fetch(`/api/leads/${project.lead_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(leadPatch),
      });
      const leadData = await leadRes.json().catch(() => ({}));
      if (!leadRes.ok) {
        throw new Error(
          (leadData as { error?: string }).error || "Klantgegevens opslaan mislukt"
        );
      }

      const projRes = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titel }),
      });
      const projData = await projRes.json().catch(() => ({}));
      if (!projRes.ok) {
        throw new Error(
          (projData as { error?: string }).error || "Omschrijving opslaan mislukt"
        );
      }

      const updatedLead = (leadData as { lead?: Record<string, unknown> }).lead;
      const updatedProject = (projData as { project?: Project }).project;

      setProject((prev) => {
        if (!prev) return prev;
        const prevLead = Array.isArray(prev.leads) ? prev.leads[0] : prev.leads;
        const nextLead = {
          ...(prevLead || {}),
          ...(updatedLead || leadPatch),
        } as NonNullable<Project["leads"]>;
        return {
          ...prev,
          ...(updatedProject || {}),
          titel:
            updatedProject?.titel !== undefined
              ? updatedProject.titel
              : titel,
          leads: nextLead,
        };
      });
      setOkMsg("Gegevens bijgewerkt.");
      closeGegevensEditor();
    } catch (e) {
      setGegevensError(
        e instanceof Error ? e.message : "Opslaan mislukt"
      );
    } finally {
      setGegevensSaving(false);
    }
  }

  async function createTaak() {
    if (!project) return;
    if (!newTitel.trim() || !newAfdeling || !newPersonId || !newDue) {
      setError("Vul titel, afdeling, persoon en due date in.");
      return;
    }
    setCreatingTaak(true);
    setError(null);
    try {
      const due = new Date(`${newDue}T17:00:00`);
      const res = await fetch("/api/taken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: project.id,
          titel: newTitel.trim(),
          afdeling: newAfdeling,
          verantwoordelijke_id: newPersonId,
          due_at: due.toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Taak aanmaken mislukt"
        );
      }
      const taak = data.taak as ProjectTaak;
      setTaken((prev) => [taak, ...prev]);
      setNewTaakOpen(false);
      setNewTitel("");
      setNewAfdeling("");
      setNewPersonId("");
      setNewDue("");
      setOkMsg("Taak aangemaakt.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Taak aanmaken mislukt");
    } finally {
      setCreatingTaak(false);
    }
  }

  async function assignTaak(
    taakId: string,
    verantwoordelijkeId: string | null
  ) {
    setError(null);
    const prev = taken;
    const person =
      adviseurs.find((a) => a.id === verantwoordelijkeId) || null;
    setTaken((list) =>
      list.map((t) =>
        t.id === taakId
          ? {
              ...t,
              verantwoordelijke_id: verantwoordelijkeId,
              verantwoordelijke: person
                ? { id: person.id, naam: person.naam, email: person.email }
                : null,
            }
          : t
      )
    );
    try {
      const res = await fetch(`/api/taken/${taakId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verantwoordelijke_id: verantwoordelijkeId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Toewijzen mislukt"
        );
      }
      const updated = data.taak as ProjectTaak | undefined;
      if (updated) {
        setTaken((list) =>
          list.map((t) => (t.id === updated.id ? updated : t))
        );
      }
    } catch (e) {
      setTaken(prev);
      setError(e instanceof Error ? e.message : "Toewijzen mislukt");
    }
  }

  async function postTaakVoltooidInChat(titel: string) {
    if (!project) return;
    const chatText = `Taak: ${titel}\nvoltooid`;
    const merged = appendStampedNotitie(
      project.notities,
      chatText,
      new Date(),
      session?.naam || null
    );
    const res = await fetch(`/api/projecten/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notities: merged }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        (data as { error?: string }).error || "Chat bijwerken mislukt"
      );
    }
    const updated = (data as { project?: Project }).project;
    if (updated) setProject((p) => (p ? { ...p, ...updated } : p));
    else setProject({ ...project, notities: merged });
  }

  async function completeOpenTaak(t: ProjectTaak) {
    if (!project) return;
    setCompletingId(t.id);
    setError(null);
    const prev = taken;
    setTaken((list) =>
      list.map((x) => (x.id === t.id ? { ...x, status: "done" } : x))
    );
    try {
      const res = await fetch(`/api/taken/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Voltooien mislukt"
        );
      }
      await postTaakVoltooidInChat(t.titel);
      setOkMsg(null);
    } catch (e) {
      setTaken(prev);
      setError(e instanceof Error ? e.message : "Voltooien mislukt");
    } finally {
      setCompletingId(null);
    }
  }

  async function completeBoActie(actieId: string, titel: string, soort: string) {
    if (!project) return;
    setCompletingId(actieId);
    setError(null);
    try {
      if (soort === "bel_schouw_aanbetaling") {
        const res = await fetch(`/api/projecten/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bel_schouw_aanbetaling_at: new Date().toISOString(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Voltooien mislukt"
          );
        }
        const updated = (data as { project?: Project }).project;
        if (updated) setProject((p) => (p ? { ...p, ...updated } : p));
      } else if (soort === "schakel_financiering") {
        const res = await fetch(`/api/projecten/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            financiering_geschakeld_at: new Date().toISOString(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Voltooien mislukt"
          );
        }
        const updated = (data as { project?: Project }).project;
        if (updated) setProject((p) => (p ? { ...p, ...updated } : p));
      } else if (soort === "aangetekende_brief") {
        const res = await fetch(`/api/projecten/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            aangetekende_brief_verstuurd_at: new Date().toISOString(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Voltooien mislukt"
          );
        }
        const updated = (data as { project?: Project }).project;
        if (updated) setProject((p) => (p ? { ...p, ...updated } : p));
      } else if (soort === "nabellen_factuur") {
        const actie = openActiesVoorProject(project, facturen).find(
          (a) => a.id === actieId
        );
        if (!actie?.factuurId) {
          throw new Error("Geen factuur gekoppeld aan deze actie");
        }
        const res = await fetch(`/api/facturen/${actie.factuurId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "betaald",
            betaald_op: new Date().toISOString().slice(0, 10),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Factuur markeren mislukt"
          );
        }
        const updated = (data as { factuur?: Factuur }).factuur;
        if (updated) {
          setFacturen((list) =>
            list.map((f) => (f.id === updated.id ? { ...f, ...updated } : f))
          );
        }
      } else {
        throw new Error("Deze actie kan hier niet worden afgevinkt");
      }
      await postTaakVoltooidInChat(titel);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voltooien mislukt");
    } finally {
      setCompletingId(null);
    }
  }

  async function downloadOffertePdf() {
    if (!project?.offerte_id) return;
    setPdfBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/offertes/${project.offerte_id}/pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || "PDF downloaden mislukt"
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const nummer =
        project.offertes?.offerte_nummer ||
        project.project_nummer ||
        "offerte";
      a.download = `${nummer}-ondertekend.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF downloaden mislukt");
    } finally {
      setPdfBusy(false);
    }
  }

  async function addNotitie() {
    if (!project) return;
    const text = noteDraft.trim();
    if (!text) return;
    setNoteBusy(true);
    setError(null);
    try {
      const merged = appendStampedNotitie(
        project.notities,
        text,
        new Date(),
        session?.naam || null
      );
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notities: merged }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error);
      const updated = (data as { project?: Project }).project;
      if (updated) setProject((p) => (p ? { ...p, ...updated } : p));
      else setProject({ ...project, notities: merged });
      setNoteDraft("");
      setOkMsg(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Notitie opslaan mislukt");
    } finally {
      setNoteBusy(false);
    }
  }

  async function uploadFoto(file: File) {
    if (!project) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/projecten/${project.id}/fotos`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload mislukt");
      setFotos((prev) => [...prev, data.foto as ProjectFoto]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload mislukt");
    } finally {
      setUploading(false);
    }
  }

  async function copyTrackLink() {
    if (!project) return;
    setTrackLinkBusy(true);
    setError(null);
    try {
      const off = resolveOfferte(project);
      let token = off?.track_token || null;
      let url: string | null = token
        ? `${window.location.origin}/track/${token}`
        : null;

      if (!url) {
        const res = await fetch(`/api/projecten/${project.id}/track-link`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Track-link ophalen mislukt"
          );
        }
        url = (data as { url?: string }).url || null;
        token = (data as { track_token?: string }).track_token || token;
        if (token) {
          setProject((prev) => {
            if (!prev) return prev;
            const prevOff = resolveOfferte(prev);
            if (!prevOff) return prev;
            return {
              ...prev,
              offertes: { ...prevOff, track_token: token },
            };
          });
        }
      }

      if (!url) throw new Error("Geen track-link beschikbaar");
      await navigator.clipboard.writeText(url);
      setTrackLinkCopied(true);
      window.setTimeout(() => setTrackLinkCopied(false), 2000);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Kopiëren mislukt"
      );
    } finally {
      setTrackLinkBusy(false);
    }
  }

  async function openWarmtefondsPortaal() {
    if (!project) return;
    setWfPortalBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projecten/${project.id}/warmtefonds-link`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error ||
            "Warmtefonds-portaal openen mislukt"
        );
      }
      const url = (data as { url?: string }).url;
      if (!url) throw new Error("Geen portaal-link beschikbaar");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Warmtefonds-portaal openen mislukt"
      );
    } finally {
      setWfPortalBusy(false);
    }
  }

  async function uploadSchouwFormulier(file: File) {
    if (!project) return;
    setUploadingSchouw(true);
    setError(null);
    setOkMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("omschrijving", SCHOUW_FORMULIER_OMSCHRIJVING);
      form.append("allow_pdf", "1");
      const res = await fetch(`/api/projecten/${project.id}/fotos`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload mislukt");
      setFotos((prev) => [...prev, data.foto as ProjectFoto]);
      const adv = data.status_advance as
        | {
            advanced?: boolean;
            klaarVoorMateriaal?: boolean;
            to?: string | null;
          }
        | undefined;
      if (data.project) {
        setProject((prev) =>
          prev ? { ...prev, ...(data.project as Project) } : prev
        );
      }
      if (adv?.advanced && adv.klaarVoorMateriaal) {
        setOkMsg(
          "Schouw formulier geüpload · alles betaald → status Materiaal inkopen (Restfactuur betaald)."
        );
      } else if (adv?.advanced) {
        setOkMsg(
          "Schouw formulier geüpload · status Schouw voltooid. Check Financieel of alles betaald is."
        );
      } else {
        setOkMsg("Schouw formulier geüpload.");
      }
      void refreshLeadEvents(project.lead_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload mislukt");
    } finally {
      setUploadingSchouw(false);
    }
  }

  async function deleteFoto(fotoId: string) {
    if (!project) return;
    if (!confirm("Bestand verwijderen?")) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/projecten/${project.id}/fotos?foto_id=${encodeURIComponent(fotoId)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Verwijderen mislukt"
        );
      }
      setFotos((prev) => prev.filter((f) => f.id !== fotoId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  if (loading && !project) {
    return (
      <DetailShell activeTab="projecten">
        <p className="py-20 text-center text-sm text-muted">Project laden…</p>
      </DetailShell>
    );
  }

  if (notFound || !project) {
    return (
      <NotFoundState
        title="Project niet gevonden"
        backHref={backHref}
        backLabel="Terug naar backoffice"
        activeTab="projecten"
      />
    );
  }

  const lead = Array.isArray(project.leads) ? project.leads[0] : project.leads;
  const schouwFormulieren = fotos.filter((f) =>
    isSchouwFormulier(f.omschrijving)
  );
  const normaleFotos = fotos.filter(
    (f) => !isSchouwFormulier(f.omschrijving)
  );
  const klantNaam = lead?.naam || project.titel || "Klant";
  const batterijStatus = batterijPurchasingStatus(project.materiaal_checks);
  const offerte = resolveOfferte(project);
  const bedenktijd = bedenktijdState(offerte?.ondertekend_op);

  const schouwWeekInfo = (() => {
    if (project.schouw_jaar && project.schouw_week) {
      return { jaar: project.schouw_jaar, week: project.schouw_week };
    }
    if (project.schouw_at) {
      return schouwWeekFromDate(project.schouw_at);
    }
    return null;
  })();

  const schouwDagDefinitief = isSchouwdagDefinitief(project);

  const openTaken = (() => {
    const open = taken.filter((t) => t.status !== "done");
    const seen = new Set<string>();
    const out: typeof open = [];
    for (const t of open) {
      const k = t.auto_key || t.id;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  })();

  const openBoActies = openActiesVoorProject(project, facturen).filter(
    (a) =>
      a.soort === "schakel_financiering" || a.soort === "aangetekende_brief"
  );

  const openActieCount = openTaken.length + openBoActies.length;

  const feed: FeedItem[] = [
    {
      key: "created",
      at: project.created_at,
      title: "Project aangemaakt",
      body: project.project_nummer,
      kind: "event",
      icon: "default",
    },
  ];

  if (offerte?.ondertekend_op) {
    feed.push({
      key: "offerte-getekend",
      at: offerte.ondertekend_op,
      title: `Offerte ${offerte.offerte_nummer || ""} getekend`.trim(),
      body: "Offerte ondertekend",
      kind: "event",
      icon: "factuur",
    });
  }

  if (project.bel_schouw_aanbetaling_at) {
    feed.push({
      key: "bel",
      at: project.bel_schouw_aanbetaling_at,
      title: "Klant gebeld voor schouw",
      kind: "event",
      icon: "calendar",
    });
  }

  const schouwWeekLeadEv = (() => {
    if (!project.schouw_jaar || !project.schouw_week) return null;
    const matches = leadEvents.filter((ev) => {
      if (ev.soort !== "schouw" || !/Schouwweek gezet/i.test(ev.titel || "")) {
        return false;
      }
      const meta = (ev.meta || {}) as Record<string, unknown>;
      if (meta.project_id && meta.project_id !== project.id) return false;
      const w = meta.schouw_week;
      const j = meta.schouw_jaar;
      if (w != null && j != null) {
        return (
          Number(w) === project.schouw_week &&
          Number(j) === project.schouw_jaar
        );
      }
      const m = (ev.titel || "").match(/W(\d+)/i);
      return m ? Number(m[1]) === project.schouw_week : false;
    });
    return (
      matches.sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ||
      null
    );
  })();

  const schouwDagLeadEv = (() => {
    if (!project.schouw_at || !schouwDagDefinitief) return null;
    const matches = leadEvents.filter((ev) => {
      if (ev.soort !== "schouw") return false;
      if (!/Schouwdag gepland|Schouwdatum gepland/i.test(ev.titel || "")) {
        return false;
      }
      const meta = (ev.meta || {}) as Record<string, unknown>;
      if (meta.project_id && meta.project_id !== project.id) return false;
      return true;
    });
    return (
      matches.sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ||
      null
    );
  })();

  if (project.schouw_jaar && project.schouw_week) {
    feed.push({
      key: "schouw-week",
      at:
        schouwWeekLeadEv?.created_at ||
        project.updated_at ||
        project.created_at,
      title: `Schouwweek gezet (W${project.schouw_week})`,
      body:
        formatProjectSchouwWeek(project) ||
        schouwWeekLeadEv?.detail ||
        undefined,
      kind: "event",
      icon: "calendar",
    });
  }

  if (project.schouw_at && schouwDagDefinitief) {
    feed.push({
      key: "schouw-datum",
      at:
        schouwDagLeadEv?.created_at ||
        project.updated_at ||
        project.created_at,
      title: "Schouwdatum gepland",
      body:
        schouwDagLeadEv?.detail ||
        `Schouwdatum is gepland op ${formatDateTimeNl(project.schouw_at)}`,
      kind: "event",
      icon: "calendar",
    });
  }

  // Schouw uitgevoerd = schouwformulier geüpload (niet op basis van status/datum)
  if (schouwFormulieren.length > 0) {
    const eerste = [...schouwFormulieren].sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    )[0];
    feed.push({
      key: "schouw-done",
      at: eerste?.created_at || project.updated_at || project.created_at,
      title: "Schouw uitgevoerd",
      body: "Schouwformulier geüpload",
      kind: "event",
      icon: "calendar",
    });
  }

  if (project.installatie_at) {
    feed.push({
      key: "installatie",
      at: project.updated_at || project.created_at,
      title: "Installatie gepland",
      body: `Installatiedatum is gepland op ${formatDateTimeNl(project.installatie_at)}${
        project.installatie_partners?.naam || project.monteur
          ? ` · ${project.installatie_partners?.naam || project.monteur}`
          : ""
      }`,
      kind: "event",
      icon: "installatie",
    });
  }

  if (
    project.status === "installatie_voltooid" ||
    project.status === "review_gevraagd" ||
    project.status === "service"
  ) {
    feed.push({
      key: "installatie-done",
      at: project.installatie_at || project.updated_at || project.created_at,
      title: "Installatie uitgevoerd",
      kind: "event",
      icon: "installatie",
    });
  }

  for (const f of facturen) {
    const nr = f.factuur_nummer || "—";
    const oms = f.omschrijving?.trim() || null;
    feed.push({
      key: `fac-create-${f.id}`,
      at: f.created_at || `${f.factuurdatum}T12:00:00`,
      title: `Factuur ${nr} aangemaakt`,
      body: [
        formatEuro(f.bedrag_inc_btw) + " incl. btw",
        oms,
      ]
        .filter(Boolean)
        .join(" · "),
      kind: "event",
      icon: "factuur",
    });

    if (
      (f.status === "verzonden" ||
        f.status === "betaald" ||
        f.status === "deels_betaald") &&
      f.factuurdatum
    ) {
      feed.push({
        key: `fac-send-${f.id}`,
        at: `${f.factuurdatum}T12:00:00`,
        title: `Factuur ${nr} verstuurd`,
        body: oms || undefined,
        kind: "event",
        icon: "factuur",
      });
    }

    if (f.status === "betaald" && f.betaald_op) {
      feed.push({
        key: `fac-paid-${f.id}`,
        at: `${f.betaald_op}T12:00:00`,
        title: `Betaling factuur ${nr} geregistreerd`,
        body: [
          formatEuro(f.bedrag_inc_btw) + " incl. btw",
          oms,
        ]
          .filter(Boolean)
          .join(" · "),
        kind: "event",
        icon: "payment",
      });
    }
  }

  for (const t of taken) {
    if (t.status !== "done") continue;
    feed.push({
      key: `taak-${t.id}`,
      at: t.updated_at || t.created_at,
      title: `Taak afgerond: ${t.titel}`,
      body: t.afdeling || undefined,
      kind: "event",
      icon: "default",
    });
  }

  // Lead-events: statuswijzigingen, inkoop (volledig), afspraken, warmtefonds
  const seenEventTitles = new Set(
    feed.map((f) => `${f.title}|${f.at.slice(0, 16)}`)
  );
  for (const ev of leadEvents) {
    const meta = (ev.meta || {}) as Record<string, unknown>;
    const metaProjectId =
      typeof meta.project_id === "string" ? meta.project_id : null;
    if (metaProjectId && metaProjectId !== project.id) continue;

    const soort = (ev.soort || "").toLowerCase();
    const titel = (ev.titel || "").trim();
    if (!titel) continue;

    const relevant =
      soort === "status" ||
      soort === "inkoop" ||
      soort === "afspraak" ||
      soort === "schouw" ||
      soort === "installatie" ||
      soort === "betaling" ||
      titel.toLowerCase().startsWith("projectstatus") ||
      titel.toLowerCase().includes("bestelling volledig") ||
      titel.toLowerCase().includes("warmtefonds") ||
      titel.toLowerCase().includes("materiaal");

    if (!relevant) continue;

    // Skip noisy per-check inkoop (we keep "Bestelling volledig afgevinkt")
    if (
      soort === "inkoop" &&
      titel.toLowerCase().startsWith("inkoop gemarkeerd")
    ) {
      continue;
    }

    // Schouwweek/schouwdag staan al op project — niet dubbel uit lead_events
    if (soort === "schouw" && /Schouwweek gezet/i.test(titel)) continue;
    if (
      soort === "schouw" &&
      /Schouwdag gepland|Schouwdatum gepland/i.test(titel) &&
      project.schouw_at &&
      schouwDagDefinitief
    ) {
      continue;
    }

    // Skip factuur/betaling lead_events — already from facturen entities
    if (soort === "factuur" || soort === "betaling") continue;
    if (
      titel.toLowerCase().includes("factuur") &&
      (titel.toLowerCase().includes("verstuurd") ||
        titel.toLowerCase().includes("betaald") ||
        titel.toLowerCase().includes("aangemaakt"))
    ) {
      continue;
    }

    const dedupeKey = `${titel}|${ev.created_at.slice(0, 16)}`;
    if (seenEventTitles.has(dedupeKey)) continue;
    seenEventTitles.add(dedupeKey);

    let displayTitle = titel;
    if (titel.toLowerCase().startsWith("projectstatus:")) {
      const rest = titel.slice("Projectstatus:".length).trim();
      if (
        rest.toLowerCase().includes("materiaal") ||
        meta.naar === "materiaal_besteld"
      ) {
        displayTitle =
          projectStatusLabel.materiaal_besteld ||
          "Materiaal ingekocht — wachten op levering";
      } else {
        displayTitle = rest || titel;
      }
    }

    feed.push({
      key: `ev-${ev.id}`,
      at: ev.created_at,
      title: displayTitle,
      body: ev.detail || undefined,
      kind: "event",
      icon: iconForLeadEvent(ev),
    });
  }

  const dealAdviseur = (() => {
    const adv = lead?.adviseurs;
    const a = Array.isArray(adv) ? adv[0] : adv;
    return a?.naam?.trim() || null;
  })();
  const handoverAt =
    project.backoffice_afgerond_at || project.created_at;

  const boNotitie = project.backoffice_notitie?.trim();
  if (boNotitie) {
    feed.push({
      key: "note-backoffice",
      at: handoverAt,
      title: boNotitie,
      body: "Notitie backoffice",
      kind: "note",
      author:
        project.backoffice_notitie_door?.trim() || dealAdviseur || null,
      icon: "note",
    });
  }
  const instNotitie = project.installateur_notitie?.trim();
  if (instNotitie) {
    feed.push({
      key: "note-installateur",
      at: handoverAt,
      title: instNotitie,
      body: "Notitie installateur",
      kind: "note",
      author:
        project.installateur_notitie_door?.trim() || dealAdviseur || null,
      icon: "note",
    });
  }

  const noteEntries = parseProjectNotitieEntries(
    project.notities,
    project.updated_at || project.created_at
  );
  noteEntries.forEach((n, i) => {
    feed.push({
      key: `note-${n.at}-${i}`,
      at: n.at,
      title: n.text,
      body: "Notitie",
      kind: "note",
      author: n.author,
      icon: "note",
    });
  });

  // Chronologisch: oud → nieuw. Events met toekomstige plandatum
  // niet onder recente notities duwen.
  const latestNoteMs = feed.reduce((max, item) => {
    if (item.kind !== "note") return max;
    const t = new Date(item.at).getTime();
    return Number.isNaN(t) ? max : Math.max(max, t);
  }, 0);

  const sortMs = (item: FeedItem) => {
    const t = new Date(item.at).getTime();
    const safe = Number.isNaN(t) ? 0 : t;
    if (item.kind !== "note" && latestNoteMs > 0 && safe >= latestNoteMs) {
      return latestNoteMs - 1;
    }
    return safe;
  };

  feed.sort((a, b) => {
    const ta = sortMs(a);
    const tb = sortMs(b);
    if (ta !== tb) return ta - tb;
    if (a.kind === "note" && b.kind !== "note") return 1;
    if (a.kind !== "note" && b.kind === "note") return -1;
    return 0;
  });

  const chatDays = (() => {
    const groups: { dayKey: string; label: string; items: FeedItem[] }[] = [];
    for (const item of feed) {
      const ms = sortMs(item);
      const d = new Date(ms);
      const dayKey = Number.isNaN(d.getTime())
        ? "onbekend"
        : formatInTimeZone(d, "Europe/Amsterdam", "yyyy-MM-dd");
      const last = groups[groups.length - 1];
      if (last && last.dayKey === dayKey) {
        last.items.push(item);
      } else {
        groups.push({
          dayKey,
          label: Number.isNaN(d.getTime())
            ? "—"
            : formatInTimeZone(d, "Europe/Amsterdam", "EEE dd-MM-yyyy", {
                locale: nl,
              }),
          items: [item],
        });
      }
    }
    return groups;
  })();

  const tijdsbestek = (() => {
    const parts: string[] = [];
    if (schouwWeekInfo) {
      parts.push(
        formatProjectSchouwWeek(project) || `Week ${schouwWeekInfo.week}`
      );
    }
    if (project.schouw_at && schouwDagDefinitief) {
      parts.push(`Schouw ${formatDateShort(project.schouw_at)}`);
    }
    if (project.installatie_at) {
      parts.push(`Installatie ${formatDateShort(project.installatie_at)}`);
    }
    if (project.startdatum || project.opleverdatum) {
      parts.push(
        [formatDateShort(project.startdatum), formatDateShort(project.opleverdatum)]
          .filter((x) => x && x !== "—")
          .join(" – ")
      );
    }
    return parts.filter(Boolean).join(" · ") || "Nog niet gepland";
  })();

  const omschrijving =
    project.titel?.trim() ||
    project.backoffice_notitie?.trim() ||
    "Geen omschrijving";

  return (
    <DetailShell onRefresh={load} loading={loading} activeTab="projecten">
      <div className="mb-4 flex flex-wrap items-center gap-3 [&_nav]:mb-0">
        <TerugButton fallbackHref={backHref} />
        <Breadcrumb
          items={[
            { label: "Backoffice", href: backHref },
            { label: project.project_nummer },
          ]}
        />
      </div>

      {okMsg ? (
        <div className="mb-4 border border-green/30 bg-green-soft px-4 py-2.5 text-sm text-green-dark">
          {okMsg}
        </div>
      ) : null}
      {error ? (
        <div className="mb-4 border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Main column */}
        <div className="min-w-0 space-y-4">
          <section className="border border-line bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-semibold text-muted">
                  {project.project_nummer}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-2xl font-semibold text-ink">
                    {klantNaam}
                  </h1>
                  {project.warmtefonds_aangevraagd_at ? (
                    <span className="text-xs text-muted">
                      WF aangevraagd{" "}
                      {formatDateTimeNl(project.warmtefonds_aangevraagd_at)}
                    </span>
                  ) : null}
                </div>
                {(() => {
                  const off = resolveOfferte(project);
                  const track = off?.track_token || null;
                  const lastSeen = off?.track_last_seen_at || null;
                  const mailed = off?.track_mail_verstuurd_at || null;
                  const views = off?.track_view_count ?? 0;
                  const hasOfferte = Boolean(off?.id || project.offerte_id);
                  if (!hasOfferte) return null;
                  return (
                    <div className="mt-2 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {track ? (
                          <a
                            href={`/track/${track}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex text-xs font-semibold text-green-dark underline-offset-2 hover:underline"
                          >
                            Klant track &amp; trace →
                          </a>
                        ) : (
                          <span className="text-xs font-semibold text-muted">
                            Track &amp; trace
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={trackLinkBusy}
                          onClick={() => void copyTrackLink()}
                          className="border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
                        >
                          {trackLinkBusy
                            ? "…"
                            : trackLinkCopied
                              ? "Gekopieerd!"
                              : "Copy link"}
                        </button>
                        {isWarmtefondsProject(project) ? (
                          <button
                            type="button"
                            disabled={wfPortalBusy}
                            onClick={() => void openWarmtefondsPortaal()}
                            className="border border-line bg-white px-2 py-1 text-[11px] font-semibold text-[#0F766E] hover:bg-wash disabled:opacity-50"
                          >
                            {wfPortalBusy
                              ? "…"
                              : "Warmtefonds portaal →"}
                          </button>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-muted">
                        {mailed
                          ? `Mail ${formatDateTimeNl(mailed)}`
                          : "Nog niet gemaild"}
                        {" · "}
                        {lastSeen
                          ? `Laatst geopend ${formatDateTimeNl(lastSeen)}${
                              views > 1 ? ` (${views}×)` : ""
                            }`
                          : "Nog niet geopend"}
                      </p>
                    </div>
                  );
                })()}
              </div>
              {isWarmtefondsProject(project) ? (
                <img
                  src="/brands/warmtefonds-logo.png"
                  alt="Nationaal Warmtefonds"
                  className="ml-auto h-10 w-auto shrink-0 object-contain sm:h-12"
                />
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 sm:px-5">
              <div className="flex min-w-0 flex-wrap gap-0">
                {(
                  [
                    ["overzicht", "Overzicht"],
                    ["financieel", "Financieel"],
                    ["medewerkers", "Medewerkers"],
                    ["service", "Service"],
                  ] as const
                ).map(([id, label]) => {
                  const openService =
                    id === "service"
                      ? serviceVerzoeken.filter((v) => v.status === "open")
                          .length
                      : 0;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setMainTab(id)}
                      className={[
                        "inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold",
                        mainTab === id
                          ? "border-ink text-ink"
                          : "border-transparent text-muted hover:text-ink",
                      ].join(" ")}
                    >
                      {label}
                      {openService > 0 ? (
                        <span className="min-w-[1.1rem] bg-[#C45A12] px-1 py-0.5 text-center text-[10px] font-bold leading-none text-white">
                          {openService}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div className="shrink-0 py-1.5">
                <ProjectStatusSelect
                  project={project}
                  onUpdated={(p) => {
                    setProject((prev) => (prev ? { ...prev, ...p } : p));
                    void refreshLeadEvents(p.lead_id);
                  }}
                />
              </div>
            </div>
          </section>

          {mainTab === "overzicht" ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-end gap-2">
                  {editingGegevens ? (
                    <>
                      {gegevensError ? (
                        <p className="mr-auto text-xs text-red-700">
                          {gegevensError}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        disabled={gegevensSaving}
                        onClick={closeGegevensEditor}
                        className="border border-line bg-white px-3 py-1.5 text-xs font-medium text-muted hover:bg-wash disabled:opacity-60"
                      >
                        Annuleren
                      </button>
                      <button
                        type="button"
                        disabled={gegevensSaving || !gegevensDraft}
                        onClick={() => void saveGegevens()}
                        className="bg-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
                      >
                        {gegevensSaving ? "Opslaan…" : "Opslaan"}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={openGegevensEditor}
                      className="inline-flex items-center gap-1.5 border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                      title="Gegevens bewerken"
                      aria-label="Gegevens bewerken"
                    >
                      <PencilIcon />
                      Bewerken
                    </button>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="border border-line bg-white px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Klant
                    </p>
                    {editingGegevens && gegevensDraft ? (
                      <div className="mt-1.5 space-y-1.5">
                        <input
                          value={gegevensDraft.naam}
                          onChange={(e) =>
                            setGegevensDraft((d) =>
                              d ? { ...d, naam: e.target.value } : d
                            )
                          }
                          placeholder="Naam"
                          className="w-full border border-line bg-wash px-2 py-1.5 text-sm font-semibold text-ink outline-none focus:border-green focus:bg-white"
                          autoComplete="name"
                        />
                        <input
                          type="tel"
                          value={gegevensDraft.telefoon}
                          onChange={(e) =>
                            setGegevensDraft((d) =>
                              d ? { ...d, telefoon: e.target.value } : d
                            )
                          }
                          placeholder="Telefoon"
                          className="w-full border border-line bg-wash px-2 py-1.5 text-xs text-ink outline-none focus:border-green focus:bg-white"
                          autoComplete="tel"
                        />
                        <input
                          type="email"
                          value={gegevensDraft.email}
                          onChange={(e) =>
                            setGegevensDraft((d) =>
                              d ? { ...d, email: e.target.value } : d
                            )
                          }
                          placeholder="E-mail"
                          className="w-full border border-line bg-wash px-2 py-1.5 text-xs text-ink outline-none focus:border-green focus:bg-white"
                          autoComplete="email"
                        />
                      </div>
                    ) : (
                      <>
                        <p className="mt-1.5 text-sm font-semibold text-ink">
                          {klantNaam}
                        </p>
                        {lead?.telefoon ? (
                          <a
                            href={`tel:${lead.telefoon}`}
                            className="mt-0.5 block text-xs text-green-deeper hover:underline"
                          >
                            {lead.telefoon}
                          </a>
                        ) : (
                          <p className="mt-0.5 text-xs text-muted">
                            Geen telefoon
                          </p>
                        )}
                        {lead?.email ? (
                          <a
                            href={`mailto:${lead.email}`}
                            className="mt-0.5 block truncate text-xs text-green-deeper hover:underline"
                          >
                            {lead.email}
                          </a>
                        ) : (
                          <p className="mt-0.5 text-xs text-muted">Geen e-mail</p>
                        )}
                      </>
                    )}
                  </div>
                  <div className="border border-line bg-white px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Tijdsbestek
                    </p>
                    <p className="mt-1.5 text-sm font-medium leading-snug text-ink">
                      {tijdsbestek}
                    </p>
                  </div>
                  <div className="border border-line bg-white px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Locatie
                    </p>
                    {editingGegevens && gegevensDraft ? (
                      <div className="mt-1.5 space-y-1.5">
                        <div className="flex gap-1.5">
                          <input
                            value={gegevensDraft.straat}
                            onChange={(e) =>
                              setGegevensDraft((d) =>
                                d ? { ...d, straat: e.target.value } : d
                              )
                            }
                            placeholder="Straat"
                            className="min-w-0 flex-1 border border-line bg-wash px-2 py-1.5 text-xs text-ink outline-none focus:border-green focus:bg-white"
                          />
                          <input
                            value={gegevensDraft.huisnummer}
                            onChange={(e) =>
                              setGegevensDraft((d) =>
                                d ? { ...d, huisnummer: e.target.value } : d
                              )
                            }
                            placeholder="Nr"
                            className="w-14 border border-line bg-wash px-2 py-1.5 text-xs text-ink outline-none focus:border-green focus:bg-white"
                          />
                          <input
                            value={gegevensDraft.toevoeging}
                            onChange={(e) =>
                              setGegevensDraft((d) =>
                                d ? { ...d, toevoeging: e.target.value } : d
                              )
                            }
                            placeholder="Toev"
                            className="w-14 border border-line bg-wash px-2 py-1.5 text-xs text-ink outline-none focus:border-green focus:bg-white"
                          />
                        </div>
                        <div className="flex gap-1.5">
                          <input
                            value={gegevensDraft.postcode}
                            onChange={(e) =>
                              setGegevensDraft((d) =>
                                d ? { ...d, postcode: e.target.value } : d
                              )
                            }
                            placeholder="Postcode"
                            className="w-24 border border-line bg-wash px-2 py-1.5 text-xs text-ink outline-none focus:border-green focus:bg-white"
                          />
                          <input
                            value={gegevensDraft.plaats}
                            onChange={(e) =>
                              setGegevensDraft((d) =>
                                d ? { ...d, plaats: e.target.value } : d
                              )
                            }
                            placeholder="Plaats"
                            className="min-w-0 flex-1 border border-line bg-wash px-2 py-1.5 text-xs text-ink outline-none focus:border-green focus:bg-white"
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-sm font-medium leading-snug text-ink">
                        {adresRegel(project.leads)}
                      </p>
                    )}
                  </div>
                  <div className="border border-line bg-white px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Omschrijving
                    </p>
                    {editingGegevens && gegevensDraft ? (
                      <textarea
                        value={gegevensDraft.omschrijving}
                        onChange={(e) =>
                          setGegevensDraft((d) =>
                            d ? { ...d, omschrijving: e.target.value } : d
                          )
                        }
                        rows={3}
                        placeholder="Omschrijving"
                        className="mt-1.5 w-full resize-y border border-line bg-wash px-2 py-1.5 text-sm text-ink outline-none focus:border-green focus:bg-white"
                      />
                    ) : (
                      <p className="mt-1.5 line-clamp-3 text-sm font-medium leading-snug text-ink">
                        {omschrijving}
                      </p>
                    )}
                  </div>
                  <div className="border border-line bg-white px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Purchasing
                    </p>
                    <p className="mt-1.5 text-sm font-medium text-ink">
                      Batterij besteld:{" "}
                      <span
                        className={
                          batterijStatus.besteld
                            ? "font-semibold text-green-dark"
                            : "font-semibold text-[#C45A12]"
                        }
                      >
                        {batterijStatus.besteld ? "ja" : "nee"}
                      </span>
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-ink">
                      Batterij geleverd:{" "}
                      <span
                        className={
                          batterijStatus.geleverd
                            ? "font-semibold text-green-dark"
                            : "font-semibold text-muted"
                        }
                      >
                        {batterijStatus.geleverd ? "ja" : "nee"}
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              <ProjectKickoffChecklist
                project={project}
                facturen={facturen}
                onFinancieringUpdated={(p) => {
                  setProject((prev) => (prev ? { ...prev, ...p } : p));
                  void refreshLeadEvents(p.lead_id);
                  setOkMsg("Doorgestuurd naar Edwin.");
                }}
                onProjectUpdated={(p) => {
                  setProject((prev) => (prev ? { ...prev, ...p } : p));
                  void refreshLeadEvents(p.lead_id);
                  setOkMsg("Schouwweek gezet.");
                }}
                onFacturenChanged={() => {
                  void (async () => {
                    const fRes = await fetch(
                      `/api/projecten/${project.id}/facturen`
                    );
                    const fData = await fRes.json().catch(() => ({}));
                    if (fRes.ok) {
                      setFacturen((fData.facturen as Factuur[]) || []);
                    }
                    void refreshLeadEvents(project.lead_id);
                    setOkMsg("Aanbetalingsfactuur verstuurd.");
                  })();
                }}
              />

              <ProjectAfrondingChecklist
                project={project}
                onUpdated={(p) => {
                  setProject((prev) => (prev ? { ...prev, ...p } : p));
                  void refreshLeadEvents(p.lead_id);
                }}
              />

              {/* Pas ná kickoff: order + financiering — anders dubbel/verwarrend */}
              {isKickoffComplete(project, facturen) ? (
                <div className="space-y-3">
                  <ProjectVolgendeStap
                    project={project}
                    disabled={statusSaving}
                    onStatusChange={(s) => void updateStatus(s)}
                    onPlanSchouwdag={() => {
                      setMainTab("overzicht");
                      setAfspraakOpenRequest({
                        soort: "schouwdag",
                        nonce: Date.now(),
                      });
                    }}
                  />

                  <div
                    className={[
                      "grid gap-3",
                      isWarmtefondsProject(project)
                        ? "lg:grid-cols-2"
                        : "grid-cols-1",
                    ].join(" ")}
                  >
                    <section className="border border-line bg-white px-4 py-4 sm:px-5">
                      <ProjectStatusPath
                        status={project.status}
                        betaalwijze={
                          project.betaalwijze === "eigen_middelen"
                            ? "eigen_middelen"
                            : project.betaalwijze === "warmtefonds"
                              ? "warmtefonds"
                              : lead?.status === "sale_eigen_middelen"
                                ? "eigen_middelen"
                                : "warmtefonds"
                        }
                        disabled={statusSaving}
                        onChange={(s) => void updateStatus(s)}
                      />
                    </section>

                    {isWarmtefondsProject(project) ? (
                      <section className="border border-line bg-white px-4 py-4 sm:px-5">
                        {(() => {
                          const wfBedragen = kickoffWarmtefondsBedragen(
                            project,
                            facturen
                          );
                          return (
                            <ProjectFinancieringPath
                              status={resolveFinancieringStatus(project)}
                              afspraakAt={project.warmtefonds_afspraak_at}
                              disabled={statusSaving}
                              onChange={(s, extra) =>
                                void updateFinancieringStatus(s, extra)
                              }
                              aanbetalingInc={wfBedragen.aanbetalingInc}
                              warmtefondsInc={wfBedragen.warmtefondsInc}
                              restantFactuurStatus={
                                facturen.find(
                                  (f) =>
                                    !f.credit_van_factuur_id &&
                                    isRestantFactuurOmschrijving(f.omschrijving)
                                )?.status ?? null
                              }
                              onOpenFinancieel={() => setMainTab("financieel")}
                            />
                          );
                        })()}
                      </section>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* Openstaande acties — afvinken → chat */}
              <section className="border border-line bg-white">
                <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                    Openstaande acties
                    {openActieCount > 0 ? ` (${openActieCount})` : ""}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setNewTaakOpen((v) => !v)}
                    className="bg-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e0651c]"
                  >
                    {newTaakOpen ? "Sluiten" : "+ Taak"}
                  </button>
                </div>
                {newTaakOpen ? (
                  <div className="space-y-3 border-b border-line bg-wash/40 px-4 py-4">
                    <label className="block text-[10px] font-semibold uppercase text-muted">
                      Titel
                      <input
                        value={newTitel}
                        onChange={(e) => setNewTitel(e.target.value)}
                        className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
                      />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="block text-[10px] font-semibold uppercase text-muted">
                        Afdeling
                        <select
                          value={newAfdeling}
                          onChange={(e) => setNewAfdeling(e.target.value)}
                          className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm"
                        >
                          <option value="">Kies…</option>
                          {PROJECT_AFDELINGEN.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-[10px] font-semibold uppercase text-muted">
                        Verantwoordelijke
                        <select
                          value={newPersonId}
                          onChange={(e) => setNewPersonId(e.target.value)}
                          className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm"
                        >
                          <option value="">Kies…</option>
                          {adviseurs.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.naam}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-[10px] font-semibold uppercase text-muted">
                        Due
                        <input
                          type="date"
                          value={newDue}
                          onChange={(e) => setNewDue(e.target.value)}
                          className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm"
                        />
                      </label>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={creatingTaak}
                        onClick={() => void createTaak()}
                        className="bg-orange px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {creatingTaak ? "Bezig…" : "Taak aanmaken"}
                      </button>
                    </div>
                  </div>
                ) : null}
                {openActieCount === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted">
                    Geen openstaande acties voor deze klant.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {openBoActies.map((a) => (
                      <li
                        key={a.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">
                            {a.titel}
                          </p>
                          {a.detail ? (
                            <p className="mt-0.5 text-[11px] text-muted">
                              {a.detail}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {a.soort === "aangetekende_brief" ? (
                            <a
                              href={`/api/projecten/${project.id}/aangetekende-brief`}
                              target="_blank"
                              rel="noreferrer"
                              className="border border-[#9A3B1A]/30 bg-[#FFF6F2] px-2.5 py-1.5 text-[11px] font-semibold text-[#9A3B1A] hover:bg-[#FFE8DF]"
                            >
                              Download PDF
                            </a>
                          ) : null}
                          <button
                            type="button"
                            disabled={completingId === a.id}
                            onClick={() =>
                              void completeBoActie(a.id, a.titel, a.soort)
                            }
                            className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#0D5C32]/25 bg-[#E8F6EC] text-lg leading-none hover:bg-[#d4eedc] disabled:opacity-50"
                            title="Afronden"
                            aria-label="Afronden"
                          >
                            {completingId === a.id ? "…" : "✅"}
                          </button>
                        </div>
                      </li>
                    ))}
                    {openTaken.map((t) => {
                      const person = Array.isArray(t.verantwoordelijke)
                        ? t.verantwoordelijke[0]
                        : t.verantwoordelijke;
                      return (
                        <li
                          key={t.id}
                          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-ink">
                              {t.titel}
                            </p>
                            <p className="text-[11px] text-muted">
                              {t.afdeling}
                              {t.due_at
                                ? ` · ${formatDateShort(t.due_at)}`
                                : ""}
                              {person?.naam ? ` · ${person.naam}` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              value={person?.id || ""}
                              onChange={(e) =>
                                void assignTaak(t.id, e.target.value || null)
                              }
                              className="max-w-[9rem] border border-line bg-white px-2 py-1 text-xs"
                            >
                              <option value="">Niet toegewezen</option>
                              {adviseurs.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.naam}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={completingId === t.id}
                              onClick={() => void completeOpenTaak(t)}
                              className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#0D5C32]/25 bg-[#E8F6EC] text-lg leading-none hover:bg-[#d4eedc] disabled:opacity-50"
                              title="Afronden"
                              aria-label="Afronden"
                            >
                              {completingId === t.id ? "…" : "✅"}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="border border-line bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 sm:px-5">
                  <div className="flex gap-0">
                    {(
                      [
                        ["documenten", "Documenten"],
                        ["rapporten", "Rapporten"],
                        ["bestanden", "Bestandsopslag"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setDocsTab(id)}
                        className={[
                          "border-b-2 px-3 py-2.5 text-sm font-semibold",
                          docsTab === id
                            ? "border-ink text-ink"
                            : "border-transparent text-muted hover:text-ink",
                        ].join(" ")}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 py-1">
                    {docsTab === "rapporten" ? (
                      <label className="cursor-pointer border border-line bg-wash px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white">
                        {uploadingSchouw ? "Bezig…" : "+ Schouwrapport"}
                        <input
                          type="file"
                          accept="image/*,application/pdf,.pdf"
                          className="hidden"
                          disabled={uploadingSchouw}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void uploadSchouwFormulier(file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    ) : null}
                    {docsTab === "bestanden" ? (
                      <label className="cursor-pointer bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-deeper">
                        {uploading ? "Bezig…" : "+ Upload"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploading}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void uploadFoto(file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    ) : null}
                  </div>
                </div>

                <div className="px-4 py-4 sm:px-5">
                  {docsTab === "documenten" ? (
                    <div className="space-y-5">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                          Offertes
                        </p>
                        {project.offerte_id ? (
                          <ul className="mt-2 divide-y divide-line border border-line">
                            {bedenktijd ? (
                              <li className="border-b border-line px-3 py-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                                    Wettelijke bedenktijd
                                  </p>
                                  {bedenktijd.klaar ? (
                                    <span
                                      className="text-sm leading-none"
                                      title="Bedenktijd voorbij"
                                      aria-label="Bedenktijd voorbij"
                                    >
                                      ✅
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-muted">
                                      nog {bedenktijd.dagenOver}{" "}
                                      {bedenktijd.dagenOver === 1
                                        ? "dag"
                                        : "dagen"}
                                    </span>
                                  )}
                                </div>
                                <div
                                  className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line"
                                  role="progressbar"
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-valuenow={Math.round(
                                    bedenktijd.pct * 100
                                  )}
                                  aria-label="Voortgang wettelijke bedenktijd"
                                >
                                  <div
                                    className={[
                                      "h-full rounded-full transition-[width]",
                                      bedenktijd.klaar
                                        ? "bg-green"
                                        : "bg-green/80",
                                    ].join(" ")}
                                    style={{
                                      width: `${Math.round(bedenktijd.pct * 100)}%`,
                                    }}
                                  />
                                </div>
                                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted">
                                  <span>
                                    Ondertekend {bedenktijd.startLabel}
                                  </span>
                                  <span>
                                    Einde {bedenktijd.eindLabel}
                                  </span>
                                </div>
                              </li>
                            ) : null}
                            <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-ink">
                                  Offerte {klantNaam}
                                </p>
                                <p className="text-[11px] text-muted">
                                  Ondertekende PDF
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={pdfBusy}
                                onClick={() => void downloadOffertePdf()}
                                className="border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
                              >
                                {pdfBusy ? "…" : "PDF downloaden"}
                              </button>
                            </li>
                          </ul>
                        ) : (
                          <p className="mt-2 text-sm text-muted">
                            Geen offerte gekoppeld.
                          </p>
                        )}
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                          Facturen
                        </p>
                        {facturen.length === 0 ? (
                          <p className="mt-2 text-sm text-muted">
                            Nog geen facturen. Maak er een aan onder
                            Financieel.
                          </p>
                        ) : (
                          <ul className="mt-2 divide-y divide-line border border-line">
                            {facturen
                              .filter((f) => !f.credit_van_factuur_id)
                              .map((f) => {
                                const heeftCredit = facturen.some(
                                  (c) => c.credit_van_factuur_id === f.id
                                );
                                return (
                              <li
                                key={f.id}
                                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-ink">
                                    {f.factuur_nummer}
                                  </p>
                                  <p className="text-[11px] text-muted">
                                    {formatEuro(f.bedrag_inc_btw)} ·{" "}
                                    {formatDateShort(f.created_at)}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <StatusBadge
                                    kind="factuur"
                                    value={factuurDisplayStatus(f, {
                                      heeftCredit,
                                    })}
                                  />
                                  <Link
                                    href={`/facturen/${f.id}`}
                                    className="border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-wash"
                                  >
                                    Openen
                                  </Link>
                                </div>
                              </li>
                                );
                              })}
                          </ul>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {docsTab === "rapporten" ? (
                    schouwFormulieren.length === 0 ? (
                      <p className="text-sm text-muted">
                        Nog geen schouwrapport geüpload.
                      </p>
                    ) : (
                      <ul className="divide-y divide-line border border-line">
                        {schouwFormulieren.map((f) => {
                          const isPdf =
                            /\.pdf$/i.test(f.bestandsnaam || "") ||
                            /\.pdf$/i.test(f.storage_path || "");
                          return (
                            <li
                              key={f.id}
                              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-ink">
                                  {f.bestandsnaam || "Schouwrapport"}
                                </p>
                                <p className="text-[11px] text-muted">
                                  {formatDateShort(f.created_at)}
                                  {isPdf ? " · PDF" : " · Afbeelding"}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {f.url ? (
                                  <a
                                    href={f.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-wash"
                                  >
                                    Openen
                                  </a>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => void deleteFoto(f.id)}
                                  className="border border-line px-2.5 py-1 text-xs font-semibold text-[#C45A12] hover:bg-wash"
                                >
                                  Verwijder
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )
                  ) : null}

                  {docsTab === "bestanden" ? (
                    normaleFotos.length === 0 ? (
                      <div className="border border-dashed border-line bg-wash/40 px-4 py-10 text-center">
                        <p className="text-sm text-muted">
                          Selecteer of sleep foto&apos;s om te uploaden
                        </p>
                      </div>
                    ) : (
                      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                        {normaleFotos.map((f) => (
                          <li
                            key={f.id}
                            className="group relative overflow-hidden border border-line"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={f.url || undefined}
                              alt={f.bestandsnaam || "Foto"}
                              className="aspect-square w-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => void deleteFoto(f.id)}
                              className="absolute right-1 top-1 hidden bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-[#C45A12] group-hover:block"
                            >
                              Verwijder
                            </button>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                </div>
              </section>

              <ProjectAgendaAfspraakSection
                project={project}
                onChanged={() => void load()}
                openSoortRequest={afspraakOpenRequest}
              />
            </>
          ) : mainTab === "financieel" ? (
            <div className="space-y-4">
              <ProjectFinancieelSection
                projectId={project.id}
                leadEmail={lead?.email}
                defaultOpen
                alwaysOpen
                onFacturenChanged={(list) => setFacturen(list)}
                offerteId={project.offerte_id}
                warmtefonds={isWarmtefondsProject(project)}
                financieringStatus={resolveFinancieringStatus(project)}
              />
              <ProjectInkoopSection
                project={project}
                onProjectUpdated={(p) => {
                  setProject(p);
                  void refreshLeadEvents(p.lead_id);
                }}
              />
            </div>
          ) : mainTab === "service" ? (
            <ProjectServiceSection
              project={project}
              verzoeken={serviceVerzoeken}
              onChanged={() => void load()}
            />
          ) : (
            <section className="border border-line bg-white px-4 py-5 sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                    Medewerkers
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Gekoppelde sales, backoffice en installateur — zichtbaar als
                    initialen bij Leden in de projectenlijst.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setContactOpen(true)}
                  className="shrink-0 border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-green hover:text-green-dark"
                >
                  Contact
                </button>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Sales-adviseur
                  <select
                    value={lead?.adviseur_id || ""}
                    disabled={medewerkerBusy || !project.lead_id}
                    onChange={(e) =>
                      void saveSalesAdviseur(
                        e.target.value ? e.target.value : null
                      )
                    }
                    className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green disabled:opacity-60"
                  >
                    <option value="">Niet gekoppeld</option>
                    {adviseurs
                      .filter(
                        (a) =>
                          !a.rol ||
                          a.rol === "adviseur" ||
                          a.rol === "admin" ||
                          a.id === lead?.adviseur_id
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.naam}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Backoffice-medewerker
                  <select
                    value={project.verantwoordelijke_id || ""}
                    disabled={medewerkerBusy}
                    onChange={(e) =>
                      void saveBackofficeMedewerker(
                        e.target.value ? e.target.value : null
                      )
                    }
                    className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green disabled:opacity-60"
                  >
                    <option value="">Niet gekoppeld</option>
                    {adviseurs
                      .filter(
                        (a) =>
                          a.rol === "backoffice" ||
                          a.rol === "admin" ||
                          a.id === project.verantwoordelijke_id
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.naam}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Installateur
                  <select
                    value={project.installatie_partner_id || ""}
                    disabled={medewerkerBusy}
                    onChange={(e) =>
                      void saveInstallateur(
                        e.target.value ? e.target.value : null
                      )
                    }
                    className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green disabled:opacity-60"
                  >
                    <option value="">Niet gekoppeld</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.naam}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
          )}
        </div>

        {/* Activiteitenlijn */}
        <aside className="flex min-h-[28rem] flex-col border border-line bg-white lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="font-display text-base font-semibold text-ink">
                Activiteiten
              </h2>
              <p className="mt-0.5 text-[11px] text-muted">
                Tijdlijn van dit project
              </p>
            </div>
          </div>

          <div
            ref={chatScrollRef}
            className="min-h-0 flex-1 overflow-auto px-4 py-4"
          >
            {chatDays.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                Nog geen activiteiten. Typ hieronder een notitie.
              </p>
            ) : (
              <ol className="relative space-y-0 border-l border-line pl-5">
                {chatDays.flatMap((group) =>
                  group.items.map((item) => {
                    const isNote = item.kind === "note";
                    return (
                      <li key={item.key} className="relative pb-4 last:pb-0">
                        <span
                          className={[
                            "absolute -left-[1.55rem] top-0.5 flex h-7 w-7 items-center justify-center rounded-full border",
                            feedIconTone(item.icon, isNote),
                          ].join(" ")}
                        >
                          {feedIconEl(item.icon)}
                        </span>
                        <p className="pl-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          {formatDateTimeNl(item.at)}
                          {isNote
                            ? item.author
                              ? ` · Notitie · ${item.author}`
                              : " · Notitie"
                            : item.body &&
                                (item.body === "Offerte ondertekend" ||
                                  item.body.startsWith("Notitie"))
                              ? ` · ${item.body}`
                              : ""}
                        </p>
                        <p className="mt-0.5 pl-1 text-sm font-semibold text-ink">
                          {item.title}
                        </p>
                        {item.body &&
                        item.body !== "Notitie" &&
                        item.body !== "Offerte ondertekend" &&
                        !item.body.startsWith("Notitie ") ? (
                          <p className="mt-0.5 whitespace-pre-wrap pl-1 text-sm text-muted">
                            {item.body}
                          </p>
                        ) : null}
                      </li>
                    );
                  })
                )}
              </ol>
            )}
          </div>

          <div className="border-t border-line bg-white px-4 py-3">
            <div className="flex items-end gap-2">
              <PencilIcon className="mb-2.5 h-3.5 w-3.5 shrink-0 text-muted" />
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={1}
                placeholder="Typ een notitie…"
                className="min-h-[1.75rem] w-full flex-1 resize-none border-0 border-b border-dotted border-muted/50 bg-transparent px-0 py-1.5 text-sm text-ink outline-none placeholder:text-muted/60 focus:border-green"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (noteDraft.trim() && !noteBusy) void addNotitie();
                  }
                }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 pl-5">
              <p className="text-[10px] text-muted">
                {session?.naam ? `Als ${session.naam} · ` : ""}
                Enter om te bewaren
              </p>
              <button
                type="button"
                disabled={noteBusy || !noteDraft.trim()}
                onClick={() => void addNotitie()}
                className="text-xs font-semibold text-green-deeper hover:underline disabled:opacity-40"
              >
                {noteBusy ? "Bezig…" : "Bewaren"}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {contactOpen ? (
        <KlantContactMailModal
          project={project}
          onClose={() => setContactOpen(false)}
        />
      ) : null}
    </DetailShell>
  );
}
