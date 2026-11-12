/**
 * Variation briefs van BC winning UGC (karton-tekst) → Higgsfield prompts.
 *
 * Doel-creative (wat converteert):
 * - NATIVE ad = lijkt géén ad (UGC / telefoonfoto, karton met handschrift)
 * - LOCATIE altijd op het karton (plaats of provincie)
 * - Meta Feed 1:1 (karton-UGC) of TikTok 9:16
 * - Funnel: tijdelijke regeling / bijna gratis / €0 / qualify
 */

import type {
  CreativeLibraryItem,
  CreativeVariationKind,
} from "@/lib/performance-marketing";
import {
  BC_FUNNEL_HOOKS,
  BC_UGC_VIDEO_CTA,
} from "@/lib/performance-marketing";
import { regionalPersonaFor } from "@/lib/nl-geo-targeting";

export type VariationBuild = {
  prompt: string;
  format: "1x1" | "9x16";
  media: "image" | "video";
  label: string;
  /** Shotlist + VO + SFX — alleen bij UGC video */
  videoScript?: string;
  cta?: string;
};

export type UgcVideoBeat = {
  t: string;
  board: string;
  vo: string;
  sfx: string;
  action: string;
};

/**
 * Kernprompt voor elke still/video.
 * Native ≠ polished ad. Locatie ≠ optioneel.
 * Persoon = regionale uitstraling, leeftijd 40–70+.
 */
export const NATIVE_LOCATION_RULES = `GOAL CREATIVE (BatterijConcept — what converts):
A NATIVE ad that does NOT look like an ad.

MUST:
- Photorealistic Dutch UGC / phone snapshot (Instagram/Facebook feed), candid, slight grain, imperfect framing OK.
- One real person (or couple) holding a physical brown cardboard or paper sign.
- AGE: subject(s) look 40–70+ (homeowners in that range convert). Prefer 48–65. Never teen/twenty-something influencers.
- REGIONAL LOOK: match the province’s local appearance / vibe (e.g. Utrechter in Utrecht, Brabander in Noord-Brabant, Groninger in Groningen, Fries in Friesland) — natural, recognisable as “from there”, not a generic stock model.
- ALL marketing text ONLY as handwritten black marker CAPITALS on that physical cardboard — nothing else.
- LOCATION is mandatory on the cardboard (city OR province) — e.g. "IN GELEEN" / "IN LIMBURG". Never generic-only without a place/province when a location is provided.
- Hooks on the board: tijdelijke regeling · bijna gratis · check nu (and/or €0 / zonder eigen investering).
- Meta Feed format: true square 1:1, edge-to-edge photo, fill the frame (no letterboxing, no white bars).
- Car-interior UGC (driver/passenger seat, dashboard visible, phone selfie in car) is a HIGH-PERFORMING setting — use often as a variant.

MUST NOT:
- Look like a designed advertisement, brand campaign, or landing-page screenshot.
- UI buttons, yellow CTA pills, bold graphic overlays, logos, watermarks, stock-photo gloss, studio lighting.
- Fake “Learn more” stickers or text boxes floating on the image.
- Typographic posters / map-infographic style (that is a different creative type).
- Young influencers under ~40.`;

const NATIVE_RULES = NATIVE_LOCATION_RULES;

