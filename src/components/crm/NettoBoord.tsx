"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ, formatDateTimeNl, formatEuro } from "@/lib/format";
import {
  NETTO_AANBETALING_COMMISSIE,
  NETTO_ANNULERING_LABEL,
  NETTO_COMMISSIE_PCT,
  formatNettoPlanMoment,
  type NettoBoardRow,
  type NettoFase,
} from "@/lib/netto-boord";
import {
  NETTO_TIMELINE_KIND_LABEL,
  type NettoAdviseurActie,
  type NettoOpenTaak,
  type NettoSchouwDoc,
  type NettoTimelineItem,
  type NettoTimelineKind,
} from "@/lib/netto-boord-detail";
import { projectStatusLabel } from "@/lib/labels";

type Totals = {
  aantal: number;
  omzet_ex_btw: number;
  commissie_verwacht: number;
  commissie_verdiend: number;
  geannuleerd: number;
  netto: number;
  actief: number;
};

type AdviseurOpt = { id: string; naam: string };

type StatusFilter = "alles" | "actief" | "netto" | "geannuleerd";
type VormFilter = "" | "EM" | "WF";
type DrawerTab = "fases" | "tijdlijn" | "taken" | "acties";

function defaultDueDateLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatSchouwWeek(
  jaar: number | null | undefined,
  week: number | null | undefined
): string {
  if (!jaar || !week) return "";
  return `W${week} · ${jaar}`;
}

function formatSinds(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "d MMM yyyy", {
      locale: nl,
    });
  } catch {
    return "";
  }
}

function formatAfgerond(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return formatInTimeZone(d, AMSTERDAM_TZ, "d MMM yyyy", { locale: nl });
    }
    return formatInTimeZone(d, AMSTERDAM_TZ, "d MMM. HH:mm", { locale: nl });
  } catch {
    return "";
  }
}

function CheckIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function kindTone(kind: NettoTimelineKind): string {
  if (
    kind === "offerte_getekend" ||
    kind === "installatie" ||
    kind === "betaling" ||
    kind === "taak"
  ) {
    return "border-green";
  }
  if (kind === "factuur" || kind === "offerte" || kind === "document") {
    return "border-orange";
  }
  if (kind === "notitie" || kind === "service") return "border-orange";
  if (kind === "schouw" || kind === "afspraak") return "border-green";
  return "border-line";
}

function FaseCell({ fase }: { fase: NettoFase }) {
  if (!fase.applicable) {
    return <span className="text-muted/50">—</span>;
  }
  const ok = fase.done === fase.total && fase.total > 0;
  return (
    <span
      className={[
        "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
        ok ? "text-green" : "text-muted",
      ].join(" ")}
    >
      {ok ? (
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green text-white">
          <CheckIcon className="h-2.5 w-2.5" />
        </span>
      ) : null}
      {fase.done}/{fase.total}
    </span>
  );
}

