"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type {
  InstallatiePartnerTeamgenoot,
  Project,
  ProjectFoto,
  ProjectStatus,
} from "@/types/database";
import { cn } from "cn";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { OpleverFormulierModal } from "@/components/crm/OpleverFormulierModal";
import { SchouwFormulierModal } from "@/components/crm/SchouwFormulierModal";
import { adresRegel, formatDateTimeLongNl } from "@/lib/format";
import {
  FOTO_BATTERIJ_OMSCHRIJVING,
  FOTO_METERKAST_OMSCHRIJVING,
  isFotoBatterij,
  isFotoMeterkast,
  isOpleveringsrapport,
  isSchouwFormulier,
  isVideoInstallatie,
  VIDEO_INSTALLATIE_OMSCHRIJVING,
} from "@/lib/project-documenten";
import { validateInstallatieVideoDuration } from "@/lib/installatie-video";
import { medewerkerNaamVanProject } from "@/lib/project-medewerker";
import {
  formatProjectSchouwWeek,
  isSchouwdagDefinitief,
} from "@/lib/schouw-week";

type OrderDetail = Project & {
  leads?: Project["leads"];
};

/** Alleen wat de monteur mag zien — geen after-sale pipeline. */
const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "installatie_ingepland", label: "Installatie gepland" },
  { value: "installatie_voltooid", label: "Installatie voltooid" },
];

const VOLTOOID_STATUSES = new Set<string>([
  "installatie_voltooid",
  "review_gevraagd",
  "afgerond",
  "service",
]);

function installerStatusOf(order: {
  status: string;
  installatie_at?: string | null;
  installatie_voltooid_at?: string | null;
}): ProjectStatus {
  if (
    VOLTOOID_STATUSES.has(order.status) ||
    order.installatie_voltooid_at
  ) {
    return "installatie_voltooid";
  }
  if (order.status === "installatie_ingepland" || order.installatie_at) {
    return "installatie_ingepland";
  }
  return "installatie_ingepland";
}

function installerStatusLabel(status: ProjectStatus): string {
  return (
    STATUS_OPTIONS.find((o) => o.value === status)?.label ||
    "Installatie gepland"
  );
}

function statusBadgeVariant(
  status: ProjectStatus
): "default" | "secondary" | "outline" {
  if (status === "installatie_voltooid") return "outline";
  return "default";
}

const SECTION_TITLE =
  "text-[10px] font-semibold uppercase tracking-[0.08em] text-muted";

/** Knop die een verborgen file-input opent (shadcn Button i.p.v. label). */
function FileUploadButton({
  label,
  busyLabel = "Uploaden…",
  busy,
  accept = "image/*",
  multiple,
  capture,
  variant = "outline",
  className,
  onFiles,
}: {
  label: string;
  busyLabel?: string;
  busy: boolean;
  accept?: string;
  multiple?: boolean;
  capture?: "environment" | "user";
  variant?: "default" | "outline";
  className?: string;
  onFiles: (files: FileList) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size="lg"
        disabled={busy}
        className={cn("h-11 px-4", className)}
        onClick={() => ref.current?.click()}
      >
        {busy ? busyLabel : label}
      </Button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        capture={capture}
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFiles(e.target.files);
          }
          e.target.value = "";
        }}
      />
    </>
  );
}

