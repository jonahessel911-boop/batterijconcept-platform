/**
 * IMAP inbound voor info@ — haal UNSEEN op, AI-boek, persist inbox_mails.
 *
 * Env:
 *   IMAP_HOST   (bijv. imap.transip.email / outlook.office365.com)
 *   IMAP_PORT   (default 993)
 *   IMAP_USER
 *   IMAP_PASS
 *   IMAP_MAILBOX (default INBOX)
 *   IMAP_MARK_SEEN (default 1 — markeer gelezen na succesvolle insert)
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyInboxBooking,
  extractImageUrlsFromHtml,
  type InboxAttachment,
  type InboxMail,
} from "@/lib/inbox";
import { bookInboxMail, openaiInboxConfigured } from "@/lib/inbox-ai";
import { uploadInboxAttachment } from "@/lib/inbox-attachments";
import {
  insertBookedInboxMail,
  type InboxDbRow,
} from "@/lib/inbox-persist";

export type ImapSyncResult = {
  ok: boolean;
  configured: boolean;
  openai: boolean;
  fetched: number;
  inserted: number;
  skipped: number;
  errors: string[];
  mails: InboxDbRow[];
};

export function imapConfigured(): boolean {
  return Boolean(
    process.env.IMAP_HOST?.trim() &&
      process.env.IMAP_USER?.trim() &&
      process.env.IMAP_PASS?.trim()
  );
}

function addressText(
  value:
    | { text?: string; value?: { name?: string; address?: string }[] }
    | string
    | undefined
    | null
): { name: string; email: string } {
  if (!value) return { name: "", email: "" };
  if (typeof value === "string") {
    const m = value.match(/<?([^\s<>]+@[^\s<>]+)>?/);
    return { name: value.replace(/<.*>/, "").trim(), email: m?.[1] || "" };
  }
  const first = value.value?.[0];
  if (first?.address) {
    return {
      name: (first.name || "").trim(),
      email: first.address.trim().toLowerCase(),
    };
  }
  const text = (value.text || "").trim();
  const m = text.match(/<?([^\s<>]+@[^\s<>]+)>?/);
  return {
    name: text.replace(/<.*>/, "").trim(),
    email: (m?.[1] || "").toLowerCase(),
  };
}

function normalizeMessageId(raw: string | undefined | null): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  return s.replace(/^<|>$/g, "").trim() || null;
}

function firstHeaderId(
  value: string | string[] | undefined | null
): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = normalizeMessageId(item);
      if (id) return id;
    }
    return null;
  }
  const first = String(value).split(/\s+/)[0] || "";
  return normalizeMessageId(first);
}

/**
 * Sync UNSEEN mails via IMAP → AI book → inbox_mails.
 * maxMessages begrensd voor cron (default 25).
 * recent=true: nieuwste mails + UNSEEN samen (catch-up).
 */
