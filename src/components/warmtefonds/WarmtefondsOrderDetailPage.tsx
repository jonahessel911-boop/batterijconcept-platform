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
import { isWarmtefondsStopStatus } from "@/lib/warmtefonds-portal";
import { WarmtefondsAfspraakForm } from "@/components/warmtefonds/WarmtefondsAfspraakForm";
import { WarmtefondsContactMail } from "@/components/warmtefonds/WarmtefondsContactMail";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Download, Mail, Phone, Plus, Send } from "lucide-react";

type DeclaratieFactuurInfo = {
  id: string;
  nummer: string;
  bedragInc: number;
  created: boolean;
  pdf: string;
};

const SECTION_TITLE =
  "text-[10px] font-semibold uppercase tracking-[0.08em] text-muted";

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
  meta?: {
    direction?: string;
    duration_seconds?: number;
    from?: string | null;
    to?: string | null;
    from_label?: string | null;
    to_label?: string | null;
    agent_did?: string | null;
    answered?: boolean;
  } | null;
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
  const [declaratieConfirmOpen, setDeclaratieConfirmOpen] = useState(false);
  const [declaratieFactuur, setDeclaratieFactuur] =
    useState<DeclaratieFactuurInfo | null>(null);

  const [wfNotities, setWfNotities] = useState("");
  const [nieuweNotitie, setNieuweNotitie] = useState("");
  const [showAllEvents, setShowAllEvents] = useState(false);

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
  ): Promise<{
    declaratieFactuur?: DeclaratieFactuurInfo | null;
  } | null> {
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
      return {
        declaratieFactuur:
          (data.declaratieFactuur as DeclaratieFactuurInfo | null) ?? null,
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
      return null;
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
    if (status === "goedgekeurd") {
      const huidige = order ? wfWerkStatusVan(order) : null;
      if (huidige !== "goedgekeurd") {
        setDeclaratieFactuur(null);
        setDeclaratieConfirmOpen(true);
        return;
      }
    }
    const body = patchVoorWerkStatus(status);
    await patch(body, "status", `Status: ${WF_WERK_LABEL[status]}`);
  }

  async function bevestigDeclaratieFactuur() {
    const body = patchVoorWerkStatus("goedgekeurd");
    const result = await patch(
      body,
      "status",
      `Status: ${WF_WERK_LABEL.goedgekeurd}`
    );
    if (!result) return;
    if (result.declaratieFactuur) {
      setDeclaratieFactuur(result.declaratieFactuur);
    } else {
      setDeclaratieConfirmOpen(false);
      setOkMsg("Status gezet. Geen declaratiefactuur aangemaakt (bedrag €0).");
    }
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
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verzenden mislukt");
      return false;
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

  const klantNaam = lead?.naam || order.titel || "Project";
  const st = (order.status || "").toLowerCase();
  const isHold =
    st === "hold_sales_actie" || st === "hold_sales";
  const isAnnulering = st === "annulering" || st === "geannuleerd";
  const isGestopt = isWarmtefondsStopStatus(order.status) || isHold || isAnnulering;
  const stopLabel = isAnnulering
    ? "Geannuleerd"
    : isHold
      ? "Hold sales"
      : "Niet actief";
  const stopUitleg = isAnnulering
    ? "Deze aanvraag is geannuleerd en niet meer relevant."
    : isHold
      ? "Hold sales-actie — deze aanvraag staat stil en is niet meer actief in je werkvoorraad."
      : "Deze aanvraag is niet meer actief.";

  return (
    <div className="crm-bg flex min-h-screen max-w-[100vw] flex-col overflow-x-hidden overscroll-x-none">
      <header className="sticky top-0 z-40 border-b border-green-deeper bg-green-dark pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 w-full items-center justify-between gap-3 px-4 sm:h-14 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/brands/warmtefonds-logo.png"
              alt="Nationaal Warmtefonds"
              width={100}
              height={30}
              className="hidden h-6 w-auto shrink-0 object-contain brightness-0 invert sm:block"
            />
            <Link
              href={`/warmtefonds/${token}`}
              className="text-[12px] font-semibold text-white/80 hover:text-white"
            >
              ← Projecten
            </Link>
          </div>
          <p className="truncate font-mono text-[11px] text-white/60">
            {order.project_nummer}
          </p>
        </div>
      </header>

      <main className="w-full flex-1 px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
        {(error || okMsg) && (
          <div className="mb-4 space-y-2">
            {error ? (
              <Alert className="border-[#C45A12]/30 bg-[#FFF0E6] text-[#C45A12]">
                <AlertDescription className="text-xs text-[#C45A12]">
                  {error}
                </AlertDescription>
              </Alert>
            ) : null}
            {okMsg ? (
              <Alert className="border-green/30 bg-green-soft text-green-dark">
                <AlertDescription className="text-xs text-green-dark">
                  {okMsg}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        )}

        {isGestopt ? (
          <div
            className={[
              "mb-4 flex flex-wrap items-center gap-3 border px-4 py-3",
              isAnnulering
                ? "border-[#B91C1C]/35 bg-[#FEF2F2] text-[#B91C1C]"
                : "border-[#5A4A6E]/35 bg-[#F0ECF5] text-[#4A3A5C]",
            ].join(" ")}
            role="status"
          >
            <span
              className={[
                "inline-flex border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                isAnnulering
                  ? "border-[#B91C1C]/40 bg-white"
                  : "border-[#5A4A6E]/40 bg-white",
              ].join(" ")}
            >
              {stopLabel}
            </span>
            <p className="min-w-0 flex-1 text-sm font-semibold">{stopUitleg}</p>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
          {/* MAIN — zoals referentie */}
          <div
            className={[
              "relative min-w-0 space-y-3 overflow-hidden rounded-xl border bg-white p-4 shadow-sm sm:p-5",
              isGestopt
                ? isAnnulering
                  ? "border-[#B91C1C]/40"
                  : "border-[#5A4A6E]/40"
                : "border-line",
            ].join(" ")}
          >
            {isGestopt ? (
              <>
                {/* Schuine streep over de inhoud */}
                <div
                  className="pointer-events-none absolute inset-0 z-20"
                  aria-hidden
                >
                  <div
                    className={[
                      "absolute left-[-20%] top-1/2 h-[3px] w-[140%] -translate-y-1/2 -rotate-[18deg]",
                      isAnnulering ? "bg-[#B91C1C]/55" : "bg-[#5A4A6E]/50",
                    ].join(" ")}
                  />
                  <div
                    className={[
                      "absolute left-[-20%] top-[58%] h-px w-[140%] -translate-y-1/2 -rotate-[18deg]",
                      isAnnulering ? "bg-[#B91C1C]/25" : "bg-[#5A4A6E]/25",
                    ].join(" ")}
                  />
                </div>
                <div
                  className={[
                    "pointer-events-none absolute inset-0 z-10",
                    isAnnulering ? "bg-[#FEF2F2]/35" : "bg-[#F0ECF5]/40",
                  ].join(" ")}
                  aria-hidden
                />
              </>
            ) : null}
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-semibold text-muted">
                  {order.project_nummer}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <h1
                    className={[
                      "font-display text-2xl font-semibold tracking-tight text-ink",
                      isGestopt ? "line-through decoration-2 opacity-70" : "",
                    ].join(" ")}
                  >
                    {klantNaam}
                  </h1>
                  {isGestopt ? (
                    <span
                      className={[
                        "inline-flex border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        isAnnulering
                          ? "border-[#B91C1C]/30 bg-[#FEF2F2] text-[#B91C1C]"
                          : "border-[#5A4A6E]/30 bg-[#F0ECF5] text-[#4A3A5C]",
                      ].join(" ")}
                    >
                      {stopLabel}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted">
                  {lead ? adresRegel(lead) || "—" : "—"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {telHref ? (
                    <a
                      href={telHref}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "gap-1.5 rounded-full border-line bg-wash"
                      )}
                    >
                      <Phone className="size-3.5" />
                      {lead?.telefoon}
                    </a>
                  ) : null}
                  {lead?.email ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 rounded-full"
                      onClick={() => void openContact()}
                    >
                      <Mail className="size-3.5" />
                      Mailen
                      {Number(order.warmtefonds_contact_pogingen) > 0
                        ? ` · ${order.warmtefonds_contact_pogingen}×`
                        : ""}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="w-full sm:w-auto sm:min-w-[13.5rem]">
                <p className={SECTION_TITLE}>Status</p>
                <NativeSelect
                  className="mt-1 w-full"
                  value={werk ?? ""}
                  disabled={busy === "status" || isGestopt}
                  onChange={(e) => {
                    const v = e.target.value as WfWerkStatus;
                    if (!v) return;
                    void setWerkStatus(v);
                  }}
                >
                  {!werk ? (
                    <NativeSelectOption value="">Kies status</NativeSelectOption>
                  ) : null}
                  {WF_WERK_STATUSSEN.map((step) => (
                    <NativeSelectOption key={step} value={step}>
                      {WF_WERK_LABEL[step]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>

            {/* Bedragen */}
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-line bg-wash/40 px-3 py-2.5">
                <p className={SECTION_TITLE}>Warmtefonds-deel</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-green-dark">
                  {euroOfStreep(order.bedragen?.warmtefondsInc)}
                </p>
              </div>
              <div className="rounded-lg border border-line bg-wash/40 px-3 py-2.5">
                <p className={SECTION_TITLE}>Ordertotaal</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {euroOfStreep(order.bedragen?.totaalInc)}
                </p>
              </div>
              <div className="rounded-lg border border-line bg-wash/40 px-3 py-2.5">
                <p className={SECTION_TITLE}>Aanbetaling</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="text-lg font-semibold tabular-nums text-ink">
                    {euroOfStreep(order.bedragen?.aanbetalingInc)}
                  </p>
                  {openstaandeFacturen > 0 ? (
                    <Badge
                      variant="secondary"
                      className="border-transparent bg-[#FFF0E6] text-[10px] text-[#C45A12]"
                    >
                      Onbetaald
                    </Badge>
                  ) : betaaldeFacturen > 0 ? (
                    <Badge
                      variant="secondary"
                      className="border-transparent bg-green-soft text-[10px] text-green-dark"
                    >
                      Betaald
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Horizontale stepper */}
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <ol className="flex w-full min-w-[36rem] items-start gap-0 lg:min-w-0">
                {WF_WERK_STATUSSEN.map((step, idx) => {
                  const active = werk === step;
                  const done = werkIdx >= 0 && idx < werkIdx;
                  const last = idx === WF_WERK_STATUSSEN.length - 1;
                  return (
                    <li key={step} className="relative flex flex-1 flex-col items-center">
                      {!last ? (
                        <span
                          aria-hidden
                          className={cn(
                            "absolute top-3 left-[calc(50%+0.75rem)] right-[calc(-50%+0.75rem)] h-0.5",
                            done || active ? "bg-green-dark" : "bg-line"
                          )}
                        />
                      ) : null}
                      <button
                        type="button"
                        disabled={busy === "status"}
                        title={WF_WERK_STAP_UITLEG[step]}
                        onClick={() => {
                          if (active) return;
                          void setWerkStatus(step);
                        }}
                        className="relative z-[1] flex flex-col items-center gap-1.5 disabled:opacity-60"
                      >
                        <span
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                            active || done
                              ? "bg-green-dark text-white"
                              : "bg-wash text-muted ring-1 ring-line"
                          )}
                        >
                          {done && !active ? "✓" : idx + 1}
                        </span>
                        <span
                          className={cn(
                            "max-w-[6.5rem] text-center text-[10px] leading-tight font-medium xl:max-w-none xl:text-[11px]",
                            active
                              ? "font-semibold text-green-dark"
                              : done
                                ? "text-ink"
                                : "text-muted"
                          )}
                        >
                          {WF_WERK_LABEL[step]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* Volgende stap / gestopt */}
            {isGestopt ? (
              <div
                className={[
                  "relative z-30 rounded-xl border px-4 py-4",
                  isAnnulering
                    ? "border-[#B91C1C]/30 bg-[#FEF2F2]"
                    : "border-[#5A4A6E]/30 bg-[#F0ECF5]",
                ].join(" ")}
              >
                <p
                  className={[
                    "text-[10px] font-semibold uppercase tracking-[0.08em]",
                    isAnnulering ? "text-[#B91C1C]/80" : "text-[#4A3A5C]/80",
                  ].join(" ")}
                >
                  {stopLabel}
                </p>
                <h2
                  className={[
                    "mt-1 font-display text-lg font-semibold",
                    isAnnulering ? "text-[#B91C1C]" : "text-[#4A3A5C]",
                  ].join(" ")}
                >
                  Niet meer relevant
                </h2>
                <p
                  className={[
                    "mt-1 text-sm",
                    isAnnulering ? "text-[#B91C1C]/90" : "text-[#4A3A5C]/90",
                  ].join(" ")}
                >
                  {stopUitleg}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-green-dark/15 bg-green-soft/70 px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-green-dark/80">
                  Volgende stap
                </p>
                <h2 className="mt-1 font-display text-lg font-semibold text-ink">
                  {poort.soort === "contact"
                    ? "Neem contact op met de klant"
                    : poort.titel}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {poort.soort === "contact"
                    ? "Bel of mail de klant en leg het contact vast."
                    : poort.uitleg}
                </p>
                <div className="mt-3">
                  {poort.soort === "contact" ? (
                    <Button
                      type="button"
                      className="w-full sm:w-auto"
                      onClick={() => void openContact()}
                    >
                      {poort.ctaLabel || "Contact opnemen"}
                    </Button>
                  ) : null}
                  {poort.soort === "afspraak" ? (
                    <Button
                      type="button"
                      className="w-full bg-[#1A4A6E] hover:bg-[#143A57] sm:w-auto"
                      onClick={() => setAfspraakOpen(true)}
                    >
                      {poort.ctaLabel}
                    </Button>
                  ) : null}
                  {poort.soort === "status" && poort.volgende ? (
                    <Button
                      type="button"
                      className="w-full sm:w-auto"
                      disabled={busy === "status"}
                      onClick={() => void setWerkStatus(poort.volgende!)}
                    >
                      {busy === "status" ? "Bezig…" : poort.ctaLabel}
                    </Button>
                  ) : null}
                  {poort.soort === "klaar" ? (
                    <p className="text-sm font-semibold text-green-dark">
                      Dit project is afgerond.
                    </p>
                  ) : null}
                </div>
              </div>
            )}

            {/* Afspraak-rij */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
              <div>
                <p className={SECTION_TITLE}>Warmtefonds-afspraak</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                  {order.warmtefonds_afspraak_at
                    ? formatDateTimeNl(order.warmtefonds_afspraak_at)
                    : "Nog niet gepland"}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isGestopt}
                onClick={() => setAfspraakOpen(true)}
              >
                {order.warmtefonds_afspraak_at
                  ? "Wijzigen"
                  : "Afspraak plannen"}
              </Button>
            </div>

            {/* Documenten */}
            <div>
              <p className={SECTION_TITLE}>Documenten</p>
              {documentenCount === 0 ? (
                <p className="mt-2 text-sm text-muted">Nog geen documenten</p>
              ) : (
                <div className="mt-2 overflow-hidden rounded-lg border border-line">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-line bg-wash/60 text-[11px] text-muted">
                        <th className="px-3 py-2 font-semibold">Document</th>
                        <th className="px-2 py-2 text-right font-semibold">
                          Bedrag
                        </th>
                        <th className="px-2 py-2 text-right font-semibold">
                          Status
                        </th>
                        <th className="w-10 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {off ? (
                        <tr className="border-b border-line last:border-b-0">
                          <td className="px-3 py-2.5 font-medium text-ink">
                            Offerte
                            {off.offerte_nummer
                              ? ` ${off.offerte_nummer}`
                              : ""}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2.5 text-right font-medium tabular-nums text-ink">
                            {euroOfStreep(order.bedragen?.totaalInc)}
                          </td>
                          <td className="px-2 py-2.5 text-right">
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-[10px]",
                                offerteStatus === "ondertekend"
                                  ? "border-transparent bg-green-soft text-green-dark"
                                  : "text-muted"
                              )}
                            >
                              {offerteStatus === "ondertekend"
                                ? "Ondertekend"
                                : offerteStatus === "verzonden"
                                  ? "Verzonden"
                                  : "Concept"}
                            </Badge>
                          </td>
                          <td className="px-2 py-2.5 text-right">
                            <a
                              href={`/api/warmtefonds/${token}/orders/${order.id}/offerte`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-wash hover:text-ink"
                              aria-label="Offerte openen"
                            >
                              <Download className="size-3.5" />
                            </a>
                          </td>
                        </tr>
                      ) : null}
                      {facturen.map((f) => {
                        const badge = factuurBetaalBadge(f.status);
                        return (
                          <tr
                            key={f.id}
                            className="border-b border-line last:border-b-0"
                          >
                            <td className="px-3 py-2.5">
                              <p className="font-medium text-ink">
                                {factuurTitel(f)}
                                {f.nummer && f.nummer !== "—"
                                  ? ` ${f.nummer}`
                                  : ""}
                              </p>
                              {!f.isCredit && f.status === "concept" ? (
                                <Button
                                  type="button"
                                  size="xs"
                                  className="mt-1.5"
                                  disabled={busy === `factuur:${f.id}`}
                                  onClick={() => void verstuurFactuur(f.id)}
                                >
                                  {busy === `factuur:${f.id}`
                                    ? "Bezig…"
                                    : "Versturen"}
                                </Button>
                              ) : null}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2.5 text-right font-medium tabular-nums text-ink">
                              {euroOfStreep(f.bedragInc)}
                            </td>
                            <td className="px-2 py-2.5 text-right">
                              <Badge
                                variant="secondary"
                                className={cn("text-[10px]", badge.tone)}
                              >
                                {f.isCredit ? "Credit" : badge.label}
                              </Badge>
                            </td>
                            <td className="px-2 py-2.5 text-right">
                              <a
                                href={f.pdf}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-wash hover:text-ink"
                                aria-label="Document openen"
                              >
                                <Download className="size-3.5" />
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Projectnotitie */}
            <div>
              <p className={SECTION_TITLE}>Projectnotitie</p>
              <Textarea
                value={wfNotities}
                onChange={(e) => setWfNotities(e.target.value)}
                rows={3}
                className="mt-2 min-h-20"
                placeholder="Wat speelt er op dit project…"
              />
              <Button
                type="button"
                size="sm"
                className="mt-2"
                disabled={busy === "notities"}
                onClick={() =>
                  void patch(
                    { warmtefonds_notities: wfNotities },
                    "notities",
                    "Notitie opgeslagen."
                  )
                }
              >
                {busy === "notities" ? "Bezig…" : "Opslaan"}
              </Button>
            </div>
          </div>

          {/* Activiteiten */}
          <aside className="min-w-0 lg:sticky lg:top-[4.25rem] lg:self-start">
            <section className="rounded-xl border border-line bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink">Activiteiten</p>
                {events.length > 0 ? (
                  <button
                    type="button"
                    className="text-[12px] font-semibold text-green-dark hover:underline"
                    onClick={() => setShowAllEvents((v) => !v)}
                  >
                    {showAllEvents ? "Minder" : `Alles (${events.length})`}
                  </button>
                ) : null}
              </div>
              <div className="mt-3 flex gap-2">
                <Input
                  value={nieuweNotitie}
                  onChange={(e) => setNieuweNotitie(e.target.value)}
                  placeholder="Schrijf een update…"
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const t = nieuweNotitie.trim();
                    if (!t) return;
                    void patch(
                      { notitie: t },
                      "notitie",
                      "Notitie toegevoegd."
                    ).then(() => setNieuweNotitie(""));
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  className="shrink-0"
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
                >
                  <Plus className="size-4" />
                </Button>
              </div>
              <ul className="mt-4 max-h-[min(60vh,520px)] space-y-0 overflow-y-auto">
                {events.length === 0 ? (
                  <li className="py-2 text-xs text-muted">Nog geen updates.</li>
                ) : (
                  (showAllEvents ? events : events.slice(0, 8)).map(
                    (ev, idx) => (
                      <li key={ev.id} className="flex gap-2.5 py-2">
                        <span className="relative mt-1.5 flex w-2.5 shrink-0 justify-center">
                          <span
                            className={cn(
                              "size-2 rounded-full",
                              idx === 0 ? "bg-green-dark" : "bg-line"
                            )}
                          />
                          {idx <
                          (showAllEvents ? events : events.slice(0, 8))
                            .length -
                            1 ? (
                            <span
                              aria-hidden
                              className="absolute top-3 bottom-[-0.75rem] w-px bg-line"
                            />
                          ) : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium leading-snug text-ink">
                            {ev.soort === "bel" ? (
                              <span className="mr-1.5 inline-flex items-center rounded bg-[#EEF4FF] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#1D4ED8]">
                                Bel
                              </span>
                            ) : null}
                            {ev.titel}
                          </p>
                          {ev.detail ? (
                            <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-snug text-muted">
                              {ev.detail}
                            </p>
                          ) : null}
                          <p className="mt-0.5 text-[11px] text-muted">
                            {formatDateTimeNl(ev.created_at)}
                          </p>
                        </div>
                      </li>
                    )
                  )
                )}
              </ul>
            </section>
          </aside>
        </div>
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

      <Dialog
        open={declaratieConfirmOpen}
        onOpenChange={(open) => {
          setDeclaratieConfirmOpen(open);
          if (!open) setDeclaratieFactuur(null);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
          {!declaratieFactuur ? (
            <>
              <DialogHeader>
                <DialogTitle>Declaratiefactuur aanmaken?</DialogTitle>
                <DialogDescription>
                  Je zet deze aanvraag op{" "}
                  <span className="font-semibold text-foreground">
                    Aanbod ondertekenen
                  </span>
                  . Wil je nu de Warmtefonds-declaratiefactuur aanmaken?
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border border-line bg-wash/50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Factuur declaratie
                </p>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-green-dark">
                  {euroOfStreep(order.bedragen?.warmtefondsInc)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Zelfde bedrag als het Warmtefonds-deel (max. plafond).
                </p>
              </div>
              <DialogFooter className="sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy === "status"}
                  onClick={() => setDeclaratieConfirmOpen(false)}
                >
                  Nee
                </Button>
                <Button
                  type="button"
                  disabled={busy === "status"}
                  onClick={() => void bevestigDeclaratieFactuur()}
                >
                  {busy === "status" ? "Bezig…" : "Ja, aanmaken"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Declaratiefactuur klaar</DialogTitle>
                <DialogDescription>
                  {declaratieFactuur.created
                    ? "Conceptfactuur is aangemaakt."
                    : "Bestaande conceptfactuur is bijgewerkt."}{" "}
                  Verstuur naar de klant of download zelf.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border border-line bg-wash/50 px-4 py-3">
                <p className="text-sm font-semibold text-ink">
                  {declaratieFactuur.nummer || "Concept"}
                </p>
                <p className="mt-1 font-display text-xl font-semibold tabular-nums text-green-dark">
                  {euroOfStreep(declaratieFactuur.bedragInc)}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  className="w-full gap-1.5"
                  disabled={busy === `factuur:${declaratieFactuur.id}`}
                  onClick={() => {
                    void verstuurFactuur(declaratieFactuur.id).then((ok) => {
                      if (ok) setDeclaratieConfirmOpen(false);
                    });
                  }}
                >
                  <Send className="size-3.5" />
                  {busy === `factuur:${declaratieFactuur.id}`
                    ? "Verzenden…"
                    : "Versturen naar klant"}
                </Button>
                <a
                  href={declaratieFactuur.pdf}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "w-full gap-1.5"
                  )}
                >
                  <Download className="size-3.5" />
                  Downloaden
                </a>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDeclaratieConfirmOpen(false)}
                >
                  Sluiten
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

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
