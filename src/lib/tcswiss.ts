/**
 * TC Swiss / RelayPro partner-API.
 * Docs: https://mijn.tcswiss.nl/partner-docs?bron=Batterijconcept
 *
 * - Lead intake (POST)
 * - Webhook push (gebeurtenissen) + signature verify
 */

import { createHmac, timingSafeEqual } from "crypto";

export const TCSWISS_PRODUCT_WARMTEPOMP = "Warmtepomp";

export const TCSWISS_EVENT_SOORTEN = [
  "uitkomst",
  "afspraak",
  "offerte",
  "verkoop",
  "verkoop_teruggedraaid",
  "status",
  "notitie",
  "document",
  "partner_actie",
  "test",
] as const;

export type TcSwissEventSoort = (typeof TCSWISS_EVENT_SOORTEN)[number];

export type TcSwissGebeurtenis = {
  volgnummer?: number;
  lead?: string | null;
  extern_id?: string | null;
  klant_email?: string | null;
  tijdstip?: string | null;
  spec_versie?: number;
  soort: TcSwissEventSoort | string;
  uitkomst?: string;
  afspraak?: Record<string, unknown>;
  offerte?: Record<string, unknown>;
  verkoop?: Record<string, unknown>;
  verkoop_teruggedraaid?: Record<string, unknown>;
  status?: Record<string, unknown>;
  notitie?: string | null;
  document?: Record<string, unknown>;
  partner_actie?: Record<string, unknown>;
  test?: { bericht?: string } | Record<string, unknown>;
  [key: string]: unknown;
};

export type TcSwissLeadIntakeInput = {
  /** Eigen vaste ID (CRM lead id / lead_number) — verplicht voor dedupe */
  externId: string;
  lastName: string;
  email?: string | null;
  tel?: string | null;
  firstName?: string | null;
  postcode?: string | null;
  plaats?: string | null;
  straat?: string | null;
  huisnummer?: string | null;
  product?: string;
  /** Override bron; default env TCSWISS_RELAYPRO_BRON */
  bron?: string;
};

export type TcSwissLeadIntakeResult = {
  ok: boolean;
  duplicate: boolean;
  lead: string | null;
  externId: string | null;
  raw: unknown;
};

function baseUrl(): string {
  return (
    process.env.TCSWISS_RELAYPRO_BASE_URL?.trim() ||
    "https://mijn.tcswiss.nl"
  ).replace(/\/$/, "");
}

function token(): string | null {
  return process.env.TCSWISS_RELAYPRO_TOKEN?.trim() || null;
}

function bronDefault(): string {
  return process.env.TCSWISS_RELAYPRO_BRON?.trim() || "Batterijconcept";
}

function webhookSecret(): string | null {
  return (
    process.env.TCSWISS_RELAYPRO_WEBHOOK_SECRET?.trim() ||
    process.env.TCSWISS_WEBHOOK_SECRET?.trim() ||
    null
  );
}

export function tcSwissConfigured(): boolean {
  return Boolean(token());
}

function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Standard Webhooks (RelayPro v2.227+):
 *   bericht = `${webhookId}.${timestamp}.${rawBody}`
 *   signature header: spatie-gescheiden `v1,<base64>`
 * Legacy:
 *   X-RelayPro-Signature = hex(hmac_sha256(`${timestamp}.${rawBody}`))
 */
export function verifyTcSwissWebhookSignature(opts: {
  rawBody: string;
  webhookId?: string | null;
  timestamp?: string | null;
  /** Standard Webhooks header (webhook-signature) */
  signatureHeader?: string | null;
  /** Legacy hex header */
  legacySignature?: string | null;
}): { ok: boolean; mode: "standard" | "legacy" | "none"; reason?: string } {
  const secret = webhookSecret();
  if (!secret) {
    return { ok: false, mode: "none", reason: "webhook secret niet geconfigureerd" };
  }

  const ts = (opts.timestamp || "").trim();
  const raw = opts.rawBody;

  // Standard Webhooks
  const sigHeader = (opts.signatureHeader || "").trim();
  const webhookId = (opts.webhookId || "").trim();
  if (sigHeader && webhookId && ts) {
    const bericht = `${webhookId}.${ts}.${raw}`;
    const digest = createHmac("sha256", secret).update(bericht, "utf8").digest("base64");
    const expected = `v1,${digest}`;
    const ok = sigHeader.split(/\s+/).some((part) => safeEqualStr(expected, part));
    if (ok) return { ok: true, mode: "standard" };
    return { ok: false, mode: "standard", reason: "standard signature mismatch" };
  }

  // Legacy
  const legacy = (opts.legacySignature || "").trim();
  if (legacy && ts) {
    const bericht = `${ts}.${raw}`;
    const expected = createHmac("sha256", secret).update(bericht, "utf8").digest("hex");
    if (safeEqualStr(expected, legacy)) return { ok: true, mode: "legacy" };
    return { ok: false, mode: "legacy", reason: "legacy signature mismatch" };
  }

  return {
    ok: false,
    mode: "none",
    reason: "geen herkenbare signature-headers",
  };
}

