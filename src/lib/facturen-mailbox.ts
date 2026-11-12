/**
 * Centrale factuurmailbox facturen@batterijconcept.nl
 * — inkomend: IMAP sync → inbox_mails.mailbox = 'facturen'
 * — uitgaand: BCC op creditfacturen / selfbilling
 */

export const FACTUREN_MAILBOX_EMAIL =
  process.env.FACTUREN_MAILBOX_EMAIL?.trim().toLowerCase() ||
  "facturen@batterijconcept.nl";

export const FACTUREN_MAILBOX_ID = "facturen" as const;

export function facturenImapConfigured(): boolean {
  const host =
    process.env.FACTUREN_IMAP_HOST?.trim() ||
    process.env.IMAP_HOST?.trim();
  const user =
    process.env.FACTUREN_IMAP_USER?.trim() || FACTUREN_MAILBOX_EMAIL;
  const pass = process.env.FACTUREN_IMAP_PASS?.trim();
  return Boolean(host && user && pass);
}

export function facturenImapConfig() {
  return {
    host: (
      process.env.FACTUREN_IMAP_HOST?.trim() ||
      process.env.IMAP_HOST?.trim() ||
      ""
    ).trim(),
    port: Number(process.env.FACTUREN_IMAP_PORT || process.env.IMAP_PORT || 993) || 993,
    user: (
      process.env.FACTUREN_IMAP_USER?.trim() || FACTUREN_MAILBOX_EMAIL
    ).trim(),
    pass: (process.env.FACTUREN_IMAP_PASS || "").trim(),
    mailbox: (process.env.FACTUREN_IMAP_MAILBOX || "INBOX").trim() || "INBOX",
  };
}

/** BCC voor uitgaande credit-/relatiefacturen (archief in facturen@). */
export function facturenArchiveBcc(
  toEmail?: string | null
): string | null {
  const archive = FACTUREN_MAILBOX_EMAIL;
  const to = (toEmail || "").trim().toLowerCase();
  if (!archive) return null;
  if (to && to === archive) return null;
  return archive;
}
