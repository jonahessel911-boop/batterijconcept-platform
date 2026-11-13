"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EllipsisIcon, Plus } from "lucide-react";
import type { InstallatiePartnerTeamgenoot } from "@/types/database";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MedewerkerInstallatiesPanel } from "@/components/crm/MedewerkerInstallatiesPanel";
import {
  emptyMonteurProfielDraft,
  MonteurProfielFields,
  type MonteurProfielDraft,
} from "@/components/installatie/MonteurProfielFields";
import { NieuweMonteurPage } from "@/components/installatie/NieuweMonteurPage";
import { PartnerKoppelsPanel } from "@/components/installatie/PartnerKoppelsPanel";
import { normalizeMerkenErvaring } from "@/lib/installatie-merken";
import { normalizeMonteurRegios } from "@/lib/postcode-provincie";

type DocKey = "kvk_uitreksel" | "certificaten" | "cv" | "foto";

const TEAM_DOC_FIELDS: {
  key: DocKey;
  label: string;
  required: boolean;
  accept: string;
  hint?: string;
}[] = [
  {
    key: "kvk_uitreksel",
    label: "KvK-uittreksel",
    required: true,
    accept: ".pdf,image/*",
  },
  {
    key: "certificaten",
    label: "Certificeringen",
    required: true,
    accept: ".pdf,image/*",
  },
  {
    key: "cv",
    label: "CV",
    required: false,
    accept: ".pdf,image/*",
  },
  {
    key: "foto",
    label: "Foto",
    required: true,
    accept: "image/*",
    hint: "Mag ook door het teamlid zelf via Profiel.",
  },
];

function docStatus(t: InstallatiePartnerTeamgenoot, key: DocKey) {
  if (key === "kvk_uitreksel") {
    return {
      path: t.kvk_uitreksel_storage_path,
      name: t.kvk_uitreksel_bestandsnaam,
    };
  }
  if (key === "certificaten") {
    return {
      path: t.certificaten_storage_path,
      name: t.certificaten_bestandsnaam,
    };
  }
  if (key === "cv") {
    return { path: t.cv_storage_path, name: t.cv_bestandsnaam };
  }
  return { path: t.foto_storage_path, name: t.foto_bestandsnaam };
}

type Props = {
  portalToken: string;
  /** Compacte CRM-variant (onder uitgeklapte partner). */
  compact?: boolean;
  /** CRM: toon Installaties-tab per medewerker (beoordeling). */
  adminBeoordeling?: boolean;
  authorNaam?: string | null;
  /** Open direct Installaties van deze medewerker. */
  initialTeamgenootId?: string | null;
};

function Notice({
  tone,
  compact = false,
  children,
}: {
  tone: "error" | "ok" | "warn";
  compact?: boolean;
  children: ReactNode;
}) {
  const toneClass =
    tone === "ok"
      ? "border-green/25 bg-green-soft text-green-dark"
      : tone === "warn"
        ? "border-[#E8D48B] bg-[#FFFBEB] text-[#92400E]"
        : "";
  return (
    <Alert
      variant={tone === "error" ? "destructive" : "default"}
      className={[toneClass, compact ? "py-1.5 text-xs" : ""].join(" ")}
    >
      <AlertDescription
        className={tone === "error" ? undefined : "text-inherit"}
      >
        {children}
      </AlertDescription>
    </Alert>
  );
}

function draftFromTeamgenoot(t: InstallatiePartnerTeamgenoot): MonteurProfielDraft {
  return {
    rol: t.rol === "beheerder" ? "beheerder" : "monteur",
    kan_schouw: t.kan_schouw === true,
    kan_installatie: t.kan_installatie !== false,
    leeftijd: t.leeftijd != null ? String(t.leeftijd) : "",
    merken: normalizeMerkenErvaring(t.merken_ervaring),
    regios: normalizeMonteurRegios(t.regios),
  };
}

