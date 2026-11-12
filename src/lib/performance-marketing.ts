/**
 * Performance Marketing: CPA/CPL ranking + creative library naming.
 * Publish naar Meta/TikTok bewust nog niet — alleen draft/library.
 */

import { marketingChannelForSource } from "@/lib/marketing-rapportage";

export type PerformanceChannel = "social" | "native" | "search" | "other";

export type PerformancePlatform = "Meta" | "TikTok" | "Native" | "Google" | string;

export type PerformanceAdFormat = "1x1" | "4x5" | "9x16" | "16x9";

export const CHANNEL_FORMATS: Record<
  "Meta" | "TikTok",
  { format: PerformanceAdFormat; label: string; aspect: string }[]
> = {
  Meta: [
    { format: "1x1", label: "Feed 1:1", aspect: "1:1" },
    { format: "4x5", label: "Feed 4:5", aspect: "4:5" },
    { format: "9x16", label: "Stories/Reels 9:16", aspect: "9:16" },
  ],
  TikTok: [{ format: "9x16", label: "In-feed 9:16", aspect: "9:16" }],
};

export type PerformanceMetricRow = {
  key: string;
  label: string;
  platform: PerformancePlatform;
  channel: PerformanceChannel;
  level: "channel" | "campaign" | "ad";
  parentKey?: string | null;
  spend: number;
  leads: number;
  afspraken: number;
  deals: number;
  omzet: number;
  cpl: number | null;
  cpa: number | null;
  cpd: number | null;
  closePct: number | null;
};

export type MetaCreativeSnapshot = {
  adId: string;
  adName: string;
  campaignName: string | null;
  status: string | null;
  creativeId: string | null;
  title: string | null;
  body: string | null;
  cta: string | null;
  linkUrl: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  localImagePath?: string | null;
};

export type CreativeLibraryStatus = "draft" | "ready" | "archived";

/** Library-indeling: Top winners · Opkomers · New creatives */
export type CreativeLibraryTier = "winner" | "rising" | "new";

export type CreativeVariationKind =
  | "animation_video"
  | "other_background"
  | "other_people"
  | "aggressive_copy"
  | "other_region";

/** Onze funnel-hooks — alles remprompten hiernaartoe */
export const BC_FUNNEL_HOOKS = [
  "Tijdelijke regeling thuisbatterij",
  "Bijna gratis thuisbatterij",
  "Regeling zonder eigen investering / €0 start",
  "Check of u in aanmerking komt (gemeente)",
] as const;

/** Vaste CTA voor UGC video's (spoken + on-screen) */
export const BC_UGC_VIDEO_CTA = "Controleer hieronder of je in aanmerking komt.";

export type CreativeLibraryItem = {
  id: string;
  /** Gestructureerde ad-naam voor later Meta/TikTok account */
  adName: string;
  /**
   * draft = review / new creative
   * ready = goedgekeurd voor launch
   * archived = afgekeurd
   */
  status: CreativeLibraryStatus;
  /** winner = top performers · rising = groeiend · new = verse creatives/varianten */
  tier: CreativeLibraryTier;
  /** publishable=false tot write-API live is */
  publishable: false;
  platform: "Meta" | "TikTok";
  format: PerformanceAdFormat;
  channel: PerformanceChannel;
  sourceWinnerAdId: string | null;
  sourceWinnerAdName: string | null;
  campaignHint: string | null;
  primaryText: string;
  headline: string;
  description: string | null;
  cta: string;
  linkUrl: string | null;
  imageUrl: string;
  thumbnailUrl?: string | null;
  higgsfieldJobId?: string | null;
  createdAt: string;
  /** Wanneer jij “dit is goed → launch draft” drukte */
  approvedAt?: string | null;
  /** Van welke goedgekeurde creative deze variant afstamt */
  parentCreativeId?: string | null;
  /** Variation request awaiting / done via Higgsfield */
  variationKind?: CreativeVariationKind | null;
  /** Prompt klaar voor Higgsfield (image of video) */
  variationPrompt?: string | null;
  /** UGC video: shotlist/script met angle, beats, SFX, vaste CTA */
  videoScript?: string | null;
  /** Gegenereerde video-URL (/creatives/… of CDN) */
  videoUrl?: string | null;
  /** Foreplay research source (inspiration only) */
  foreplayAdId?: string | null;
  foreplayUrl?: string | null;
  cardboardText?: string | null;
  notes?: string | null;
};

