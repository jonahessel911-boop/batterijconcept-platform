"use client";

import { useMemo, useState } from "react";
import { BC_FUNNEL_HOOKS } from "@/lib/performance-marketing";

export type ResearchAd = {
  query: string;
  score: number;
  angle: string;
  nicheId?: string;
  nicheLabel?: string;
  ad: {
    id: string;
    name: string | null;
    headline: string | null;
    description: string | null;
    image: string | null;
    thumbnail: string | null;
    running_duration: { days?: number } | null;
    live: boolean | null;
    foreplay_url?: string | null;
    link_url?: string | null;
    cta_type?: string | null;
  };
};

type HotNiche = {
  id: string;
  label: string;
  why: string;
  seedBrands: string[];
};

type Props = {
  niches: HotNiche[];
  followedIds: string[];
  winners: ResearchAd[];
  discoveredBrands: { name: string; nicheId: string; count: number }[];
  loading: boolean;
  message: string | null;
  onToggleNiche: (id: string) => void;
  onSwipe: () => void;
  onTrackBrand: (name: string, nicheId?: string) => void;
  onAddedToLibrary?: () => void;
};

const FUNNEL_ANGLES = [
  { id: "tijdelijke_regeling" as const, label: "Tijdelijke regeling" },
  { id: "bijna_gratis" as const, label: "Bijna gratis" },
  { id: "nul_aanbetaling" as const, label: "€0 / zonder eigen investering" },
  { id: "qualify_check" as const, label: "Qualify-check" },
  { id: "regio" as const, label: "Regio-first" },
];

