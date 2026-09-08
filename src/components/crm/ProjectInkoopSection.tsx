"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Factuur, Offerte, OfferteRegel, Project } from "@/types/database";
import { formatEuro } from "@/lib/format";
import { buildProjectBetalingCash } from "@/lib/project-betaling-cash";
import {
  buildInkoopChecklist,
  inkoopChecklistTotaalExBtw,
  isInkoopItemBesteld,
  type InkoopChecklistItem,
} from "@/lib/project-inkoop-checklist";
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
  const [checks, setChecks] = useState<Record<string, boolean>>(
    () => project.materiaal_checks || {}
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
  }, [project.materiaal_checks, project.id]);

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

  const heeftOrderBedrag = cash.orderIncBtw > 0;

  async function toggleItem(item: InkoopChecklistItem, next: boolean) {
    if (!cash.inkoopUnlocked) return;
    const nextChecks = { ...checks, [item.key]: next };
    setChecks(nextChecks);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materiaal_checks: nextChecks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      onProjectUpdated?.(data.project as Project);
    } catch (e) {
      setChecks(checks);
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
