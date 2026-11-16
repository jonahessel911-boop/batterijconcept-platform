/**
 * Facturen Inbox: uitgelezen inkomende facturen + goedkeuren → woensdag-uitbetaling.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dichtstbijzijndeBetaalWoensdag,
  extractFactuurFromText,
  type FactuurExtract,
} from "@/lib/facturen-inbox-parse";
import type { InboxMail } from "@/lib/inbox";
import { rowToInboxMail, type InboxDbRow } from "@/lib/inbox-persist";

export type FacturenInboxStatus =
  | "te_goedkeuren"
  | "goedgekeurd"
  | "afgewezen"
  | "betaald";

export type FacturenInboxItem = {
  id: string;
  inbox_mail_id: string;
  status: FacturenInboxStatus;
  factuur_nummer: string | null;
  bedrijfsnaam: string | null;
  iban: string | null;
  bedrag_ex_btw: number | null;
  bedrag_inc_btw: number | null;
  btw_bedrag: number | null;
  vervaldatum: string | null;
  factuurdatum: string | null;
  betaal_woensdag: string | null;
  referentie: string | null;
  extract_raw: Record<string, unknown>;
  goedgekeurd_door: string | null;
  goedgekeurd_op: string | null;
  notities: string | null;
  created_at: string;
  updated_at: string;
};

export type FacturenInboxEntry = {
  mail: InboxMail;
  item: FacturenInboxItem | null;
  extract: FactuurExtract;
  pdfAttachments: NonNullable<InboxMail["attachments"]>;
};

const ITEM_COLS =
  "id, inbox_mail_id, status, factuur_nummer, bedrijfsnaam, iban, bedrag_ex_btw, bedrag_inc_btw, btw_bedrag, vervaldatum, factuurdatum, betaal_woensdag, referentie, extract_raw, goedgekeurd_door, goedgekeurd_op, notities, created_at, updated_at";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractFromMail(mail: InboxMail): FactuurExtract {
  const text = [
    mail.bodyText || "",
    mail.bodyHtml ? stripHtml(mail.bodyHtml) : "",
  ]
    .filter(Boolean)
    .join("\n");
  return extractFactuurFromText(text, {
    subject: mail.subject,
    fromName: mail.fromName,
  });
}

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    /facturen_inbox_items|does not exist|schema cache/i.test(
      error.message || ""
    )
  );
}

export async function listFacturenInboxItems(
  sb: SupabaseClient,
  opts?: { status?: FacturenInboxStatus | FacturenInboxStatus[] | null }
): Promise<{ items: FacturenInboxItem[]; hint?: string }> {
  let query = sb
    .from("facturen_inbox_items")
    .select(ITEM_COLS)
    .order("updated_at", { ascending: false })
    .limit(300);
  const status = opts?.status;
  if (Array.isArray(status) && status.length) {
    query = query.in("status", status);
  } else if (typeof status === "string" && status) {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) {
      return {
        items: [],
        hint: "Run supabase/migrate-facturen-inbox.sql",
      };
    }
    throw error;
  }
  return { items: (data || []) as FacturenInboxItem[] };
}

export async function getFacturenInboxItemByMail(
  sb: SupabaseClient,
  inboxMailId: string
): Promise<FacturenInboxItem | null> {
  const { data, error } = await sb
    .from("facturen_inbox_items")
    .select(ITEM_COLS)
    .eq("inbox_mail_id", inboxMailId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return (data as FacturenInboxItem) || null;
}

function mergeExtractOntoItem(
  extract: FactuurExtract,
  existing: FacturenInboxItem | null
): Partial<FacturenInboxItem> {
  // Bestaande handmatige velden niet overschrijven met null
  const pick = <T>(cur: T | null | undefined, next: T | null): T | null => {
    if (cur != null && cur !== ("" as unknown)) return cur;
    return next;
  };
  return {
    factuur_nummer: pick(existing?.factuur_nummer, extract.factuur_nummer),
    bedrijfsnaam: pick(existing?.bedrijfsnaam, extract.bedrijfsnaam),
    iban: pick(existing?.iban, extract.iban),
    bedrag_ex_btw: pick(existing?.bedrag_ex_btw, extract.bedrag_ex_btw),
    bedrag_inc_btw: pick(existing?.bedrag_inc_btw, extract.bedrag_inc_btw),
    btw_bedrag: pick(existing?.btw_bedrag, extract.btw_bedrag),
    vervaldatum: pick(existing?.vervaldatum, extract.vervaldatum),
    factuurdatum: pick(existing?.factuurdatum, extract.factuurdatum),
    referentie: pick(existing?.referentie, extract.referentie),
    extract_raw: extract as unknown as Record<string, unknown>,
  };
}

/** Zorg dat elke mail een te_goedkeuren-item heeft + uitgelezen velden. */
export async function ensureFacturenInboxItem(
  sb: SupabaseClient,
  mail: InboxMail
): Promise<{ item: FacturenInboxItem | null; hint?: string }> {
  const extract = extractFromMail(mail);
  const existing = await getFacturenInboxItemByMail(sb, mail.id);
  const merged = mergeExtractOntoItem(extract, existing);

  if (existing) {
    // Alleen lege velden aanvullen
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      extract_raw: merged.extract_raw,
    };
    const keys = [
      "factuur_nummer",
      "bedrijfsnaam",
      "iban",
      "bedrag_ex_btw",
      "bedrag_inc_btw",
      "btw_bedrag",
      "vervaldatum",
      "factuurdatum",
      "referentie",
    ] as const;
    for (const k of keys) {
      const cur = existing[k];
      const next = merged[k];
      if ((cur == null || cur === "") && next != null && next !== "") {
        patch[k] = next;
      }
    }
    const { data, error } = await sb
      .from("facturen_inbox_items")
      .update(patch)
      .eq("id", existing.id)
      .select(ITEM_COLS)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) {
        return { item: null, hint: "Run supabase/migrate-facturen-inbox.sql" };
      }
      throw error;
    }
    return { item: (data as FacturenInboxItem) || existing };
  }

  const insert = {
    inbox_mail_id: mail.id,
    status: "te_goedkeuren" as const,
    ...merged,
  };
  const { data, error } = await sb
    .from("facturen_inbox_items")
    .insert(insert)
    .select(ITEM_COLS)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) {
      return { item: null, hint: "Run supabase/migrate-facturen-inbox.sql" };
    }
    if (error.code === "23505") {
      const again = await getFacturenInboxItemByMail(sb, mail.id);
      return { item: again };
    }
    throw error;
  }
  return { item: (data as FacturenInboxItem) || null };
}