export function ForeplayResearchView({
  niches,
  followedIds,
  winners,
  discoveredBrands,
  loading,
  message,
  onToggleNiche,
  onSwipe,
  onTrackBrand,
  onAddedToLibrary,
}: Props) {
  const [filter, setFilter] = useState<string | "all">("all");
  const [detail, setDetail] = useState<ResearchAd | null>(null);
  const [funnelAngle, setFunnelAngle] =
    useState<(typeof FUNNEL_ANGLES)[number]["id"]>("tijdelijke_regeling");
  const [region, setRegion] = useState("Nederland");
  const [busy, setBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      winners.filter((w) => filter === "all" || w.nicheId === filter).slice(0, 60),
    [winners, filter]
  );

  async function addToLibrary() {
    if (!detail) return;
    setBusy(true);
    setLocalMsg(null);
    try {
      const res = await fetch("/api/performance-marketing/library", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_from_foreplay",
          ad: {
            id: detail.ad.id,
            name: detail.ad.name,
            headline: detail.ad.headline,
            description: detail.ad.description,
            image: detail.ad.image,
            thumbnail: detail.ad.thumbnail,
            foreplay_url: detail.ad.foreplay_url,
            running_days: detail.ad.running_duration?.days,
          },
          nicheLabel: detail.nicheLabel,
          funnelAngle,
          region,
          tier: "new",
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Toevoegen mislukt");
      setLocalMsg("Toegevoegd aan Creative library → New creatives (BC funnel copy)");
      onAddedToLibrary?.();
    } catch (e) {
      setLocalMsg(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-white px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-ink">
              Foreplay = research
            </h3>
            <p className="mt-1 max-w-2xl text-xs text-muted">
              Inspiratie uit hot lead-gen niches. Klik een ad voor detail. Toevoegen
              aan library remprompt altijd naar onze funnel:
            </p>
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-ink">
              {BC_FUNNEL_HOOKS.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            disabled={loading || followedIds.length === 0}
            onClick={onSwipe}
            className="h-9 rounded-xl bg-green-dark px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Swipen…" : "Swipe followed niches"}
          </button>
        </div>
        {message || localMsg ? (
          <p className="mt-3 rounded-xl border border-line bg-wash px-3 py-2 text-xs text-ink">
            {localMsg || message}
          </p>
        ) : null}
      </section>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {niches.map((n) => {
          const on = followedIds.includes(n.id);
          return (
            <button
              key={n.id}
              type="button"
              disabled={loading}
              onClick={() => onToggleNiche(n.id)}
              className={[
                "rounded-2xl border px-3 py-3 text-left transition",
                on
                  ? "border-green-dark bg-green-dark/5 ring-1 ring-green/30"
                  : "border-line bg-white hover:border-green-dark/40",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-ink">{n.label}</p>
                <span
                  className={[
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                    on ? "bg-green-dark text-white" : "bg-wash text-muted",
                  ].join(" ")}
                >
                  {on ? "Following" : "Follow"}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted">{n.why}</p>
            </button>
          );
        })}
      </section>

      {discoveredBrands.length > 0 ? (
        <section className="rounded-2xl border border-line bg-white px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">
            Brands uit research (optioneel tracken)
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {discoveredBrands.slice(0, 20).map((b) => (
              <button
                key={`${b.nicheId}-${b.name}`}
                type="button"
                onClick={() => onTrackBrand(b.name, b.nicheId)}
                className="rounded-full border border-line bg-wash px-2.5 py-1 text-[11px] font-semibold hover:border-green-dark"
              >
                {b.name} · {b.count}×
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-semibold text-ink">
            Research ads ({visible.length})
          </h3>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={[
                "rounded-lg px-2 py-1 text-[11px] font-semibold",
                filter === "all" ? "bg-green-dark text-white" : "bg-wash text-muted",
              ].join(" ")}
            >
              Alle
            </button>
            {followedIds.map((id) => {
              const n = niches.find((x) => x.id === id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={[
                    "rounded-lg px-2 py-1 text-[11px] font-semibold",
                    filter === id
                      ? "bg-green-dark text-white"
                      : "bg-wash text-muted",
                  ].join(" ")}
                >
                  {n?.label || id}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((w) => {
            const img = w.ad.image || w.ad.thumbnail;
            return (
              <button
                key={w.ad.id}
                type="button"
                onClick={() => setDetail(w)}
                className="overflow-hidden rounded-xl border border-line bg-white text-left hover:border-green-dark/50"
              >
                <div className="relative aspect-square bg-wash">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted">
                      Geen preview
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded bg-ink/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {w.ad.running_duration?.days ?? "?"}d ·{" "}
                    {w.nicheLabel || w.angle}
                  </span>
                </div>
                <div className="space-y-1 px-3 py-2.5">
                  <p className="truncate text-xs font-semibold text-ink">
                    {w.ad.name || "—"}
                  </p>
                  <p className="line-clamp-2 text-[11px] text-muted">
                    {w.ad.headline || "—"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-wash px-4 py-8 text-center text-sm text-muted">
            Follow niches en swipe voor research-ads.
          </p>
        ) : null}
      </section>

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-line bg-white shadow-xl">
            <div className="grid gap-0 md:grid-cols-2">
              <div className="relative aspect-square bg-wash md:aspect-auto md:min-h-[320px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={detail.ad.image || detail.ad.thumbnail || ""}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-lg font-semibold text-ink">
                      {detail.ad.name || "Ad"}
                    </p>
                    <p className="text-xs text-muted">
                      {detail.nicheLabel || "—"} ·{" "}
                      {detail.ad.running_duration?.days ?? "?"}d · score{" "}
                      {detail.score}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetail(null)}
                    className="text-sm font-semibold text-muted"
                  >
                    Sluiten
                  </button>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted">
                    Headline (bron)
                  </p>
                  <p className="text-sm text-ink">{detail.ad.headline || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase text-muted">
                    Body (bron)
                  </p>
                  <p className="max-h-28 overflow-auto whitespace-pre-wrap text-xs text-muted">
                    {detail.ad.description || "—"}
                  </p>
                </div>
                <div className="rounded-xl bg-wash px-3 py-2 text-[11px] text-muted">
                  <p className="font-semibold text-ink">Onze funnel-mapping</p>
                  <p className="mt-1">
                    Research blijft ter inspiratie. Bij toevoegen → altijd BC hooks
                    (tijdelijke regeling / bijna gratis / €0 / qualify).
                  </p>
                </div>
                <label className="block text-xs font-semibold text-muted">
                  Funnel-hoek
                  <select
                    className="mt-1 h-9 w-full border border-line bg-white px-2 text-sm text-ink"
                    value={funnelAngle}
                    onChange={(e) =>
                      setFunnelAngle(
                        e.target.value as (typeof FUNNEL_ANGLES)[number]["id"]
                      )
                    }
                  >
                    {FUNNEL_ANGLES.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-muted">
                  Regio
                  <select
                    className="mt-1 h-9 w-full border border-line bg-white px-2 text-sm text-ink"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                  >
                    {[
                      "Nederland",
                      "Limburg",
                      "Noord-Brabant",
                      "Zeeland",
                      "Zuid-Holland",
                    ].map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void addToLibrary()}
                    className="h-10 flex-1 rounded-xl bg-green-dark text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy ? "Bezig…" : "→ Library (New · BC funnel)"}
                  </button>
                  {detail.ad.foreplay_url ? (
                    <a
                      href={detail.ad.foreplay_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center rounded-xl border border-line px-3 text-xs font-semibold"
                    >
                      Open in Foreplay
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
