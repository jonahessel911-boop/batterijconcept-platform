import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimeZone } from "date-fns-tz";
import type {
  InkomendeFactuur,
  InkomendeFactuurBestand,
  InkomendeFactuurStatus,
} from "@/types/database";
import { AMSTERDAM_TZ } from "@/lib/format";

const BUCKET = "inkomende-facturen";
const MAX_BYTES = 25 * 1024 * 1024;

export { BUCKET as INKOMENDE_FACTUREN_BUCKET };

export const INKOMENDE_FACTUUR_STATUSES: InkomendeFactuurStatus[] = [
  "nieuw",
  "in_behandeling",
  "geboekt",
  "afgewezen",
  "archief",
];

export const INKOMENDE_FACTUUR_STATUS_LABEL: Record<
  InkomendeFactuurStatus,
  string
> = {
  nieuw: "Nieuw",
  in_behandeling: "In behandeling",
  geboekt: "Geboekt",
  afgewezen: "Afgewezen",
  archief: "Archief",
};

export function normalizeInkomendeFactuurStatus(
  value: unknown
): InkomendeFactuurStatus {
  const raw = typeof value === "string" ? value.trim() : "";
  if (INKOMENDE_FACTUUR_STATUSES.includes(raw as InkomendeFactuurStatus)) {
    return raw as InkomendeFactuurStatus;
  }
  return "nieuw";
}

function safeExt(name: string): string {
  return (
    name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin"
  );
}

type UploadOk = { bestand: InkomendeFactuurBestand };
type UploadErr = { error: string; status: number; detail?: string };

export async function uploadInkomendeFactuurBytes(
  sb: SupabaseClient,
  factuurId: string,
  input: {
    bytes: Buffer | Uint8Array;
    bestandsnaam: string;
    mimeType?: string | null;
    contentId?: string | null;
  }
): Promise<UploadOk | UploadErr> {
  const size = input.bytes.byteLength;
  if (size > MAX_BYTES) {
    return { error: "Bestand mag max. 25 MB zijn", status: 400 };
  }
  if (size <= 0) {
    return { error: "Bestand is leeg", status: 400 };
  }

  const name = input.bestandsnaam.trim() || "bijlage";
  const storagePath = `${factuurId}/${Date.now()}-${randomBytes(4).toString("hex")}.${safeExt(name)}`;
  const buffer = Buffer.isBuffer(input.bytes)
    ? input.bytes
    : Buffer.from(input.bytes);

  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: input.mimeType || "application/octet-stream",
      upsert: false,
    });

  if (uploadErr) {
    return {
      error: "Upload mislukt",
      status: 500,
      detail: uploadErr.message,
    };
  }

  const { data: row, error: insertErr } = await sb
    .from("inkomende_factuur_bestanden")
    .insert({
      inkomende_factuur_id: factuurId,
      storage_path: storagePath,
      bestandsnaam: name,
      mime_type: input.mimeType || null,
      grootte_bytes: size,
      content_id: input.contentId || null,
    })
    .select(
      "id, inkomende_factuur_id, storage_path, bestandsnaam, mime_type, grootte_bytes, content_id, created_at"
    )
    .single();

  if (insertErr || !row) {
    await sb.storage.from(BUCKET).remove([storagePath]);
    return {
      error: insertErr?.message || "Opslaan mislukt",
      status: 500,
    };
  }

  const { data: signed } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 6);

  return {
    bestand: { ...(row as InkomendeFactuurBestand), url: signed?.signedUrl || null },
  };
}

export async function signInkomendeFactuurBestanden(
  sb: SupabaseClient,
  bestanden: InkomendeFactuurBestand[]
): Promise<InkomendeFactuurBestand[]> {
  return Promise.all(
    bestanden.map(async (b) => {
      if (!b.storage_path) return { ...b, url: null };
      const { data } = await sb.storage
        .from(BUCKET)
        .createSignedUrl(b.storage_path, 60 * 60 * 6);
      return { ...b, url: data?.signedUrl || null };
    })
  );
}

