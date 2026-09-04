import { NextRequest, NextResponse } from "next/server";
import { bunqConfigured, listMonetaryAccounts } from "@/lib/bunq/client";
import { syncBunqPayments } from "@/lib/bunq/sync";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret =
    process.env.BUNQ_SETUP_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  // Zonder secret: sync alleen vanaf zelfde origin / lokaal — eis secret in prod
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const auth = req.headers.get("authorization");
  const q = req.nextUrl.searchParams.get("secret");
  return auth === `Bearer ${secret}` || q === secret;
}

/**
 * GET /api/bunq/sync — status + optioneel accounts
 * POST /api/bunq/sync — haal betalingen op en markeer facturen
 */
export async function GET(req: NextRequest) {
  const cfg = bunqConfigured();
  const preview = req.nextUrl.searchParams.get("accounts") === "1";

  let accounts: unknown[] | undefined;
  if (preview && cfg.ok && authorized(req)) {
    try {
      accounts = await listMonetaryAccounts();
    } catch (e) {
      return NextResponse.json({
        configured: cfg.ok,
        missing: cfg.missing,
        error: e instanceof Error ? e.message : "Accounts laden mislukt",
      });
    }
  }

  return NextResponse.json({
    configured: cfg.ok,
    missing: cfg.missing,
    accounts,
    hint: "POST om te syncen (Authorization: Bearer CRON_SECRET)",
  });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let pages = 3;
  try {
    const body = (await req.json()) as { pages?: number };
    if (body.pages && body.pages > 0 && body.pages <= 20) pages = body.pages;
  } catch {
    /* empty body ok */
  }

  const result = await syncBunqPayments({ pages });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
