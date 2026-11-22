/**
 * Inline PNG-attachments voor Postmark (alleen server-routes — gebruikt fs).
 * Niet importeren vanuit client components.
 */

import fs from "fs";
import path from "path";
import {
  EMAIL_ICON_CID_PREFIX,
  EMAIL_ICON_FILES,
  emailIconCid,
  type EmailIconFile,
} from "./email-icons";
import type { EmailAttachment } from "./postmark";

let cachedAttachments: EmailAttachment[] | null = null;

export function emailIconAttachments(): EmailAttachment[] {
  if (cachedAttachments) return cachedAttachments;

  const dir = path.join(process.cwd(), "public", "email", "icons");
  const out: EmailAttachment[] = [];

  for (const file of EMAIL_ICON_FILES) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) continue;
    out.push({
      name: file,
      contentType: "image/png",
      content: fs.readFileSync(full),
      contentId: emailIconCid(file as EmailIconFile),
      disposition: "inline",
    });
  }

  cachedAttachments = out;
  return out;
}

export function emailIconAttachmentsForHtml(html: string): EmailAttachment[] {
  if (!html.includes(`cid:${EMAIL_ICON_CID_PREFIX}`)) return [];
  return emailIconAttachments().filter((a) =>
    html.includes(`cid:${a.contentId}`)
  );
}

/** Merge CID-icons + bestaande attachments voor sendEmail. */
export function withEmailIconAttachments(
  html: string,
  attachments?: EmailAttachment[]
): EmailAttachment[] | undefined {
  const icons = emailIconAttachmentsForHtml(html);
  if (icons.length === 0 && (!attachments || attachments.length === 0)) {
    return undefined;
  }
  const merged = [...(attachments ?? [])];
  for (const icon of icons) {
    if (!merged.some((a) => a.contentId && a.contentId === icon.contentId)) {
      merged.push(icon);
    }
  }
  return merged.length ? merged : undefined;
}
