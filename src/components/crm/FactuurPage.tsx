"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { Factuur, Lead, Offerte, Project } from "@/types/database";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import { formatDateShort, formatDateTimeNl, formatEuro } from "@/lib/format";
import {
  FACTUUR_BETAALTERMIJN_DAGEN,
  factuurBetaaltermijnDagen,
  factuurIsOverdue,
} from "@/lib/factuur-betaling";
import { StatusBadge } from "./StatusBadge";
import { Breadcrumb, DetailShell, NotFoundState, TerugButton } from "./DetailChrome";

type FactuurLead = Pick<
  Lead,
  | "naam"
  | "email"
  | "telefoon"
  | "lead_number"
  | "straat"
  | "huisnummer"
  | "toevoeging"
  | "postcode"
  | "plaats"
>;

const COMPANY = {
  naam: "BatterijConcept",
  adres: "Daltonlaan 500",
  postcodePlaats: "3584 BK Utrecht",
  kvk: "42141855",
  iban: "NL48 BUNQ 2209 5579 33",
  email: "info@batterijconcept.nl",
  telefoon: "085 800 1645",
  website: "Batterijconcept.nl",
};

function klantAdres(lead: FactuurLead | null | undefined): string[] {
  if (!lead) return [];
  const lines: string[] = [];
  const straat = [lead.straat, lead.huisnummer, lead.toevoeging]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (straat) lines.push(straat);
  const plaats = [lead.postcode, lead.plaats].filter(Boolean).join(" ").trim();
  if (plaats) lines.push(plaats);
  return lines;
}

