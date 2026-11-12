"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type {
  ForecastOrder,
  ForecastPayload,
} from "@/lib/installatie-verwachting";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  portalToken: string;
};

type WeekPlan = {
  weekKey: string;
  weekKort: string;
  weekLabel: string;
  orders: ForecastOrder[];
};

type StatusBucket = {
  status: ForecastOrder["status"];
  label: string;
  orders: ForecastOrder[];
};

type RegioGroup = {
  regio: string;
  orders: ForecastOrder[];
  buckets: StatusBucket[];
  definitief: number;
  concept: number;
};

function orderStatus(o: ForecastOrder): ForecastOrder["status"] {
  if (o.status === "definitief" || o.status === "concept") return o.status;
  return o.bron === "installatie_at" ? "definitief" : "concept";
}

function sortOrdersForRoute(orders: ForecastOrder[]) {
  return [...orders].sort((a, b) => {
    const pc = (a.postcode || "").localeCompare(b.postcode || "", "nl");
    if (pc !== 0) return pc;
    return (a.plaats || "").localeCompare(b.plaats || "", "nl");
  });
}

function statusBuckets(orders: ForecastOrder[]): StatusBucket[] {
  const definitief = sortOrdersForRoute(
    orders.filter((o) => orderStatus(o) === "definitief")
  );
  const concept = sortOrdersForRoute(
    orders.filter((o) => orderStatus(o) === "concept")
  );
  const out: StatusBucket[] = [];
  if (definitief.length > 0) {
    out.push({ status: "definitief", label: "Definitief", orders: definitief });
  }
  if (concept.length > 0) {
    out.push({ status: "concept", label: "Concept", orders: concept });
  }
  return out;
}

function groupOrdersByRegio(orders: ForecastOrder[]): RegioGroup[] {
  const map = new Map<string, ForecastOrder[]>();
  for (const o of orders) {
    const key = o.regio?.trim() || "Onbekend";
    const list = map.get(key) || [];
    list.push(o);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([regio, list]) => {
      const buckets = statusBuckets(list);
      const flat = buckets.flatMap((b) => b.orders);
      return {
        regio,
        orders: flat,
        buckets,
        definitief: buckets.find((b) => b.status === "definitief")?.orders
          .length || 0,
        concept:
          buckets.find((b) => b.status === "concept")?.orders.length || 0,
      };
    })
    .sort(
      (a, b) =>
        b.orders.length - a.orders.length ||
        a.regio.localeCompare(b.regio, "nl")
    );
}

