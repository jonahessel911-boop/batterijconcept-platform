"use client";

import { useMemo, useState } from "react";
import type { CreativeLibraryItem } from "@/lib/performance-marketing";
import { BC_UGC_VIDEO_CTA } from "@/lib/performance-marketing";
import {
  buildUgcVideoScript,
  VARIATION_OPTIONS,
} from "@/lib/creative-variants";
import { NL_PROVINCES } from "@/lib/nl-geo-targeting";

type Props = {
  items: CreativeLibraryItem[];
  onChanged: (items: CreativeLibraryItem[]) => void;
  /** Na create_variation — parent kan progress-panel highlighten */
  onQueued?: (info: { media?: string; message?: string }) => void;
};

type StudioKind =
  | "animation_video"
  | "aggressive_copy"
  | "other_people"
  | "other_background"
  | "other_region";

function Card({
  item,
  selected,
  onSelect,
  onOpen,
}: {
  item: CreativeLibraryItem;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const pendingVideo =
    item.variationKind === "animation_video" && !item.videoUrl && !!item.videoScript;
  const pendingStill =
    !!item.variationPrompt &&
    !item.videoScript &&
    !item.imageUrl?.includes("/creatives/variants/");

  return (
    <div
      className={[
        "overflow-hidden rounded-xl border bg-white",
        selected ? "border-green-dark ring-2 ring-green/30" : "border-line",
      ].join(" ")}
    >
      <button type="button" onClick={onOpen} className="relative block w-full text-left">
        <div
          className={[
            "relative bg-wash",
            item.format === "9x16"
              ? "aspect-[9/16]"
              : item.format === "4x5"
                ? "aspect-[4/5]"
                : item.format === "16x9"
                  ? "aspect-video"
                  : "aspect-square",
          ].join(" ")}
        >
          {item.videoUrl ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={item.videoUrl}
              className="absolute inset-0 h-full w-full object-contain"
              muted
              playsInline
              preload="metadata"
            />
          ) : item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt={item.adName}
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted">
              Geen preview
            </div>
          )}
          <span className="absolute left-2 top-2 rounded bg-ink/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {item.platform} · {item.format}
            {item.variationKind === "animation_video" ? " · VIDEO" : ""}
          </span>
          {item.cardboardText ? (
            <span className="absolute right-2 top-2 max-w-[55%] rounded bg-[#F5E6C8]/95 px-1.5 py-1 text-left font-mono text-[9px] font-bold leading-tight text-ink shadow-sm">
              {item.cardboardText.split("\n").slice(0, 4).join(" · ")}
            </span>
          ) : null}
          {item.tier === "winner" ? (
            <span className="absolute bottom-2 left-2 rounded bg-green-dark px-1.5 py-0.5 text-[10px] font-semibold text-white">
              Winner
            </span>
          ) : item.tier === "rising" ? (
            <span className="absolute bottom-2 left-2 rounded bg-[#C45A12] px-1.5 py-0.5 text-[10px] font-semibold text-white">
              Opkomer
            </span>
          ) : (
            <span className="absolute bottom-2 left-2 rounded bg-ink/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              New
            </span>
          )}
          {item.videoUrl ? (
            <span className="absolute bottom-2 right-2 rounded bg-green-dark px-1.5 py-0.5 text-[9px] font-semibold text-white">
              video ready
            </span>
          ) : pendingVideo ? (
            <span className="absolute bottom-2 right-2 rounded bg-[#C45A12] px-1.5 py-0.5 text-[9px] font-semibold text-white">
              video pending
            </span>
          ) : pendingStill ? (
            <span className="absolute bottom-2 right-2 rounded bg-[#C45A12] px-1.5 py-0.5 text-[9px] font-semibold text-white">
              still pending
            </span>
          ) : null}
        </div>
      </button>
      <div className="space-y-1 px-3 py-2.5">
        <p className="truncate font-mono text-[11px] font-semibold text-ink">
          {item.adName}
        </p>
        <p className="truncate text-[11px] text-muted">{item.headline}</p>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onSelect}
            className="text-[11px] font-semibold text-green-dark"
          >
            {selected ? "Geselecteerd ✓" : "Selecteer"}
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="text-[11px] font-semibold text-muted"
          >
            Open / variaties
          </button>
        </div>
      </div>
    </div>
  );
}

