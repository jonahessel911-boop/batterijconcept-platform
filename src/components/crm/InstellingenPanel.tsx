"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import type { Adviseur, InstallatiePartner } from "@/types/database";
import type { WarmtefondsOperator } from "@/lib/warmtefonds-portal";
import { PartnerTeamgenotenPanel } from "@/components/installatie/PartnerTeamgenotenPanel";
import {
  TEAM_ROLLEN,
  gebruikerRolLabel,
  normalizeRol,
  teamRolUitleg,
  type GebruikerRol,
  type TeamRol,
} from "@/lib/rollen";
import { RelatieContractUpload } from "./RelatieContractUpload";
import { TeamRelatieOnboarding } from "./TeamRelatieOnboarding";
import { PartnerMonteursCrmPanel } from "./PartnerMonteursCrmPanel";
import { TeamNotitiesSection } from "./TeamNotitiesSection";
import { BellerCommissieWeeks } from "./BellerCommissieWeeks";
import { OpsManagerCommissieWeeks } from "./OpsManagerCommissieWeeks";
import { AdviseurProductenSection } from "./AdviseurProductenSection";
import { isUsableStartAdres } from "@/lib/start-adres";
import { formatDateTimeNl, formatEuro } from "@/lib/format";
import { parseProjectNotitieEntries } from "@/lib/lead-notitie";
import { StartAdresPostcodeField } from "./StartAdresPostcodeField";
import { clearCrmShellCache } from "@/lib/crm-shell-cache";
import { useCrmSession } from "@/hooks/useCrmSession";
import {
  isOpsManagerAdviseur,
  opsCommissieLabelVoorRol,
} from "@/lib/ops-commissie";
import { isSpareAdviseur } from "@/lib/admin-adviseur";
import { adviseurProfielfotoPublicUrl } from "@/lib/adviseur-profielfoto";
import { WfPartnerTariefVeld } from "./WfPartnerTariefVeld";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  EDERGY_PER_AANVRAAG_EXCL,
  edergyBedragenVanInc,
} from "@/lib/edergy-tarief";

type ListFilter = "medewerkers" | "partners" | "warmtefonds";

function isSalesRol(rol: string | null | undefined): boolean {
  return normalizeRol(rol) === "adviseur";
}

/** ZZP/factuurvelden: sales + iedereen met bel-/opscommissie-uitbetaling. */
function needsFactuurgegevens(opts: {
  rol: string | null | undefined;
  id: string;
  naam?: string | null;
  email?: string | null;
}): boolean {
  if (isSalesRol(opts.rol)) return true;
  if (normalizeRol(opts.rol) === "beller") return true;
  return isOpsManagerAdviseur({
    id: opts.id,
    naam: opts.naam,
    email: opts.email,
    rol: opts.rol,
  });
}

