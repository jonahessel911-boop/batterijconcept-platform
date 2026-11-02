"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useCrmSession } from "@/hooks/useCrmSession";
import { formatDateNl } from "@/lib/format";
import { leadStatusLabel, projectStatusLabel } from "@/lib/labels";
import { getSupabaseBrowser } from "@/lib/supabase";
import type { CallPopupRow } from "@/lib/call-popups";
import type { LeadStatus, ProjectStatus } from "@/types/database";

function formatDur(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("31") && d.length >= 11) return `0${d.slice(2)}`;
  return raw;
}

function isInboundPopup(p: CallPopupRow): boolean {
  const d = (p.direction || "").toLowerCase();
  return d === "in" || d === "inbound" || d === "incoming" || d === "inkomend";
}

function adresRegel(lead: NonNullable<CallPopupRow["lead"]>): string | null {
  const straat = [lead.straat, lead.huisnummer].filter(Boolean).join(" ");
  const plaats = [lead.postcode, lead.plaats].filter(Boolean).join(" ");
  const line = [straat, plaats].filter(Boolean).join(", ");
  return line || null;
}

function betaalLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw === "warmtefonds") return "Warmtefonds";
  if (raw === "eigen_middelen") return "Eigen middelen";
  return raw;
}

/**
 * After-call popup voor de medewerker op de gekoppelde Unite-lijn.
 *
 * Realtime pad: Unite-webhook → DB → Supabase realtime / korte poll.
 * Fallback (localhost zonder bereikbare webhook): CDR-sync ~elke 5s.
 * Werkt ook bij “Login als” (impersonatie).
 */