export function InstallatieOrderDetailPage({
  apiToken: apiTokenProp,
}: {
  apiToken?: string;
} = {}) {
  const params = useParams<{
    token?: string;
    projectId: string;
  }>();
  const token = apiTokenProp || params.token || "session";
  const projectId = params.projectId;
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [offerte, setOfferte] = useState<{
    id: string;
    offerte_nummer: string;
    status: string;
    ondertekend_op: string | null;
  } | null>(null);
  const [fotos, setFotos] = useState<ProjectFoto[]>([]);
  const [teamgenoten, setTeamgenoten] = useState<
    InstallatiePartnerTeamgenoot[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [status, setStatus] = useState<ProjectStatus>("schouwdag_ingepland");
  const [schouwNotities, setSchouwNotities] = useState("");
  const [installatieNotities, setInstallatieNotities] = useState("");
  const [teamgenootId, setTeamgenootId] = useState("");
  const [opleverFormOpen, setOpleverFormOpen] = useState(false);
  const [schouwFormOpen, setSchouwFormOpen] = useState(false);

  const syncForm = useCallback((o: OrderDetail) => {
    setStatus(installerStatusOf(o));
    setSchouwNotities(o.schouw_notities || "");
    setInstallatieNotities(o.installatie_notities || "");
    const tg = o.installatie_teamgenoot;
    const tgOne = Array.isArray(tg) ? tg[0] : tg;
    setTeamgenootId(
      o.installatie_teamgenoot_id ||
        tgOne?.id ||
        ""
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/installatie/${token}/orders/${projectId}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Niet gevonden");
      const o = data.order as OrderDetail;
      setOrder(o);
      setOfferte(data.offerte || null);
      setFotos(data.fotos || []);
      setTeamgenoten(
        (data.teamgenoten || []) as InstallatiePartnerTeamgenoot[]
      );
      syncForm(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [token, projectId, syncForm]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  async function patchOrder(
    body: Record<string, unknown>,
    busyKey: string,
    ok: string
  ) {
    setBusy(busyKey);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie/${token}/orders/${projectId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      const o = data.order as OrderDetail;
      setOrder(o);
      syncForm(o);
      setOkMsg(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function saveStatus() {
    await patchOrder({ status }, "status", "Status opgeslagen.");
  }

  async function saveNotities() {
    await patchOrder(
      {
        schouw_notities: schouwNotities,
        installatie_notities: installatieNotities,
      },
      "notities",
      "Notities opgeslagen."
    );
  }

  async function saveMedewerker(id: string) {
    setTeamgenootId(id);
    await patchOrder(
      { installatie_teamgenoot_id: id || null },
      "medewerker",
      id ? "Medewerker gekoppeld." : "Medewerker ontkoppeld."
    );
  }

  async function uploadFotos(
    files: FileList | File[],
    omschrijving?: string | null
  ) {
    const list = Array.from(files);
    if (list.length === 0) return;
    if (omschrijving && isVideoInstallatie(omschrijving)) {
      const check = await validateInstallatieVideoDuration(list[0]);
      if (!check.ok) {
        setUploadError(check.error);
        return;
      }
    }
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of list) {
        const form = new FormData();
        form.append("file", file);
        if (omschrijving) form.append("omschrijving", omschrijving);
        if (omschrijving && isVideoInstallatie(omschrijving)) {
          form.append("allow_video", "1");
        }
        const res = await fetch(
          `/api/installatie/${token}/orders/${projectId}/fotos`,
          { method: "POST", body: form }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload mislukt");
        if (data.foto) setFotos((prev) => [...prev, data.foto]);
        if (data.project && typeof data.project === "object") {
          setOrder((prev) =>
            prev ? { ...prev, ...(data.project as Project) } : prev
          );
        }
      }
      setOkMsg(
        omschrijving
          ? `${omschrijving} geüpload.`
          : list.length === 1
            ? "Foto toegevoegd."
            : `${list.length} foto's toegevoegd.`
      );
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload mislukt");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-wash">
        <p className="text-sm text-muted">Order laden…</p>
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="min-h-screen bg-wash px-4 py-16">
        <div className="mx-auto max-w-3xl">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Link
            href={token === "session" ? "/installatie" : `/installatie/${token}`}
            className="mt-4 inline-block text-sm font-semibold text-green-dark hover:underline"
          >
            ← Terug naar orders
          </Link>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const lead = Array.isArray(order.leads) ? order.leads[0] : order.leads;
  const adres = lead ? adresRegel(lead) : "—";
  const mapsQuery = adres !== "—" ? adres : null;
  const shownStatus = installerStatusOf(order);

  return (
    <div className="min-h-screen bg-[#F7F9F7]">
      <header className="border-b border-line bg-white">
        <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-6">
          <Link
            href={token === "session" ? "/installatie" : `/installatie/${token}`}
            className="text-sm font-medium text-muted hover:text-ink"
          >
            ← Agenda
          </Link>
          <p className="mt-4 font-display text-[13px] font-semibold tracking-[0.04em] text-green-deeper">
            Batterij<span className="text-orange">concept</span>
            {order.project_nummer ? (
              <span className="ml-2 font-mono text-xs font-semibold tracking-normal text-muted">
                {order.project_nummer}
              </span>
            ) : null}
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            {lead?.naam || order.titel || "Order"}
          </h1>
          <div className="mt-2">
            <Badge variant={statusBadgeVariant(shownStatus)}>
              {installerStatusLabel(shownStatus)}
            </Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        {okMsg && (
          <Alert className="border-green/30 bg-green-soft text-green-dark">
            <AlertDescription className="text-green-dark">
              {okMsg}
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {order.installateur_notitie?.trim() ? (
          <Card className="bg-[#F4FBF7] ring-[#B7D9C4]">
            <CardHeader>
              <CardTitle className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0D5C32]">
                Notitie voor installateur
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {order.installateur_notitie.trim()}
              </p>
              {order.installateur_notitie_door?.trim() ? (
                <p className="text-[11px] text-muted">
                  — {order.installateur_notitie_door.trim()}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className={SECTION_TITLE}>
              Medewerker op dit project *
            </CardTitle>
            <CardDescription>
              Koppel wie de schouw/installatie doet — komt op beide formulieren.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {teamgenoten.length === 0 ? (
              <Alert>
                <AlertDescription>
                  Nog geen teamleden. Voeg ze toe onder{" "}
                  <Link
                    href={
                      token === "session"
                        ? "/installatie?tab=team"
                        : `/installatie/${token}?tab=team`
                    }
                    className="font-semibold text-green-deeper hover:underline"
                  >
                    Team
                  </Link>
                  .
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <NativeSelect
                  className="w-full flex-1"
                  value={teamgenootId}
                  disabled={busy === "medewerker"}
                  aria-invalid={!teamgenootId}
                  aria-label="Medewerker op dit project"
                  onChange={(e) => void saveMedewerker(e.target.value)}
                >
                  <NativeSelectOption value="">
                    Nog niet gekoppeld…
                  </NativeSelectOption>
                  {teamgenoten.map((t) => (
                    <NativeSelectOption key={t.id} value={t.id}>
                      {t.naam}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {busy === "medewerker" ? (
                  <span className="text-xs text-muted">Opslaan…</span>
                ) : null}
              </div>
            )}
            {!teamgenootId && teamgenoten.length > 0 ? (
              <p className="mt-2 text-xs font-medium text-destructive">
                Koppel eerst een medewerker vóór schouw- of opleverformulier.
              </p>
            ) : null}
            {order.monteur && !teamgenootId ? (
              <p className="mt-2 text-xs text-muted">
                Huidige naam op project: {order.monteur}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className={SECTION_TITLE}>Installatie status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <NativeSelect
                className="w-full flex-1"
                value={status}
                aria-label="Installatie status"
                onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              >
                {STATUS_OPTIONS.map((o) => (
                  <NativeSelectOption key={o.value} value={o.value}>
                    {o.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                type="button"
                size="lg"
                className="h-11 px-4"
                disabled={busy === "status"}
                onClick={() => void saveStatus()}
              >
                {busy === "status" ? "Opslaan…" : "Status opslaan"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {offerte ? (
          <Card>
            <CardHeader>
              <CardTitle className={SECTION_TITLE}>Getekende offerte</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-sm font-semibold text-ink">
                {offerte.offerte_nummer}
              </p>
              <a
                href={`/api/installatie/${token}/orders/${projectId}/offerte`}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "mt-3 h-11 px-4"
                )}
              >
                Download PDF
              </a>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className={SECTION_TITLE}>Schouw</CardTitle>
          </CardHeader>
          <CardContent>
            {formatProjectSchouwWeek(order) ? (
              <p className="text-lg font-semibold text-ink">
                {formatProjectSchouwWeek(order)}
                {order.schouw_at && isSchouwdagDefinitief(order)
                  ? ` · ${formatDateTimeLongNl(order.schouw_at)}`
                  : ""}
              </p>
            ) : (
              <p className="text-sm text-muted">Nog geen schouwweek.</p>
            )}

            <div className="mt-4 space-y-1.5">
              <Label htmlFor="schouw-notities">Schouw-notities</Label>
              <Textarea
                id="schouw-notities"
                value={schouwNotities}
                onChange={(e) => setSchouwNotities(e.target.value)}
                rows={3}
                placeholder="Notities over de schouw…"
              />
            </div>

            <div className="mt-4 space-y-4 border-t border-line pt-4">
              {(() => {
                const meterkast = [...fotos]
                  .filter((f) => isFotoMeterkast(f.omschrijving) && f.url)
                  .at(-1);
                const schouwDoc = [...fotos]
                  .filter((f) => isSchouwFormulier(f.omschrijving) && f.url)
                  .sort((a, b) =>
                    String(a.created_at || "").localeCompare(
                      String(b.created_at || "")
                    )
                  )
                  .at(-1);
                return (
                  <>
                    <div>
                      <p className={SECTION_TITLE}>Foto meterkast *</p>
                      {meterkast?.url ? (
                        <a
                          href={meterkast.url}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            buttonVariants({ variant: "outline", size: "lg" }),
                            "mt-2 h-11 px-4 text-green-dark"
                          )}
                        >
                          Foto meterkast bekijken
                        </a>
                      ) : (
                        <p className="mt-1 text-xs text-destructive">
                          Verplicht — maak een foto van de meterkast
                        </p>
                      )}
                      <div className="mt-2">
                        <FileUploadButton
                          label="Upload foto meterkast"
                          busy={uploading}
                          capture="environment"
                          onFiles={(files) =>
                            void uploadFotos(
                              [files[0]],
                              FOTO_METERKAST_OMSCHRIJVING
                            )
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <p className={SECTION_TITLE}>Schouwformulier *</p>
                      {schouwDoc?.url ? (
                        <div className="mt-2 space-y-2">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-green-dark">
                            <Badge className="bg-green-soft text-green-dark">
                              Ingevuld
                            </Badge>
                            Schouwformulier is ingevuld
                            {medewerkerNaamVanProject(order)
                              ? ` · ${medewerkerNaamVanProject(order)}`
                              : ""}
                          </p>
                          <a
                            href={schouwDoc.url}
                            target="_blank"
                            rel="noreferrer"
                            download={
                              schouwDoc.bestandsnaam || "Schouwformulier.pdf"
                            }
                            className={cn(
                              buttonVariants({
                                variant: "outline",
                                size: "lg",
                              }),
                              "h-11 px-4"
                            )}
                          >
                            Schouwformulier
                            {schouwDoc.bestandsnaam
                              ? ` · ${schouwDoc.bestandsnaam}`
                              : ""}
                          </a>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-muted">
                          Vul het schouwformulier in — uitvoerend monteur wordt
                          vastgelegd.
                        </p>
                      )}
                      <Button
                        type="button"
                        size="lg"
                        onClick={() => {
                          if (teamgenoten.length > 0 && !teamgenootId) {
                            setError(
                              "Koppel eerst een medewerker op dit project."
                            );
                            return;
                          }
                          setSchouwFormOpen(true);
                        }}
                        className="mt-3 h-11 w-full bg-[#0D9488] px-4 text-white hover:bg-[#0F766E] sm:w-auto"
                      >
                        {schouwDoc?.url
                          ? "Opnieuw schouwformulier"
                          : "Schouwformulier invullen"}
                      </Button>
                    </div>
                  </>
                );
              })()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className={SECTION_TITLE}>
              Foto&apos;s <Badge variant="secondary">{fotos.length}</Badge>
            </CardTitle>
            <CardDescription>
              Inclusief foto&apos;s van de adviseur. Maak een foto of kies uit
              je galerij.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {uploadError && (
              <Alert variant="destructive" className="mb-3">
                <AlertDescription>{uploadError}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <FileUploadButton
                label="Camera / foto maken"
                variant="default"
                busy={uploading}
                capture="environment"
                className="h-14 w-full font-bold"
                onFiles={(files) => void uploadFotos(files)}
              />
              <FileUploadButton
                label="Galerij (meerdere)"
                busy={uploading}
                multiple
                className="h-14 w-full"
                onFiles={(files) => void uploadFotos(files)}
              />
            </div>

            {fotos.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Nog geen foto&apos;s.</p>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {fotos.map((f) =>
                  f.url ? (
                    <a
                      key={f.id}
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block overflow-hidden rounded-lg border border-line"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={f.url}
                        alt={f.bestandsnaam || "Foto"}
                        className="aspect-square w-full object-cover"
                      />
                    </a>
                  ) : null
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className={SECTION_TITLE}>Installatie</CardTitle>
          </CardHeader>
          <CardContent>
            {order.installatie_at ? (
              <p className="text-lg font-semibold capitalize text-ink">
                {formatDateTimeLongNl(order.installatie_at)}
              </p>
            ) : (
              <p className="text-sm text-muted">Nog geen installatiedatum.</p>
            )}

            <div className="mt-4 space-y-1.5">
              <Label htmlFor="installatie-notities">
                Installatie-notities
              </Label>
              <Textarea
                id="installatie-notities"
                value={installatieNotities}
                onChange={(e) => setInstallatieNotities(e.target.value)}
                rows={3}
                placeholder="Notities over de installatie…"
              />
            </div>

            <Button
              type="button"
              size="lg"
              disabled={busy === "notities"}
              onClick={() => void saveNotities()}
              className="mt-4 h-11 w-full px-4 sm:w-auto"
            >
              {busy === "notities" ? "Opslaan…" : "Notities opslaan"}
            </Button>

            <div className="mt-6 space-y-4 border-t border-line pt-4">
              {(() => {
                const schouwDoc = [...fotos]
                  .filter((f) => isSchouwFormulier(f.omschrijving) && f.url)
                  .at(-1);
                const batterij = [...fotos]
                  .filter((f) => isFotoBatterij(f.omschrijving) && f.url)
                  .at(-1);
                const video = [...fotos]
                  .filter((f) => isVideoInstallatie(f.omschrijving) && f.url)
                  .at(-1);
                const oplever = [...fotos]
                  .filter((f) => isOpleveringsrapport(f.omschrijving) && f.url)
                  .at(-1);
                return (
                  <>
                    {schouwDoc?.url ? (
                      <div>
                        <p className={SECTION_TITLE}>Schouwformulier</p>
                        <a
                          href={schouwDoc.url}
                          target="_blank"
                          rel="noreferrer"
                          download={
                            schouwDoc.bestandsnaam || "Schouwformulier.pdf"
                          }
                          className={cn(
                            buttonVariants({ variant: "outline", size: "lg" }),
                            "mt-2 h-11 px-4"
                          )}
                        >
                          Schouwformulier downloaden
                        </a>
                      </div>
                    ) : null}

                    <div>
                      <p className={SECTION_TITLE}>Foto batterij *</p>
                      {batterij?.url ? (
                        <a
                          href={batterij.url}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            buttonVariants({ variant: "outline", size: "lg" }),
                            "mt-2 h-11 px-4 text-green-dark"
                          )}
                        >
                          Foto batterij bekijken
                        </a>
                      ) : (
                        <p className="mt-1 text-xs text-destructive">
                          Verplicht — maak een foto van de geïnstalleerde
                          batterij
                        </p>
                      )}
                      <div className="mt-2">
                        <FileUploadButton
                          label="Upload foto batterij"
                          busy={uploading}
                          capture="environment"
                          onFiles={(files) =>
                            void uploadFotos([files[0]], FOTO_BATTERIJ_OMSCHRIJVING)
                          }
                        />
                      </div>
                    </div>

                    <div>
                      <p className={SECTION_TITLE}>
                        Video van installatie (min. 30 sec, max. 1 min) *
                      </p>
                      {video?.url ? (
                        <div className="mt-2 space-y-2">
                          <video
                            src={video.url}
                            controls
                            playsInline
                            className="max-h-56 w-full rounded-md border border-line bg-black"
                          />
                          <a
                            href={video.url}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(
                              buttonVariants({
                                variant: "outline",
                                size: "lg",
                              }),
                              "h-11 px-4 text-green-dark"
                            )}
                          >
                            Video openen
                          </a>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-destructive">
                          Verplicht — film de installatie (30 seconden tot 1
                          minuut)
                        </p>
                      )}
                      <div className="mt-2">
                        <FileUploadButton
                          label="Upload installatievideo"
                          busy={uploading}
                          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                          capture="environment"
                          onFiles={(files) =>
                            void uploadFotos(
                              [files[0]],
                              VIDEO_INSTALLATIE_OMSCHRIJVING
                            )
                          }
                        />
                      </div>
                    </div>

                    <div>
                      <p className={SECTION_TITLE}>Opleverformulier *</p>
                      {oplever ? (
                        <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-green-dark">
                          <Badge className="bg-green-soft text-green-dark">
                            Ingevuld
                          </Badge>
                          Opleverformulier is ingevuld.
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-muted">
                          Vink de opleverpunten af en zet je handtekening.
                        </p>
                      )}
                      <Button
                        type="button"
                        size="lg"
                        onClick={() => {
                          if (teamgenoten.length > 0 && !teamgenootId) {
                            setError(
                              "Koppel eerst een medewerker op dit project."
                            );
                            return;
                          }
                          setOpleverFormOpen(true);
                        }}
                        className="mt-3 h-11 w-full px-4 sm:w-auto"
                      >
                        {oplever
                          ? "Opnieuw opleverformulier"
                          : "Opleverformulier invullen"}
                      </Button>
                    </div>
                  </>
                );
              })()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className={SECTION_TITLE}>Klantgegevens</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-semibold text-ink">
              {lead?.naam || "—"}
            </p>
            {lead?.lead_number && (
              <p className="font-mono text-xs text-muted">{lead.lead_number}</p>
            )}
            <div className="mt-3 space-y-1 text-sm text-ink">
              <p>{adres}</p>
              {lead?.telefoon && (
                <p>
                  <a href={`tel:${lead.telefoon}`} className="hover:text-green">
                    {lead.telefoon}
                  </a>
                </p>
              )}
              {lead?.email && (
                <p>
                  <a href={`mailto:${lead.email}`} className="hover:text-green">
                    {lead.email}
                  </a>
                </p>
              )}
            </div>
            {mapsQuery && (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <a
                  href={`https://waze.com/ul?q=${encodeURIComponent(mapsQuery)}&navigate=yes`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "h-11 bg-[#33CCFF] px-4 font-bold text-[#0A2A3A] hover:bg-[#33CCFF]/80"
                  )}
                >
                  Open in Waze
                </a>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsQuery)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "h-11 px-4 font-bold"
                  )}
                >
                  Open in Google Maps
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <SchouwFormulierModal
        open={schouwFormOpen}
        project={order}
        submitUrl={`/api/installatie/${token}/orders/${projectId}/schouw-formulier`}
        opnemerDefault={medewerkerNaamVanProject(order) || null}
        teamgenoten={teamgenoten}
        onClose={() => setSchouwFormOpen(false)}
        onCreated={() => {
          setOkMsg("Schouwformulier opgeslagen.");
          void load();
        }}
      />

      <OpleverFormulierModal
        open={opleverFormOpen}
        project={order}
        submitUrl={`/api/installatie/${token}/orders/${projectId}/oplever-formulier`}
        monteurDefault={medewerkerNaamVanProject(order) || null}
        teamgenoten={teamgenoten}
        onClose={() => setOpleverFormOpen(false)}
        onCreated={() => {
          setOkMsg("Opleverformulier opgeslagen · installatie afgerond.");
          void load();
        }}
      />
    </div>
  );
}