export function FactuurPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [factuur, setFactuur] = useState<Factuur | null>(null);
  const [lead, setLead] = useState<FactuurLead | null>(null);
  const [offerte, setOfferte] = useState<Offerte | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<
    "pdf" | "send" | "paid" | "delete" | "save" | "credit" | null
  >(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [betaaldOp, setBetaaldOp] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [editBedrag, setEditBedrag] = useState("");
  const [editOmschrijving, setEditOmschrijving] = useState("");
  const [editBetaaltermijn, setEditBetaaltermijn] = useState(
    String(FACTUUR_BETAALTERMIJN_DAGEN)
  );
  const [showCredit, setShowCredit] = useState(false);
  const [credits, setCredits] = useState<Factuur[]>([]);
  const [creditBusy, setCreditBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);

    if (!hasSupabaseConfig()) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      const sb = getSupabaseBrowser();
      const { data, error: err } = await sb
        .from("facturen")
        .select(
          "*, leads(naam, email, telefoon, lead_number, straat, huisnummer, toevoeging, postcode, plaats)"
        )
        .eq("id", id)
        .single();

      if (err || !data) {
        setNotFound(true);
      } else {
        const fac = data as Factuur;

        // Creditfacturen openen via de oorspronkelijke factuur
        if (fac.credit_van_factuur_id) {
          router.replace(`/facturen/${fac.credit_van_factuur_id}`);
          return;
        }

        const leadData = (fac.leads as FactuurLead | null) || null;
        setLead(leadData);

        const { data: creditRows } = await sb
          .from("facturen")
          .select(
            "id, factuur_nummer, status, bedrag_inc_btw, btw_bedrag, bedrag_ex_btw, factuurdatum, omschrijving, created_at, credit_van_factuur_id"
          )
          .eq("credit_van_factuur_id", fac.id)
          .order("created_at", { ascending: true });

        setCredits((creditRows || []) as Factuur[]);
        setFactuur(fac);
        setEditBedrag(
          Number(fac.bedrag_inc_btw).toLocaleString("nl-NL", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        );
        setEditOmschrijving(fac.omschrijving || "");
        setEditBetaaltermijn(
          String(
            factuurBetaaltermijnDagen({
              factuurdatum: fac.factuurdatum,
              vervaldatum: fac.vervaldatum,
            })
          )
        );
        if (fac.betaald_op) {
          setBetaaldOp(fac.betaald_op.slice(0, 10));
        }

        const [o, p] = await Promise.all([
          fac.offerte_id
            ? sb.from("offertes").select("*").eq("id", fac.offerte_id).single()
            : Promise.resolve({ data: null }),
          fac.project_id
            ? sb.from("projecten").select("*").eq("id", fac.project_id).single()
            : Promise.resolve({ data: null }),
        ]);

        setOfferte((o.data as Offerte) || null);
        setProject((p.data as Project) || null);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  async function saveConcept() {
    if (!factuur || factuur.status !== "concept") return;
    setBusy("save");
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/facturen/${factuur.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bedrag_inc_btw: editBedrag,
          omschrijving: editOmschrijving.trim() || null,
          betaaltermijn_dagen: editBetaaltermijn.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      const updated = data.factuur as Factuur;
      setFactuur(updated);
      setEditBedrag(
        Number(updated.bedrag_inc_btw).toLocaleString("nl-NL", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      );
      setEditOmschrijving(updated.omschrijving || "");
      setEditBetaaltermijn(
        String(
          factuurBetaaltermijnDagen({
            factuurdatum: updated.factuurdatum,
            vervaldatum: updated.vervaldatum,
          })
        )
      );
      setMsg("Concept bijgewerkt.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf() {
    if (!factuur) return;
    setBusy("pdf");
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/facturen/${factuur.id}/pdf`);
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
      a.download = `${factuur.factuur_nummer}${
        factuur.status === "concept" ? "-concept" : ""
      }.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg("PDF gedownload.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function sendToKlant() {
    if (!factuur) return;
    if (
      !confirm(
        `Factuur ${factuur.factuur_nummer} mailen naar ${
          lead?.email || factuur.leads?.email || "de klant"
        }?`
      )
    ) {
      return;
    }
    setBusy("send");
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/facturen/${factuur.id}/pdf`, {
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
      if (data.factuur) setFactuur(data.factuur as Factuur);
      else await load();
      setMsg("Factuur is gemaild naar de klant.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verzenden mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function markAsPaid() {
    if (!factuur) return;
    if (
      !confirm(
        `Factuur ${factuur.factuur_nummer} markeren als betaald op ${betaaldOp}?`
      )
    ) {
      return;
    }
    setBusy("paid");
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/facturen/${factuur.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "betaald", betaald_op: betaaldOp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Markeren als betaald mislukt"
        );
      }
      if (data.factuur) setFactuur(data.factuur as Factuur);
      else await load();
      setMsg("Factuur gemarkeerd als betaald.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Markeren mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function removeFactuur() {
    if (!factuur) return;
    if (
      !confirm(
        `Factuur ${factuur.factuur_nummer} definitief verwijderen?\n\nDit kan niet ongedaan worden.`
      )
    ) {
      return;
    }
    setBusy("delete");
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/facturen/${factuur.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Verwijderen mislukt"
        );
      }
      router.push("/?tab=facturen");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
      setBusy(null);
    }
  }

  async function createCredit() {
    if (!factuur) return;
    setBusy("credit");
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/facturen/${factuur.id}/credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Creditfactuur mislukt"
        );
      }
      const created = data.factuur as Factuur;
      setShowCredit(false);
      setMsg(
        `Creditfactuur ${created.factuur_nummer} aangemaakt — staat hieronder.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creditfactuur mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function downloadCreditPdf(credit: Factuur) {
    setCreditBusy(`pdf:${credit.id}`);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/facturen/${credit.id}/pdf`);
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
      a.download = `credit-${credit.factuur_nummer}${
        credit.status === "concept" ? "-concept" : ""
      }.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg(`Creditfactuur ${credit.factuur_nummer} gedownload.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF mislukt");
    } finally {
      setCreditBusy(null);
    }
  }

  async function sendCredit(credit: Factuur) {
    if (
      !confirm(
        `Creditfactuur ${credit.factuur_nummer} mailen naar ${
          lead?.email || factuur?.leads?.email || "de klant"
        }?`
      )
    ) {
      return;
    }
    setCreditBusy(`send:${credit.id}`);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/facturen/${credit.id}/pdf`, {
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
      setMsg(`Creditfactuur ${credit.factuur_nummer} is gemaild.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verzenden mislukt");
    } finally {
      setCreditBusy(null);
    }
  }

  if (loading) {
    return (
      <DetailShell activeTab="facturen">
        <p className="py-20 text-center text-sm text-muted">Factuur laden…</p>
      </DetailShell>
    );
  }

  if (notFound || !factuur) {
    return (
      <NotFoundState
        title="Factuur niet gevonden"
        backHref="/?tab=facturen"
        backLabel="Terug naar facturen"
        activeTab="facturen"
      />
    );
  }

  const isDraft = factuur.status === "concept";
  const isPaid = factuur.status === "betaald";
  const overdue = factuurIsOverdue(factuur);
  const creditVanRaw = factuur.credit_van;
  const creditVan = Array.isArray(creditVanRaw)
    ? creditVanRaw[0]
    : creditVanRaw;
  const isCredit = Boolean(factuur.credit_van_factuur_id);
  const creditSign = isCredit ? -1 : 1;
  const displayEx = creditSign * Math.abs(Number(factuur.bedrag_ex_btw) || 0);
  const displayBtw = creditSign * Math.abs(Number(factuur.btw_bedrag) || 0);
  const displayInc = creditSign * Math.abs(Number(factuur.bedrag_inc_btw) || 0);
  const canCredit =
    !isCredit &&
    (factuur.status === "verzonden" ||
      factuur.status === "betaald" ||
      factuur.status === "deels_betaald");
  const klantNaam = lead?.naam || factuur.leads?.naam || "Klant";
  const klantEmail = lead?.email || factuur.leads?.email || null;
  const adresLines = klantAdres(lead);
  const regelOmschrijving =
    factuur.omschrijving ||
    (isCredit
      ? `Creditfactuur${
          creditVan?.factuur_nummer ? ` bij ${creditVan.factuur_nummer}` : ""
        }`
      : "Factuur");

  return (
    <DetailShell onRefresh={load} loading={loading} activeTab="facturen">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <TerugButton fallbackHref="/?tab=facturen" />
        <Breadcrumb
          items={[
            { label: "Facturen", href: "/?tab=facturen" },
            { label: factuur.factuur_nummer },
          ]}
        />
      </div>

      {msg ? (
        <div className="mb-4 border border-green/30 bg-green-soft px-4 py-2.5 text-sm text-green-dark">
          {msg}
        </div>
      ) : null}
      {error ? (
        <div className="mb-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-2.5 text-sm text-[#C45A12]">
          {error}
        </div>
      ) : null}

      {/* Actiebalk */}
      <div className="mb-4 flex flex-wrap items-center gap-2 border border-line bg-white px-4 py-3">
        <StatusBadge kind="factuur" value={factuur.status} />
        {overdue ? (
          <span className="text-[11px] font-semibold text-[#C45A12]">
            Verlopen
          </span>
        ) : null}
        {isPaid && factuur.betaald_op ? (
          <span className="text-[11px] font-medium text-green-deeper">
            Betaald {formatDateShort(factuur.betaald_op)}
          </span>
        ) : null}

        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void downloadPdf()}
            className="border border-line bg-white px-3.5 py-2 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50"
          >
            {busy === "pdf" ? "PDF laden…" : "PDF"}
          </button>
          <button
            type="button"
            disabled={busy !== null || !klantEmail}
            onClick={() => void sendToKlant()}
            className="bg-orange px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50"
            title={
              klantEmail ? `Mail naar ${klantEmail}` : "Lead heeft geen e-mail"
            }
          >
            {busy === "send"
              ? "Verzenden…"
              : isDraft
                ? "Verstuur"
                : "Opnieuw versturen"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void removeFactuur()}
            className="border border-[#D32F2F]/35 bg-white px-3.5 py-2 text-sm font-semibold text-[#B71C1C] hover:bg-[#FFEBEE] disabled:opacity-50"
          >
            {busy === "delete" ? "…" : "Verwijderen"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        {/* Factuurdocument */}
        <article className="border border-line bg-white shadow-[0_1px_0_rgba(0,0,0,0.03)]">
          <div className="border-b border-line px-5 py-6 sm:px-8 sm:py-8">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <p className="font-display text-xl font-semibold tracking-tight text-green-deeper">
                  {COMPANY.naam}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {COMPANY.adres}
                  <br />
                  {COMPANY.postcodePlaats}
                  <br />
                  KvK {COMPANY.kvk}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                  {isCredit ? "Creditfactuur" : "Factuur"}
                </p>
                <p className="mt-1 font-mono text-sm font-semibold text-green-dark">
                  {factuur.factuur_nummer}
                </p>
                {isDraft ? (
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Concept — nog niet verzonden
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Factuur aan
                </p>
                <p className="mt-2 text-base font-semibold text-ink">
                  {klantNaam}
                </p>
                {adresLines.map((line) => (
                  <p key={line} className="text-sm text-muted">
                    {line}
                  </p>
                ))}
                {klantEmail ? (
                  <p className="mt-1 text-sm text-muted">{klantEmail}</p>
                ) : null}
                {lead?.telefoon ? (
                  <p className="text-sm text-muted">{lead.telefoon}</p>
                ) : null}
              </div>
              <div className="sm:text-right">
                <dl className="inline-grid grid-cols-[auto_auto] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted">Factuurdatum</dt>
                  <dd className="font-medium text-ink">
                    {formatDateShort(factuur.factuurdatum)}
                  </dd>
                  <dt className="text-muted">Vervaldatum</dt>
                  <dd
                    className={[
                      "font-medium",
                      overdue ? "text-[#C45A12]" : "text-ink",
                    ].join(" ")}
                  >
                    {formatDateShort(factuur.vervaldatum)}
                    {overdue ? " · Verlopen" : ""}
                  </dd>
                  {isPaid && factuur.betaald_op ? (
                    <>
                      <dt className="text-muted">Betaald op</dt>
                      <dd className="font-medium text-green-deeper">
                        {formatDateShort(factuur.betaald_op)}
                      </dd>
                    </>
                  ) : null}
                  {offerte?.offerte_nummer ? (
                    <>
                      <dt className="text-muted">Offerte</dt>
                      <dd className="font-medium text-ink">
                        {offerte.offerte_nummer}
                      </dd>
                    </>
                  ) : null}
                </dl>
              </div>
            </div>
          </div>

          {/* Regels */}
          <div className="overflow-x-auto px-5 py-2 sm:px-8">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                  <th className="py-3 pr-4 font-semibold">Omschrijving</th>
                  <th className="py-3 pr-4 text-right font-semibold">
                    Excl. btw
                  </th>
                  <th className="py-3 pr-4 text-right font-semibold">Btw</th>
                  <th className="py-3 text-right font-semibold">Incl. btw</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line">
                  <td className="py-4 pr-4 align-top">
                    <p className="font-medium text-ink">{regelOmschrijving}</p>
                    {isCredit && creditVan?.factuur_nummer ? (
                      <p className="mt-1 text-xs text-muted">
                        Bij factuur{" "}
                        <Link
                          href={`/facturen/${creditVan.id}`}
                          className="text-green-deeper hover:underline"
                        >
                          {creditVan.factuur_nummer}
                        </Link>
                      </p>
                    ) : null}
                  </td>
                  <td className="py-4 pr-4 text-right tabular-nums text-ink">
                    {formatEuro(displayEx)}
                  </td>
                  <td className="py-4 pr-4 text-right tabular-nums text-ink">
                    {formatEuro(displayBtw)}
                  </td>
                  <td className="py-4 text-right tabular-nums font-medium text-ink">
                    {formatEuro(displayInc)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex justify-end px-5 pb-2 sm:px-8">
            <dl className="w-full max-w-xs space-y-2 border border-line bg-[#f7fbf9] px-4 py-3.5">
              <div className="flex justify-between gap-6 text-sm">
                <dt className="text-muted">Subtotaal excl. btw</dt>
                <dd className="tabular-nums text-ink">
                  {formatEuro(displayEx)}
                </dd>
              </div>
              <div className="flex justify-between gap-6 text-sm">
                <dt className="text-muted">Btw</dt>
                <dd className="tabular-nums text-ink">
                  {formatEuro(displayBtw)}
                </dd>
              </div>
              <div className="flex justify-between gap-6 border-t border-line pt-2">
                <dt className="text-sm font-semibold text-ink">Totaal</dt>
                <dd className="font-display text-xl font-semibold tabular-nums text-green-deeper">
                  {formatEuro(displayInc)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-4 border-t border-line px-5 py-5 sm:px-8">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              Betaling
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink">
              Gelieve te betalen op{" "}
              <span className="font-mono font-semibold">{COMPANY.iban}</span>{" "}
              t.n.v. {COMPANY.naam}, onder vermelding van{" "}
              <span className="font-mono font-semibold">
                {factuur.factuur_nummer}
              </span>
              .
            </p>
            {factuur.notities ? (
              <p className="mt-3 whitespace-pre-wrap text-sm text-muted">
                {factuur.notities}
              </p>
            ) : null}
            <p className="mt-4 text-xs text-muted">
              {COMPANY.email} · {COMPANY.telefoon} · {COMPANY.website}
            </p>
          </div>
        </article>

        {/* Zijbalk acties + koppelingen */}
        <aside className="space-y-4">
          {isDraft ? (
            <section className="border border-line bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                Concept bewerken
              </p>
              <div className="mt-3 space-y-3">
                <label className="block text-xs text-muted">
                  Bedrag incl. btw (€)
                  <input
                    type="text"
                    inputMode="decimal"
                    value={editBedrag}
                    onChange={(e) => setEditBedrag(e.target.value)}
                    className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
                  />
                </label>
                <label className="block text-xs text-muted">
                  Omschrijving
                  <input
                    type="text"
                    value={editOmschrijving}
                    onChange={(e) => setEditOmschrijving(e.target.value)}
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
                    value={editBetaaltermijn}
                    onChange={(e) => setEditBetaaltermijn(e.target.value)}
                    className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy !== null || !editBedrag.trim()}
                  onClick={() => void saveConcept()}
                  className="w-full bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                >
                  {busy === "save" ? "Opslaan…" : "Opslaan"}
                </button>
              </div>
            </section>
          ) : null}

          {!isPaid && !isCredit ? (
            <section className="border border-line bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                Markeer als betaald
              </p>
              <label className="mt-3 block text-xs text-muted">
                Betaaldatum
                <input
                  type="date"
                  value={betaaldOp}
                  onChange={(e) => setBetaaldOp(e.target.value)}
                  className="mt-1 block w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                />
              </label>
              <button
                type="button"
                disabled={busy !== null || !betaaldOp}
                onClick={() => void markAsPaid()}
                className="mt-3 w-full bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
              >
                {busy === "paid" ? "Opslaan…" : "Markeer als betaald"}
              </button>
            </section>
          ) : null}

          {isCredit ? (
            <section className="border border-line bg-white p-4 text-sm text-muted">
              Creditfactuur — er hoeft niets te worden betaald.
              {creditVan?.factuur_nummer ? (
                <>
                  {" "}
                  Gekoppeld aan{" "}
                  <Link
                    href={`/facturen/${creditVan.id}`}
                    className="font-medium text-green-deeper hover:underline"
                  >
                    {creditVan.factuur_nummer}
                  </Link>
                  .
                </>
              ) : null}
            </section>
          ) : null}

          <section className="border border-line bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              Datums
            </p>
            <dl className="mt-3 space-y-3">
              <div>
                <dt className="text-[11px] text-muted">Aangemaakt</dt>
                <dd className="mt-0.5 text-sm font-medium text-ink">
                  {formatDateTimeNl(factuur.created_at)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted">
                  Betaald gemarkeerd op
                </dt>
                <dd
                  className={[
                    "mt-0.5 text-sm font-medium",
                    isPaid && factuur.betaald_op
                      ? "text-green-deeper"
                      : "text-muted",
                  ].join(" ")}
                >
                  {isPaid && factuur.betaald_op
                    ? formatDateShort(factuur.betaald_op)
                    : "Nog niet betaald"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="border border-line bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              Koppelingen
            </p>
            <ul className="mt-3 space-y-2">
              <li>
                <Link
                  href={`/leads/${factuur.lead_id}`}
                  className="block border border-line px-3 py-2.5 hover:border-green/40 hover:bg-wash"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Lead
                  </p>
                  <p className="mt-0.5 font-mono text-xs font-semibold text-orange">
                    {lead?.lead_number ||
                      factuur.leads?.lead_number ||
                      factuur.lead_id.slice(0, 8)}
                  </p>
                  <p className="mt-0.5 text-sm text-ink">{klantNaam}</p>
                </Link>
              </li>
              {offerte ? (
                <li>
                  <Link
                    href={`/offertes/${offerte.id}`}
                    className="block border border-line px-3 py-2.5 hover:border-green/40 hover:bg-wash"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Offerte
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-ink">
                      {offerte.offerte_nummer}
                    </p>
                  </Link>
                </li>
              ) : null}
              {project ? (
                <li>
                  <Link
                    href={`/projecten/${project.id}`}
                    className="block border border-line px-3 py-2.5 hover:border-green/40 hover:bg-wash"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Project
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-ink">
                      {project.project_nummer}
                    </p>
                  </Link>
                </li>
              ) : null}
            </ul>
          </section>
        </aside>
      </div>

      {/* Creditfacturen blijven onder de oorspronkelijke factuur */}
      {!isCredit ? (
        <section className="mt-4 border border-line bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#C45A12]">
                Creditfactuur
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {credits.length === 0
                  ? "Nog geen creditfactuur bij deze factuur."
                  : `${credits.length} creditfactuur${
                      credits.length === 1 ? "" : "en"
                    } onder ${factuur.factuur_nummer}.`}
              </p>
            </div>
            {canCredit ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setShowCredit((v) => !v)}
                className="border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50"
              >
                Creditfactuur maken
              </button>
            ) : null}
          </div>

          {showCredit && canCredit ? (
            <div className="border-b border-line px-4 py-4 sm:px-5">
              <p className="text-sm text-muted">
                Maakt een concept-creditfactuur voor hetzelfde bedrag (
                {formatEuro(factuur.bedrag_inc_btw)}). Die blijft hieronder
                staan — de oorspronkelijke factuur verdwijnt niet. Bij
                versturen van de credit vervalt de openstaande
                oorspronkelijke factuur.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void createCredit()}
                  className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                >
                  {busy === "credit" ? "Aanmaken…" : "Creditconcept maken"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCredit(false)}
                  className="border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-wash"
                >
                  Annuleren
                </button>
              </div>
            </div>
          ) : null}

          {credits.length > 0 ? (
            <ul className="divide-y divide-line">
              {credits.map((c) => {
                const busyKeyPdf = creditBusy === `pdf:${c.id}`;
                const busyKeySend = creditBusy === `send:${c.id}`;
                return (
                  <li
                    key={c.id}
                    className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#C45A12]">
                          Creditfactuur
                        </span>
                        <StatusBadge kind="factuur" value={c.status} />
                        <span className="font-mono text-xs font-semibold text-green-dark">
                          {c.factuur_nummer}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-ink">
                        {c.omschrijving ||
                          `Credit bij ${factuur.factuur_nummer}`}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {formatEuro(-Math.abs(Number(c.bedrag_inc_btw) || 0))}{" "}
                        incl. · btw{" "}
                        {formatEuro(-Math.abs(Number(c.btw_bedrag) || 0))} ·{" "}
                        {formatDateShort(c.factuurdatum)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={creditBusy !== null}
                        onClick={() => void downloadCreditPdf(c)}
                        className="border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50"
                      >
                        {busyKeyPdf ? "PDF…" : "PDF downloaden"}
                      </button>
                      <button
                        type="button"
                        disabled={creditBusy !== null || !klantEmail}
                        title={
                          klantEmail
                            ? `Mail naar ${klantEmail}`
                            : "Lead heeft geen e-mail"
                        }
                        onClick={() => void sendCredit(c)}
                        className="bg-orange px-3 py-2 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50"
                      >
                        {busyKeySend
                          ? "Verzenden…"
                          : c.status === "concept"
                            ? "Versturen"
                            : "Opnieuw versturen"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}
    </DetailShell>
  );
}
