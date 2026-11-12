"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { adresRegel, formatDateTimeNl, formatEuro } from "@/lib/format";
import type { FinancieringStatus } from "@/lib/financiering-status";
import {
  patchVoorWerkStatus,
  poortVoorWerkStatus,
  WF_WERK_LABEL,
  WF_WERK_STAP_UITLEG,
  WF_WERK_STATUSSEN,
  wfWerkStatusVan,
  type WfWerkStatus,
} from "@/lib/warmtefonds-werkstatus";
import { WarmtefondsAfspraakForm } from "@/components/warmtefonds/WarmtefondsAfspraakForm";
import { WarmtefondsContactMail } from "@/components/warmtefonds/WarmtefondsContactMail";

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
  warmtefonds_contact_pogingen?: number | null;
  warmtefonds_notities?: string | null;
  notities?: string | null;
  leads?: LeadLite | LeadLite[] | null;
  offertes?:
    | {
        id?: string;
        offerte_nummer?: string;
        status?: string | null;
        ondertekend_op?: string | null;
      }
    | {
        id?: string;
        offerte_nummer?: string;
        status?: string | null;
        ondertekend_op?: string | null;
      }[]
    | null;
  bedragen?: {
    totaalInc: number | null;
    aanbetalingInc: number | null;
    warmtefondsInc: number | null;
    offerteGetekend: boolean;
  } | null;
};

type LeadEvent = {
  id: string;
  soort: string;
  titel: string;
  detail: string | null;
  created_at: string;
};

type PortalFactuur = {
  id: string;
  nummer: string;
  status: string;
  statusLabel: string;
  bedragInc: number | null;
  omschrijving: string | null;
  isCredit: boolean;
  isRestant?: boolean;
  pdf: string;
};

const inputCls =
  "w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green-dark";

function euroOfStreep(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return formatEuro(amount);
}

function factuurBetaalBadge(status: string): { label: string; tone: string } {
  if (status === "betaald") {
    return { label: "Betaald", tone: "bg-green-soft text-green-dark" };
  }
  if (status === "concept") {
    return { label: "Concept", tone: "bg-wash text-muted" };
  }
  if (status === "vervallen") {
    return { label: "Vervallen", tone: "bg-[#FEF2F2] text-[#B91C1C]" };
  }
  // verzonden / deels_betaald / overig openstaand
  return { label: "Onbetaald", tone: "bg-[#FFF7ED] text-[#C45A12]" };
}

function factuurTitel(f: PortalFactuur): string {
  if (f.isCredit) return "Creditfactuur";
  if (f.isRestant) return "Restantfactuur";
  const o = (f.omschrijving || "").toLowerCase();
  if (o.includes("aanbetaling")) return "Aanbetalingsfactuur";
  return "Factuur";
}

function leadOf(o: OrderDetail): LeadLite | null {
  if (!o.leads) return null;
  return Array.isArray(o.leads) ? o.leads[0] || null : o.leads;
}