/** Script-first UGC video: angle → beats → vaste CTA + popular SFX. */
export function buildUgcVideoScript(opts: {
  region: string;
  cardboard?: string | null;
}): {
  angle: string;
  cta: string;
  beats: UgcVideoBeat[];
  scriptText: string;
  generationPrompt: string;
} {
  const region = (opts.region || "Nederland").trim() || "Nederland";
  const loc = region.toUpperCase();
  const persona = regionalPersonaFor(region);
  const angle = `Tijdelijke regeling · bijna gratis thuisbatterij in ${region}`;
  const cta = BC_UGC_VIDEO_CTA;

  const beats: UgcVideoBeat[] = [
    {
      t: "0.0–1.5s",
      board: "TIJDELIJKE REGELING",
      vo: `Wacht — er is een tijdelijke regeling voor een bijna gratis thuisbatterij.`,
      sfx: "SWIPE / whoosh — karton wordt omhoog getrokken in beeld (popular TikTok transition)",
      action: `${persona.label} 48–65 (regional look) lifts cardboard into frame toward phone camera; car interior OR front door; handheld UGC`,
    },
    {
      t: "1.5–3.5s",
      board: `IN ${loc}`,
      vo: `In ${region}. Veel mensen weten dit nog niet.`,
      sfx: "SWIPE / veeg — locatienaam schuift of veegt naar boven op het bord (targeting reveal)",
      action: `Flip or lift second board / wipe reveal: location "${loc}" appears large on cardboard. Quick camera push-in.`,
    },
    {
      t: "3.5–5.5s",
      board: "BIJNA GRATIS / €0 START",
      vo: `Bijna gratis — zonder grote eigen investering aan de start.`,
      sfx: "Soft swipe / paper lift — volgend bord omhoog",
      action: `Next cardboard line revealed: BIJNA GRATIS / €0. Keep native phone grain.`,
    },
    {
      t: "5.5–8.0s",
      board: "CHECK NU",
      vo: cta,
      sfx: "Final soft whoosh + subtle UI-click feel (not stock ad sting)",
      action: `Look to camera, hold board steady. Spoken + on-screen CTA EXACTLY: "${cta}". End freeze on face + board.`,
    },
  ];

  const scriptText = [
    `ANGLE: ${angle}`,
    `PERSONA: ${persona.label} — ${persona.vibe} · age 40–70+`,
    `FORMAT: 9:16 · 7–8s · native UGC (looks NOT like an ad)`,
    `CTA (ALWAYS, spoken + on-screen): ${cta}`,
    ``,
    `BEATS:`,
    ...beats.map(
      (b, i) =>
        `${i + 1}. [${b.t}] BOARD: "${b.board}"\n   VO: "${b.vo}"\n   SFX: ${b.sfx}\n   ACTION: ${b.action}`
    ),
    ``,
    `SFX RULES: use popular swipe/whoosh/wipe when board lifts or location targeting text rises — these convert. No loud meme sounds, no copyrighted music stings.`,
    `TEXT RULES: marketing copy ONLY on physical cardboard (handwritten marker). CTA may also be spoken. No fake Meta buttons.`,
  ].join("\n");

  const generationPrompt = `${NATIVE_LOCATION_RULES}

UGC VIDEO — script-first (follow beats exactly).

ANGLE: ${angle}
PERSONA: ${persona.label} (${persona.vibe}), age 40–70+.
FORMAT: vertical 9:16 TikTok/Reels, 7–8 seconds, photoreal phone UGC, natural light, slight grain.
SETTING preference: car interior selfie OR Dutch front door — both convert.

Follow this shotlist beat-by-beat:
${beats
  .map(
    (b, i) =>
      `${i + 1}. ${b.t} — Board text "${b.board}". ${b.action}. Voice (Dutch): "${b.vo}". SFX: ${b.sfx}.`
  )
  .join("\n")}

CTA MUST be spoken and implied on the final beat EXACTLY:
"${cta}"

Audio: Dutch spoken VO matching beats + swipe/whoosh SFX on board lifts and location reveal. No polished ad music bed.
Native energy only — not a designed commercial.`.trim();

  return { angle, cta, beats, scriptText, generationPrompt };
}

function cardboardFromItem(item: CreativeLibraryItem): string {
  if (item.cardboardText?.trim()) return item.cardboardText.trim();
  const h = (item.headline || "TIJDELIJKE REGELING THUISBATTERIJ").toUpperCase();
  return h.replace(/[,.—–]/g, "\n").slice(0, 120);
}

export function buildVariationPrompt(
  item: CreativeLibraryItem,
  kind: CreativeVariationKind,
  opts?: { region?: string; aggressiveLine?: string }
): VariationBuild {
  const cardboard = cardboardFromItem(item);
  const region = opts?.region || "Nederland";
  const aggressive =
    opts?.aggressiveLine ||
    `TIJDELIJKE REGELING / BIJNA GRATIS / THUISBATTERIJ / IN ${region.toUpperCase()} / CHECK NU`;

  switch (kind) {
    case "animation_video": {
      const ugc = buildUgcVideoScript({ region, cardboard });
      return {
        media: "video",
        format: "9x16",
        label: "Animatie / UGC video",
        prompt: ugc.generationPrompt,
        videoScript: ugc.scriptText,
        cta: ugc.cta,
      };
    }
    case "other_background":
      return {
        media: "image",
        format: "1x1",
        label: "Andere achtergrond",
        prompt: `${NATIVE_RULES}

Same native cardboard (text EXACTLY "${cardboard.replace(/\n/g, " / ")}") — DIFFERENT setting only (car interior selfie OR front door brick house OR laundry OR kitchen). Prefer car cabin when varying background. Age 40–70+. Keep location on the board. True Meta 1:1 square.`,
      };
    case "other_people":
      return {
        media: "image",
        format: "1x1",
        label: "Andere mensen",
        prompt: `${NATIVE_RULES}

Same native cardboard message "${cardboard.replace(/\n/g, " / ")}" — DIFFERENT people only, age 40–70+ (couple 55–65 OR woman 48–60 OR man 50–68 with regional ${region} look). Location stays on the cardboard. True Meta 1:1 square, raw phone photo.`,
      };
    case "aggressive_copy":
      return {
        media: "image",
        format: "1x1",
        label: "Agressievere tekst",
        prompt: `${NATIVE_RULES}

Native UGC person holding cardboard with MORE urgent handwritten Dutch text EXACTLY: "${aggressive}". Location must appear on the board. True Meta 1:1 square — looks like a real phone photo in the feed, not an ad.`,
      };
    case "other_region":
      return {
        media: "image",
        format: "1x1",
        label: `Regio ${region}`,
        prompt: `${NATIVE_RULES}

Native UGC cardboard with location locked to ${region}. Text EXACTLY: "TIJDELIJKE REGELING / BIJNA GRATIS / THUISBATTERIJ / IN ${region.toUpperCase()} / CHECK NU". Dutch residential vibe. True Meta 1:1 square.`,
      };
  }
}

