/**
 * VOIPZeker Unite REST API client.
 * Docs: https://api.voipzeker.nl/unite/v1/docs/
 *
 * Auth: UNITE_LOGIN_TOKEN (blijvend) → accesstoken (30 min).
 * Optioneel: UNITE_ACCESS_TOKEN voor korte tests.
 */

import { fromZonedTime } from "date-fns-tz";

const UNITE_BASE = "https://api.voipzeker.nl/unite/v1";

export function uniteConfigured(): boolean {
  return Boolean(
    process.env.UNITE_LOGIN_TOKEN?.trim() ||
      process.env.UNITE_ACCESS_TOKEN?.trim()
  );
}

export function uniteLoginToken(): string | null {
  return process.env.UNITE_LOGIN_TOKEN?.trim() || null;
}

/**
 * Publieke webhook-URL voor Unite App template (call-events).
 * Unite portal → Provisioning → App templates → Maatwerk CRM → webhook URL.
 * Of API: POST /setapptemplatesettings (alleen als provisioning dat toelaat).
 */
export function getUniteCallWebhookUrl(appUrl?: string | null): string {
  const base = (
    appUrl ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "https://batterijconcept-platform.vercel.app"
  )
    .trim()
    .replace(/\/$/, "");
  return (
    `${base}/api/unite/webhook` +
    `?callid={calluniqueid}` +
    `&callfrom={callfrom}` +
    `&callto={callto}` +
    `&status={status}` +
    `&status_desc={status_desc}` +
    `&direction={direction}` +
    `&timestamp={timestamp}`
  );
}

/** Probeer webhook_url te zetten op het Unite-app-template. */
export async function setUniteAppWebhookUrl(
  webhookUrl: string
): Promise<{ ok: boolean; message: string }> {
  const token = await getUniteAccessToken();
  const body = new URLSearchParams();
  body.set("accesstoken", token);
  body.set("webhook_url", webhookUrl);
  const res = await fetch(`${UNITE_BASE}/setapptemplatesettings`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    status?: boolean;
    message?: string;
    errorCode?: number;
  };
  if (!json.status) {
    return {
      ok: false,
      message:
        json.message ||
        `Unite setapptemplatesettings mislukt (${json.errorCode ?? res.status})`,
    };
  }
  return { ok: true, message: json.message || "Webhook URL gezet" };
}

type UniteResponse<T> = {
  status: boolean;
  errorCode: number;
  message?: string;
  data?: T;
  pagination?: { itemcount?: string | number; pagecount?: number };
};

export type UniteCdrLeg = {
  number?: string;
  desc?: string;
  number_formatted?: string;
};

export type UniteCdrLog = {
  uniqueid: string;
  calltime: string;
  billsecond?: string | number;
  duration?: string | number;
  direction?: "in" | "out" | string;
  call_chain?: UniteCdrLeg[];
};

let cachedAccess: { token: string; expiresAt: number } | null = null;

