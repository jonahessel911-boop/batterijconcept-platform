import { NextRequest, NextResponse } from "next/server";
import { setupBunqInstallation, listMonetaryAccounts } from "@/lib/bunq/client";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret =
    process.env.BUNQ_SETUP_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  const q = req.nextUrl.searchParams.get("secret");
  return auth === `Bearer ${secret}` || q === secret;
}

/**
 * POST /api/bunq/setup
 * Eenmalig: maakt RSA-keypair + bunq installation/device.
 * Body: { "api_key": "…" }  of gebruik env BUNQ_API_KEY.
 *
 * Response bevat waarden die je in Vercel env moet zetten.
 * Beveiligd met CRON_SECRET of BUNQ_SETUP_SECRET.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { api_key?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const apiKey =
    body.api_key?.trim() || process.env.BUNQ_API_KEY?.trim() || "";
  if (!apiKey) {
    return NextResponse.json(
      { error: "api_key verplicht (body of BUNQ_API_KEY)" },
      { status: 400 }
    );
  }

  try {
    const setup = await setupBunqInstallation(apiKey);

    // Tijdelijk in process.env zodat we accounts kunnen listen
    process.env.BUNQ_API_KEY = apiKey;
    process.env.BUNQ_PRIVATE_KEY = setup.privateKeyPem;
    process.env.BUNQ_INSTALLATION_TOKEN = setup.installationToken;

    let accounts: Awaited<ReturnType<typeof listMonetaryAccounts>> = [];
    try {
      accounts = await listMonetaryAccounts();
    } catch (e) {
      console.error("bunq list accounts after setup:", e);
    }

    return NextResponse.json({
      ok: true,
      message:
        "Zet onderstaande env vars in Vercel (Production). Private key nooit committen.",
      env: {
        BUNQ_API_KEY: apiKey,
        BUNQ_PRIVATE_KEY: setup.privateKeyPem,
        BUNQ_INSTALLATION_TOKEN: setup.installationToken,
        BUNQ_SERVER_PUBLIC_KEY: setup.serverPublicKey,
        BUNQ_MONETARY_ACCOUNT_ID:
          accounts.find((a) => a.status === "ACTIVE")?.id?.toString() || "",
        BUNQ_IBAN: "NL48BUNQ2209557933",
      },
      deviceId: setup.deviceId,
      accounts,
      next: [
        "1. Plak env vars in Vercel → Redeploy",
        "2. Draai supabase/migrate-bunq-payments.sql",
        "3. POST /api/bunq/sync om openstaande facturen te matchen",
        "4. Optioneel: bunq callback op /api/webhook/bunq (MUTATION/PAYMENT)",
      ],
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Setup mislukt" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    endpoint: "/api/bunq/setup",
    method: "POST",
    body: { api_key: "jouw-bunq-api-key" },
    auth: "Authorization: Bearer CRON_SECRET",
  });
}
