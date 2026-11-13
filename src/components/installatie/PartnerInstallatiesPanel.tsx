"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Star } from "lucide-react";
import type { Project } from "@/types/database";
import { formatDateShort } from "@/lib/format";
import { resolveInstallateurStatusLabel } from "@/lib/labels";
import {
  isFotoBatterij,
  isFotoMeterkast,
  isOpleveringsrapport,
  isSchouwFormulier,
  isVideoInstallatie,
} from "@/lib/project-documenten";
import { AdresSatellietKaart } from "@/components/installatie/AdresSatellietKaart";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type InstallatieRow = Project & {
  leads?:
    | {
        naam?: string | null;
        plaats?: string | null;
        postcode?: string | null;
        straat?: string | null;
        huisnummer?: string | null;
        toevoeging?: string | null;
      }
    | {
        naam?: string | null;
        plaats?: string | null;
        postcode?: string | null;
        straat?: string | null;
        huisnummer?: string | null;
        toevoeging?: string | null;
      }[]
    | null;
  installatie_teamgenoot?:
    | { id?: string; naam?: string | null }
    | { id?: string; naam?: string | null }[]
    | null;
};

type FotoDoc = {
  id: string;
  omschrijving?: string | null;
  bestandsnaam?: string | null;
  url?: string | null;
  created_at?: string;
};

type Props = {
  portalToken: string;
  authorNaam?: string | null;
};

function leadOf(row: InstallatieRow) {
  return Array.isArray(row.leads) ? row.leads[0] : row.leads;
}

function monteurOf(row: InstallatieRow) {
  const tg = Array.isArray(row.installatie_teamgenoot)
    ? row.installatie_teamgenoot[0]
    : row.installatie_teamgenoot;
  return tg?.naam || row.monteur || "—";
}