function initialen(naam: string | null | undefined): string {
  const parts = (naam || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

export function WarmtefondsOrderDetailPage() {
  const { token, projectId } = useParams<{
    token: string;
    projectId: string;
  }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [facturen, setFacturen] = useState<PortalFactuur[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [afspraakOpen, setAfspraakOpen] = useState(false);

  const [wfNotities, setWfNotities] = useState("");
  const [nieuweNotitie, setNieuweNotitie] = useState("");

  const syncForm = useCallback((o: OrderDetail) => {
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
      setFacturen((data.facturen || []) as PortalFactuur[]);
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

  useEffect(() => {
    if (!contactOpen && !afspraakOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [contactOpen, afspraakOpen]);

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

  async function setWerkStatus(status: WfWerkStatus) {
    if (status === "afspraak_ingepland" && !order?.warmtefonds_afspraak_at) {
      setAfspraakOpen(true);
      setOkMsg("Plan eerst een afspraak.");
      return;
    }
    const body = patchVoorWerkStatus(status);
    await patch(body, "status", `Status: ${WF_WERK_LABEL[status]}`);
  }

  async function openContact() {
    setContactOpen(true);
    try {
      await fetch(`/api/warmtefonds/${token}/orders/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_poging: true }),
      });
      await load();
    } catch {
      /* best-effort */
    }
  }

  async function verstuurFactuur(factuurId: string) {
    setBusy(`factuur:${factuurId}`);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/warmtefonds/${token}/facturen/${factuurId}/versturen`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Verzenden mislukt"
        );
      }
      setOkMsg("Factuur is naar de klant verstuurd.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verzenden mislukt");
    } finally {
      setBusy(null);
    }
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
        <div className="mx-auto max-w-[1200px]">
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
  const werk = wfWerkStatusVan(order);
  const werkIdx = werk ? WF_WERK_STATUSSEN.indexOf(werk) : -1;
  const poort = poortVoorWerkStatus(werk);
  const offerteStatus =
    off?.status === "ondertekend" || off?.ondertekend_op
      ? "ondertekend"
      : off?.status || (off ? "concept" : null);
  const documentenCount = (off ? 1 : 0) + facturen.length;
  const openstaandeFacturen = facturen.filter(
    (f) =>
      !f.isCredit &&
      (f.status === "verzonden" || f.status === "deels_betaald")
  ).length;
  const betaaldeFacturen = facturen.filter(
    (f) => !f.isCredit && f.status === "betaald"
  ).length;
  const telHref = lead?.telefoon
    ? `tel:${lead.telefoon.replace(/\s/g, "")}`
    : null;

  return (
    <div className="crm-bg flex min-h-screen max-w-[100vw] flex-col overflow-x-hidden overscroll-x-none">
      <header className="sticky top-0 z-40 border-b border-green-deeper bg-green-dark pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 w-full max-w-full items-center justify-between gap-3 px-4 sm:h-16 sm:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Image
              src="/brands/warmtefonds-logo.png"
              alt="Nationaal Warmtefonds"
              width={100}
              height={30}
              className="hidden h-7 w-auto shrink-0 object-contain brightness-0 invert sm:block"
            />
            <div className="min-w-0 sm:border-l sm:border-white/20 sm:pl-3">
              <Link
                href={`/warmtefonds/${token}`}
                className="text-[11px] font-semibold text-white/70 hover:text-white"
              >
                ← Overzicht
              </Link>
              <h1 className="truncate font-display text-sm font-semibold text-white sm:text-base">
                {lead?.naam || order.titel || "Warmtefonds-aanvraag"}
              </h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {werk ? (
              <span className="hidden rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white sm:inline">
                {WF_WERK_LABEL[werk]}
              </span>
            ) : null}
            <p className="max-w-[7rem] truncate text-[11px] text-white/55 sm:max-w-none">
              {order.project_nummer}
            </p>
          </div>
        </div>
      </header>

      <main className="grid w-full max-w-full min-w-0 flex-1 gap-0 overflow-x-hidden lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)_minmax(16rem,20rem)]">
        {(error || okMsg) && (
          <div className="space-y-2 border-b border-line px-4 py-3 lg:col-span-3 sm:px-6">
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

        {/* LEFT — over de klant */}
        <aside className="min-w-0 overflow-x-hidden border-b border-line bg-white lg:border-b-0 lg:border-r">
          <div className="px-4 py-5 sm:px-5">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-green-dark text-sm font-bold text-white">
                {initialen(lead?.naam || order.titel)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-base font-semibold text-ink">
                  {lead?.naam || order.titel || "Klant"}
                </p>
                <p className="truncate text-xs text-muted">
                  {order.project_nummer}
                  {off?.offerte_nummer ? ` · ${off.offerte_nummer}` : ""}
                </p>
                {lead?.email ? (
                  <a
                    href={`mailto:${lead.email}`}
                    className="mt-0.5 block truncate text-xs font-medium text-green-dark hover:underline"
                  >
                    {lead.email}
                  </a>
                ) : null}
              </div>
            </div>

          </div>

          <div className="border-t border-line px-4 py-4 sm:px-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Over deze klant
            </p>
            <dl className="mt-3 space-y-3">
              <div>
                <dt className="text-[11px] text-muted">Telefoon</dt>
                <dd className="mt-0.5 text-sm text-ink">
                  {telHref ? (
                    <a
                      href={telHref}
                      className="font-medium text-green-dark hover:underline"
                    >
                      {lead?.telefoon}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted">E-mail</dt>
                <dd className="mt-0.5 break-all text-sm text-ink">
                  {lead?.email || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted">Adres</dt>
                <dd className="mt-0.5 text-sm text-ink">
                  {lead ? adresRegel(lead) || "—" : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted">Warmtefonds-deel</dt>
                <dd className="mt-0.5 text-sm font-semibold text-[#C45A12]">
                  {euroOfStreep(order.bedragen?.warmtefondsInc)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted">Order / aanbetaling</dt>
                <dd className="mt-0.5 text-sm text-ink">
                  {euroOfStreep(order.bedragen?.totaalInc)}
                  {" · "}
                  {euroOfStreep(order.bedragen?.aanbetalingInc)}
                </dd>
              </div>
              {off?.ondertekend_op ? (
                <div>
                  <dt className="text-[11px] text-muted">Offerte getekend</dt>
                  <dd className="mt-0.5 text-sm text-ink">
                    {formatDateTimeNl(off.ondertekend_op)}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </aside>

        {/* CENTER — statusketen */}
        <section className="min-w-0 overflow-x-hidden bg-[#F3F4F2]">
          <div className="space-y-4 px-4 py-5 sm:px-6 sm:py-6">
            <div className="bg-white px-4 py-5 sm:px-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                Statusketen
              </p>
              <p className="mt-1 text-sm text-muted">
                Elke aanvraag doorloopt deze stappen — van contact tot
                afgerond.
              </p>

              <ol className="mt-4 space-y-0">
                {WF_WERK_STATUSSEN.map((step, idx) => {
                  const active = werk === step;
                  const done = werkIdx >= 0 && idx < werkIdx;
                  const isNext = poort.volgende === step;
                  return (
                    <li
                      key={step}
                      className={[
                        "flex items-stretch gap-3 border-l-2 py-2.5 pl-3",
                        active
                          ? "border-[#C45A12] bg-[#FFF7ED]"
                          : done
                            ? "border-green-dark/40"
                            : "border-line",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-[11px] font-bold",
                          active
                            ? "bg-[#C45A12] text-white"
                            : done
                              ? "bg-green-dark text-white"
                              : "bg-wash text-muted",
                        ].join(" ")}
                      >
                        {done && !active ? "✓" : idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={[
                            "text-sm font-semibold",
                            active
                              ? "text-[#C45A12]"
                              : done
                                ? "text-ink"
                                : "text-muted",
                          ].join(" ")}
                        >
                          {WF_WERK_LABEL[step]}
                          {active ? " · nu" : ""}
                          {isNext && !active ? " · volgende" : ""}
                        </p>
                        <p
                          className={[
                            "mt-0.5 text-[12px] leading-snug",
                            active ? "text-ink/80" : "text-muted",
                          ].join(" ")}
                        >
                          {WF_WERK_STAP_UITLEG[step]}
                        </p>
                        {active && step === "afspraak_ingepland" && order.warmtefonds_afspraak_at ? (
                          <p className="mt-1 text-xs font-medium tabular-nums text-ink">
                            Afspraak: {formatDateTimeNl(order.warmtefonds_afspraak_at)}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="bg-white px-4 py-5 sm:px-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#C45A12]">
                Om door te gaan
              </p>
              <h2 className="mt-1 font-display text-xl font-semibold text-ink">
                {poort.titel}
              </h2>
              <p className="mt-1.5 text-sm text-muted">{poort.uitleg}</p>

              {poort.soort === "contact" ? (
                <div className="mt-4 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {telHref ? (
                      <a
                        href={telHref}
                        className="border-2 border-green-dark bg-green-soft px-3 py-3 text-sm font-semibold text-ink hover:bg-[#d9f0e0]"
                      >
                        Bel {lead?.telefoon}
                      </a>
                    ) : (
                      <div className="border border-dashed border-line px-3 py-3 text-sm text-muted">
                        Geen telefoon
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void openContact()}
                      className="border border-line bg-white px-3 py-3 text-left text-sm font-semibold text-ink hover:border-ink"
                    >
                      Mailen
                      {Number(order.warmtefonds_contact_pogingen) > 0
                        ? ` · ${order.warmtefonds_contact_pogingen}×`
                        : ""}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void openContact()}
                    className="w-full bg-green-dark px-4 py-3.5 text-sm font-semibold text-white hover:bg-green-deeper"
                  >
                    {poort.ctaLabel} → status: Afspraak inplannen
                  </button>
                </div>
              ) : null}

              {poort.soort === "afspraak" ? (
                <div id="wf-afspraak" className="mt-4 space-y-2">
                  <button
                    type="button"
                    onClick={() => setAfspraakOpen(true)}
                    className="w-full bg-[#1A4A6E] px-4 py-3.5 text-sm font-semibold text-white hover:bg-[#143A57]"
                  >
                    {poort.ctaLabel} → status: Afspraak ingepland
                  </button>
                  <p className="text-xs text-muted">
                    Kies datum en tijd. Klant krijgt bevestiging per mail.
                  </p>
                </div>
              ) : null}

              {werk === "goedgekeurd" ? (
                <div className="mt-4 space-y-2">
                  <p className="text-xs text-muted">
                    Restantfactuur staat onder Documenten — verstuur die daar
                    naar de klant.
                  </p>
                  {poort.volgende ? (
                    <button
                      type="button"
                      disabled={busy === "status"}
                      onClick={() => void setWerkStatus(poort.volgende!)}
                      className="w-full border border-line bg-white px-4 py-3 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-60"
                    >
                      {busy === "status" ? "…" : poort.ctaLabel}
                    </button>
                  ) : null}
                </div>
              ) : poort.soort === "status" && poort.volgende ? (
                <button
                  type="button"
                  disabled={busy === "status"}
                  onClick={() => void setWerkStatus(poort.volgende!)}
                  className="mt-4 w-full bg-[#C45A12] px-4 py-3.5 text-sm font-semibold text-white hover:bg-[#A84A0E] disabled:opacity-60"
                >
                  {busy === "status" ? "…" : poort.ctaLabel}
                </button>
              ) : null}

              {poort.soort === "klaar" ? (
                <p className="mt-4 text-sm font-semibold text-green-dark">
                  Klaar — geen volgende stap.
                </p>
              ) : null}

              {order.warmtefonds_afspraak_at &&
              poort.soort !== "afspraak" ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Geplande afspraak
                    </p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                      {formatDateTimeNl(order.warmtefonds_afspraak_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAfspraakOpen(true)}
                    className="text-sm font-semibold text-[#1A4A6E] hover:underline"
                  >
                    Wijzigen
                  </button>
                </div>
              ) : null}
            </div>

            <div className="bg-white px-4 py-4 sm:px-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                Notities
              </p>
              <textarea
                value={wfNotities}
                onChange={(e) => setWfNotities(e.target.value)}
                rows={3}
                className={`${inputCls} mt-2`}
                placeholder="Wat speelt er…"
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
                className="mt-2 border border-line bg-wash px-3 py-2 text-xs font-semibold text-ink hover:bg-white disabled:opacity-60"
              >
                {busy === "notities" ? "Bezig…" : "Notitie opslaan"}
              </button>
            </div>
          </div>
        </section>

        {/* RIGHT — documenten + timeline */}
        <aside className="min-w-0 overflow-x-hidden border-t border-line bg-white lg:border-l lg:border-t-0">
          <div className="border-b border-line px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                Documenten
              </p>
              {facturen.some((f) => !f.isCredit) ? (
                <span
                  className={[
                    "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    openstaandeFacturen > 0
                      ? "bg-[#FFF7ED] text-[#C45A12]"
                      : betaaldeFacturen > 0
                        ? "bg-green-soft text-green-dark"
                        : "bg-wash text-muted",
                  ].join(" ")}
                >
                  {openstaandeFacturen > 0
                    ? "Onbetaald"
                    : betaaldeFacturen > 0
                      ? "Betaald"
                      : "Concept"}
                </span>
              ) : null}
            </div>

            {documentenCount === 0 ? (
              <p className="mt-3 text-sm text-muted">Nog geen documenten</p>
            ) : (
              <div className="mt-3 overflow-hidden border border-line">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line bg-wash/80 text-[11px] font-semibold text-muted">
                      <th className="px-3 py-2 font-semibold text-ink">
                        Document
                      </th>
                      <th className="px-2 py-2 text-right font-semibold text-ink">
                        Bedrag
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-ink">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {off ? (
                      <tr className="border-b border-line last:border-b-0 hover:bg-wash/40">
                        <td className="px-3 py-2.5">
                          <a
                            href={`/api/warmtefonds/${token}/orders/${order.id}/offerte`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-ink hover:underline"
                          >
                            Offerte
                            {off.offerte_nummer
                              ? ` ${off.offerte_nummer}`
                              : ""}
                          </a>
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-muted">
                          —
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span
                            className={[
                              "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              offerteStatus === "ondertekend"
                                ? "bg-green-soft text-green-dark"
                                : "bg-wash text-muted",
                            ].join(" ")}
                          >
                            {offerteStatus === "ondertekend"
                              ? "Ondertekend"
                              : offerteStatus === "verzonden"
                                ? "Verzonden"
                                : "Concept"}
                          </span>
                        </td>
                      </tr>
                    ) : null}

                    {facturen.map((f) => {
                      const badge = factuurBetaalBadge(f.status);
                      return (
                        <tr
                          key={f.id}
                          className="border-b border-line last:border-b-0 hover:bg-wash/40"
                        >
                          <td className="px-3 py-2.5">
                            <a
                              href={f.pdf}
                              target="_blank"
                              rel="noreferrer"
                              className="block min-w-0"
                            >
                              <span className="font-semibold text-ink hover:underline">
                                {factuurTitel(f)}
                              </span>
                              {f.nummer && f.nummer !== "—" ? (
                                <span className="mt-0.5 block font-mono text-[11px] text-muted">
                                  {f.nummer}
                                </span>
                              ) : null}
                            </a>
                            {!f.isCredit && f.status === "concept" ? (
                              <button
                                type="button"
                                disabled={busy === `factuur:${f.id}`}
                                onClick={() => void verstuurFactuur(f.id)}
                                className="mt-1.5 bg-green-dark px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-green-deeper disabled:opacity-60"
                              >
                                {busy === `factuur:${f.id}`
                                  ? "Bezig…"
                                  : "Versturen"}
                              </button>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-right font-medium tabular-nums text-ink">
                            {euroOfStreep(f.bedragInc)}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span
                              className={[
                                "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                badge.tone,
                              ].join(" ")}
                            >
                              {f.isCredit ? "Credit" : badge.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="px-4 py-4 sm:px-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
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
                  void patch(
                    { notitie: t },
                    "notitie",
                    "Notitie toegevoegd."
                  ).then(() => setNieuweNotitie(""));
                }}
                className="w-full border border-line bg-white px-3 py-2 text-xs font-semibold hover:bg-wash disabled:opacity-60"
              >
                Toevoegen
              </button>
            </div>
            <ul className="mt-4 max-h-[min(60vh,520px)] space-y-2 overflow-y-auto pb-6">
              {events.length === 0 ? (
                <li className="text-xs text-muted">Nog geen updates.</li>
              ) : (
                events.map((ev) => (
                  <li
                    key={ev.id}
                    className="border border-line bg-[#FAFBFA] px-3 py-2.5"
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
          </div>
        </aside>
      </main>

      {contactOpen ? (
        <WarmtefondsContactMail
          token={token}
          projectId={order.id}
          projectNummer={order.project_nummer}
          lead={lead}
          onClose={() => {
            setContactOpen(false);
            void load();
          }}
        />
      ) : null}

      {afspraakOpen ? (
        <div
          role="dialog"
          aria-label="Maak WF afspraak"
          className="fixed inset-0 z-[70] flex max-w-[100vw] flex-col overflow-x-hidden overscroll-none bg-white"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                WF-afspraak
              </p>
              <h2 className="mt-0.5 font-display text-lg font-semibold text-ink">
                {lead?.naam || order.titel || "Klant"}
              </h2>
              <p className="text-xs text-muted">{order.project_nummer}</p>
            </div>
            <button
              type="button"
              onClick={() => setAfspraakOpen(false)}
              className="border border-line px-2.5 py-1 text-xs font-semibold hover:bg-wash"
            >
              Sluiten
            </button>
          </div>
          <div className="mx-auto w-full max-w-xl flex-1 overflow-y-auto px-5 py-6">
            <p className="mb-5 text-sm text-muted">
              Kies datum en tijd. De klant krijgt een bevestiging per e-mail.
            </p>
            <WarmtefondsAfspraakForm
              token={token}
              projectId={order.id}
              huidige={order.warmtefonds_afspraak_at}
              onKlaar={(bericht) => {
                setOkMsg(bericht);
                setAfspraakOpen(false);
                void load();
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
