/** Opleverformulier installatie — checklist + handtekening monteur. */

import { formatSchouwAdres } from "@/lib/schouw-formulier";
import { validateSysteemSin } from "@/lib/systeem-sin";

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

/** Planbord-soort + kop op het opleverformulier bij restpunten na installatie. */
export const SERVICE_VV_INSTALLATIE = "Service - VV Installatie";
export const VERVOLG_OPLEVERFORMULIER_LABEL = "Vervolg Opleverformulier";

export type OpleverVervolgMateriaal = {
  id: string;
  label: string;
  aantal: number;
};

export function normalizeOpleverVervolgMaterialen(
  raw: unknown
): OpleverVervolgMateriaal[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row, i) => {
      const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const label = String(r.label ?? r.omschrijving ?? "").trim();
      const aantal = Math.max(1, Math.round(Number(r.aantal) || 1));
      const id = String(r.id ?? "").trim() || `svc-${i + 1}`;
      return { id, label, aantal };
    })
    .filter((r) => r.label);
}

export function isServiceVvInstallatie(
  notities?: string | null
): boolean {
  return (notities || "").trim().startsWith(SERVICE_VV_INSTALLATIE);
}

export function formatServiceVvNotitie(actie: string): string {
  const t = actie.trim();
  return t ? `${SERVICE_VV_INSTALLATIE}\n\n${t}` : SERVICE_VV_INSTALLATIE;
}

export type OpleverFormulierData = {
  klantNaam: string;
  adres: string;
  datum: string; // yyyy-MM-dd
  projectNummer: string;
  monteurNaam: string;
  /** Serienummer / SIN van de batterij. */
  sin: string;
  /** Afgevinkte opleverpunten (alle ids uit OPLEVER_PUNTEN verplicht). */
  afgevinkt: OpleverPuntId[];
  akkoord: boolean;
  /** data:image/png;base64,… */
  handtekeningDataUrl: string;
  opmerkingen: string;
  /** Restpunt → serviceverzoek Vervolg Opleverformulier + BO-actie (bellen). */
  vervolgNodig: boolean;
  vervolgActie: string;
  /** Materiaal dat purchasing moet inkopen voor dit serviceverzoek. */
  vervolgMaterialen: OpleverVervolgMateriaal[];
  /** Voorgesteld / geboekt service-moment (ISO of datetime-local). */
  vervolgAt: string;
  vervolgMonteurId: string;
  vervolgMonteurNaam: string;
  vervolgServiceVerzoekId?: string;
};

/** Opgeslagen opleverdata zonder handtekening (te groot / niet nodig in CRM). */
export type OpleverFormulierSnapshot = {
  datum: string;
  monteurNaam: string;
  sin: string;
  afgevinkt: OpleverPuntId[];
  opmerkingen: string;
  akkoord: boolean;
  vervolgNodig: boolean;
  vervolgActie: string;
  vervolgMaterialen: OpleverVervolgMateriaal[];
  vervolgAt: string;
  vervolgMonteurNaam: string;
  vervolgServiceVerzoekId?: string;
};

export function snapshotOpleverFormulier(
  data: OpleverFormulierData
): OpleverFormulierSnapshot {
  return {
    datum: data.datum,
    monteurNaam: data.monteurNaam.trim(),
    sin: data.sin,
    afgevinkt: [...data.afgevinkt],
    opmerkingen: data.opmerkingen.trim(),
    akkoord: data.akkoord,
    vervolgNodig: data.vervolgNodig === true,
    vervolgActie: data.vervolgActie.trim(),
    vervolgMaterialen: normalizeOpleverVervolgMaterialen(data.vervolgMaterialen),
    vervolgAt: data.vervolgAt.trim(),
    vervolgMonteurNaam: data.vervolgMonteurNaam.trim(),
    ...(data.vervolgServiceVerzoekId
      ? { vervolgServiceVerzoekId: data.vervolgServiceVerzoekId }
      : {}),
  };
}

export function parseOpleverFormulierSnapshot(
  raw: unknown
): OpleverFormulierSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const afgevinkt = (
    Array.isArray(o.afgevinkt) ? o.afgevinkt.map((x) => String(x)) : []
  ).filter((id): id is OpleverPuntId =>
    OPLEVER_PUNTEN.some((p) => p.id === id)
  );
  return {
    datum: String(o.datum || "").trim(),
    monteurNaam: String(o.monteurNaam || "").trim(),
    sin: String(o.sin || "").trim(),
    afgevinkt,
    opmerkingen: String(o.opmerkingen || "").trim(),
    akkoord: o.akkoord === true || o.akkoord === "true",
    vervolgNodig: o.vervolgNodig === true || o.vervolgNodig === "true",
    vervolgActie: String(o.vervolgActie || "").trim(),
    vervolgMaterialen: normalizeOpleverVervolgMaterialen(o.vervolgMaterialen),
    vervolgAt: String(o.vervolgAt || "").trim(),
    vervolgMonteurNaam: String(o.vervolgMonteurNaam || "").trim(),
    vervolgServiceVerzoekId: String(o.vervolgServiceVerzoekId || "").trim() || undefined,
  };
}

/** Alleen de oplever-opmerking, niet de planningsnotitie van de installatie. */
export function relevanteOpleverNotitie(opts: {
  snapshot?: OpleverFormulierSnapshot | null;
  installatieNotities?: string | null;
}): string | null {
  const fromForm = opts.snapshot?.opmerkingen?.trim();
  if (fromForm) return fromForm;
  const n = (opts.installatieNotities || "").trim();
  if (!n) return null;
  const match = n.match(/(?:^|\n)\s*Oplever:\s*([\s\S]+)/i);
  const extracted = match?.[1]?.trim();
  return extracted || null;
}

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
    sin: "",
    afgevinkt: [],
    akkoord: false,
    handtekeningDataUrl: "",
    opmerkingen: "",
    vervolgNodig: false,
    vervolgActie: "",
    vervolgMaterialen: [],
    vervolgAt: "",
    vervolgMonteurId: "",
    vervolgMonteurNaam: "",
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
  const sinErr = validateSysteemSin(data.sin);
  if (sinErr) return sinErr;
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
  if (data.vervolgNodig) {
    if (!data.vervolgActie.trim()) {
      return "Beschrijf wat er nog gefixt moet worden";
    }
    if (!data.vervolgAt.trim()) {
      return "Kies datum en tijd voor het service-vervolg";
    }
    const at = new Date(data.vervolgAt.trim());
    if (Number.isNaN(at.getTime())) {
      return "Ongeldige datum/tijd voor het service-vervolg";
    }
  }
  return null;
}
