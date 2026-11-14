/**
 * Top-of-funnel creative engine.
 * Swipe Foreplay winners (home-services TOF hooks) → remprompt naar BatterijConcept
 * native advertorials: tijdelijke regeling / bijna gratis / regio / €0 start.
 */

import type { ForeplayAd } from "@/lib/foreplay";
import { runningDays } from "@/lib/foreplay";
import {
  buildStructuredAdName,
  type PerformanceAdFormat,
} from "@/lib/performance-marketing";

/**
 * Hot lead-gen niches — verticals die structureel long-running TOF ads draaien
 * ($0 down / qualify / limited spots / regional). We swipen die hooks → remprompt
 * naar BatterijConcept native UGC.
 */
export const FOREPLAY_SWIPE_QUERIES = [
  "1 day bath remodel",
  "walk in shower 1 day",
  "senior medical alert",
  "life alert qualify",
  "life insurance $0",
  "final expense insurance",
  "solar battery rebate",
  "solar panels free program",
  "car insurance quote",
  "auto insurance save",
  "windows $0 down",
] as const;

export type TofAngle =
  | "tijdelijke_regeling"
  | "bijna_gratis"
  | "nul_aanbetaling"
  | "regio"
  | "qualify_check";

export type TofRegion =
  | "Limburg"
  | "Noord-Brabant"
  | "Zeeland"
  | "Zuid-Holland"
  | "Nederland";

export type TofBrief = {
  id: string;
  sourceQuery: string;
  sourceAdId: string;
  sourceBrand: string;
  sourceHeadline: string | null;
  sourceDescription: string | null;
  sourceImageUrl: string | null;
  sourceRunningDays: number;
  sourceForeplayUrl: string | null;
  angle: TofAngle;
  region: TofRegion;
  /** Meta primary text (NL) */
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
  /** Higgsfield image prompt — native UGC, tekst op papier/karton */
  imagePrompt: string;
  cardboardText: string;
  platform: "Meta" | "TikTok";
  format: PerformanceAdFormat;
  adName: string;
  campaignHint: string;
};

const DEFAULT_LANDER = "https://info-promotie.nl/lp/747223";
const CAMPAIGN_HINT = "BATTERIJ - NL - CAMPAIGN - V1 - ADV";

const ANGLE_WEIGHTS: { angle: TofAngle; match: RegExp }[] = [
  {
    angle: "nul_aanbetaling",
    match: /\$0\s*down|0\s*down|no[-\s]?cost|nothing up front|gratis|free\b|€\s*0|zero down/i,
  },
  {
    angle: "tijdelijke_regeling",
    match: /program|rebate|incentive|regeling|limited|temporary|202[4-9]|federal|scheme/i,
  },
  {
    angle: "bijna_gratis",
    match: /almost free|no[-\s]?net[-\s]?cost|nearly free|bijna|discount|off\b|save/i,
  },
  {
    angle: "regio",
    match: /\b(west virginia|virginia|washington|nsw|vic|ontario|limburg|brabant|zeeland|holland|gemeente|city|county|state)\b/i,
  },
  {
    angle: "qualify_check",
    match: /qualif|see if you|check if|in aanmerking|eligibility|spots/i,
  },
];

export function detectAngle(ad: ForeplayAd): TofAngle {
  const blob = `${ad.headline || ""} ${ad.description || ""} ${ad.name || ""}`;
  for (const row of ANGLE_WEIGHTS) {
    if (row.match.test(blob)) return row.angle;
  }
  return "tijdelijke_regeling";
}

const REGIONS: TofRegion[] = [
  "Limburg",
  "Noord-Brabant",
  "Zeeland",
  "Zuid-Holland",
  "Nederland",
];

export function pickRegion(index: number, ad: ForeplayAd): TofRegion {
  const blob = `${ad.headline || ""} ${ad.description || ""}`.toLowerCase();
  if (/limburg/.test(blob)) return "Limburg";
  if (/brabant|eindhoven|tilburg/.test(blob)) return "Noord-Brabant";
  if (/zeeland|middelburg|vlissingen/.test(blob)) return "Zeeland";
  if (/zuid[- ]?holland|rotterdam|den haag|dordrecht/.test(blob))
    return "Zuid-Holland";
  return REGIONS[index % REGIONS.length]!;
}