/** Auth voor webhook: signature (voorkeur) of partner-token fallback. */
export function authorizeTcSwissWebhook(opts: {
  rawBody: string;
  headers: Headers;
}): { ok: boolean; via: "signature" | "token" | "open"; reason?: string } {
  const secret = webhookSecret();
  const webhookId =
    opts.headers.get("webhook-id") ||
    opts.headers.get("Webhook-Id") ||
    opts.headers.get("x-webhook-id");
  const timestamp =
    opts.headers.get("webhook-timestamp") ||
    opts.headers.get("Webhook-Timestamp") ||
    opts.headers.get("x-relaypro-timestamp") ||
    opts.headers.get("x-webhook-timestamp");
  const signatureHeader =
    opts.headers.get("webhook-signature") ||
    opts.headers.get("Webhook-Signature");
  const legacySignature =
    opts.headers.get("x-relaypro-signature") ||
    opts.headers.get("X-RelayPro-Signature");

  if (secret) {
    const v = verifyTcSwissWebhookSignature({
      rawBody: opts.rawBody,
      webhookId,
      timestamp,
      signatureHeader,
      legacySignature,
    });
    if (v.ok) return { ok: true, via: "signature" };
    // Signature secret gezet → token-only mag niet silently slagen
    return { ok: false, via: "signature", reason: v.reason };
  }

  const t = token();
  const hdrToken =
    opts.headers.get("x-relaypro-token") ||
    opts.headers.get("X-RelayPro-Token") ||
    opts.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (t && hdrToken && safeEqualStr(t, hdrToken.trim())) {
    return { ok: true, via: "token" };
  }

  // Dev/open: alleen als expliciet toegestaan
  if (process.env.TCSWISS_WEBHOOK_ALLOW_UNSIGNED === "1") {
    return { ok: true, via: "open" };
  }

  return {
    ok: false,
    via: "open",
    reason:
      "Zet TCSWISS_RELAYPRO_WEBHOOK_SECRET (signature) of stuur X-RelayPro-Token",
  };
}

export function parseTcSwissWebhookPayload(raw: unknown): TcSwissGebeurtenis[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;

  const unwrap = (v: unknown): unknown => {
    if (
      v &&
      typeof v === "object" &&
      "message" in v &&
      typeof (v as { message: unknown }).message === "object"
    ) {
      return (v as { message: unknown }).message;
    }
    return v;
  };

  const root = unwrap(obj) as Record<string, unknown>;

  const asEvent = (v: unknown): TcSwissGebeurtenis | null => {
    if (!v || typeof v !== "object") return null;
    const e = v as Record<string, unknown>;
    if (typeof e.soort !== "string") return null;
    return e as TcSwissGebeurtenis;
  };

  if (Array.isArray(root.items)) {
    return root.items.map(asEvent).filter(Boolean) as TcSwissGebeurtenis[];
  }
  if (Array.isArray(root.gebeurtenissen)) {
    return root.gebeurtenissen
      .map(asEvent)
      .filter(Boolean) as TcSwissGebeurtenis[];
  }
  if (Array.isArray(raw)) {
    return (raw as unknown[]).map(asEvent).filter(Boolean) as TcSwissGebeurtenis[];
  }
  const single = asEvent(root);
  return single ? [single] : [];
}

