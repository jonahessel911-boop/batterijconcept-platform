"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { adresRegel, formatDateTimeNl } from "@/lib/format";
import type { FinancieringStatus } from "@/lib/financiering-status";
import {
  FINANCIERING_PIPELINE,
  FINANCIERING_STATUS_LABEL,
  FINANCIERING_STATUS_LABEL_KORT,
  normalizeFinancieringStatus,
} from "@/lib/financiering-status";
import { wfPortalStatusLabel } from "@/lib/warmtefonds-portal";

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
  "mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-[#C45A12]";

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

  const [afspraakLocal, setAfspraakLocal] = useState("");
  const [wfNotities, setWfNotities] = useState("");
  const [nieuweNotitie, setNieuweNotitie] = useState("");

  const syncForm = useCallback((o: OrderDetail) => {
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

  async function setStep(step: FinancieringStatus) {
    await patch(
      { financiering_status: step },
      "status",
      `Stap gezet: ${FINANCIERING_STATUS_LABEL_KORT[step]}`
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
      { warmtefonds_afspraak_at: d.toISOString() },
      "afspraak",
      "Interne afspraak opgeslagen."
    );
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
        <div className="mx-auto max-w-[1100px]">
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
  const pipelineStatus = normalizeFinancieringStatus(order.financiering_status);
  const currentIdx =
    pipelineStatus && pipelineStatus !== "afgewezen"
      ? FINANCIERING_PIPELINE.indexOf(pipelineStatus)
      : -1;
  const isAfgewezen = order.financiering_status === "afgewezen";

  return (
    <div className="crm-bg flex min-h-screen flex-col pb-10">
      <header className="sticky top-0 z-40 border-b border-green-deeper bg-green-dark pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-16 w-full max-w-[1100px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/brands/warmtefonds-logo.png"
              alt="Nationaal Warmtefonds"
              width={100}
              height={30}
              className="hidden h-7 w-auto object-contain brightness-0 invert sm:block"
            />
            <div className="min-w-0 sm:border-l sm:border-white/20 sm:pl-3">
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
          </div>
          <p className="shrink-0 text-[11px] text-white/55">
            {order.project_nummer}
          </p>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1100px] gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[1fr_320px]">
        {(error || okMsg) && (
          <div className="space-y-2 lg:col-span-2">
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

        <div className="space-y-4">
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
                    {off?.ondertekend_op
                      ? ` · Getekend ${formatDateTimeNl(off.ondertekend_op)}`
                      : ""}
                  </p>
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#C45A12]">
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
            </div>
          </section>

          <section className="border border-line bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Warmtefonds-flow
                </p>
                <p className="mt-0.5 text-[15px] font-semibold text-ink">
                  {isAfgewezen
                    ? "Afgewezen"
                    : pipelineStatus
                      ? FINANCIERING_STATUS_LABEL_KORT[pipelineStatus]
                      : "Nog niet gestart"}
                </p>
              </div>
              {currentIdx >= 0 ? (
                <span className="text-[11px] text-muted">
                  Stap {currentIdx + 1}/7
                </span>
              ) : null}
            </div>

            <ol className="mt-3 space-y-0.5">
              {FINANCIERING_PIPELINE.map((step, idx) => {
                const active = currentIdx === idx;
                const done = currentIdx >= 0 && idx < currentIdx;
                return (
                  <li key={step}>
                    <button
                      type="button"
                      disabled={busy === "status"}
                      title={FINANCIERING_STATUS_LABEL[step]}
                      onClick={() => void setStep(step)}
                      className={[
                        "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] transition hover:bg-[#FFF7ED]",
                        active
                          ? "bg-[#FFF0E6] font-semibold text-[#C45A12]"
                          : done
                            ? "font-medium text-ink"
                            : "text-muted",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold",
                          active || done
                            ? "border-[#C45A12] bg-[#C45A12] text-white"
                            : "border-[#D1D5D3] bg-white text-[#9CA3AF]",
                        ].join(" ")}
                      >
                        {done && !active ? "✓" : idx + 1}
                      </span>
                      {FINANCIERING_STATUS_LABEL_KORT[step]}
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
              <button
                type="button"
                disabled={busy === "status"}
                onClick={() => void setStep("afgewezen")}
                className={[
                  "px-3 py-1.5 text-[12px] font-semibold",
                  isAfgewezen
                    ? "bg-[#FDECEA] text-[#C62828]"
                    : "text-muted hover:bg-wash",
                ].join(" ")}
              >
                Afgewezen
              </button>
            </div>
          </section>

          <section className="border border-line bg-white">
            <div className="border-b border-line px-4 py-3 sm:px-5">
              <h2 className="font-display text-base font-semibold text-ink">
                Interne afspraak
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                Puur intern — geen mail naar de klant. Zichtbaar in de agenda.
              </p>
            </div>
            <div className="space-y-3 p-4 sm:p-5">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                Datum & tijd
                <input
                  type="datetime-local"
                  value={afspraakLocal}
                  onChange={(e) => setAfspraakLocal(e.target.value)}
                  className={inputCls}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy === "afspraak"}
                  onClick={() => void saveAfspraak()}
                  className="bg-[#C45A12] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#A84A0E] disabled:opacity-60"
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
                    className="border border-line bg-white px-4 py-2.5 text-sm font-medium hover:bg-wash"
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
            </div>
            <div className="space-y-3 p-4 sm:p-5">
              <textarea
                value={wfNotities}
                onChange={(e) => setWfNotities(e.target.value)}
                rows={4}
                className={inputCls}
                placeholder="Documenten, bijzonderheden…"
              />
              <button
                type="button"
                disabled={busy === "notities"}
                onClick={() =>
                  void patch(
                    { warmtefonds_notities: wfNotities },
                    "notities",
                    "Notities opgeslagen."
                  )
                }
                className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
              >
                {busy === "notities" ? "Bezig…" : "Notities opslaan"}
              </button>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="border border-line bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              Tijdlijn
            </p>
            <div className="mt-3 space-y-2">
              <textarea
                value={nieuweNotitie}
                onChange={(e) => setNieuweNotitie(e.target.value)}
                rows={2}
                className={inputCls}
                placeholder="Korte update…"
              />
              <button
                type="button"
                disabled={busy === "notitie" || !nieuweNotitie.trim()}
                onClick={() => {
                  const t = nieuweNotitie.trim();
                  if (!t) return;
                  void patch({ notitie: t }, "notitie", "Notitie toegevoegd.").then(
                    () => setNieuweNotitie("")
                  );
                }}
                className="w-full border border-line bg-white px-3 py-2 text-xs font-semibold hover:bg-wash disabled:opacity-60"
              >
                Toevoegen
              </button>
            </div>
            <ul className="mt-4 max-h-[480px] space-y-2 overflow-y-auto">
              {events.length === 0 ? (
                <li className="text-xs text-muted">Nog geen updates.</li>
              ) : (
                events.map((ev) => (
                  <li
                    key={ev.id}
                    className="border border-line bg-wash/40 px-3 py-2"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">
                        {ev.titel}
                      </p>
                      <p className="shrink-0 text-[10px] text-muted">
                        {formatDateTimeNl(ev.created_at)}
                      </p>
                    </div>
                    {ev.detail ? (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-muted">
                        {ev.detail}
                      </p>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </section>
        </aside>
      </main>
    </div>
  );
}
