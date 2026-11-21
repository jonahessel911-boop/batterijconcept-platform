/**
 * Bird.com SMS client (EU). Spiegel van sendEmail: no-op als env ontbreekt.
 *
 * Env:
 * - BIRD_API_KEY (bk_eu1_… of bk_us1_…)
 * - BIRD_SMS_FROM (E.164 of alphanumeric sender)
 * - BIRD_API_HOST (optioneel; default afgeleid van key-prefix)
 * - BIRD_SMS_CATEGORY (optioneel; default transactional)
 *
 * Docs: POST {region}.platform.bird.com/v1/sms/messages
 * Auth: Authorization: Bearer <key>
 */

import { toE164Nl } from "./phone";

export type SendSmsResult = {
  ok: boolean;
  error?: string;
  messageId?: string;
  skipped?: boolean;
};

function normalizeFrom(raw: string): string {
  const trimmed = raw.trim();
  // E.164 met spaties → compact
  if (trimmed.startsWith("+") || /^\d/.test(trimmed)) {
    return trimmed.replace(/[\s().-]/g, "");
  }
  // Alphanumeric sender ID
  return trimmed;
}

function hostFromApiKey(apiKey: string): string {
  if (apiKey.startsWith("bk_eu1_")) return "https://eu1.platform.bird.com";
  if (apiKey.startsWith("bk_us1_")) return "https://us1.platform.bird.com";
  return "https://eu1.platform.bird.com";
}

function birdConfigured(): {
  apiKey: string;
  host: string;
  from: string;
  category: string;
} | null {
  const apiKey = process.env.BIRD_API_KEY?.trim();
  const fromRaw = process.env.BIRD_SMS_FROM?.trim();
  if (!apiKey || !fromRaw) return null;
  const host = (
    process.env.BIRD_API_HOST?.trim() || hostFromApiKey(apiKey)
  ).replace(/\/$/, "");
  const category =
    process.env.BIRD_SMS_CATEGORY?.trim() || "transactional";
  return { apiKey, host, from: normalizeFrom(fromRaw), category };
}

export function isBirdSmsConfigured(): boolean {
  return birdConfigured() !== null;
}

/**
 * Stuur 1 SMS. `to` mag NL-lokaal of E.164 zijn.
 */
export async function sendSms(opts: {
  to: string;
  body: string;
  /** Tag voor logging / metadata */
  tag?: string;
}): Promise<SendSmsResult> {
  const cfg = birdConfigured();
  if (!cfg) {
    console.warn("Bird SMS niet geconfigureerd — SMS overgeslagen");
    return { ok: false, error: "Bird SMS niet geconfigureerd", skipped: true };
  }

  const to = toE164Nl(opts.to);
  if (!to) {
    return { ok: false, error: "Ongeldig telefoonnummer" };
  }

  const text = opts.body.trim();
  if (!text) {
    return { ok: false, error: "Lege SMS-tekst" };
  }

  const url = `${cfg.host}/v1/sms/messages`;
  const payload: Record<string, unknown> = {
    to,
    from: cfg.from,
    text,
    category: cfg.category,
  };
  if (opts.tag) {
    payload.metadata = { tag: opts.tag.slice(0, 64) };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    let json: {
      id?: string;
      messageId?: string;
      error?:
        | string
        | { message?: string; code?: string; name?: string };
    } = {};
    try {
      json = raw ? (JSON.parse(raw) as typeof json) : {};
    } catch {
      /* plain text error */
    }

    if (!res.ok) {
      const errObj = json.error;
      const err =
        (typeof errObj === "string"
          ? errObj
          : errObj?.message || errObj?.name) ||
        raw.slice(0, 300) ||
        `Bird HTTP ${res.status}`;
      console.error("Bird SMS fout", opts.tag, res.status, err);
      return { ok: false, error: String(err) };
    }

    return {
      ok: true,
      messageId: json.id || json.messageId,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Bird request mislukt";
    console.error("Bird SMS exception", opts.tag, message);
    return { ok: false, error: message };
  }
}