function portalBase(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "https://platform.batterijconcept.nl";
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

function naamInitialen(naam: string): string {
  return naam
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

const ROL_BADGE: Record<TeamRol, string> = {
  admin: "bg-[#1a2e24] text-white",
  sales_manager: "bg-[#E8F0F6] text-[#1A4A6E]",
  adviseur: "bg-green-soft text-green-dark",
  beller: "bg-wash text-ink",
  backoffice: "bg-[#eef2f0] text-[#3d5248]",
  warmtefonds: "bg-[#FFF0E6] text-[#C45A12]",
  recruiter: "bg-[#E7F0EC] text-[#1F4D3A]",
};

export function InstellingenPanel({
  onAdviseursChange,
  /** Alleen adviseurs/team — geen installatiepartners. */
  teamOnly = false,
  /** Extern gestuurd filter (bijv. via PartnersPanel-tabs). */
  listFilter,
  /** Verberg Team/Installatie/Warmtefonds-tabs (nav zit in parent). */
  hideListTabs = false,
  /** Verberg interne rol-chips (parent toont die). */
  hideTeamRolFilter = false,
  /** Extern gestuurde teamrol (bij hideTeamRolFilter). */
  forcedTeamRol,
  /** UI-tekst “Monteur” i.p.v. “Installatiepartner” (legacy). */
  monteurLabel = false,
}: {
  onAdviseursChange?: () => void;
  teamOnly?: boolean;
  listFilter?: ListFilter;
  hideListTabs?: boolean;
  hideTeamRolFilter?: boolean;
  forcedTeamRol?: "all" | TeamRol;
  /** @deprecated altijd Installatiepartner */
  monteurLabel?: boolean;
}) {
  const { session } = useCrmSession();
  const searchParams = useSearchParams();
  const teamgenootFromUrl = searchParams.get("teamgenoot");
  const [filter, setFilter] = useState<ListFilter>(
    listFilter ?? "medewerkers"
  );
  /** Rolfilter binnen Team: all of een specifieke login-rol. */
  const [teamRolFilter, setTeamRolFilter] = useState<"all" | TeamRol>(
    forcedTeamRol ?? "all"
  );
  const [zoek, setZoek] = useState("");
  const partnerWoord = "Installatiepartner";
  const partnerWoordMeervoud = "installatiepartners";
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [wfOperators, setWfOperators] = useState<WarmtefondsOperator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [expandedPartnerId, setExpandedPartnerId] = useState<string | null>(
    null
  );
  const [focusTeamgenootId, setFocusTeamgenootId] = useState<string | null>(
    teamgenootFromUrl
  );

  useEffect(() => {
    setFocusTeamgenootId(teamgenootFromUrl);
  }, [teamgenootFromUrl]);

  useEffect(() => {
    if (!focusTeamgenootId || partners.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/installatie-partners/teamgenoten/${encodeURIComponent(focusTeamgenootId)}/installaties`
        );
        const data = await res.json().catch(() => ({}));
        const partnerId =
          (data.teamgenoot as { partner_id?: string } | null)?.partner_id ||
          null;
        if (!cancelled && partnerId) {
          setExpandedPartnerId(partnerId);
          if (!listFilter) setFilter("partners");
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusTeamgenootId, partners.length, listFilter]);

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [rol, setRol] = useState<GebruikerRol>("beller");
  const [startdatum, setStartdatum] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<ListFilter | null>(null);
  const [draft, setDraft] = useState<Partial<Adviseur> | null>(null);
  const [partnerDraft, setPartnerDraft] = useState<Partial<InstallatiePartner> | null>(
    null
  );
  const [wfDraft, setWfDraft] = useState<Partial<WarmtefondsOperator> | null>(
    null
  );
  const [detailSaving, setDetailSaving] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [loginAlsId, setLoginAlsId] = useState<string | null>(null);

  useEffect(() => {
    if (teamOnly) setFilter("medewerkers");
  }, [teamOnly]);

  useEffect(() => {
    if (!listFilter) return;
    setFilter(listFilter);
    setSelectedId(null);
    setSelectedKind(null);
    setDraft(null);
    setPartnerDraft(null);
    setWfDraft(null);
    setAddOpen(false);
  }, [listFilter]);

  useEffect(() => {
    if (forcedTeamRol == null) return;
    setTeamRolFilter(forcedTeamRol);
  }, [forcedTeamRol]);

  const activeFilter: ListFilter = teamOnly
    ? "medewerkers"
    : listFilter ?? filter;

  const selectedAdviseur =
    selectedKind === "medewerkers"
      ? adviseurs.find((a) => a.id === selectedId) || null
      : null;
  const selectedPartner =
    selectedKind === "partners"
      ? partners.find((p) => p.id === selectedId) || null
      : null;
  const selectedWf =
    selectedKind === "warmtefonds"
      ? wfOperators.find((o) => o.id === selectedId) || null
      : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [aRes, pRes, wRes] = await Promise.all([
        fetch("/api/adviseurs?include_inactive=1"),
        fetch("/api/installatie-partners?include_inactive=1"),
        fetch("/api/warmtefonds-operators?include_inactive=1"),
      ]);
      const aData = await aRes.json();
      const pData = await pRes.json();
      const wData = await wRes.json();
      if (!aRes.ok) throw new Error(aData.error || "Medewerkers laden mislukt");
      if (!pRes.ok) throw new Error(pData.error || "Partners laden mislukt");
      if (!wRes.ok)
        throw new Error(wData.error || "Warmtefondspartners laden mislukt");
      setAdviseurs(aData.adviseurs || []);
      setPartners(pData.partners || []);
      setWfOperators(wData.operators || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  function resetAddForm(prefRol?: GebruikerRol) {
    setNaam("");
    setEmail("");
    setTelefoon("");
    const next =
      prefRol &&
      (TEAM_ROLLEN as readonly string[]).includes(prefRol)
        ? prefRol
        : teamRolFilter !== "all"
          ? teamRolFilter
          : "beller";
    setRol(next);
    if (next === "adviseur") {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, "0");
      const d = String(today.getDate()).padStart(2, "0");
      setStartdatum(`${y}-${m}-${d}`);
    } else {
      setStartdatum("");
    }
  }

  async function deleteMedewerker(a: Adviseur) {
    const ok = window.confirm(
      `Account “${a.naam}” verwijderen?\n\nKan niet meer inloggen. Gekoppelde leads blijven bestaan.`
    );
    if (!ok) return;
    setDeleting(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/adviseurs?id=${encodeURIComponent(a.id)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      clearCrmShellCache();
      onAdviseursChange?.();
      closeDetail();
      await load();
      setOkMsg(
        data.mode === "deactivated"
          ? `${a.naam} gedeactiveerd (had gekoppelde data).`
          : `${a.naam} verwijderd.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    } finally {
      setDeleting(false);
    }
  }

  function openMedewerker(a: Adviseur) {
    setSelectedKind("medewerkers");
    setSelectedId(a.id);
    setPartnerDraft(null);
    setWfDraft(null);
    setDraft({
      naam: a.naam,
      email: a.email,
      telefoon: a.telefoon,
      unite_lijn: a.unite_lijn ?? "",
      unite_ext: a.unite_ext ?? "",
      rol: normalizeRol(a.rol),
      start_adres: a.start_adres ?? null,
      start_vanaf_huis_maandag: a.start_vanaf_huis_maandag === true,
      startdatum: a.startdatum ?? null,
      commissie_pct:
        a.commissie_pct != null && Number.isFinite(Number(a.commissie_pct))
          ? Number(a.commissie_pct)
          : 10,
      actief: a.actief !== false,
      geblokkeerd: a.geblokkeerd === true,
      bedrijfsnaam: a.bedrijfsnaam ?? "",
      kvk_nummer: a.kvk_nummer ?? "",
      btw_nummer: a.btw_nummer ?? "",
      factuur_adres: a.factuur_adres ?? "",
      factuur_postcode: a.factuur_postcode ?? "",
      factuur_plaats: a.factuur_plaats ?? "",
      iban: a.iban ?? "",
      max_factuur_bedrag: a.max_factuur_bedrag ?? null,
      contract_storage_path: a.contract_storage_path ?? null,
      contract_bestandsnaam: a.contract_bestandsnaam ?? null,
      contract_uploaded_at: a.contract_uploaded_at ?? null,
      contract_sign_status: a.contract_sign_status ?? null,
      contract_signed_at: a.contract_signed_at ?? null,
      kvk_uitreksel_storage_path: a.kvk_uitreksel_storage_path ?? null,
      kvk_uitreksel_bestandsnaam: a.kvk_uitreksel_bestandsnaam ?? null,
      kvk_uitreksel_uploaded_at: a.kvk_uitreksel_uploaded_at ?? null,
      interne_notities: a.interne_notities ?? null,
      profielfoto_path: a.profielfoto_path ?? null,
    });
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setOkMsg(null);
  }

  function openPartner(p: InstallatiePartner) {
    setSelectedKind("partners");
    setSelectedId(p.id);
    setDraft(null);
    setWfDraft(null);
    setPartnerDraft({
      naam: p.naam,
      email: p.email,
      telefoon: p.telefoon,
      actief: p.actief !== false,
      bedrijfsnaam: p.bedrijfsnaam ?? "",
      kvk_nummer: p.kvk_nummer ?? "",
      btw_nummer: p.btw_nummer ?? "",
      factuur_adres: p.factuur_adres ?? "",
      factuur_postcode: p.factuur_postcode ?? "",
      factuur_plaats: p.factuur_plaats ?? "",
      iban: p.iban ?? "",
      contract_storage_path: p.contract_storage_path ?? null,
      contract_bestandsnaam: p.contract_bestandsnaam ?? null,
      contract_uploaded_at: p.contract_uploaded_at ?? null,
      kvk_uitreksel_storage_path: p.kvk_uitreksel_storage_path ?? null,
      kvk_uitreksel_bestandsnaam: p.kvk_uitreksel_bestandsnaam ?? null,
      kvk_uitreksel_uploaded_at: p.kvk_uitreksel_uploaded_at ?? null,
      certificaten_storage_path: p.certificaten_storage_path ?? null,
      certificaten_bestandsnaam: p.certificaten_bestandsnaam ?? null,
      certificaten_uploaded_at: p.certificaten_uploaded_at ?? null,
      interne_notities: p.interne_notities ?? null,
    });
    setError(null);
    setOkMsg(null);
  }

  async function saveMedewerkerNotities(next: string) {
    if (!selectedAdviseur) throw new Error("Geen medewerker geselecteerd");
    const res = await fetch("/api/adviseurs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: selectedAdviseur.id,
        interne_notities: next,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        (data as { error?: string }).error || "Notitie opslaan mislukt"
      );
    }
    const updated = (data as { adviseur?: Adviseur }).adviseur;
    if (updated) {
      setAdviseurs((prev) =>
        prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a))
      );
      setDraft((d) =>
        d ? { ...d, interne_notities: updated.interne_notities ?? next } : d
      );
    } else {
      setDraft((d) => (d ? { ...d, interne_notities: next } : d));
    }
    setOkMsg("Notitie opgeslagen.");
  }

  async function savePartnerNotities(next: string) {
    if (!selectedPartner) throw new Error("Geen monteur geselecteerd");
    const res = await fetch("/api/installatie-partners", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: selectedPartner.id,
        interne_notities: next,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        (data as { error?: string }).error || "Notitie opslaan mislukt"
      );
    }
    const updated = (data as { partner?: InstallatiePartner }).partner;
    if (updated) {
      setPartners((prev) =>
        prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
      );
      setPartnerDraft((d) =>
        d ? { ...d, interne_notities: updated.interne_notities ?? next } : d
      );
    } else {
      setPartnerDraft((d) => (d ? { ...d, interne_notities: next } : d));
    }
    setOkMsg("Notitie opgeslagen.");
  }

  function openWarmtefonds(o: WarmtefondsOperator) {
    setSelectedKind("warmtefonds");
    setSelectedId(o.id);
    setDraft(null);
    setPartnerDraft(null);
    setWfDraft({
      naam: o.naam,
      email: o.email,
      telefoon: o.telefoon,
      actief: o.actief !== false,
      portal_token: o.portal_token,
    });
    setError(null);
    setOkMsg(null);
  }

  function closeDetail() {
    setSelectedId(null);
    setSelectedKind(null);
    setDraft(null);
    setPartnerDraft(null);
    setWfDraft(null);
    setNewPassword("");
    setConfirmPassword("");
  }

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      if (activeFilter === "medewerkers") {
        if (rol === "adviseur" && !startdatum.trim()) {
          throw new Error("Vul een startdatum in voor de adviseur");
        }
        const res = await fetch("/api/adviseurs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            naam,
            email,
            telefoon,
            rol,
            ...(rol === "adviseur" ? { commissie_pct: 10 } : {}),
            ...(rol === "adviseur" ? { startdatum } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
        const blockedDays = data.agenda_blocked?.blockedDays as
          | number
          | undefined;
        const blockNote =
          blockedDays && blockedDays > 0
            ? ` Agenda geblokkeerd tot startdatum (${blockedDays} dagen).`
            : "";
        setOkMsg(
          data.mail_sent
            ? `${data.adviseur.naam} toegevoegd — welkomstmail verstuurd.${blockNote}`
            : `${data.adviseur.naam} toegevoegd${data.mail_error ? ` (mail: ${data.mail_error})` : ""}.${blockNote}`
        );
        onAdviseursChange?.();
      } else if (activeFilter === "warmtefonds") {
        const res = await fetch("/api/warmtefonds-operators", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ naam, email, telefoon }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
        const op = data.operator as WarmtefondsOperator | undefined;
        setOkMsg(
          data.mail_sent
            ? `${op?.naam || "Partner"} toegevoegd — inloggegevens gemaild.`
            : `${op?.naam || "Partner"} toegevoegd${
                data.mail_error ? ` (mail: ${data.mail_error})` : ""
              }.`
        );
      } else {
        const res = await fetch("/api/installatie-partners", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ naam, email, telefoon }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
        setOkMsg(
          `${data.partner.naam} is toegevoegd als ${partnerWoord.toLowerCase()}.`
        );
      }
      resetAddForm();
      setAddOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  async function saveMedewerker() {
    if (!selectedAdviseur || !draft) return;
    setDetailSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const patch: Record<string, unknown> = {
        id: selectedAdviseur.id,
        naam: (draft.naam || "").trim(),
        email: draft.email?.toString().trim().toLowerCase() || null,
        telefoon: draft.telefoon?.toString().trim() || null,
        unite_lijn: draft.unite_lijn?.toString().trim() || null,
        unite_ext: draft.unite_ext?.toString().trim() || null,
        rol: normalizeRol(draft.rol),
        start_adres: draft.start_adres?.toString().trim() || null,
        start_vanaf_huis_maandag: draft.start_vanaf_huis_maandag === true,
        actief: draft.actief !== false,
        geblokkeerd: draft.geblokkeerd === true,
      };
      if (isSalesRol(draft.rol)) {
        const pct = Number(draft.commissie_pct) || 0;
        if (pct < 0 || pct > 100) throw new Error("Commissie moet tussen 0 en 100% zijn");
        patch.commissie_pct = Math.round(pct * 100) / 100;
        patch.startdatum = draft.startdatum?.toString().trim() || null;
      }
      if (
        needsFactuurgegevens({
          rol: draft.rol,
          id: selectedAdviseur.id,
          naam: draft.naam ?? selectedAdviseur.naam,
          email: draft.email ?? selectedAdviseur.email,
        })
      ) {
        patch.bedrijfsnaam = draft.bedrijfsnaam?.toString().trim() || null;
        patch.kvk_nummer = draft.kvk_nummer?.toString().trim() || null;
        patch.btw_nummer = draft.btw_nummer?.toString().trim() || null;
        patch.factuur_adres = draft.factuur_adres?.toString().trim() || null;
        patch.factuur_postcode = draft.factuur_postcode?.toString().trim() || null;
        patch.factuur_plaats = draft.factuur_plaats?.toString().trim() || null;
        patch.iban = draft.iban?.toString().trim().toUpperCase() || null;
        if (
          draft.max_factuur_bedrag === null ||
          draft.max_factuur_bedrag === undefined
        ) {
          patch.max_factuur_bedrag = null;
        } else {
          const max = Number(draft.max_factuur_bedrag);
          if (!Number.isFinite(max) || max < 0) {
            throw new Error("Max factuurbedrag ongeldig");
          }
          patch.max_factuur_bedrag = Math.round(max * 100) / 100;
        }
      }
      const res = await fetch("/api/adviseurs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bijwerken mislukt");
      setOkMsg("Opgeslagen.");
      await load();
      onAdviseursChange?.();
      if (data.adviseur) openMedewerker(data.adviseur as Adviseur);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setDetailSaving(false);
    }
  }

  async function savePartner() {
    if (!selectedPartner || !partnerDraft) return;
    setDetailSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/installatie-partners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedPartner.id,
          naam: (partnerDraft.naam || "").trim(),
          email: partnerDraft.email?.toString().trim().toLowerCase() || null,
          telefoon: partnerDraft.telefoon?.toString().trim() || null,
          actief: partnerDraft.actief !== false,
          bedrijfsnaam: partnerDraft.bedrijfsnaam?.toString().trim() || null,
          kvk_nummer: partnerDraft.kvk_nummer?.toString().trim() || null,
          btw_nummer: partnerDraft.btw_nummer?.toString().trim() || null,
          factuur_adres: partnerDraft.factuur_adres?.toString().trim() || null,
          factuur_postcode:
            partnerDraft.factuur_postcode?.toString().trim() || null,
          factuur_plaats: partnerDraft.factuur_plaats?.toString().trim() || null,
          iban: partnerDraft.iban?.toString().trim().toUpperCase() || null,
          start_adres: partnerDraft.start_adres?.toString().trim() || null,
          reistijd_buffer_min:
            typeof partnerDraft.reistijd_buffer_min === "number"
              ? partnerDraft.reistijd_buffer_min
              : partnerDraft.reistijd_buffer_min != null
                ? Number(partnerDraft.reistijd_buffer_min)
                : 30,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bijwerken mislukt");
      setOkMsg("Opgeslagen.");
      await load();
      if (data.partner) openPartner(data.partner as InstallatiePartner);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setDetailSaving(false);
    }
  }

  async function saveWarmtefonds() {
    if (!selectedWf || !wfDraft) return;
    setDetailSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/warmtefonds-operators", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedWf.id,
          naam: (wfDraft.naam || "").trim(),
          email: wfDraft.email?.toString().trim().toLowerCase() || null,
          telefoon: wfDraft.telefoon?.toString().trim() || null,
          actief: wfDraft.actief !== false,
          tarief_inc:
            wfDraft.tarief_inc === null ||
            wfDraft.tarief_inc === undefined ||
            wfDraft.tarief_inc === ("" as unknown)
              ? null
              : Number(wfDraft.tarief_inc),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bijwerken mislukt");
      setOkMsg("Opgeslagen.");
      await load();
      if (data.operator) openWarmtefonds(data.operator as WarmtefondsOperator);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setDetailSaving(false);
    }
  }

  async function sendWfInvite(o: WarmtefondsOperator) {
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/warmtefonds-operators", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: o.id, send_invite: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Uitnodiging mislukt");
      const op = (data.operator as WarmtefondsOperator) || o;
      setOkMsg(
        data.mail_sent
          ? `Nieuw wachtwoord gemaild naar ${op.email}.`
          : `Wachtwoord gezet, mail mislukt${
              data.mail_error ? `: ${data.mail_error}` : ""
            }.`
      );
      await load();
      if (data.operator) openWarmtefonds(data.operator as WarmtefondsOperator);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    }
  }

  async function resendInvite(a: Adviseur) {
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/adviseurs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id, resend_invite: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Uitnodiging mislukt");
      setOkMsg(
        data.mail_sent
          ? `Nieuw wachtwoord gemaild naar ${a.email}.`
          : `Wachtwoord gezet, mail mislukt${data.mail_error ? `: ${data.mail_error}` : ""}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    }
  }

  async function loginAls(a: Adviseur) {
    setError(null);
    setOkMsg(null);
    if (!a.email?.trim()) {
      setError("Gebruiker heeft geen e-mailadres.");
      return;
    }
    setLoginAlsId(a.id);
    try {
      const res = await fetch("/api/auth/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adviseur_id: a.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Inloggen als mislukt"
        );
      }
      clearCrmShellCache();
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
      setLoginAlsId(null);
    }
  }

  async function savePassword(a: Adviseur) {
    setError(null);
    setOkMsg(null);
    if (newPassword.trim().length < 8) {
      setError("Wachtwoord moet minstens 8 tekens zijn");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Wachtwoorden komen niet overeen");
      return;
    }
    setPasswordSaving(true);
    try {
      const res = await fetch("/api/adviseurs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id, password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Wachtwoord bijwerken mislukt");
      setOkMsg(`Wachtwoord van ${a.naam} is gewijzigd.`);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setPasswordSaving(false);
    }
  }

  function installatiePortalUrl(p: InstallatiePartner): string | null {
    const token = p.portal_token?.trim();
    if (!token) return null;
    return `${portalBase()}/installatie/${encodeURIComponent(token)}`;
  }

  function copyPortalLink(p: InstallatiePartner) {
    const url = installatiePortalUrl(p);
    if (!url) {
      setError("Geen portaallink voor deze partner.");
      return;
    }
    void navigator.clipboard.writeText(url).then(
      () => setOkMsg(`Portaallink gekopieerd voor ${p.naam}.`),
      () => setError("Kopiëren mislukt")
    );
  }

  function openInstallatiePortal(p: InstallatiePartner) {
    const url = installatiePortalUrl(p);
    if (!url) {
      setError("Geen portaallink voor deze partner.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function disconnectGoogle(partnerId: string) {
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie-partners/${partnerId}/google/disconnect`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ontkoppelen mislukt");
      setOkMsg("Google Calendar ontkoppeld.");
      await load();
      setPartnerDraft((d) =>
        d
          ? {
              ...d,
              google_connected_email: null,
              google_connected_at: null,
            }
          : d
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    }
  }

  function wfLoginUrl(): string {
    return `${portalBase()}/warmtefonds/login`;
  }

  function wfPortalUrl(o: WarmtefondsOperator): string {
    return `${portalBase()}/warmtefonds/${o.portal_token}`;
  }

  function openWfPortal(o: WarmtefondsOperator) {
    if (o.actief === false) {
      setError("Account is inactief — geen portaaltoegang.");
      return;
    }
    window.open(wfPortalUrl(o), "_blank", "noopener,noreferrer");
  }

  const zoekNorm = zoek.trim().toLowerCase();

  const rows = useMemo(() => {
    if (activeFilter === "medewerkers") {
      return [...adviseurs]
        .filter((a) => !isSpareAdviseur(a))
        .filter((a) => {
          if (teamRolFilter === "all") return true;
          return normalizeRol(a.rol) === teamRolFilter;
        })
        .filter((a) => {
          if (!zoekNorm) return true;
          const naam = a.naam.toLowerCase();
          const email = (a.email || "").toLowerCase();
          const telefoon = (a.telefoon || "").toLowerCase();
          return (
            naam.includes(zoekNorm) ||
            email.includes(zoekNorm) ||
            telefoon.includes(zoekNorm)
          );
        })
        .sort((a, b) => {
          if (a.actief !== b.actief) return a.actief ? -1 : 1;
          return a.naam.localeCompare(b.naam, "nl");
        });
    }
    if (activeFilter === "warmtefonds") {
      return [...wfOperators]
        .filter((o) => {
          if (!zoekNorm) return true;
          return (
            o.naam.toLowerCase().includes(zoekNorm) ||
            (o.email || "").toLowerCase().includes(zoekNorm) ||
            (o.telefoon || "").toLowerCase().includes(zoekNorm)
          );
        })
        .sort((a, b) => {
          if (a.actief !== b.actief) return a.actief ? -1 : 1;
          return a.naam.localeCompare(b.naam, "nl");
        });
    }
    return [...partners]
      .filter((p) => {
        if (!zoekNorm) return true;
        return (
          p.naam.toLowerCase().includes(zoekNorm) ||
          (p.email || "").toLowerCase().includes(zoekNorm) ||
          (p.telefoon || "").toLowerCase().includes(zoekNorm) ||
          (p.kvk_nummer || "").toLowerCase().includes(zoekNorm)
        );
      })
      .sort((a, b) => {
        if (a.actief !== b.actief) return a.actief ? -1 : 1;
        return a.naam.localeCompare(b.naam, "nl");
      });
  }, [activeFilter, teamRolFilter, adviseurs, partners, wfOperators, zoekNorm]);

  const teamAdviseurs = useMemo(
    () => adviseurs.filter((a) => !isSpareAdviseur(a)),
    [adviseurs]
  );

  const teamRolCounts = useMemo(() => {
    const counts: Record<TeamRol, number> = {
      admin: 0,
      sales_manager: 0,
      adviseur: 0,
      beller: 0,
      backoffice: 0,
      warmtefonds: 0,
      recruiter: 0,
    };
    for (const a of teamAdviseurs) {
      const r = normalizeRol(a.rol);
      if (r in counts) counts[r as TeamRol] += 1;
    }
    return counts;
  }, [teamAdviseurs]);

  const medewerkersInRol =
    teamRolFilter === "all"
      ? teamAdviseurs.length
      : teamAdviseurs.filter((a) => normalizeRol(a.rol) === teamRolFilter)
          .length;

  const countLabel =
    activeFilter === "medewerkers"
      ? zoekNorm
        ? `${rows.length} van ${medewerkersInRol}`
        : teamRolFilter === "all"
          ? `${teamAdviseurs.length} medewerker${teamAdviseurs.length === 1 ? "" : "s"}`
          : `${rows.length}× ${gebruikerRolLabel[teamRolFilter]}`
      : activeFilter === "warmtefonds"
        ? `${wfOperators.length} Warmtefondspartner${wfOperators.length === 1 ? "" : "s"}`
        : `${partners.length} ${
            partners.length === 1
              ? partnerWoord.toLowerCase()
              : partnerWoordMeervoud
          }`;

  // ── Detail view ──────────────────────────────────────────────────────────
  if (selectedAdviseur && draft) {
    const rol = normalizeRol(draft.rol) as TeamRol;
    const sales = isSalesRol(draft.rol);
    const toonFactuurgegevens = needsFactuurgegevens({
      rol: draft.rol,
      id: selectedAdviseur.id,
      naam: draft.naam ?? selectedAdviseur.naam,
      email: draft.email ?? selectedAdviseur.email,
    });
    const actief = draft.actief !== false;
    const geblokkeerd = draft.geblokkeerd === true;
    const opsCommissieLabel = opsCommissieLabelVoorRol({
      rol: draft.rol,
      isOpsManager: isOpsManagerAdviseur({
        id: draft.id || selectedAdviseur.id,
        naam: draft.naam ?? selectedAdviseur.naam,
        email: draft.email ?? selectedAdviseur.email,
        rol: draft.rol ?? selectedAdviseur.rol,
      }),
    });

    const blokkeerLabel = geblokkeerd
      ? "Deblokkeer"
      : rol === "adviseur"
        ? "Blokkeer adviseur"
        : "Blokkeer";
    const uniteWebhook = `${(
      typeof process !== "undefined" && process.env.NEXT_PUBLIC_APP_URL
        ? process.env.NEXT_PUBLIC_APP_URL
        : "https://batterijconcept-platform.vercel.app"
    ).replace(/\/$/, "")}/api/unite/webhook?callid={calluniqueid}&callfrom={callfrom}&callto={callto}&status={status}&status_desc={status_desc}&direction={direction}&timestamp={timestamp}`;

    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="border-b border-line px-4 py-2.5 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button
                type="button"
                onClick={closeDetail}
                className="text-xs font-semibold text-green hover:underline"
              >
                ← Overzicht
              </button>
              <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />
              <label
                className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden bg-green-soft"
                title="Klik om profielfoto te wijzigen"
              >
                {adviseurProfielfotoPublicUrl(
                  draft.profielfoto_path ?? selectedAdviseur.profielfoto_path
                ) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={
                      adviseurProfielfotoPublicUrl(
                        draft.profielfoto_path ??
                          selectedAdviseur.profielfoto_path
                      )!
                    }
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span
                    className="flex h-full w-full items-center justify-center text-[11px] font-bold tracking-wide text-green-dark"
                    aria-hidden
                  >
                    {naamInitialen(draft.naam || selectedAdviseur.naam) || "?"}
                  </span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file || !selectedAdviseur) return;
                    void (async () => {
                      setError(null);
                      try {
                        const fd = new FormData();
                        fd.append("foto", file);
                        const res = await fetch(
                          `/api/adviseurs/${selectedAdviseur.id}/profielfoto`,
                          { method: "POST", body: fd }
                        );
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok)
                          throw new Error(data.error || "Upload mislukt");
                        const path =
                          (data.path as string | undefined) ||
                          selectedAdviseur.profielfoto_path;
                        setDraft((d) =>
                          d ? { ...d, profielfoto_path: path || null } : d
                        );
                        setAdviseurs((list) =>
                          list.map((a) =>
                            a.id === selectedAdviseur.id
                              ? { ...a, profielfoto_path: path || null }
                              : a
                          )
                        );
                        setOkMsg("Profielfoto bijgewerkt.");
                      } catch (err) {
                        setError(
                          err instanceof Error
                            ? err.message
                            : "Foto uploaden mislukt"
                        );
                      }
                    })();
                  }}
                />
              </label>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate font-display text-lg font-semibold text-ink">
                    {draft.naam || selectedAdviseur.naam}
                  </h2>
                  <span
                    className={[
                      "inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      ROL_BADGE[rol] || ROL_BADGE.adviseur,
                    ].join(" ")}
                  >
                    {gebruikerRolLabel[rol]}
                  </span>
                  {geblokkeerd ? (
                    <span className="inline-block bg-[#FDECEA] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#C62828]">
                      Geblokkeerd
                    </span>
                  ) : null}
                </div>
                {(sales || opsCommissieLabel) && (
                  <p className="mt-0.5 truncate text-[12px] text-muted">
                    {sales
                      ? `Commissie ${Number(draft.commissie_pct) || 0}%`
                      : opsCommissieLabel}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <div className="flex border border-line p-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        actief: true,
                        geblokkeerd: false,
                      }))
                    }
                    className={[
                      "px-3 py-1 text-xs font-semibold",
                      actief && !geblokkeerd
                        ? "bg-green text-white"
                        : "bg-white text-muted hover:bg-wash",
                    ].join(" ")}
                  >
                    Actief
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        actief: false,
                        geblokkeerd: false,
                      }))
                    }
                    className={[
                      "px-3 py-1 text-xs font-semibold",
                      !actief && !geblokkeerd
                        ? "bg-[#C45A12] text-white"
                        : "bg-white text-muted hover:bg-wash",
                    ].join(" ")}
                  >
                    Inactief
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDraft((d) =>
                      geblokkeerd
                        ? { ...d, geblokkeerd: false }
                        : { ...d, geblokkeerd: true, actief: false }
                    )
                  }
                  className={[
                    "border px-2.5 py-1 text-xs font-semibold",
                    geblokkeerd
                      ? "border-[#C62828] bg-[#C62828] text-white"
                      : "border-[#C62828]/40 bg-white text-[#C62828] hover:bg-[#FDECEA]",
                  ].join(" ")}
                >
                  {blokkeerLabel}
                </button>
              </div>
            </div>
          </div>

          {(error || okMsg) && (
            <div className="space-y-2 border-b border-line px-4 py-2 sm:px-5">
              {error ? (
                <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                  {error}
                </p>
              ) : null}
              {okMsg ? (
                <p className="border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
                  {okMsg}
                </p>
              ) : null}
            </div>
          )}

          <div className="divide-y divide-line">
            {/* Contact */}
            <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4 sm:px-5">
              <Field label="Naam">
                <input
                  value={draft.naam || ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, naam: e.target.value }))
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="E-mail">
                <input
                  type="email"
                  value={draft.email || ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, email: e.target.value }))
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Telefoon">
                <input
                  value={draft.telefoon || ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, telefoon: e.target.value }))
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Rol">
                <select
                  value={normalizeRol(draft.rol)}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      rol: normalizeRol(e.target.value),
                    }))
                  }
                  className={inputCls}
                >
                  {TEAM_ROLLEN.map((r) => (
                    <option key={r} value={r}>
                      {gebruikerRolLabel[r]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Unite + startadres */}
            <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3 sm:px-5">
              <Field label="Unite-lijn (DID)">
                <input
                  value={(draft.unite_lijn as string) || ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, unite_lijn: e.target.value }))
                  }
                  placeholder="085 800 1645"
                  className={inputCls}
                />
              </Field>
              <Field label="Unite-extensie">
                <input
                  value={(draft.unite_ext as string) || ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, unite_ext: e.target.value }))
                  }
                  placeholder="0200"
                  className={inputCls}
                />
              </Field>
              <div className="sm:col-span-2 lg:col-span-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Startadres
                </p>
                <div className="mt-1">
                  <StartAdresPostcodeField
                    value={draft.start_adres || ""}
                    onChange={(next) =>
                      setDraft((d) => ({ ...d, start_adres: next }))
                    }
                    inputClassName={inputCls.replace(/^mt-1 /, "")}
                  />
                </div>
                <label className="mt-2 flex items-start gap-2 text-[12px] text-ink">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 rounded border-line"
                    checked={draft.start_vanaf_huis_maandag === true}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        start_vanaf_huis_maandag: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    <span className="font-medium">Altijd vanaf huisadres</span>
                    <span className="block text-[11px] text-muted">
                      Ook op maandag vanaf dit startadres (niet vanaf Daltonlaan);
                      maandag 10:00 is dan open.
                    </span>
                  </span>
                </label>
              </div>
              <details className="sm:col-span-2 lg:col-span-3">
                <summary className="cursor-pointer text-[12px] font-semibold text-muted hover:text-ink">
                  Unite-webhook (technisch)
                </summary>
                <p className="mt-1.5 text-[11px] text-muted">
                  Lijn = inkomend (popups) · Extensie = softphone uitgaand. Plak
                  de URL in Unite → Provisioning → App templates (Maatwerk CRM).
                </p>
                <p className="mt-1.5 break-all border border-line bg-wash px-2.5 py-2 font-mono text-[10px] text-ink">
                  {uniteWebhook}
                </p>
              </details>
            </div>

            {/* Toegang — horizontale rij */}
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-end sm:gap-4 sm:px-5">
              <div className="w-28 shrink-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Toegang
                </p>
                <p className="text-[11px] text-muted">Login & wachtwoord</p>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
                {selectedAdviseur.email ? (
                  <button
                    type="button"
                    onClick={() => void resendInvite(selectedAdviseur)}
                    className="h-9 border border-line bg-white px-3 text-[12px] font-semibold hover:bg-wash"
                  >
                    Stuur loginmail
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={
                    loginAlsId === selectedAdviseur.id ||
                    !selectedAdviseur.email
                  }
                  onClick={() => void loginAls(selectedAdviseur)}
                  className="h-9 bg-green px-3 text-[12px] font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                  title={
                    !selectedAdviseur.email
                      ? "Geen e-mailadres"
                      : "Bekijk CRM als deze gebruiker"
                  }
                >
                  {loginAlsId === selectedAdviseur.id ? "Bezig…" : "Login als"}
                </button>
                <label className="min-w-[8rem] flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Nieuw wachtwoord
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min. 8 tekens"
                    className={inputCls}
                  />
                </label>
                <label className="min-w-[8rem] flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Bevestig
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className={inputCls}
                    />
                    <button
                      type="button"
                      disabled={passwordSaving}
                      onClick={() => void savePassword(selectedAdviseur)}
                      className="mt-1 h-9 shrink-0 border border-line bg-white px-3 text-xs font-semibold hover:bg-wash disabled:opacity-60"
                    >
                      {passwordSaving ? "…" : "Zet"}
                    </button>
                  </div>
                </label>
              </div>
            </div>

            {/* Notities */}
            <div className="px-4 py-3 sm:px-5">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Notities
              </p>
              <TeamNotitiesSection
                value={draft.interne_notities}
                authorNaam={session?.naam}
                disabled={detailSaving || deleting}
                onSave={saveMedewerkerNotities}
              />
            </div>

            {sales ? (
              <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 sm:px-5">
                <Field label="Startdatum">
                  <input
                    type="date"
                    value={
                      draft.startdatum
                        ? String(draft.startdatum).slice(0, 10)
                        : ""
                    }
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        startdatum: e.target.value || null,
                      }))
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Commissie (%)">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={draft.commissie_pct ?? 10}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        commissie_pct: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className={inputCls}
                  />
                </Field>
              </div>
            ) : null}

            {toonFactuurgegevens ? (
              <div className="space-y-3 px-4 py-3 sm:px-5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Factuurgegevens
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Bedrijfsnaam" className="sm:col-span-2">
                    <input
                      value={draft.bedrijfsnaam || ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          bedrijfsnaam: e.target.value,
                        }))
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label="KvK">
                    <input
                      value={draft.kvk_nummer || ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          kvk_nummer: e.target.value,
                        }))
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Btw-nummer">
                    <input
                      value={draft.btw_nummer || ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          btw_nummer: e.target.value,
                        }))
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Adres" className="sm:col-span-2">
                    <input
                      value={draft.factuur_adres || ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          factuur_adres: e.target.value,
                        }))
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Postcode">
                    <input
                      value={draft.factuur_postcode || ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          factuur_postcode: e.target.value,
                        }))
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Plaats">
                    <input
                      value={draft.factuur_plaats || ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          factuur_plaats: e.target.value,
                        }))
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label="IBAN">
                    <input
                      id="relatie-iban-adviseur"
                      value={draft.iban || ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, iban: e.target.value }))
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Max. factuur (€)">
                    <input
                      type="number"
                      min={0}
                      step={50}
                      value={draft.max_factuur_bedrag ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          max_factuur_bedrag:
                            e.target.value === ""
                              ? null
                              : parseFloat(e.target.value) || 0,
                        }))
                      }
                      placeholder="Geen limiet"
                      className={inputCls}
                    />
                  </Field>
                </div>
                <TeamRelatieOnboarding
                  kind="adviseur"
                  id={selectedAdviseur.id}
                  naam={draft.naam || selectedAdviseur.naam}
                  fields={draft}
                  onFieldsPatch={(patch) =>
                    setDraft((d) =>
                      d ? ({ ...d, ...patch } as Partial<Adviseur>) : d
                    )
                  }
                  onMessage={(msg, isError) => {
                    if (isError) setError(msg);
                    else {
                      setError(null);
                      setOkMsg(msg);
                    }
                  }}
                  onFocusIban={() => {
                    document
                      .getElementById("relatie-iban-adviseur")
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                    (
                      document.getElementById(
                        "relatie-iban-adviseur"
                      ) as HTMLInputElement | null
                    )?.focus();
                  }}
                  onOpenContract={() => {
                    document
                      .getElementById("relatie-contract-adviseur")
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                />
              </div>
            ) : null}

            {rol === "adviseur" ? (
              <div className="px-4 py-3 sm:px-5">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Producten
                </p>
                <AdviseurProductenSection
                  adviseurId={selectedAdviseur.id}
                  adviseurNaam={draft.naam || selectedAdviseur.naam}
                />
              </div>
            ) : null}

            <div className="px-4 py-3 sm:px-5" id="relatie-contract-adviseur">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Contract
              </p>
              <RelatieContractUpload
                kind="adviseur"
                id={selectedAdviseur.id}
                bestandsnaam={
                  draft.contract_bestandsnaam ||
                  selectedAdviseur.contract_bestandsnaam
                }
                uploadedAt={
                  draft.contract_uploaded_at ||
                  selectedAdviseur.contract_uploaded_at
                }
                onUploaded={(meta) => {
                  setDraft((d) => ({ ...d, ...meta }));
                  void load();
                }}
                onMessage={(msg, isError) => {
                  if (isError) setError(msg);
                  else {
                    setError(null);
                    setOkMsg(msg);
                  }
                }}
              />
            </div>

            {rol === "beller" ? (
              <div className="px-4 py-3 sm:px-5">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Belcommissie
                </p>
                <BellerCommissieWeeks
                  bellerId={selectedAdviseur.id}
                  bellerNaam={draft.naam || selectedAdviseur.naam}
                />
              </div>
            ) : null}

            {isOpsManagerAdviseur({
              id: selectedAdviseur.id,
              naam: draft.naam || selectedAdviseur.naam,
              email: draft.email || selectedAdviseur.email,
              rol,
            }) ? (
              <div className="px-4 py-3 sm:px-5">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Opscommissie
                </p>
                <OpsManagerCommissieWeeks
                  opsManagerId={selectedAdviseur.id}
                  opsManagerNaam={draft.naam || selectedAdviseur.naam}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 border-t border-line bg-white px-4 py-2.5 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={deleting || detailSaving}
              onClick={() => void deleteMedewerker(selectedAdviseur)}
              className="border border-[#C45A12]/40 bg-[#FFF0E6] px-3 py-2 text-xs font-semibold text-[#C45A12] hover:bg-[#ffe4d4] disabled:opacity-60"
            >
              {deleting ? "Verwijderen…" : "Verwijderen"}
            </button>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs text-muted">
                Pas actief na <strong className="text-ink">Opslaan</strong>
              </p>
              <button
                type="button"
                disabled={detailSaving || deleting}
                onClick={() => void saveMedewerker()}
                className="bg-green px-5 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
              >
                {detailSaving ? "Opslaan…" : "Opslaan"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (selectedPartner && partnerDraft) {
    return (
      <div className="flex h-full min-h-0 flex-col border border-line bg-white">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={closeDetail}
            className="text-xs font-semibold text-green hover:underline"
          >
            ← Terug naar overzicht
          </button>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold text-ink">
                {selectedPartner.naam}
              </h2>
              <p className="mt-0.5 text-sm text-muted">{partnerWoord}</p>
            </div>
            <span
              className={
                partnerDraft.actief !== false
                  ? "text-[11px] font-semibold uppercase tracking-wide text-green-dark"
                  : "text-[11px] font-semibold uppercase tracking-wide text-[#C45A12]"
              }
            >
              {partnerDraft.actief !== false ? "Actief" : "Inactief"}
            </span>
          </div>
        </div>

        {(error || okMsg) && (
          <div className="space-y-2 border-b border-line px-4 py-3 sm:px-5">
            {error && (
              <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                {error}
              </p>
            )}
            {okMsg && (
              <p className="border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
                {okMsg}
              </p>
            )}
          </div>
        )}

        <div className="space-y-5 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Naam">
              <input
                value={partnerDraft.naam || ""}
                onChange={(e) =>
                  setPartnerDraft((d) => ({ ...d, naam: e.target.value }))
                }
                className={inputCls}
              />
            </Field>
            <Field label="E-mail">
              <input
                type="email"
                value={partnerDraft.email || ""}
                onChange={(e) =>
                  setPartnerDraft((d) => ({ ...d, email: e.target.value }))
                }
                className={inputCls}
              />
            </Field>
            <Field label="Telefoon">
              <input
                value={partnerDraft.telefoon || ""}
                onChange={(e) =>
                  setPartnerDraft((d) => ({ ...d, telefoon: e.target.value }))
                }
                className={inputCls}
              />
            </Field>
            <div className="sm:col-span-2">
              <FormSection
                title="Startadres & agenda"
                hint="Vertrekpunt voor reistijd bij schouw/installatie · ochtend 09–12 / middag 13–17"
              >
                <div className="sm:col-span-2">
                  <StartAdresPostcodeField
                    value={partnerDraft.start_adres || ""}
                    onChange={(next) =>
                      setPartnerDraft((d) => ({ ...d, start_adres: next }))
                    }
                    inputClassName={inputCls}
                  />
                  <p className="mt-1 text-[11px] text-muted">
                    Leeg = Cabrondom 43, Utrecht (fallback voor reistijd).
                  </p>
                </div>
                <Field label="Reistijd-buffer (min)">
                  <input
                    type="number"
                    min={0}
                    max={180}
                    value={
                      partnerDraft.reistijd_buffer_min != null
                        ? String(partnerDraft.reistijd_buffer_min)
                        : "30"
                    }
                    onChange={(e) =>
                      setPartnerDraft((d) => ({
                        ...d,
                        reistijd_buffer_min: Number(e.target.value) || 0,
                      }))
                    }
                    className={inputCls}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <a
                    href={`/?tab=agenda&partner_agenda=${encodeURIComponent(selectedPartner.id)}`}
                    className="text-sm font-medium text-green-dark underline-offset-2 hover:underline"
                  >
                    Partner-agenda openen (afblokken)
                  </a>
                </div>
              </FormSection>
            </div>
            <div className="sm:col-span-2 border border-line bg-wash/40 px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Status
              </p>
              <div className="mt-2 flex border border-line p-0.5">
                <button
                  type="button"
                  onClick={() =>
                    setPartnerDraft((d) => ({ ...d, actief: true }))
                  }
                  className={[
                    "flex-1 px-3 py-2 text-sm font-semibold",
                    partnerDraft.actief !== false
                      ? "bg-green text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  Actief
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setPartnerDraft((d) => ({ ...d, actief: false }))
                  }
                  className={[
                    "flex-1 px-3 py-2 text-sm font-semibold",
                    partnerDraft.actief === false
                      ? "bg-[#C45A12] text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  Inactief
                </button>
              </div>
            </div>
          </div>

          <TeamRelatieOnboarding
            kind="partner"
            id={selectedPartner.id}
            naam={partnerDraft.naam || selectedPartner.naam}
            fields={partnerDraft}
            onFieldsPatch={(patch) =>
              setPartnerDraft((d) =>
                d ? ({ ...d, ...patch } as Partial<InstallatiePartner>) : d
              )
            }
            onMessage={(msg, isError) => {
              if (isError) setError(msg);
              else {
                setError(null);
                setOkMsg(msg);
              }
            }}
            onFocusIban={() => {
              document
                .getElementById("relatie-iban-partner")
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
              (
                document.getElementById(
                  "relatie-iban-partner"
                ) as HTMLInputElement | null
              )?.focus();
            }}
            onOpenContract={() => {
              document
                .getElementById("relatie-contract-partner")
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          />

          <div className="border border-line p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Bedrijfs- / KvK-gegevens
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Bedrijfsnaam" className="sm:col-span-2">
                <input
                  value={partnerDraft.bedrijfsnaam || ""}
                  onChange={(e) =>
                    setPartnerDraft((d) => ({
                      ...d,
                      bedrijfsnaam: e.target.value,
                    }))
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="KvK">
                <input
                  value={partnerDraft.kvk_nummer || ""}
                  onChange={(e) =>
                    setPartnerDraft((d) => ({
                      ...d,
                      kvk_nummer: e.target.value,
                    }))
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Btw-nummer">
                <input
                  value={partnerDraft.btw_nummer || ""}
                  onChange={(e) =>
                    setPartnerDraft((d) => ({
                      ...d,
                      btw_nummer: e.target.value,
                    }))
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Adres" className="sm:col-span-2">
                <input
                  value={partnerDraft.factuur_adres || ""}
                  onChange={(e) =>
                    setPartnerDraft((d) => ({
                      ...d,
                      factuur_adres: e.target.value,
                    }))
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Postcode">
                <input
                  value={partnerDraft.factuur_postcode || ""}
                  onChange={(e) =>
                    setPartnerDraft((d) => ({
                      ...d,
                      factuur_postcode: e.target.value,
                    }))
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Plaats">
                <input
                  value={partnerDraft.factuur_plaats || ""}
                  onChange={(e) =>
                    setPartnerDraft((d) => ({
                      ...d,
                      factuur_plaats: e.target.value,
                    }))
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="IBAN">
                <input
                  id="relatie-iban-partner"
                  value={partnerDraft.iban || ""}
                  onChange={(e) =>
                    setPartnerDraft((d) => ({ ...d, iban: e.target.value }))
                  }
                  className={inputCls}
                />
              </Field>
            </div>
          </div>

          <div id="relatie-contract-partner">
            <RelatieContractUpload
              kind="partner"
              id={selectedPartner.id}
              bestandsnaam={
                partnerDraft.contract_bestandsnaam ||
                selectedPartner.contract_bestandsnaam
              }
              uploadedAt={
                partnerDraft.contract_uploaded_at ||
                selectedPartner.contract_uploaded_at
              }
              onUploaded={(meta) => {
                setPartnerDraft((d) => ({ ...d, ...meta }));
                void load();
              }}
              onMessage={(msg, isError) => {
                if (isError) setError(msg);
                else {
                  setError(null);
                  setOkMsg(msg);
                }
              }}
            />
          </div>

          <PartnerMonteursCrmPanel
            partnerId={selectedPartner.id}
            partnerNaam={partnerDraft.naam || selectedPartner.naam}
          />

          <TeamNotitiesSection
            value={partnerDraft.interne_notities}
            authorNaam={session?.naam}
            disabled={detailSaving || deleting}
            onSave={savePartnerNotities}
          />

          {selectedPartner.portal_token ? (
            <div className="border border-line p-4">
              <PartnerTeamgenotenPanel
                portalToken={selectedPartner.portal_token}
                compact
                adminBeoordeling
                authorNaam={session?.naam || null}
                initialTeamgenootId={focusTeamgenootId}
              />
            </div>
          ) : null}

          <div className="border border-line bg-wash px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Google Calendar
            </p>
            {selectedPartner.google_connected_email ? (
              <p className="mt-1 text-sm text-ink">
                Gekoppeld:{" "}
                <span className="font-medium">
                  {selectedPartner.google_connected_email}
                </span>
                . Schouw, installatie en service gaan direct naar deze agenda.
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted">
                Nog niet gekoppeld. Laat de installatiepartner (of jij met hun
                Google-account) één keer inloggen — daarna synct elke planning
                direct.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={`/api/installatie-partners/${selectedPartner.id}/google/connect`}
                className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark"
              >
                {selectedPartner.google_connected_email
                  ? "Opnieuw koppelen"
                  : "Koppel Google Calendar"}
              </a>
              {selectedPartner.google_connected_email && (
                <button
                  type="button"
                  onClick={() => void disconnectGoogle(selectedPartner.id)}
                  className="border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-wash"
                >
                  Ontkoppelen
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openInstallatiePortal(selectedPartner)}
              className="border border-green/40 bg-green-soft px-4 py-2 text-sm font-semibold text-green-dark hover:bg-green hover:text-white"
            >
              Open portaal
            </button>
            <button
              type="button"
              onClick={() => copyPortalLink(selectedPartner)}
              className="border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-wash"
            >
              Kopieer portaallink
            </button>
          </div>
        </div>
        </div>

        <div className="shrink-0 border-t border-line bg-white px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              Wijzigingen worden pas bewaard als je{" "}
              <strong className="text-ink">Opslaan</strong> klikt.
            </p>
            <button
              type="button"
              disabled={detailSaving}
              onClick={() => void savePartner()}
              className="bg-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
            >
              {detailSaving ? "Opslaan…" : "Opslaan"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (selectedWf && wfDraft) {
    const liveToken = wfDraft.portal_token || selectedWf.portal_token;
    const liveOp: WarmtefondsOperator = {
      ...selectedWf,
      portal_token: liveToken,
      naam: wfDraft.naam || selectedWf.naam,
      email: (wfDraft.email as string) || selectedWf.email,
      telefoon: (wfDraft.telefoon as string | null) ?? selectedWf.telefoon,
      actief: wfDraft.actief !== false,
    };
    const wfActief = wfDraft.actief !== false;
    const wfTarief =
      wfDraft.tarief_inc != null &&
      Number.isFinite(Number(wfDraft.tarief_inc)) &&
      Number(wfDraft.tarief_inc) > 0
        ? Number(wfDraft.tarief_inc)
        : null;

    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="border-b border-line px-4 py-2.5 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button
                type="button"
                onClick={closeDetail}
                className="text-xs font-semibold text-green hover:underline"
              >
                ← Overzicht
              </button>
              <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center bg-green-soft text-[11px] font-bold tracking-wide text-green-dark"
                aria-hidden
              >
                {naamInitialen(liveOp.naam) || "WF"}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-lg font-semibold text-ink">
                  {liveOp.naam}
                </h2>
              </div>
              <div className="flex shrink-0 border border-line p-0.5">
                <button
                  type="button"
                  onClick={() => setWfDraft((d) => ({ ...d, actief: true }))}
                  className={[
                    "px-3 py-1 text-xs font-semibold",
                    wfActief
                      ? "bg-green text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  Actief
                </button>
                <button
                  type="button"
                  onClick={() => setWfDraft((d) => ({ ...d, actief: false }))}
                  className={[
                    "px-3 py-1 text-xs font-semibold",
                    !wfActief
                      ? "bg-[#C45A12] text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  Inactief
                </button>
              </div>
            </div>
            {!wfActief ? (
              <p className="mt-1.5 text-[11px] text-[#C45A12]">
                Inactief = geen portaaltoegang. Opslaan om door te voeren.
              </p>
            ) : null}
          </div>

          {(error || okMsg) && (
            <div className="space-y-2 border-b border-line px-4 py-2 sm:px-5">
              {error ? (
                <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                  {error}
                </p>
              ) : null}
              {okMsg ? (
                <p className="border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
                  {okMsg}
                </p>
              ) : null}
            </div>
          )}

          <div className="divide-y divide-line">
            {/* Contact — 3 kolommen */}
            <div className="grid gap-3 px-4 py-3 sm:grid-cols-3 sm:px-5">
              <Field label="Naam">
                <input
                  value={wfDraft.naam || ""}
                  onChange={(e) =>
                    setWfDraft((d) => ({ ...d, naam: e.target.value }))
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="E-mail">
                <input
                  type="email"
                  value={wfDraft.email || ""}
                  onChange={(e) =>
                    setWfDraft((d) => ({ ...d, email: e.target.value }))
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Telefoon">
                <input
                  value={wfDraft.telefoon || ""}
                  onChange={(e) =>
                    setWfDraft((d) => ({ ...d, telefoon: e.target.value }))
                  }
                  className={inputCls}
                />
              </Field>
            </div>

            {/* Vergoeding — horizontale rij */}
            <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
              <div className="w-36 shrink-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Vergoeding
                </p>
                <p className="text-[11px] text-muted">Per WF-aanvraag excl. btw</p>
              </div>
              <WfPartnerTariefVeld
                value={wfTarief}
                onChange={(next) =>
                  setWfDraft((d) => ({ ...d, tarief_inc: next }))
                }
                standaardExcl={EDERGY_PER_AANVRAAG_EXCL}
              />
            </div>

            {/* Inloggen — horizontale acties */}
            <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
              <div className="w-36 shrink-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Inloggen
                </p>
                <p className="text-[11px] text-muted">E-mail + wachtwoord</p>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void sendWfInvite(selectedWf)}
                  className="h-9 bg-green px-3 text-[13px] font-semibold text-white hover:bg-green-dark"
                >
                  Stuur inloggegevens
                </button>
                <button
                  type="button"
                  disabled={!wfActief}
                  onClick={() => openWfPortal(liveOp)}
                  className="h-9 border border-line bg-white px-3 text-[12px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
                >
                  Open portaal
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard.writeText(wfLoginUrl()).then(
                      () => setOkMsg("Login-URL gekopieerd."),
                      () => setError("Kopiëren mislukt")
                    )
                  }
                  className="h-9 border border-line bg-white px-3 text-[12px] font-semibold text-muted hover:bg-wash hover:text-ink"
                >
                  Kopieer URL
                </button>
                <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
                  {wfLoginUrl()}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-line bg-white px-4 py-2.5 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              Pas actief na <strong className="text-ink">Opslaan</strong>
            </p>
            <button
              type="button"
              disabled={detailSaving}
              onClick={() => void saveWarmtefonds()}
              className="bg-green px-5 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
            >
              {detailSaving ? "Opslaan…" : "Opslaan"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
  const showListTabs = !teamOnly && !hideListTabs;
  const embedded = hideListTabs;

  return (
    <div
      className={
        embedded
          ? "flex h-full min-h-0 flex-col bg-white"
          : "border border-line bg-white"
      }
    >
      <div
        className={
          embedded
            ? "flex shrink-0 flex-col gap-2 border-b border-line px-3 py-2.5 sm:flex-row sm:items-center sm:px-4"
            : "space-y-3 border-b border-line px-4 py-3 sm:px-5"
        }
      >
        <div
          className={
            embedded
              ? "flex w-full min-w-0 flex-1 flex-wrap items-center gap-2"
              : "flex flex-wrap items-center justify-between gap-3"
          }
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {showListTabs ? (
              <div className="flex border border-line p-0.5">
                <button
                  type="button"
                  onClick={() => setFilter("medewerkers")}
                  className={[
                    "px-3 py-1.5 text-xs font-semibold",
                    activeFilter === "medewerkers"
                      ? "bg-green text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  Mensen
                </button>
                <button
                  type="button"
                  onClick={() => setFilter("partners")}
                  className={[
                    "px-3 py-1.5 text-xs font-semibold",
                    activeFilter === "partners"
                      ? "bg-green text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  Installatie partners
                </button>
                <button
                  type="button"
                  onClick={() => setFilter("warmtefonds")}
                  className={[
                    "px-3 py-1.5 text-xs font-semibold",
                    activeFilter === "warmtefonds"
                      ? "bg-green text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  Warmtefonds
                </button>
              </div>
            ) : null}
            {embedded ? (
              <div className="relative w-full min-w-0 flex-1 sm:max-w-md">
                <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted">
                  ⌕
                </span>
                <input
                  type="search"
                  value={zoek}
                  onChange={(e) => setZoek(e.target.value)}
                  placeholder="Zoek naam, e-mail, telefoon…"
                  className="h-9 w-full rounded-md border border-line bg-white py-2 pr-3 pl-8 text-sm text-ink outline-none placeholder:text-muted/70 focus:border-green"
                  aria-label="Zoeken"
                />
              </div>
            ) : activeFilter === "medewerkers" ? (
              <input
                type="search"
                value={zoek}
                onChange={(e) => setZoek(e.target.value)}
                placeholder={
                  teamRolFilter === "adviseur"
                    ? "Zoek adviseur…"
                    : "Zoek op naam of e-mail…"
                }
                className="w-full min-w-[12rem] border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-muted/70 focus:border-green sm:w-56"
                aria-label={
                  teamRolFilter === "adviseur"
                    ? "Zoek adviseur"
                    : "Zoek medewerker"
                }
              />
            ) : null}
            <p className="text-xs text-muted">{countLabel}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetAddForm(
                teamRolFilter !== "all" ? teamRolFilter : undefined
              );
              setAddOpen(true);
              setError(null);
            }}
            className={
              embedded
                ? "shrink-0 rounded-lg bg-green px-3 py-2 text-sm font-semibold text-white hover:bg-green-dark"
                : "bg-orange px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#e0651c]"
            }
          >
            {activeFilter === "medewerkers"
              ? teamRolFilter !== "all"
                ? `+ ${gebruikerRolLabel[teamRolFilter]}`
                : "+ Nieuw"
              : activeFilter === "warmtefonds"
                ? "+ Warmtefondspartner"
                : `+ ${partnerWoord}`}
          </button>
        </div>

        {activeFilter === "medewerkers" && !hideTeamRolFilter ? (
          <div className="flex flex-wrap border border-line p-0.5">
            <button
              type="button"
              onClick={() => setTeamRolFilter("all")}
              className={[
                "px-2.5 py-1 text-[11px] font-semibold",
                teamRolFilter === "all"
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              Alle
              <span className="ml-1 opacity-70">{adviseurs.length}</span>
            </button>
            {TEAM_ROLLEN.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setTeamRolFilter(r)}
                className={[
                  "px-2.5 py-1 text-[11px] font-semibold",
                  teamRolFilter === r
                    ? "bg-green text-white"
                    : "bg-white text-muted hover:bg-wash",
                ].join(" ")}
                title={teamRolUitleg[r]}
              >
                {gebruikerRolLabel[r]}
                <span className="ml-1 opacity-70">{teamRolCounts[r]}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {(error || okMsg) && (
        <div className="shrink-0 space-y-2 border-b border-line px-3 py-2 sm:px-4">
          {error && (
            <p className="rounded-md border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              {error}
            </p>
          )}
          {okMsg && (
            <p className="rounded-md border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
              {okMsg}
            </p>
          )}
        </div>
      )}

      <div className={embedded ? "min-h-0 flex-1 overflow-auto" : undefined}>
      {loading ? (
        <p className="px-5 py-14 text-center text-sm text-muted">Laden…</p>
      ) : rows.length === 0 && zoekNorm ? (
        <div className="px-5 py-14 text-center">
          <p className="font-display text-base font-semibold text-ink">
            Geen resultaten voor “{zoek.trim()}”
          </p>
          <p className="mt-1 text-sm text-muted">
            Zoek op naam of e-mail
            {teamRolFilter !== "all" && activeFilter === "medewerkers"
              ? ` binnen ${gebruikerRolLabel[teamRolFilter].toLowerCase()}`
              : ""}
            .
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <p className="font-display text-base font-semibold text-ink">
            {activeFilter === "medewerkers"
              ? teamRolFilter === "all"
                ? "Nog geen medewerkers"
                : `Nog geen ${gebruikerRolLabel[teamRolFilter].toLowerCase()}-accounts`
              : activeFilter === "warmtefonds"
                ? "Nog geen Warmtefondspartners"
                : `Nog geen ${partnerWoordMeervoud}`}
          </p>
          <p className="mt-1 text-sm text-muted">
            {activeFilter === "medewerkers"
              ? "Kies een rol (Admin, Adviseur, Beller, Backoffice, Warmtefonds of Recruiter) en voeg een account toe."
              : activeFilter === "warmtefonds"
                ? "Voeg een Warmtefondspartner toe voor portaallink."
                : `Voeg een ${partnerWoord.toLowerCase()} toe voor schouw/installatie en portaallink.`}
          </p>
        </div>
      ) : activeFilter === "medewerkers" ? (
        <table className="crm-table crm-table--compact">
          <thead>
            <tr>
              <th>Naam</th>
              <th>Rol</th>
              <th>Status</th>
              <th>Laatste notitie</th>
              <th>Commissie</th>
            </tr>
          </thead>
          <tbody>
            {(rows as Adviseur[]).map((a) => {
              const sales = isSalesRol(a.rol);
              const rol = normalizeRol(a.rol) as TeamRol;
              const actief = a.actief !== false;
              const commissie =
                a.commissie_pct != null &&
                Number.isFinite(Number(a.commissie_pct))
                  ? Number(a.commissie_pct)
                  : 10;
              const opsCommissieLabel = opsCommissieLabelVoorRol({
                rol: a.rol,
                isOpsManager: isOpsManagerAdviseur(a),
              });
              const notes = parseProjectNotitieEntries(a.interne_notities);
              const lastNote = notes.length
                ? [...notes].sort((x, y) =>
                    y.at.localeCompare(x.at)
                  )[0]
                : null;
              return (
                <tr
                  key={a.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openMedewerker(a)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openMedewerker(a);
                    }
                  }}
                >
                  <td>
                    <div className="flex min-w-0 items-center gap-2.5">
                      {adviseurProfielfotoPublicUrl(a.profielfoto_path) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={adviseurProfielfotoPublicUrl(a.profielfoto_path)!}
                          alt=""
                          className="size-8 shrink-0 object-cover"
                        />
                      ) : (
                        <Avatar size="sm" className="size-8">
                          <AvatarFallback className="text-[11px]">
                            {naamInitialen(a.naam) || "?"}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div className="min-w-0">
                        <span className="block truncate font-medium text-ink">
                          {a.naam}
                        </span>
                        <span className="block truncate text-[11px] text-muted">
                          {a.email || "Geen e-mail"}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-muted">
                    {gebruikerRolLabel[rol]}
                  </td>
                  <td>
                    <span
                      className={[
                        "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                        a.geblokkeerd === true
                          ? "bg-[#FDECEA] text-[#C62828]"
                          : actief
                            ? "bg-green-soft text-green-dark"
                            : "bg-[#FFF0E6] text-[#C45A12]",
                      ].join(" ")}
                    >
                      {a.geblokkeerd === true
                        ? "Geblokkeerd"
                        : actief
                          ? "Actief"
                          : "Inactief"}
                    </span>
                  </td>
                  <td className="max-w-[14rem]">
                    {lastNote ? (
                      <div className="min-w-0">
                        <p className="truncate text-[12px] text-ink">
                          {lastNote.text}
                        </p>
                        <p className="truncate text-[10px] text-muted">
                          {formatDateTimeNl(lastNote.at)}
                          {lastNote.author ? ` · ${lastNote.author}` : ""}
                        </p>
                      </div>
                    ) : (
                      <span className="text-[12px] text-muted">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap tabular-nums text-muted">
                    {sales
                      ? `${commissie.toLocaleString("nl-NL", {
                          maximumFractionDigits: 1,
                        })}%`
                      : opsCommissieLabel || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : activeFilter === "warmtefonds" ? (
        <table className="crm-table">
          <thead>
            <tr>
              <th>Naam</th>
              <th>E-mail</th>
              <th>Telefoon</th>
              <th>Vergoeding</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(rows as WarmtefondsOperator[]).map((o) => (
              <tr
                key={o.id}
                role="button"
                tabIndex={0}
                onClick={() => openWarmtefonds(o)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openWarmtefonds(o);
                  }
                }}
              >
                <td>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar size="sm" className="size-8">
                      <AvatarFallback className="text-[11px]">
                        {naamInitialen(o.naam) || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate font-medium text-ink">
                      {o.naam}
                    </span>
                  </div>
                </td>
                <td className="text-muted">{o.email || "—"}</td>
                <td className="whitespace-nowrap text-muted">
                  {o.telefoon || "—"}
                </td>
                <td className="tabular-nums font-semibold text-ink">
                  {formatEuro(
                    o.tarief_inc != null && Number(o.tarief_inc) > 0
                      ? edergyBedragenVanInc(Number(o.tarief_inc)).perAanvraagExcl
                      : EDERGY_PER_AANVRAAG_EXCL
                  )} excl.
                </td>
                <td>
                  <span
                    className={[
                      "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                      o.actief !== false
                        ? "bg-green-soft text-green-dark"
                        : "bg-[#FFF0E6] text-[#C45A12]",
                    ].join(" ")}
                  >
                    {o.actief !== false ? "Actief" : "Inactief"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="crm-table">
          <thead>
            <tr>
              <th>Naam</th>
              <th>E-mail</th>
              <th>KvK</th>
              <th>Agenda</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(rows as InstallatiePartner[]).map((p) => {
              const open = expandedPartnerId === p.id;
              return (
                <Fragment key={p.id}>
                  <tr
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      setExpandedPartnerId((cur) =>
                        cur === p.id ? null : p.id
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpandedPartnerId((cur) =>
                          cur === p.id ? null : p.id
                        );
                      }
                    }}
                  >
                    <td>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar size="sm" className="size-8">
                          <AvatarFallback className="text-[11px]">
                            {naamInitialen(p.naam) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <span className="block truncate font-medium text-ink">
                            {p.naam}
                          </span>
                          <span className="block truncate text-[11px] text-muted">
                            {open ? "Team verbergen" : "Team tonen · klik"}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="text-muted">{p.email || "—"}</td>
                    <td className="whitespace-nowrap text-muted">
                      {p.kvk_nummer || "—"}
                    </td>
                    <td className="whitespace-nowrap text-muted">
                      {p.google_connected_email ? "Gekoppeld" : "—"}
                    </td>
                    <td>
                      <span
                        className={[
                          "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                          p.actief !== false
                            ? "bg-green-soft text-green-dark"
                            : "bg-[#FFF0E6] text-[#C45A12]",
                        ].join(" ")}
                      >
                        {p.actief !== false ? "Actief" : "Inactief"}
                      </span>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="!cursor-default hover:!bg-transparent">
                      <td colSpan={5} className="!bg-[#FAFBFA] !p-0">
                        <div className="border-t border-line px-4 py-4 sm:px-5">
                          <div className="mb-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => openPartner(p)}
                              className="rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                            >
                              Bewerken
                            </button>
                            {p.portal_token ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openInstallatiePortal(p)}
                                  className="rounded-md border border-green/40 bg-green-soft px-3 py-1.5 text-xs font-semibold text-green-dark hover:bg-green hover:text-white"
                                >
                                  Open portaal
                                </button>
                                <button
                                  type="button"
                                  onClick={() => copyPortalLink(p)}
                                  className="rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                                >
                                  Kopieer link
                                </button>
                              </>
                            ) : null}
                          </div>
                          {p.portal_token ? (
                            <PartnerTeamgenotenPanel
                              portalToken={p.portal_token}
                              compact
                              adminBeoordeling
                              authorNaam={session?.naam || null}
                              initialTeamgenootId={
                                expandedPartnerId === p.id
                                  ? focusTeamgenootId
                                  : null
                              }
                            />
                          ) : (
                            <p className="text-sm text-muted">
                              Geen portaallink — teamleden kunnen niet geladen
                              worden.
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      </div>

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <form
            onSubmit={(e) => void addEntry(e)}
            className="w-full max-w-md space-y-3 border border-line bg-white p-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-ink">
                {activeFilter === "medewerkers"
                  ? `${gebruikerRolLabel[normalizeRol(rol)]} toevoegen`
                  : activeFilter === "warmtefonds"
                    ? "Warmtefondspartner toevoegen"
                    : `${partnerWoord} toevoegen`}
              </h3>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="text-sm text-muted hover:text-ink"
              >
                Sluiten
              </button>
            </div>
            <Field label="Naam">
              <input
                required
                value={naam}
                onChange={(e) => setNaam(e.target.value)}
                className={inputCls}
                placeholder={
                  activeFilter === "medewerkers"
                    ? "Bijv. Thub"
                    : activeFilter === "warmtefonds"
                      ? "Bijv. Edwin"
                      : "Bijv. Installatie BV"
                }
              />
            </Field>
            <Field label="E-mail">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Telefoon">
              <input
                value={telefoon}
                onChange={(e) => setTelefoon(e.target.value)}
                className={inputCls}
              />
            </Field>
            {activeFilter === "medewerkers" && (
              <>
                <Field label="Rol">
                  <select
                    value={rol}
                    onChange={(e) => {
                      const next = normalizeRol(e.target.value);
                      setRol(next);
                      if (next === "adviseur" && !startdatum) {
                        const today = new Date();
                        const y = today.getFullYear();
                        const m = String(today.getMonth() + 1).padStart(2, "0");
                        const d = String(today.getDate()).padStart(2, "0");
                        setStartdatum(`${y}-${m}-${d}`);
                      }
                    }}
                    className={inputCls}
                  >
                    {TEAM_ROLLEN.map((r) => (
                      <option key={r} value={r}>
                        {gebruikerRolLabel[r]}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="border border-line bg-wash px-3 py-2 text-[11px] leading-relaxed text-muted">
                  {
                    teamRolUitleg[
                      (TEAM_ROLLEN as readonly string[]).includes(rol)
                        ? (rol as TeamRol)
                        : "beller"
                    ]
                  }
                </p>
                {rol === "warmtefonds" ? (
                  <p className="border border-[#C45A12]/25 bg-[#FFF0E6] px-3 py-2 text-[11px] leading-relaxed text-[#C45A12]">
                    Komt in het systeem als Warmtefonds-operator (eigen portaal),
                    niet als sales-adviseur. Geen bel-planning of commissie.
                  </p>
                ) : null}
                {rol === "adviseur" ? (
                  <>
                    <Field label="Startdatum (verplicht)">
                      <input
                        type="date"
                        required
                        value={startdatum}
                        onChange={(e) => setStartdatum(e.target.value)}
                        className={inputCls}
                      />
                    </Field>
                    <p className="border border-green/30 bg-green-soft/50 px-3 py-2 text-[11px] text-green-dark">
                      Start als <strong>Actief</strong> met{" "}
                      <strong>10% commissie</strong>. Agenda is geblokkeerd tot
                      de startdatum. Lead-/afspraak-targets tellen pas mee vanaf
                      die dag (pro-rata in de lopende week/maand).
                    </p>
                  </>
                ) : null}
              </>
            )}
            {activeFilter === "warmtefonds" ? (
              <p className="border border-green/30 bg-green-soft/50 px-3 py-2 text-[11px] text-green-dark">
                Na toevoegen krijgt de adviseur een <strong>mail met
                inloggegevens</strong> (e-mail + wachtwoord) voor{" "}
                <strong>/warmtefonds/login</strong>.
              </p>
            ) : null}
            {error && (
              <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={saving}
              className="w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
            >
              {saving ? "Bezig…" : "Toevoegen"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green";

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={[
        "block text-[10px] font-semibold uppercase tracking-wide text-muted",
        className || "",
      ].join(" ")}
    >
      {label}
      {children}
    </label>
  );
}

function FormSection({
  title,
  hint,
  children,
  className,
  wide = false,
  id,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  /** Meer kolommen op brede schermen (factuur e.d.) */
  wide?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={["border border-line", className].filter(Boolean).join(" ")}
    >
      <div className="border-b border-line bg-[#fafbfa] px-3.5 py-2.5 sm:px-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {title}
        </h3>
        {hint ? (
          <p className="mt-0.5 text-[11px] font-normal normal-case tracking-normal text-muted">
            {hint}
          </p>
        ) : null}
      </div>
      <div
        className={[
          "grid gap-3 p-3.5 sm:p-4",
          wide
            ? "sm:grid-cols-2 xl:grid-cols-4"
            : "sm:grid-cols-2",
        ].join(" ")}
      >
        {children}
      </div>
    </section>
  );
}