export const VARIATION_OPTIONS: {
  kind: CreativeVariationKind;
  title: string;
  blurb: string;
}[] = [
  {
    kind: "animation_video",
    title: "Animatie / UGC video",
    blurb: "Script → 9:16 video · swipe-SFX · vaste CTA",
  },
  {
    kind: "other_background",
    title: "Andere achtergrond",
    blurb: "Zelfde native karton+locatie, andere setting",
  },
  {
    kind: "other_people",
    title: "Andere mensen",
    blurb: "Andere personen — zelfde locatie op karton",
  },
  {
    kind: "aggressive_copy",
    title: "Agressievere tekst",
    blurb: "Hardere karton-copy · locatie blijft erop",
  },
  {
    kind: "other_region",
    title: "Andere regio",
    blurb: "Zelfde native style · andere plaats/provincie",
  },
];

export type MetaGeoMode = "province_only" | "all_places";

/** Default agressieve karton-tekst — locatie altijd erin */
export function aggressiveCardboard(location: string): string {
  const loc = location.toUpperCase();
  return `TIJDELIJKE REGELING\nBIJNA GRATIS\nTHUISBATTERIJ\nIN ${loc}\nCHECK NU`;
}

/** Settings die goed converteren — auto-interieur vaak. */
const ALT_SETTINGS = [
  "inside a Dutch family car (driver or passenger seat selfie), cardboard held toward phone camera, dashboard/steering wheel visible, daylight through windows — HIGH PERFORMER",
  "parked car interior, person in passenger seat holding cardboard to phone, candid UGC",
  "Dutch brick house front door, residential street",
  "bright hallway with glass door and simple pendant light",
  "utility/laundry room with washing machine",
  "kitchen with boiler / window plant",
  "front garden hedge, brick facade, natural daylight",
];

/**
 * Bewerkbare basis-prompt voor Meta native + locatie.
 * {LOCATIE} = placeholder bij alle-plaatsen mode.
 */
export function buildMetaAlternativesBasePrompt(opts: {
  province: string;
  mode: MetaGeoMode;
  sourceAdName?: string | null;
}): string {
  const locExample =
    opts.mode === "all_places" ? "{LOCATIE}" : opts.province;
  const cardboard = aggressiveCardboard(locExample).replace(/\n/g, " / ");
  const persona = regionalPersonaFor(opts.province);
  const modeNote =
    opts.mode === "all_places"
      ? `LOCATION MODE: place-level. Replace {LOCATIE} with each city in ${opts.province}. Cardboard MUST name the city (e.g. IN GELEEN) — that local hook is what makes it convert.`
      : `LOCATION MODE: province-only. Cardboard names "${opts.province}" (e.g. IN ${opts.province.toUpperCase()}). Do not invent a city name.`;

  return `${NATIVE_LOCATION_RULES}

${modeNote}

REGIONAL PERSONA (${persona.label}): ${persona.vibe}
Age band: 40–70+ (prefer 48–65). Look like a real ${persona.label} homeowner from ${opts.province}.

Cardboard handwritten text EXACTLY:
"${cardboard}"

Funnel intent (spoken vibe / implied, not as UI): ${BC_FUNNEL_HOOKS.join(" · ")}

Format: Meta Feed 1:1 square, photoreal still, fill the whole frame.
Rotate settings: include car-interior variants (ads in cars convert well).
${opts.sourceAdName ? `Style reference winner: ${opts.sourceAdName} — match that native cardboard UGC energy, not a redesign.` : ""}`.trim();
}

