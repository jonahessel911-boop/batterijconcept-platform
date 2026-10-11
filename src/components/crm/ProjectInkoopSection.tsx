"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Factuur, Offerte, OfferteRegel, Project } from "@/types/database";
import { formatEuro } from "@/lib/format";
import { buildProjectBetalingCash } from "@/lib/project-betaling-cash";
import {
  buildInkoopChecklist,
  inkoopChecklistTotaalExBtw,
  isInkoopItemBesteld,
  batterijPurchasingStatus,
  resolveInkoopRegelStatus,
  INKOOP_LEVERANCIER_STATUS_LABEL,
  type InkoopChecklistItem,
  type InkoopLeverancierStatus,
  type MateriaalChecks,
} from "@/lib/project-inkoop-checklist";
import {
  resolveInkoopLeverancierBetaaldOp,
  resolveInkoopLeverancierStatus,
} from "@/lib/inkoop-leverancier-betaling";
import type { ProductInkoop } from "@/lib/inkoop";

type Props = {
  project: Project;
  onProjectUpdated?: (p: Project) => void;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Orderbedrag uit offerte of som van offertregels. */
function orderTotalsFromOfferte(offerte: Offerte | null): {
  ex: number;
  btw: number | null;
  inc: number | null;
} {
  if (!offerte) return { ex: 0, btw: null, inc: null };

  let ex =
    offerte.subtotaal_ex_btw != null
      ? Number(offerte.subtotaal_ex_btw)
      : 0;
  let btw =
    offerte.btw_bedrag != null ? Number(offerte.btw_bedrag) : null;
  let inc =
    offerte.totaal_inc_btw != null ? Number(offerte.totaal_inc_btw) : null;

  if (!(ex > 0)) {
    const regels = (offerte.offerte_regels || []) as OfferteRegel[];
    ex = round2(
      regels.reduce((s, r) => s + (Number(r.totaal_ex_btw) || 0), 0)
    );
  }
  if (!(inc != null && inc > 0) && ex > 0) {
    if (btw != null && btw > 0) inc = round2(ex + btw);
    else {
      btw = round2(ex * 0.21);
      inc = round2(ex + btw);
    }
  }
  if ((btw == null || !(btw > 0)) && ex > 0 && inc != null && inc > 0) {
    btw = round2(Math.max(0, inc - ex));
  }

  return { ex, btw, inc };
}

export function ProjectInkoopSection({ project, onProjectUpdated }: Props) {
  const [facturen, setFacturen] = useState<Factuur[]>([]);
  const [offerte, setOfferte] = useState<Offerte | null>(null);
  const [producten, setProducten] = useState<ProductInkoop[]>([]);
  const [checks, setChecks] = useState<MateriaalChecks>(
    () => project.materiaal_checks || {}
  );
  const [levStatus, setLevStatus] = useState<InkoopLeverancierStatus>(() =>
    resolveInkoopLeverancierStatus(project)
  );
  const [levBetaaldOp, setLevBetaaldOp] = useState<string | null>(() =>
    resolveInkoopLeverancierBetaaldOp(project)
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offerteId = project.offerte_id || project.offertes?.id || null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [facRes, inkRes, offRes] = await Promise.all([
        fetch(`/api/projecten/${project.id}/facturen`),
        fetch("/api/inkoop"),
        offerteId
          ? fetch(`/api/offertes/${offerteId}`)
          : Promise.resolve(null),
      ]);

      const facData = await facRes.json().catch(() => ({}));
      if (!facRes.ok) {
        throw new Error(
          (facData as { error?: string }).error || "Facturen laden mislukt"
        );
      }
      setFacturen((facData.facturen as Factuur[]) || []);

      const inkData = await inkRes.json().catch(() => ({}));
      setProducten((inkData.producten as ProductInkoop[]) || []);

      if (offRes) {
        const offData = await offRes.json().catch(() => ({}));
        if (offRes.ok) {
          setOfferte((offData.offerte as Offerte) || null);
        }
      } else {
        setOfferte(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [project.id, offerteId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  useEffect(() => {
    setChecks(project.materiaal_checks || {});
    setLevStatus(resolveInkoopLeverancierStatus(project));
    setLevBetaaldOp(resolveInkoopLeverancierBetaaldOp(project));
  }, [
    project.materiaal_checks,
    project.inkoop_leverancier_status,
    project.inkoop_leverancier_betaald_op,
    project.id,
  ]);

  const regels = useMemo(
    () => (offerte?.offerte_regels || []) as OfferteRegel[],
    [offerte]
  );

  const items = useMemo(
    () =>
      buildInkoopChecklist(
        regels.map((r) => ({
          id: r.id,
          omschrijving: r.omschrijving,
          aantal: r.aantal,
          product_id: r.product_id,
        })),
        producten
      ),
    [regels, producten]
  );

  const inkoopTotaal = useMemo(
    () => inkoopChecklistTotaalExBtw(items),
    [items]
  );

  const order = useMemo(() => orderTotalsFromOfferte(offerte), [offerte]);

  const cash = useMemo(
    () =>
      buildProjectBetalingCash({
        orderExBtw: order.ex,
        orderBtw: order.btw,
        orderIncBtw: order.inc,
        facturen,
        inkoopExBtw: inkoopTotaal,
      }),
    [order, facturen, inkoopTotaal]
  );

  const besteldCount = items.filter((i) =>
    isInkoopItemBesteld(i, checks)
  ).length;

  const batterijStatus = useMemo(() => {
    const batterijItems = items.filter(
      (i) => /batterij/i.test(i.key) || /batterij/i.test(i.label)
    );
    if (batterijItems.length === 0) {
      return batterijPurchasingStatus(checks);
    }
    const statuses = batterijItems.map((i) =>
      resolveInkoopRegelStatus(i, checks)
    );
    return {
      besteld: statuses.every((s) => s === "besteld" || s === "geleverd"),
      geleverd: statuses.every((s) => s === "geleverd"),
    };
  }, [items, checks]);

  const heeftOrderBedrag = cash.orderIncBtw > 0;

  async function toggleItem(item: InkoopChecklistItem, next: boolean) {
    if (!cash.inkoopUnlocked) return;
    const nextChecks = { ...checks, [item.key]: next };
    const wasVolledig =
      items.length > 0 &&
      items.every((i) => isInkoopItemBesteld(i, checks));
    const nuVolledig =
      items.length > 0 &&
      items.every((i) => isInkoopItemBesteld(i, nextChecks));
    const setKredietDefault = nuVolledig && !wasVolledig && levStatus === "geen";
    setChecks(nextChecks);
    if (setKredietDefault) setLevStatus("op_krediet");
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materiaal_checks: nextChecks,
          ...(nuVolledig && !wasVolledig
            ? {
                materiaal_volledig_afgevinkt: true,
                ...(setKredietDefault
                  ? { inkoop_leverancier_status: "op_krediet" }
                  : {}),
              }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      const p = data.project as Project;
      onProjectUpdated?.(p);
      setLevStatus(resolveInkoopLeverancierStatus(p));
      setLevBetaaldOp(resolveInkoopLeverancierBetaaldOp(p));
    } catch (e) {
      setChecks(checks);
      setLevStatus(resolveInkoopLeverancierStatus(project));
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function setLeverancierStatus(status: InkoopLeverancierStatus) {
    setSaving(true);
    setError(null);
    const prev = levStatus;
    setLevStatus(status);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
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
      const p = data.project as Project;
      onProjectUpdated?.(p);
      setLevStatus(resolveInkoopLeverancierStatus(p));
      setLevBetaaldOp(resolveInkoopLeverancierBetaaldOp(p));
    } catch (e) {
      setLevStatus(prev);
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  const pctLabel = `${cash.betaaldPct.toFixed(cash.betaaldPct % 1 === 0 ? 0 : 1)}%`;

  return (
    <section className="border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
          Betaling &amp; inkoop
        </h2>
      </div>

      <div className="space-y-4 px-4 py-4">
        {loading ? (
          <p className="text-sm text-muted">Laden…</p>
        ) : (
          <>
            {!offerteId ? (
              <p className="text-sm text-muted">
                Geen offerte gekoppeld — betalingsvoortgang niet beschikbaar.
              </p>
            ) : !heeftOrderBedrag ? (
              <p className="text-sm text-muted">
                Offertebedrag ontbreekt — kan voortgang niet berekenen.
              </p>
            ) : (
              <div>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">
                    Betaald {formatEuro(cash.ontvangenIncBtw)} van{" "}
                    {formatEuro(cash.orderIncBtw)}
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-ink">
                    {pctLabel}
                  </p>
                </div>
                <div
                  className="mt-2 h-3 w-full overflow-hidden border border-line bg-wash"
                  role="progressbar"
                  aria-valuenow={Math.round(cash.betaaldPct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Betalingsvoortgang"
                >
                  <div
                    className={[
                      "h-full transition-[width] duration-300",
                      cash.volledigBetaald ? "bg-green" : "bg-orange",
                    ].join(" ")}
                    style={{
                      width: `${Math.min(100, Math.max(0, cash.betaaldPct))}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Inkoop checklist
                </h3>
                <p className="text-xs text-muted">
                  {besteldCount}/{items.length} · {formatEuro(inkoopTotaal)}{" "}
                  ex. btw
                </p>
              </div>
              <p className="mt-2 text-sm text-ink">
                Batterij besteld:{" "}
                <span
                  className={
                    batterijStatus.besteld
                      ? "font-semibold text-green-dark"
                      : "font-semibold text-[#C45A12]"
                  }
                >
                  {batterijStatus.besteld ? "ja" : "nee"}
                </span>
                <span className="mx-2 text-muted">·</span>
                Batterij geleverd:{" "}
                <span
                  className={
                    batterijStatus.geleverd
                      ? "font-semibold text-green-dark"
                      : "font-semibold text-muted"
                  }
                >
                  {batterijStatus.geleverd ? "ja" : "nee"}
                </span>
              </p>

              <div className="mt-3 rounded-xl border border-line bg-wash/40 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Leverancierbetaling
                    </p>
                    <p
                      className={[
                        "mt-0.5 text-sm font-semibold",
                        levStatus === "op_krediet"
                          ? "text-[#C45A12]"
                          : levStatus === "betaald"
                            ? "text-green-dark"
                            : "text-muted",
                      ].join(" ")}
                    >
                      {INKOOP_LEVERANCIER_STATUS_LABEL[levStatus]}
                      {levStatus === "betaald" && levBetaaldOp
                        ? ` · ${levBetaaldOp.slice(0, 10)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={saving || levStatus === "op_krediet"}
                      onClick={() => void setLeverancierStatus("op_krediet")}
                      className="border border-[#C45A12]/40 bg-white px-2.5 py-1 text-xs font-semibold text-[#C45A12] disabled:opacity-50"
                    >
                      Op krediet
                    </button>
                    <button
                      type="button"
                      disabled={saving || levStatus === "betaald"}
                      onClick={() => void setLeverancierStatus("betaald")}
                      className="border border-green/40 bg-white px-2.5 py-1 text-xs font-semibold text-green-dark disabled:opacity-50"
                    >
                      Betaald
                    </button>
                    {levStatus !== "geen" ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void setLeverancierStatus("geen")}
                        className="border border-line bg-white px-2.5 py-1 text-xs font-semibold text-muted disabled:opacity-50"
                      >
                        Reset
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <ul className="mt-2 divide-y divide-line border border-line">
                {items.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted">
                    Geen inkoopproducten.
                  </li>
                ) : (
                  items.map((item) => {
                    const besteld = isInkoopItemBesteld(item, checks);
                    const locked = !cash.inkoopUnlocked;
                    return (
                      <li key={item.key}>
                        <label
                          className={[
                            "flex items-center gap-2 px-2.5 py-1.5",
                            locked
                              ? "cursor-not-allowed opacity-55"
                              : "cursor-pointer hover:bg-wash",
                          ].join(" ")}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-ink">
                              {item.label}
                            </span>
                            <span className="block text-[11px] text-muted">
                              {formatEuro(item.inkoopExBtw)} ex. btw
                              {item.sku ? ` · ${item.sku}` : ""}
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            checked={besteld}
                            disabled={locked || saving}
                            onChange={(e) =>
                              void toggleItem(item, e.target.checked)
                            }
                            className="h-4 w-4 shrink-0"
                            aria-label={`${item.label} besteld`}
                          />
                        </label>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>

            {error ? (
              <p className="text-xs text-[#C45A12]">{error}</p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
