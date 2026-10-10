"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Adviseur, InstallatiePartner } from "@/types/database";
import type { WarmtefondsOperator } from "@/lib/warmtefonds-portal";
import {
  TEAM_ROLLEN,
  gebruikerRolLabel,
  normalizeRol,
  teamRolUitleg,
  type GebruikerRol,
  type TeamRol,
} from "@/lib/rollen";
import { RelatieContractUpload } from "./RelatieContractUpload";
import { StartAdresPostcodeField } from "./StartAdresPostcodeField";
import { clearCrmShellCache } from "@/lib/crm-shell-cache";
import Link from "next/link";

type ListFilter = "medewerkers" | "partners" | "warmtefonds";

function isSalesRol(rol: string | null | undefined): boolean {
  return normalizeRol(rol) === "adviseur";
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

export function InstellingenPanel({
  onAdviseursChange,
  /** Alleen adviseurs/team — geen installatiepartners. */
  teamOnly = false,
  /** Extern gestuurd filter (bijv. via PartnersPanel-tabs). */
  listFilter,
  /** Verberg Team/Installatie/Warmtefonds-tabs (nav zit in parent). */
  hideListTabs = false,
}: {
  onAdviseursChange?: () => void;
  teamOnly?: boolean;
  listFilter?: ListFilter;
  hideListTabs?: boolean;
}) {
  const [filter, setFilter] = useState<ListFilter>(
    listFilter ?? "medewerkers"
  );
  /** Rolfilter binnen Team: all of een specifieke login-rol. */
  const [teamRolFilter, setTeamRolFilter] = useState<"all" | TeamRol>("all");
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [wfOperators, setWfOperators] = useState<WarmtefondsOperator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [rol, setRol] = useState<GebruikerRol>("beller");

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
      rol: normalizeRol(a.rol),
      start_adres: a.start_adres ?? null,
      commissie_pct:
        a.commissie_pct != null && Number.isFinite(Number(a.commissie_pct))
          ? Number(a.commissie_pct)
          : 10,
      actief: a.actief !== false,
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
    });
    setError(null);
    setOkMsg(null);
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
        const res = await fetch("/api/adviseurs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            naam,
            email,
            telefoon,
            rol,
            ...(rol === "adviseur" ? { commissie_pct: 10 } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
        setOkMsg(
          data.mail_sent
            ? `${data.adviseur.naam} toegevoegd — welkomstmail verstuurd.`
            : `${data.adviseur.naam} toegevoegd${data.mail_error ? ` (mail: ${data.mail_error})` : ""}.`
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
          op
            ? `${op.naam} toegevoegd als Warmtefondspartner.`
            : "Warmtefondspartner toegevoegd."
        );
        if (op?.portal_token) {
          const url = `${portalBase()}/warmtefonds/${op.portal_token}`;
          void navigator.clipboard.writeText(url).catch(() => {});
          setOkMsg(
            `${op.naam} toegevoegd — portaallink gekopieerd.`
          );
        }
      } else {
        const res = await fetch("/api/installatie-partners", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ naam, email, telefoon }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
        setOkMsg(`${data.partner.naam} is toegevoegd als installatiepartner.`);
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
        rol: normalizeRol(draft.rol),
        start_adres: draft.start_adres?.toString().trim() || null,
        actief: draft.actief !== false,
      };
      if (isSalesRol(draft.rol)) {
        const pct = Number(draft.commissie_pct) || 0;
        if (pct < 0 || pct > 100) throw new Error("Commissie moet tussen 0 en 100% zijn");
        patch.commissie_pct = Math.round(pct * 100) / 100;
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

  async function regenerateWfToken(o: WarmtefondsOperator) {
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/warmtefonds-operators", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: o.id, regenerate_token: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Token vernieuwen mislukt");
      const op = data.operator as WarmtefondsOperator;
      setOkMsg(`Nieuwe portaallink voor ${op.naam}.`);
      await load();
      openWarmtefonds(op);
      const url = `${portalBase()}/warmtefonds/${op.portal_token}`;
      void navigator.clipboard.writeText(url).catch(() => {});
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

  function copyPortalLink(p: InstallatiePartner) {
    const url = `${portalBase()}/installatie/${p.portal_token}`;
    void navigator.clipboard.writeText(url).then(
      () => setOkMsg(`Portaallink gekopieerd voor ${p.naam}.`),
      () => setError("Kopiëren mislukt")
    );
  }

  function wfPortalUrl(o: WarmtefondsOperator): string {
    return `${portalBase()}/warmtefonds/${o.portal_token}`;
  }

  function copyWfPortalLink(o: WarmtefondsOperator) {
    void navigator.clipboard.writeText(wfPortalUrl(o)).then(
      () => setOkMsg(`Warmtefonds-portaallink gekopieerd voor ${o.naam}.`),
      () => setError("Kopiëren mislukt")
    );
  }

  function openWfPortal(o: WarmtefondsOperator) {
    window.open(wfPortalUrl(o), "_blank", "noopener,noreferrer");
  }

  const rows = useMemo(() => {
    if (activeFilter === "medewerkers") {
      return [...adviseurs]
        .filter((a) => {
          if (teamRolFilter === "all") return true;
          return normalizeRol(a.rol) === teamRolFilter;
        })
        .sort((a, b) => {
          if (a.actief !== b.actief) return a.actief ? -1 : 1;
          return a.naam.localeCompare(b.naam, "nl");
        });
    }
    if (activeFilter === "warmtefonds") {
      return [...wfOperators].sort((a, b) => {
        if (a.actief !== b.actief) return a.actief ? -1 : 1;
        return a.naam.localeCompare(b.naam, "nl");
      });
    }
    return [...partners].sort((a, b) => {
      if (a.actief !== b.actief) return a.actief ? -1 : 1;
      return a.naam.localeCompare(b.naam, "nl");
    });
  }, [activeFilter, teamRolFilter, adviseurs, partners, wfOperators]);

  const teamRolCounts = useMemo(() => {
    const counts: Record<TeamRol, number> = {
      admin: 0,
      adviseur: 0,
      beller: 0,
      backoffice: 0,
    };
    for (const a of adviseurs) {
      const r = normalizeRol(a.rol);
      if (r in counts) counts[r as TeamRol] += 1;
    }
    return counts;
  }, [adviseurs]);

  const countLabel =
    activeFilter === "medewerkers"
      ? teamRolFilter === "all"
        ? `${adviseurs.length} medewerker${adviseurs.length === 1 ? "" : "s"}`
        : `${rows.length}× ${gebruikerRolLabel[teamRolFilter]}`
      : activeFilter === "warmtefonds"
        ? `${wfOperators.length} Warmtefondspartner${wfOperators.length === 1 ? "" : "s"}`
        : `${partners.length} installatiepartner${partners.length === 1 ? "" : "s"}`;

  // ── Detail view ──────────────────────────────────────────────────────────
  if (selectedAdviseur && draft) {
    return (
      <div className="relative border border-line bg-white pb-24">
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
                {selectedAdviseur.naam}
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                {gebruikerRolLabel[normalizeRol(selectedAdviseur.rol)]}
                {isSalesRol(draft.rol)
                  ? ` · commissie ${Number(draft.commissie_pct) || 0}%`
                  : ""}
              </p>
            </div>
            <span
              className={
                draft.actief !== false
                  ? "text-[11px] font-semibold uppercase tracking-wide text-green-dark"
                  : "text-[11px] font-semibold uppercase tracking-wide text-[#C45A12]"
              }
            >
              {draft.actief !== false ? "Actief" : "Inactief"}
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
                value={draft.naam || ""}
                onChange={(e) => setDraft((d) => ({ ...d, naam: e.target.value }))}
                className={inputCls}
              />
            </Field>
            <Field label="E-mail">
              <input
                type="email"
                value={draft.email || ""}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
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
                  setDraft((d) => ({ ...d, rol: normalizeRol(e.target.value) }))
                }
                className={inputCls}
              >
                {TEAM_ROLLEN.map((r) => (
                  <option key={r} value={r}>
                    {gebruikerRolLabel[r]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] font-normal normal-case tracking-normal text-muted">
                {teamRolUitleg[normalizeRol(draft.rol) as TeamRol] ||
                  teamRolUitleg.adviseur}
              </p>
            </Field>
            <div className="sm:col-span-2 border border-line bg-wash/40 px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Status
              </p>
              <div className="mt-2 flex border border-line p-0.5">
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, actief: true }))}
                  className={[
                    "flex-1 px-3 py-2 text-sm font-semibold",
                    draft.actief !== false
                      ? "bg-green text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  Actief
                </button>
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, actief: false }))}
                  className={[
                    "flex-1 px-3 py-2 text-sm font-semibold",
                    draft.actief === false
                      ? "bg-[#C45A12] text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  Inactief
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">
                <strong>Actief</strong> = verschijnt in de planning (bellen /
                beste slots). <strong>Inactief</strong> = kan nog wel inloggen,
                maar komt niet meer voor om in te plannen. Beschikbaarheid
                (week/slots) regel je op de Agenda.
              </p>
            </div>
            <div className="sm:col-span-2">
              <StartAdresPostcodeField
                value={draft.start_adres || ""}
                onChange={(next) =>
                  setDraft((d) => ({ ...d, start_adres: next }))
                }
                inputClassName={inputCls}
              />
            </div>
          </div>

          {isSalesRol(draft.rol) && (
            <>
              <div className="border border-green/40 bg-green-soft/40 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-green-dark">
                  Commissie
                </p>
                <p className="mt-1 text-xs text-muted">
                  Standaard 10% over omzet excl. btw — pas aan als nodig.
                  Gebruikt voor creditfacturen / uitbetalingen.
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Percentage
                    </span>
                    <div className="mt-1 flex items-center gap-2">
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
                        className="w-28 border border-line bg-white px-3 py-2.5 text-lg font-semibold tabular-nums text-ink outline-none focus:border-green"
                      />
                      <span className="text-sm font-semibold text-ink">%</span>
                    </div>
                  </label>
                  <p className="pb-2 text-xs text-muted">
                    Bijv. 10% op €10.000 excl. = €1.000 commissie
                  </p>
                </div>
              </div>
              <div className="border border-line p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  ZZP / factuurgegevens
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Bedrijfsnaam" className="sm:col-span-2">
                    <input
                      value={draft.bedrijfsnaam || ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, bedrijfsnaam: e.target.value }))
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label="KvK">
                    <input
                      value={draft.kvk_nummer || ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, kvk_nummer: e.target.value }))
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Btw-nummer">
                    <input
                      value={draft.btw_nummer || ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, btw_nummer: e.target.value }))
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
              </div>
              <AdviseurCreditFacturenBlock />
            </>
          )}

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

          <div className="flex flex-wrap gap-2">
            {selectedAdviseur.email ? (
              <button
                type="button"
                onClick={() => void resendInvite(selectedAdviseur)}
                className="border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-wash"
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
              className="border border-green bg-green-soft px-4 py-2 text-sm font-semibold text-green-dark hover:bg-green hover:text-white disabled:opacity-50"
              title={
                !selectedAdviseur.email
                  ? "Geen e-mailadres"
                  : "Bekijk CRM als deze gebruiker"
              }
            >
              {loginAlsId === selectedAdviseur.id
                ? "Bezig…"
                : "Login als"}
            </button>
          </div>

          <div className="border-t border-line pt-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Wachtwoord
            </p>
            <div className="mt-2 grid max-w-md gap-2">
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nieuw wachtwoord (min. 8)"
                className={inputCls}
              />
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Bevestig"
                className={inputCls}
              />
              <button
                type="button"
                disabled={passwordSaving}
                onClick={() => void savePassword(selectedAdviseur)}
                className="w-fit border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-wash disabled:opacity-60"
              >
                {passwordSaving ? "Bezig…" : "Wachtwoord opslaan"}
              </button>
              <p className="text-[11px] text-muted">
                Wachtwoord heeft een eigen knop — overige velden via Opslaan
                onderaan.
              </p>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 border-t border-line bg-white px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={deleting || detailSaving}
              onClick={() => void deleteMedewerker(selectedAdviseur)}
              className="border border-[#C45A12]/40 bg-[#FFF0E6] px-4 py-2.5 text-sm font-semibold text-[#C45A12] hover:bg-[#ffe4d4] disabled:opacity-60"
            >
              {deleting ? "Verwijderen…" : "Account verwijderen"}
            </button>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs text-muted">
                Wijzigingen pas actief na{" "}
                <strong className="text-ink">Opslaan</strong>.
              </p>
              <button
                type="button"
                disabled={detailSaving || deleting}
                onClick={() => void saveMedewerker()}
                className="bg-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
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
      <div className="relative border border-line bg-white pb-24">
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
              <p className="mt-0.5 text-sm text-muted">Installatiepartner</p>
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
                  value={partnerDraft.iban || ""}
                  onChange={(e) =>
                    setPartnerDraft((d) => ({ ...d, iban: e.target.value }))
                  }
                  className={inputCls}
                />
              </Field>
            </div>
          </div>

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

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => copyPortalLink(selectedPartner)}
              className="border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-wash"
            >
              Kopieer portaallink
            </button>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 border-t border-line bg-white px-4 py-3 sm:px-5">
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
    return (
      <div className="relative border border-line bg-white pb-24">
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
                {selectedWf.naam}
              </h2>
              <p className="mt-0.5 text-sm text-muted">Warmtefondspartner</p>
            </div>
            <span
              className={
                wfDraft.actief !== false
                  ? "text-[11px] font-semibold uppercase tracking-wide text-green-dark"
                  : "text-[11px] font-semibold uppercase tracking-wide text-[#C45A12]"
              }
            >
              {wfDraft.actief !== false ? "Actief" : "Inactief"}
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
            <div className="sm:col-span-2 border border-line bg-wash/40 px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Status
              </p>
              <div className="mt-2 flex border border-line p-0.5">
                <button
                  type="button"
                  onClick={() => setWfDraft((d) => ({ ...d, actief: true }))}
                  className={[
                    "flex-1 px-3 py-2 text-sm font-semibold",
                    wfDraft.actief !== false
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
                    "flex-1 px-3 py-2 text-sm font-semibold",
                    wfDraft.actief === false
                      ? "bg-[#C45A12] text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  Inactief
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">
                Actieve Warmtefondspartners krijgen toegang tot alle
                Warmtefonds-orders via hun portaallink.
              </p>
            </div>
          </div>

          <div className="border border-line p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Warmtefonds-account
            </p>
            <p className="mt-1 text-sm text-muted">
              Login via magic link — geen wachtwoord. Deel de portaallink met de
              partner.
            </p>
            <p className="mt-3 break-all rounded border border-line bg-wash/50 px-3 py-2 font-mono text-[11px] text-ink">
              {wfPortalUrl(liveOp)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openWfPortal(liveOp)}
                className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark"
              >
                Open portaal
              </button>
              <button
                type="button"
                onClick={() => copyWfPortalLink(liveOp)}
                className="border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-wash"
              >
                Kopieer portaallink
              </button>
              <button
                type="button"
                onClick={() => void regenerateWfToken(selectedWf)}
                className="border border-line bg-white px-4 py-2 text-sm font-medium text-muted hover:bg-wash hover:text-ink"
              >
                Vernieuw token
              </button>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 border-t border-line bg-white px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              Wijzigingen worden pas bewaard als je{" "}
              <strong className="text-ink">Opslaan</strong> klikt.
            </p>
            <button
              type="button"
              disabled={detailSaving}
              onClick={() => void saveWarmtefonds()}
              className="bg-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
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

  return (
    <div className="border border-line bg-white">
      <div className="space-y-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
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
                  Team
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
                  Installatiepartners
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
            className="bg-orange px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#e0651c]"
          >
            {activeFilter === "medewerkers"
              ? teamRolFilter !== "all"
                ? `+ ${gebruikerRolLabel[teamRolFilter]}`
                : "+ Medewerker"
              : activeFilter === "warmtefonds"
                ? "+ Warmtefondspartner"
                : "+ Installatiepartner"}
          </button>
        </div>

        {activeFilter === "medewerkers" ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setTeamRolFilter("all")}
              className={[
                "border px-2.5 py-1 text-[11px] font-semibold",
                teamRolFilter === "all"
                  ? "border-green bg-green text-white"
                  : "border-line bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              Alle ({adviseurs.length})
            </button>
            {TEAM_ROLLEN.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setTeamRolFilter(r)}
                className={[
                  "border px-2.5 py-1 text-[11px] font-semibold",
                  teamRolFilter === r
                    ? "border-green bg-green text-white"
                    : "border-line bg-white text-muted hover:bg-wash",
                ].join(" ")}
                title={teamRolUitleg[r]}
              >
                {gebruikerRolLabel[r]} ({teamRolCounts[r]})
              </button>
            ))}
          </div>
        ) : null}
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

      {loading ? (
        <p className="px-5 py-14 text-center text-sm text-muted">Laden…</p>
      ) : rows.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <p className="font-display text-base font-semibold text-ink">
            {activeFilter === "medewerkers"
              ? teamRolFilter === "all"
                ? "Nog geen medewerkers"
                : `Nog geen ${gebruikerRolLabel[teamRolFilter].toLowerCase()}-accounts`
              : activeFilter === "warmtefonds"
                ? "Nog geen Warmtefondspartners"
                : "Nog geen installatiepartners"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {activeFilter === "medewerkers"
              ? "Kies een rol (Admin, Adviseur, Beller of Backoffice) en voeg een account toe."
              : activeFilter === "warmtefonds"
                ? "Voeg een Warmtefondspartner toe voor portaallink (bijv. Edwin)."
                : "Voeg een installatiepartner toe voor schouw/installatie en portaallink."}
          </p>
        </div>
      ) : activeFilter === "medewerkers" ? (
        <div className="overflow-x-auto">
          <table className="crm-table w-full">
            <thead>
              <tr>
                <th>Naam</th>
                <th>E-mail</th>
                <th>Rol</th>
                <th>Commissie</th>
                <th>KvK</th>
                <th>Contract</th>
                <th>Status</th>
                <th className="w-28" />
              </tr>
            </thead>
            <tbody>
              {(rows as Adviseur[]).map((a) => {
                const sales = isSalesRol(a.rol);
                const kvkOk = Boolean(a.bedrijfsnaam && a.kvk_nummer && a.iban);
                const canLoginAls = Boolean(a.email?.trim());
                return (
                  <tr
                    key={a.id}
                    onClick={() => openMedewerker(a)}
                    className="cursor-pointer hover:bg-[#f7faf8]"
                  >
                    <td className="font-medium text-ink">{a.naam}</td>
                    <td className="text-muted">{a.email || "—"}</td>
                    <td className="text-xs font-semibold">
                      {gebruikerRolLabel[normalizeRol(a.rol)]}
                    </td>
                    <td className="tabular-nums">
                      {sales ? (
                        <span className="font-semibold">
                          {(
                            a.commissie_pct != null &&
                            Number.isFinite(Number(a.commissie_pct))
                              ? Number(a.commissie_pct)
                              : 10
                          ).toLocaleString("nl-NL", {
                            maximumFractionDigits: 1,
                          })}
                          %
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="text-muted text-xs">
                      {sales ? (
                        kvkOk ? (
                          a.kvk_nummer
                        ) : (
                          <span className="text-[#C45A12]">Incompleet</span>
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-muted text-xs">
                      {a.contract_bestandsnaam ? "Ja" : "—"}
                    </td>
                    <td>
                      <span
                        className={
                          a.actief !== false
                            ? "text-[11px] font-semibold uppercase tracking-wide text-green-dark"
                            : "text-[11px] font-semibold uppercase tracking-wide text-[#C45A12]"
                        }
                      >
                        {a.actief !== false ? "Actief" : "Inactief"}
                      </span>
                    </td>
                    <td
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={!canLoginAls || loginAlsId === a.id}
                          onClick={() => void loginAls(a)}
                          className="border border-green/40 bg-green-soft px-2 py-1 text-[11px] font-semibold text-green-dark hover:bg-green hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                          title={
                            !canLoginAls
                              ? "Geen e-mailadres"
                              : `Login als ${a.naam}`
                          }
                        >
                          {loginAlsId === a.id ? "…" : "Login als"}
                        </button>
                        <button
                          type="button"
                          onClick={() => openMedewerker(a)}
                          className="text-muted hover:text-ink"
                          aria-label={`${a.naam} bewerken`}
                        >
                          <PencilIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : activeFilter === "warmtefonds" ? (
        <div className="overflow-x-auto">
          <table className="crm-table w-full">
            <thead>
              <tr>
                <th>Naam</th>
                <th>E-mail</th>
                <th>Telefoon</th>
                <th>Status</th>
                <th className="w-36" />
              </tr>
            </thead>
            <tbody>
              {(rows as WarmtefondsOperator[]).map((o) => (
                <tr
                  key={o.id}
                  onClick={() => openWarmtefonds(o)}
                  className="cursor-pointer hover:bg-[#f7faf8]"
                >
                  <td className="font-medium text-ink">{o.naam}</td>
                  <td className="text-muted">{o.email || "—"}</td>
                  <td className="text-muted">{o.telefoon || "—"}</td>
                  <td>
                    <span
                      className={
                        o.actief !== false
                          ? "text-[11px] font-semibold uppercase tracking-wide text-green-dark"
                          : "text-[11px] font-semibold uppercase tracking-wide text-[#C45A12]"
                      }
                    >
                      {o.actief !== false ? "Actief" : "Inactief"}
                    </span>
                  </td>
                  <td
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openWfPortal(o)}
                        className="border border-green/40 bg-green-soft px-2 py-1 text-[11px] font-semibold text-green-dark hover:bg-green hover:text-white"
                        title="Open Warmtefonds-portaal"
                      >
                        Open account
                      </button>
                      <button
                        type="button"
                        onClick={() => openWarmtefonds(o)}
                        className="text-muted hover:text-ink"
                        aria-label={`${o.naam} bewerken`}
                      >
                        <PencilIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="crm-table w-full">
            <thead>
              <tr>
                <th>Naam</th>
                <th>E-mail</th>
                <th>KvK</th>
                <th>Contract</th>
                <th>Status</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {(rows as InstallatiePartner[]).map((p) => (
                <tr
                  key={p.id}
                  onClick={() => openPartner(p)}
                  className="cursor-pointer hover:bg-[#f7faf8]"
                >
                  <td className="font-medium text-ink">{p.naam}</td>
                  <td className="text-muted">{p.email || "—"}</td>
                  <td className="text-muted text-xs">
                    {p.kvk_nummer || (
                      <span className="text-[#C45A12]">Ontbreekt</span>
                    )}
                  </td>
                  <td className="text-muted text-xs">
                    {p.contract_bestandsnaam ? "Ja" : "—"}
                  </td>
                  <td>
                    <span
                      className={
                        p.actief !== false
                          ? "text-[11px] font-semibold uppercase tracking-wide text-green-dark"
                          : "text-[11px] font-semibold uppercase tracking-wide text-[#C45A12]"
                      }
                    >
                      {p.actief !== false ? "Actief" : "Inactief"}
                    </span>
                  </td>
                  <td className="text-muted">
                    <PencilIcon />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                    : "Installatiepartner toevoegen"}
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
                    onChange={(e) => setRol(normalizeRol(e.target.value))}
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
                {rol === "adviseur" ? (
                  <p className="border border-green/30 bg-green-soft/50 px-3 py-2 text-[11px] text-green-dark">
                    Start als <strong>Actief</strong> met{" "}
                    <strong>10% commissie</strong> — na toevoegen kun je dat
                    aanpassen en opslaan.
                  </p>
                ) : null}
              </>
            )}
            {activeFilter === "warmtefonds" ? (
              <p className="border border-green/30 bg-green-soft/50 px-3 py-2 text-[11px] text-green-dark">
                Na toevoegen krijg je een <strong>portaallink</strong> (magic
                link) naar het Warmtefonds-account — geen wachtwoord.
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
  "mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green";

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

function AdviseurCreditFacturenBlock() {
  return (
    <div className="border border-line">
      <div className="border-b border-line px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Uitbetalingen
        </p>
        <p className="mt-1 text-sm text-muted">
          Commissie-creditfacturen maak en verstuur je in de
          uitbetalingen-inbox.
        </p>
      </div>
      <div className="px-4 py-4">
        <Link
          href="/?tab=partners&partners=uitbetalingen"
          className="inline-flex bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-deeper"
        >
          Open Uitbetalingen
        </Link>
      </div>
    </div>
  );
}