export type CreativeLibrary = {
  updatedAt: string;
  items: CreativeLibraryItem[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function safeDiv(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  return round2(a / b);
}

export function channelFromPlatform(platform: string): PerformanceChannel {
  const key = platform.toLowerCase().replace(/[\s_-]+/g, "");
  if (key === "social" || key === "native" || key === "search" || key === "other") {
    return key as PerformanceChannel;
  }
  const ch = marketingChannelForSource(platform);
  if (ch === "social" || ch === "native" || ch === "search") return ch;
  return "other";
}

export function slugPart(raw: string, max = 24): string {
  return (raw || "x")
    .normalize("NFKD")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, max)
    .replace(/^-|-$/g, "")
    .toUpperCase() || "X";
}

/**
 * Ad-naam voor gestructureerd account:
 * BC-{META|TT}-{CAMP}-{BASE}-v{n}-{FORMAT}
 */
export function buildStructuredAdName(opts: {
  platform: "Meta" | "TikTok";
  campaignName: string;
  baseAdName: string;
  variant: number;
  format: PerformanceAdFormat;
}): string {
  const plat = opts.platform === "TikTok" ? "TT" : "META";
  const camp = slugPart(opts.campaignName.replace(/BATTERIJ\s*-\s*NL\s*-\s*CAMPAIGN\s*-?\s*/i, ""), 18);
  const base = slugPart(opts.baseAdName, 16);
  const fmt = opts.format;
  return `BC-${plat}-${camp || "CAMP"}-${base}-v${opts.variant}-${fmt}`;
}

export function metricRow(opts: {
  key: string;
  label: string;
  platform: string;
  level: PerformanceMetricRow["level"];
  parentKey?: string | null;
  spend: number;
  leads: number;
  afspraken: number;
  deals: number;
  omzet: number;
}): PerformanceMetricRow {
  const cpl = safeDiv(opts.spend, opts.leads);
  const cpa = safeDiv(opts.spend, opts.afspraken);
  const cpd = safeDiv(opts.spend, opts.deals);
  const closePct =
    opts.afspraken > 0
      ? round2((opts.deals / opts.afspraken) * 100)
      : null;
  return {
    key: opts.key,
    label: opts.label,
    platform: opts.platform,
    channel: channelFromPlatform(opts.platform),
    level: opts.level,
    parentKey: opts.parentKey ?? null,
    spend: round2(opts.spend),
    leads: opts.leads,
    afspraken: opts.afspraken,
    deals: opts.deals,
    omzet: round2(opts.omzet),
    cpl,
    cpa,
    cpd,
    closePct,
  };
}

export function bestByCpa(
  rows: PerformanceMetricRow[],
  minAfspraken = 3
): PerformanceMetricRow | null {
  const ok = rows
    .filter((r) => r.afspraken >= minAfspraken && r.cpa != null && r.spend > 0)
    .sort((a, b) => (a.cpa ?? 1e9) - (b.cpa ?? 1e9));
  return ok[0] || null;
}

export function bestByCpl(
  rows: PerformanceMetricRow[],
  minLeads = 10
): PerformanceMetricRow | null {
  const ok = rows
    .filter((r) => r.leads >= minLeads && r.cpl != null && r.spend > 0)
    .sort((a, b) => (a.cpl ?? 1e9) - (b.cpl ?? 1e9));
  return ok[0] || null;
}

export function bestByCpd(
  rows: PerformanceMetricRow[],
  minDeals = 2
): PerformanceMetricRow | null {
  const ok = rows
    .filter((r) => r.deals >= minDeals && r.cpd != null && r.spend > 0)
    .sort((a, b) => (a.cpd ?? 1e9) - (b.cpd ?? 1e9));
  return ok[0] || null;
}

/** Standaard primary-text varianten rond winning AD11-angle. */
export function primaryTextVariants(baseBody: string): string[] {
  const clean = (baseBody || "").trim();
  return [
    clean,
    `☀️ HEEFT U ZONNEPANELEN?\n\nControleer eerst of een thuisbatterij voor úw situatie zinvol is — vaak zonder eerst duizenden euro’s voor te schieten.\n\n👉 Selecteer uw gemeente\n👉 Beantwoord een paar korte vragen\n👉 Bekijk vrijblijvend de mogelijkheden\n\nControleer eerst. Beslis daarna.`,
    `Veel huishoudens met zonnepanelen leveren overdag stroom terug die ze 's avonds zelf nodig hebben.\n\nMet een thuisbatterij bewaart u een deel van die energie.\n\nCheck in 2 minuten of úw woning in aanmerking komt — vrijblijvend.`,
    `STOP MET GRATIS TERUGLEVEREN (als het niet hoeft).\n\nHeeft u zonnepanelen? Bekijk of een thuisbatterij past bij uw verbruik en woning.\n\nGeen verplichtingen. Eerst inzicht, dan pas een keuze.`,
    `Thuisbatterij-check voor zonnepaneelbezitters.\n\nWelke mogelijkheden er zijn hangt af van uw gemeente en situatie.\n\n👉 Gemeente selecteren\n👉 Korte vragen\n👉 Vrijblijvend resultaat`,
  ];
}

export function headlineVariants(baseTitle: string): string[] {
  const t = (baseTitle || "").trim() || "Bekijk of u in aanmerking komt -->";
  return [
    t,
    "Heeft u zonnepanelen? Check dit eerst",
    "Thuisbatterij — eerst checken, dan beslissen",
    "Bekijk mogelijkheden voor uw woning",
    "Controleer of u in aanmerking komt",
  ];
}