function StarsInput({
  value,
  onPick,
  disabled,
  size = "md",
}: {
  value: number | null | undefined;
  onPick: (n: number) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const icon = size === "sm" ? "size-4" : "size-5";
  return (
    <div
      className="inline-flex items-center gap-0.5"
      role="group"
      aria-label="Sterren beoordeling"
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value != null && value >= n;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            title={`${n} ster${n === 1 ? "" : "ren"}`}
            onClick={(e) => {
              e.stopPropagation();
              onPick(n);
            }}
            className="rounded p-0.5 transition hover:scale-110 disabled:opacity-50"
          >
            <Star
              className={cn(
                icon,
                filled
                  ? "fill-[#F59E0B] text-[#F59E0B]"
                  : "fill-transparent text-[#D1D5DB] hover:text-[#F59E0B]"
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

function StarsDisplay({ value }: { value: number | null | undefined }) {
  if (value == null) {
    return <span className="text-xs text-muted">Nog niet beoordeeld</span>;
  }
  return (
    <div className="inline-flex items-center gap-0.5" aria-label={`${value} sterren`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            "size-3.5",
            value >= n
              ? "fill-[#F59E0B] text-[#F59E0B]"
              : "fill-transparent text-[#D1D5DB]"
          )}
        />
      ))}
    </div>
  );
}

function pickLatest(
  fotos: FotoDoc[],
  pred: (o: string | null | undefined) => boolean
): FotoDoc | null {
  const docs = fotos
    .filter((f) => pred(f.omschrijving) && f.url)
    .sort((a, b) =>
      String(a.created_at || "").localeCompare(String(b.created_at || ""))
    );
  return docs[docs.length - 1] || null;
}

function docBucket(fotos: FotoDoc[]) {
  return {
    schouw: pickLatest(fotos, isSchouwFormulier),
    meterkast: pickLatest(fotos, isFotoMeterkast),
    oplevering: pickLatest(fotos, isOpleveringsrapport),
    batterij: pickLatest(fotos, isFotoBatterij),
    video: pickLatest(fotos, isVideoInstallatie),
    overig: fotos.filter(
      (f) =>
        f.url &&
        !isSchouwFormulier(f.omschrijving) &&
        !isFotoMeterkast(f.omschrijving) &&
        !isOpleveringsrapport(f.omschrijving) &&
        !isFotoBatterij(f.omschrijving) &&
        !isVideoInstallatie(f.omschrijving)
    ),
  };
}

function isLikelyImage(doc: FotoDoc | null): boolean {
  if (!doc?.url) return false;
  const name = (doc.bestandsnaam || doc.url).toLowerCase();
  return /\.(jpe?g|png|gif|webp|heic|bmp)(\?|$)/i.test(name);
}

function isLikelyPdf(doc: FotoDoc | null): boolean {
  if (!doc?.url) return false;
  const name = (doc.bestandsnaam || doc.url).toLowerCase();
  return /\.pdf(\?|$)/i.test(name);
}

/** Compacte rij: mist = één regel; aanwezig = thumbnail/open + optioneel uitklappen. */
function DocRow({
  title,
  doc,
  kind,
  defaultOpen = false,
}: {
  title: string;
  doc: FotoDoc | null;
  kind: "image" | "pdf" | "video" | "file";
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen && Boolean(doc?.url));
  const has = Boolean(doc?.url);
  const canPreview =
    has && (kind === "image" || kind === "video" || kind === "pdf");

  return (
    <div className="border-b border-line last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-2.5">
        {has && kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={doc!.url!}
            alt=""
            className="size-10 shrink-0 rounded border border-line object-cover"
          />
        ) : (
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded border text-[10px] font-semibold uppercase",
              has
                ? "border-green/30 bg-green-soft text-green-dark"
                : "border-[#C45A12]/25 bg-[#FFF7F0] text-[#C45A12]"
            )}
          >
            {has ? "OK" : "—"}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{title}</p>
          <p className="truncate text-xs text-muted">
            {has
              ? doc?.bestandsnaam || "Beschikbaar"
              : "Nog niet geüpload"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!has ? (
            <Badge
              variant="secondary"
              className="rounded-full border border-[#C45A12]/30 bg-[#FFF0E6] text-[10px] text-[#C45A12]"
            >
              Mist
            </Badge>
          ) : (
            <>
              {canPreview ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="gap-1"
                  onClick={() => setOpen((v) => !v)}
                >
                  {open ? "Verberg" : "Bekijk"}
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform",
                      open && "rotate-180"
                    )}
                  />
                </Button>
              ) : null}
              <a
                href={doc!.url!}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "outline", size: "xs" })}
              >
                Openen
              </a>
            </>
          )}
        </div>
      </div>
      {open && has && kind === "video" ? (
        <video
          src={doc!.url!}
          controls
          playsInline
          className="max-h-72 w-full border-t border-line bg-black"
        />
      ) : null}
      {open && has && kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={doc!.url!}
          alt={title}
          className="max-h-72 w-full border-t border-line object-contain bg-wash"
        />
      ) : null}
      {open && has && kind === "pdf" ? (
        <iframe
          title={title}
          src={doc!.url!}
          className="h-80 w-full border-t border-line bg-wash"
        />
      ) : null}
    </div>
  );
}