export function PartnerTeamgenotenPanel({
  portalToken,
  compact = false,
  adminBeoordeling = false,
  authorNaam = null,
  initialTeamgenootId = null,
}: Props) {
  const [items, setItems] = useState<InstallatiePartnerTeamgenoot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inviteBusy, setInviteBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [migrationHint, setMigrationHint] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialTeamgenootId
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MonteurProfielDraft>(
    emptyMonteurProfielDraft()
  );
  const [editNaam, setEditNaam] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editTelefoon, setEditTelefoon] = useState("");
  const [uploadBusy, setUploadBusy] = useState<DocKey | null>(null);

  const [showNieuw, setShowNieuw] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setMigrationHint(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten`,
        signal ? { signal } : undefined
      );
      const data = await res.json().catch(() => ({}));
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setItems((data.teamgenoten || []) as InstallatiePartnerTeamgenoot[]);
      if (data.migration_required && data.hint) {
        setMigrationHint(data.hint);
      }
    } catch (e) {
      if (signal?.aborted) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [portalToken]);

  useEffect(() => {
    const ac = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      ac.abort();
      setLoading(false);
      setError("Team laden duurde te lang — vernieuw de pagina.");
    }, 20000);
    void load(ac.signal).finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      if (!timedOut) ac.abort();
    };
  }, [load]);

  useEffect(() => {
    if (initialTeamgenootId) setSelectedId(initialTeamgenootId);
  }, [initialTeamgenootId]);

  function openEdit(t: InstallatiePartnerTeamgenoot) {
    setEditingId(t.id);
    setEditNaam(t.naam);
    setEditEmail(t.email || "");
    setEditTelefoon(t.telefoon || "");
    setEditDraft(draftFromTeamgenoot(t));
    if (adminBeoordeling) setSelectedId(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    if (!editDraft.kan_schouw && !editDraft.kan_installatie) {
      setError("Vink minstens Schouw of Installatie aan.");
      return;
    }
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingId,
            naam: editNaam.trim(),
            email: editEmail.trim() || null,
            telefoon: editTelefoon.trim() || null,
            rol: editDraft.rol,
            kan_schouw: editDraft.kan_schouw,
            kan_installatie: editDraft.kan_installatie,
            regios: editDraft.regios,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setItems((list) =>
        list.map((t) =>
          t.id === editingId
            ? { ...t, ...(data.teamgenoot as InstallatiePartnerTeamgenoot) }
            : t
        )
      );
      setOkMsg("Profiel opgeslagen");
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function uploadDoc(id: string, type: DocKey, file: File) {
    setUploadBusy(type);
    setError(null);
    setOkMsg(null);
    try {
      const fd = new FormData();
      fd.append("id", id);
      fd.append("type", type);
      fd.append("file", file);
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten`,
        { method: "PATCH", body: fd }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        teamgenoot?: InstallatiePartnerTeamgenoot;
        url?: string | null;
      };
      if (!res.ok) throw new Error(data.error || "Upload mislukt");
      if (data.teamgenoot) {
        setItems((list) =>
          list.map((t) => (t.id === id ? { ...t, ...data.teamgenoot } : t))
        );
      }
      const label =
        TEAM_DOC_FIELDS.find((d) => d.key === type)?.label || "Document";
      setOkMsg(`${label} geüpload`);
      if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload mislukt");
    } finally {
      setUploadBusy(null);
    }
  }

  async function resendInvite(id: string) {
    setInviteBusy(id);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, resend_invite: true }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Uitnodiging mislukt");
      if (data.invite_sent) {
        setOkMsg("Inlogmail opnieuw verstuurd");
        setItems((list) =>
          list.map((t) =>
            t.id === id
              ? {
                  ...t,
                  invite_sent_at: new Date().toISOString(),
                  portal_token: data.teamgenoot?.portal_token ?? t.portal_token,
                }
              : t
          )
        );
      } else {
        throw new Error(data.invite_error || "Mail versturen mislukt");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Uitnodiging mislukt");
    } finally {
      setInviteBusy(null);
    }
  }

  async function setActief(id: string, actief: boolean) {
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, actief }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bijwerken mislukt");
      setItems((list) =>
        list.map((t) => (t.id === id ? { ...t, actief } : t))
      );
      setOkMsg(actief ? "Weer actief" : "Gedeactiveerd");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bijwerken mislukt");
    }
  }

  async function remove(id: string, naamLabel: string) {
    if (!window.confirm(`“${naamLabel}” verwijderen uit je team?`)) return;
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      setItems((list) => list.filter((t) => t.id !== id));
      if (selectedId === id) setSelectedId(null);
      setOkMsg("Verwijderd");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verwijderen mislukt");
    }
  }

  const actief = items.filter((t) => t.actief !== false);
  const inactief = items.filter((t) => t.actief === false);
  const rows = [...actief, ...inactief];
  const selected =
    rows.find((t) => t.id === selectedId) ||
    items.find((t) => t.id === selectedId) ||
    null;

  function openMonteur(id: string) {
    const t = items.find((x) => x.id === id);
    if (!t) {
      if (adminBeoordeling) setSelectedId(id);
      return;
    }
    if (adminBeoordeling) {
      setSelectedId(id);
      setEditingId(null);
      return;
    }
    openEdit(t);
  }

  const editing = editingId
    ? items.find((t) => t.id === editingId) || null
    : null;

  if (adminBeoordeling && selected) {
    return (
      <div className={compact ? "space-y-3" : "space-y-5"}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Card className="gap-0 py-0">
          <CardContent className="p-4 sm:p-5">
            <MedewerkerInstallatiesPanel
              teamgenootId={selected.id}
              teamgenootNaam={selected.naam}
              teamgenootEmail={selected.email}
              teamgenootTelefoon={selected.telefoon}
              authorNaam={authorNaam}
              showProfile
              onBack={() => setSelectedId(null)}
            />
            <div className="mt-4 border-t border-line pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openEdit(selected)}
              >
                Gegevens bewerken (rol, schouw/installatie)
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Deep-link / trage load: id bekend, rij nog niet in lijst → toon detail toch
  if (adminBeoordeling && selectedId && !loading) {
    const fromList = items.find((t) => t.id === selectedId);
    if (!fromList) {
      return (
        <div className={compact ? "space-y-3" : "space-y-5"}>
          <Card className="gap-0 py-0">
            <CardContent className="p-4 sm:p-5">
              <MedewerkerInstallatiesPanel
                teamgenootId={selectedId}
                authorNaam={authorNaam}
                showProfile
                onBack={() => setSelectedId(null)}
              />
            </CardContent>
          </Card>
        </div>
      );
    }
  }

  if (editing) {
    return (
      <div className={compact ? "space-y-3" : "space-y-5"}>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {okMsg ? <Notice tone="ok">{okMsg}</Notice> : null}
        <Card className="gap-0 py-0">
          <CardHeader className="border-b border-line px-4 py-4 sm:px-5">
            <div>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="-ml-2 mb-2 text-muted"
                onClick={() => setEditingId(null)}
              >
                ← Terug naar team
              </Button>
            </div>
            <CardTitle className="font-display text-lg font-semibold text-ink">
              Teamlid · {editing.naam}
            </CardTitle>
            <CardDescription className="text-muted">
              Leeftijd en merkenervaring vult dit teamlid zelf in via Profiel.
              Documenten kun je hier uploaden.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
            <form
              onSubmit={(e) => void saveEdit(e)}
              className="grid gap-3 sm:grid-cols-2"
            >
              <div className="space-y-1.5">
                <Label htmlFor="tg-edit-naam">Naam *</Label>
                <Input
                  id="tg-edit-naam"
                  required
                  value={editNaam}
                  onChange={(e) => setEditNaam(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tg-edit-email">E-mail *</Label>
                <Input
                  id="tg-edit-email"
                  required
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="tg-edit-telefoon">Telefoon</Label>
                <Input
                  id="tg-edit-telefoon"
                  value={editTelefoon}
                  onChange={(e) => setEditTelefoon(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <MonteurProfielFields
                  value={editDraft}
                  onChange={setEditDraft}
                  disabled={saving}
                  mode="partner"
                />
              </div>
              <div className="sm:col-span-2 space-y-3 border-t border-line pt-4">
                <div>
                  <p className="text-sm font-semibold text-ink">Documenten</p>
                  <p className="mt-0.5 text-xs text-muted">
                    PDF of afbeelding, max. 20 MB. Verplicht voor een compleet
                    dossier: KvK, certificeringen en foto.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TEAM_DOC_FIELDS.map((doc) => {
                    const status = docStatus(editing, doc.key);
                    const hasFile = Boolean(status.path?.trim());
                    const busy = uploadBusy === doc.key;
                    return (
                      <div
                        key={doc.key}
                        className="rounded-lg border border-line bg-wash/60 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink">
                              {doc.label}
                              {doc.required ? (
                                <span className="text-muted"> *</span>
                              ) : null}
                            </p>
                            {hasFile ? (
                              <p className="mt-0.5 truncate text-xs text-green-dark">
                                {status.name || "Geüpload"}
                              </p>
                            ) : (
                              <p className="mt-0.5 text-xs text-muted">
                                Nog niet geüpload
                              </p>
                            )}
                            {doc.hint ? (
                              <p className="mt-1 text-[11px] text-muted">
                                {doc.hint}
                              </p>
                            ) : null}
                          </div>
                          <Badge
                            variant="secondary"
                            className={
                              hasFile
                                ? "bg-green-soft text-green-dark"
                                : "text-muted"
                            }
                          >
                            {hasFile ? "OK" : "Ontbreekt"}
                          </Badge>
                        </div>
                        <label className="mt-3 inline-flex cursor-pointer">
                          <span className="inline-flex h-7 items-center rounded-lg border border-border bg-background px-2.5 text-[0.8rem] font-medium hover:bg-wash">
                            {busy
                              ? "Uploaden…"
                              : hasFile
                                ? "Vervangen"
                                : "Uploaden"}
                          </span>
                          <input
                            type="file"
                            accept={doc.accept}
                            disabled={busy || saving || Boolean(uploadBusy)}
                            className="sr-only"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void uploadDoc(editing.id, doc.key, file);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={saving || Boolean(uploadBusy)}>
                  {saving ? "Opslaan…" : "Opslaan"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (showNieuw) {
    return (
      <NieuweMonteurPage
        portalToken={portalToken}
        onBack={() => setShowNieuw(false)}
        onCreated={(info) => {
          setError(null);
          if (info.inviteSent) {
            setOkMsg(
              `${info.naam} toegevoegd — inlogmail verstuurd naar ${info.email}`
            );
          } else {
            setOkMsg(
              `${info.naam} toegevoegd${
                info.inviteError
                  ? ` — mail mislukt: ${info.inviteError}`
                  : " — stuur de inlogmail opnieuw"
              }`
            );
          }
          void load();
        }}
      />
    );
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-5"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {!compact ? (
            <>
              <h2 className="font-display text-lg font-semibold text-ink">
                Team
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                Monteurs en beheerders · inlogmail bij toevoegen
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Teamleden
              </p>
              <p className="text-[12px] text-muted">
                {actief.length} actief
                {inactief.length > 0 ? ` · ${inactief.length} inactief` : ""}
                {adminBeoordeling
                  ? " · klik op een naam voor klussen"
                  : " · klik op een naam om te bewerken"}
              </p>
            </>
          )}
        </div>
        <Button
          type="button"
          size={compact ? "sm" : "default"}
          onClick={() => {
            setError(null);
            setShowNieuw(true);
          }}
          className="gap-1.5"
        >
          <Plus className="size-4" />
          Nieuwe monteur
        </Button>
      </div>

      {migrationHint ? (
        <Notice tone="warn" compact={compact}>
          {migrationHint}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" compact={compact}>
          {error}
        </Notice>
      ) : null}
      {okMsg ? (
        <Notice tone="ok" compact={compact}>
          {okMsg}
        </Notice>
      ) : null}

      {loading ? (
        <p
          className={[
            "text-center text-sm text-muted",
            compact ? "py-6" : "py-12",
          ].join(" ")}
        >
          Laden…
        </p>
      ) : items.length === 0 ? (
        <Card className="gap-0 py-0">
          <CardContent
            className={[
              "text-center",
              compact ? "px-4 py-6" : "px-5 py-10",
            ].join(" ")}
          >
            <p className="font-display text-base font-semibold text-ink">
              Nog geen teamleden
            </p>
            <p className="mt-1 text-sm text-muted">
              Klik op Nieuwe monteur om de eerste toe te voegen.
            </p>
            <Button
              type="button"
              className="mt-4 gap-1.5"
              onClick={() => setShowNieuw(true)}
            >
              <Plus className="size-4" />
              Nieuwe monteur
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden py-0 shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 w-[40%] px-3 text-[11px] font-medium text-muted">
                  Monteur
                </TableHead>
                <TableHead className="hidden h-9 px-3 text-[11px] font-medium text-muted md:table-cell">
                  Contact
                </TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-medium text-muted">
                  Status
                </TableHead>
                <TableHead className="h-9 w-[14rem] px-3 text-right text-[11px] font-medium text-muted">
                  Acties
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => {
                const inactive = t.actief === false;
                const regios = normalizeMonteurRegios(t.regios);
                const meta = [
                  t.rol === "beheerder" ? "Beheerder" : "Monteur",
                  t.kan_schouw ? "schouw" : null,
                  t.kan_installatie !== false ? "installatie" : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <TableRow
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    className={[
                      "cursor-pointer",
                      inactive ? "bg-wash/40 text-muted" : "",
                    ].join(" ")}
                    onClick={() => openMonteur(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openMonteur(t.id);
                      }
                    }}
                  >
                    <TableCell className="max-w-0 px-3 py-2.5 whitespace-normal">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openMonteur(t.id);
                        }}
                        className={[
                          "w-full text-left",
                          inactive ? "opacity-70" : "",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "block truncate text-sm font-medium text-green-deeper",
                            inactive ? "line-through" : "",
                          ].join(" ")}
                        >
                          {t.naam}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted">
                          {meta}
                          {regios.length > 0
                            ? ` · ${regios.slice(0, 2).join(", ")}${
                                regios.length > 2
                                  ? ` +${regios.length - 2}`
                                  : ""
                              }`
                            : ""}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted md:hidden">
                          {[t.email, t.telefoon].filter(Boolean).join(" · ") ||
                            "—"}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell className="hidden max-w-[12rem] px-3 py-2.5 md:table-cell">
                      <span className="block truncate text-sm text-muted">
                        {t.email || "—"}
                      </span>
                      {t.telefoon ? (
                        <span className="mt-0.5 block truncate text-[11px] text-muted">
                          {t.telefoon}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      {inactive ? (
                        <Badge variant="outline" className="text-muted">
                          Inactief
                        </Badge>
                      ) : t.invite_sent_at ? (
                        <Badge className="bg-green-soft text-green-dark">
                          Mail verstuurd
                        </Badge>
                      ) : t.email ? (
                        <Badge className="bg-[#FFF7F0] text-[#C45A12]">
                          Geen mail
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Actief</Badge>
                      )}
                    </TableCell>
                    <TableCell
                      className="w-[14rem] px-3 py-2.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="ml-auto grid w-[12.75rem] grid-cols-[4.75rem_6.25rem_1.75rem] items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          className="w-full justify-center"
                          onClick={() => openMonteur(t.id)}
                        >
                          {adminBeoordeling ? "Klussen" : "Profiel"}
                        </Button>
                        {!inactive && t.email ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="w-full justify-center"
                            disabled={inviteBusy === t.id}
                            onClick={() => void resendInvite(t.id)}
                          >
                            {inviteBusy === t.id
                              ? "Bezig…"
                              : t.invite_sent_at
                                ? "Mail opnieuw"
                                : "Stuur mail"}
                          </Button>
                        ) : (
                          <span aria-hidden className="block h-7" />
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                className="justify-self-end"
                                aria-label={`Meer acties voor ${t.naam}`}
                              />
                            }
                          >
                            <EllipsisIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-40">
                            {inactive ? (
                              <DropdownMenuItem
                                onClick={() => void setActief(t.id, true)}
                              >
                                Activeren
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => void setActief(t.id, false)}
                              >
                                Deactiveren
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => void remove(t.id, t.naam)}
                            >
                              Verwijderen
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {!adminBeoordeling ? (
        <PartnerKoppelsPanel
          portalToken={portalToken}
          teamgenoten={items}
          compact={compact}
        />
      ) : null}
    </div>
  );
}
