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

const inputCls =
  "mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green";

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={[
        "block text-[10px] font-semibold uppercase tracking-wide text-muted",
        className || "",
      ].join(" ")}
    >
      {label}
      {children}
    </label>
  );
}

function leadOf(o: OrderDetail): LeadLite | null {
  if (!o.leads) return null;
  return Array.isArray(o.leads) ? o.leads[0] || null : o.leads;
}

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
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
      <div className="crm-bg flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Aanvraag laden…</p>
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="crm-bg min-h-screen px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-[900px]">
          <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
            {error}
          </p>
          <Link
            href={`/warmtefonds/${token}`}
            className="mt-4 inline-block text-xs font-semibold text-green hover:underline"
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
    <div className="crm-bg flex min-h-screen flex-col pb-8">
      <header className="sticky top-0 z-40 border-b border-green-deeper bg-green-dark pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 w-full max-w-[900px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="min-w-0">
            <Link
              href={`/warmtefonds/${token}`}
              className="text-[11px] font-semibold text-white/70 hover:text-white"
            >
              ← Overzicht
            </Link>
            <h1 className="truncate font-display text-sm font-semibold text-white">
              {lead?.naam || order.titel || "Warmtefonds-aanvraag"}
            </h1>
          </div>
          <p className="shrink-0 text-[11px] text-white/55">
            {order.project_nummer}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[900px] space-y-4 px-4 py-5 sm:px-6">
        {(error || okMsg) && (
          <div className="space-y-2">
            {error ? (
              <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                {error}
              </p>
            ) : null}
            {okMsg ? (
              <p className="border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
                {okMsg}
              </p>
            ) : null}
          </div>
        )}

        <section className="border border-line bg-white">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">
                  {lead?.naam || order.titel || "Klant"}
                </h2>
                <p className="mt-0.5 text-sm text-muted">
                  {order.project_nummer}
                  {off?.offerte_nummer ? ` · ${off.offerte_nummer}` : ""}
                </p>
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-green-dark">
                {wfPortalStatusLabel(order.financiering_status)}
              </span>
            </div>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Telefoon
              </p>
              <p className="mt-0.5 text-sm text-ink">
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
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                E-mail
              </p>
              <p className="mt-0.5 text-sm text-ink">{lead?.email || "—"}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Adres
              </p>
              <p className="mt-0.5 text-sm text-ink">
                {lead ? adresRegel(lead) || "—" : "—"}
              </p>
            </div>
            {lead?.notities ? (
              <div className="sm:col-span-2 border border-line bg-wash/40 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Klantnotities (CRM)
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                  {lead.notities}
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="border border-line bg-white">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="font-display text-base font-semibold text-ink">
              Status Warmtefonds
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Huidig: {wfPortalStatusLabel(order.financiering_status)}
            </p>
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            <Field label="Nieuwe status">
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as FinancieringStatus)
                }
                className={inputCls}
              >
                {wfPortalStatusOptions().map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              disabled={busy === "status"}
              onClick={() => void saveStatus()}
              className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
            >
              {busy === "status" ? "Bezig…" : "Status opslaan"}
            </button>
          </div>
        </section>

        <section className="border border-line bg-white">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="font-display text-base font-semibold text-ink">
              Afspraak
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Datum/tijd voor de Warmtefonds-aanvraagafspraak
            </p>
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            <Field label="Datum & tijd">
              <input
                type="datetime-local"
                value={afspraakLocal}
                onChange={(e) => setAfspraakLocal(e.target.value)}
                className={inputCls}
              />
            </Field>
            {order.warmtefonds_afspraak_at ? (
              <p className="text-xs text-muted">
                Nu gezet: {formatDateTimeNl(order.warmtefonds_afspraak_at)}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy === "afspraak"}
                onClick={() => void saveAfspraak()}
                className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
              >
                {busy === "afspraak" ? "Bezig…" : "Afspraak opslaan"}
              </button>
              {afspraakLocal ? (
                <button
                  type="button"
                  disabled={busy === "afspraak"}
                  onClick={() => {
                    setAfspraakLocal("");
                    void patch(
                      { warmtefonds_afspraak_at: null },
                      "afspraak",
                      "Afspraak gewist."
                    );
                  }}
                  className="border border-line bg-white px-4 py-2.5 text-sm font-medium hover:bg-wash disabled:opacity-60"
                >
                  Wissen
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="border border-line bg-white">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="font-display text-base font-semibold text-ink">
              Notities
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Vaste notities bij deze order + updates op de tijdlijn
            </p>
          </div>
          <div className="space-y-4 p-4 sm:p-5">
            <Field label="Warmtefonds-notities">
              <textarea
                value={wfNotities}
                onChange={(e) => setWfNotities(e.target.value)}
                rows={4}
                className={inputCls}
                placeholder="Bijv. documenten ontvangen, bijzonderheden…"
              />
            </Field>
            <button
              type="button"
              disabled={busy === "notities"}
              onClick={() => void saveNotities()}
              className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
            >
              {busy === "notities" ? "Bezig…" : "Notities opslaan"}
            </button>

            <div className="border-t border-line pt-4">
              <Field label="Nieuwe notitie (tijdlijn)">
                <textarea
                  value={nieuweNotitie}
                  onChange={(e) => setNieuweNotitie(e.target.value)}
                  rows={2}
                  className={inputCls}
                  placeholder="Korte update…"
                />
              </Field>
              <button
                type="button"
                disabled={busy === "notitie" || !nieuweNotitie.trim()}
                onClick={() => void addNotitie()}
                className="mt-2 border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-wash disabled:opacity-60"
              >
                {busy === "notitie" ? "Bezig…" : "Notitie toevoegen"}
              </button>
            </div>

            {events.length > 0 ? (
              <ul className="space-y-2 border-t border-line pt-4">
                {events.map((ev) => (
                  <li key={ev.id} className="border border-line bg-wash/40 px-3 py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">
                        {ev.titel}
                      </p>
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
          </div>
        </section>
      </main>
    </div>
  );
}