export async function syncInboxFromImap(
  sb: SupabaseClient,
  opts?: { maxMessages?: number; markSeen?: boolean; recent?: boolean }
): Promise<ImapSyncResult> {
  const errors: string[] = [];
  const insertedRows: InboxDbRow[] = [];
  let fetched = 0;
  let inserted = 0;
  let skipped = 0;

  if (!imapConfigured()) {
    return {
      ok: false,
      configured: false,
      openai: openaiInboxConfigured(),
      fetched: 0,
      inserted: 0,
      skipped: 0,
      errors: [
        "IMAP niet geconfigureerd (IMAP_HOST / IMAP_USER / IMAP_PASS)",
      ],
      mails: [],
    };
  }

  const host = process.env.IMAP_HOST!.trim();
  const port = Number(process.env.IMAP_PORT || 993) || 993;
  const user = process.env.IMAP_USER!.trim();
  const pass = process.env.IMAP_PASS!.trim();
  const mailbox = (process.env.IMAP_MAILBOX || "INBOX").trim() || "INBOX";
  const markSeen =
    opts?.markSeen ??
    !["0", "false", "no"].includes(
      (process.env.IMAP_MARK_SEEN || "1").toLowerCase()
    );
  const maxMessages = Math.min(Math.max(opts?.maxMessages ?? 25, 1), 100);

  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(mailbox);
    try {
      const unseenRaw = await client.search({ seen: false }, { uid: true });
      const recentRaw = opts?.recent
        ? await client.search({ all: true }, { uid: true })
        : [];
      const uidSet = new Set<number>();
      for (const raw of [unseenRaw, recentRaw]) {
        for (const u of Array.isArray(raw) ? raw : []) {
          const n = Number(u);
          if (Number.isFinite(n) && n > 0) uidSet.add(n);
        }
      }
      // UNSEEN eerst, daarna nieuwste; limiet blijft gelden.
      const unseenSet = new Set(
        (Array.isArray(unseenRaw) ? unseenRaw : [])
          .map((u) => Number(u))
          .filter((u) => Number.isFinite(u) && u > 0)
      );
      const uidList = Array.from(uidSet)
        .sort((a, b) => {
          const au = unseenSet.has(a) ? 1 : 0;
          const bu = unseenSet.has(b) ? 1 : 0;
          if (au !== bu) return bu - au;
          return b - a;
        })
        .slice(0, maxMessages);

      if (uidList.length > 0) {
        for await (const msg of client.fetch(
          uidList,
          { uid: true, source: true, envelope: true },
          { uid: true }
        )) {
          fetched += 1;
          try {
            if (!msg.source) {
              errors.push(`uid ${msg.uid}: geen source`);
              continue;
            }
            const parsed = await simpleParser(Buffer.from(msg.source));
            const from = addressText(parsed.from as never);
            const to = addressText(parsed.to as never);
            const messageId =
              normalizeMessageId(parsed.messageId) ||
              (msg.uid ? `imap-${mailbox}-${msg.uid}` : null);
            const inReplyTo =
              firstHeaderId(
                (parsed as { inReplyTo?: string | string[] }).inReplyTo
              ) ||
              firstHeaderId(
                (parsed as { references?: string | string[] }).references
              );
            const subject =
              (parsed.subject || "").trim() || "(geen onderwerp)";
            const bodyText =
              (typeof parsed.text === "string" ? parsed.text : "") ||
              (typeof parsed.html === "string"
                ? parsed.html.replace(/<[^>]+>/g, " ")
                : "") ||
              "";
            const bodyHtml =
              typeof parsed.html === "string" ? parsed.html : null;
            const receivedRaw =
              parsed.date || msg.envelope?.date || new Date();
            const receivedAt =
              receivedRaw instanceof Date
                ? receivedRaw.toISOString()
                : new Date(receivedRaw).toISOString();

            if (!from.email) {
              errors.push(`uid ${msg.uid}: geen from-email`);
              continue;
            }

            const mailKey = (messageId || `imap-${msg.uid}`)
              .replace(/[^\w.@+-]+/g, "_")
              .slice(0, 80);
            const attachments: InboxAttachment[] = [];
            const parsedAtts = Array.isArray(parsed.attachments)
              ? parsed.attachments
              : [];
            for (const att of parsedAtts.slice(0, 16)) {
              const buf = att.content;
              if (!Buffer.isBuffer(buf) || buf.length === 0) continue;
              const ct = String(att.contentType || "").toLowerCase();
              const isImage =
                ct.startsWith("image/") ||
                /\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(
                  att.filename || ""
                );
              // Skip tracking-pixels / tiny inline icons
              if (isImage && buf.length < 8_000) continue;
              const filename =
                (att.filename || "").trim() ||
                (isImage
                  ? `foto-${attachments.length + 1}.jpg`
                  : `bijlage-${attachments.length + 1}`);
              const meta = await uploadInboxAttachment({
                mailKey,
                filename,
                contentType: att.contentType || null,
                bytes: buf,
              });
              if (meta) attachments.push(meta);
            }

            const imageUrls = extractImageUrlsFromHtml(bodyHtml);

            const draft: InboxMail = {
              id: messageId || `tmp-${msg.uid}`,
              folder: "algemeen",
              status: "nieuw",
              fromName: from.name || from.email,
              fromEmail: from.email,
              toEmail: to.email || user,
              subject,
              bodyText: bodyText.slice(0, 50_000),
              receivedAt,
              suggestedActions: [],
              threadId: inReplyTo || messageId || undefined,
              attachments,
              imageUrls,
            };

            // AI boekt map; bij fout → heuristic zodat sync niet stilvalt.
            let booked;
            try {
              booked = await bookInboxMail({
                subject: draft.subject,
                bodyText: draft.bodyText,
                fromName: draft.fromName,
                fromEmail: draft.fromEmail,
              });
            } catch (bookErr) {
              const { bookInboxMailHeuristic } = await import("@/lib/inbox-ai");
              booked = bookInboxMailHeuristic({
                subject: draft.subject,
                bodyText: draft.bodyText,
                fromEmail: draft.fromEmail,
              });
              errors.push(
                `uid ${msg.uid}: AI-boek faalde (${
                  bookErr instanceof Error ? bookErr.message : "fout"
                }) → heuristic`
              );
            }

            const mail = applyInboxBooking(draft, {
              folder: booked.folder,
              summary: booked.summary,
              confidence: booked.confidence,
              functionName: booked.functionName,
              effects: booked.effects,
            });

            const result = await insertBookedInboxMail(sb, mail, {
              messageId,
              inReplyTo,
              bodyHtml: bodyHtml?.slice(0, 100_000) || null,
              aiFunction: booked.functionName,
              attachments,
              imageUrls,
            });

            if (result.skipped) {
              skipped += 1;
            } else if (result.inserted && result.row) {
              inserted += 1;
              insertedRows.push(result.row);
            }

            if (markSeen && msg.uid) {
              await client.messageFlagsAdd(String(msg.uid), ["\\Seen"], {
                uid: true,
              });
            }
          } catch (e) {
            const detail =
              e instanceof Error
                ? e.message || e.name
                : typeof e === "object" && e && "message" in e
                  ? String((e as { message: unknown }).message)
                  : "fout";
            errors.push(`uid ${msg.uid}: ${detail}`);
          }
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "IMAP connectie mislukt");
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      configured: true,
      openai: openaiInboxConfigured(),
      fetched,
      inserted,
      skipped,
      errors,
      mails: insertedRows,
    };
  }

  return {
    ok: errors.length === 0 || inserted > 0,
    configured: true,
    openai: openaiInboxConfigured(),
    fetched,
    inserted,
    skipped,
    errors,
    mails: insertedRows,
  };
}

