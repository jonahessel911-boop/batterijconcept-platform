"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDateShort, formatEuro } from "@/lib/format";

type FactuurRow = {
  id: string;
  factuur_nummer: string;
  status: string;
  bedrag_ex_btw: number;
  bedrag_inc_btw: number;
  factuurdatum: string;
  goedgekeurd_op?: string | null;
  betaald_op?: string | null;
  notities?: string | null;
  omschrijving?: string | null;
  offerte_nummer?: string | null;
  project_nummer?: string | null;
};

function kindLabel(
  source: "adviseur" | "partner",
  nummer: string
): string {
  if (source === "partner") return "Installatie";
  if (/\/AANBETALING\//i.test(nummer)) return "Commissie A";
  if (/\/RESTBETALING\//i.test(nummer)) return "Commissie B";
  return "Commissie";
}

function statusLabel(status: string): string {
  if (status === "concept") return "Te versturen";
  if (status === "verzonden") return "Wacht op goedkeuring";
  if (status === "goedgekeurd") return "Te betalen";
  if (status === "betaald") return "Betaald";
  return status;
}

/**
 * Compacte uitbetalingen-UX op de partner-/adviseur-detailpagina.
 */
export function PartnerUitbetalingenBlock({
  kind,
  id,
  naam,
  onMessage,
}: {
  kind: "adviseur" | "partner";
  id: string;
  naam: string;
  onMessage: (msg: string, isError?: boolean) => void;
}) {
  const [facturen, setFacturen] = useState<FactuurRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [bedrag, setBedrag] = useState(kind === "adviseur" ? "250" : "");
  const [omschrijving, setOmschrijving] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url =
        kind === "adviseur"
          ? `/api/adviseurs/creditfacturen?adviseur_id=${encodeURIComponent(id)}`
          : `/api/partners/creditfacturen?partner_id=${encodeURIComponent(id)}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Laden mislukt"
        );
      }
      setFacturen(
        ((data as { facturen?: FactuurRow[] }).facturen || []).filter(
          (f) => f.status !== "geannuleerd"
        )
      );
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Laden mislukt", true);
    } finally {
      setLoading(false);
    }
    // onMessage bewust niet in deps — parent geeft inline callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useMemo(
    () =>
      facturen.filter(
        (f) =>
          f.status === "concept" ||
          f.status === "verzonden" ||
          f.status === "goedgekeurd"
      ),
    [facturen]
  );
  const openEuro = open.reduce((s, f) => s + Number(f.bedrag_ex_btw || 0), 0);
  const teVersturen = open.filter((f) => f.status === "concept").length;
  const wacht = open.filter((f) => f.status === "verzonden").length;
  const teBetalen = open.filter((f) => f.status === "goedgekeurd").length;

  const visible = open.length > 0 ? open : facturen.slice(0, 5);

  async function patchStatus(fid: string, status: "verzonden" | "betaald") {
    setBusyId(fid);
    try {
      const url =
        kind === "adviseur"
          ? "/api/adviseurs/creditfacturen"
          : "/api/partners/creditfacturen";
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: fid, status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Bijwerken mislukt"
        );
      }
      onMessage(
        status === "verzonden"
          ? `Factuur ${(json as { factuur?: { factuur_nummer?: string } }).factuur?.factuur_nummer || ""} verstuurd.`
          : `Factuur gemarkeerd als betaald.`
      );
      await load();
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Bijwerken mislukt", true);
    } finally {
      setBusyId(null);
    }
  }

  async function downloadPdf(fid: string, nummer: string) {
    setBusyId(`pdf-${fid}`);
    try {
      const url =
        kind === "adviseur"
          ? `/api/adviseurs/creditfacturen/${fid}/pdf`
          : `/api/partners/creditfacturen/${fid}/pdf`;
      const res = await fetch(url);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string }).error || "PDF download mislukt"
        );
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${nummer.replace(/\//g, "-")}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "PDF mislukt", true);
    } finally {
      setBusyId(null);
    }
  }

  async function createManual() {
    setCreating(true);
    try {
      const amount = Number(bedrag.replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Vul een geldig bedrag excl. btw in.");
      }
      const res =
        kind === "adviseur"
          ? await fetch("/api/adviseurs/creditfacturen", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                adviseur_id: id,
                bedrag_ex_btw: amount,
                omschrijving: omschrijving.trim() || undefined,
              }),
            })
          : await fetch("/api/partners/creditfacturen", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                partner_id: id,
                bedrag_ex_btw: amount,
                omschrijving: omschrijving.trim() || undefined,
              }),
            });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Aanmaken mislukt"
        );
      }
      const nummer =
        (json as { factuur?: { factuur_nummer?: string } }).factuur
          ?.factuur_nummer || "concept";
      onMessage(`Concept ${nummer} aangemaakt.`);
      setShowCreate(false);
      setOmschrijving("");
      await load();
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Aanmaken mislukt", true);
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="border border-line">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Uitbetalingen
          </p>
          <p className="mt-1 text-sm text-muted">
            {kind === "adviseur" ? "Commissie" : "Installatievergoedingen"} voor{" "}
            {naam}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
          >
            {showCreate ? "Sluiten" : "Nieuwe factuur"}
          </button>
          <Link
            href="/?tab=partners&partners=uitbetalingen"
            className="bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-deeper"
          >
            Alle uitbetalingen
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        {(
          [
            ["Te versturen", String(teVersturen)],
            ["Wacht", String(wacht)],
            ["Te betalen", String(teBetalen)],
            ["Open excl.", formatEuro(openEuro)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="bg-white px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              {label}
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
              {value}
            </p>
          </div>
        ))}
      </div>

      {showCreate ? (
        <div className="space-y-3 border-b border-line bg-wash/40 px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Bedrag excl. btw
              <input
                type="text"
                inputMode="decimal"
                value={bedrag}
                onChange={(e) => setBedrag(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
              />
            </label>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Omschrijving (optioneel)
              <input
                type="text"
                value={omschrijving}
                onChange={(e) => setOmschrijving(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={creating}
            onClick={() => void createManual()}
            className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-50"
          >
            {creating ? "Bezig…" : "Maak concept"}
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="px-4 py-6 text-sm text-muted">Laden…</p>
      ) : visible.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">
          Nog geen facturen. Maak er een of wacht tot ze automatisch ontstaan.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((f) => {
            const busy = busyId === f.id || busyId === `pdf-${f.id}`;
            const label = kindLabel(kind, f.factuur_nummer);
            return (
              <li
                key={f.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="border border-line bg-wash px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {label}
                    </span>
                    <span className="text-xs font-medium text-ink">
                      {f.factuur_nummer}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {statusLabel(f.status)}
                    {f.factuurdatum
                      ? ` · ${formatDateShort(f.factuurdatum)}`
                      : ""}
                    {f.project_nummer ? ` · ${f.project_nummer}` : ""}
                    {f.offerte_nummer ? ` · ${f.offerte_nummer}` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                  {formatEuro(Number(f.bedrag_ex_btw || 0))}
                </p>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void downloadPdf(f.id, f.factuur_nummer)}
                    className="border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-60"
                  >
                    PDF
                  </button>
                  {f.status === "concept" || f.status === "verzonden" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void patchStatus(f.id, "verzonden")}
                      className="bg-orange px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {f.status === "verzonden" ? "Opnieuw" : "Verstuur"}
                    </button>
                  ) : null}
                  {f.status === "goedgekeurd" || f.status === "verzonden" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void patchStatus(f.id, "betaald")}
                      className="bg-green px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      Betaald
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {open.length === 0 && facturen.length > 5 ? (
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          Toont recente facturen · zie alle uitbetalingen voor het volledige
          overzicht.
        </p>
      ) : null}
    </section>
  );
}
