import { emailLayout, emailP } from "./layout";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Zelfde kaart als de andere klantmails: groene kop, witte body, footer. */
export function inboxReplyHtml(opts: {
  subject: string;
  bodyText: string;
}): string {
  const paragraphs = opts.bodyText
    .trim()
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => emailP(escapeHtml(p).replace(/\n/g, "<br>")))
    .join("");

  return emailLayout({
    title: opts.subject || "BatterijConcept",
    preheader: opts.bodyText.replace(/\s+/g, " ").trim().slice(0, 140),
    bodyHtml: paragraphs || emailP(""),
  });
}