export async function buildFacturenInboxEntries(
  sb: SupabaseClient,
  rows: InboxDbRow[]
): Promise<{ entries: FacturenInboxEntry[]; hint?: string }> {
  const entries: FacturenInboxEntry[] = [];
  let hint: string | undefined;
  for (const row of rows) {
    const mail = rowToInboxMail(row);
    const ensured = await ensureFacturenInboxItem(sb, mail);
    if (ensured.hint) hint = ensured.hint;
    const extract = extractFromMail(mail);
    const pdfAttachments = (mail.attachments || []).filter(
      (a) =>
        /pdf/i.test(a.contentType || "") ||
        /\.pdf$/i.test(a.filename || "")
    );
    entries.push({
      mail,
      item: ensured.item,
      extract,
      pdfAttachments,
    });
  }
  return { entries, hint };
}

export type FacturenInboxPatch = {
  factuur_nummer?: string | null;
  bedrijfsnaam?: string | null;
  iban?: string | null;
  bedrag_ex_btw?: number | null;
  bedrag_inc_btw?: number | null;
  btw_bedrag?: number | null;
  vervaldatum?: string | null;
  factuurdatum?: string | null;
  referentie?: string | null;
  notities?: string | null;
  status?: FacturenInboxStatus;
};

export async function patchFacturenInboxItem(
  sb: SupabaseClient,
  opts: {
    id?: string;
    inbox_mail_id?: string;
    patch: FacturenInboxPatch;
    adviseurId?: string | null;
  }
): Promise<{ item: FacturenInboxItem; hint?: string }> {
  let item: FacturenInboxItem | null = null;
  if (opts.id) {
    const { data, error } = await sb
      .from("facturen_inbox_items")
      .select(ITEM_COLS)
      .eq("id", opts.id)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) {
        throw new Error("Run supabase/migrate-facturen-inbox.sql");
      }
      throw error;
    }
    item = (data as FacturenInboxItem) || null;
  } else if (opts.inbox_mail_id) {
    item = await getFacturenInboxItemByMail(sb, opts.inbox_mail_id);
  }
  if (!item) throw new Error("Factuur-item niet gevonden");

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  const p = opts.patch;
  for (const key of [
    "factuur_nummer",
    "bedrijfsnaam",
    "iban",
    "bedrag_ex_btw",
    "bedrag_inc_btw",
    "btw_bedrag",
    "vervaldatum",
    "factuurdatum",
    "referentie",
    "notities",
  ] as const) {
    if (key in p) patch[key] = p[key];
  }

  if (p.status) {
    patch.status = p.status;
    if (p.status === "goedgekeurd") {
      patch.goedgekeurd_op = new Date().toISOString();
      patch.goedgekeurd_door = opts.adviseurId || null;
      patch.betaal_woensdag = dichtstbijzijndeBetaalWoensdag();
    }
    if (p.status === "betaald" && !item.goedgekeurd_op) {
      patch.goedgekeurd_op = new Date().toISOString();
    }
  }

  const { data, error } = await sb
    .from("facturen_inbox_items")
    .update(patch)
    .eq("id", item.id)
    .select(ITEM_COLS)
    .maybeSingle();
  if (error) throw error;
  const updated = data as FacturenInboxItem;

  if (p.status === "goedgekeurd" || p.status === "betaald") {
    await upsertFinanceFromFacturenInbox(sb, updated);
  }

  return { item: updated };
}

