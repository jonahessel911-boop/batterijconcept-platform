"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { adresRegel, formatDateTimeNl } from "@/lib/format";
import type { FinancieringStatus } from "@/lib/financiering-status";
import {
  wfPortalStatusLabel,
  wfPortalStatusOptions,
} from "@/lib/warmtefonds-portal";

type LeadLite = {
  id?: string;
  naam?: string | null;
  telefoon?: string | null;
  email?: string | null;
  postcode?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  straat?: string | null;
  plaats?: string | null;
  notities?: string | null;
};

type OrderDetail = {
  id: string;
  project_nummer: string;
  titel?: string | null;
  status: string;
  financiering_status?: FinancieringStatus | null;
  warmtefonds_afspraak_at?: string | null;
  warmtefonds_aangevraagd_at?: string | null;
  warmtefonds_notities?: string | null;
  notities?: string | null;
  leads?: LeadLite | LeadLite[] | null;
  offertes?:
    | { offerte_nummer?: string; ondertekend_op?: string | null }
    | { offerte_nummer?: string; ondertekend_op?: string | null }[]
    | null;
};

type LeadEvent = {
  id: string;
  soort: string;
  titel: string;
  detail: string | null;
  created_at: string;
};

function leadOf(o: OrderDetail): LeadLite | null {
  if (!o.leads) return null;
  return Array.isArray(o.leads) ? o.leads[0] || null : o.leads;
}

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  // datetime-local in local browser TZ
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function WarmtefondsOrderDetailPage() {
  const { token, projectId } = useParams<{
    token: string;
    projectId: string;
  }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [status, setStatus] = useState<FinancieringStatus | "">(
    "doorgestuurd_naar_edwin"
  );
  const [afspraakLocal, setAfspraakLocal] = useState("");
  const [wfNotities, setWfNotities] = useState("");
  const [nieuweNotitie, setNieuweNotitie] = useState("");

  const syncForm = useCallback((o: OrderDetail) => {
    setStatus(o.financiering_status || "doorgestuurd_naar_edwin");
    setAfspraakLocal(toLocalInputValue(o.warmtefonds_afspraak_at));
    setWfNotities(o.warmtefonds_notities || "");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/warmtefonds/${token}/orders/${projectId}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Niet gevonden");
      const o = data.order as OrderDetail;
      setOrder(o);
      setEvents(data.events || []);
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

  async function patch(
    body: Record<string, unknown>,
    busyKey: string,
    ok: string
  ) {
    setBusy(busyKey);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/warmtefonds/${token}/orders/${projectId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      if (data.order) {
        setOrder(data.order);
        syncForm(data.order);
      }
      setOkMsg(ok);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function saveStatus() {
    if (!status) return;
    await patch(
      { financiering_status: status },
      "status",
      "Status opgeslagen."
    );
  }

  async function saveAfspraak() {
    if (!afspraakLocal) {
      await patch(
        { warmtefonds_afspraak_at: null },
        "afspraak",
        "Afspraak gewist."
      );
      return;
    }
    const d = new Date(afspraakLocal);
    if (Number.isNaN(d.getTime())) {
      setError("Ongeldige datum/tijd");
      return;
    }
    await patch(
      {
        warmtefonds_afspraak_at: d.toISOString(),
        financiering_status:
          status === "doorgestuurd_naar_edwin" || !status
            ? "afspraak_ingepland"
            : status,
      },
      "afspraak",
      "Afspraak opgeslagen."
    );
  }

  async function saveNotities() {
    await patch(
      { warmtefonds_notities: wfNotities },
      "notities",
      "Notities opgeslagen."
    );
  }

  async function addNotitie() {
    const t = nieuweNotitie.trim();
    if (!t) return;
    await patch({ notitie: t }, "notitie", "Notitie toegevoegd.");
    setNieuweNotitie("");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-wash">
        <p className="text-sm text-muted">Aanvraag laden…</p>
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="min-h-screen bg-wash px-4 py-16">
        <div className="mx-auto max-w-3xl">
          <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
            {error}
          </p>
          <Link
            href={`/warmtefonds/${token}`}
            className="mt-4 inline-block text-sm font-semibold text-green-dark hover:underline"
          >
            ← Terug naar overzicht
          </Link>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const lead = leadOf(order);
  const off = Array.isArray(order.offertes)
    ? order.offertes[0]
    : order.offertes;

  return (
    <div className="min-h-screen bg-wash">
      <header className="border-b border-line bg-green-dark px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <Link
            href={`/warmtefonds/${token}`}
            className="text-sm font-medium text-white/70 hover:text-white"
          >
            ← Overzicht
          </Link>
          <h1 className="mt-2 font-display text-xl font-semibold text-white sm:text-2xl">
            {lead?.naam || order.titel || "Warmtefonds-aanvraag"}
          </h1>
          <p className="mt-1 text-sm text-white/70">
            {order.project_nummer}
            {off?.offerte_nummer ? ` · ${off.offerte_nummer}` : ""}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        {okMsg ? (
          <p className="border border-[#0D9488]/25 bg-[#F0FDFA] px-4 py-2 text-sm text-[#115E59]">
            {okMsg}
          </p>
        ) : null}
        {error ? (
          <p className="border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <section className="rounded-xl border border-line bg-white p-4 sm:p-5">
          <h2 className="font-display text-base font-semibold text-ink">
            Klant
          </h2>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                Naam
              </dt>
              <dd className="mt-0.5 text-ink">{lead?.naam || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                Telefoon
              </dt>
              <dd className="mt-0.5 text-ink">
                {lead?.telefoon ? (
                  <a
                    href={`tel:${lead.telefoon.replace(/\s/g, "")}`}
                    className="font-medium text-green-dark hover:underline"
                  >
                    {lead.telefoon}
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                Adres
              </dt>
              <dd className="mt-0.5 text-ink">
                {lead ? adresRegel(lead) || "—" : "—"}
              </dd>
            </div>
            {lead?.email ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                  E-mail
                </dt>
                <dd className="mt-0.5 text-ink">{lead.email}</dd>
              </div>
            ) : null}
          </dl>
          {lead?.notities ? (
            <div className="mt-4 rounded-lg border border-line bg-[#FAFCFA] px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Klantnotities (CRM)
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                {lead.notities}
              </p>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-line bg-white p-4 sm:p-5">
          <h2 className="font-display text-base font-semibold text-ink">
            Status Warmtefonds
          </h2>
          <p className="mt-1 text-sm text-muted">
            Huidig:{" "}
            <strong className="text-ink">
              {wfPortalStatusLabel(order.financiering_status)}
            </strong>
          </p>
          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted">
            Nieuwe status
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as FinancieringStatus)
              }
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
            >
              {wfPortalStatusOptions().map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy === "status"}
            onClick={() => void saveStatus()}
            className="mt-3 bg-green-dark px-4 py-2 text-sm font-semibold text-white hover:bg-[#0D5C32] disabled:opacity-60"
          >
            {busy === "status" ? "Bezig…" : "Status opslaan"}
          </button>
        </section>

        <section className="rounded-xl border border-line bg-white p-4 sm:p-5">
          <h2 className="font-display text-base font-semibold text-ink">
            Afspraak
          </h2>
          <p className="mt-1 text-sm text-muted">
            Datum/tijd voor de Warmtefonds-aanvraagafspraak (zichtbaar in je
            agenda).
          </p>
          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted">
            Datum &amp; tijd
            <input
              type="datetime-local"
              value={afspraakLocal}
              onChange={(e) => setAfspraakLocal(e.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
            />
          </label>
          {order.warmtefonds_afspraak_at ? (
            <p className="mt-2 text-xs text-muted">
              Nu gezet: {formatDateTimeNl(order.warmtefonds_afspraak_at)}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy === "afspraak"}
            onClick={() => void saveAfspraak()}
            className="mt-3 bg-green-dark px-4 py-2 text-sm font-semibold text-white hover:bg-[#0D5C32] disabled:opacity-60"
          >
            {busy === "afspraak" ? "Bezig…" : "Afspraak opslaan"}
          </button>
        </section>

        <section className="rounded-xl border border-line bg-white p-4 sm:p-5">
          <h2 className="font-display text-base font-semibold text-ink">
            Notities bij deze klant
          </h2>
          <p className="mt-1 text-sm text-muted">
            Vaste notities voor deze Warmtefonds-order + korte updates op de
            tijdlijn.
          </p>
          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted">
            Warmtefonds-notities
            <textarea
              value={wfNotities}
              onChange={(e) => setWfNotities(e.target.value)}
              rows={4}
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
              placeholder="Bijv. documenten ontvangen, bijzonderheden…"
            />
          </label>
          <button
            type="button"
            disabled={busy === "notities"}
            onClick={() => void saveNotities()}
            className="mt-3 bg-green-dark px-4 py-2 text-sm font-semibold text-white hover:bg-[#0D5C32] disabled:opacity-60"
          >
            {busy === "notities" ? "Bezig…" : "Notities opslaan"}
          </button>

          <div className="mt-6 border-t border-line pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Nieuwe notitie (tijdlijn)
            </p>
            <textarea
              value={nieuweNotitie}
              onChange={(e) => setNieuweNotitie(e.target.value)}
              rows={2}
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
              placeholder="Korte update…"
            />
            <button
              type="button"
              disabled={busy === "notitie" || !nieuweNotitie.trim()}
              onClick={() => void addNotitie()}
              className="mt-2 border border-green-dark px-4 py-2 text-sm font-semibold text-green-dark hover:bg-[#F4F8F5] disabled:opacity-60"
            >
              {busy === "notitie" ? "Bezig…" : "Notitie toevoegen"}
            </button>
          </div>

          {events.length > 0 ? (
            <ul className="mt-5 space-y-2">
              {events.map((ev) => (
                <li
                  key={ev.id}
                  className="rounded-lg border border-line bg-[#FAFCFA] px-3 py-2"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{ev.titel}</p>
                    <p className="text-[11px] text-muted">
                      {formatDateTimeNl(ev.created_at)}
                    </p>
                  </div>
                  {ev.detail ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted">
                      {ev.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </main>
    </div>
  );
}
