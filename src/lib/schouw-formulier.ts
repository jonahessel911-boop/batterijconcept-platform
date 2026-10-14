/** Velden voor installatie-schouw thuisbatterij (formulier → PDF). */

export type SchouwJaNee = "ja" | "nee" | "";

export type SchouwFormulierData = {
  // Header / prefill
  klantNaam: string;
  adres: string;
  telefoon: string;
  email: string;
  datum: string; // yyyy-MM-dd
  rapportNr: string;
  opnemer: string;
  klusNr: string;

  // Installatie-object (AlphaESS)
  modelOmvormer: string;
  capaciteitKwh: string;
  aantalModules: string;
  serienummers: string;

  // Meterkast
  typeAansluiting: string;
  hoofdzekering: string;
  vrijeGroepen: string;
  ruimteExtraGroep: string;
  aardlekTePlaatsen: string;
  deugdelijkeAarding: SchouwJaNee;
  ctKlemPlaatsbaar: SchouwJaNee;
  fotoMeterkast: SchouwJaNee;

  // Opstelling
  plekBatterij: string;
  binnenBuiten: string;
  montagewijze: string;
  wandtype: string;
  beschikbareRuimte: string;
  vorstvrij: SchouwJaNee;
  ventilatie: SchouwJaNee;
  brandveiligeAfstand: SchouwJaNee;

  // Kabeltracé
  afstandMeterkastM: string;
  kabelroute: string;
  doorMurenVloeren: string;
  boormateriaal: string;
  aantalDoorvoeren: string;
  boordiameter: string;
  kabelgootNodig: string;
  kabelgootLengteM: string;
  kabeldoorsnede: string;
  hakGraafwerk: string;
  wifiBereik: string;

  // Praktisch
  ladderNodig: string;
  aanvoerParkeren: string;
  installatietijdDagdelen: string;
  meeTeNemen: string[];
  meerwerkObstakels: string;
  aanvullendeOpmerkingen: string;

  // Handtekeningen (optioneel tekst)
  handtekeningOpnemerNaam: string;
  handtekeningKlantNaam: string;
};

export const SCHOUW_MODEL_OPTIES = [
  "SMILE-T10 (3-fase)",
  "SMILE-G3 (1-fase)",
  "SMILE-B3",
  "Anders",
] as const;

export const SCHOUW_AANSLUITING_OPTIES = ["1-fase", "3-fase"] as const;

export const SCHOUW_HOOFDZEKERING_OPTIES = [
  "1x25A",
  "1x35A",
  "1x40A",
  "3x25A",
  "3x35A",
  "3x40A",
  "3x50A",
  "3x63A",
  "Anders",
] as const;

export const SCHOUW_RUIMTE_GROEP_OPTIES = [
  "Ja — voldoende",
  "Beperkt",
  "Geen — bijkast nodig",
] as const;

export const SCHOUW_AARDLEK_OPTIES = [
  "Type A",
  "Type B",
  "Type A + B",
  "Niet nodig",
  "Onbekend",
] as const;

export const SCHOUW_BINNEN_BUITEN_OPTIES = ["Binnen", "Buiten"] as const;

export const SCHOUW_MONTAGE_OPTIES = [
  "Vloerstaand",
  "Wandmontage",
  "Gemengd",
] as const;

export const SCHOUW_WANDTYPE_OPTIES = [
  "Steen/beton",
  "Hout",
  "Gips",
  "Metaal",
  "Anders",
] as const;

export const SCHOUW_KABELROUTE_OPTIES = [
  "Volledig weggewerkt",
  "Gedeeltelijk weggewerkt",
  "Zichtbaar / goot",
  "Buiten / gevel",
  "Anders",
] as const;

export const SCHOUW_BOORMATERIAAL_OPTIES = [
  "Beton",
  "Steen",
  "Hout",
  "Gips",
  "Gemengd",
  "Anders",
] as const;

export const SCHOUW_KABELDOORSNEDE_OPTIES = [
  "2,5 mm²",
  "4 mm²",
  "6 mm²",
  "10 mm²",
  "16 mm²",
  "Anders",
] as const;

export const SCHOUW_WIFI_OPTIES = [
  "Goed",
  "Matig",
  "Geen — UTP/repeater nodig",
] as const;

export const SCHOUW_AANVOER_OPTIES = [
  "Goed bereikbaar",
  "Beperkt / smalle straat",
  "Ver / sjouwen",
  "Parkeren moeilijk",
] as const;

export const SCHOUW_MEE_TE_NEMEN_OPTIES = [
  "Kernboor",
  "Installatiebuis",
  "Kabelgoot",
  "Aardlek type A",
  "Aardlek type B",
  "Montagebeugel",
  "CT-klem/meettrafo",
  "Extra kabel 6mm²",
  "Extra kabel 10mm²",
  "UTP/repeater",
] as const;

export function emptySchouwFormulier(
  prefill?: Partial<SchouwFormulierData>
): SchouwFormulierData {
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return {
    klantNaam: "",
    adres: "",
    telefoon: "",
    email: "",
    datum: ymd,
    rapportNr: "",
    opnemer: "",
    klusNr: "",
    modelOmvormer: "",
    capaciteitKwh: "",
    aantalModules: "",
    serienummers: "",
    typeAansluiting: "",
    hoofdzekering: "",
    vrijeGroepen: "",
    ruimteExtraGroep: "",
    aardlekTePlaatsen: "",
    deugdelijkeAarding: "",
    ctKlemPlaatsbaar: "",
    fotoMeterkast: "",
    plekBatterij: "",
    binnenBuiten: "Binnen",
    montagewijze: "",
    wandtype: "",
    beschikbareRuimte: "",
    vorstvrij: "",
    ventilatie: "",
    brandveiligeAfstand: "",
    afstandMeterkastM: "",
    kabelroute: "",
    doorMurenVloeren: "",
    boormateriaal: "",
    aantalDoorvoeren: "",
    boordiameter: "",
    kabelgootNodig: "",
    kabelgootLengteM: "",
    kabeldoorsnede: "",
    hakGraafwerk: "",
    wifiBereik: "",
    ladderNodig: "",
    aanvoerParkeren: "",
    installatietijdDagdelen: "",
    meeTeNemen: [],
    meerwerkObstakels: "",
    aanvullendeOpmerkingen: "",
    handtekeningOpnemerNaam: "",
    handtekeningKlantNaam: "",
    ...prefill,
  };
}

export function formatSchouwAdres(lead: {
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
}): string {
  const line1 = [lead.straat, lead.huisnummer, lead.toevoeging]
    .filter(Boolean)
    .join(" ")
    .trim();
  const line2 = [lead.postcode, lead.plaats].filter(Boolean).join(" ").trim();
  return [line1, line2].filter(Boolean).join(", ");
}