export function cardboardForAngle(
  angle: TofAngle,
  region: TofRegion
): { cardboard: string; headline: string; primary: string; description: string } {
  switch (angle) {
    case "nul_aanbetaling":
      return {
        cardboard: `TIJDELIJKE REGELING\nTHUISBATTERIJ\n€0 START MOGELIJK\n${region.toUpperCase()}`,
        headline: `€0 start mogelijk — check ${region}`,
        primary: `Heeft u zonnepanelen in ${region}?\n\nEr loopt een tijdelijke regeling waardoor u mogelijk kunt starten met een thuisbatterij zonder eerst duizenden euro's aan te betalen.\n\n👉 Selecteer uw gemeente\n👉 Beantwoord een paar korte vragen\n👉 Bekijk vrijblijvend of u in aanmerking komt\n\nControleer eerst. Beslis daarna.`,
        description: "Vrijblijvende check · geen verplichtingen",
      };
    case "bijna_gratis":
      return {
        cardboard: `BIJNA GRATIS?\nTHUISBATTERIJ\nCHECK EERST\n${region.toUpperCase()}`,
        headline: `Bijna gratis thuisbatterij? Check ${region}`,
        primary: `Veel huishoudens in ${region} weten niet dat er een tijdelijke regeling loopt voor een thuisbatterij.\n\nAfhankelijk van uw woning en situatie kan de start veel lager uitvallen dan u denkt — soms dicht bij “bijna gratis”.\n\n👉 Gemeente selecteren\n👉 Korte vragen\n👉 Direct inzicht (vrijblijvend)\n\nGeen verplichtingen.`,
        description: "Tijdelijke regeling · check uw situatie",
      };
    case "regio":
      return {
        cardboard: `${region.toUpperCase()}\nTIJDELIJKE REGELING\nVOOR EEN\nTHUISBATTERIJ`,
        headline: `Tijdelijke regeling thuisbatterij in ${region}`,
        primary: `Woonachtig in ${region} met zonnepanelen?\n\nEr is een tijdelijke regeling voor een thuisbatterij in uw regio. Of u in aanmerking komt hangt af van gemeente en woning.\n\n👉 Selecteer ${region}-gemeente\n👉 Beantwoord 4 korte vragen\n👉 Bekijk of u in aanmerking komt\n\nControleer eerst. Beslis daarna.`,
        description: `Alleen ${region} · tijdelijke spots`,
      };
    case "qualify_check":
      return {
        cardboard: `KOMT U IN\nAANMERKING?\nTHUISBATTERIJ\n${region.toUpperCase()}`,
        headline: `Check of u in aanmerking komt (${region})`,
        primary: `Niet iedereen komt in aanmerking voor de tijdelijke thuisbatterij-regeling in ${region}.\n\nIn 2 minuten ziet u of úw woning en situatie mogelijk in aanmerking komen — zonder verplichtingen.\n\n👉 Gemeente\n👉 Situatie\n👉 Resultaat\n\nEerst checken, dan pas kiezen.`,
        description: "Qualify-check · 2 minuten",
      };
    case "tijdelijke_regeling":
    default:
      return {
        cardboard: `TIJDELIJKE REGELING\nTHUISBATTERIJ\nIN ${region.toUpperCase()}\nCHECK NU`,
        headline: `Tijdelijke regeling: thuisbatterij ${region}`,
        primary: `☀️ Tijdelijke regeling voor een thuisbatterij in ${region}.\n\nHeeft u zonnepanelen? Veel huishoudens leveren overdag stroom terug die ze 's avonds zelf nodig hebben. Met een batterij bewaart u een deel zelf.\n\nOf u kunt starten (en onder welke voorwaarden) hangt af van uw situatie.\n\n👉 Selecteer uw gemeente\n👉 Beantwoord een paar korte vragen\n👉 Bekijk vrijblijvend de mogelijkheden\n\nControleer eerst. Beslis daarna.`,
        description: "Tijdelijke regeling · vrijblijvend",
      };
  }
}