function StatusBadge({ row }: { row: NettoBoardRow }) {
  if (row.board_status === "geannuleerd") {
    return (
      <div>
        <span className="inline-flex items-center rounded-full bg-[#f3e8e8] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#9b3b3b]">
          {NETTO_ANNULERING_LABEL}
        </span>
        {row.status_sinds ? (
          <p className="mt-1 text-[10px] text-muted">
            sinds {formatSinds(row.status_sinds)}
          </p>
        ) : null}
      </div>
    );
  }
  if (row.board_status === "netto") {
    return (
      <div>
        <span className="inline-flex items-center gap-1 rounded-full bg-green px-2.5 py-1 text-xs font-semibold text-white">
          <CheckIcon className="h-3 w-3" />
          Netto
        </span>
        {row.project_status ? (
          <p className="mt-1 text-[10px] text-muted">
            {projectStatusLabel[row.project_status] || row.project_status}
          </p>
        ) : row.status_sinds ? (
          <p className="mt-1 text-[10px] text-muted">
            sinds {formatSinds(row.status_sinds)}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div>
      <span className="inline-flex items-center rounded-full bg-[#eef1ef] px-2.5 py-1 text-xs font-semibold text-muted">
        Actief
      </span>
      {row.project_status ? (
        <p className="mt-1 max-w-[11rem] text-[10px] leading-snug text-muted">
          {projectStatusLabel[row.project_status] || row.project_status}
        </p>
      ) : row.status_sinds ? (
        <p className="mt-1 text-[10px] text-muted">
          sinds {formatSinds(row.status_sinds)}
        </p>
      ) : null}
    </div>
  );
}

function FaseTimeline({ fases }: { fases: NettoFase[] }) {
  const flat = fases.flatMap((f) =>
    f.applicable ? [{ fase: f, taken: f.taken }] : []
  );

  return (
    <div className="space-y-5">
      {fases.map((fase) => {
        if (!fase.applicable) return null;
        return (
          <div key={fase.key}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              Fase {fase.key.slice(1)} — {fase.label}
            </p>
            <ul className="relative space-y-1.5 pl-0">
              {fase.taken.map((taak, idx) => {
                const isLast =
                  idx === fase.taken.length - 1 &&
                  fase.key === flat[flat.length - 1]?.fase.key;
                return (
                  <li key={taak.id} className="relative flex gap-3">
                    <div className="relative flex w-5 shrink-0 flex-col items-center">
                      <span
                        className={[
                          "z-[1] mt-2.5 inline-flex h-5 w-5 items-center justify-center rounded-full border-2",
                          taak.done
                            ? "border-green bg-green text-white"
                            : "border-line bg-white text-transparent",
                        ].join(" ")}
                      >
                        {taak.done ? (
                          <CheckIcon className="h-2.5 w-2.5" />
                        ) : null}
                      </span>
                      {!isLast ? (
                        <span
                          className={[
                            "absolute top-7 bottom-[-0.4rem] w-0.5",
                            taak.done ? "bg-green" : "bg-line",
                          ].join(" ")}
                        />
                      ) : null}
                    </div>
                    <div
                      className={[
                        "min-w-0 flex-1 rounded-lg px-3 py-2.5",
                        taak.done ? "bg-[#f3faf7]" : "bg-wash",
                      ].join(" ")}
                    >
                      <p
                        className={[
                          "text-sm font-medium",
                          taak.done ? "text-muted line-through" : "text-ink",
                        ].join(" ")}
                      >
                        {taak.label}
                      </p>
                      {taak.done && taak.doneAt ? (
                        <p className="mt-0.5 text-[11px] text-muted">
                          Afgerond {formatAfgerond(taak.doneAt)}
                        </p>
                      ) : null}
                      {taak.detail ? (
                        <p className="mt-0.5 text-[11px] text-muted">
                          {taak.detail}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function DetailDrawer({
  row,
  onClose,
  onRefresh,
}: {
  row: NettoBoardRow;
  onClose: () => void;
  onRefresh?: () => void;
}) {
  const [tab, setTab] = useState<DrawerTab>("fases");
  const [timeline, setTimeline] = useState<NettoTimelineItem[]>([]);
  const [openTaken, setOpenTaken] = useState<NettoOpenTaak[]>([]);
  const [adviseurActies, setAdviseurActies] = useState<NettoAdviseurActie[]>(
    []
  );
  const [detailProjectId, setDetailProjectId] = useState<string | null>(
    row.project_id
  );
  const [schouwDocs, setSchouwDocs] = useState<NettoSchouwDoc[]>([]);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [actieNotitie, setActieNotitie] = useState("");
  const [actieDue, setActieDue] = useState(defaultDueDateLocal);
  const [actieSaving, setActieSaving] = useState(false);
  const [creatingCredit, setCreatingCredit] = useState(false);

  const loadDetail = useCallback(async () => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(
        `/api/netto-boord/detail?offerte_id=${encodeURIComponent(row.offerte_id)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Detail laden mislukt"
        );
      }
      setTimeline((data as { timeline: NettoTimelineItem[] }).timeline || []);
      setOpenTaken((data as { open_taken: NettoOpenTaak[] }).open_taken || []);
      setAdviseurActies(
        (data as { adviseur_acties: NettoAdviseurActie[] }).adviseur_acties ||
          []
      );
      setDetailProjectId(
        (data as { project_id?: string | null }).project_id ||
          row.project_id ||
          null
      );
      setSchouwDocs(
        (data as { schouw_docs: NettoSchouwDoc[] }).schouw_docs || []
      );
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setDetailLoading(false);
    }
  }, [row.offerte_id, row.project_id]);

  async function createBackofficeActie() {
    if (!actieNotitie.trim()) {
      setMsg("Vul een notitie / omschrijving in.");
      return;
    }
    if (!actieDue) {
      setMsg("Kies een deadline.");
      return;
    }
    setActieSaving(true);
    setMsg(null);
    try {
      const due = new Date(`${actieDue}T17:00:00`);
      const res = await fetch("/api/netto-boord/acties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: detailProjectId || undefined,
          offerte_id: row.offerte_id,
          notities: actieNotitie.trim(),
          due_at: due.toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Actie aanmaken mislukt"
        );
      }
      setActieNotitie("");
      setActieDue(defaultDueDateLocal());
      setMsg("Actie naar backoffice gestuurd.");
      await loadDetail();
      setTab("acties");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Actie aanmaken mislukt");
    } finally {
      setActieSaving(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  async function downloadFactuurPdf(
    factuurId: string,
    filename: string,
    itemId: string
  ) {
    setBusyId(itemId);
    setMsg(null);
    try {
      const res = await fetch(`/api/facturen/${factuurId}/pdf`);
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
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg("Factuur-PDF gedownload.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "PDF mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function downloadCreditPdf(creditId: string, nummer: string) {
    setBusyId(`cf-${creditId}`);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/adviseurs/creditfacturen/${creditId}/pdf`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || "Creditfactuur PDF mislukt"
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${nummer}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg("Creditfactuur gedownload.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "PDF mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function createCreditFromDeal() {
    if (row.geannuleerd) {
      setMsg("Geen commissiefactuur bij annulering.");
      return;
    }
    setCreatingCredit(true);
    setMsg(null);
    try {
      const res = await fetch("/api/adviseurs/creditfacturen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerte_id: row.offerte_id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Aanmaken mislukt"
        );
      }
      const nummer =
        (data as { factuur?: { factuur_nummer?: string } }).factuur
          ?.factuur_nummer || "concept";
      const created = (data as { created?: boolean }).created !== false;
      setMsg(
        created
          ? `Creditfactuur ${nummer} aangemaakt.`
          : `Creditfactuur ${nummer} bestond al.`
      );
      onRefresh?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Aanmaken mislukt");
    } finally {
      setCreatingCredit(false);
    }
  }

  const openActieCount = adviseurActies.filter((a) => a.status !== "done").length;
  const tabs: { id: DrawerTab; label: string; count?: number }[] = [
    { id: "fases", label: "Fases" },
    { id: "tijdlijn", label: "Tijdlijn", count: timeline.length || undefined },
    { id: "taken", label: "Taken", count: openTaken.length || undefined },
    {
      id: "acties",
      label: "Acties",
      count: openActieCount || adviseurActies.length || undefined,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Sluiten"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-line bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div className="min-w-0 pr-3">
            <h2 className="font-display text-xl font-semibold text-ink">
              {row.klant_naam}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {[row.plaats, formatEuro(row.bedrag_ex_btw), row.vorm]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {row.adviseur_naam ? (
              <p className="mt-1 text-xs text-muted">
                Adviseur: {row.adviseur_naam}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 border border-line px-2.5 py-1.5 text-sm text-muted hover:bg-wash"
          >
            ✕
          </button>
        </div>

        <div className="border-b border-line bg-[#FFF8E8] px-5 py-2 text-[11px] text-[#8a6a20]">
          Inzage + actie naar backoffice. Status/facturen bewerk je in Backoffice.
        </div>

        <div className="flex border-b border-line">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                "relative flex-1 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                tab === t.id
                  ? "text-green-deeper"
                  : "text-muted hover:text-ink",
              ].join(" ")}
            >
              {t.label}
              {typeof t.count === "number" ? (
                <span className="ml-1 tabular-nums text-[10px] opacity-70">
                  ({t.count})
                </span>
              ) : null}
              {tab === t.id ? (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-green" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mb-5 flex flex-wrap gap-2 text-xs">
            {row.offerte_nummer ? (
              <span className="rounded-full bg-wash px-2.5 py-1 text-muted">
                Offerte {row.offerte_nummer}
              </span>
            ) : null}
            {row.project_nummer && row.project_id ? (
              <Link
                href={`/projecten/${row.project_id}`}
                className="rounded-full bg-wash px-2.5 py-1 text-green-deeper hover:underline"
              >
                Project {row.project_nummer}
              </Link>
            ) : null}
            {row.project_status ? (
              <span className="rounded-full bg-[#E8F0F6] px-2.5 py-1 font-medium text-[#1A4A6E]">
                {projectStatusLabel[row.project_status] || row.project_status}
              </span>
            ) : null}
            {row.ondertekend_op ? (
              <span className="rounded-full bg-green-soft px-2.5 py-1 text-green-deeper">
                Getekend {formatSinds(row.ondertekend_op)}
              </span>
            ) : null}
            {row.aanbetaling_betaald ? (
              <span className="rounded-full bg-green-soft px-2.5 py-1 text-green-deeper">
                Aanbetaling betaald
                {row.factuur_betaald_at
                  ? ` · ${formatSinds(row.factuur_betaald_at)}`
                  : ""}
              </span>
            ) : row.factuur_verstuurd_at ? (
              <span className="rounded-full bg-[#FFF8D6] px-2.5 py-1 text-[#8A6D00]">
                Factuur verstuurd {formatSinds(row.factuur_verstuurd_at)}
              </span>
            ) : null}
          </div>

          <div className="mb-6 grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
            <div className="rounded-lg border border-line px-2 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">
                Schouwweek
              </p>
              <p className="mt-1 text-xs font-medium text-ink">
                {formatSchouwWeek(row.schouw_jaar, row.schouw_week) || "—"}
              </p>
            </div>
            <div className="rounded-lg border border-line px-2 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">
                Schouwdatum
              </p>
              <p className="mt-1 text-xs font-medium text-ink">
                {formatNettoPlanMoment(row.schouw_at) || "—"}
              </p>
            </div>
            <div className="rounded-lg border border-line px-2 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">
                Installatie
              </p>
              <p className="mt-1 text-xs font-medium text-ink">
                {formatNettoPlanMoment(row.installatie_at) || "—"}
              </p>
            </div>
            <div className="rounded-lg border border-line px-2 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">
                Factuur
              </p>
              <p className="mt-1 text-xs font-medium text-ink">
                {row.factuur_verstuurd_at
                  ? formatSinds(row.factuur_verstuurd_at)
                  : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-line px-2 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">
                Betaald
              </p>
              <p className="mt-1 text-xs font-medium text-ink">
                {row.factuur_betaald_at
                  ? formatSinds(row.factuur_betaald_at)
                  : "—"}
              </p>
            </div>
          </div>

          {msg ? (
            <p className="mb-3 border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
              {msg}
            </p>
          ) : null}

          {tab === "fases" ? (
            <>
              <FaseTimeline fases={row.fases} />

              {schouwDocs.length > 0 ? (
                <div className="mt-6 rounded-xl border border-line p-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Schouwformulier
                  </p>
                  <ul className="space-y-2">
                    {schouwDocs.map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">
                            {doc.bestandsnaam || "Schouw formulier"}
                          </p>
                          <p className="text-[11px] text-muted">
                            {formatSinds(doc.created_at)}
                          </p>
                        </div>
                        {doc.url ? (
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            download={doc.bestandsnaam || "schouwformulier"}
                            className="shrink-0 bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-deeper"
                          >
                            Download
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-6 rounded-xl border border-line p-4">
                <div className="mb-3 flex items-center gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    € Facturatie & commissie
                  </p>
                  {row.aanbetaling_betaald ? (
                    <span className="rounded-full bg-green-soft px-2 py-0.5 text-[10px] font-semibold text-green-deeper">
                      Aanbetaling betaald
                    </span>
                  ) : (
                    <span className="rounded-full bg-wash px-2 py-0.5 text-[10px] text-muted">
                      Wacht op aanbetaling
                    </span>
                  )}
                </div>

                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Omzet (ex btw)</dt>
                    <dd className="font-medium tabular-nums">
                      {formatEuro(row.bedrag_ex_btw)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">
                      Verwachte commissie (
                      {Math.round(NETTO_COMMISSIE_PCT * 100)}%)
                    </dt>
                    <dd className="font-semibold tabular-nums text-ink">
                      {formatEuro(row.commissie_verwacht)}
                    </dd>
                  </div>

                  <div className="border-t border-line pt-2">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">
                        <span className="font-medium text-ink">
                          Tranche A
                        </span>
                        <span className="block text-[11px]">
                          €{NETTO_AANBETALING_COMMISSIE} · bij aanbetaling
                        </span>
                      </dt>
                      <dd
                        className={[
                          "font-semibold tabular-nums",
                          row.commissie_tranche_a_triggered
                            ? "text-green"
                            : "text-muted",
                        ].join(" ")}
                      >
                        {row.commissie_tranche_a_triggered
                          ? formatEuro(row.commissie_tranche_a)
                          : "—"}
                      </dd>
                    </div>
                  </div>

                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">
                      <span className="font-medium text-ink">Tranche B</span>
                      <span className="block text-[11px]">
                        Restcommissie · restfactuur / installatie voltooid
                      </span>
                    </dt>
                    <dd
                      className={[
                        "font-semibold tabular-nums",
                        row.commissie_tranche_b_triggered
                          ? "text-green"
                          : "text-muted",
                      ].join(" ")}
                    >
                      {formatEuro(row.commissie_tranche_b)}
                    </dd>
                  </div>
                  {!row.commissie_tranche_b_triggered &&
                  row.commissie_tranche_b > 0 ? (
                    <p className="text-[11px] text-muted">
                      Nog niet getriggerd — na restfactuur betaald / installatie
                      voltooid.
                    </p>
                  ) : null}

                  {row.creditfactuur_id ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                      <div>
                        <p className="text-[11px] font-medium text-green-deeper">
                          Creditfactuur{" "}
                          {row.creditfactuur_nummer || "aangemaakt"}
                        </p>
                        <p className="text-[10px] text-muted">
                          Tranche A · uitbetaling eerstvolgende woensdag
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busyId === `cf-${row.creditfactuur_id}`}
                        onClick={() => {
                          if (!row.creditfactuur_id) return;
                          void downloadCreditPdf(
                            row.creditfactuur_id,
                            row.creditfactuur_nummer || "creditfactuur"
                          );
                        }}
                        className="shrink-0 bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-deeper disabled:opacity-60"
                      >
                        {busyId === `cf-${row.creditfactuur_id}`
                          ? "Downloaden…"
                          : "Download creditfactuur"}
                      </button>
                    </div>
                  ) : row.geannuleerd ? null : (
                    <div className="space-y-2 border-t border-line pt-3">
                      <p className="text-[11px] text-muted">
                        Nog geen verkopersfactuur. Maak tranche A (€
                        {NETTO_AANBETALING_COMMISSIE} excl.) nu aan, of wacht
                        tot het automatisch gebeurt.
                      </p>
                      <button
                        type="button"
                        disabled={creatingCredit || !row.adviseur_id}
                        onClick={() => void createCreditFromDeal()}
                        className="bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-deeper disabled:opacity-60"
                      >
                        {creatingCredit
                          ? "Bezig…"
                          : "Maak creditfactuur"}
                      </button>
                      {!row.adviseur_id ? (
                        <p className="text-[11px] text-[#C45A12]">
                          Deal heeft geen adviseur.
                        </p>
                      ) : null}
                    </div>
                  )}
                </dl>
              </div>
            </>
          ) : null}

          {tab === "tijdlijn" ? (
            detailLoading ? (
              <p className="py-10 text-center text-sm text-muted">
                Tijdlijn laden…
              </p>
            ) : detailError ? (
              <p className="py-6 text-center text-sm text-[#C45A12]">
                {detailError}
              </p>
            ) : timeline.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">
                Nog geen gebeurtenissen.
              </p>
            ) : (
              <ol className="relative space-y-0 border-l border-line pl-4">
                {timeline.map((item) => (
                  <li key={item.id} className="relative pb-4 last:pb-0">
                    <span
                      className={[
                        "absolute -left-[1.28rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 bg-white",
                        kindTone(item.kind),
                      ].join(" ")}
                    />
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {formatDateTimeNl(item.at)}
                      {" · "}
                      {NETTO_TIMELINE_KIND_LABEL[item.kind]}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-ink">
                      {item.titel}
                    </p>
                    {item.detail?.trim() ? (
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">
                        {item.detail}
                      </p>
                    ) : null}
                    {item.action ? (
                      <div className="mt-2">
                        {item.action.type === "factuur_pdf" ? (
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={() => {
                              const act = item.action;
                              if (!act || act.type !== "factuur_pdf") return;
                              void downloadFactuurPdf(
                                act.factuurId,
                                act.filename,
                                item.id
                              );
                            }}
                            className="inline-flex items-center bg-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
                          >
                            {busyId === item.id
                              ? "Downloaden…"
                              : item.action.label}
                          </button>
                        ) : item.action.type === "download_url" ? (
                          <a
                            href={item.action.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            download={item.action.filename}
                            className="inline-flex items-center bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-deeper"
                          >
                            {item.action.label}
                          </a>
                        ) : item.action.type === "offerte" ||
                          item.action.type === "link" ? (
                          <Link
                            href={item.action.href}
                            className="inline-flex items-center border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                          >
                            {item.action.label}
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )
          ) : null}

          {tab === "taken" ? (
            detailLoading ? (
              <p className="py-10 text-center text-sm text-muted">Taken laden…</p>
            ) : openTaken.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">
                Geen openstaande taken.
              </p>
            ) : (
              <div>
                <p className="mb-3 text-[11px] text-muted">
                  Alleen inzage — taken afvinken doe je in Backoffice.
                </p>
                <ul className="space-y-2">
                  {openTaken.map((t) => (
                    <li
                      key={t.id}
                      className="rounded-lg border border-line bg-wash px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-ink">{t.titel}</p>
                        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          {t.status}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted">
                        {[
                          t.afdeling,
                          t.verantwoordelijke_naam,
                          t.due_at ? `Due ${formatSinds(t.due_at)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {t.notities ? (
                        <p className="mt-1 text-xs text-muted">{t.notities}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}

          {tab === "acties" ? (
            detailLoading ? (
              <p className="py-10 text-center text-sm text-muted">
                Acties laden…
              </p>
            ) : (
              <div className="space-y-5">
                <div className="border border-line bg-[#F0FDFA] px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#115E59]">
                    Actie voor backoffice
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Zet een verzoek klaar met notitie en deadline. Backoffice ziet
                    dit onder Acties; jij krijgt een mail als het klaar is.
                  </p>
                  {!detailProjectId && !row.project_id ? (
                    <p className="mt-3 text-sm text-[#C45A12]">
                      Nog geen project — eerst kickoff afronden in backoffice.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <label className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
                        Notitie
                        <textarea
                          value={actieNotitie}
                          onChange={(e) => setActieNotitie(e.target.value)}
                          rows={3}
                          placeholder="Wat moet de backoffice doen?"
                          className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                        />
                      </label>
                      <label className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
                        Deadline
                        <input
                          type="date"
                          value={actieDue}
                          onChange={(e) => setActieDue(e.target.value)}
                          className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={actieSaving}
                        onClick={() => void createBackofficeActie()}
                        className="w-full bg-[#0D9488] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0F766E] disabled:opacity-50"
                      >
                        {actieSaving ? "Bezig…" : "Stuur naar backoffice"}
                      </button>
                    </div>
                  )}
                </div>

                {adviseurActies.length === 0 ? (
                  <p className="text-center text-sm text-muted">
                    Nog geen acties voor dit project.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {adviseurActies.map((a) => {
                      const done = a.status === "done";
                      return (
                        <li
                          key={a.id}
                          className={[
                            "border px-3 py-3",
                            done
                              ? "border-line bg-wash"
                              : "border-[#99F6E4] bg-[#F0FDFA]",
                          ].join(" ")}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-ink">
                              {a.titel}
                            </p>
                            <span
                              className={[
                                "shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                                done
                                  ? "bg-[#047857] text-white"
                                  : "bg-white text-[#0F766E]",
                              ].join(" ")}
                            >
                              {done ? "Voltooid" : "Open"}
                            </span>
                          </div>
                          {a.notities && a.notities !== a.titel ? (
                            <p className="mt-1 text-xs text-muted">
                              {a.notities}
                            </p>
                          ) : null}
                          <p className="mt-1 text-[11px] text-muted">
                            {[
                              a.due_at
                                ? `Deadline ${formatSinds(a.due_at)}`
                                : null,
                              a.aangemaakt_door_naam
                                ? `Van ${a.aangemaakt_door_naam}`
                                : null,
                              done && a.updated_at
                                ? `Afgerond ${formatSinds(a.updated_at)}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )
          ) : null}
        </div>

        <div className="border-t border-line bg-[#f7fbf9] px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Totale netto verwachte commissie
          </p>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-green-deeper">
            {row.geannuleerd
              ? formatEuro(0)
              : formatEuro(row.commissie_verwacht)}
          </p>
          {row.geannuleerd ? (
            <p className="mt-1 text-xs text-[#9b3b3b]">
              {NETTO_ANNULERING_LABEL} — geen commissie
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted">
              10% van {formatEuro(row.bedrag_ex_btw)} · A{" "}
              {row.commissie_tranche_a_triggered
                ? formatEuro(row.commissie_tranche_a)
                : "—"}{" "}
              + B{" "}
              {row.commissie_tranche_b_triggered
                ? formatEuro(row.commissie_tranche_b)
                : formatEuro(row.commissie_tranche_b) + " open"}{" "}
              · getriggerd {formatEuro(row.commissie_verdiend)}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

export function NettoBoord({
  adviseurId: adviseurIdProp,
  lockAdviseur = false,
}: {
  adviseurId?: string;
  lockAdviseur?: boolean;
}) {
  const [items, setItems] = useState<NettoBoardRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [adviseurs, setAdviseurs] = useState<AdviseurOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("alles");
  const [vorm, setVorm] = useState<VormFilter>("");
  const [adviseurId, setAdviseurId] = useState(adviseurIdProp || "");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setAdviseurId(adviseurIdProp || "");
  }, [adviseurIdProp]);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (adviseurId) sp.set("adviseur_id", adviseurId);
      if (status !== "alles") sp.set("status", status);
      if (vorm) sp.set("vorm", vorm);
      if (qDebounced) sp.set("q", qDebounced);
      const res = await fetch(`/api/netto-boord?${sp.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Laden mislukt"
        );
      }
      setItems((data as { items: NettoBoardRow[] }).items || []);
      setTotals((data as { totals: Totals }).totals || null);
      setAdviseurs((data as { adviseurs: AdviseurOpt[] }).adviseurs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [adviseurId, status, vorm, qDebounced]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => items.find((r) => r.id === selectedId) || null,
    [items, selectedId]
  );

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-end gap-3 border-b border-line bg-wash/40 px-4 py-3">
        <div className="min-w-[10rem] flex-1">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
            Zoeken
          </label>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Klant, plaats, offerte…"
            className="w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
          />
        </div>

        {!lockAdviseur ? (
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Adviseur
            </label>
            <select
              value={adviseurId}
              onChange={(e) => setAdviseurId(e.target.value)}
              className="border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
            >
              <option value="">Alle adviseurs</option>
              {adviseurs.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.naam}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
          >
            <option value="alles">Alles (zonder annulering)</option>
            <option value="actief">Actief</option>
            <option value="netto">Netto</option>
            <option value="geannuleerd">Annulering door klant</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
            Vorm
          </label>
          <select
            value={vorm}
            onChange={(e) => setVorm(e.target.value as VormFilter)}
            className="border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
          >
            <option value="">Alles</option>
            <option value="EM">EM</option>
            <option value="WF">WF</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          className="border border-line bg-white px-3 py-2 text-sm text-muted hover:bg-white hover:text-ink"
        >
          Vernieuwen
        </button>
      </div>

      {totals ? (
        <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-5">
          {[
            { label: "Deals", value: String(totals.aantal) },
            { label: "Omzet ex btw", value: formatEuro(totals.omzet_ex_btw) },
            {
              label: "Commissie verwacht",
              value: formatEuro(totals.commissie_verwacht),
              accent: true,
            },
            {
              label: "Getriggerd (€250)",
              value: formatEuro(totals.commissie_verdiend),
            },
            {
              label: "Annulering klant",
              value: String(totals.geannuleerd),
            },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                {kpi.label}
              </p>
              <p
                className={[
                  "mt-0.5 font-display text-lg font-semibold tabular-nums",
                  kpi.accent ? "text-green-deeper" : "text-ink",
                ].join(" ")}
              >
                {kpi.value}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="m-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="px-6 py-14 text-center text-sm text-muted">Laden…</p>
      ) : items.length === 0 ? (
        <p className="px-6 py-14 text-center text-sm text-muted">
          Geen sales gevonden voor deze filters.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1160px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-wash/80 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Klant</th>
                <th className="px-3 py-3 font-semibold">Vorm</th>
                <th className="px-3 py-3 font-semibold">Bedrag</th>
                <th className="px-2 py-3 text-center font-semibold">F1</th>
                <th className="px-2 py-3 text-center font-semibold">F2</th>
                <th className="px-2 py-3 text-center font-semibold">F3</th>
                <th className="px-2 py-3 text-center font-semibold">F4</th>
                <th className="px-3 py-3 font-semibold">Voortgang</th>
                <th className="px-3 py-3 font-semibold">Schouwweek</th>
                <th className="px-3 py-3 font-semibold">Schouwdatum</th>
                <th className="px-3 py-3 font-semibold">Installatie</th>
                <th className="px-3 py-3 font-semibold">Factuur</th>
                <th className="px-3 py-3 font-semibold">Betaald</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const f1 = row.fases.find((f) => f.key === "f1")!;
                const f2 = row.fases.find((f) => f.key === "f2")!;
                const f3 = row.fases.find((f) => f.key === "f3")!;
                const f4 = row.fases.find((f) => f.key === "f4")!;
                return (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    className={[
                      "cursor-pointer border-b border-line transition-colors hover:bg-green-soft/40",
                      selectedId === row.id ? "bg-green-soft/50" : "bg-white",
                      row.geannuleerd ? "opacity-70" : "",
                    ].join(" ")}
                  >
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-ink">
                        {row.klant_naam}
                      </p>
                      <p className="text-xs text-muted">
                        {row.plaats || "—"}
                        {row.adviseur_naam && !adviseurId
                          ? ` · ${row.adviseur_naam}`
                          : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex rounded-full bg-[#eef1ef] px-2.5 py-0.5 text-xs font-medium text-muted">
                        {row.vorm}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm font-medium tabular-nums text-ink">
                      {formatEuro(row.bedrag_ex_btw)}
                    </td>
                    <td className="px-2 py-3 text-center">
                      <FaseCell fase={f1} />
                    </td>
                    <td className="px-2 py-3 text-center">
                      <FaseCell fase={f2} />
                    </td>
                    <td className="px-2 py-3 text-center">
                      <FaseCell fase={f3} />
                    </td>
                    <td className="px-2 py-3 text-center">
                      <FaseCell fase={f4} />
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-xs font-medium tabular-nums text-ink">
                        {row.progress_done}/{row.progress_total} (
                        {row.progress_pct}%)
                      </p>
                      <div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-line">
                        <div
                          className="h-full rounded-full bg-green transition-[width]"
                          style={{ width: `${row.progress_pct}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-muted">
                      {formatSchouwWeek(row.schouw_jaar, row.schouw_week) ||
                        "—"}
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-muted">
                      {formatNettoPlanMoment(row.schouw_at) || "—"}
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-muted">
                      {formatNettoPlanMoment(row.installatie_at) || "—"}
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-muted">
                      {row.factuur_verstuurd_at
                        ? formatSinds(row.factuur_verstuurd_at)
                        : "—"}
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-muted">
                      {row.factuur_betaald_at ? (
                        <span className="inline-flex items-center gap-1 text-green">
                          <CheckIcon className="h-3 w-3" />
                          {formatSinds(row.factuur_betaald_at)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge row={row} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <DetailDrawer
          row={selected}
          onClose={() => setSelectedId(null)}
          onRefresh={() => void load()}
        />
      ) : null}
    </div>
  );
}
