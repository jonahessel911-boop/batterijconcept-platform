"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDateShort, formatEuro, formatSlotLabelNl } from "@/lib/format";
import {
  INKOOP_LEVERANCIER,
  INKOOP_LEVERANCIER_STATUS_LABEL,
  type InkoopLeverancierStatus,
  type InkoopRegelStatus,
} from "@/lib/project-inkoop-checklist";
import { bestelDeadlineVoorInstallatie } from "@/lib/inkoop-sla";
import { apexProductUrl } from "@/lib/apex-product-url";
import { inkoopProductImageFor } from "@/lib/inkoop-product-images";

type OrderLine = {
  key: string;
  label: string;
  sku: string | null;
  aantal: number;
  inkoop_ex_btw: number;
  status: InkoopRegelStatus;
  notitie?: string | null;
};

type SchouwInfo = {
  kind: "voltooid" | "dag" | "week" | "niet";
  at: string | null;
  week_label: string | null;
  formulier_url: string | null;
  formulier_naam: string | null;
};

type PurchasingOrder = {
  id: string;
  project_nummer: string | null;
  status: string;
  titel: string | null;
  leveradres: string | null;
  leverancier: string;
  klant: string;
  lead_number: string | null;
  offerte_nummer: string | null;
  updated_at: string;
  inkoop_totaal_ex_btw: number;
  te_bestellen_ex_btw?: number;
  besteld_ex_btw?: number;
  inkoop_leverancier_status: InkoopLeverancierStatus;
  inkoop_leverancier_betaald_op: string | null;
  klant_betaling?: {
    pct: number;
    betaald_inc: number;
    order_inc: number;
    volledig: boolean;
  } | null;
  schouw: SchouwInfo;
  installatie_at: string | null;
  materiaal_leverdatum: string | null;
  inkoop_extra_notities?: string | null;
  summary: {
    te_kopen: number;
    besteld: number;
    geleverd: number;
    overall: InkoopRegelStatus | "deels";
  };
  items: OrderLine[];
};

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

/** Werkvoorraad-fases van de inkoopdesk. */
type Desk = "bestellen" | "pipeline" | "onderweg" | "geleverd" | "te_betalen";

