/**
 * Straight Line Sales Script — checkpoints voor AI-review.
 * Kritieke punten wegen zwaarder; tips krijgen een tijdstip + letterlijke zin voor TTS.
 */

export const STRAIGHT_LINE_STEPS = [
  {
    id: "1_sfeer",
    titel: "1. Sfeerfase",
    kritiek: false,
    check:
      "5–15 min band opbouwen, NIET over batterij beginnen. Pas door als gesprek stilvalt.",
  },
  {
    id: "2_panelen",
    titel: "2. Kwalificatie – zonnepanelen",
    kritiek: false,
    check:
      "Aantal, wanneer, waarom, financiering, wie besloot. Eerst panelen helemaal uitvragen.",
  },
  {
    id: "3_verbruik",
    titel: "3. Kwalificatie – verbruik & contract",
    kritiek: false,
    check:
      "Jaarnota: verbruik, teruglevering, leverancier, contract, maandbedrag. Daarna veranderingen.",
  },
  {
    id: "4_offertes_prijs",
    titel: "4. Offertes van tafel + prijsindicatie",
    kritiek: false,
    check:
      "Offertes van tafel. Daarna prijsrange zo dat close aan de lage kant valt.",
  },
  {
    id: "5_warmtefonds_spanning",
    titel: "5. Warmtefonds spannend & exclusief",
    kritiek: true,
    check:
      "Direct na prijs: Warmtefonds. Beperkt / niet iedereen goedgekeurd (50–60%). Spanning en exclusiviteit hoog houden — geen garanties.",
  },
  {
    id: "6_microclose",
    titel: "6. Micro-close",
    kritiek: true,
    check:
      "Doelen opschrijven (Warmtefonds + besparing > kosten + overige eisen). Samenvatten. Toch-vraag tot de klant JA zegt. Dit is de afspraak voor de close.",
  },
  {
    id: "7_verwachtingen",
    titel: "7. Verwachtingen schetsen (werkwijze)",
    kritiek: true,
    check:
      "Duidelijk: eerst kijken of er een goede oplossing is. Als die er is → Warmtefonds aanvragen OP LOCATIE in het gesprek. Als Warmtefonds goedkeurt → wij regelen A tot Z / volledig ontzorgen. Geen vraag om toestemming — verwachting schetsen.",
  },
  {
    id: "8_stap1_probleem",
    titel: "8. Huidige situatie & probleem (salderen)",
    kritiek: false,
    check:
      "Salderen stopt 2027, probleem groot maken, 3 opties → batterij is logisch.",
  },
  {
    id: "9_ems",
    titel: "9. EMS duidelijk uitleggen",
    kritiek: true,
    check:
      "Klant snapt 100% hoe het EMS werkt en hoe de batterij bespaart (zomer/winter). Herhaal tot het écht duidelijk is. Zonder dit: vraagtekens bij de besparing later.",
  },
  {
    id: "10_wf_opnieuw",
    titel: "10. Investering + Warmtefonds opnieuw",
    kritiek: true,
    check:
      "Range opnieuw. Warmtefonds opnieuw met spanning: weet niet of goedgekeurd. Kondig aanvraag zo meteen op locatie aan.",
  },
  {
    id: "11_installatie_product",
    titel: "11. Installatie & productwijzer",
    kritiek: false,
    check:
      "Omvormer/meterkast, plek visualiseren. Productwijzer (vaak AlphaESS) + Frank Energie.",
  },
  {
    id: "12_close",
    titel: "12. Close volgens de stappen",
    kritiek: true,
    check:
      "Eerst besparing positief, dan prijs. Doelen/micro-close herhalen. Tekenen onder voorbehoud Warmtefonds. Fonds direct aanvragen. Volg de Straight Line close-volgorde.",
  },
] as const;

export type StraightLineStapReview = {
  id: string;
  titel: string;
  status: "gedaan" | "zwak" | "gemist";
  kritiek: boolean;
  toelichting: string;
  tip: string | null;
  /** Seconden in de opname waar dit had moeten gebeuren */
  moment_sec: number | null;
  /** Letterlijke zin om voor te lezen (TTS) */
  had_moeten_zeggen: string | null;
};

export type StraightLineReview = {
  score: number;
  samenvatting: string;
  stappen: StraightLineStapReview[];
  top_tips: string[];
};

/** Korte referentie voor het AI-prompt. */
export function straightLinePromptBlock(): string {
  const kritiek = STRAIGHT_LINE_STEPS.filter((s) => s.kritiek);
  return [
    "STRAIGHT LINE SALES SCRIPT — Batterijconcept huisbezoek",
    "Volgorde is vast. Beoordeel ALLE stappen. KRITIEKE stappen wegen veel zwaarder.",
    "",
    "=== KRITIEKE PUNTEN (missen = rood / lage score) ===",
    ...kritiek.map((s) => `${s.id} | ${s.titel}\n${s.check}`),
    "",
    "=== ALLE STAPPEN ===",
    ...STRAIGHT_LINE_STEPS.map(
      (s) =>
        `${s.id} | ${s.titel}${s.kritiek ? " [KRITIEK]" : ""}\nCheckpoint: ${s.check}`
    ),
    "",
    "Kernregels:",
    "1. Micro-close (toch-vraag met JA) VOOR het boekje/close.",
    "2. Verwachtingen: eerst oplossing zoeken → als oké Warmtefonds AANVRAGEN OP LOCATIE → bij goedkeuring A–Z regelen.",
    "3. EMS 100% duidelijk uitleggen (zomer/winter).",
    "4. Warmtefonds spannend/exclusief houden (niet iedereen, geen garantie).",
    "5. Close: besparing eerst, dan prijs, tekenen onder voorbehoud, fonds aanvragen.",
    "6. Salderen stopt 1 jan 2027.",
  ].join("\n");
}

