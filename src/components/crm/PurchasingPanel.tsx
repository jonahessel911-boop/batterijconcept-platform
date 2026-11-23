"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Search, ShoppingCart } from "lucide-react";
import { formatEuro, formatSlotLabelNl } from "@/lib/format";
import {
  INKOOP_BESTEL_BEVESTIGING_KEY,
  INKOOP_BESTEL_BEVESTIGING_TEKST,
  INKOOP_LEVERANCIER,
  INKOOP_LEVERANCIER_STATUS_LABEL,
  type InkoopLeverancierStatus,
  type InkoopRegelStatus,
} from "@/lib/project-inkoop-checklist";
import { bestelDeadlineVoorInstallatie } from "@/lib/inkoop-sla";
import { apexProductUrl } from "@/lib/apex-product-url";
import { inkoopProductImageFor } from "@/lib/inkoop-product-images";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PurchasingShop } from "./PurchasingShop";
import type {
  PurchasingDesk,
  PurchasingOrder,
  PurchasingSchouwInfo,
} from "./purchasing-types";

type SchouwInfo = PurchasingSchouwInfo;
type Desk = PurchasingDesk;

function defaultLeverdatumYmd(daysAhead = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Vraagt leverdatum (jjjj-mm-dd). null = geannuleerd. */
function askLeverdatum(existingIso?: string | null): string | null {
  const def = existingIso?.slice(0, 10) || defaultLeverdatumYmd(7);
  const raw = window.prompt(
    "Verwachte leverdatum (jjjj-mm-dd) — komt oranje op Planbord:",
    def
  );
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    window.alert("Ongeldige datum. Gebruik formaat jjjj-mm-dd.");
    return askLeverdatum(existingIso);
  }
  return trimmed;
}

function defaultSchouw(): SchouwInfo {
  return {
    kind: "niet",
    at: null,
    week_label: null,
    formulier_url: null,
    formulier_naam: null,
  };
}

function isOpenInkoop(o: PurchasingOrder): boolean {
  return o.summary.overall === "te_kopen" || o.summary.overall === "deels";
}

function openEuro(o: PurchasingOrder): number {
  let n = 0;
  for (const i of o.items) {
    if (i.status === "te_kopen") n += i.inkoop_ex_btw * (i.aantal || 1);
  }
  return Math.round(n * 100) / 100;
}

function deskOf(o: PurchasingOrder): Exclude<Desk, "te_betalen"> {
  if (o.summary.overall === "geleverd") return "geleverd";
  if (o.summary.overall === "besteld") return "onderweg";
  // Te bestellen pas als de installatie gepland is én de klant betaald heeft.
  // Besteldatum = 5 werkdagen vóór de installatie.
  const klantOk =
    o.klant_betaling == null ? true : Boolean(o.klant_betaling.volledig);
  if (o.installatie_at && klantOk && isOpenInkoop(o)) return "bestellen";
  return "pipeline";
}