async function postForm<T>(
  path: string,
  fields: Record<string, string | number | undefined | null>
): Promise<UniteResponse<T>> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === "") continue;
    body.set(k, String(v));
  }
  const res = await fetch(`${UNITE_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (res.status === 429) {
    throw new Error("Unite rate limit (30 req/min)");
  }
  const json = (await res.json()) as UniteResponse<T>;
  return json;
}

/** Accesstoken ophalen (cache ~25 min). */
export async function getUniteAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAccess && cachedAccess.expiresAt > now + 60_000) {
    return cachedAccess.token;
  }

  const envAccess = process.env.UNITE_ACCESS_TOKEN?.trim();
  if (envAccess && !uniteLoginToken()) {
    cachedAccess = { token: envAccess, expiresAt: now + 25 * 60_000 };
    return envAccess;
  }

  const login = uniteLoginToken();
  if (!login) {
    if (envAccess) {
      cachedAccess = { token: envAccess, expiresAt: now + 25 * 60_000 };
      return envAccess;
    }
    throw new Error("UNITE_LOGIN_TOKEN ontbreekt");
  }

  const json = await postForm<{ accesstoken?: string }>("applogin", {
    logintoken: login,
  });
  const token = json.data?.accesstoken;
  if (!json.status || !token) {
    throw new Error(
      `Unite applogin mislukt: ${json.message || `code ${json.errorCode}`}`
    );
  }
  cachedAccess = { token, expiresAt: now + 25 * 60_000 };
  return token;
}

export async function listUniteCdrLogs(opts: {
  dateStart: string;
  dateEnd: string;
  page?: number;
  pageLimit?: number;
  inbound?: boolean;
  outbound?: boolean;
  /** 0 = alles, 1 = opgenomen, 2 = niet opgenomen. */
  answered?: 0 | 1 | 2;
}): Promise<{
  items: UniteCdrLog[];
  itemcount: number;
  pagecount: number;
}> {
  const token = await getUniteAccessToken();
  const json = await postForm<UniteCdrLog[]>("listcdrlogs", {
    accesstoken: token,
    filter_datestart: opts.dateStart,
    filter_dateend: opts.dateEnd,
    filter_inbound: opts.inbound === false ? 0 : 1,
    filter_outbound: opts.outbound === false ? 0 : 1,
    filter_answered: opts.answered ?? 0,
    sortkey: "calltime",
    sorttype: 1,
    pagelimit: opts.pageLimit ?? 50,
    showpage: opts.page ?? 1,
  });
  if (!json.status) {
    if (json.errorCode === 90) {
      cachedAccess = null;
      throw new Error("Unite accesstoken verlopen — opnieuw proberen");
    }
    throw new Error(json.message || `Unite CDR fout ${json.errorCode}`);
  }
  const items = Array.isArray(json.data) ? json.data : [];
  const itemcount = Number(json.pagination?.itemcount || items.length) || 0;
  const pagecount = Number(json.pagination?.pagecount || 1) || 1;
  return { items, itemcount, pagecount };
}

/** Unite calltime ("YYYY-MM-DD HH:mm:ss.ssssss") → Date (Europe/Amsterdam). */
export function parseUniteCalltime(raw: string): Date {
  const m = raw
    .trim()
    .match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/
    );
  if (!m) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  const frac = (m[7] || "0").padEnd(3, "0").slice(0, 3);
  const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${frac}`;
  return fromZonedTime(local, "Europe/Amsterdam");
}

export function formatDurationNl(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export type UniteExtension = {
  id: string;
  name: string;
  extno_format?: string;
  callerid?: string;
  username?: string;
};

export type UniteCallRecord = {
  callrecordkey: string;
  recordtime?: string;
  duration?: string | number;
  filename?: string;
  from_number?: string;
  to_number?: string;
  file_totalpart?: number;
  filesize?: string | number;
};

let cachedExtensions: { at: number; items: UniteExtension[] } | null = null;

export async function listUniteExtensions(): Promise<UniteExtension[]> {
  const now = Date.now();
  if (cachedExtensions && now - cachedExtensions.at < 10 * 60_000) {
    return cachedExtensions.items;
  }
  const token = await getUniteAccessToken();
  const json = await postForm<{ items?: UniteExtension[] }>("listextensions", {
    accesstoken: token,
  });
  if (!json.status) {
    throw new Error(json.message || "Unite extensions mislukt");
  }
  const items = json.data?.items || [];
  cachedExtensions = { at: now, items };
  return items;
}

/** Zoek extensie op 0200 / 200 / id. */
export async function findUniteExtension(
  extOrId: string | null | undefined
): Promise<UniteExtension | null> {
  if (!extOrId) return null;
  const raw = String(extOrId).trim();
  const dig = raw.replace(/\D/g, "").replace(/^0+/, "") || raw.replace(/\D/g, "");
  const items = await listUniteExtensions();
  return (
    items.find((e) => e.id === raw) ||
    items.find((e) => (e.extno_format || "").replace(/\D/g, "").replace(/^0+/, "") === dig) ||
    items.find((e) => (e.username || "").endsWith(`*${dig}`) || (e.username || "").endsWith(raw)) ||
    null
  );
}

export async function listUniteCallRecords(opts: {
  extensionId: string;
  page?: number;
  pageLimit?: number;
  stext?: string;
}): Promise<{ items: UniteCallRecord[]; itemcount: number }> {
  const token = await getUniteAccessToken();
  const json = await postForm<{
    items?: UniteCallRecord[];
    itemcount?: string | number;
  }>("listcallrecords", {
    accesstoken: token,
    extensionid: opts.extensionId,
    pagelimit: opts.pageLimit ?? 30,
    showpage: opts.page ?? 1,
    stext: opts.stext || undefined,
  });
  if (!json.status) {
    throw new Error(json.message || "Unite callrecords mislukt");
  }
  const items = json.data?.items || [];
  return {
    items,
    itemcount: Number(json.data?.itemcount || items.length) || 0,
  };
}

/** Unite splitst opnames in ~1 MiB parts. */
export const UNITE_RECORDING_PART_SIZE = 1048576;

/** Download één part van een callrecord. */
export async function downloadUniteCallRecord(opts: {
  callrecordkey: string;
  extensionId?: string | null;
  partitionNumber?: number;
}): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const attempt = async (forceRefresh: boolean) => {
    if (forceRefresh) cachedAccess = null;
    const token = await getUniteAccessToken();
    const body = new URLSearchParams();
    body.set("accesstoken", token);
    body.set("callrecordkey", opts.callrecordkey);
    body.set("partition_number", String(opts.partitionNumber ?? 1));
    if (opts.extensionId) body.set("extensionid", opts.extensionId);

    const res = await fetch(`${UNITE_BASE}/downloadcallrecord`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json") || ct.includes("text/json")) {
      const j = (await res.json()) as {
        message?: string;
        errorCode?: number;
        status?: boolean;
      };
      const code = j.errorCode;
      // 90 = token renew, 21 = invalid token, 100 = user verified
      if (code === 90 || code === 21 || res.status === 401) {
        const err = new Error(j.message || `Unite auth ${code ?? res.status}`);
        (err as Error & { renew?: boolean }).renew = true;
        throw err;
      }
      throw new Error(j.message || "Unite download JSON-fout");
    }

    if (!res.ok) {
      const err = new Error(`Unite download mislukt (${res.status})`);
      if (res.status === 401 || res.status === 403) {
        (err as Error & { renew?: boolean }).renew = true;
      }
      throw err;
    }

    return {
      bytes: await res.arrayBuffer(),
      contentType: ct.includes("audio") ? ct : "audio/mpeg",
    };
  };

  try {
    return await attempt(false);
  } catch (e) {
    if (e && typeof e === "object" && (e as { renew?: boolean }).renew) {
      return attempt(true);
    }
    throw e;
  }
}

