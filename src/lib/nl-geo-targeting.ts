/** Provincies + plaatsen voor agressieve lokale Meta TOF-ads. */

export type NlProvinceId =
  | "limburg"
  | "noord-brabant"
  | "zeeland"
  | "zuid-holland"
  | "gelderland"
  | "utrecht"
  | "overijssel"
  | "flevoland"
  | "noord-holland"
  | "friesland"
  | "groningen"
  | "drenthe";

export type NlProvince = {
  id: NlProvinceId;
  label: string;
  places: string[];
};

export const NL_PROVINCES: NlProvince[] = [
  {
    id: "limburg",
    label: "Limburg",
    places: [
      "Maastricht",
      "Heerlen",
      "Venlo",
      "Roermond",
      "Sittard",
      "Weert",
      "Kerkrade",
      "Geleen",
    ],
  },
  {
    id: "noord-brabant",
    label: "Noord-Brabant",
    places: [
      "Eindhoven",
      "Tilburg",
      "Breda",
      "Den Bosch",
      "Helmond",
      "Roosendaal",
      "Oss",
      "Bergen op Zoom",
    ],
  },
  {
    id: "zeeland",
    label: "Zeeland",
    places: [
      "Middelburg",
      "Vlissingen",
      "Goes",
      "Terneuzen",
      "Zierikzee",
      "Hulst",
    ],
  },
  {
    id: "zuid-holland",
    label: "Zuid-Holland",
    places: [
      "Rotterdam",
      "Den Haag",
      "Dordrecht",
      "Leiden",
      "Zoetermeer",
      "Delft",
      "Gouda",
      "Spijkenisse",
    ],
  },
  {
    id: "gelderland",
    label: "Gelderland",
    places: [
      "Arnhem",
      "Nijmegen",
      "Apeldoorn",
      "Ede",
      "Doetinchem",
      "Harderwijk",
    ],
  },
  {
    id: "utrecht",
    label: "Utrecht",
    places: ["Utrecht", "Amersfoort", "Veenendaal", "Nieuwegein", "Zeist"],
  },
  {
    id: "overijssel",
    label: "Overijssel",
    places: ["Zwolle", "Enschede", "Deventer", "Hengelo", "Almelo"],
  },
  {
    id: "flevoland",
    label: "Flevoland",
    places: ["Almere", "Lelystad", "Emmeloord", "Dronten"],
  },
  {
    id: "noord-holland",
    label: "Noord-Holland",
    places: [
      "Amsterdam",
      "Haarlem",
      "Alkmaar",
      "Zaandam",
      "Hilversum",
      "Hoorn",
    ],
  },
  {
    id: "friesland",
    label: "Friesland",
    places: ["Leeuwarden", "Drachten", "Sneek", "Heerenveen"],
  },
  {
    id: "groningen",
    label: "Groningen",
    places: ["Groningen", "Hoogezand", "Stadskanaal", "Veendam"],
  },
  {
    id: "drenthe",
    label: "Drenthe",
    places: ["Assen", "Emmen", "Hoogeveen", "Meppel"],
  },
];

export function provinceById(id: string): NlProvince | undefined {
  return NL_PROVINCES.find((p) => p.id === id);
}

/** Regionale uitstraling voor native UGC (herkenbare “lokale” look, 40–70+). */
export type RegionalPersona = {
  label: string;
  vibe: string;
  people: string[];
};

const DEFAULT_PERSONA: RegionalPersona = {
  label: "Nederlander",
  vibe: "everyday Dutch homeowner look, natural and unstyled",
  people: [
    "Dutch woman 45–60, natural look, holding cardboard",
    "Dutch man 50–65 with grey hair, holding cardboard",
    "Dutch couple 55–70 jointly holding cardboard",
  ],
};