export type MetaAlternativeBrief = {
  index: number;
  label: string;
  location: string;
  cardboardText: string;
  headline: string;
  primaryText: string;
  prompt: string;
  format: "1x1";
};

function fillLocation(template: string, location: string): string {
  return template
    .replaceAll("{LOCATIE}", location)
    .replaceAll("{locatie}", location)
    .replaceAll("{PLAATS}", location)
    .replaceAll("{plaats}", location);
}

/** Native+locatie varianten: provincie-only óf 1× per plaats. */
export function buildMetaAlternativeBriefs(opts: {
  basePrompt: string;
  province: string;
  mode: MetaGeoMode;
  places?: string[];
  count?: number;
}): MetaAlternativeBrief[] {
  if (opts.mode === "all_places") {
    const places = (opts.places || []).filter((p) => p.trim());
    return places.map((place, i) => {
      const cardboard = aggressiveCardboard(place);
      const cardboardOneLine = cardboard.replace(/\n/g, " / ");
      const persona = regionalPersonaFor(place, opts.province);
      const people =
        persona.people[i % persona.people.length] ||
        `local ${persona.label} 48–65 holding cardboard`;
      const setting = ALT_SETTINGS[i % ALT_SETTINGS.length]!;
      const filled = fillLocation(opts.basePrompt, place);
      return {
        index: i + 1,
        label: `Native · ${place}`,
        location: place,
        cardboardText: cardboard,
        headline: `Bijna gratis thuisbatterij? Tijdelijke regeling ${place}`,
        primaryText: `STOP — tijdelijke regeling voor een bijna gratis thuisbatterij in ${place}.\n\nVeel woningeigenaren weten dit nog niet. Of ú in aanmerking komt hangt af van gemeente en woning.\n\n👉 Selecteer uw gemeente\n👉 Beantwoord een paar korte vragen\n👉 Check vrijblijvend of u in aanmerking komt\n\nGeen verplichtingen. Eerst checken.`,
        format: "1x1" as const,
        prompt: `${filled}

VARIANT ${i + 1}/${places.length} — NATIVE + LOCATION ${place} (${opts.province}):
- Looks like a real phone photo someone posted — NOT an ad
- Regional persona: ${persona.label} — ${persona.vibe}
- Subject: ${people} (age 40–70+)
- Setting: ${setting}
- Cardboard EXACTLY: "${cardboardOneLine}"
- Location word on the sign MUST be "${place.toUpperCase()}"
- Meta 1:1 square, edge-to-edge, no letterboxing`.trim(),
      };
    });
  }

  const n = Math.min(Math.max(opts.count ?? 5, 1), 8);
  const loc = opts.province;
  const cardboard = aggressiveCardboard(loc);
  const cardboardOneLine = cardboard.replace(/\n/g, " / ");
  const filled = fillLocation(opts.basePrompt, loc);
  const persona = regionalPersonaFor(loc);

  return Array.from({ length: n }, (_, i) => {
    const people =
      persona.people[i % persona.people.length] ||
      `local ${persona.label} 48–65 holding cardboard`;
    // Bias first variants toward car interiors (high performers)
    const setting =
      i < 2
        ? ALT_SETTINGS[i % 2]!
        : ALT_SETTINGS[i % ALT_SETTINGS.length]!;
    return {
      index: i + 1,
      label: `Native · ${loc} · v${i + 1}`,
      location: loc,
      cardboardText: cardboard,
      headline: `Bijna gratis thuisbatterij? Tijdelijke regeling ${loc}`,
      primaryText: `STOP — tijdelijke regeling voor een bijna gratis thuisbatterij in ${loc}.\n\nVeel woningeigenaren weten dit nog niet. Of ú in aanmerking komt hangt af van gemeente en woning.\n\n👉 Selecteer uw gemeente\n👉 Beantwoord een paar korte vragen\n👉 Check vrijblijvend of u in aanmerking komt\n\nGeen verplichtingen. Eerst checken.`,
      format: "1x1" as const,
      prompt: `${filled}

VARIANT ${i + 1}/${n} — NATIVE + LOCATION ${loc}:
- Looks like a real phone photo someone posted — NOT an ad
- Regional persona: ${persona.label} — ${persona.vibe}
- Subject: ${people} (age 40–70+)
- Setting: ${setting}
- Cardboard EXACTLY: "${cardboardOneLine}"
- Location on sign: "${loc.toUpperCase()}" (province — no city name)
- Meta 1:1 square, edge-to-edge, no letterboxing`.trim(),
    };
  });
}