/** Alle parts ophalen en samenvoegen tot één mp3. */
export async function downloadUniteCallRecordFull(opts: {
  callrecordkey: string;
  extensionId?: string | null;
  totalParts?: number | null;
}): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const maxParts = Math.min(
    Math.max(1, opts.totalParts || 32),
    64
  );
  const chunks: Uint8Array[] = [];
  let contentType = "audio/mpeg";

  for (let p = 1; p <= maxParts; p++) {
    try {
      const part = await downloadUniteCallRecord({
        callrecordkey: opts.callrecordkey,
        extensionId: opts.extensionId,
        partitionNumber: p,
      });
      contentType = part.contentType || contentType;
      chunks.push(new Uint8Array(part.bytes));
      // Laatste part is kleiner dan PART_SIZE (tenzij exact op grens + known total)
      if (opts.totalParts != null && p >= opts.totalParts) break;
      if (
        opts.totalParts == null &&
        part.bytes.byteLength < UNITE_RECORDING_PART_SIZE
      )
        break;
      // Rate limit: kleine pauze tussen parts
      if (p < maxParts) {
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (e) {
      if (p === 1) throw e;
      break;
    }
  }

  if (chunks.length === 0) {
    throw new Error("Unite opname leeg");
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return { bytes: out.buffer, contentType };
}

/** Match opname op extern nummer + tijdstip (±3 min) + duur. */
export async function findUniteRecordingForCall(opts: {
  extensionId: string;
  externalPhone: string;
  callAt: Date;
  durationSeconds?: number;
}): Promise<UniteCallRecord | null> {
  const dig = opts.externalPhone.replace(/\D/g, "");
  const local = dig.startsWith("31") ? dig.slice(2) : dig;
  const { items } = await listUniteCallRecords({
    extensionId: opts.extensionId,
    pageLimit: 40,
    page: 1,
  });
  const target = opts.callAt.getTime();
  let best: { rec: UniteCallRecord; score: number } | null = null;
  for (const rec of items) {
    const blob = `${rec.to_number || ""} ${rec.from_number || ""}`;
    if (!blob.includes(dig) && !blob.includes(local)) continue;
    const rt = rec.recordtime
      ? parseUniteCalltime(rec.recordtime.replace(/\+\d+$/, "").trim())
      : null;
    if (!rt) continue;
    const dt = Math.abs(rt.getTime() - target);
    if (dt > 5 * 60_000) continue;
    const dur = Number(rec.duration || 0) || 0;
    const durDiff =
      opts.durationSeconds != null
        ? Math.abs(dur - opts.durationSeconds)
        : 0;
    const score = dt + durDiff * 1000;
    if (!best || score < best.score) best = { rec, score };
  }
  return best?.rec || null;
}