export function isKritiekeStap(id: string): boolean {
  return STRAIGHT_LINE_STEPS.some((s) => s.id === id && s.kritiek);
}

/** OpenAI TTS-stem per adviseur-naam (stabiel, geen echte clone). */
export function ttsVoiceForAdviseur(naam: string): string {
  const voices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
  let h = 0;
  for (const c of naam.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return voices[h % voices.length];
}

/** Keywords per stap — waar in het gesprek dit hoort. */
const STAP_KEYWORDS: Record<string, string[]> = {
  "1_sfeer": ["goedemorgen", "goedemiddag", "hallo", "welkom", "binnenkomen", "mooi huis"],
  "2_panelen": [
    "zonnepaneel",
    "zonnepanelen",
    "panelen",
    "op het dak",
    "wp ",
    "wattpiek",
  ],
  "3_verbruik": [
    "verbruik",
    "jaarnota",
    "kwh",
    "kilowatt",
    "contract",
    "leverancier",
    "maandbedrag",
    "teruglever",
  ],
  "4_offertes_prijs": [
    "offerte",
    "offertes",
    "prijs",
    "prijsindicatie",
    "euro",
    "investering",
    "kosten",
  ],
  "5_warmtefonds_spanning": [
    "warmtefonds",
    "subsidie",
    "btw",
    "regeling",
    "goedkeur",
  ],
  "6_microclose": [
    "toch?",
    "klopt dat",
    "interessant als",
    "afspraak",
    "doelen",
    "eisen",
  ],
  "7_verwachtingen": [
    "werkwijze",
    "a tot z",
    "ontzorgen",
    "productonafhankelijk",
    "aanbieders",
    "van a tot z",
  ],
  "8_stap1_probleem": [
    "salderen",
    "2027",
    "terugleverkosten",
    "overheid",
    "probleem",
  ],
  "9_ems": ["ems", "energiemanagement", "zomer", "winter", "slim sturen"],
  "10_wf_opnieuw": [
    "warmtefonds",
    "aanvraag",
    "op locatie",
    "in aanmerking",
  ],
  "11_installatie_product": [
    "omvormer",
    "meterkast",
    "installatie",
    "alpha",
    "productwijzer",
    "frank",
  ],
  "12_close": [
    "offerte",
    "tekenen",
    "voorbehoud",
    "besparing",
    "reken",
    "onderteken",
  ],
};

type SegLike = { start: number; end: number; text: string };

function findKeywordMoment(
  segments: SegLike[],
  keywords: string[],
  afterSec: number
): number | null {
  const lowerKeys = keywords.map((k) => k.toLowerCase());
  for (const s of segments) {
    if (s.start < afterSec - 1) continue;
    const t = s.text.toLowerCase();
    if (lowerKeys.some((k) => t.includes(k.trim()))) {
      return Math.round(s.start);
    }
  }
  return null;
}

function snapToSegmentStart(sec: number, segments: SegLike[]): number {
  if (segments.length === 0) return Math.max(0, sec);
  let best = segments[0];
  let bestD = Math.abs(best.start - sec);
  for (const s of segments) {
    const d = Math.abs(s.start - sec);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return Math.round(best.start);
}

/**
 * Zet unieke, oplopende momenten per gemiste/zwakke stap.
 * Volgorde volgt Straight Line; tijden volgen keywords of spreiding over de opname.
 */
export function assignStraightLineMoments<
  T extends { id: string; status: string; moment_sec: number | null },
>(stappen: T[], segments: SegLike[], maxSec: number): T[] {
  if (segments.length === 0 || maxSec <= 0) return stappen;

  const minGap = Math.max(12, Math.round(maxSec / 40));
  let lastMoment = -minGap;
  const out = stappen.map((s) => ({ ...s }));

  for (let i = 0; i < out.length; i++) {
    const stap = out[i];
    if (stap.status === "gedaan") {
      // Optioneel: anker waar het wél gebeurde (voor referentie)
      const kw = STAP_KEYWORDS[stap.id] || [];
      const found = findKeywordMoment(segments, kw, 0);
      if (found != null) {
        stap.moment_sec = found;
        lastMoment = Math.max(lastMoment, found);
      }
      continue;
    }

    const kw = STAP_KEYWORDS[stap.id] || [];
    const stepIndex = STRAIGHT_LINE_STEPS.findIndex((s) => s.id === stap.id);
    const ideal = Math.round(
      ((stepIndex + 0.55) / (STRAIGHT_LINE_STEPS.length + 0.2)) * maxSec
    );

    // 1) Keyword ná vorige moment  2) AI-voorstel als het na last valt  3) ideal
    let proposed =
      findKeywordMoment(segments, kw, lastMoment + 1) ??
      (stap.moment_sec != null && stap.moment_sec > lastMoment
        ? stap.moment_sec
        : null) ??
      ideal;

    proposed = Math.max(proposed, lastMoment + minGap);
    proposed = Math.min(proposed, maxSec);
    proposed = snapToSegmentStart(proposed, segments);

    // Uniek houden
    if (proposed <= lastMoment) {
      proposed = Math.min(maxSec, lastMoment + minGap);
      proposed = snapToSegmentStart(proposed, segments);
      if (proposed <= lastMoment) {
        proposed = Math.min(maxSec, lastMoment + minGap);
      }
    }

    stap.moment_sec = Math.round(proposed);
    lastMoment = stap.moment_sec;
  }

  return out;
}