function nativeImagePrompt(cardboard: string, region: TofRegion, variant: number): string {
  const board = cardboard.replace(/\n/g, " / ");
  const goal = `GOAL: NATIVE ad that does NOT look like an ad. Photoreal Dutch phone UGC. Text ONLY handwritten on physical cardboard. LOCATION "${region}" must appear on the board. Subject age 40–70+ with local ${region} appearance (e.g. Utrechter/Brabander/Groninger/Fries by province). Meta Feed 1:1 square, fill the frame, no letterboxing. NO UI buttons, NO yellow CTAs, NO logos, NO designed ad overlays.`;
  const scenes = [
    `${goal} Local homeowner 48–60 in car interior (passenger/driver seat selfie) holding cardboard: "${board}". Dashboard visible, daylight through windows — high performer.`,
    `${goal} Local couple 55–65 outside brick house, cardboard: "${board}". Soft daylight, candid — not studio. Regional ${region} look.`,
    `${goal} Person 50–68 at Dutch front door with cardboard: "${board}". Phone snapshot, slight tilt. ${region} vibe.`,
    `${goal} Homeowner 45–60 in modest Dutch kitchen/utility holding cardboard: "${board}". Natural window light, phone grain.`,
    `GOAL: NATIVE TikTok UGC (9:16) that does NOT look like an ad. Local homeowner 48–65 (regional ${region} look) in car or hallway shows cardboard "${board}" to camera. Location ${region} on the board. Natural light. No fake buttons/overlays. Vertical 9:16.`,
  ];
  return scenes[Math.min(variant, scenes.length - 1)]!;
}

export function rempromptAd(opts: {
  ad: ForeplayAd;
  sourceQuery: string;
  index: number;
  platform?: "Meta" | "TikTok";
  format?: PerformanceAdFormat;
  region?: TofRegion;
}): TofBrief {
  const angle = detectAngle(opts.ad);
  const region = opts.region || pickRegion(opts.index, opts.ad);
  const copy = cardboardForAngle(angle, region);
  const platform = opts.platform || (opts.index === 4 ? "TikTok" : "Meta");
  const format: PerformanceAdFormat =
    opts.format || (platform === "TikTok" ? "9x16" : "1x1");
  const variant = opts.index + 1;
  const baseName = angle.replace(/_/g, "-");
  const adName = buildStructuredAdName({
    platform,
    campaignName: CAMPAIGN_HINT,
    baseAdName: baseName,
    variant,
    format,
  });

  return {
    id: `tof-${opts.ad.id}-v${variant}`,
    sourceQuery: opts.sourceQuery,
    sourceAdId: opts.ad.id,
    sourceBrand: opts.ad.name || "unknown",
    sourceHeadline: opts.ad.headline,
    sourceDescription: opts.ad.description,
    sourceImageUrl: opts.ad.image || opts.ad.thumbnail,
    sourceRunningDays: runningDays(opts.ad),
    sourceForeplayUrl: opts.ad.foreplay_url || null,
    angle,
    region,
    primaryText: copy.primary,
    headline: copy.headline,
    description: copy.description,
    cta: "SEE_DETAILS",
    imagePrompt: nativeImagePrompt(copy.cardboard, region, opts.index),
    cardboardText: copy.cardboard,
    platform,
    format,
    adName,
    campaignHint: CAMPAIGN_HINT,
  };
}

export type RankedSwipeAd = {
  query: string;
  ad: ForeplayAd;
  score: number;
  angle: TofAngle;
};