export function PartnerVerwachtingPanel({ portalToken }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ForecastPayload | null>(null);
  const [regioFilter, setRegioFilter] = useState<string>("alle");
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  const [reistijdByLeg, setReistijdByLeg] = useState<Record<string, string>>(
    {}
  );
  const [reistijdLoading, setReistijdLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/verwachting`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData(json as ForecastPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [portalToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const orderHref = useCallback(
    (projectId: string) =>
      portalToken === "session"
        ? `/installatie/orders/${projectId}`
        : `/installatie/${encodeURIComponent(portalToken)}/orders/${projectId}`,
    [portalToken]
  );

  const regioOpties = useMemo(() => {
    if (!data) return [] as { regio: string; aantal: number }[];
    const map = new Map<string, number>();
    for (const g of data.weekGroups || []) {
      for (const r of g.regios) {
        map.set(r.regio, (map.get(r.regio) || 0) + r.orders.length);
      }
    }
    return [...map.entries()]
      .map(([regio, aantal]) => ({ regio, aantal }))
      .filter((r) => r.aantal > 0)
      .sort(
        (a, b) =>
          b.aantal - a.aantal || a.regio.localeCompare(b.regio, "nl")
      );
  }, [data]);

  const weeks = useMemo((): WeekPlan[] => {
    if (!data?.weekGroups) return [];
    return data.weekGroups
      .map((g) => {
        const orders =
          regioFilter === "alle"
            ? g.regios.flatMap((r) => r.orders)
            : g.regios.find((r) => r.regio === regioFilter)?.orders || [];
        if (orders.length === 0) return null;
        return {
          weekKey: g.week.key,
          weekKort: g.week.kort,
          weekLabel: g.week.label,
          orders,
        };
      })
      .filter((w): w is WeekPlan => Boolean(w));
  }, [data, regioFilter]);

  const totaal = weeks.reduce((s, w) => s + w.orders.length, 0);
  const totaalDef = weeks.reduce(
    (s, w) =>
      s + w.orders.filter((o) => orderStatus(o) === "definitief").length,
    0
  );
  const totaalConcept = totaal - totaalDef;
  const maxOrders = Math.max(...weeks.map((w) => w.orders.length), 1);

  useEffect(() => {
    if (!weeks.length) {
      setOpenWeek(null);
      return;
    }
    setOpenWeek((prev) =>
      prev && weeks.some((w) => w.weekKey === prev)
        ? prev
        : weeks[0]!.weekKey
    );
  }, [weeks]);

  useEffect(() => {
    if (!openWeek) {
      setReistijdByLeg({});
      return;
    }
    const week = weeks.find((w) => w.weekKey === openWeek);
    if (!week) return;

    const groups = groupOrdersByRegio(week.orders);
    const legs: { id: string; from: string; to: string }[] = [];
    for (const g of groups) {
      for (const bucket of g.buckets) {
        for (let i = 1; i < bucket.orders.length; i++) {
          const prev = bucket.orders[i - 1]!;
          const cur = bucket.orders[i]!;
          const from = prev.adres || prev.plaats || prev.postcode;
          const to = cur.adres || cur.plaats || cur.postcode;
          if (!from || !to) continue;
          legs.push({
            id: `${prev.id}→${cur.id}`,
            from,
            to,
          });
        }
      }
    }

    if (legs.length === 0) {
      setReistijdByLeg({});
      return;
    }

    let cancelled = false;
    setReistijdLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/installatie/${encodeURIComponent(portalToken)}/verwachting/reistijd`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ legs }),
          }
        );
        const json = (await res.json()) as {
          legs?: { id: string; durationText: string }[];
        };
        if (cancelled || !res.ok) return;
        const map: Record<string, string> = {};
        for (const leg of json.legs || []) {
          map[leg.id] = leg.durationText;
        }
        setReistijdByLeg(map);
      } catch {
        if (!cancelled) setReistijdByLeg({});
      } finally {
        if (!cancelled) setReistijdLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openWeek, weeks, portalToken]);

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted">Laden…</p>;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  if (totaal === 0) {
    return (
      <Card className="shadow-xs">
        <CardContent className="px-6 py-12 text-center">
          <p className="font-display text-base font-semibold text-ink">
            Nog geen verkochte installaties
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            Zodra orders ondertekend zijn (of een installatiedatum hebben),
            verschijnen ze hier per week en regio.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-xs">
        <CardHeader className="border-b [.border-b]:pb-3">
          <CardTitle className="font-display text-lg">Pipeline</CardTitle>
          <CardDescription className="mt-1 max-w-2xl">
            Wat er daadwerkelijk verkocht is. Definitief = installatie gepland.
            Concept = verkocht, datum nog niet vast.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Totaal
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
              {totaal}
            </p>
            <p className="text-xs text-muted">installaties in dit venster</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Definitief
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
              {totaalDef}
            </p>
            <p className="text-xs text-muted">installatie gepland</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Concept
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
              {totaalConcept}
            </p>
            <p className="text-xs text-muted">verkocht, nog inplannen</p>
          </div>
        </CardContent>
      </Card>

      {regioOpties.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={regioFilter === "alle" ? "default" : "outline"}
            onClick={() => setRegioFilter("alle")}
          >
            Alle regio’s
          </Button>
          {regioOpties.map((r) => (
            <Button
              key={r.regio}
              type="button"
              size="sm"
              variant={regioFilter === r.regio ? "default" : "outline"}
              onClick={() => setRegioFilter(r.regio)}
            >
              {r.regio}
              <span className="ml-1.5 tabular-nums opacity-70">{r.aantal}</span>
            </Button>
          ))}
        </div>
      ) : null}

      <Card className="shadow-xs">
        <CardContent className="space-y-0 p-0">
          {weeks.map((w) => {
            const open = openWeek === w.weekKey;
            const barPct = Math.min(100, (w.orders.length / maxOrders) * 100);
            const def = w.orders.filter(
              (o) => orderStatus(o) === "definitief"
            ).length;
            const concept = w.orders.length - def;
            return (
              <div
                key={w.weekKey}
                className="border-b border-line last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() =>
                    setOpenWeek((cur) =>
                      cur === w.weekKey ? null : w.weekKey
                    )
                  }
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-wash/70",
                    open && "bg-wash/50"
                  )}
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink">{w.weekKort}</p>
                      <span className="text-xs text-muted">{w.weekLabel}</span>
                      {w.orders.some((o) => o.achterstallig) ? (
                        <Badge className="rounded-full border border-[#C45A12]/30 bg-[#FFF0E6] text-[10px] text-[#C45A12]">
                          achterstallig
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                      <span className="tabular-nums text-[#0F766E]">
                        {def} definitief
                      </span>
                      <span>·</span>
                      <span className="tabular-nums">{concept} concept</span>
                    </div>
                    <div className="h-1.5 max-w-xs overflow-hidden rounded-full bg-wash">
                      <div
                        className="h-full rounded-full bg-[#0D9488]"
                        style={{ width: `${barPct || 4}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-semibold tabular-nums text-ink">
                      {w.orders.length}
                    </p>
                    <p className="text-[11px] text-muted">
                      {w.orders.length === 1 ? "klus" : "klussen"}
                    </p>
                  </div>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-muted transition-transform",
                      open && "rotate-180"
                    )}
                  />
                </button>

                {open ? (
                  <div className="space-y-3 border-t border-line bg-white px-4 py-3">
                    {groupOrdersByRegio(w.orders).map((group) => (
                      <div
                        key={group.regio}
                        className="overflow-hidden rounded-lg border border-line"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-wash/50 px-3 py-2">
                          <p className="text-sm font-semibold text-ink">
                            {group.regio}
                          </p>
                          <p className="text-xs tabular-nums text-muted">
                            {group.orders.length}{" "}
                            {group.orders.length === 1
                              ? "installatie"
                              : "installaties"}
                          </p>
                        </div>
                        <div className="divide-y divide-line">
                          {group.buckets.map((bucket) => (
                            <div key={bucket.status}>
                              <div
                                className={cn(
                                  "flex items-center justify-between gap-2 px-3 py-2",
                                  bucket.status === "definitief"
                                    ? "bg-[#E6F7F5]/60"
                                    : "bg-wash/40"
                                )}
                              >
                                <p
                                  className={cn(
                                    "text-xs font-semibold uppercase tracking-wide",
                                    bucket.status === "definitief"
                                      ? "text-[#0F766E]"
                                      : "text-muted"
                                  )}
                                >
                                  {bucket.label}
                                </p>
                                <p className="text-xs font-semibold tabular-nums text-muted">
                                  {bucket.orders.length}
                                </p>
                              </div>
                              <ul>
                                {bucket.orders.map((o, idx) => {
                                  const prev = bucket.orders[idx - 1];
                                  const legId = prev
                                    ? `${prev.id}→${o.id}`
                                    : null;
                                  const reis =
                                    legId != null
                                      ? reistijdByLeg[legId]
                                      : null;
                                  return (
                                    <li key={`${o.id}-${o.bron}`}>
                                      {idx > 0 ? (
                                        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted">
                                          <span className="h-px flex-1 bg-line" />
                                          <span className="shrink-0 tabular-nums">
                                            {reistijdLoading && !reis
                                              ? "Reistijd…"
                                              : reis
                                                ? `≈ ${reis} rijden`
                                                : "Reistijd onbekend"}
                                          </span>
                                          <span className="h-px flex-1 bg-line" />
                                        </div>
                                      ) : null}
                                      <div className="flex items-center justify-between gap-2 px-3 py-2">
                                        <p className="min-w-0 truncate text-sm text-ink">
                                          <span className="font-medium">
                                            {o.projectNummer ||
                                              o.id.slice(0, 8)}
                                          </span>
                                          {o.plaats ? (
                                            <span className="text-muted">
                                              {" "}
                                              · {o.plaats}
                                            </span>
                                          ) : null}
                                        </p>
                                        <a
                                          href={orderHref(o.id)}
                                          className={buttonVariants({
                                            variant: "outline",
                                            size: "xs",
                                          })}
                                        >
                                          Open
                                        </a>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
