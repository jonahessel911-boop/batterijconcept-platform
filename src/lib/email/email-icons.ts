/**
 * Inline e-mail icons via CID (werkt in Gmail zonder publieke URL).
 * Preview herschrijft cid: → /email/icons/*.png op de app-host.
 */

import fs from "fs";
import path from "path";
import type { EmailAttachment } from "./postmark";

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

let cachedAttachments: EmailAttachment[] | null = null;

/** Inline PNG-attachments voor Postmark (Content-ID). */
export function emailIconAttachments(): EmailAttachment[] {
  if (cachedAttachments) return cachedAttachments;

  const dir = path.join(process.cwd(), "public", "email", "icons");
  const out: EmailAttachment[] = [];

  for (const file of ICON_FILES) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) continue;
    out.push({
      name: file,
      contentType: "image/png",
      content: fs.readFileSync(full),
      contentId: emailIconCid(file),
      disposition: "inline",
    });
  }

  cachedAttachments = out;
  return out;
}

/** Welke icon-attachments horen bij deze HTML? */
export function emailIconAttachmentsForHtml(html: string): EmailAttachment[] {
  if (!html.includes(`cid:${EMAIL_ICON_CID_PREFIX}`)) return [];
  return emailIconAttachments().filter((a) =>
    html.includes(`cid:${a.contentId}`)
  );
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
