"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Adviseur, AdviseurCreditFactuur, InstallatiePartner } from "@/types/database";
import {
  GEBRUIKER_ROLLEN,
  gebruikerRolLabel,
  normalizeRol,
  type GebruikerRol,
} from "@/lib/rollen";
import { formatEuro } from "@/lib/format";
import { VERKOPER_AANBETALING_FEE } from "@/lib/adviseur-creditfactuur";
import { RelatieContractUpload } from "./RelatieContractUpload";

type ListFilter = "medewerkers" | "partners";

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
}: {
  onAdviseursChange?: () => void;
}) {
  const [filter, setFilter] = useState<ListFilter>("medewerkers");
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [rol, setRol] = useState<GebruikerRol>("adviseur");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<ListFilter | null>(null);
  const [draft, setDraft] = useState<Partial<Adviseur> | null>(null);
  const [partnerDraft, setPartnerDraft] = useState<Partial<InstallatiePartner> | null>(
    null
  );
  const [detailSaving, setDetailSaving] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  const selectedAdviseur =
    selectedKind === "medewerkers"
      ? adviseurs.find((a) => a.id === selectedId) || null
      : null;
  const selectedPartner =
    selectedKind === "partners"
      ? partners.find((p) => p.id === selectedId) || null
      : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [aRes, pRes] = await Promise.all([
        fetch("/api/adviseurs?include_inactive=1"),
        fetch("/api/installatie-partners?include_inactive=1"),
      ]);
      const aData = await aRes.json();
      const pData = await pRes.json();
      if (!aRes.ok) throw new Error(aData.error || "Medewerkers laden mislukt");
      if (!pRes.ok) throw new Error(pData.error || "Partners laden mislukt");
      setAdviseurs(aData.adviseurs || []);
      setPartners(pData.partners || []);
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

  function resetAddForm() {
    setNaam("");
    setEmail("");
    setTelefoon("");
    setRol("adviseur");
  }

  function openMedewerker(a: Adviseur) {
    setSelectedKind("medewerkers");
    setSelectedId(a.id);
    setPartnerDraft(null);
    setDraft({
      naam: a.naam,
      email: a.email,
      telefoon: a.telefoon,
      rol: normalizeRol(a.rol),
      start_adres: a.start_adres ?? null,
      commissie_pct: a.commissie_pct ?? 0,
      actief: a.actief,
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
    setPartnerDraft({
      naam: p.naam,
      email: p.email,
      telefoon: p.telefoon,
      actief: p.actief,
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

  function closeDetail() {
    setSelectedId(null);
    setSelectedKind(null);
    setDraft(null);
    setPartnerDraft(null);
    setNewPassword("");
    setConfirmPassword("");
  }

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      if (filter === "medewerkers") {
        const res = await fetch("/api/adviseurs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ naam, email, telefoon, rol }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
        setOkMsg(
          data.mail_sent
            ? `${data.adviseur.naam} toegevoegd — welkomstmail verstuurd.`
            : `${data.adviseur.naam} toegevoegd${data.mail_error ? ` (mail: ${data.mail_error})` : ""}.`
        );
        onAdviseursChange?.();
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

  async function toggleMedewerker(a: Adviseur) {
    try {
      const res = await fetch("/api/adviseurs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id, actief: !a.actief }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bijwerken mislukt");
      await load();
      onAdviseursChange?.();
      if (selectedId === a.id && data.adviseur) {
        openMedewerker(data.adviseur as Adviseur);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    }
  }

  async function togglePartner(p: InstallatiePartner) {
    try {
      const res = await fetch("/api/installatie-partners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, actief: !p.actief }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bijwerken mislukt");
      await load();
      if (selectedId === p.id && data.partner) {
        openPartner(data.partner as InstallatiePartner);
      }
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

  const rows = useMemo(() => {
    if (filter === "medewerkers") {
      return [...adviseurs].sort((a, b) => {
        if (a.actief !== b.actief) return a.actief ? -1 : 1;
        return a.naam.localeCompare(b.naam, "nl");
      });
    }
    return [...partners].sort((a, b) => {
      if (a.actief !== b.actief) return a.actief ? -1 : 1;
      return a.naam.localeCompare(b.naam, "nl");
    });
  }, [filter, adviseurs, partners]);

  const countLabel =
    filter === "medewerkers"
      ? `${adviseurs.length} medewerker${adviseurs.length === 1 ? "" : "s"}`
      : `${partners.length} partner${partners.length === 1 ? "" : "s"}`;

  // ── Detail view ──────────────────────────────────────────────────────────
  if (selectedAdviseur && draft) {
    return (
      <div className="border border-line bg-white">
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
                {gebruikerRolLabel[normalizeRol(selectedAdviseur.rol)]} · Medewerker
              </p>
            </div>
            <span
              className={
                selectedAdviseur.actief
                  ? "text-[11px] font-semibold uppercase tracking-wide text-green-dark"
                  : "text-[11px] font-semibold uppercase tracking-wide text-muted"
              }
            >
              {selectedAdviseur.actief ? "Actief" : "Uit"}
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
                {GEBRUIKER_ROLLEN.map((r) => (
                  <option key={r} value={r}>
                    {gebruikerRolLabel[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Startadres (reistijd)" className="sm:col-span-2">
              <input
                value={draft.start_adres || ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, start_adres: e.target.value }))
                }
                className={inputCls}
              />
            </Field>
          </div>

          {isSalesRol(draft.rol) && (
            <>
              <div className="border border-line bg-wash/50 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Commissie
                </p>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={draft.commissie_pct ?? 0}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        commissie_pct: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className="w-24 border border-line bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-green"
                  />
                  % over omzet excl. btw
                </label>
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
              <AdviseurCreditFacturenBlock
                adviseurId={selectedAdviseur.id}
                onMessage={(msg, isError) => {
                  if (isError) setError(msg);
                  else {
                    setError(null);
                    setOkMsg(msg);
                  }
                }}
              />
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
            <button
              type="button"
              disabled={detailSaving}
              onClick={() => void saveMedewerker()}
              className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
            >
              {detailSaving ? "Opslaan…" : "Opslaan"}
            </button>
            <button
              type="button"
              onClick={() => void toggleMedewerker(selectedAdviseur)}
              className="border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-wash"
            >
              {selectedAdviseur.actief ? "Deactiveren" : "Activeren"}
            </button>
            {selectedAdviseur.email && (
              <button
                type="button"
                onClick={() => void resendInvite(selectedAdviseur)}
                className="border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-wash"
              >
                Stuur loginmail
              </button>
            )}
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
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (selectedPartner && partnerDraft) {
    return (
      <div className="border border-line bg-white">
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
                selectedPartner.actief
                  ? "text-[11px] font-semibold uppercase tracking-wide text-green-dark"
                  : "text-[11px] font-semibold uppercase tracking-wide text-muted"
              }
            >
              {selectedPartner.actief ? "Actief" : "Uit"}
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
              disabled={detailSaving}
              onClick={() => void savePartner()}
              className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
            >
              {detailSaving ? "Opslaan…" : "Opslaan"}
            </button>
            <button
              type="button"
              onClick={() => copyPortalLink(selectedPartner)}
              className="border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-wash"
            >
              Kopieer portaallink
            </button>
            <button
              type="button"
              onClick={() => void togglePartner(selectedPartner)}
              className="border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-wash"
            >
              {selectedPartner.actief ? "Deactiveren" : "Activeren"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
  return (
    <div className="border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-line p-0.5">
            <button
              type="button"
              onClick={() => setFilter("medewerkers")}
              className={[
                "px-3 py-1.5 text-xs font-semibold",
                filter === "medewerkers"
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              Medewerkers
            </button>
            <button
              type="button"
              onClick={() => setFilter("partners")}
              className={[
                "px-3 py-1.5 text-xs font-semibold",
                filter === "partners"
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              Installatiepartners
            </button>
          </div>
          <p className="text-xs text-muted">{countLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            resetAddForm();
            setAddOpen(true);
            setError(null);
          }}
          className="bg-orange px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#e0651c]"
        >
          {filter === "medewerkers" ? "Medewerker toevoegen" : "Partner toevoegen"}
        </button>
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
            {filter === "medewerkers"
              ? "Nog geen medewerkers"
              : "Nog geen installatiepartners"}
          </p>
          <p className="mt-1 text-sm text-muted">
            Klik op toevoegen om de eerste aan te maken.
          </p>
        </div>
      ) : filter === "medewerkers" ? (
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
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {(rows as Adviseur[]).map((a) => {
                const sales = isSalesRol(a.rol);
                const pct = Number(a.commissie_pct) || 0;
                const kvkOk = Boolean(a.bedrijfsnaam && a.kvk_nummer && a.iban);
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
                          {pct.toLocaleString("nl-NL", {
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
                          a.actief
                            ? "text-[11px] font-semibold uppercase tracking-wide text-green-dark"
                            : "text-[11px] font-semibold uppercase tracking-wide text-muted"
                        }
                      >
                        {a.actief ? "Actief" : "Uit"}
                      </span>
                    </td>
                    <td className="text-muted">
                      <PencilIcon />
                    </td>
                  </tr>
                );
              })}
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
                        p.actief
                          ? "text-[11px] font-semibold uppercase tracking-wide text-green-dark"
                          : "text-[11px] font-semibold uppercase tracking-wide text-muted"
                      }
                    >
                      {p.actief ? "Actief" : "Uit"}
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
                {filter === "medewerkers"
                  ? "Medewerker toevoegen"
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
                  filter === "medewerkers" ? "Bijv. Huub" : "Bijv. Installatie BV"
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
            {filter === "medewerkers" && (
              <>
                <Field label="Rol">
                  <select
                    value={rol}
                    onChange={(e) => setRol(normalizeRol(e.target.value))}
                    className={inputCls}
                  >
                    {GEBRUIKER_ROLLEN.map((r) => (
                      <option key={r} value={r}>
                        {gebruikerRolLabel[r]}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="text-[11px] leading-relaxed text-muted">
                  Beller: alleen Bellen · Adviseur: sales · Backoffice:
                  Backoffice, Facturen en Inkomend · Admin: alles
                </p>
              </>
            )}
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

type CreditPreview = {
  week: {
    jaar: number;
    week: number;
    van: string;
    tot: string;
    betaalMaandag: string;
  };
  fee_per_aanbetaling: number;
  eligible: {
    factuur_id: string;
    factuur_nummer: string;
    lead_naam: string | null;
    betaald_op: string;
    fee: number;
  }[];
  preview: {
    aantal: number;
    bruto: number;
    bedrag: number;
    capped: boolean;
  };
  existing: AdviseurCreditFactuur | null;
  facturen: AdviseurCreditFactuur[];
};

function AdviseurCreditFacturenBlock({
  adviseurId,
  onMessage,
}: {
  adviseurId: string;
  onMessage: (msg: string, isError?: boolean) => void;
}) {
  const [data, setData] = useState<CreditPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/adviseurs/creditfacturen?adviseur_id=${adviseurId}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData(json as CreditPreview);
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Laden mislukt", true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adviseurId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createInvoice() {
    setBusy(true);
    try {
      const res = await fetch("/api/adviseurs/creditfacturen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adviseur_id: adviseurId,
          jaar: data?.week.jaar,
          week: data?.week.week,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Aanmaken mislukt");
      onMessage(
        `Concept ${json.factuur.factuur_nummer} aangemaakt (${json.regels_count} × €${VERKOPER_AANBETALING_FEE}). Verstuur via Creditfacturen.`
      );
      await load();
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Aanmaken mislukt", true);
    } finally {
      setBusy(false);
    }
  }

  async function patchStatus(id: string, status: "verzonden" | "betaald") {
    setBusy(true);
    try {
      const res = await fetch("/api/adviseurs/creditfacturen", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Bijwerken mislukt");
      onMessage(
        status === "verzonden"
          ? `Factuur ${json.factuur.factuur_nummer} verstuurd naar adviseur.`
          : `Creditfactuur ${json.factuur.factuur_nummer} gemarkeerd als betaald.`
      );
      await load();
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Bijwerken mislukt", true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-line">
      <div className="border-b border-line px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Creditfacturen
        </p>
        <p className="mt-1 text-sm text-muted">
          €{VERKOPER_AANBETALING_FEE} per betaalde klant-aanbetaling (ma–zo).
        </p>
      </div>
      {loading || !data ? (
        <p className="px-4 py-6 text-sm text-muted">Laden…</p>
      ) : (
        <div className="space-y-4 p-4">
          <div className="border border-line bg-wash px-3 py-3">
            <p className="text-sm font-semibold text-ink">
              Week {data.week.week} · {data.week.van} t/m {data.week.tot}
            </p>
            <p className="mt-2 text-sm">
              {data.preview.aantal} aanbetaling
              {data.preview.aantal === 1 ? "" : "en"} →{" "}
              <span className="font-semibold tabular-nums">
                {formatEuro(data.preview.bedrag)}
              </span>
            </p>
            <div className="mt-3">
              {data.existing && data.existing.status !== "geannuleerd" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted">
                    {data.existing.status === "concept"
                      ? "Concept: "
                      : "Al aangemaakt: "}
                    <span className="font-semibold text-ink">
                      {data.existing.factuur_nummer}
                    </span>
                  </p>
                  {(data.existing.status === "concept" ||
                    data.existing.status === "verzonden") && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void patchStatus(data.existing!.id, "verzonden")
                      }
                      className="bg-orange px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {data.existing.status === "verzonden"
                        ? "Opnieuw versturen"
                        : "Verstuur naar adviseur"}
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy || data.preview.aantal === 0}
                  onClick={() => void createInvoice()}
                  className="bg-orange px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busy
                    ? "Bezig…"
                    : `Maak concept (${formatEuro(data.preview.bedrag)})`}
                </button>
              )}
            </div>
          </div>
          {data.facturen.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase text-muted">
                  <th className="py-2">Nummer</th>
                  <th>Week</th>
                  <th className="text-right">Bedrag</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.facturen.map((f) => (
                  <tr key={f.id} className="border-b border-line/60">
                    <td className="py-2 font-medium">{f.factuur_nummer}</td>
                    <td className="text-muted">
                      {f.week_jaar}-W{String(f.week_nummer).padStart(2, "0")}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatEuro(f.bedrag_ex_btw)}
                    </td>
                    <td className="capitalize text-muted">
                      {(f.status === "goedgekeurd" || f.status === "betaald") &&
                      f.goedgekeurd_op ? (
                        <span className="inline-flex items-center gap-1 text-green-dark">
                          <span aria-hidden>✓</span>
                          {f.status}
                        </span>
                      ) : (
                        f.status
                      )}
                    </td>
                    <td className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {(f.status === "concept" ||
                          f.status === "verzonden") && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void patchStatus(f.id, "verzonden")}
                            className="text-xs font-medium text-orange hover:underline"
                          >
                            Verstuur
                          </button>
                        )}
                        {(f.status === "goedgekeurd" ||
                          f.status === "verzonden") && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void patchStatus(f.id, "betaald")}
                              className="bg-green px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              Betaald
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
