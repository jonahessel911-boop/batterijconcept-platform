/** WhatsApp-templates voor het Warmtefonds-portaal (klantcontact). */

import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ } from "@/lib/format";

export type WfWhatsappTemplateId =
  | "telefonisch_niet_bereikt"
  | "afspraak_bevestiging"
  | "documenten_nodig";

export type WfWhatsappTemplate = {
  id: WfWhatsappTemplateId;
  label: string;
  hint: string;
};

export const WF_WHATSAPP_TEMPLATES: WfWhatsappTemplate[] = [
  {
    id: "telefonisch_niet_bereikt",
    label: "Telefonisch niet bereikt",
    hint: "Gebeld, geen gehoor — vraag om terug te bellen",
  },
  {
    id: "afspraak_bevestiging",
    label: "Afspraakbevestiging",
    hint: "Bevestig datum en tijd van het huisbezoek",
  },
  {
    id: "documenten_nodig",
    label: "Documenten meenemen",
    hint: "Herinnering wat de klant klaar moet hebben",
  },
];

function achternaamVan(naam: string | null | undefined): string {
  const parts = (naam || "").trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

export function warmtefondsAanhef(naam: string | null | undefined): string {
  const achter = achternaamVan(naam);
  return achter
    ? `Geachte heer/mevrouw ${achter},`
    : "Geachte heer/mevrouw,";
}

const WF_VOORBEREIDING_PUNTEN = [
  "• DigiD-app of gebruikersnaam/wachtwoord",
  "• Bank-app of inloggegevens van uw bank",
  "• De getekende offerte(s) per e-mail",
  "• Een recente salarisstrook (niet ouder dan 2 maanden), tenzij u gepensioneerd bent",
].join("\n");

/** Lege regel tussen alinea’s — WhatsApp toont dat als echte enter. */
function waAlineas(...blokken: string[]): string {
  return blokken
    .map((b) => b.replace(/\r\n/g, "\n").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function splitWfAfspraakLocal(
  iso?: string | null
): { datum: string; tijd: string } {
  if (!iso) return { datum: "", tijd: "10:00" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { datum: "", tijd: "10:00" };
  return {
    datum: formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd"),
    tijd: formatInTimeZone(d, AMSTERDAM_TZ, "HH:mm"),
  };
}

/** Datum + tijd in Amsterdam → ISO. */
export function wfAfspraakIsoVanDatumTijd(
  datum: string,
  tijd: string
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return null;
  const match = tijd.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hh = String(Number(match[1])).padStart(2, "0");
  const mm = match[2];
  if (Number(hh) > 23 || Number(mm) > 59) return null;
  try {
    return fromZonedTime(`${datum}T${hh}:${mm}:00`, AMSTERDAM_TZ).toISOString();
  } catch {
    return null;
  }
}

export function warmtefondsAfspraakWhatsappLabel(
  iso: string | Date
): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "de afgesproken datum en tijd";
  const dag = formatInTimeZone(d, AMSTERDAM_TZ, "EEEE d MMMM yyyy", {
    locale: nl,
  });
  const tijd = formatInTimeZone(d, AMSTERDAM_TZ, "H.mm", { locale: nl });
  const dayKey = formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
  const today = formatInTimeZone(new Date(), AMSTERDAM_TZ, "yyyy-MM-dd");
  const morgen = formatInTimeZone(
    addDays(toZonedTime(new Date(), AMSTERDAM_TZ), 1),
    AMSTERDAM_TZ,
    "yyyy-MM-dd"
  );
  let prefix = "";
  if (dayKey === today) prefix = "vandaag, ";
  else if (dayKey === morgen) prefix = "morgen, ";
  return `${prefix}${dag} om ${tijd} uur`;
}

export function warmtefondsWhatsappHandtekening(
  medewerkerNaam: string | null | undefined
): string {
  const wie = (medewerkerNaam || "").trim() || "Edwin Veenendaal";
  return `Met vriendelijke groet,\n\n${wie}\nBatterijconcept`;
}

export function buildWfWhatsappBericht(opts: {
  templateId: WfWhatsappTemplateId;
  klantNaam: string | null | undefined;
  medewerkerNaam?: string | null;
  afspraakIso?: string | null;
}): string {
  const aanhef = warmtefondsAanhef(opts.klantNaam);
  const groet = warmtefondsWhatsappHandtekening(opts.medewerkerNaam);
  const wanneer = opts.afspraakIso
    ? warmtefondsAfspraakWhatsappLabel(opts.afspraakIso)
    : "de afgesproken datum en tijd";

  if (opts.templateId === "telefonisch_niet_bereikt") {
    return waAlineas(
      aanhef,
      "Ik heb zojuist geprobeerd u telefonisch te bereiken, maar dit is helaas niet gelukt.",
      "Graag kom ik bij u langs in verband met de aanvraag voor het Warmtefonds voor uw bestelling bij Batterijconcept.",
      "Zou u mij terug willen bellen of een bericht willen sturen zodat we een afspraak kunnen inplannen?",
      "Alvast bedankt.",
      groet
    );
  }

  if (opts.templateId === "afspraak_bevestiging") {
    return waAlineas(
      aanhef,
      `Hierbij bevestig ik onze afspraak voor ${wanneer} bij u thuis.`,
      "Ik kom dan langs voor het aanvragen van het Warmtefonds voor uw bestelling bij Batterijconcept.",
      `Ter voorbereiding verzoek ik u de volgende zaken bij de hand te hebben:\n${WF_VOORBEREIDING_PUNTEN}`,
      "Indien u een partner heeft, is het belangrijk dat hij/zij ook aanwezig is.",
      "Ik zie u graag.",
      groet
    );
  }

  return waAlineas(
    aanhef,
    `Hierbij een herinnering voor onze afspraak voor ${wanneer} bij u thuis.`,
    `Wilt u de volgende zaken bij de hand hebben:\n${WF_VOORBEREIDING_PUNTEN}`,
    "Indien u een partner heeft, is het belangrijk dat hij/zij ook aanwezig is.",
    groet
  );
}

export type WfAfspraakSlotOptie = { iso: string; label: string };

export function warmtefondsAfspraakSlotOpties(
  now = new Date(),
  extraIso?: string | null
): WfAfspraakSlotOptie[] {
  const times = [10, 12, 13, 14, 16];
  const seen = new Set<string>();
  const out: WfAfspraakSlotOptie[] = [];

  function push(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    const key = formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd'T'HH:mm");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      iso: d.toISOString(),
      label: formatInTimeZone(d, AMSTERDAM_TZ, "EEE d MMM · HH:mm", {
        locale: nl,
      }),
    });
  }

  if (extraIso) push(extraIso);

  const local = toZonedTime(now, AMSTERDAM_TZ);
  for (let i = 0; i < 16; i++) {
    const day = addDays(local, i);
    if (day.getDay() === 0) continue;
    const ymd = formatInTimeZone(day, AMSTERDAM_TZ, "yyyy-MM-dd");
    for (const h of times) {
      const stamp = `${ymd}T${String(h).padStart(2, "0")}:00:00`;
      const iso = fromZonedTime(stamp, AMSTERDAM_TZ).toISOString();
      if (new Date(iso).getTime() < now.getTime() - 60_000) continue;
      push(iso);
    }
  }
  return out.slice(0, 48);
}

export function warmtefondsWhatsappPhone(
  telefoon: string | null | undefined
): string | null {
  const digits = (telefoon || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("31") && digits.length >= 11) return digits;
  if (digits.startsWith("00") && digits.length >= 12) return digits.slice(2);
  if (digits.startsWith("0") && digits.length >= 10) {
    return `31${digits.slice(1)}`;
  }
  if (digits.length >= 9) return `31${digits}`;
  return null;
}

export function formatTelefoonPlus31(
  telefoon: string | null | undefined
): string | null {
  const wa = warmtefondsWhatsappPhone(telefoon);
  if (!wa) return null;
  const rest = wa.startsWith("31") ? wa.slice(2) : wa;
  if (rest.startsWith("6") && rest.length === 9) {
    return `+31 6 ${rest.slice(1, 3)} ${rest.slice(3, 5)} ${rest.slice(5, 7)} ${rest.slice(7)}`;
  }
  return `+31 ${rest}`;
}

export function warmtefondsTelHref(
  telefoon: string | null | undefined
): string | null {
  const wa = warmtefondsWhatsappPhone(telefoon);
  return wa ? `tel:+${wa}` : null;
}

export function warmtefondsWhatsappUrl(
  telefoon: string | null | undefined,
  bericht: string
): string | null {
  const phone = warmtefondsWhatsappPhone(telefoon);
  if (!phone) return null;
  const text = bericht.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return `https://api.whatsapp.com/send/?phone=${phone}&text=${encodeURIComponent(text)}&type=phone_number&app_absent=0`;
}

export function warmtefondsWhatsappVoornaam(
  naam: string | null | undefined
): string {
  const first = (naam || "").trim().split(/\s+/)[0] || "";
  return first || "u";
}
