/**
 * GET  /api/facturen-inbox — mails + uitgelezen items
 * POST /api/facturen-inbox — IMAP sync
 * PATCH /api/facturen-inbox — velden bijwerken / goedkeuren / afwijzen / betaald
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import {
  buildFacturenInboxEntries,
  listFacturenInboxItems,
  patchFacturenInboxItem,
  type FacturenInboxStatus,
} from "@/lib/facturen-inbox";
import {
  FACTUREN_MAILBOX_EMAIL,
  facturenImapConfigured,
} from "@/lib/facturen-mailbox";
import { syncFacturenMailboxFromImap } from "@/lib/inbox-imap";
import { listInboxMails } from "@/lib/inbox-persist";
import { normalizeRol } from "@/lib/rollen";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

async function requireFinanceAdmin() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return {
      error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }),
    };
  }
  const rol = normalizeRol(session.rol);
  if (rol !== "admin" && rol !== "backoffice") {
    return {
      error: NextResponse.json({ error: "Geen toegang" }, { status: 403 }),
    };
  }
  return { session };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireFinanceAdmin();
    if ("error" in auth && auth.error) return auth.error;

    const sp = req.nextUrl.searchParams;
    const limit = Number(sp.get("limit") || 150) || 150;
    const statusOnly = sp.get("status"); // goedgekeurd | te_goedkeuren | …
    const sb = getSupabaseAdmin();

    // Alleen goedgekeurde/betaalde items (voor Uitbetalingen) — zonder mails
    if (statusOnly === "goedgekeurd" || statusOnly === "betaald") {
      const statuses: FacturenInboxStatus[] =
        statusOnly === "goedgekeurd"
          ? ["goedgekeurd"]
          : ["betaald"];
      // Te betalen + betaald voor creditpanel: status=uitbetalingen
      const { items, hint } = await listFacturenInboxItems(sb, {
        status: statuses,
      });
      return NextResponse.json({ items, hint, count: items.length });
    }
    if (statusOnly === "uitbetalingen") {
      const { items, hint } = await listFacturenInboxItems(sb, {
        status: ["goedgekeurd", "betaald"],
      });
      return NextResponse.json({ items, hint, count: items.length });
    }

    let rows = await listInboxMails(sb, {
      mailbox: "facturen",
      email: FACTUREN_MAILBOX_EMAIL,
      limit,
    });
    if (rows.length === 0) {
      rows = await listInboxMails(sb, {
        email: FACTUREN_MAILBOX_EMAIL,
        limit,
      });
    }

    const { entries, hint } = await buildFacturenInboxEntries(sb, rows);
    return NextResponse.json({
      email: FACTUREN_MAILBOX_EMAIL,
      configured: facturenImapConfigured(),
      entries,
      count: entries.length,
      hint,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Facturen Inbox laden mislukt") },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireFinanceAdmin();
    if ("error" in auth && auth.error) return auth.error;

    if (!facturenImapConfigured()) {
      return NextResponse.json(
        { error: "FACTUREN_IMAP_PASS (en IMAP_HOST) ontbreken in env" },
        { status: 503 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      recent?: boolean;
      max?: number;
    };
    const sb = getSupabaseAdmin();
    const result = await syncFacturenMailboxFromImap(sb, {
      maxMessages: body.max || 40,
      recent: Boolean(body.recent),
    });

    // Direct uitlezen na sync
    let rows = await listInboxMails(sb, {
      mailbox: "facturen",
      email: FACTUREN_MAILBOX_EMAIL,
      limit: 80,
    });
    if (rows.length === 0) {
      rows = await listInboxMails(sb, {
        email: FACTUREN_MAILBOX_EMAIL,
        limit: 80,
      });
    }
    const { entries, hint } = await buildFacturenInboxEntries(sb, rows);

    return NextResponse.json({ ...result, entries, hint });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Facturen IMAP sync mislukt") },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireFinanceAdmin();
    if ("error" in auth && auth.error) return auth.error;

    const body = (await req.json().catch(() => ({}))) as {
      id?: string;
      inbox_mail_id?: string;
      status?: FacturenInboxStatus;
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
    };

    if (!body.id && !body.inbox_mail_id) {
      return NextResponse.json(
        { error: "id of inbox_mail_id verplicht" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const { item } = await patchFacturenInboxItem(sb, {
      id: body.id,
      inbox_mail_id: body.inbox_mail_id,
      adviseurId: auth.session?.adviseurId || null,
      patch: {
        status: body.status,
        factuur_nummer: body.factuur_nummer,
        bedrijfsnaam: body.bedrijfsnaam,
        iban: body.iban,
        bedrag_ex_btw: body.bedrag_ex_btw,
        bedrag_inc_btw: body.bedrag_inc_btw,
        btw_bedrag: body.btw_bedrag,
        vervaldatum: body.vervaldatum,
        factuurdatum: body.factuurdatum,
        referentie: body.referentie,
        notities: body.notities,
      },
    });

    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Bijwerken mislukt") },
      { status: 500 }
    );
  }
}
