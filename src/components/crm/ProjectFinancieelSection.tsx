"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Factuur, OfferteRegel } from "@/types/database";
import { formatDateShort, formatEuro } from "@/lib/format";
import { FACTUUR_BETAALTERMIJN_DAGEN } from "@/lib/factuur-betaling";
import { primaireProductOmschrijving } from "@/lib/factuur-omschrijving";
import { StatusBadge } from "./StatusBadge";

function creditsForParent(all: Factuur[], parentId: string): Factuur[] {
  return all
    .filter((f) => f.credit_van_factuur_id === parentId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

type Props = {
  projectId: string;
  leadEmail?: string | null;
  defaultOpen?: boolean;
  /** Altijd open, zonder inklapbare header (voor tab Financieel). */
  alwaysOpen?: boolean;
  onFacturenChanged?: (facturen: Factuur[]) => void;
};

export function ProjectFinancieelSection({
  projectId,
  leadEmail,
  defaultOpen = false,
  alwaysOpen = false,
  onFacturenChanged,
}: Props) {
  const [open, setOpen] = useState(defaultOpen || alwaysOpen);
  const [facturen, setFacturen] = useState<Factuur[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [bedrag, setBedrag] = useState("");
  const [omschrijving, setOmschrijving] = useState("");
  const [betaaltermijnDagen, setBetaaltermijnDagen] = useState(
    String(FACTUUR_BETAALTERMIJN_DAGEN)
  );
  const [adresOpFactuur, setAdresOpFactuur] = useState(false);

  const [creditForId, setCreditForId] = useState<string | null>(null);

  const onFacturenChangedRef = useRef(onFacturenChanged);
  useEffect(() => {
    onFacturenChangedRef.current = onFacturenChanged;
  }, [onFacturenChanged]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${projectId}/facturen`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Facturen laden mislukt"
        );
      }
      const list = (data.facturen as Factuur[]) || [];
      setFacturen(list);
      onFacturenChangedRef.current?.(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open && !alwaysOpen) return;
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [open, alwaysOpen, load]);

  async function openCreateForm() {
    setShowCreate((v) => !v);
    setCreditForId(null);
    if (showCreate || omschrijving.trim()) return;
    try {
      const res = await fetch(`/api/projecten/${projectId}`);
      const data = await res.json().catch(() => ({}));
      const project = (data as { project?: { offerte_id?: string | null } })
        .project;
      const offerteId = project?.offerte_id;
      if (!offerteId) return;
      const oRes = await fetch(`/api/offertes/${offerteId}`);
      const oData = await oRes.json().catch(() => ({}));
      const offerte = (oData as { offerte?: { offerte_regels?: OfferteRegel[] } })
        .offerte;
      const label = primaireProductOmschrijving(offerte?.offerte_regels || []);
      if (label) setOmschrijving(label);
    } catch {
      /* ignore */
    }
  }

  async function createFactuur() {
    setBusy("create");
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/projecten/${projectId}/factuur`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bedrag_inc_btw: bedrag,
          omschrijving: omschrijving.trim() || undefined,
          betaaltermijn_dagen: betaaltermijnDagen.trim() || undefined,
          adres_gegevens_op_factuur: adresOpFactuur || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Aanmaken mislukt"
        );
      }
      setBedrag("");
      setOmschrijving("");
      setBetaaltermijnDagen(String(FACTUUR_BETAALTERMIJN_DAGEN));
      setAdresOpFactuur(false);
      setShowCreate(false);
      setMsg("Conceptfactuur aangemaakt.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aanmaken mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function createCredit(orig: Factuur) {
    setBusy(`credit-${orig.id}`);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/projecten/${projectId}/factuur`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credit_van_factuur_id: orig.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Creditfactuur mislukt"
        );
      }
      setCreditForId(null);
      setMsg(
        `Creditfactuur als concept aangemaakt bij ${orig.factuur_nummer}.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creditfactuur mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf(f: Factuur) {
    setBusy(`pdf-${f.id}`);
    setError(null);
    try {
      const res = await fetch(`/api/facturen/${f.id}/pdf`);
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
      const isCredit = Boolean(f.credit_van_factuur_id);
      a.download = `${isCredit ? "credit-" : ""}${f.factuur_nummer}${
        f.status === "concept" ? "-concept" : ""
      }.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function sendFactuur(f: Factuur) {
    const isCredit = Boolean(f.credit_van_factuur_id);
    const label = isCredit ? "creditfactuur" : "factuur";
    if (
      !confirm(
        `${label} ${f.factuur_nummer} mailen naar ${leadEmail || "de klant"}?`
      )
    ) {
      return;
    }
    setBusy(`send-${f.id}`);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/facturen/${f.id}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Verzenden mislukt"
        );
      }
      setMsg(
        isCredit
          ? "Creditfactuur verzonden. Oorspronkelijke openstaande factuur is vervallen."
          : "Factuur verzonden naar de klant."
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verzenden mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function markPaid(f: Factuur) {
    if (
      !confirm(
        `Factuur ${f.factuur_nummer} markeren als betaald?`
      )
    ) {
      return;
    }
    setBusy(`paid-${f.id}`);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/facturen/${f.id}`, {
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
          (data as { error?: string }).error || "Markeren mislukt"
        );
      }
      setMsg("Factuur gemarkeerd als betaald.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Markeren mislukt");
    } finally {
      setBusy(null);
    }
  }

  const canCredit = (f: Factuur) =>
    !f.credit_van_factuur_id &&
    (f.status === "verzonden" ||
      f.status === "betaald" ||
      f.status === "deels_betaald");

  const isOpen = alwaysOpen || open;

  return (
    <section className="border border-line bg-white">
      {alwaysOpen ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            Facturen
            {facturen.length > 0 ? ` (${facturen.length})` : ""}
          </h2>
          <p className="text-[11px] text-muted">
            Aanmaken, versturen, betaald markeren of creditnota maken
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-wash"
        >
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            Financiële gegevens
            {facturen.length > 0 ? ` (${facturen.length})` : ""}
          </h2>
          <span className="text-xs text-muted">{open ? "▲" : "▼"}</span>
        </button>
      )}

      {isOpen ? (
        <div className={alwaysOpen ? "px-4 py-4" : "border-t border-line px-4 py-4"}>
          {error ? (
            <p className="mb-3 text-sm text-red-700">{error}</p>
          ) : null}
          {msg ? (
            <p className="mb-3 text-sm text-green-dark">{msg}</p>
          ) : null}

          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void openCreateForm()}
              className="bg-orange px-3 py-2 text-xs font-semibold text-white hover:bg-[#e0651c]"
            >
              + Factuur
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
            >
              {loading ? "Laden…" : "Vernieuwen"}
            </button>
          </div>

          {showCreate ? (
            <div className="mb-4 space-y-2 border border-line bg-wash px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Nieuwe factuur
              </p>
              <label className="block text-xs text-muted">
                Bedrag incl. btw (€)
                <input
                  type="text"
                  inputMode="decimal"
                  value={bedrag}
                  onChange={(e) => setBedrag(e.target.value)}
                  placeholder="0,00"
                  className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
                />
              </label>
              <label className="block text-xs text-muted">
                Omschrijving
                <input
                  type="text"
                  value={omschrijving}
                  onChange={(e) => setOmschrijving(e.target.value)}
                  placeholder="Standaard: productnaam van de offerte"
                  className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
                />
              </label>
              <label className="block text-xs text-muted">
                Betaaltermijn (dagen)
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={365}
                  value={betaaltermijnDagen}
                  onChange={(e) => setBetaaltermijnDagen(e.target.value)}
                  placeholder={String(FACTUUR_BETAALTERMIJN_DAGEN)}
                  className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
                />
              </label>
              <p className="text-[11px] text-muted">
                Bepaalt de vervaldatum op de factuur (standaard{" "}
                {FACTUUR_BETAALTERMIJN_DAGEN} dagen).
              </p>
              <label className="flex cursor-pointer items-start gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={adresOpFactuur}
                  onChange={(e) => setAdresOpFactuur(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-semibold">Adres gegevens op factuur</span>
                  <span className="mt-0.5 block text-muted">
                    Daltonlaan 500, 3584 BK Utrecht als bedrijfsadres op de
                    PDF
                  </span>
                </span>
              </label>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy === "create" || !bedrag.trim()}
                  onClick={() => void createFactuur()}
                  className="bg-green px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy === "create" ? "Bezig…" : "Concept aanmaken"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-white"
                >
                  Annuleren
                </button>
              </div>
            </div>
          ) : null}

          {loading && facturen.length === 0 ? (
            <p className="text-sm text-muted">Facturen laden…</p>
          ) : facturen.length === 0 ? (
            <p className="text-sm text-muted">Nog geen facturen voor dit project.</p>
          ) : (
            <ul className="divide-y divide-line border border-line">
              {facturen
                .filter((f) => !f.credit_van_factuur_id)
                .map((f) => {
                const childCredits = creditsForParent(facturen, f.id);
                const rowBusy = busy?.endsWith(f.id);
                return (
                  <li key={f.id} className="px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/facturen/${f.id}`}
                            className="text-sm font-semibold text-green-dark hover:underline"
                          >
                            {f.factuur_nummer}
                          </Link>
                          <StatusBadge kind="factuur" value={f.status} />
                          {childCredits.length > 0 ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#C45A12]">
                              Creditfactuur
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {f.omschrijving || "—"} ·{" "}
                          {formatEuro(Number(f.bedrag_inc_btw) || 0)} ·{" "}
                          {formatDateShort(f.factuurdatum)}
                          {f.status === "betaald" && f.betaald_op
                            ? ` · Betaald ${formatDateShort(f.betaald_op)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={Boolean(rowBusy)}
                          onClick={() => void downloadPdf(f)}
                          className="border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
                        >
                          PDF
                        </button>
                        {(f.status === "concept" ||
                          f.status === "verzonden") && (
                          <button
                            type="button"
                            disabled={Boolean(rowBusy) || !leadEmail}
                            title={
                              leadEmail
                                ? undefined
                                : "Lead heeft geen e-mail"
                            }
                            onClick={() => void sendFactuur(f)}
                            className="border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
                          >
                            Versturen
                          </button>
                        )}
                        {(f.status === "verzonden" ||
                          f.status === "deels_betaald") && (
                          <button
                            type="button"
                            disabled={Boolean(rowBusy)}
                            onClick={() => void markPaid(f)}
                            className="border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
                          >
                            Betaald
                          </button>
                        )}
                        {canCredit(f) ? (
                          <button
                            type="button"
                            disabled={Boolean(rowBusy)}
                            onClick={() => {
                              setCreditForId(
                                creditForId === f.id ? null : f.id
                              );
                              setShowCreate(false);
                            }}
                            className="border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
                          >
                            Credit
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {creditForId === f.id ? (
                      <div className="mt-3 space-y-2 border border-line bg-wash px-3 py-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Creditfactuur bij {f.factuur_nummer}
                        </p>
                        <p className="text-xs text-muted">
                          Concept voor hetzelfde bedrag (
                          {formatEuro(f.bedrag_inc_btw)}). Blijft onder deze
                          factuur staan. Bij versturen vervalt de openstaande
                          oorspronkelijke factuur.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy === `credit-${f.id}`}
                            onClick={() => void createCredit(f)}
                            className="bg-green px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                          >
                            {busy === `credit-${f.id}`
                              ? "Bezig…"
                              : "Creditconcept maken"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setCreditForId(null)}
                            className="border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-white"
                          >
                            Annuleren
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {childCredits.length > 0 ? (
                      <ul className="mt-3 space-y-2 border-l-2 border-[#C45A12]/40 pl-3">
                        {childCredits.map((c) => {
                          const cBusy = busy?.endsWith(c.id);
                          return (
                            <li
                              key={c.id}
                              className="flex flex-wrap items-start justify-between gap-2 bg-wash/50 px-2.5 py-2"
                            >
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[10px] font-bold uppercase tracking-wide text-[#C45A12]">
                                    Creditfactuur
                                  </span>
                                  <Link
                                    href={`/facturen/${f.id}`}
                                    className="font-mono text-xs font-semibold text-green-dark hover:underline"
                                  >
                                    {c.factuur_nummer}
                                  </Link>
                                  <StatusBadge kind="factuur" value={c.status} />
                                </div>
                                <p className="mt-0.5 text-xs text-muted">
                                  {formatEuro(
                                    -Math.abs(Number(c.bedrag_inc_btw) || 0)
                                  )}{" "}
                                  · {formatDateShort(c.factuurdatum)}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  disabled={Boolean(cBusy)}
                                  onClick={() => void downloadPdf(c)}
                                  className="border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
                                >
                                  PDF
                                </button>
                                {(c.status === "concept" ||
                                  c.status === "verzonden") && (
                                  <button
                                    type="button"
                                    disabled={Boolean(cBusy) || !leadEmail}
                                    onClick={() => void sendFactuur(c)}
                                    className="border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
                                  >
                                    Versturen
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
