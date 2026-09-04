/**
 * Minimale bunq API-client (RSA-sign + session).
 *
 * Env na setup:
 *   BUNQ_API_KEY
 *   BUNQ_PRIVATE_KEY          — PEM (of base64 van PEM)
 *   BUNQ_INSTALLATION_TOKEN
 *   BUNQ_SERVER_PUBLIC_KEY    — PEM van bunq-server (optioneel voor verify)
 *   BUNQ_MONETARY_ACCOUNT_ID  — optioneel; anders eerste actieve rekening
 *   BUNQ_USER_ID              — optioneel; anders uit session
 */
import { createHash, createPrivateKey, createSign, generateKeyPairSync } from "crypto";

const BUNQ_API = "https://api.bunq.com/v1";
const USER_AGENT = "BatterijconceptCRM/1.0";

type BunqResponseItem = Record<string, unknown>;

export type BunqPayment = {
  id: number;
  created: string;
  updated: string;
  amount: { value: string; currency: string };
  description: string;
  type?: string;
  sub_type?: string;
  counterparty_alias?: {
    display_name?: string;
    iban?: string;
  };
};

let cachedSession: {
  token: string;
  userId: number;
  expiresAt: number;
} | null = null;

function normalizePem(raw: string): string {
  let s = raw.trim();
  // Env vaak met \\n of zonder headers als base64
  if (!s.includes("BEGIN") && /^[A-Za-z0-9+/=\s]+$/.test(s)) {
    try {
      s = Buffer.from(s.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      /* keep */
    }
  }
  return s.replace(/\\n/g, "\n").trim();
}

export function bunqConfigured(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.BUNQ_API_KEY?.trim()) missing.push("BUNQ_API_KEY");
  if (!process.env.BUNQ_PRIVATE_KEY?.trim()) missing.push("BUNQ_PRIVATE_KEY");
  if (!process.env.BUNQ_INSTALLATION_TOKEN?.trim()) {
    missing.push("BUNQ_INSTALLATION_TOKEN");
  }
  return { ok: missing.length === 0, missing };
}

export function generateBunqKeyPair(): {
  privateKeyPem: string;
  publicKeyPem: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

function signBody(body: string, privateKeyPem: string): string {
  const key = createPrivateKey(normalizePem(privateKeyPem));
  const sign = createSign("SHA256");
  sign.update(body);
  sign.end();
  return sign.sign(key, "base64");
}

function unwrapResponse(json: {
  Response?: BunqResponseItem[];
  Error?: { error_description?: string }[];
}): BunqResponseItem[] {
  if (json.Error?.length) {
    throw new Error(
      json.Error.map((e) => e.error_description || "bunq error").join("; ")
    );
  }
  return json.Response || [];
}

function pickFirst<T>(
  items: BunqResponseItem[],
  key: string
): T | null {
  for (const item of items) {
    if (key in item) return item[key] as T;
  }
  return null;
}

async function bunqFetch(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    authToken: string;
    privateKeyPem?: string | null;
    sign?: boolean;
  }
): Promise<BunqResponseItem[]> {
  const method = opts.method || "GET";
  const bodyStr =
    opts.body === undefined ? "" : JSON.stringify(opts.body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    "User-Agent": USER_AGENT,
    "X-Bunq-Language": "nl_NL",
    "X-Bunq-Region": "nl_NL",
    "X-Bunq-Client-Request-Id": createHash("sha1")
      .update(`${Date.now()}-${Math.random()}`)
      .digest("hex"),
    "X-Bunq-Geolocation": "0 0 0 0 000",
    "X-Bunq-Client-Authentication": opts.authToken,
  };

  if (opts.sign !== false && opts.privateKeyPem && bodyStr) {
    headers["X-Bunq-Client-Signature"] = signBody(
      bodyStr,
      opts.privateKeyPem
    );
  } else if (opts.sign !== false && opts.privateKeyPem && method !== "GET") {
    headers["X-Bunq-Client-Signature"] = signBody("", opts.privateKeyPem);
  }

  const res = await fetch(`${BUNQ_API}${path}`, {
    method,
    headers,
    body: bodyStr || undefined,
    cache: "no-store",
  });

  const json = (await res.json()) as {
    Response?: BunqResponseItem[];
    Error?: { error_description?: string }[];
  };

  if (!res.ok) {
    const msg =
      json.Error?.map((e) => e.error_description).filter(Boolean).join("; ") ||
      `bunq HTTP ${res.status}`;
    throw new Error(msg);
  }

  return unwrapResponse(json);
}

