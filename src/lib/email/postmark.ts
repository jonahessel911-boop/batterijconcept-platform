import { ServerClient, Attachment } from "postmark";

const FROM = process.env.POSTMARK_FROM_EMAIL || "info@batterijconcept.nl";

let client: ServerClient | null = null;

function getClient(): ServerClient | null {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) return null;
  if (!client) client = new ServerClient(token);
  return client;
}

export type EmailAttachment = {
  name: string;
  contentType: string;
  /** Raw bytes or base64 string */
  content: Buffer | string;
};

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  tag?: string;
  attachments?: EmailAttachment[];
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const pm = getClient();
  if (!pm) {
    console.warn("Postmark niet geconfigureerd — mail overgeslagen");
    return { ok: false, error: "Postmark niet geconfigureerd" };
  }

  try {
    const Attachments = opts.attachments?.map((a) => {
      const base64 =
        typeof a.content === "string"
          ? a.content
          : a.content.toString("base64");
      return new Attachment(a.name, base64, a.contentType);
    });

    const result = await pm.sendEmail({
      From: FROM,
      To: opts.to,
      Subject: opts.subject,
      HtmlBody: opts.html,
      MessageStream: "outbound",
      Tag: opts.tag,
      Attachments,
    });
    return { ok: true, messageId: result.MessageID };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Mail versturen mislukt";
    console.error("Postmark error:", message);
    return { ok: false, error: message };
  }
}

const PRODUCTION_APP_URL = "https://platform.batterijconcept.nl";

export function appBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  const isProd =
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production";

  // Productie-mails: nooit *.vercel.app — altijd het echte domein
  if (isProd) {
    if (fromEnv && !/\.vercel\.app$/i.test(fromEnv)) return fromEnv;
    return PRODUCTION_APP_URL;
  }

  if (fromEnv) return fromEnv;

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`;
  }

  return "http://localhost:3000";
}
