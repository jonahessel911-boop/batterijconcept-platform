"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Factuur } from "@/types/database";
import { formatDateShort, formatEuro } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

function creditVanLabel(f: Factuur): string | null {
  if (!f.credit_van_factuur_id) return null;
  const raw = f.credit_van;
  const cv = Array.isArray(raw) ? raw[0] : raw;
  return cv?.factuur_nummer || null;
}

type Props = {
  projectId: string;
  leadEmail?: string | null;
};

export function ProjectFinancieelSection({ projectId, leadEmail }: Props) {
  const [open, setOpen] = useState(false);
  const [facturen, setFacturen] = useState<Factuur[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [bedrag, setBedrag] = useState("");
  const [omschrijving, setOmschrijving] = useState("");

  const [creditForId, setCreditForId] = useState<string | null>(null);
  const [creditBedrag, setCreditBedrag] = useState("");

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
      setFacturen((data.facturen as Factuur[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [open, load]);

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
          bedrag_inc_btw: creditBedrag || orig.bedrag_inc_btw,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Creditfactuur mislukt"
        );
      }
      setCreditForId(null);
      setCreditBedrag("");
      setMsg(
        `Creditfactuur aangemaakt bij ${orig.factuur_nummer}.`
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

  return (
    <section className="border border-line bg-white">
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

      {open ? (
        <div className="border-t border-line px-4 py-4">
          {error ? (
            <p className="mb-3 text-sm text-red-700">{error}</p>
          ) : null}
          {msg ? (
            <p className="mb-3 text-sm text-green-dark">{msg}</p>
          ) : null}

          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setShowCreate((v) => !v);
                setCreditForId(null);
              }}
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
                  placeholder="Bijv. Restfactuur installatie"
                  className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
                />
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
              {facturen.map((f) => {
                const isCredit = Boolean(f.credit_van_factuur_id);
                const van = creditVanLabel(f);
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
                          {isCredit ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#C45A12]">
                              Credit
                              {van ? ` (${van})` : ""}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {f.omschrijving || "—"} · {formatEuro(f.bedrag_inc_btw)}{" "}
                          · {formatDateShort(f.factuurdatum)}
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
                        {!isCredit &&
                          (f.status === "verzonden" ||
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
                              setCreditBedrag(
                                String(f.bedrag_inc_btw ?? "")
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
                          Op de PDF staat: CREDIT FACTUUR ({f.factuur_nummer}).
                          Bij versturen vervalt de openstaande oorspronkelijke
                          factuur — er hoeft niets meer te worden betaald.
                        </p>
                        <label className="block text-xs text-muted">
                          Bedrag incl. btw (€)
                          <input
                            type="text"
                            inputMode="decimal"
                            value={creditBedrag}
                            onChange={(e) => setCreditBedrag(e.target.value)}
                            className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
                          />
                        </label>
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