async function upsertFinanceFromFacturenInbox(
  sb: SupabaseClient,
  item: FacturenInboxItem
) {
  const bedragInc =
    Number(item.bedrag_inc_btw) ||
    (Number(item.bedrag_ex_btw) || 0) * 1.21 ||
    0;
  const status =
    item.status === "betaald"
      ? "betaald"
      : item.status === "goedgekeurd"
        ? "goedgekeurd"
        : "te_goedkeuren";
  const row = {
    categorie: "overig" as const,
    bron: "facturen_mailbox" as const,
    bron_id: item.id,
    begunstigde: item.bedrijfsnaam || "Crediteur",
    iban: item.iban,
    omschrijving: [
      "Inkomende factuur",
      item.factuur_nummer ? `nr ${item.factuur_nummer}` : null,
      item.betaal_woensdag ? `wo ${item.betaal_woensdag}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    referentie: item.referentie || item.factuur_nummer,
    bedrag_ex_btw: item.bedrag_ex_btw,
    bedrag_inc_btw: bedragInc,
    status,
    goedgekeurd_op: item.goedgekeurd_op,
    betaald_op: item.status === "betaald" ? new Date().toISOString() : null,
    meta: {
      betaal_woensdag: item.betaal_woensdag,
      inbox_mail_id: item.inbox_mail_id,
      vervaldatum: item.vervaldatum,
    },
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await sb
    .from("finance_uitbetalingen")
    .select("id")
    .eq("bron", "facturen_mailbox")
    .eq("bron_id", item.id)
    .maybeSingle();

  if (existing?.id) {
    await sb.from("finance_uitbetalingen").update(row).eq("id", existing.id);
  } else {
    const { error } = await sb.from("finance_uitbetalingen").insert(row);
    // bron-check constraint mogelijk nog zonder facturen_mailbox
    if (error && /bron|check|23514/i.test(error.message || "")) {
      await sb.from("finance_uitbetalingen").insert({
        ...row,
        bron: "manual",
        meta: { ...row.meta, intended_bron: "facturen_mailbox" },
      });
    } else if (error && !/42P01|does not exist/i.test(error.message || "")) {
      console.error("finance_uitbetalingen upsert:", error.message);
    }
  }
}