const ROW =
  "grid grid-cols-[7.5rem_minmax(0,1fr)_minmax(0,1.05fr)_minmax(0,1.05fr)_6.5rem_3.5rem_6.5rem] items-center gap-x-3";

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
  // Te bestellen: schouw PDF + klant volledig betaald
  const klantOk =
    o.klant_betaling == null ? true : Boolean(o.klant_betaling.volledig);
  if (o.schouw.kind === "voltooid" && klantOk) return "bestellen";
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
  const [desk, setDesk] = useState<Desk>("bestellen");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
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
    buckets.bestellen.sort(
      (a, b) =>
        openEuro(b) - openEuro(a) ||
        (b.updated_at || "").localeCompare(a.updated_at || "")
    );
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
    nextChecks: Record<string, InkoopRegelStatus>,
    opts?: {
      reload?: boolean;
      askLeverdatum?: boolean;
      leverancierStatus?: InkoopLeverancierStatus;
    }
  ) {
    const items = order.items.map((i) => ({
      ...i,
      status: nextChecks[i.key] || i.status,
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

    let leverdatumYmd: string | null | undefined;
    if (
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

  const emptyCopy: Record<Desk, string> = {
    bestellen:
      "Niets te bestellen. Orders komen hier zodra het schouwrapport (PDF) binnen is én de klant volledig heeft betaald.",
    pipeline:
      "Geen orders in pipeline (wacht op betaling en/of schouw).",
    onderweg: "Geen bestellingen onderweg.",
    geleverd: "Nog geen geleverde orders.",
    te_betalen: "Geen openstaande leveranciersfacturen (op krediet).",
  };

  return (
    <div className="border border-line bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">
            Purchasing
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Materiaal inkopen bij {leverancier} · status en levering
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Zoek project of klant…"
            className="w-44 border border-line bg-white px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-muted focus:border-green sm:w-56"
          />
          <button
            type="button"
            onClick={() => void load()}
            className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-muted hover:bg-wash"
          >
            Vernieuwen
          </button>
        </div>
      </div>

      {wfForecast ? (
        <div className="border-b border-line bg-[#F7FAF8] px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Verwacht binnen 5 weken · Warmtefonds
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Installatie {formatDateShort(`${wfForecast.van}T12:00:00`)} –{" "}
                {formatDateShort(`${wfForecast.tot}T12:00:00`)}
                {wfForecast.orders > 0
                  ? ` · ${wfForecast.orders} WF-order${wfForecast.orders === 1 ? "" : "s"}`
                  : " · geen WF-installaties gepland"}
              </p>
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="border border-line bg-white px-3.5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Omzet (WF)
              </p>
              <p className="mt-1 font-display text-xl font-semibold tabular-nums text-ink">
                {formatEuro(wfForecast.omzet_ex_btw)}
              </p>
              <p className="mt-0.5 text-[11px] tabular-nums text-muted">
                {formatEuro(wfForecast.omzet_inc_btw)} incl. btw
              </p>
            </div>
            <div className="border border-line bg-white px-3.5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Uitgaand purchasing
              </p>
              <p className="mt-1 font-display text-xl font-semibold tabular-nums text-ink">
                {formatEuro(wfForecast.inkoop_te_bestellen_ex_btw)}
              </p>
              <p className="mt-0.5 text-[11px] tabular-nums text-muted">
                te bestellen · totaal inkoop{" "}
                {formatEuro(wfForecast.inkoop_ex_btw)}
                {wfForecast.inkoop_besteld_ex_btw > 0
                  ? ` · al besteld ${formatEuro(wfForecast.inkoop_besteld_ex_btw)}`
                  : ""}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap border-b border-line">
        {(
          [
            ["bestellen", "Te bestellen", counts.bestellen],
            ["pipeline", "Pipeline", counts.pipeline],
            ["onderweg", "Onderweg", counts.onderweg],
            ["te_betalen", "Nog te betalen", counts.te_betalen],
            ["geleverd", "Geleverd", counts.geleverd],
          ] as const
        ).map(([id, label, count]) => {
          const active = desk === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                setDesk(id);
                setOpenId(null);
              }}
              className={[
                "relative px-4 py-2.5 text-sm font-semibold transition-colors",
                active ? "text-ink" : "text-muted hover:bg-wash hover:text-ink",
              ].join(" ")}
            >
              {label}
              <span
                className={[
                  "ml-1.5 tabular-nums",
                  active
                    ? "text-ink"
                    : (id === "bestellen" || id === "te_betalen") && count > 0
                      ? id === "te_betalen"
                        ? "text-[#C45A12]"
                        : "text-green-dark"
                      : "text-muted",
                ].join(" ")}
              >
                {count}
              </span>
              {active ? (
                <span
                  className={[
                    "absolute inset-x-0 bottom-0 h-0.5",
                    id === "te_betalen" ? "bg-[#C45A12]" : "bg-green",
                  ].join(" ")}
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {(error || okMsg) && (
        <div className="space-y-1 border-b border-line px-4 py-2.5 sm:px-5">
          {error && (
            <p className="text-xs font-semibold text-[#C45A12]">{error}</p>
          )}
          {okMsg && (
            <p className="text-xs font-semibold text-green-dark">{okMsg}</p>
          )}
        </div>
      )}

      {loading ? (
        <p className="px-5 py-12 text-center text-sm text-muted">Laden…</p>
      ) : filtered.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-muted">
          {q.trim()
            ? "Geen resultaten voor deze zoekopdracht."
            : emptyCopy[desk]}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[920px]">
            <div
              className={[
                ROW,
                "border-b border-line bg-wash/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted sm:px-5",
              ].join(" ")}
            >
              <span>Project</span>
              <span>Klant</span>
              <span>Schouw</span>
              <span>Installatie</span>
              <span>Betaling</span>
              <span className="text-right">Open</span>
              <span className="text-right">Bedrag</span>
            </div>

            <ul>
              {filtered.map((order) => {
                const open = openId === order.id;
                const euro =
                  desk === "bestellen" || desk === "pipeline"
                    ? openEuro(order)
                    : desk === "te_betalen"
                      ? order.besteld_ex_btw ?? order.inkoop_totaal_ex_btw
                      : order.inkoop_totaal_ex_btw;
                const canOrder = order.schouw.kind === "voltooid";
                const badge = levBadge(order.inkoop_leverancier_status);

                return (
                  <li key={order.id} className="border-b border-line">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenId((cur) =>
                          cur === order.id ? null : order.id
                        )
                      }
                      className={[
                        ROW,
                        "w-full px-4 py-3 text-left hover:bg-wash sm:px-5",
                      ].join(" ")}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-display text-sm font-semibold text-ink">
                          {order.project_nummer || "Project"}
                        </p>
                        {order.offerte_nummer ? (
                          <p className="truncate text-xs text-muted">
                            {order.offerte_nummer}
                          </p>
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink">{order.klant}</p>
                        {order.leveradres ? (
                          <p className="truncate text-xs text-muted">
                            {order.leveradres}
                          </p>
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {schouwWhen(order.schouw)}
                        </p>
                        <p
                          className={[
                            "truncate text-xs font-semibold",
                            order.schouw.kind === "voltooid"
                              ? "text-green-dark"
                              : order.schouw.kind === "niet"
                                ? "text-muted"
                                : "text-[#C45A12]",
                          ].join(" ")}
                        >
                          {schouwHint(order.schouw)}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {installatieWhen(order.installatie_at)}
                        </p>
                        {(() => {
                          const hint = installatieHint(order);
                          return (
                            <p
                              className={[
                                "truncate text-xs font-semibold",
                                hint.tone === "ok"
                                  ? "text-green-dark"
                                  : hint.tone === "warn"
                                    ? "text-[#C45A12]"
                                    : "text-muted",
                              ].join(" ")}
                            >
                              {hint.text}
                            </p>
                          );
                        })()}
                      </div>
                      <div className="min-w-0">
                        {desk === "pipeline" && order.klant_betaling ? (
                          <KlantBetalingBar betaling={order.klant_betaling} />
                        ) : (
                          <p
                            className={[
                              "truncate text-xs font-semibold",
                              badge.className,
                            ].join(" ")}
                          >
                            {badge.label}
                          </p>
                        )}
                      </div>
                      <div className="text-right tabular-nums text-sm text-ink">
                        {order.summary.te_kopen > 0
                          ? order.summary.te_kopen
                          : "—"}
                      </div>
                      <div className="text-right">
                        <p className="font-display text-sm font-semibold tabular-nums text-ink">
                          {formatEuro(euro)}
                        </p>
                        <p className="text-[10px] text-muted">
                          {open ? "▾" : "▸"} {order.items.length}
                        </p>
                      </div>
                    </button>

                    {open ? (
                      <div className="border-t border-line bg-wash/30 px-4 py-3 sm:px-5">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-3 text-xs">
                            <Link
                              href={`/projecten/${order.id}?from=purchasing`}
                              className="font-semibold text-green-dark underline-offset-2 hover:underline"
                            >
                              Project
                            </Link>
                            {order.schouw.formulier_url ? (
                              <a
                                href={order.schouw.formulier_url}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-green-dark underline-offset-2 hover:underline"
                              >
                                Schouw-PDF
                              </a>
                            ) : (
                              <span className="text-muted">Geen schouw-PDF</span>
                            )}
                            {!canOrder ? (
                              <span className="text-muted">
                                Bestellen pas na rapport
                              </span>
                            ) : null}
                            {order.materiaal_leverdatum ? (
                              <span className="font-semibold text-[#EA580C]">
                                Levering{" "}
                                {order.materiaal_leverdatum.slice(0, 10)}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {canOrder && isOpenInkoop(order) ? (
                              <>
                                <button
                                  type="button"
                                  disabled={busyKey === `${order.id}:all`}
                                  onClick={() =>
                                    void markAll(order, "besteld", "op_krediet")
                                  }
                                  className="bg-orange px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                                >
                                  Besteld · op krediet
                                </button>
                                <button
                                  type="button"
                                  disabled={busyKey === `${order.id}:all`}
                                  onClick={() =>
                                    void markAll(order, "besteld", "betaald")
                                  }
                                  className="border border-green bg-white px-3 py-1.5 text-xs font-semibold text-green-dark disabled:opacity-60"
                                >
                                  Besteld · betaald
                                </button>
                              </>
                            ) : null}
                            {order.inkoop_leverancier_status === "op_krediet" ? (
                              <button
                                type="button"
                                disabled={busyKey === `${order.id}:lev`}
                                onClick={() =>
                                  void setLeverancierBetaling(order, "betaald")
                                }
                                className="bg-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                              >
                                Markeer als betaald
                              </button>
                            ) : null}
                            {order.inkoop_leverancier_status === "betaald" &&
                            (order.summary.overall === "besteld" ||
                              order.summary.overall === "geleverd" ||
                              order.summary.overall === "deels") ? (
                              <button
                                type="button"
                                disabled={busyKey === `${order.id}:lev`}
                                onClick={() =>
                                  void setLeverancierBetaling(
                                    order,
                                    "op_krediet"
                                  )
                                }
                                className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-muted disabled:opacity-60"
                              >
                                Zet op krediet
                              </button>
                            ) : null}
                            {order.summary.overall === "besteld" &&
                            !order.materiaal_leverdatum ? (
                              <button
                                type="button"
                                disabled={busyKey === `${order.id}:all`}
                                onClick={() => void markAll(order, "besteld")}
                                className="border border-[#EA580C] bg-white px-3 py-1.5 text-xs font-semibold text-[#EA580C] disabled:opacity-60"
                              >
                                Zet leverdatum
                              </button>
                            ) : null}
                            {order.summary.overall === "besteld" ||
                            order.summary.overall === "deels" ? (
                              <button
                                type="button"
                                disabled={busyKey === `${order.id}:all`}
                                onClick={() => void markAll(order, "geleverd")}
                                className="bg-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                              >
                                Alles geleverd
                              </button>
                            ) : null}
                          </div>
                        </div>

                        <div className="border border-line bg-white">
                          <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_5.5rem_8.5rem] gap-x-3 border-b border-line px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                            <span>Product</span>
                            <span className="text-right">Aantal</span>
                            <span className="text-right">Ex btw</span>
                            <span className="text-right">Regel</span>
                          </div>
                          <ul className="divide-y divide-line">
                            {order.inkoop_extra_notities ? (
                              <p className="border-b border-line bg-[#FFF8D6]/60 px-3 py-2 text-xs text-ink">
                                <span className="font-semibold">
                                  Schouw · inkoop:{" "}
                                </span>
                                {order.inkoop_extra_notities}
                              </p>
                            ) : null}
                            {order.items.map((item) => {
                              const foto = inkoopProductImageFor(
                                item.sku,
                                item.label
                              );
                              const cancelled = item.status === "geannuleerd";
                              return (
                              <li
                                key={item.key}
                                className={[
                                  "grid grid-cols-[minmax(0,1fr)_3.5rem_5.5rem_8.5rem] items-center gap-x-3 px-3 py-2",
                                  cancelled ? "opacity-60" : "",
                                ].join(" ")}
                              >
                                <div className="flex min-w-0 items-center gap-2.5">
                                  {foto ? (
                                    <div
                                      className={[
                                        "flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden border border-line bg-[#0a0a0a]",
                                        cancelled ? "opacity-50" : "",
                                      ].join(" ")}
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={foto.imageSrc}
                                        alt=""
                                        className="h-full w-full object-contain"
                                      />
                                    </div>
                                  ) : null}
                                  <div className="min-w-0">
                                  <p
                                    className={[
                                      "truncate text-sm font-medium",
                                      cancelled
                                        ? "text-muted line-through"
                                        : "text-ink",
                                    ].join(" ")}
                                  >
                                    {foto?.naam || item.label}
                                  </p>
                                  {item.notitie ? (
                                    <p className="mt-0.5 text-[11px] font-medium text-[#C45A12]">
                                      {item.notitie}
                                    </p>
                                  ) : null}
                                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    {item.sku ? (
                                      <span className="truncate text-xs text-muted">
                                        {item.sku}
                                      </span>
                                    ) : null}
                                    {!cancelled ? (
                                      <a
                                        href={apexProductUrl(
                                          item.sku,
                                          item.label
                                        )}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="shrink-0 text-xs font-semibold text-green-dark hover:underline"
                                        title="Open bij Apex Power Supplies (winkelwagen)"
                                      >
                                        Apex → winkelwagen
                                      </a>
                                    ) : null}
                                  </div>
                                  </div>
                                </div>
                                <p
                                  className={[
                                    "text-right tabular-nums text-sm",
                                    cancelled
                                      ? "text-muted line-through"
                                      : "text-ink",
                                  ].join(" ")}
                                >
                                  {item.aantal}×
                                </p>
                                <p
                                  className={[
                                    "text-right tabular-nums text-sm",
                                    cancelled
                                      ? "text-muted line-through"
                                      : "text-ink",
                                  ].join(" ")}
                                >
                                  {formatEuro(item.inkoop_ex_btw)}
                                </p>
                                <div className="flex justify-end">
                                  {cancelled ? (
                                    <span className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                                      Vervallen
                                    </span>
                                  ) : (
                                    <select
                                      value={item.status}
                                      disabled={
                                        busyKey === `${order.id}:${item.key}`
                                      }
                                      onChange={(e) =>
                                        void setLineStatus(
                                          order,
                                          item.key,
                                          e.target.value as InkoopRegelStatus
                                        )
                                      }
                                      className="border border-line bg-white px-2 py-1 text-xs font-semibold text-ink outline-none focus:border-green"
                                    >
                                      <option value="te_kopen">
                                        Te bestellen
                                      </option>
                                      <option value="besteld">Besteld</option>
                                      <option value="geleverd">
                                        Geleverd
                                      </option>
                                    </select>
                                  )}
                                </div>
                              </li>
                              );
                            })}
                          </ul>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
