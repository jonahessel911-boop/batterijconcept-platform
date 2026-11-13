"use client";

import { useEffect, useMemo, useState } from "react";
import type { CreativeLibraryItem } from "@/lib/performance-marketing";
import { BC_UGC_VIDEO_CTA } from "@/lib/performance-marketing";
import {
  buildMetaAlternativesBasePrompt,
  buildUgcVideoScript,
  type MetaGeoMode,
} from "@/lib/creative-variants";
import { NL_PROVINCES, provinceById } from "@/lib/nl-geo-targeting";

export type MetaWinnerSeed = {
  adId: string;
  adName: string;
  campaignName: string | null;
  title: string | null;
  body: string | null;
  cta: string | null;
  linkUrl: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
};

type OutputKind = "still" | "video";

type Props = {
  winner: MetaWinnerSeed;
  onClose: () => void;
  onGenerated: (
    items: CreativeLibraryItem[],
    meta?: { count: number; output: OutputKind; message?: string }
  ) => void;
};

function StepLabel({ n, title }: { n: number; title: string }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
      {n}. {title}
    </p>
  );
}

export function MetaWinnerAlternativesModal({
  winner,
  onClose,
  onGenerated,
}: Props) {
  const [output, setOutput] = useState<OutputKind>("still");
  const [provinceId, setProvinceId] = useState("limburg");
  const [mode, setMode] = useState<MetaGeoMode>("province_only");
  const [selectedPlaces, setSelectedPlaces] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [promptTouched, setPromptTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const province = provinceById(provinceId);
  const provinceLabel = province?.label || "Limburg";
  const allPlaces = province?.places || [];

  useEffect(() => {
    setSelectedPlaces(allPlaces);
  }, [provinceId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset places when province changes

  const places =
    mode === "all_places"
      ? selectedPlaces.filter((p) => allPlaces.includes(p))
      : [];

  const autoPrompt = useMemo(
    () =>
      buildMetaAlternativesBasePrompt({
        province: provinceLabel,
        mode,
        sourceAdName: winner.adName,
      }),
    [provinceLabel, mode, winner.adName]
  );

  useEffect(() => {
    if (!promptTouched) setPrompt(autoPrompt);
  }, [autoPrompt, promptTouched]);

  const scriptPreview = useMemo(() => {
    const loc =
      mode === "all_places" && places[0] ? places[0] : provinceLabel;
    return buildUgcVideoScript({ region: loc });
  }, [mode, places, provinceLabel]);

  const generateCount =
    output === "video"
      ? mode === "all_places"
        ? places.length
        : 1
      : mode === "all_places"
        ? places.length
        : 5;

  const generateLabel =
    output === "video"
      ? mode === "all_places"
        ? `Maak ${places.length} UGC-video’s (${provinceLabel}-plaatsen)`
        : `Maak 1 UGC-video · ${provinceLabel}`
      : mode === "all_places"
        ? `Maak ${places.length} stills · alle plaatsen`
        : `Maak 5 stills · provincie ${provinceLabel}`;

  function togglePlace(place: string) {
    setSelectedPlaces((prev) =>
      prev.includes(place) ? prev.filter((p) => p !== place) : [...prev, place]
    );
  }

  async function generate() {
    if (mode === "all_places" && places.length === 0) {
      setMsg("Selecteer minstens één plaats.");
      return;
    }
    if (output === "still" && !prompt.trim()) {
      setMsg("Prompt is leeg.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/performance-marketing/library", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_meta_alternatives",
          meta: {
            adId: winner.adId,
            adName: winner.adName,
            title: winner.title,
            body: winner.body,
            imageUrl: winner.imageUrl,
            thumbnailUrl: winner.thumbnailUrl,
            campaignName: winner.campaignName,
            linkUrl: winner.linkUrl,
          },
          province: provinceLabel,
          mode,
          places: mode === "all_places" ? places : undefined,
          output,
          basePrompt: output === "still" ? prompt : undefined,
          count: 5,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        count?: number;
        message?: string;
        items?: CreativeLibraryItem[];
        library?: { items: CreativeLibraryItem[] };
      };
      if (!res.ok) throw new Error(json.error || "Genereren mislukt");
      const items = json.library?.items || [];
      const count = json.count ?? json.items?.length ?? generateCount;
      setMsg(
        `✓ ${count} ${output === "video" ? "video-scripts" : "stills"} in New creatives — bezig op de achtergrond.`
      );
      onGenerated(items, {
        count,
        output,
        message: json.message,
      });
      // Kort succes tonen, daarna sluiten zodat progress-panel zichtbaar is
      window.setTimeout(() => onClose(), 900);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  const img = winner.imageUrl || winner.thumbnailUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center">
      <div className="max-h-[94vh] w-full max-w-5xl overflow-auto rounded-2xl border border-line bg-white shadow-xl">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="relative min-h-[220px] bg-wash lg:min-h-full">
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img}
                alt={winner.adName}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted">
                Geen preview
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent p-4 pt-16">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">
                Meta winner
              </p>
              <p className="font-display text-lg font-semibold text-white">
                {winner.adName}
              </p>
              <p className="text-xs text-white/80">
                {winner.title || "—"}
                {winner.campaignName ? ` · ${winner.campaignName}` : ""}
              </p>
            </div>
          </div>

          <div className="space-y-4 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-display text-xl font-semibold text-ink">
                  Variaties maken
                </p>
                <p className="text-xs text-muted">
                  Kies format → regio → genereer. Drafts landen onder New
                  creatives.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-sm font-semibold text-muted"
              >
                Sluiten
              </button>
            </div>

            {/* 1. Format */}
            <section className="space-y-2">
              <StepLabel n={1} title="Wat wil je maken?" />
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setOutput("still")}
                  className={[
                    "rounded-xl border px-3 py-3 text-left",
                    output === "still"
                      ? "border-green-dark bg-[#F3F8F4] ring-1 ring-green-dark/30"
                      : "border-line bg-white hover:border-green-dark/40",
                  ].join(" ")}
                >
                  <p className="text-sm font-semibold text-ink">
                    Still · Meta 1:1
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    Native karton-UGC met locatie. Regionale persoon 40–70+,
                    vaak in auto.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setOutput("video")}
                  className={[
                    "rounded-xl border px-3 py-3 text-left",
                    output === "video"
                      ? "border-green-dark bg-[#F3F8F4] ring-1 ring-green-dark/30"
                      : "border-line bg-white hover:border-green-dark/40",
                  ].join(" ")}
                >
                  <p className="text-sm font-semibold text-ink">
                    UGC video · 9:16
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    Script → beats + swipe-SFX. CTA altijd: “
                    {BC_UGC_VIDEO_CTA}”
                  </p>
                </button>
              </div>
            </section>

            {/* 2. Regio */}
            <section className="space-y-2">
              <StepLabel n={2} title="Regio / targeting" />
              <label className="block text-xs font-semibold text-muted">
                Provincie
                <select
                  className="mt-1 h-10 w-full border border-line bg-white px-2 text-sm text-ink"
                  value={provinceId}
                  onChange={(e) => {
                    setProvinceId(e.target.value);
                    setPromptTouched(false);
                  }}
                >
                  {NL_PROVINCES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-2 sm:grid-cols-2">
                <label
                  className={[
                    "flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-xs",
                    mode === "province_only"
                      ? "border-green-dark bg-[#F3F8F4]"
                      : "border-line bg-white",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    className="mt-0.5"
                    name="geo-mode"
                    checked={mode === "province_only"}
                    onChange={() => {
                      setMode("province_only");
                      setPromptTouched(false);
                    }}
                  />
                  <span>
                    <span className="font-semibold text-ink">
                      Alleen provincie
                    </span>
                    <span className="mt-0.5 block text-muted">
                      Karton: IN {provinceLabel.toUpperCase()}
                      {output === "still" ? " · 5 varianten" : " · 1 video"}
                    </span>
                  </span>
                </label>
                <label
                  className={[
                    "flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-xs",
                    mode === "all_places"
                      ? "border-green-dark bg-[#F3F8F4]"
                      : "border-line bg-white",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    className="mt-0.5"
                    name="geo-mode"
                    checked={mode === "all_places"}
                    onChange={() => {
                      setMode("all_places");
                      setPromptTouched(false);
                    }}
                  />
                  <span>
                    <span className="font-semibold text-ink">
                      Plaats-gebonden
                    </span>
                    <span className="mt-0.5 block text-muted">
                      1 creative per plaats (bijv. IN GELEEN)
                    </span>
                  </span>
                </label>
              </div>

              {mode === "all_places" ? (
                <div className="rounded-xl border border-line bg-wash px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase text-muted">
                      Plaatsen ({places.length}/{allPlaces.length})
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-[10px] font-semibold text-green-dark"
                        onClick={() => setSelectedPlaces(allPlaces)}
                      >
                        Alles
                      </button>
                      <button
                        type="button"
                        className="text-[10px] font-semibold text-muted"
                        onClick={() => setSelectedPlaces([])}
                      >
                        Geen
                      </button>
                    </div>
                  </div>
                  <div className="flex max-h-28 flex-wrap gap-1.5 overflow-auto">
                    {allPlaces.map((place) => {
                      const on = selectedPlaces.includes(place);
                      return (
                        <button
                          key={place}
                          type="button"
                          onClick={() => togglePlace(place)}
                          className={[
                            "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                            on
                              ? "bg-green-dark text-white"
                              : "bg-white text-muted ring-1 ring-line",
                          ].join(" ")}
                        >
                          {place}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>

            {/* 3. Prompt / script */}
            <section className="space-y-2">
              <StepLabel
                n={3}
                title={output === "video" ? "Script-preview" : "Prompt"}
              />
              {output === "video" ? (
                <div className="rounded-xl border border-green-dark/25 bg-[#F3F8F4] px-3 py-2.5">
                  <p className="text-xs font-semibold text-ink">
                    {scriptPreview.angle}
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    CTA (vast): {BC_UGC_VIDEO_CTA}
                  </p>
                  <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-ink">
                    {scriptPreview.scriptText}
                  </pre>
                  {mode === "all_places" && places.length > 1 ? (
                    <p className="mt-2 text-[10px] text-muted">
                      Preview toont 1e plaats; elke geselecteerde plaats krijgt
                      eigen script + video-job.
                    </p>
                  ) : null}
                </div>
              ) : (
                <>
                  <textarea
                    className="min-h-[120px] w-full resize-y border border-line bg-white px-2 py-2 font-mono text-[11px] leading-relaxed text-ink"
                    value={prompt}
                    onChange={(e) => {
                      setPromptTouched(true);
                      setPrompt(e.target.value);
                    }}
                  />
                  {promptTouched ? (
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-green-dark"
                      onClick={() => {
                        setPromptTouched(false);
                        setPrompt(autoPrompt);
                      }}
                    >
                      Reset naar standaard-prompt
                    </button>
                  ) : null}
                </>
              )}
            </section>

            {msg ? (
              <p
                className={[
                  "rounded-xl border px-3 py-2 text-xs font-semibold",
                  msg.startsWith("✓")
                    ? "border-green-dark/40 bg-[#F3F8F4] text-ink"
                    : "border-[#C45A12]/40 bg-[#FFF0E6] text-[#C45A12]",
                ].join(" ")}
              >
                {msg}
              </p>
            ) : null}

            <button
              type="button"
              disabled={busy || generateCount === 0}
              onClick={() => void generate()}
              className="relative h-12 w-full overflow-hidden rounded-xl bg-green-dark text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 animate-pulse rounded-full bg-white" />
                  Bezig met aanmaken… ({generateCount}×)
                </span>
              ) : (
                generateLabel
              )}
            </button>
            <p className="text-[10px] text-muted">
              Na klik: drafts + queue verschijnen direct. Progress zie je
              bovenaan de library terwijl Higgsfield op de achtergrond maakt.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
