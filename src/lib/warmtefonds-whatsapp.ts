/** WhatsApp-templates voor het Warmtefonds-portaal (klantcontact). */

export type WfWhatsappTemplateId =
  | "afspraak_bevestiging"
  | "geprobeerd_te_bellen"
  | "documenten_nodig";

export type WfWhatsappTemplate = {
  id: WfWhatsappTemplateId;
  label: string;
  hint: string;
  build: (ctx: {
    voornaam: string;
    afspraakLabel?: string | null;
  }) => string;
};

function voornaamVan(naam: string | null | undefined): string {
  const first = (naam || "").trim().split(/\s+/)[0] || "";
  return first || "u";
}

export const WF_WHATSAPP_TEMPLATES: WfWhatsappTemplate[] = [
  {
    id: "afspraak_bevestiging",
    label: "Afspraak bevestiging",
    hint: "Bevestig datum/tijd van de Warmtefonds-afspraak",
    build: ({ voornaam, afspraakLabel }) => {
      const wanneer = afspraakLabel?.trim() || "de afgesproken datum en tijd";
      return [
        `Beste ${voornaam},`,
        ``,
        `Hierbij bevestig ik uw Warmtefonds-afspraak op ${wanneer}.`,
        ``,
        `Heeft u vragen of wilt u verzetten? Laat het me even weten.`,
        ``,
        `Met vriendelijke groet,`,
        `Edwin — Warmtefonds / Edergy`,
      ].join("\n");
    },
  },
  {
    id: "geprobeerd_te_bellen",
    label: "Geprobeerd te bellen",
    hint: "U heeft gebeld, geen gehoor — bericht sturen",
    build: ({ voornaam }) =>
      [
        `Beste ${voornaam},`,
        ``,
        `Ik heb u zojuist geprobeerd te bellen over uw Warmtefonds-aanvraag, daarom stuur ik u dit bericht.`,
        ``,
        `Wanneer kunt u mij het beste bereiken? U kunt ook terugbellen of hier antwoorden.`,
        ``,
        `Met vriendelijke groet,`,
        `Edwin — Warmtefonds / Edergy`,
      ].join("\n"),
  },
  {
    id: "documenten_nodig",
    label: "Documenten / info nodig",
    hint: "Vraag om ontbrekende stukken of gegevens",
    build: ({ voornaam }) =>
      [
        `Beste ${voornaam},`,
        ``,
        `Voor uw Warmtefonds-aanvraag heb ik nog een paar gegevens/documenten van u nodig om verder te kunnen.`,
        ``,
        `Kunt u die zo spoedig mogelijk delen? Dan pak ik het direct verder op.`,
        ``,
        `Met vriendelijke groet,`,
        `Edwin — Warmtefonds / Edergy`,
      ].join("\n"),
  },
];

/** Normaliseer NL-telefoon naar wa.me formaat (316…). */
export function warmtefondsWhatsappPhone(
  telefoon: string | null | undefined
): string | null {
  const digits = (telefoon || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("31") && digits.length >= 11) return digits;
  if (digits.startsWith("0") && digits.length >= 10) {
    return `31${digits.slice(1)}`;
  }
  if (digits.length >= 9) return `31${digits}`;
  return null;
}

export function warmtefondsWhatsappUrl(
  telefoon: string | null | undefined,
  bericht: string
): string | null {
  const phone = warmtefondsWhatsappPhone(telefoon);
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(bericht)}`;
}

export function warmtefondsWhatsappVoornaam(
  naam: string | null | undefined
): string {
  return voornaamVan(naam);
}