export function CallPopupHost({
  adviseurId,
}: {
  /** Optioneel: id uit CrmShell (impersonatie-proof). */
  adviseurId?: string | null;
} = {}) {
  const { session, ready } = useCrmSession();
  const [queue, setQueue] = useState<CallPopupRow[]>([]);
  const [notitie, setNotitie] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveId = adviseurId || session?.id || null;
  // CrmShell adviseurId = genoeg (ook vóór useCrmSession ready / bij impersonatie)
  const enabled = Boolean(effectiveId) && (ready || Boolean(adviseurId));

  const load = useCallback(
    async (opts?: { sync?: boolean }) => {
      if (!enabled) return;
      try {
        const q = opts?.sync ? "?sync=1" : "";
        const res = await fetch(`/api/call-popups${q}`, { cache: "no-store" });
        if (!res.ok) {
          if (res.status === 404) {
            console.warn(
              "[CallPopupHost] /api/call-popups ontbreekt — deploy popup/webhook-code"
            );
          }
          return;
        }
        const data = (await res.json()) as { popups?: CallPopupRow[] };
        setQueue(data.popups || []);
      } catch {
        /* stil */
      }
    },
    [enabled]
  );

  useEffect(() => {
    if (!enabled || !effectiveId) return;

    // Direct tonen wat er al open staat + 1× CDR-fallback
    void load({ sync: true });

    // Lichte poll (alleen open popups) — vangt webhook binnen ~1.5s
    const poll = window.setInterval(() => void load(), 1500);
    // CDR-fallback als Unite-webhook localhost/productie niet raakt
    const cdr = window.setInterval(() => void load({ sync: true }), 5000);

    // Instant: nieuwe/rij-update in call_popups
    let channel: ReturnType<ReturnType<typeof getSupabaseBrowser>["channel"]> | null =
      null;
    try {
      const sb = getSupabaseBrowser();
      channel = sb
        .channel(`call_popups:${effectiveId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "call_popups",
            filter: `adviseur_id=eq.${effectiveId}`,
          },
          () => {
            void load();
          }
        )
        .subscribe();
    } catch (e) {
      console.warn("[CallPopupHost] realtime niet beschikbaar:", e);
    }

    return () => {
      window.clearInterval(poll);
      window.clearInterval(cdr);
      if (channel) {
        void getSupabaseBrowser().removeChannel(channel);
      }
    };
  }, [enabled, effectiveId, load]);

  const current =
    queue.find((p) => p.phase === "ended" && isInboundPopup(p)) || null;

  useEffect(() => {
    setNotitie("");
    setError(null);
  }, [current?.id]);

  if (!enabled || !current) return null;

  const project = current.project;
  const lead = current.lead;
  const hasOrder = Boolean(project?.id || current.project_id);
  const titel =
    lead?.naam ||
    current.lead_naam ||
    project?.titel ||
    formatPhone(current.from_number);
  const statusLabel = project?.status
    ? projectStatusLabel[project.status as ProjectStatus] || project.status
    : lead?.status
      ? leadStatusLabel[lead.status as LeadStatus] || lead.status
      : null;
  const adres = lead ? adresRegel(lead) : null;

  async function save() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/call-popups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          action: "save",
          notitie,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setQueue((q) => q.filter((p) => p.id !== current.id));
      setNotitie("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (!current) return;
    setBusy(true);
    try {
      await fetch("/api/call-popups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: current.id, action: "dismiss" }),
      });
      setQueue((q) => q.filter((p) => p.id !== current.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/35 p-3 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="call-popup-title"
    >
      <div className="w-full max-w-lg border border-line bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-line bg-wash px-4 py-3 sm:px-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Inkomend gesprek · loggen
            </p>
            <h2
              id="call-popup-title"
              className="mt-0.5 text-base font-semibold text-ink"
            >
              {titel}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {hasOrder
                ? project?.project_nummer || current.project_nummer || "Order"
                : lead?.lead_number
                  ? `Lead ${lead.lead_number}`
                  : "Geen order"}
              {` · duur ${formatDur(current.duration_seconds)}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void dismiss()}
            disabled={busy}
            className="text-xs font-medium text-muted hover:text-ink"
          >
            Sluiten
          </button>
        </div>

        <div className="space-y-3 px-4 py-4 sm:px-5">
          {hasOrder && project ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <dt className="text-muted">Order</dt>
                <dd className="font-medium text-ink">
                  {project.project_nummer || current.project_nummer}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Status</dt>
                <dd className="font-medium text-ink">{statusLabel || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Betaling</dt>
                <dd className="font-medium text-ink">
                  {betaalLabel(project.betaalwijze) || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Gebeld van</dt>
                <dd className="font-medium text-ink">
                  {formatPhone(lead?.telefoon || current.from_number)}
                </dd>
              </div>
              {project.schouw_at ? (
                <div>
                  <dt className="text-muted">Schouw</dt>
                  <dd className="font-medium text-ink">
                    {formatDateNl(project.schouw_at)}
                  </dd>
                </div>
              ) : null}
              {project.installatie_at ? (
                <div>
                  <dt className="text-muted">Installatie</dt>
                  <dd className="font-medium text-ink">
                    {formatDateNl(project.installatie_at)}
                  </dd>
                </div>
              ) : null}
              {adres ? (
                <div className="col-span-2">
                  <dt className="text-muted">Adres</dt>
                  <dd className="font-medium text-ink">{adres}</dd>
                </div>
              ) : null}
            </dl>
          ) : lead ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <dt className="text-muted">Lead</dt>
                <dd className="font-medium text-ink">
                  {lead.lead_number || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Status</dt>
                <dd className="font-medium text-ink">{statusLabel || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Telefoon</dt>
                <dd className="font-medium text-ink">
                  {formatPhone(lead.telefoon || current.from_number)}
                </dd>
              </div>
              <div>
                <dt className="text-muted">E-mail</dt>
                <dd className="break-all font-medium text-ink">
                  {lead.email || "—"}
                </dd>
              </div>
              {adres ? (
                <div className="col-span-2">
                  <dt className="text-muted">Plaats</dt>
                  <dd className="font-medium text-ink">{adres}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="text-xs text-muted">
              Geen lead of order op {formatPhone(current.from_number)}. De
              notitie blijft bij dit gesprek.
            </p>
          )}

          <div className="flex flex-wrap gap-2 text-xs">
            {hasOrder && (project?.id || current.project_id) ? (
              <Link
                href={`/projecten/${project?.id || current.project_id}`}
                className="border border-line bg-white px-2.5 py-1.5 font-medium text-ink hover:bg-wash"
              >
                Open order
              </Link>
            ) : null}
            {!hasOrder && current.lead_id ? (
              <Link
                href={`/leads/${current.lead_id}`}
                className="border border-line bg-white px-2.5 py-1.5 font-medium text-ink hover:bg-wash"
              >
                Open lead
              </Link>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
              {hasOrder ? "Notitie op de order" : "Wat is besproken?"}
            </label>
            <textarea
              value={notitie}
              onChange={(e) => setNotitie(e.target.value)}
              rows={5}
              placeholder="Kort samenvatten wat je hebt besproken…"
              className="w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              autoFocus
            />
          </div>

          {error ? (
            <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => void dismiss()}
            disabled={busy}
            className="border border-line bg-white px-3 py-2 text-xs font-semibold text-muted hover:bg-wash"
          >
            Later
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !notitie.trim()}
            className="bg-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy
              ? "Opslaan…"
              : hasOrder
                ? "Opslaan op order"
                : "Opslaan op lead"}
          </button>
        </div>
      </div>
    </div>
  );
}