export function CreativeLibraryView({ items, onChanged, onQueued }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<CreativeLibraryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [region, setRegion] = useState("Limburg");
  const [studioKind, setStudioKind] = useState<StudioKind>("animation_video");

  const winners = useMemo(
    () => items.filter((i) => i.tier === "winner" && i.status !== "archived").slice(0, 30),
    [items]
  );
  const rising = useMemo(
    () => items.filter((i) => i.tier === "rising" && i.status !== "archived"),
    [items]
  );
  const news = useMemo(
    () =>
      items.filter(
        (i) =>
          (i.tier === "new" || !i.tier) &&
          i.status !== "archived" &&
          i.status !== "ready"
      ),
    [items]
  );

  const scriptPreview = useMemo(
    () => buildUgcVideoScript({ region }),
    [region]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/performance-marketing/library", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        error?: string;
        library?: { items: CreativeLibraryItem[] };
        item?: CreativeLibraryItem;
        variation?: { label: string; media?: string };
        message?: string;
        queueMedia?: string;
      };
      if (!res.ok) throw new Error(json.error || "Actie mislukt");
      if (json.library?.items) onChanged(json.library.items);
      if (body.action === "create_variation" && json.item) {
        const message =
          json.message ||
          (json.queueMedia === "video"
            ? `UGC-video in queue — zie voortgang bovenaan.`
            : `Still in queue — zie voortgang bovenaan.`);
        setMsg(message);
        onQueued?.({ media: json.queueMedia, message });
        setActive(json.item);
        // Sluit studio na korte feedback zodat queue-panel zichtbaar is
        window.setTimeout(() => setActive(null), 1200);
      } else if (body.action === "set_tier") {
        setMsg("Tier bijgewerkt");
        setSelected(new Set());
      } else if (body.action === "approve") {
        setMsg("Naar Top winners / launch seed");
        setSelected(new Set());
      } else if (body.action === "reject") {
        setMsg("Afgekeurd");
        setSelected(new Set());
        setActive(null);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  function Section({
    title,
    sub,
    list,
  }: {
    title: string;
    sub: string;
    list: CreativeLibraryItem[];
  }) {
    return (
      <section>
        <div className="mb-3">
          <h3 className="font-display text-base font-semibold text-ink">
            {title} ({list.length})
          </h3>
          <p className="text-xs text-muted">{sub}</p>
        </div>
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-wash px-4 py-6 text-sm text-muted">
            Nog leeg — klik een Meta winner om variaties te maken.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((item) => (
              <Card
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                onSelect={() => toggle(item.id)}
                onOpen={() => setActive(item)}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-white px-4 py-3 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-ink">
            Selectie: {selected.size}
          </p>
          <p className="text-[11px] text-muted">
            Variaties maak je vanaf een Meta winner (tab Meta) of hieronder via
            Open.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() =>
              void patch({ action: "set_tier", ids: [...selected], tier: "winner" })
            }
            className="h-9 rounded-xl bg-green-dark px-3 text-xs font-semibold text-white disabled:opacity-40"
          >
            → Top winners
          </button>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() =>
              void patch({ action: "set_tier", ids: [...selected], tier: "rising" })
            }
            className="h-9 rounded-xl border border-line bg-white px-3 text-xs font-semibold disabled:opacity-40"
          >
            → Opkomers
          </button>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() =>
              void patch({ action: "approve", ids: [...selected] })
            }
            className="h-9 rounded-xl border border-line bg-wash px-3 text-xs font-semibold disabled:opacity-40"
          >
            Goedkeuren
          </button>
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() =>
              void patch({ action: "reject", ids: [...selected] })
            }
            className="h-9 rounded-xl border border-[#C45A12]/40 bg-[#FFF0E6] px-3 text-xs font-semibold text-[#C45A12] disabled:opacity-40"
          >
            Afkeuren
          </button>
        </div>
      </section>

      {msg ? (
        <p className="rounded-xl border border-green-dark/20 bg-wash px-4 py-3 text-sm text-ink">
          {msg}
        </p>
      ) : null}

      <Section
        title="Top winners"
        sub="Seed / runnen — klik open voor video of regio-varianten"
        list={winners}
      />
      <Section
        title="Opkomers"
        sub="Test-kandidaten"
        list={rising}
      />
      <Section
        title="New creatives"
        sub="Verse stills & UGC-video’s uit Meta-variatie studio"
        list={news}
      />

      {active ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center">
          <div className="max-h-[94vh] w-full max-w-5xl overflow-auto rounded-2xl border border-line bg-white shadow-xl">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div
                className={[
                  "relative bg-wash",
                  active.format === "9x16"
                    ? "min-h-[360px] aspect-[9/16]"
                    : active.format === "4x5"
                      ? "min-h-[320px] aspect-[4/5]"
                      : "min-h-[280px] aspect-square",
                ].join(" ")}
              >
                {active.videoUrl ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    src={active.videoUrl}
                    controls
                    playsInline
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={active.imageUrl}
                    alt={active.adName}
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                )}
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-[11px] text-muted">
                      {active.adName}
                    </p>
                    <p className="font-display text-xl font-semibold text-ink">
                      {active.headline}
                    </p>
                    <p className="text-[11px] text-muted">
                      {active.tier} · {active.platform} · {active.format}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-sm font-semibold text-muted"
                    onClick={() => setActive(null)}
                  >
                    Sluiten
                  </button>
                </div>

                {active.videoScript ? (
                  <div className="rounded-xl border border-green-dark/30 bg-[#F3F8F4] px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase text-green-dark">
                      UGC script
                    </p>
                    <p className="mt-1 text-[11px] font-semibold text-ink">
                      CTA: {active.cta || BC_UGC_VIDEO_CTA}
                    </p>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-ink">
                      {active.videoScript}
                    </pre>
                    {!active.videoUrl ? (
                      <p className="mt-2 text-[10px] text-muted">
                        Zeg in chat: <em>“genereer ugc video”</em>
                      </p>
                    ) : null}
                  </div>
                ) : active.cardboardText ? (
                  <div className="rounded-xl bg-wash px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase text-muted">
                      Karton
                    </p>
                    <p className="whitespace-pre-wrap text-sm font-semibold text-ink">
                      {active.cardboardText}
                    </p>
                  </div>
                ) : null}

                <section className="space-y-2 border-t border-line pt-3">
                  <p className="font-display text-base font-semibold text-ink">
                    Nieuwe variatie
                  </p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    1. Type
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {VARIATION_OPTIONS.map((v) => (
                      <button
                        key={v.kind}
                        type="button"
                        onClick={() => setStudioKind(v.kind)}
                        className={[
                          "rounded-xl border px-3 py-2.5 text-left",
                          studioKind === v.kind
                            ? "border-green-dark bg-[#F3F8F4] ring-1 ring-green-dark/30"
                            : "border-line bg-white hover:border-green-dark/40",
                        ].join(" ")}
                      >
                        <p className="text-xs font-semibold text-ink">
                          {v.title}
                        </p>
                        <p className="text-[10px] text-muted">{v.blurb}</p>
                      </button>
                    ))}
                  </div>

                  <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    2. Provincie / regio
                  </p>
                  <select
                    className="h-10 w-full border border-line bg-white px-2 text-sm"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                  >
                    {NL_PROVINCES.map((p) => (
                      <option key={p.id} value={p.label}>
                        {p.label}
                      </option>
                    ))}
                    <option value="Nederland">Nederland</option>
                  </select>

                  {studioKind === "animation_video" ? (
                    <div className="rounded-xl border border-line bg-wash px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase text-muted">
                        Script-preview · {region}
                      </p>
                      <p className="mt-1 text-[11px] font-semibold text-ink">
                        {scriptPreview.angle}
                      </p>
                      <p className="text-[10px] text-muted">
                        CTA: {BC_UGC_VIDEO_CTA}
                      </p>
                      <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink">
                        {scriptPreview.scriptText}
                      </pre>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void patch({
                        action: "create_variation",
                        parentId: active.id,
                        kind: studioKind,
                        region,
                      })
                    }
                    className="h-11 w-full rounded-xl bg-green-dark text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy
                      ? "Bezig…"
                      : studioKind === "animation_video"
                        ? `Maak UGC-video · ${region}`
                        : `Maak variatie · ${region}`}
                  </button>
                  <p className="text-[10px] text-muted">
                    {studioKind === "animation_video"
                      ? `Daarna: “genereer ugc video”. CTA altijd “${BC_UGC_VIDEO_CTA}”.`
                      : `Daarna: “genereer higgsfield stills”.`}
                  </p>
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
