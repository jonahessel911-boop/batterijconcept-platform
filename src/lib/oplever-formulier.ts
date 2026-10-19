/** Opleverformulier installatie — checklist + handtekening monteur. */

import { formatSchouwAdres } from "@/lib/schouw-formulier";

export { formatSchouwAdres as formatOpleverAdres };

export const OPLEVER_PUNTEN = [
  {
    id: "bevestiging",
    label:
      "De batterij en bijbehorende apparatuur zijn stevig en correct bevestigd.",
  },
  {
    id: "montagevoorschriften",
    label:
      "De plaatsing voldoet aan de montagevoorschriften van de fabrikant, waaronder vrije ruimte en ventilatie.",
  },
  {
    id: "elektrisch",
    label:
      "De elektrische aansluiting, beveiligingen en aarding zijn gecontroleerd en akkoord bevonden.",
  },
  {
    id: "kabels",
    label:
      "Kabels en aansluitingen zijn correct bevestigd en netjes afgewerkt.",
  },
  {
    id: "labels",
    label: "Benodigde markeringen en labels zijn aangebracht.",
  },
  {
    id: "werkplek",
    label:
      "De werkplek is schoon achtergelaten en verpakkingsmateriaal is verwijderd.",
  },
  {
    id: "app",
    label: "De klant heeft toegang tot de app.",
  },
] as const;

export type OpleverPuntId = (typeof OPLEVER_PUNTEN)[number]["id"];

export const OPLEVER_AKKOORD_TEKST =
  "Ik ga akkoord met de installatie zoals die opgeleverd is.";

export type OpleverFormulierData = {
  klantNaam: string;
  adres: string;
  datum: string; // yyyy-MM-dd
  projectNummer: string;
  monteurNaam: string;
  /** Afgevinkte opleverpunten (alle ids uit OPLEVER_PUNTEN verplicht). */
  afgevinkt: OpleverPuntId[];
  akkoord: boolean;
  /** data:image/png;base64,… */
  handtekeningDataUrl: string;
  opmerkingen: string;
};

export function emptyOpleverFormulier(
  prefill?: Partial<OpleverFormulierData>
): OpleverFormulierData {
  const today = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Europe/Amsterdam",
  });
  return {
    klantNaam: "",
    adres: "",
    datum: today,
    projectNummer: "",
    monteurNaam: "",
    afgevinkt: [],
    akkoord: false,
    handtekeningDataUrl: "",
    opmerkingen: "",
    ...prefill,
  };
}

export function alleOpleverPuntenAfgevinkt(
  afgevinkt: readonly string[]
): boolean {
  const set = new Set(afgevinkt);
  return OPLEVER_PUNTEN.every((p) => set.has(p.id));
}

export function validateOpleverFormulier(
  data: OpleverFormulierData
): string | null {
  if (!data.klantNaam.trim()) return "Klantnaam is verplicht";
  if (!data.monteurNaam.trim()) return "Naam van de installateur is verplicht";
  if (!alleOpleverPuntenAfgevinkt(data.afgevinkt)) {
    return "Vink alle opleverpunten af";
  }
  if (!data.akkoord) {
    return "Bevestig dat je akkoord gaat met de oplevering";
  }
  if (
    !data.handtekeningDataUrl.trim() ||
    !data.handtekeningDataUrl.startsWith("data:image")
  ) {
    return "Handtekening van de installateur is verplicht";
  }
  return null;
}