export function PartnerInstallatiesPanel({
  portalToken,
  authorNaam,
}: Props) {
  const [items, setItems] = useState<InstallatieRow[]>([]);
  const [openBeoordeling, setOpenBeoordeling] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"alles" | "open">("alles");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetSterren, setSheetSterren] = useState<number | null>(null);
  const [sheetNotitie, setSheetNotitie] = useState("");
  const [fotos, setFotos] = useState<FotoDoc[]>([]);
  const [fotosLoading, setFotosLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/installaties`
      );
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        installaties?: InstallatieRow[];
        open_beoordeling?: number;
      } | null;
      if (!data || typeof data !== "object") {
        throw new Error(
          res.ok
            ? "Installaties-antwoord ongeldig"
            : `Installaties laden mislukt (${res.status})`
        );
      }
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setItems((data.installaties || []) as InstallatieRow[]);
      setOpenBeoordeling(Number(data.open_beoordeling) || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [portalToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => items.find((r) => r.id === selectedId) || null,
    [items, selectedId]
  );

  const visible = useMemo(() => {
    if (filter === "open") {
      return items.filter((r) => r.monteur_beoordeling_sterren == null);
    }
    return items;
  }, [items, filter]);

  useEffect(() => {
    if (!selectedId) {
      setFotos([]);
      return;
    }
    const row = items.find((r) => r.id === selectedId);
    if (row) {
      setSheetSterren(
        typeof row.monteur_beoordeling_sterren === "number"
          ? row.monteur_beoordeling_sterren
          : null
      );
      setSheetNotitie(row.monteur_beoordeling_notitie || "");
    }
    let cancelled = false;
    setFotosLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/installatie/${encodeURIComponent(portalToken)}/orders/${selectedId}/fotos`
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Documenten laden mislukt");
        setFotos((data.fotos || []) as FotoDoc[]);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Documenten laden mislukt");
          setFotos([]);
        }
      } finally {
        if (!cancelled) setFotosLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, portalToken, items]);

  async function saveBeoordeling(
    projectId: string,
    sterren: number,
    notitie?: string
  ) {
    setBusyId(projectId);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/orders/${projectId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            monteur_beoordeling_sterren: sterren,
            monteur_beoordeling_notitie: (notitie ?? "").trim() || null,
            monteur_beoordeling_door: authorNaam || null,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Beoordeling opslaan mislukt"
        );
      }
      const updated = (data as { order?: InstallatieRow }).order;
      setItems((list) =>
        list.map((r) =>
          r.id === projectId
            ? {
                ...r,
                ...(updated || {}),
                monteur_beoordeling_sterren: sterren,
                monteur_beoordeling_notitie: (notitie ?? "").trim() || null,
              }
            : r
        )
      );
      setOpenBeoordeling((n) => {
        const wasOpen = items.find(
          (r) => r.id === projectId && r.monteur_beoordeling_sterren == null
        );
        return wasOpen ? Math.max(0, n - 1) : n;
      });
      setOkMsg("Beoordeling opgeslagen");
      if (selectedId === projectId) {
        setSheetSterren(sterren);
        setSheetNotitie((notitie ?? "").trim());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusyId(null);
    }
  }

  function openDetail(id: string) {
    setSelectedId(id);
    setOkMsg(null);
  }

  const buckets = docBucket(fotos);

  if (selected) {
    const lead = leadOf(selected);
    const checklist = [
      { label: "Video", ok: Boolean(buckets.video?.url) },
      { label: "Schouwformulier", ok: Boolean(buckets.schouw?.url) },
      { label: "Foto meterkast", ok: Boolean(buckets.meterkast?.url) },
      { label: "Foto batterij", ok: Boolean(buckets.batterij?.url) },
      { label: "Opleverformulier", ok: Boolean(buckets.oplevering?.url) },
    ];
    const schouwKind: "pdf" | "image" | "file" = isLikelyPdf(buckets.schouw)
      ? "pdf"
      : isLikelyImage(buckets.schouw)
        ? "image"
        : "file";
    const opleverKind: "pdf" | "image" | "file" = isLikelyPdf(buckets.oplevering)
      ? "pdf"
      : isLikelyImage(buckets.oplevering)
        ? "image"
        : "file";

    return (
      <div className="fixed inset-0 z-[100] flex flex-col bg-[#F7F9F7]">
        <header className="shrink-0 border-b border-line bg-white">
          <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelectedId(null)}
              className="gap-1.5"
            >
              <ArrowLeft className="size-4" />
              Terug
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-lg font-semibold text-ink">
                Beoordeel installatie ·{" "}
                {selected.project_nummer || "project"}
              </h1>
              <p className="truncate text-xs text-muted">
                {lead?.naam || "Klant"} · monteur {monteurOf(selected)}
                {selected.installatie_at
                  ? ` · ${formatDateShort(selected.installatie_at)}`
                  : ""}
              </p>
            </div>
            <Badge
              variant="secondary"
              className="hidden shrink-0 rounded-full text-[11px] font-semibold sm:inline-flex"
            >
              {resolveInstallateurStatusLabel(selected.status, selected)}
            </Badge>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_24rem] sm:px-6">
            <div className="min-w-0 space-y-4 pb-6">
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {okMsg ? (
                <Alert className="border-green/30 bg-green-soft text-green-dark">
                  <AlertDescription>{okMsg}</AlertDescription>
                </Alert>
              ) : null}

              <section className="overflow-hidden rounded-xl border border-line bg-white shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Bewijs op deze klus
                  </p>
                  <p className="text-xs text-muted">
                    {checklist.filter((c) => c.ok).length}/{checklist.length}{" "}
                    aanwezig
                    {fotosLoading ? " · laden…" : ""}
                  </p>
                </div>
                <DocRow
                  title="Video installatie (30s–1m)"
                  doc={buckets.video}
                  kind="video"
                  defaultOpen
                />
                <DocRow
                  title="Foto meterkast"
                  doc={buckets.meterkast}
                  kind={isLikelyImage(buckets.meterkast) ? "image" : "file"}
                />
                <DocRow
                  title="Foto batterij"
                  doc={buckets.batterij}
                  kind={isLikelyImage(buckets.batterij) ? "image" : "file"}
                />
                <DocRow
                  title="Schouwformulier"
                  doc={buckets.schouw}
                  kind={schouwKind}
                />
                <DocRow
                  title="Opleverformulier"
                  doc={buckets.oplevering}
                  kind={opleverKind}
                />
                {buckets.overig.map((doc) => (
                  <DocRow
                    key={doc.id}
                    title={doc.omschrijving || "Document"}
                    doc={doc}
                    kind={
                      isLikelyImage(doc)
                        ? "image"
                        : isLikelyPdf(doc)
                          ? "pdf"
                          : "file"
                    }
                  />
                ))}
              </section>

              <section className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Locatie · 3D vanaf boven
                </p>
                <AdresSatellietKaart
                  key={selected.id}
                  adres={lead}
                  mapClassName="h-[min(42vh,360px)] w-full min-h-[240px]"
                />
              </section>

              {(selected.schouw_notities?.trim() ||
                selected.installatie_notities?.trim()) && (
                <section className="grid gap-3 sm:grid-cols-2">
                  {selected.schouw_notities?.trim() ? (
                    <div className="rounded-xl border border-line bg-white px-3 py-3 shadow-xs">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                        Schouw-notities
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink">
                        {selected.schouw_notities.trim()}
                      </p>
                    </div>
                  ) : null}
                  {selected.installatie_notities?.trim() ? (
                    <div className="rounded-xl border border-line bg-white px-3 py-3 shadow-xs">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                        Installatie-notities
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink">
                        {selected.installatie_notities.trim()}
                      </p>
                    </div>
                  ) : null}
                </section>
              )}
            </div>

            <aside className="space-y-4 lg:sticky lg:top-4">
              <section className="space-y-3 rounded-xl border border-line bg-white p-4 shadow-xs sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <Label>Beoordeling hele installatie</Label>
                  <StarsDisplay value={sheetSterren} />
                </div>
                <StarsInput
                  value={sheetSterren}
                  disabled={busyId === selected.id}
                  onPick={(n) => setSheetSterren(n)}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="beoordeling-notitie">Notitie</Label>
                  <Textarea
                    id="beoordeling-notitie"
                    rows={4}
                    value={sheetNotitie}
                    onChange={(e) => setSheetNotitie(e.target.value)}
                    placeholder="Feedback voor head installatie / monteur…"
                  />
                </div>
                <Button
                  type="button"
                  size="lg"
                  className="h-11 w-full"
                  disabled={
                    busyId === selected.id ||
                    sheetSterren == null ||
                    sheetSterren < 1
                  }
                  onClick={() =>
                    void saveBeoordeling(
                      selected.id,
                      sheetSterren ?? 0,
                      sheetNotitie
                    )
                  }
                >
                  {busyId === selected.id ? "Opslaan…" : "Beoordeling opslaan"}
                </Button>
              </section>

              <section className="space-y-2 rounded-xl border border-line bg-wash/40 p-4 shadow-xs sm:p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Klantvriendelijkheid (Batterijconcept)
                </p>
                {typeof selected.klantvriendelijkheid_sterren === "number" ? (
                  <>
                    <StarsDisplay
                      value={selected.klantvriendelijkheid_sterren}
                    />
                    {selected.klantvriendelijkheid_notitie?.trim() ? (
                      <p className="whitespace-pre-wrap text-sm text-ink">
                        {selected.klantvriendelijkheid_notitie.trim()}
                      </p>
                    ) : (
                      <p className="text-sm text-muted">Geen notitie.</p>
                    )}
                    {selected.klantvriendelijkheid_op ? (
                      <p className="text-[11px] text-muted">
                        {formatDateShort(selected.klantvriendelijkheid_op)}
                        {selected.klantvriendelijkheid_door
                          ? ` · ${selected.klantvriendelijkheid_door}`
                          : ""}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted">
                    Nog geen klantvriendelijkheid-score van Batterijconcept.
                  </p>
                )}
              </section>
            </aside>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-xs">
        <CardHeader className="border-b [.border-b]:pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="font-display text-lg">Installaties</CardTitle>
              <CardDescription>
                Klik een installatie voor full-screen beoordeling met 3D-kaart
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {openBeoordeling > 0 ? (
                <Badge
                  variant="secondary"
                  className="rounded-full border border-[#C45A12]/30 bg-[#FFF0E6] text-[11px] font-semibold text-[#C45A12]"
                >
                  {openBeoordeling} te beoordelen
                </Badge>
              ) : null}
              <Button
                type="button"
                variant={filter === "open" ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  setFilter((f) => (f === "open" ? "alles" : "open"))
                }
              >
                {filter === "open" ? "Toon alles" : "Alleen open beoordeling"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          {error ? (
            <div className="px-4 pt-4">
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          ) : null}
          {okMsg ? (
            <div className="px-4 pt-4">
              <Alert className="border-green/30 bg-green-soft text-green-dark">
                <AlertDescription>{okMsg}</AlertDescription>
              </Alert>
            </div>
          ) : null}

          {loading ? (
            <p className="px-5 py-10 text-center text-sm text-muted">Laden…</p>
          ) : visible.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              {filter === "open"
                ? "Geen openstaande beoordelingen."
                : "Nog geen installaties in dit portaal."}
            </p>
          ) : (
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 px-4 text-[11px] font-medium text-muted">
                    Project
                  </TableHead>
                  <TableHead className="h-9 px-3 text-[11px] font-medium text-muted">
                    Monteur
                  </TableHead>
                  <TableHead className="h-9 px-3 text-[11px] font-medium text-muted">
                    Datum
                  </TableHead>
                  <TableHead className="h-9 px-3 text-[11px] font-medium text-muted">
                    Status
                  </TableHead>
                  <TableHead className="h-9 px-3 text-[11px] font-medium text-muted">
                    Sterren
                  </TableHead>
                  <TableHead className="h-9 px-4 text-right text-[11px] font-medium text-muted">
                    Actie
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => {
                  const lead = leadOf(row);
                  const busy = busyId === row.id;
                  const needs = row.monteur_beoordeling_sterren == null;
                  return (
                    <TableRow
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer hover:bg-wash/70"
                      onClick={() => openDetail(row.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openDetail(row.id);
                        }
                      }}
                    >
                      <TableCell className="px-4 py-2.5 align-middle">
                        <p className="font-medium text-ink">
                          {row.project_nummer || row.id.slice(0, 8)}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {lead?.naam || "—"}
                          {lead?.plaats ? ` · ${lead.plaats}` : ""}
                        </p>
                      </TableCell>
                      <TableCell className="px-3 py-2.5 align-middle text-muted">
                        {monteurOf(row)}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 align-middle text-muted">
                        {row.installatie_at
                          ? formatDateShort(row.installatie_at)
                          : "—"}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 align-middle">
                        <Badge
                          variant="secondary"
                          className="rounded-full text-[11px] font-semibold"
                        >
                          {resolveInstallateurStatusLabel(row.status, row)}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="px-3 py-2.5 align-middle"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <StarsInput
                          value={row.monteur_beoordeling_sterren}
                          disabled={busy}
                          size="sm"
                          onPick={(n) =>
                            void saveBeoordeling(
                              row.id,
                              n,
                              row.monteur_beoordeling_notitie || ""
                            )
                          }
                        />
                      </TableCell>
                      <TableCell
                        className="px-4 py-2.5 text-right align-middle"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          type="button"
                          size="xs"
                          variant={needs ? "default" : "outline"}
                          onClick={() => openDetail(row.id)}
                        >
                          {needs ? "Beoordelen" : "Documentatie"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
