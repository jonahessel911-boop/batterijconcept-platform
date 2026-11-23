import { sendEmail } from "@/lib/email/postmark";
import { emailBox, emailH1, emailLayout, emailMuted, emailP } from "@/lib/email/layout";

/** Interne alert bij elke nieuwe sollicitatie. */
export const NIEUWE_SOLLICITATIE_NOTIFY_TO = "jonahessel911@gmail.com";
export const NIEUWE_SOLLICITATIE_NOTIFY_CC = "jona@batterijconcept.nl";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cell(label: string, value: string | null | undefined): string {
  const v = (value || "").trim() || "-";
  const html = escapeHtml(v).replace(/\n/g, "<br />");
  return `<p style="margin:0 0 8px;font-size:15px;"><strong>${escapeHtml(label)}</strong><br />${html}</p>`;
}

export async function notifyNieuweSollicitatie(opts: {
  naam: string;
  email?: string | null;
  telefoon?: string | null;
  functie?: string | null;
  adres?: string | null;
  status?: string | null;
  notitie?: string | null;
  bron?: string | null;
  bestanden?: string | null;
}): Promise<void> {
  const naam = (opts.naam || "").trim() || "Onbekend";
  const html = emailLayout({
    title: `Nieuwe sollicitatie: ${naam}`,
    preheader: "Er is een nieuwe kandidaat binnengekomen in Recruitment.",
    bodyHtml: [
      emailH1("Nieuwe sollicitatie"),
      emailP("Er is een nieuwe sollicitatie binnengekomen in de Recruitment-tab."),
      emailBox(
        [
          cell("Naam", naam),
          cell("E-mail", opts.email),
          cell("Telefoon", opts.telefoon),
          cell("Functie", opts.functie),
          cell("Adres", opts.adres),
          cell("Bron", opts.bron),
          cell("Status", opts.status),
          cell("Notitie", opts.notitie),
          cell("Bestanden", opts.bestanden),
        ].join("")
      ),
      emailMuted("Dit is een interne melding van het Batterijconcept CRM."),
    ].join(""),
  });

  const result = await sendEmail({
    to: NIEUWE_SOLLICITATIE_NOTIFY_TO,
    cc: NIEUWE_SOLLICITATIE_NOTIFY_CC,
    subject: `Nieuwe sollicitatie: ${naam}`,
    html,
    tag: "sollicitatie-intern",
  });
  if (!result.ok) {
    console.error("Sollicitatie notificatie mail fout:", result.error);
  }
}
