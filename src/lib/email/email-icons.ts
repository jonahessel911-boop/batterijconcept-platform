/**
 * CID-helpers voor e-mail icons (geen Node fs — veilig voor alle bundles).
 * Attachments laden: zie email-icon-attachments.ts (server-only).
 */

export const EMAIL_ICON_CID_PREFIX = "bc-icon-";

const ICON_FILES = [
  "calendar-green.png",
  "calendar-orange.png",
  "clock-green.png",
  "clock-orange.png",
  "pin-green.png",
  "pin-orange.png",
  "person-green.png",
  "person-orange.png",
  "checklist-orange.png",
  "check-green.png",
] as const;

export type EmailIconFile = (typeof ICON_FILES)[number];

export function emailIconCid(file: EmailIconFile): string {
  return `${EMAIL_ICON_CID_PREFIX}${file.replace(/\.png$/, "")}`;
}

/** src voor <img> in verstuurde mail (CID). */
export function emailIconSrc(file: EmailIconFile): string {
  return `cid:${emailIconCid(file)}`;
}

/** Voor browser-preview: cid: → absolute PNG-URL. */
export function rewriteEmailIconCidsForPreview(
  html: string,
  baseUrl: string
): string {
  const base = baseUrl.replace(/\/$/, "");
  return html.replace(
    /cid:bc-icon-([a-z0-9-]+)/gi,
    (_m, id: string) => `${base}/email/icons/${id}.png`
  );
}

export { ICON_FILES as EMAIL_ICON_FILES };