/** Eenmalige installation + device-server. Geeft tokens terug voor env. */
export async function setupBunqInstallation(apiKey: string): Promise<{
  privateKeyPem: string;
  publicKeyPem: string;
  installationToken: string;
  serverPublicKey: string;
  deviceId: number | null;
}> {
  const { privateKeyPem, publicKeyPem } = generateBunqKeyPair();

  const installRes = await fetch(`${BUNQ_API}/installation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "X-Bunq-Client-Request-Id": createHash("sha1")
        .update(`install-${Date.now()}`)
        .digest("hex"),
      "X-Bunq-Geolocation": "0 0 0 0 000",
    },
    body: JSON.stringify({ client_public_key: publicKeyPem }),
    cache: "no-store",
  });
  const installJson = (await installRes.json()) as {
    Response?: BunqResponseItem[];
    Error?: { error_description?: string }[];
  };
  const installItems = unwrapResponse(installJson);
  const tokenObj = pickFirst<{ token?: string }>(installItems, "Token");
  const serverKeyObj = pickFirst<{ server_public_key?: string }>(
    installItems,
    "ServerPublicKey"
  );
  const installationToken = tokenObj?.token;
  const serverPublicKey = serverKeyObj?.server_public_key;
  if (!installationToken || !serverPublicKey) {
    throw new Error("bunq installation: token/server key ontbreekt");
  }

  const deviceItems = await bunqFetch("/device-server", {
    method: "POST",
    authToken: installationToken,
    privateKeyPem,
    body: {
      description: "Batterijconcept CRM",
      secret: apiKey,
      permitted_ips: ["*"],
    },
  });
  const device = pickFirst<{ id?: number }>(deviceItems, "Id");

  return {
    privateKeyPem,
    publicKeyPem,
    installationToken,
    serverPublicKey,
    deviceId: device?.id ?? null,
  };
}

async function createSession(): Promise<{ token: string; userId: number }> {
  const apiKey = process.env.BUNQ_API_KEY?.trim();
  const privateKeyPem = process.env.BUNQ_PRIVATE_KEY;
  const installationToken = process.env.BUNQ_INSTALLATION_TOKEN?.trim();
  if (!apiKey || !privateKeyPem || !installationToken) {
    throw new Error("Bunq niet geconfigureerd — run /api/bunq/setup");
  }

  if (cachedSession && cachedSession.expiresAt > Date.now()) {
    return {
      token: cachedSession.token,
      userId: cachedSession.userId,
    };
  }

  const items = await bunqFetch("/session-server", {
    method: "POST",
    authToken: installationToken,
    privateKeyPem,
    body: { secret: apiKey },
  });

  const tokenObj = pickFirst<{ token?: string }>(items, "Token");
  const userPerson = pickFirst<{ id?: number }>(items, "UserPerson");
  const userCompany = pickFirst<{ id?: number }>(items, "UserCompany");
  const userApi = pickFirst<{ id?: number }>(items, "UserApiKey");
  const userId =
    Number(process.env.BUNQ_USER_ID) ||
    userCompany?.id ||
    userPerson?.id ||
    userApi?.id;
  const token = tokenObj?.token;
  if (!token || !userId) {
    throw new Error("bunq session: token/user id ontbreekt");
  }

  cachedSession = {
    token,
    userId,
    // Session ~30 dagen; cache 12u in memory
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  };

  return { token, userId };
}

export async function listMonetaryAccounts(): Promise<
  { id: number; description: string; iban: string | null; status: string }[]
> {
  const { token, userId } = await createSession();
  const privateKeyPem = process.env.BUNQ_PRIVATE_KEY!;
  const items = await bunqFetch(`/user/${userId}/monetary-account`, {
    method: "GET",
    authToken: token,
    privateKeyPem,
    sign: false,
  });

  const out: {
    id: number;
    description: string;
    iban: string | null;
    status: string;
  }[] = [];

  for (const item of items) {
    const bank = item.MonetaryAccountBank as
      | {
          id?: number;
          description?: string;
          status?: string;
          alias?: { type?: string; value?: string }[];
        }
      | undefined;
    const joint = item.MonetaryAccountJoint as typeof bank;
    const light = item.MonetaryAccountLight as typeof bank;
    const acc = bank || joint || light;
    if (!acc?.id) continue;
    const iban =
      acc.alias?.find((a) => a.type === "IBAN")?.value ||
      acc.alias?.[0]?.value ||
      null;
    out.push({
      id: acc.id,
      description: acc.description || `Account ${acc.id}`,
      iban,
      status: acc.status || "UNKNOWN",
    });
  }
  return out;
}

async function resolveMonetaryAccountId(): Promise<{
  userId: number;
  accountId: number;
  sessionToken: string;
}> {
  const { token, userId } = await createSession();
  const envId = Number(process.env.BUNQ_MONETARY_ACCOUNT_ID);
  if (envId) {
    return { userId, accountId: envId, sessionToken: token };
  }

  const accounts = await listMonetaryAccounts();
  const preferredIban = (process.env.BUNQ_IBAN || "NL48BUNQ2209557933")
    .replace(/\s+/g, "")
    .toUpperCase();
  const match =
    accounts.find(
      (a) =>
        a.status === "ACTIVE" &&
        a.iban?.replace(/\s+/g, "").toUpperCase() === preferredIban
    ) || accounts.find((a) => a.status === "ACTIVE");

  if (!match) throw new Error("Geen actieve bunq monetary account gevonden");
  return { userId, accountId: match.id, sessionToken: token };
}

/** Inkomende betalingen (positief bedrag) sinds datum. */
export async function listIncomingPayments(options?: {
  olderId?: number;
  count?: number;
}): Promise<BunqPayment[]> {
  const { userId, accountId, sessionToken } = await resolveMonetaryAccountId();
  const privateKeyPem = process.env.BUNQ_PRIVATE_KEY!;
  const count = options?.count ?? 50;
  const qs = new URLSearchParams({ count: String(count) });
  if (options?.olderId) qs.set("older_id", String(options.olderId));

  const items = await bunqFetch(
    `/user/${userId}/monetary-account/${accountId}/payment?${qs}`,
    {
      method: "GET",
      authToken: sessionToken,
      privateKeyPem,
      sign: false,
    }
  );

  const payments: BunqPayment[] = [];
  for (const item of items) {
    const p = item.Payment as
      | {
          id?: number;
          created?: string;
          updated?: string;
          amount?: { value?: string; currency?: string };
          description?: string;
          type?: string;
          sub_type?: string;
          counterparty_alias?: {
            display_name?: string;
            iban?: string;
          };
        }
      | undefined;
    if (!p?.id || !p.amount?.value) continue;
    const value = Number(p.amount.value);
    if (!Number.isFinite(value) || value <= 0) continue; // alleen inkomend
    payments.push({
      id: p.id,
      created: p.created || "",
      updated: p.updated || "",
      amount: {
        value: p.amount.value,
        currency: p.amount.currency || "EUR",
      },
      description: p.description || "",
      type: p.type,
      sub_type: p.sub_type,
      counterparty_alias: p.counterparty_alias,
    });
  }
  return payments;
}