function KlantBetalingBar({
  betaling,
}: {
  betaling: NonNullable<PurchasingOrder["klant_betaling"]>;
}) {
  const pct = Math.min(100, Math.max(0, betaling.pct));
  const done = betaling.volledig || pct >= 100;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-1">
        <p
          className={[
            "text-[10px] font-semibold tabular-nums",
            done ? "text-green-dark" : "text-[#C45A12]",
          ].join(" ")}
        >
          {pct}%
        </p>
        <p className="truncate text-[10px] text-muted">
          {done ? "Volledig" : "Klant"}
        </p>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-wash">
        <div
          className={[
            "h-full rounded-full transition-[width]",
            done ? "bg-green" : "bg-[#C45A12]",
          ].join(" ")}
          style={{ width: `${Math.max(pct, pct > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function levBadge(status: InkoopLeverancierStatus): {
  label: string;
  className: string;
} {
  if (status === "op_krediet") {
    return {
      label: INKOOP_LEVERANCIER_STATUS_LABEL.op_krediet,
      className: "text-[#C45A12]",
    };
  }
  if (status === "betaald") {
    return {
      label: INKOOP_LEVERANCIER_STATUS_LABEL.betaald,
      className: "text-green-dark",
    };
  }
  return { label: "—", className: "text-muted" };
}

function schouwWhen(schouw: SchouwInfo): string {
  if (schouw.kind === "voltooid") return "Rapport binnen";
  if (schouw.kind === "dag" && schouw.at) {
    return formatSlotLabelNl(schouw.at, { kort: true });
  }
  if (schouw.kind === "dag") return "Schouwdag gepland";
  if (schouw.kind === "week" && schouw.week_label) return schouw.week_label;
  if (schouw.kind === "week") return "Schouwweek gepland";
  return "Nog niet gepland";
}

function schouwHint(schouw: SchouwInfo): string {
  if (schouw.kind === "voltooid") return "PDF binnen";
  if (schouw.kind === "dag" || schouw.kind === "week") return "Wacht op schouw";
  return "Schouw plannen";
}

function installatieWhen(at: string | null): string {
  if (at) return formatSlotLabelNl(at, { kort: true });
  return "Nog niet gepland";
}

function installatieHint(order: PurchasingOrder): {
  text: string;
  tone: "ok" | "warn" | "muted";
} {
  if (!order.installatie_at) {
    return { text: "Installatie plannen", tone: "muted" };
  }
  const open = isOpenInkoop(order);
  if (!open) {
    return { text: "Gepland", tone: "ok" };
  }
  const due = bestelDeadlineVoorInstallatie(order.installatie_at);
  const overdue = due.getTime() < Date.now();
  return {
    text: overdue
      ? `Te laat · bestel vóór ${formatSlotLabelNl(due.toISOString(), { kort: true })}`
      : `Bestel vóór ${formatSlotLabelNl(due.toISOString(), { kort: true })}`,
    tone: overdue ? "warn" : "ok",
  };
}

function pipelineSortKey(o: PurchasingOrder): string {
  const pct = o.klant_betaling?.pct ?? 100;
  const pay = String(pct).padStart(3, "0");
  if (o.schouw.at) return `${pay}:0:${o.schouw.at}`;
  if (o.schouw.week_label) return `${pay}:1:${o.schouw.week_label}`;
  return `${pay}:2:${o.updated_at || ""}`;
}

type WfForecast5w = {
  horizon_days: number;
  van: string;
  tot: string;
  orders: number;
  omzet_ex_btw: number;
  omzet_inc_btw: number;
  inkoop_ex_btw: number;
  inkoop_te_bestellen_ex_btw: number;
  inkoop_besteld_ex_btw: number;
};

export function PurchasingPanel() {
  const [orders, setOrders] = useState<PurchasingOrder[]>([]);
  const [leverancier, setLeverancier] = useState(INKOOP_LEVERANCIER);
  const [wfForecast, setWfForecast] = useState<WfForecast5w | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<"overzicht" | "winkel">("overzicht");
  const [desk, setDesk] = useState<Desk>("bestellen");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [shopProjectId, setShopProjectId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [autoSwitched, setAutoSwitched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inkoop/orders");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setOrders(
        ((data.orders || []) as PurchasingOrder[]).map((o) => ({
          ...o,
          schouw: o.schouw || defaultSchouw(),
          installatie_at: o.installatie_at || null,
          inkoop_leverancier_status: o.inkoop_leverancier_status || "geen",
          inkoop_leverancier_betaald_op:
            o.inkoop_leverancier_betaald_op || null,
          klant_betaling: o.klant_betaling || null,
        }))
      );
      setLeverancier(data.leverancier || INKOOP_LEVERANCIER);
      setWfForecast(
        data.wf_forecast_5w
          ? (data.wf_forecast_5w as WfForecast5w)
          : null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  const byDesk = useMemo(() => {
    const buckets: Record<Desk, PurchasingOrder[]> = {
      bestellen: [],
      pipeline: [],
      onderweg: [],
      geleverd: [],
      te_betalen: [],
    };
    for (const o of orders) {
      buckets[deskOf(o)].push(o);
      if (o.inkoop_leverancier_status === "op_krediet") {
        buckets.te_betalen.push(o);
      }
    }
    buckets.bestellen.sort((a, b) => {
      const ad = a.installatie_at
        ? bestelDeadlineVoorInstallatie(a.installatie_at).getTime()
        : Number.MAX_SAFE_INTEGER;
      const bd = b.installatie_at
        ? bestelDeadlineVoorInstallatie(b.installatie_at).getTime()
        : Number.MAX_SAFE_INTEGER;
      return ad - bd || openEuro(b) - openEuro(a);
    });
    buckets.pipeline.sort((a, b) =>
      pipelineSortKey(a).localeCompare(pipelineSortKey(b))
    );
    buckets.onderweg.sort((a, b) =>
      (b.updated_at || "").localeCompare(a.updated_at || "")
    );
    buckets.geleverd.sort((a, b) =>
      (b.updated_at || "").localeCompare(a.updated_at || "")
    );
    buckets.te_betalen.sort(
      (a, b) =>
        (b.besteld_ex_btw || b.inkoop_totaal_ex_btw) -
          (a.besteld_ex_btw || a.inkoop_totaal_ex_btw) ||
        (b.updated_at || "").localeCompare(a.updated_at || "")
    );
    return buckets;
  }, [orders]);

  const counts = useMemo(
    () => ({
      bestellen: byDesk.bestellen.length,
      pipeline: byDesk.pipeline.length,
      onderweg: byDesk.onderweg.length,
      geleverd: byDesk.geleverd.length,
      te_betalen: byDesk.te_betalen.length,
    }),
    [byDesk]
  );

  // Eerste load: als er niets te bestellen is, open pipeline
  useEffect(() => {
    if (loading || autoSwitched) return;
    setAutoSwitched(true);
    if (counts.bestellen === 0 && counts.pipeline > 0) {
      setDesk("pipeline");
    }
  }, [loading, autoSwitched, counts.bestellen, counts.pipeline]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = byDesk[desk];
    if (!needle) return list;
    return list.filter((o) => {
      const hay = [
        o.project_nummer,
        o.klant,
        o.leveradres,
        o.offerte_nummer,
        o.lead_number,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [byDesk, desk, q]);

  async function persistChecks(
    order: PurchasingOrder,
    nextChecks: Record<string, InkoopRegelStatus | string>,
    opts?: {
      reload?: boolean;
      askLeverdatum?: boolean;
      leverdatumYmd?: string;
      leverancierStatus?: InkoopLeverancierStatus;
    }
  ) {
    const items = order.items.map((i) => ({
      ...i,
      status: (nextChecks[i.key] as InkoopRegelStatus) || i.status,
    }));
    const activeItems = items.filter((i) => i.status !== "geannuleerd");
    const allBesteldOrMore =
      activeItems.length > 0 &&
      activeItems.every(
        (i) => i.status === "besteld" || i.status === "geleverd"
      );
    const allGeleverd =
      activeItems.length > 0 &&
      activeItems.every((i) => i.status === "geleverd");
    const wasAlreadyBesteld =
      order.summary.overall === "besteld" ||
      order.summary.overall === "geleverd";

    let leverdatumYmd: string | null | undefined = opts?.leverdatumYmd;
    if (
      leverdatumYmd === undefined &&
      allBesteldOrMore &&
      !allGeleverd &&
      (opts?.askLeverdatum || !wasAlreadyBesteld || !order.materiaal_leverdatum)
    ) {
      leverdatumYmd = askLeverdatum(order.materiaal_leverdatum);
      if (leverdatumYmd === null) {
        throw new Error("Geannuleerd — geen leverdatum opgegeven.");
      }
    }

    let nextLevStatus = order.inkoop_leverancier_status;
    if (opts?.leverancierStatus) {
      nextLevStatus = opts.leverancierStatus;
    } else if (
      allBesteldOrMore &&
      order.inkoop_leverancier_status === "geen"
    ) {
      // Veilig default: op krediet tot expliciet betaald
      nextLevStatus = "op_krediet";
    } else if (!allBesteldOrMore && order.summary.te_kopen === items.length) {
      nextLevStatus = "geen";
    }

    const body: Record<string, unknown> = {
      materiaal_checks: nextChecks,
    };
    if (allBesteldOrMore && order.status === "restfactuur_betaald") {
      body.status = "materiaal_besteld";
      body.materiaal_volledig_afgevinkt = true;
    }
    if (leverdatumYmd) {
      body.materiaal_leverdatum = leverdatumYmd;
    }
    if (nextLevStatus !== order.inkoop_leverancier_status || opts?.leverancierStatus) {
      body.inkoop_leverancier_status = nextLevStatus;
    }

    const res = await fetch(`/api/projecten/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data as { error?: string; detail?: string };
      throw new Error(
        [err.error || "Opslaan mislukt", err.detail].filter(Boolean).join(" — ")
      );
    }

    if (opts?.reload) {
      await load();
    } else {
      setOrders((prev) =>
        prev.map((o) => {
          if (o.id !== order.id) return o;
          let te_kopen = 0;
          let besteld = 0;
          let geleverd = 0;
          let active = 0;
          for (const i of items) {
            if (i.status === "geannuleerd") continue;
            active += 1;
            if (i.status === "geleverd") geleverd += 1;
            else if (i.status === "besteld") besteld += 1;
            else te_kopen += 1;
          }
          let overall: InkoopRegelStatus | "deels" = "te_kopen";
          if (active > 0 && geleverd === active) overall = "geleverd";
          else if (active > 0 && te_kopen === 0) overall = "besteld";
          else if (besteld > 0 || geleverd > 0) overall = "deels";
          return {
            ...o,
            status:
              allBesteldOrMore && o.status === "restfactuur_betaald"
                ? "materiaal_besteld"
                : o.status,
            materiaal_leverdatum: leverdatumYmd
              ? `${leverdatumYmd}T09:00:00.000Z`
              : o.materiaal_leverdatum,
            inkoop_leverancier_status: nextLevStatus,
            inkoop_leverancier_betaald_op:
              nextLevStatus === "betaald"
                ? new Date().toISOString()
                : nextLevStatus === "op_krediet"
                  ? null
                  : o.inkoop_leverancier_betaald_op,
            items,
            summary: { te_kopen, besteld, geleverd, overall },
          };
        })
      );
    }

    if (allGeleverd) {
      setOkMsg(`${order.project_nummer || "Order"} · alles geleverd.`);
    } else if (allBesteldOrMore) {
      const levLabel =
        nextLevStatus === "betaald"
          ? " · betaald"
          : nextLevStatus === "op_krediet"
            ? " · op krediet"
            : "";
      setOkMsg(
        `${order.project_nummer || "Order"} · besteld bij ${leverancier}${levLabel}${
          leverdatumYmd ? ` · levering ${leverdatumYmd}` : ""
        }.`
      );
    }
  }

  async function setLeverancierBetaling(
    order: PurchasingOrder,
    status: InkoopLeverancierStatus
  ) {
    setBusyKey(`${order.id}:lev`);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/projecten/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inkoop_leverancier_status: status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id
            ? {
                ...o,
                inkoop_leverancier_status: status,
                inkoop_leverancier_betaald_op:
                  status === "betaald"
                    ? new Date().toISOString()
                    : null,
              }
            : o
        )
      );
      await load();
      setOkMsg(
        status === "betaald"
          ? `${order.project_nummer || "Order"} · leverancier betaald.`
          : `${order.project_nummer || "Order"} · op krediet gezet.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusyKey(null);
    }
  }

  async function setLineStatus(
    order: PurchasingOrder,
    key: string,
    status: InkoopRegelStatus
  ) {
    setBusyKey(`${order.id}:${key}`);
    setError(null);
    setOkMsg(null);
    try {
      const nextChecks: Record<string, InkoopRegelStatus> = {};
      for (const item of order.items) {
        nextChecks[item.key] = item.key === key ? status : item.status;
      }
      await persistChecks(order, nextChecks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusyKey(null);
    }
  }

  async function markAll(
    order: PurchasingOrder,
    status: InkoopRegelStatus,
    leverancierStatus?: InkoopLeverancierStatus
  ) {
    setBusyKey(`${order.id}:all`);
    setError(null);
    setOkMsg(null);
    try {
      const nextChecks: Record<string, InkoopRegelStatus> = {};
      for (const item of order.items) {
        nextChecks[item.key] =
          item.status === "geannuleerd" ? "geannuleerd" : status;
      }
      await persistChecks(order, nextChecks, {
        reload: true,
        askLeverdatum: status === "besteld",
        leverancierStatus:
          status === "besteld"
            ? leverancierStatus || "op_krediet"
            : undefined,
      });
      setOpenId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusyKey(null);
    }
  }

  async function checkoutFromShop(input: {
    order: PurchasingOrder;
    itemKeys: string[];
    klantNaam: string;
    leveradres: string;
    leverdatumYmd: string;
    leverancierStatus: InkoopLeverancierStatus;
    handtekening: string;
    bevestigd: boolean;
  }) {
    if (!input.bevestigd) {
      setError("Bevestig dat je het schouwrapport en de inkoop hebt doorgenomen.");
      return;
    }
    if (!input.handtekening) {
      setError("Zet je krabbel om de bestelling te plaatsen.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.leverdatumYmd)) {
      setError("Vul een geldige leverdatum in.");
      return;
    }
    setBusyKey(`${input.order.id}:checkout`);
    setError(null);
    setOkMsg(null);
    try {
      const keys = new Set(input.itemKeys);
      const nextChecks: Record<string, InkoopRegelStatus | string> = {};
      for (const item of input.order.items) {
        nextChecks[item.key] =
          item.status === "geannuleerd"
            ? "geannuleerd"
            : keys.has(item.key)
              ? "besteld"
              : item.status;
      }
      nextChecks[INKOOP_BESTEL_BEVESTIGING_KEY] = JSON.stringify({
        at: new Date().toISOString(),
        klant: input.klantNaam.trim(),
        leveradres: input.leveradres.trim(),
        tekst: INKOOP_BESTEL_BEVESTIGING_TEKST,
        handtekening: input.handtekening,
      });
      await persistChecks(input.order, nextChecks, {
        reload: true,
        leverdatumYmd: input.leverdatumYmd,
        leverancierStatus: input.leverancierStatus,
      });
      if (input.leveradres.trim() && input.leveradres.trim() !== input.order.leveradres) {
        await fetch(`/api/projecten/${input.order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leveradres: input.leveradres.trim() }),
        }).catch(() => null);
      }
      setMainTab("overzicht");
      setDesk("onderweg");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bestellen mislukt");
    } finally {
      setBusyKey(null);
    }
  }

  function openWinkel(orderId: string) {
    setShopProjectId(orderId);
    setMainTab("winkel");
    setOpenId(null);
  }

  const openOrder = useMemo(
    () => orders.find((o) => o.id === openId) || null,
    [orders, openId]
  );

  const emptyCopy: Record<Desk, string> = {
    bestellen:
      "Niets te bestellen. Orders komen hier zodra de installatie is ingepland. Bestellen doe je 5 werkdagen vóór die datum.",
    pipeline:
      "Geen orders in pipeline (wacht op betaling, schouw of een installatiedatum).",
    onderweg: "Geen bestellingen onderweg.",
    geleverd: "Nog geen geleverde orders.",
    te_betalen: "Geen openstaande leveranciersfacturen (op krediet).",
  };

  return (
    <div className="space-y-4">
      <Card className="bg-white shadow-none">
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Purchasing</CardTitle>
              <CardDescription>
                Materiaal bij {leverancier} · gekoppeld aan projecten
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {mainTab === "overzicht" ? (
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Zoek project of klant…"
                    className="w-56 pl-8"
                  />
                </div>
              ) : null}
              <Button type="button" variant="outline" onClick={() => void load()}>
                Vernieuwen
              </Button>
            </div>
          </div>
          <Tabs
            value={mainTab}
            onValueChange={(id) => setMainTab(id as "overzicht" | "winkel")}
            className="mt-2"
          >
            <TabsList>
              <TabsTrigger value="overzicht">Overzicht</TabsTrigger>
              <TabsTrigger value="winkel">
                Winkel
                <ShoppingCart className="size-3.5" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        {wfForecast ? (
          <CardContent className="grid gap-3 border-b py-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Omzet (WF · 5 wkn)
              </p>
              <p className="mt-1 font-display text-xl font-semibold tabular-nums">
                {formatEuro(wfForecast.omzet_ex_btw)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {formatEuro(wfForecast.omzet_inc_btw)} incl. btw
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Uitgaand purchasing
              </p>
              <p className="mt-1 font-display text-xl font-semibold tabular-nums">
                {formatEuro(wfForecast.inkoop_te_bestellen_ex_btw)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                te bestellen · totaal {formatEuro(wfForecast.inkoop_ex_btw)}
              </p>
            </div>
          </CardContent>
        ) : null}
      </Card>

      {(error || okMsg) && (
        <p
          className={
            error
              ? "text-sm font-medium text-[#C45A12]"
              : "text-sm font-medium text-green-dark"
          }
        >
          {error || okMsg}
        </p>
      )}

      {mainTab === "winkel" ? (
        <PurchasingShop
          orders={orders}
          selectedId={shopProjectId}
          onSelectId={setShopProjectId}
          leverancier={leverancier}
          busy={Boolean(busyKey?.endsWith(":checkout"))}
          onCheckout={checkoutFromShop}
        />
      ) : (
        <Card className="bg-white shadow-none">
          <CardHeader className="border-b pb-3">
            <Tabs
              value={desk}
              onValueChange={(id) => {
                setDesk(id as Desk);
                setOpenId(null);
              }}
            >
              <TabsList variant="line" className="w-full justify-start">
                {(
                  [
                    ["bestellen", "Te bestellen", counts.bestellen],
                    ["pipeline", "Pipeline", counts.pipeline],
                    ["onderweg", "Onderweg", counts.onderweg],
                    ["te_betalen", "Nog te betalen", counts.te_betalen],
                    ["geleverd", "Geleverd", counts.geleverd],
                  ] as const
                ).map(([id, label, count]) => (
                  <TabsTrigger key={id} value={id}>
                    {label}
                    <Badge
                      variant={
                        (id === "bestellen" || id === "te_betalen") && count > 0
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {count}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="px-0">
            {loading ? (
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">
                Laden…
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">
                {q.trim()
                  ? "Geen resultaten voor deze zoekopdracht."
                  : emptyCopy[desk]}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Klant</TableHead>
                    <TableHead>Schouw</TableHead>
                    <TableHead>Installatie</TableHead>
                    <TableHead>Betaling</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Bedrag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((order) => {
                    const euro =
                      desk === "bestellen" || desk === "pipeline"
                        ? openEuro(order)
                        : desk === "te_betalen"
                          ? order.besteld_ex_btw ?? order.inkoop_totaal_ex_btw
                          : order.inkoop_totaal_ex_btw;
                    const badge = levBadge(order.inkoop_leverancier_status);
                    const hint = installatieHint(order);
                    return (
                      <TableRow
                        key={order.id}
                        className="cursor-pointer"
                        onClick={() =>
                          setOpenId((cur) =>
                            cur === order.id ? null : order.id
                          )
                        }
                      >
                        <TableCell>
                          <p className="font-medium">
                            {order.project_nummer || "Project"}
                          </p>
                          {order.offerte_nummer ? (
                            <p className="text-xs text-muted-foreground">
                              {order.offerte_nummer}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <p>{order.klant}</p>
                          {order.leveradres ? (
                            <p className="max-w-[16rem] truncate text-xs text-muted-foreground">
                              {order.leveradres}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <p className="text-sm">{schouwWhen(order.schouw)}</p>
                          <p
                            className={
                              order.schouw.kind === "voltooid"
                                ? "text-xs font-medium text-green-dark"
                                : "text-xs text-muted-foreground"
                            }
                          >
                            {schouwHint(order.schouw)}
                          </p>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm">
                            {installatieWhen(order.installatie_at)}
                          </p>
                          <p
                            className={
                              hint.tone === "warn"
                                ? "text-xs font-medium text-[#C45A12]"
                                : hint.tone === "ok"
                                  ? "text-xs text-green-dark"
                                  : "text-xs text-muted-foreground"
                            }
                          >
                            {hint.text}
                          </p>
                        </TableCell>
                        <TableCell>
                          {desk === "pipeline" && order.klant_betaling ? (
                            <KlantBetalingBar betaling={order.klant_betaling} />
                          ) : (
                            <span className={`text-xs font-medium ${badge.className}`}>
                              {badge.label}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {order.summary.te_kopen > 0
                            ? order.summary.te_kopen
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatEuro(euro)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Sheet
        open={Boolean(openOrder)}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      >
        <SheetContent side="right" className="sm:max-w-lg" showCloseButton>
          {openOrder ? (
            <>
              <SheetHeader>
                <SheetTitle>
                  {openOrder.project_nummer || "Project"} · {openOrder.klant}
                </SheetTitle>
                <SheetDescription>
                  {openOrder.leveradres || "Geen leveradres"}
                </SheetDescription>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
                <div className="flex flex-wrap gap-2 text-sm">
                  <Link
                    href={`/projecten/${openOrder.id}?from=purchasing`}
                    className="font-medium text-green-dark underline-offset-2 hover:underline"
                  >
                    Project
                  </Link>
                  {openOrder.schouw.formulier_url ? (
                    <a
                      href={openOrder.schouw.formulier_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-green-dark underline-offset-2 hover:underline"
                    >
                      <FileText className="size-3.5" />
                      Schouw-PDF
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Geen schouw-PDF</span>
                  )}
                </div>
                {openOrder.inkoop_extra_notities ? (
                  <p className="rounded-md bg-[#FFF8D6] px-2 py-1.5 text-xs">
                    {openOrder.inkoop_extra_notities}
                  </p>
                ) : null}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Aantal</TableHead>
                      <TableHead className="text-right">Ex btw</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openOrder.items.map((item) => {
                      const foto = inkoopProductImageFor(item.sku, item.label);
                      const cancelled = item.status === "geannuleerd";
                      return (
                        <TableRow key={item.key} className={cancelled ? "opacity-50" : ""}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-[#0a0a0a]">
                                {foto ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={foto.imageSrc}
                                    alt=""
                                    className="h-full w-full object-contain"
                                  />
                                ) : (
                                  <span className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                                    {(item.label || "?").charAt(0)}
                                  </span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className={cancelled ? "line-through" : "font-medium"}>
                                  {foto?.naam || item.label}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {item.sku || "—"} · {item.status}
                                </p>
                                {!cancelled ? (
                                  <a
                                    href={apexProductUrl(item.sku, item.label)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-medium text-green-dark hover:underline"
                                  >
                                    Apex
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {item.aantal}×
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatEuro(item.inkoop_ex_btw)}
                          </TableCell>
                          <TableCell className="text-right">
                            {cancelled ? (
                              <span className="text-xs text-muted-foreground">
                                Vervallen
                              </span>
                            ) : (
                              <NativeSelect
                                size="sm"
                                value={item.status}
                                disabled={
                                  busyKey === `${openOrder.id}:${item.key}`
                                }
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  void setLineStatus(
                                    openOrder,
                                    item.key,
                                    e.target.value as InkoopRegelStatus
                                  )
                                }
                              >
                                <NativeSelectOption value="te_kopen">
                                  Te bestellen
                                </NativeSelectOption>
                                <NativeSelectOption value="besteld">
                                  Besteld
                                </NativeSelectOption>
                                <NativeSelectOption value="geleverd">
                                  Geleverd
                                </NativeSelectOption>
                              </NativeSelect>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <SheetFooter>
                {isOpenInkoop(openOrder) ? (
                  <Button
                    type="button"
                    onClick={() => openWinkel(openOrder.id)}
                  >
                    <ShoppingCart />
                    Bestellen in winkel
                  </Button>
                ) : null}
                {openOrder.inkoop_leverancier_status === "op_krediet" ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busyKey === `${openOrder.id}:lev`}
                    onClick={() =>
                      void setLeverancierBetaling(openOrder, "betaald")
                    }
                  >
                    Markeer als betaald
                  </Button>
                ) : null}
                {openOrder.summary.overall === "besteld" ||
                openOrder.summary.overall === "deels" ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busyKey === `${openOrder.id}:all`}
                    onClick={() => void markAll(openOrder, "geleverd")}
                  >
                    Alles geleverd
                  </Button>
                ) : null}
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