/** Rank: home-services TOF hooks + run length. Business capital / junk downranked. */
export function rankSwipeAds(
  rows: { query: string; ad: ForeplayAd }[]
): RankedSwipeAd[] {
  const seen = new Set<string>();
  const scored: RankedSwipeAd[] = [];
  for (const row of rows) {
    if (!row.ad?.id || seen.has(row.ad.id)) continue;
    if (!row.ad.image && !row.ad.thumbnail) continue;
    seen.add(row.ad.id);
    const blob =
      `${row.ad.headline || ""} ${row.ad.description || ""} ${row.ad.name || ""}`.toLowerCase();
    // Hard skip: junk / unrelated that pollutes longest_running
    if (
      /business capital|funding buddy|same day business|moving service|realtor|what's my home worth|autism medical alert|beach towel|fire sale|graffiti|necklace|bracelet|smartwatch|pulsemax|joint pain/.test(
        blob
      )
    ) {
      continue;
    }
    let score = Math.min(runningDays(row.ad), 400); // cap so 1400d spam doesn't dominate
    // Classic hot lead-gen hooks
    if (
      /\$0|0 down|no-?cost|no net cost|rebate|program|qualif|free (quote|battery|install)|incentive|limited spots|see if you|check if|how much|what does .* cost|save (up to|\$|€)|monthly/.test(
        blob
      )
    ) {
      score += 140;
    }
    // Niche relevance (source verticals we swipe)
    if (/solar|battery|thuisbatterij|zonnepaneel/.test(blob)) score += 100;
    if (/bath|walk-?in shower|remodel|1[- ]?day|same day/.test(blob)) score += 90;
    if (/medical alert|life alert|fall detection|senior|help button/.test(blob))
      score += 90;
    if (/life insurance|final expense|burial|term life/.test(blob)) score += 85;
    if (/car insurance|auto insurance|drivers? insurance|quote in minutes/.test(blob))
      score += 85;
    if (/window|stairlift|homeowner|home owners|huiseigenaar/.test(blob)) score += 50;
    if (/see if you|check if|in aanmerking|eligibility|qualify/.test(blob)) score += 50;
    if (row.ad.live) score += 20;
    // Boost intentional hot-niche queries
    if (
      /bath|shower|alert|insurance|solar|battery|windows|car insurance|life insurance/.test(
        row.query
      )
    ) {
      score += 40;
    }
    scored.push({
      query: row.query,
      ad: row.ad,
      score,
      angle: detectAngle(row.ad),
    });
  }
  return scored.sort((a, b) => b.score - a.score);
}

/** Force TOF angle mix so a batch isn’t 5× the same hook. */
const ANGLE_ROTATION: TofAngle[] = [
  "tijdelijke_regeling",
  "nul_aanbetaling",
  "regio",
  "bijna_gratis",
  "qualify_check",
];

export function briefsFromRanked(
  ranked: RankedSwipeAd[],
  count = 5
): TofBrief[] {
  return ranked.slice(0, count).map((r, i) => {
    const forced = ANGLE_ROTATION[i % ANGLE_ROTATION.length]!;
    const region = pickRegion(i, r.ad);
    const copy = cardboardForAngle(forced, region);
    const platform = i === 4 ? "TikTok" : "Meta";
    const format: PerformanceAdFormat = platform === "TikTok" ? "9x16" : "1x1";
    const variant = i + 1;
    const adName = buildStructuredAdName({
      platform,
      campaignName: CAMPAIGN_HINT,
      baseAdName: forced.replace(/_/g, "-"),
      variant,
      format,
    });
    return {
      id: `tof-${r.ad.id}-v${variant}`,
      sourceQuery: r.query,
      sourceAdId: r.ad.id,
      sourceBrand: r.ad.name || "unknown",
      sourceHeadline: r.ad.headline,
      sourceDescription: r.ad.description,
      sourceImageUrl: r.ad.image || r.ad.thumbnail,
      sourceRunningDays: runningDays(r.ad),
      sourceForeplayUrl: r.ad.foreplay_url || null,
      angle: forced,
      region,
      primaryText: copy.primary,
      headline: copy.headline,
      description: copy.description,
      cta: "SEE_DETAILS",
      imagePrompt: nativeImagePrompt(copy.cardboard, region, i),
      cardboardText: copy.cardboard,
      platform,
      format,
      adName,
      campaignHint: CAMPAIGN_HINT,
    };
  });
}

export { DEFAULT_LANDER };