/**
 * Sync facturen@ mailbox (aparte IMAP-credentials) → zelfde inbox_mails-pipeline.
 * Gebruikt tijdelijk FACTUREN_IMAP_* als IMAP_* voor syncInboxFromImap.
 */
export async function syncFacturenMailboxFromImap(
  sb: SupabaseClient,
  opts?: { maxMessages?: number; markSeen?: boolean; recent?: boolean }
): Promise<ImapSyncResult> {
  const { facturenImapConfigured, facturenImapConfig } = await import(
    "@/lib/facturen-mailbox"
  );
  if (!facturenImapConfigured()) {
    return {
      ok: false,
      configured: false,
      openai: openaiInboxConfigured(),
      fetched: 0,
      inserted: 0,
      skipped: 0,
      errors: [
        "FACTUREN IMAP niet geconfigureerd (FACTUREN_IMAP_PASS / IMAP_HOST)",
      ],
      mails: [],
    };
  }

  const cfg = facturenImapConfig();
  const prev = {
    host: process.env.IMAP_HOST,
    port: process.env.IMAP_PORT,
    user: process.env.IMAP_USER,
    pass: process.env.IMAP_PASS,
    mailbox: process.env.IMAP_MAILBOX,
  };

  process.env.IMAP_HOST = cfg.host;
  process.env.IMAP_PORT = String(cfg.port);
  process.env.IMAP_USER = cfg.user;
  process.env.IMAP_PASS = cfg.pass;
  process.env.IMAP_MAILBOX = cfg.mailbox;

  try {
    return await syncInboxFromImap(sb, opts);
  } finally {
    if (prev.host === undefined) delete process.env.IMAP_HOST;
    else process.env.IMAP_HOST = prev.host;
    if (prev.port === undefined) delete process.env.IMAP_PORT;
    else process.env.IMAP_PORT = prev.port;
    if (prev.user === undefined) delete process.env.IMAP_USER;
    else process.env.IMAP_USER = prev.user;
    if (prev.pass === undefined) delete process.env.IMAP_PASS;
    else process.env.IMAP_PASS = prev.pass;
    if (prev.mailbox === undefined) delete process.env.IMAP_MAILBOX;
    else process.env.IMAP_MAILBOX = prev.mailbox;
  }
}