export async function downloadInkomendeFactuurBytes(
  sb: SupabaseClient,
  storagePath: string
): Promise<{ bytes: Buffer; contentType: string | null } | { error: string }> {
  const { data, error } = await sb.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    return { error: error?.message || "Download mislukt" };
  }
  const ab = await data.arrayBuffer();
  return {
    bytes: Buffer.from(ab),
    contentType: data.type || null,
  };
}

/** Datum voor boekperiode: factuurdatum → received_at → created_at */
export function inkomendBoekDatum(item: {
  factuurdatum?: string | null;
  received_at?: string | null;
  created_at?: string | null;
}): string {
  if (item.factuurdatum && /^\d{4}-\d{2}-\d{2}/.test(item.factuurdatum)) {
    return item.factuurdatum.slice(0, 10);
  }
  const fallback = item.received_at || item.created_at;
  if (!fallback) return "onbekend";
  try {
    return formatInTimeZone(new Date(fallback), AMSTERDAM_TZ, "yyyy-MM-dd");
  } catch {
    return fallback.slice(0, 10);
  }
}

export type InkomendPeriodeMode = "maand" | "kwartaal" | "jaar";

export function inkomendPeriodeKey(
  ymd: string,
  mode: InkomendPeriodeMode
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "onbekend";
  const y = ymd.slice(0, 4);
  const m = Number(ymd.slice(5, 7));
  if (mode === "jaar") return y;
  if (mode === "kwartaal") {
    const q = Math.ceil(m / 3);
    return `${y}-Q${q}`;
  }
  return ymd.slice(0, 7); // YYYY-MM
}

export function inkomendPeriodeLabel(
  key: string,
  mode: InkomendPeriodeMode
): string {
  if (key === "onbekend") return "Onbekende periode";
  if (mode === "jaar") return key;
  if (mode === "kwartaal") {
    const [y, q] = key.split("-");
    return `${q} ${y}`;
  }
  // YYYY-MM
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  const names = [
    "",
    "januari",
    "februari",
    "maart",
    "april",
    "mei",
    "juni",
    "juli",
    "augustus",
    "september",
    "oktober",
    "november",
    "december",
  ];
  return `${names[m] || m} ${y}`;
}

export type PostmarkInboundAttachment = {
  Name?: string;
  Content?: string;
  ContentType?: string;
  ContentLength?: number;
  ContentID?: string;
};

export type PostmarkInboundPayload = {
  MessageID?: string;
  MessageStream?: string;
  From?: string;
  FromName?: string;
  FromFull?: { Email?: string; Name?: string };
  To?: string;
  OriginalRecipient?: string;
  Subject?: string;
  Date?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  Attachments?: PostmarkInboundAttachment[];
  [key: string]: unknown;
};

export function parsePostmarkFrom(payload: PostmarkInboundPayload): {
  email: string | null;
  name: string | null;
} {
  const email =
    (typeof payload.FromFull?.Email === "string" &&
      payload.FromFull.Email.trim()) ||
    (typeof payload.From === "string"
      ? payload.From.replace(/^.*<([^>]+)>.*$/, "$1").trim()
      : null) ||
    null;
  const name =
    (typeof payload.FromFull?.Name === "string" &&
      payload.FromFull.Name.trim()) ||
    (typeof payload.FromName === "string" && payload.FromName.trim()) ||
    null;
  return { email, name };
}

export function parseReceivedAt(dateHeader: string | null | undefined): string {
  if (!dateHeader?.trim()) return new Date().toISOString();
  const d = new Date(dateHeader);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

/** Strip base64 Content from raw_payload before storing (size). */
export function sanitizePostmarkPayloadForStorage(
  payload: PostmarkInboundPayload
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...payload };
  const attachments = Array.isArray(payload.Attachments)
    ? payload.Attachments.map((a) => ({
        Name: a.Name || null,
        ContentType: a.ContentType || null,
        ContentLength: a.ContentLength ?? null,
        ContentID: a.ContentID || null,
        HasContent: Boolean(a.Content),
      }))
    : [];
  copy.Attachments = attachments;
  return copy;
}

export type InkomendeFactuurWithBestanden = InkomendeFactuur & {
  bestanden?: InkomendeFactuurBestand[];
};