export function tcSwissEventTitle(ev: TcSwissGebeurtenis): string {
  const soort = String(ev.soort || "overig");
  switch (soort) {
    case "uitkomst":
      return `TC Swiss · uitkomst: ${ev.uitkomst || "—"}`;
    case "afspraak": {
      const a = ev.afspraak || {};
      return `TC Swiss · afspraak: ${a.type || "—"} (${a.uitkomst || a.status || "—"})`;
    }
    case "offerte": {
      const o = ev.offerte || {};
      return `TC Swiss · offerte: ${o.uitkomst || "—"}`;
    }
    case "verkoop":
      return `TC Swiss · verkoop`;
    case "verkoop_teruggedraaid":
      return `TC Swiss · verkoop teruggedraaid`;
    case "status": {
      const s = ev.status || {};
      return `TC Swiss · status: ${s.intern || s.bucket || "—"}`;
    }
    case "notitie":
      return `TC Swiss · notitie`;
    case "document": {
      const d = ev.document || {};
      return `TC Swiss · document: ${d.type || d.naam || "—"}`;
    }
    case "partner_actie": {
      const p = ev.partner_actie || {};
      return `TC Swiss · partneractie: ${p.type || "—"}`;
    }
    case "test":
      return `TC Swiss · testgebeurtenis`;
    default:
      return `TC Swiss · ${soort}`;
  }
}

export function tcSwissEventDetail(ev: TcSwissGebeurtenis): string | null {
  const soort = String(ev.soort || "");
  if (soort === "notitie" && typeof ev.notitie === "string") return ev.notitie;
  if (soort === "test" && ev.test && typeof ev.test === "object") {
    const b = (ev.test as { bericht?: string }).bericht;
    return b || null;
  }
  if (soort === "uitkomst") return ev.uitkomst ? String(ev.uitkomst) : null;
  return null;
}

export async function tcSwissLeadIntake(
  input: TcSwissLeadIntakeInput
): Promise<TcSwissLeadIntakeResult> {
  const t = token();
  if (!t) {
    throw new Error("TCSWISS_RELAYPRO_TOKEN ontbreekt");
  }
  const externId = input.externId.trim();
  const lastName = input.lastName.trim();
  if (!externId) throw new Error("externId verplicht");
  if (!lastName) throw new Error("lastName verplicht");

  const body: Record<string, string> = {
    bron: (input.bron || bronDefault()).trim(),
    extern_id: externId,
    product: (input.product || TCSWISS_PRODUCT_WARMTEPOMP).trim(),
    last_name: lastName,
  };
  if (input.email?.trim()) body.email = input.email.trim();
  if (input.tel?.trim()) body.tel = input.tel.trim();
  if (input.firstName?.trim()) body.first_name = input.firstName.trim();
  if (input.postcode?.trim()) body.postcode = input.postcode.trim();
  if (input.plaats?.trim()) body.plaats = input.plaats.trim();
  if (input.straat?.trim()) body.straat = input.straat.trim();
  if (input.huisnummer?.trim()) body.huisnummer = input.huisnummer.trim();

  const url = `${baseUrl()}/api/method/relaypro.api.intake.lead_intake`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RelayPro-Token": t,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let raw: unknown = text;
  try {
    raw = JSON.parse(text);
  } catch {
    /* keep text */
  }

  if (!res.ok) {
    const msg =
      typeof raw === "object" &&
      raw &&
      "message" in raw &&
      typeof (raw as { message?: unknown }).message === "string"
        ? (raw as { message: string }).message
        : `TC Swiss intake HTTP ${res.status}`;
    throw new Error(msg);
  }

  // Frappe wraps often as { message: { ... } }
  const payload =
    typeof raw === "object" &&
    raw &&
    "message" in raw &&
    typeof (raw as { message: unknown }).message === "object"
      ? ((raw as { message: Record<string, unknown> }).message || {})
      : typeof raw === "object" && raw
        ? (raw as Record<string, unknown>)
        : {};

  const lead =
    typeof payload.lead === "string"
      ? payload.lead
      : typeof payload.name === "string"
        ? payload.name
        : null;
  const duplicate = Boolean(payload.duplicate);

  return {
    ok: payload.ok !== false,
    duplicate,
    lead,
    externId:
      typeof payload.extern_id === "string" ? payload.extern_id : externId,
    raw,
  };
}
