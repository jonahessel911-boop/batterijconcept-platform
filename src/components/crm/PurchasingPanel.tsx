"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatEuro, formatSlotLabelNl } from "@/lib/format";
import {
  INKOOP_LEVERANCIER,
  type InkoopRegelStatus,
} from "@/lib/project-inkoop-checklist";
import { bestelDeadlineVoorInstallatie } from "@/lib/inkoop-sla";

type OrderLine = {
  key: string;
  label: string;
  sku: string | null;
  aantal: number;
  inkoop_ex_btw: number;
  status: InkoopRegelStatus;
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
  schouw: SchouwInfo;
  installatie_at: string | null;
  summary: {
    te_kopen: number;
    besteld: number;
    geleverd: number;
    overall: InkoopRegelStatus | "deels";
  };
  items: OrderLine[];
};

/** Werkvoorraad-fases van de inkoopdesk. */
type Desk = "bestellen" | "pipeline" | "onderweg" | "geleverd";

const ROW =
  "grid grid-cols-[7.5rem_minmax(0,1.1fr)_minmax(0,1.15fr)_minmax(0,1.15fr)_3.5rem_6.5rem] items-center gap-x-3";

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

function deskOf(o: PurchasingOrder): Desk {
  if (o.summary.overall === "geleverd") return "geleverd";
  if (o.summary.overall === "besteld") return "onderweg";
  if (o.schouw.kind === "voltooid") return "bestellen";
  return "pipeline";
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
  if (o.schouw.at) return `0:${o.schouw.at}`;
  if (o.schouw.week_label) return `1:${o.schouw.week_label}`;
  return `2:${o.updated_at || ""}`;
}

export function PurchasingPanel() {
  const [orders, setOrders] = useState<PurchasingOrder[]>([]);
  const [leverancier, setLeverancier] = useState(INKOOP_LEVERANCIER);
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
        }))
      );
      setLeverancier(data.leverancier || INKOOP_LEVERANCIER);
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
    };
    for (const o of orders) {
      buckets[deskOf(o)].push(o);
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
    return buckets;
  }, [orders]);

  const counts = useMemo(
    () => ({
      bestellen: byDesk.bestellen.length,
      pipeline: byDesk.pipeline.length,
      onderweg: byDesk.onderweg.length,
      geleverd: byDesk.geleverd.length,
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

  const deskEuro = useMemo(() => {
    const list = byDesk[desk];
    let euro = 0;
    for (const o of list) {
      if (desk === "bestellen" || desk === "pipeline") euro += openEuro(o);
      else euro += o.inkoop_totaal_ex_btw;
    }
    return Math.round(euro * 100) / 100;
  }, [byDesk, desk]);

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
    opts?: { reload?: boolean }
  ) {
    const items = order.items.map((i) => ({
      ...i,
      status: nextChecks[i.key] || i.status,
    }));
    const allBesteldOrMore = items.every(
      (i) => i.status === "besteld" || i.status === "geleverd"
    );
    const allGeleverd = items.every((i) => i.status === "geleverd");

    const body: Record<string, unknown> = {
      materiaal_checks: nextChecks,
    };
    if (allBesteldOrMore && order.status === "restfactuur_betaald") {
      body.status = "materiaal_besteld";
      body.materiaal_volledig_afgevinkt = true;
    }

    const res = await fetch(`/api/projecten/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        (data as { error?: string }).error || "Opslaan mislukt"
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
          for (const i of items) {
            if (i.status === "geleverd") geleverd += 1;
            else if (i.status === "besteld") besteld += 1;
            else te_kopen += 1;
          }
          let overall: InkoopRegelStatus | "deels" = "te_kopen";
          if (items.length > 0 && geleverd === items.length) overall = "geleverd";
          else if (items.length > 0 && te_kopen === 0) overall = "besteld";
          else if (besteld > 0 || geleverd > 0) overall = "deels";
          return {
            ...o,
            status:
              allBesteldOrMore && o.status === "restfactuur_betaald"
                ? "materiaal_besteld"
                : o.status,
            items,
            summary: { te_kopen, besteld, geleverd, overall },
          };
        })
      );
    }

    if (allGeleverd) {
      setOkMsg(`${order.project_nummer || "Order"} · alles geleverd.`);
    } else if (allBesteldOrMore) {
      setOkMsg(
        `${order.project_nummer || "Order"} · besteld bij ${leverancier}.`
      );
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

  async function markAll(order: PurchasingOrder, status: InkoopRegelStatus) {
    setBusyKey(`${order.id}:all`);
    setError(null);
    setOkMsg(null);
    try {
      const nextChecks: Record<string, InkoopRegelStatus> = {};
      for (const item of order.items) nextChecks[item.key] = status;
      await persistChecks(order, nextChecks, { reload: true });
      setOpenId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusyKey(null);
    }
  }

  const emptyCopy: Record<Desk, string> = {
    bestellen:
      "Niets te bestellen. Orders komen hier zodra het schouwrapport (PDF) binnen is.",
    pipeline: "Geen betaalde orders die nog op schouw wachten.",
    onderweg: "Geen bestellingen onderweg.",
    geleverd: "Nog geen geleverde orders.",
  };

  const euroLabel: Record<Desk, string> = {
    bestellen: "te bestellen",
    pipeline: "in pipeline",
    onderweg: "besteld",
    geleverd: "geleverd",
  };

  return (
    <div className="border border-line bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">
            Purchasing
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {leverancier}
            {!loading && filtered.length > 0 ? (
              <>
                {" · "}
                <span className="tabular-nums text-ink">
                  {formatEuro(deskEuro)}
                </span>{" "}
                {euroLabel[desk]}
              </>
            ) : null}
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

      <div className="flex flex-wrap border-b border-line">
        {(
          [
            ["bestellen", "Te bestellen", counts.bestellen],
            ["pipeline", "Pipeline", counts.pipeline],
            ["onderweg", "Onderweg", counts.onderweg],
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
                    : id === "bestellen" && count > 0
                      ? "text-green-dark"
                      : "text-muted",
                ].join(" ")}
              >
                {count}
              </span>
              {active ? (
                <span
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-green"
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
          <div className="min-w-[820px]">
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
              <span className="text-right">Open</span>
              <span className="text-right">Bedrag</span>
            </div>

            <ul>
              {filtered.map((order) => {
                const open = openId === order.id;
                const d = deskOf(order);
                const euro =
                  d === "bestellen" || d === "pipeline"
                    ? openEuro(order)
                    : order.inkoop_totaal_ex_btw;
                const canOrder = order.schouw.kind === "voltooid";

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
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {canOrder && isOpenInkoop(order) ? (
                              <button
                                type="button"
                                disabled={busyKey === `${order.id}:all`}
                                onClick={() => void markAll(order, "besteld")}
                                className="bg-orange px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                              >
                                Alles besteld
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
                            {order.items.map((item) => (
                              <li
                                key={item.key}
                                className="grid grid-cols-[minmax(0,1fr)_3.5rem_5.5rem_8.5rem] items-center gap-x-3 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-ink">
                                    {item.label}
                                  </p>
                                  {item.sku ? (
                                    <p className="truncate text-xs text-muted">
                                      {item.sku}
                                    </p>
                                  ) : null}
                                </div>
                                <p className="text-right tabular-nums text-sm text-ink">
                                  {item.aantal}×
                                </p>
                                <p className="text-right tabular-nums text-sm text-ink">
                                  {formatEuro(item.inkoop_ex_btw)}
                                </p>
                                <div className="flex justify-end">
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
                                    <option value="geleverd">Geleverd</option>
                                  </select>
                                </div>
                              </li>
                            ))}
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
