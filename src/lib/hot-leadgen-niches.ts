/**
 * Hot lead-gen niches — de verticals die structureel long-running TOF ads draaien
 * ($0 down / “what does X cost” / rebate / qualify / limited spots).
 *
 * We volgen niches (niet keywords-ruis). Brands die in winners opduiken
 * kunnen we daarna tracken.
 */

export type HotLeadgenNiche = {
  id: string;
  label: string;
  /** Waarom relevant als pattern voor BatterijConcept TOF */
  why: string;
  /** Precieze Foreplay discovery queries */
  queries: string[];
  /** Bekende pages / WL-merken om optioneel te tracken */
  seedBrands: string[];
  /** Headline/description moet minstens één van deze hooks raken */
  hookHints: string[];
};

export const HOT_LEADGEN_NICHES: HotLeadgenNiche[] = [
  {
    id: "solar_battery",
    label: "Solar + home battery rebate",
    why: "Tijdelijke regeling / rebate / free battery — 1:1 pattern voor thuisbatterij TOF",
    queries: [
      "solar battery rebate homeowners",
      "federal solar battery program",
      "free home battery with solar",
      "solar panels no upfront cost",
    ],
    seedBrands: [
      "Aus Solar Connect",
      "Momentum Solar",
      "Polaron Solar Energy",
      "The Eco Experts",
      "Palmetto",
    ],
    hookHints: ["rebate", "battery", "solar", "upfront", "program", "qualify", "free"],
  },
  {
    id: "windows_zero_down",
    label: "Windows $0 down",
    why: "Classic $0 down + limited spots + regional qualify",
    queries: [
      "new windows $0 down homeowners",
      "replacement windows zero down",
      "windows free installation quote",
    ],
    seedBrands: ["Window Nation", "Renewal by Andersen", "Power Home Remodeling", "Fetchapro"],
    hookHints: ["$0", "0 down", "windows", "qualify", "limited", "homeowners"],
  },
  {
    id: "bath_oneday",
    label: "1-day bath / walk-in shower",
    why: "“What does X cost” + free quote — native cost-curiosity TOF",
    queries: [
      "walk in shower cost",
      "1 day bathroom remodel quote",
      "walk-in tub free quote",
    ],
    seedBrands: ["Leaf Home Bath", "Bath Planet", "HomeBuddy.com", "West Shore Home", "ReBath"],
    hookHints: ["shower", "bath", "cost", "quote", "1 day", "remodel", "tub"],
  },
  {
    id: "roofing",
    label: "Roof replacement",
    why: "Homeowner cost/quote funnel — zelfde urgency pattern",
    queries: [
      "roof replacement cost homeowners",
      "free roof quote homeowners",
      "new roof insurance claim",
    ],
    seedBrands: ["HomeBuddy.com", "Projecthaven.com", "Power Home Remodeling"],
    hookHints: ["roof", "quote", "cost", "homeowners", "insurance"],
  },
  {
    id: "final_expense",
    label: "Final expense / burial insurance",
    why: "Qualify + age gates + “leave a legacy” — senior TOF hooks",
    queries: [
      "final expense insurance no exam",
      "burial insurance no waiting period",
      "funeral insurance qualify seniors",
    ],
    seedBrands: ["SelectQuote", "Ethos Life", "Damfred Insurance", "Fowler Insurance"],
    hookHints: ["funeral", "burial", "final expense", "insurance", "legacy", "qualify", "seniors"],
  },
  {
    id: "medical_alert",
    label: "Medical alert / Life Alert",
    why: "Senior safety qualify — check-if-you-need pattern",
    queries: [
      "Medical Guardian alert",
      "Bay Alarm Medical",
      "medical alert system seniors fall",
      "life alert pendant help button",
    ],
    seedBrands: ["Medical Guardian", "Bay Alarm Medical", "Life Alert", "MobileHelp"],
    hookHints: ["alert", "fall", "senior", "help button", "pendant", "guardian"],
  },
  {
    id: "stairlift",
    label: "Stairlifts / mobility",
    why: "HomeBuddy-style “cost might surprise you” — native curiosity",
    queries: [
      "stairlift cost homeowners",
      "stair lift free quote",
      "home stairlift price",
    ],
    seedBrands: ["HomeBuddy.com", "Bruno Stairlifts", "Stannah"],
    hookHints: ["stair", "lift", "cost", "quote", "home"],
  },
  {
    id: "hvac",
    label: "HVAC / heat pump / AC",
    why: "Seasonal rebate + free quote homeowner TOF",
    queries: [
      "new HVAC system rebate homeowners",
      "heat pump rebate free quote",
      "AC replacement $0 down",
    ],
    seedBrands: ["HomeBuddy.com", "Carrier", "Trane"],
    hookHints: ["hvac", "heat pump", "air conditioner", "rebate", "quote", "$0"],
  },
  {
    id: "water_treatment",
    label: "Water softener / treatment",
    why: "Free water test / quote — Leaf Home style",
    queries: [
      "water softener free quote",
      "Leaf Home water softener",
      "hard water free test homeowners",
    ],
    seedBrands: ["Leaf Home Water Solutions", "Culligan", "EcoWater"],
    hookHints: ["water", "softener", "hard water", "quote", "test", "free"],
  },
  {
    id: "auto_insurance",
    label: "Car insurance quotes",
    why: "See-if-you-qualify + save $X/month — high volume lead gen",
    queries: [
      "car insurance quote save money",
      "auto insurance lower rate qualify",
      "drivers insurance comparison quote",
    ],
    seedBrands: ["The General", " Progressive", "Insurify", "Jerry"],
    hookHints: ["insurance", "quote", "save", "drivers", "rate", "qualify"],
  },
];

export function nicheById(id: string): HotLeadgenNiche | undefined {
  return HOT_LEADGEN_NICHES.find((n) => n.id === id);
}

/** Strict: ad must look like homeowner lead-gen, not ecommerce junk. */
export function scoreLeadgenAd(opts: {
  niche: HotLeadgenNiche;
  headline: string | null;
  description: string | null;
  brandName: string | null;
  runningDays: number;
}): number | null {
  const blob =
    `${opts.headline || ""} ${opts.description || ""} ${opts.brandName || ""}`.toLowerCase();

  // Hard junk
  if (
    /jewelry|necklace|bracelet|beach towel|sofa|furniture|ergonomic|renpho|megafurniture|graffiti|joint pain|weight loss|nerve support|crypto|casino|slot|business capital|funding buddy|realtor|moving service|autism medical alert id/.test(
      blob
    )
  ) {
    return null;
  }

  const hooksHit = opts.niche.hookHints.filter((h) =>
    blob.includes(h.toLowerCase())
  ).length;
  if (hooksHit < 1) return null;

  let score = Math.min(opts.runningDays, 500);
  score += hooksHit * 40;

  // Classic TOF multipliers
  if (/\$0|0 down|no upfront|zero down|free quote|qualify|rebate|limited spots|what .+ cost|see if you/.test(blob)) {
    score += 120;
  }
  if (/homeowner|huiseigenaar|seniors?|resident/.test(blob)) score += 40;

  // Known seed brand boost
  const brand = (opts.brandName || "").toLowerCase();
  if (opts.niche.seedBrands.some((s) => brand.includes(s.toLowerCase().slice(0, 8)))) {
    score += 80;
  }

  return score;
}
