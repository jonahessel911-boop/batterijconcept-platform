"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BEZORG_HQ,
  BEZORG_MAX_STOPS_PER_DAG,
} from "@/lib/recruitment-rollen";
import { mapsNavUrl } from "@/lib/bezorg-route";
import type { BezorgRoute, BezorgRouteStop } from "@/types/database";
import { SignaturePadField } from "@/components/offerte/SignaturePadField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { ExternalLink, MapPin, Route, Truck } from "lucide-react";

type PoolItem = {
  project_id: string;
  project_nummer: string | null;
  klant_naam: string;
  adres: string;
  lat: number | null;
  lng: number | null;
  batterij_label: string;
};

type RouteListItem = BezorgRoute & {
  stops_total?: number;
  stops_done?: number;
};

type RouteDetail = BezorgRoute & {
  stops: BezorgRouteStop[];
};

function todayYmd() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function BezorgRoutesView() {
  const [pool, setPool] = useState<PoolItem[]>([]);
  const [routes, setRoutes] = useState<RouteListItem[]>([]);
  const [bezorgers, setBezorgers] = useState<Array<{ id: string; naam: string }>>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [datum, setDatum] = useState("");
  const [bezorgerId, setBezorgerId] = useState("");
  const [bezorgerNaam, setBezorgerNaam] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RouteDetail | null>(null);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [ontvanger, setOntvanger] = useState("");
  const [signature, setSignature] = useState<string | null>(null);

  useEffect(() => {
    setDatum(todayYmd());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [poolRes, routesRes] = await Promise.all([
        fetch("/api/instroom/bezorg-pool"),
        fetch("/api/instroom/bezorg-routes"),
      ]);
      const poolJson = await poolRes.json().catch(() => ({}));
      const routesJson = await routesRes.json().catch(() => ({}));
      if (!poolRes.ok) throw new Error(poolJson.error || "Pool laden mislukt");
      if (!routesRes.ok)
        throw new Error(routesJson.error || "Routes laden mislukt");
      setPool((poolJson.items || []) as PoolItem[]);
      setRoutes((routesJson.routes || []) as RouteListItem[]);
      setBezorgers(
        (routesJson.bezorgers || []) as Array<{ id: string; naam: string }>
      );
      setWarning(poolJson.warning || routesJson.warning || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/instroom/bezorg-routes?id=${id}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Route laden mislukt");
      const route = json.route as RouteDetail;
      setDetail(route);
      setActiveRouteId(id);
      const nextOpen = (route.stops || []).find((s) => !s.geleverd_at);
      setActiveStopId(nextOpen?.id || route.stops?.[0]?.id || null);
      setOntvanger("");
      setSignature(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setBusy(false);
    }
  }, []);

  const selectedCount = selected.size;
  const canPlan =
    selectedCount > 0 &&
    selectedCount <= BEZORG_MAX_STOPS_PER_DAG &&
    Boolean(bezorgerNaam.trim() || bezorgerId) &&
    Boolean(datum);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (next.size >= BEZORG_MAX_STOPS_PER_DAG) return prev;
        next.add(id);
      }
      return next;
    });
  }

  async function createRoute() {
    if (!canPlan) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const stops = pool
        .filter((p) => selected.has(p.project_id))
        .map((p) => ({
          project_id: p.project_id,
          adres: p.adres,
          lat: p.lat,
          lng: p.lng,
        }));
      const naam =
        bezorgerNaam.trim() ||
        bezorgers.find((b) => b.id === bezorgerId)?.naam ||
        "Bezorger";
      const res = await fetch("/api/instroom/bezorg-routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datum,
          bezorger_naam: naam,
          bezorger_sollicitatie_id: bezorgerId || null,
          stops,
          optimize: true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Route maken mislukt");
      setSelected(new Set());
      setInfo(
        `Route geoptimaliseerd vanaf ${BEZORG_HQ.label} · ${stops.length} stops`
      );
      await load();
      const newId = json.route?.id as string | undefined;
      if (newId) await loadDetail(newId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelivery() {
    if (!detail || !activeStopId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/instroom/bezorg-routes/${detail.id}/stops/${activeStopId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ontvanger_naam: ontvanger,
            handtekening_data_url: signature,
            geleverd: true,
          }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Opslaan mislukt");
      setInfo("Levering bevestigd met krabbel");
      await load();
      await loadDetail(detail.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  }

  const activeStop = useMemo(
    () => detail?.stops?.find((s) => s.id === activeStopId) || null,
    [detail, activeStopId]
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-semibold tracking-tight text-ink">
              Bezorgroutes
            </h2>
            <Badge variant="secondary" className="rounded-md">
              Draft
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            Batterijen uit Purchasing “Geleverd” · max {BEZORG_MAX_STOPS_PER_DAG}{" "}
            per dag · start {BEZORG_HQ.adres}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading || busy}
        >
          Vernieuwen
        </Button>
      </div>

      {warning ? (
        <Alert>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert className="border-green/30 bg-green-soft text-green-deeper">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted">Laden…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="space-y-4">
            <Card className="rounded-xl border-line shadow-none">
              <CardHeader className="px-4 py-3 sm:px-5">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Truck className="size-4" />
                  Te bezorgen (Geleverd)
                </CardTitle>
                <CardDescription>
                  {pool.length} order{pool.length === 1 ? "" : "s"} klaar voor
                  route · geselecteerd {selectedCount}/
                  {BEZORG_MAX_STOPS_PER_DAG}
                </CardDescription>
              </CardHeader>
              <Separator />
              <CardContent className="space-y-3 p-4 sm:p-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1.5">
                    <Label>Datum</Label>
                    <Input
                      type="date"
                      value={datum}
                      onChange={(e) => setDatum(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Bezorger</Label>
                    <NativeSelect
                      value={bezorgerId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setBezorgerId(id);
                        const hit = bezorgers.find((b) => b.id === id);
                        if (hit) setBezorgerNaam(hit.naam);
                      }}
                      disabled={busy}
                    >
                      <NativeSelectOption value="">
                        — Kies of typ —
                      </NativeSelectOption>
                      {bezorgers.map((b) => (
                        <NativeSelectOption key={b.id} value={b.id}>
                          {b.naam}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Naam (vrij)</Label>
                    <Input
                      value={bezorgerNaam}
                      onChange={(e) => setBezorgerNaam(e.target.value)}
                      placeholder="Bijv. Jan"
                      disabled={busy}
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  disabled={!canPlan || busy}
                  onClick={() => void createRoute()}
                >
                  <Route className="size-4" />
                  Optimaliseer &amp; plan route
                </Button>

                {pool.length === 0 ? (
                  <p className="text-sm text-muted">
                    Geen geleverde batterijen die nog bezorgd moeten worden.
                  </p>
                ) : (
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {pool.map((item) => {
                      const on = selected.has(item.project_id);
                      const disabled =
                        !on && selectedCount >= BEZORG_MAX_STOPS_PER_DAG;
                      return (
                        <li key={item.project_id}>
                          <label
                            className={[
                              "flex cursor-pointer items-start gap-3 px-3 py-3",
                              on ? "bg-green-soft/40" : "hover:bg-wash",
                              disabled ? "opacity-50" : "",
                            ].join(" ")}
                          >
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={on}
                              disabled={disabled || busy}
                              onChange={() => toggleSelect(item.project_id)}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-ink">
                                {item.klant_naam}
                                {item.project_nummer ? (
                                  <span className="ml-1.5 text-xs font-normal text-muted">
                                    {item.project_nummer}
                                  </span>
                                ) : null}
                              </p>
                              <p className="mt-0.5 text-xs text-muted">
                                {item.adres}
                              </p>
                              <p className="mt-0.5 text-[11px] text-green-deeper">
                                {item.batterij_label}
                              </p>
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-xl border-line shadow-none">
              <CardHeader className="px-4 py-3 sm:px-5">
                <CardTitle className="text-sm font-semibold">
                  Geplande routes
                </CardTitle>
              </CardHeader>
              <Separator />
              {routes.length === 0 ? (
                <CardContent className="px-4 py-6 text-sm text-muted sm:px-5">
                  Nog geen routes.
                </CardContent>
              ) : (
                <ul className="divide-y divide-line">
                  {routes.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className={[
                          "flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-wash sm:px-5",
                          activeRouteId === r.id ? "bg-wash" : "",
                        ].join(" ")}
                        onClick={() => void loadDetail(r.id)}
                      >
                        <div>
                          <p className="text-sm font-medium text-ink">
                            {r.datum} · {r.bezorger_naam}
                          </p>
                          <p className="text-xs text-muted">
                            {r.stops_done || 0}/{r.stops_total || 0} geleverd ·{" "}
                            {r.status}
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className="rounded-md capitalize"
                        >
                          {r.status}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            {!detail ? (
              <Card className="rounded-xl border-line shadow-none">
                <CardContent className="px-4 py-12 text-center text-sm text-muted sm:px-5">
                  Plan een route of open een bestaande route om stops te zien.
                </CardContent>
              </Card>
            ) : (
              <>
                <Card className="rounded-xl border-line shadow-none">
                  <CardHeader className="px-4 py-3 sm:px-5">
                    <CardTitle className="text-sm font-semibold">
                      Route {detail.datum} · {detail.bezorger_naam}
                    </CardTitle>
                    <CardDescription>
                      Start HQ → optimale volgorde · status {detail.status}
                    </CardDescription>
                  </CardHeader>
                  <Separator />
                  <ol className="divide-y divide-line">
                    {(detail.stops || []).map((stop) => {
                      const active = stop.id === activeStopId;
                      return (
                        <li key={stop.id}>
                          <button
                            type="button"
                            className={[
                              "flex w-full items-start gap-3 px-4 py-3 text-left sm:px-5",
                              active ? "bg-green-soft/35" : "hover:bg-wash",
                            ].join(" ")}
                            onClick={() => {
                              setActiveStopId(stop.id);
                              setOntvanger(stop.ontvanger_naam || "");
                              setSignature(null);
                            }}
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-wash text-xs font-bold text-ink">
                              {stop.volgorde}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-ink">
                                {stop.klant_naam || "Klant"}
                                {stop.project_nummer ? (
                                  <span className="ml-1.5 text-xs font-normal text-muted">
                                    {stop.project_nummer}
                                  </span>
                                ) : null}
                              </p>
                              <p className="mt-0.5 text-xs text-muted">
                                {stop.adres}
                              </p>
                              {stop.geleverd_at ? (
                                <p className="mt-1 text-[11px] font-semibold text-green-deeper">
                                  Geleverd · {stop.ontvanger_naam}
                                </p>
                              ) : (
                                <p className="mt-1 text-[11px] text-muted">
                                  Nog te leveren
                                </p>
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </Card>

                {activeStop ? (
                  <Card className="rounded-xl border-line shadow-none">
                    <CardHeader className="px-4 py-3 sm:px-5">
                      <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                        <MapPin className="size-4" />
                        Stop {activeStop.volgorde}
                      </CardTitle>
                      <CardDescription>{activeStop.adres}</CardDescription>
                    </CardHeader>
                    <Separator />
                    <CardContent className="space-y-4 p-4 sm:p-5">
                      {activeStop.lat != null && activeStop.lng != null ? (
                        <a
                          href={mapsNavUrl(
                            activeStop.lat,
                            activeStop.lng,
                            activeStop.adres
                          )}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-green-deeper hover:underline"
                        >
                          Navigeer in Google Maps
                          <ExternalLink className="size-3.5" />
                        </a>
                      ) : null}

                      {activeStop.geleverd_at ? (
                        <div className="space-y-2">
                          <p className="text-sm text-green-deeper">
                            Levering bevestigd door{" "}
                            <strong>{activeStop.ontvanger_naam}</strong>
                          </p>
                          {activeStop.handtekening_data_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={activeStop.handtekening_data_url}
                              alt="Krabbel"
                              className="max-h-28 rounded-lg border border-line bg-white"
                            />
                          ) : null}
                        </div>
                      ) : (
                        <>
                          <div className="grid gap-1.5">
                            <Label>Naam ontvanger</Label>
                            <Input
                              value={ontvanger}
                              onChange={(e) => setOntvanger(e.target.value)}
                              placeholder="Wie tekent voor ontvangst?"
                              disabled={busy}
                            />
                          </div>
                          <div>
                            <Label className="mb-1.5 block">
                              Krabbel bij levering
                            </Label>
                            <SignaturePadField onChange={setSignature} />
                          </div>
                          <Button
                            type="button"
                            disabled={
                              busy ||
                              !ontvanger.trim() ||
                              !signature?.startsWith("data:image")
                            }
                            onClick={() => void confirmDelivery()}
                          >
                            Bevestig levering
                          </Button>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