const REGIONAL_PERSONAS: Record<string, RegionalPersona> = {
  limburg: {
    label: "Limburger",
    vibe: "Limburgse uitstraling — warm, approachable South-Limburg / Mid-Limburg homeowner energy",
    people: [
      "Limburgse vrouw 48–62, natural warm look, holding cardboard",
      "Limburgse man 52–68, friendly face, holding cardboard",
      "Limburgs koppel 55–70 holding cardboard together",
    ],
  },
  "noord-brabant": {
    label: "Brabander",
    vibe: "Brabantse uitstraling — down-to-earth, sociable Brabant homeowner energy",
    people: [
      "Brabantse vrouw 45–60, approachable, holding cardboard",
      "Brabantse man 50–68, casual jacket, holding cardboard",
      "Brabants koppel 55–70 holding cardboard at front door",
    ],
  },
  zeeland: {
    label: "Zeeuw",
    vibe: "Zeeuwse uitstraling — coastal / practical Zeeland homeowner energy",
    people: [
      "Zeeuwse vrouw 48–65, weathered natural look, holding cardboard",
      "Zeeuwse man 55–70, outdoor/coastal vibe, holding cardboard",
      "Zeeuws koppel 55–70 holding cardboard",
    ],
  },
  "zuid-holland": {
    label: "Hollander (ZH)",
    vibe: "Zuid-Hollandse uitstraling — Randstad-suburban / practical homeowner energy",
    people: [
      "Zuid-Hollandse vrouw 45–60 holding cardboard",
      "Zuid-Hollandse man 50–65 holding cardboard",
      "Koppel 55–70 uit Zuid-Holland holding cardboard",
    ],
  },
  "noord-holland": {
    label: "Hollander (NH)",
    vibe: "Noord-Hollandse uitstraling — direct, urban-suburban homeowner energy",
    people: [
      "Noord-Hollandse vrouw 45–60 holding cardboard",
      "Noord-Hollandse man 50–68 holding cardboard",
      "Koppel 55–70 uit Noord-Holland holding cardboard",
    ],
  },
  utrecht: {
    label: "Utrechter",
    vibe: "Utrechtse uitstraling — central-NL, understated urban-suburban homeowner energy",
    people: [
      "Utrechtse vrouw 45–60, understated style, holding cardboard",
      "Utrechtse man 50–65 holding cardboard",
      "Utrechts koppel 55–70 holding cardboard",
    ],
  },
  gelderland: {
    label: "Gelderlander",
    vibe: "Gelderse uitstraling — inland / practical eastern-NL homeowner energy",
    people: [
      "Gelderse vrouw 48–62 holding cardboard",
      "Gelderse man 52–68 holding cardboard",
      "Gelders koppel 55–70 holding cardboard",
    ],
  },
  overijssel: {
    label: "Overijsselaar",
    vibe: "Overijsselse uitstraling — Twente/Salland practical homeowner energy",
    people: [
      "Overijsselse vrouw 48–65 holding cardboard",
      "Overijsselse man 52–70 holding cardboard",
      "Koppel 55–70 uit Overijssel holding cardboard",
    ],
  },
  flevoland: {
    label: "Flevolander",
    vibe: "Flevolandse uitstraling — newer-town / practical polder homeowner energy",
    people: [
      "Flevolandse vrouw 45–60 holding cardboard",
      "Flevolandse man 50–65 holding cardboard",
      "Koppel 55–70 uit Flevoland holding cardboard",
    ],
  },
  friesland: {
    label: "Fries",
    vibe: "Friese uitstraling — recognizably Frisian, sturdy / northern homeowner energy",
    people: [
      "Friese vrouw 48–65, Frisian look, holding cardboard",
      "Friese man 52–70, Frisian look, holding cardboard",
      "Fries koppel 55–70 holding cardboard",
    ],
  },
  groningen: {
    label: "Groninger",
    vibe: "Groningse uitstraling — northern, direct Groninger homeowner energy",
    people: [
      "Groningse vrouw 48–65, northern look, holding cardboard",
      "Groningse man 52–70, northern look, holding cardboard",
      "Gronings koppel 55–70 holding cardboard",
    ],
  },
  drenthe: {
    label: "Drent",
    vibe: "Drentse uitstraling — rural/northern, calm Drenthe homeowner energy",
    people: [
      "Drentse vrouw 48–65 holding cardboard",
      "Drentse man 52–70 holding cardboard",
      "Drents koppel 55–70 holding cardboard",
    ],
  },
};

/** Resolve persona from province label or id (also fuzzy on place names via province). */
export function regionalPersonaFor(
  provinceOrPlace: string,
  provinceHint?: string
): RegionalPersona {
  const blob = `${provinceOrPlace} ${provinceHint || ""}`.toLowerCase();
  const byId = NL_PROVINCES.find(
    (p) =>
      p.id === blob.trim() ||
      p.label.toLowerCase() === provinceOrPlace.trim().toLowerCase() ||
      p.places.some((pl) => pl.toLowerCase() === provinceOrPlace.trim().toLowerCase())
  );
  if (byId && REGIONAL_PERSONAS[byId.id]) return REGIONAL_PERSONAS[byId.id]!;

  if (/brabant|eindhoven|tilburg|breda|den bosch|helmond/.test(blob))
    return REGIONAL_PERSONAS["noord-brabant"]!;
  if (/limburg|maastricht|heerlen|venlo|geleen|roermond|sittard/.test(blob))
    return REGIONAL_PERSONAS.limburg!;
  if (/zeeland|middelburg|vlissingen|goes|terneuzen/.test(blob))
    return REGIONAL_PERSONAS.zeeland!;
  if (/utrecht|amersfoort|nieuwegein|veenendaal|zeist/.test(blob))
    return REGIONAL_PERSONAS.utrecht!;
  if (/groningen|hoogezand|veendam|stadskanaal/.test(blob))
    return REGIONAL_PERSONAS.groningen!;
  if (/friesland|leeuwarden|drachten|sneek|heerenveen|friese?/.test(blob))
    return REGIONAL_PERSONAS.friesland!;
  if (/gelderland|arnhem|nijmegen|apeldoorn|ede/.test(blob))
    return REGIONAL_PERSONAS.gelderland!;
  if (/zuid[- ]?holland|rotterdam|den haag|leiden|delft|dordrecht/.test(blob))
    return REGIONAL_PERSONAS["zuid-holland"]!;
  if (/noord[- ]?holland|amsterdam|haarlem|alkmaar|zaandam/.test(blob))
    return REGIONAL_PERSONAS["noord-holland"]!;
  if (/overijssel|zwolle|enschede|deventer|hengelo/.test(blob))
    return REGIONAL_PERSONAS.overijssel!;
  if (/flevoland|almere|lelystad/.test(blob)) return REGIONAL_PERSONAS.flevoland!;
  if (/drenthe|assen|emmen|hoogeveen/.test(blob)) return REGIONAL_PERSONAS.drenthe!;

  return DEFAULT_PERSONA;
}
