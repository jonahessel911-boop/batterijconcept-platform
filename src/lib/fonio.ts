/**
 * Fonio outbound + webhook helpers.
 * Docs: https://app.fonio.ai/api/docs
 */

export function fonioConfigured(): boolean {
  return Boolean(
    process.env.FONIO_API_KEY?.trim() &&
      process.env.FONIO_FROM_NUMBER?.trim()
  );
}

export function fonioApiKey(): string | null {
  return process.env.FONIO_API_KEY?.trim() || null;
}

export function fonioFromNumber(): string | null {
  const raw = process.env.FONIO_FROM_NUMBER?.trim();
  return raw ? toE164Nl(raw) : null;
}

export function fonioWebhookSecret(): string | null {
  return process.env.FONIO_WEBHOOK_SECRET?.trim() || null;
}

/** Auto-outbound staat uit. Eigen mensen bellen vanuit de belbak. */
export function fonioAutoCallOnLead(): boolean {
  return false;
}

/** NL/E.164 normalisatie voor Fonio (+31…). */
export function toE164Nl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, "");
  let digits = cleaned.startsWith("+")
    ? cleaned.slice(1).replace(/\D/g, "")
    : cleaned.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `31${digits.slice(1)}`;
  if (!digits.startsWith("31") && digits.length === 9) {
    digits = `31${digits}`;
  }
  return `+${digits}`;
}

/** Varianten om telefoon in DB te matchen. */
export function phoneMatchVariants(raw: string | null | undefined): string[] {
  const e164 = toE164Nl(raw);
  if (!e164) return [];
  const digits = e164.replace(/\D/g, "");
  const local = digits.startsWith("31") ? `0${digits.slice(2)}` : digits;
  const spaced = local.replace(/(\d{2})(\d{8})/, "$1 $2");
  return Array.from(
    new Set([e164, `+${digits}`, digits, local, spaced, raw!.trim()].filter(Boolean))
  );
}

export type FonioOutboundResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string; data?: unknown };

/**
 * Fonio belt niet meer. Leads gaan naar de belbak; eigen mensen bellen.
 */
export async function triggerFonioOutbound(
  _opts: {
    toNumber: string;
    context?: Record<string, unknown>;
  }
): Promise<FonioOutboundResult> {
  return {
    ok: false,
    status: 410,
    error: "Fonio belt niet meer. Bel deze lead zelf vanuit de belbak.",
  };
}

/** Auth voor Fonio → ons platform (webhooks). */
export function authorizeFonioWebhook(req: {
  headers: Headers;
}): { ok: true } | { ok: false; status: number; error: string } {
  const secret = fonioWebhookSecret();
  if (!secret) {
    // Zonder secret: open (alleen als je bewust zo wilt testen)
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        status: 503,
        error: "Zet FONIO_WEBHOOK_SECRET in env (productie)",
      };
    }
    return { ok: true };
  }

  const header =
    req.headers.get("x-fonio-secret")?.trim() ||
    req.headers.get("x-webhook-secret")?.trim() ||
    null;
  const auth = req.headers.get("authorization")?.trim();
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
  const provided = header || bearer;

  if (!provided || provided !== secret) {
    return { ok: false, status: 401, error: "Ongeldige of ontbrekende webhook-secret" };
  }
  return { ok: true };
}

export function pickStr(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Onthoud outbound-call → lead (telefoon sync).
 * Zet géén laatst_gebeld_at — dat telt als bel-conversie zonder beller.
 * Recent-match loopt via fonio_calls (zie findRecentFonioOutboundLead).
 */
export async function rememberFonioOutboundLead(opts: {
  leadId: string;
  toNumber: string;
}): Promise<void> {
  try {
    const { getSupabaseAdmin } = await import("@/lib/supabase");
    const sb = getSupabaseAdmin();
    const to = toE164Nl(opts.toNumber);
    if (!to) return;
    await sb.from("leads").update({ telefoon: to }).eq("id", opts.leadId);
  } catch (e) {
    console.warn("rememberFonioOutboundLead:", e);
  }
}

/** Meest recente Fonio-outbound lead (via fonio_calls, fallback leads). */
export async function findRecentFonioOutboundLead(
  withinMinutes = 30
): Promise<string | null> {
  try {
    const { getSupabaseAdmin } = await import("@/lib/supabase");
    const sb = getSupabaseAdmin();
    const since = new Date(Date.now() - withinMinutes * 60_000).toISOString();

    const { data: call } = await sb
      .from("fonio_calls")
      .select("lead_id")
      .not("lead_id", "is", null)
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (call?.lead_id) return call.lead_id as string;

    const { data } = await sb
      .from("leads")
      .select("id")
      .not("laatst_gebeld_at", "is", null)
      .gte("laatst_gebeld_at", since)
      .order("laatst_gebeld_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.id || null;
  } catch {
    return null;
  }
}

/** Adresregel voor Fonio-prompt / context. */
export function formatLeadAdres(lead: {
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
}): string {
  const nummer = [lead.huisnummer, lead.toevoeging].filter(Boolean).join("");
  const straatNr = [lead.straat, nummer].filter(Boolean).join(" ").trim();
  const pcPlaats = [lead.postcode, lead.plaats].filter(Boolean).join(" ").trim();
  return [straatNr, pcPlaats].filter(Boolean).join(", ") || "";
}

/**
 * Context die we bij outbound (en inbound-response) naar Fonio sturen.
 * Beschikbaar als {{context.veld}} / {{veld}} in de assistant.
 */
export function buildFonioLeadContext(lead: {
  id?: string | null;
  lead_number?: string | null;
  naam?: string | null;
  email?: string | null;
  telefoon?: string | null;
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
  status?: string | null;
  notities?: string | null;
}): Record<string, unknown> {
  const naam = (lead.naam || "").trim() || "klant";
  const firstName = naam.split(/\s+/)[0] || "klant";
  const adres = formatLeadAdres(lead);
  const telefoon = toE164Nl(lead.telefoon) || lead.telefoon || null;

  return {
    firstName,
    naam,
    lead_id: lead.id || null,
    lead_number: lead.lead_number || null,
    email: lead.email || null,
    telefoon,
    straat: lead.straat || null,
    huisnummer: lead.huisnummer || null,
    toevoeging: lead.toevoeging || null,
    postcode: lead.postcode || null,
    plaats: lead.plaats || null,
    adres: adres || null,
    status: lead.status || null,
    notities: lead.notities?.trim()?.slice(0, 500) || null,
  };
}
