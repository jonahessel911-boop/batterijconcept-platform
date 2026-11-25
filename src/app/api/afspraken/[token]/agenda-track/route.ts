import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  isAgendaProvider,
  trackAgendaAdd,
  trackAgendaOpen,
  type AgendaProvider,
} from "@/lib/afspraak-opvolging/agenda-track";

export const dynamic = "force-dynamic";

type Body = {
  event?: "open" | "add";
  provider?: AgendaProvider;
};

/**
 * Publiek: first-touch tracking voor agenda-landing en provider-keuze.
 * POST { event: "open" | "add", provider?: ... }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token) {
      return NextResponse.json({ error: "Token ontbreekt" }, { status: 400 });
    }

    let body: Body = {};
    try {
      body = (await request.json()) as Body;
    } catch {
      return NextResponse.json({ error: "Ongeldige body" }, { status: 400 });
    }

    if (body.event !== "open" && body.event !== "add") {
      return NextResponse.json(
        { error: "event moet open of add zijn" },
        { status: 400 }
      );
    }

    if (body.event === "add" && !isAgendaProvider(body.provider)) {
      return NextResponse.json(
        { error: "provider ontbreekt of ongeldig" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data: afspraak, error } = await sb
      .from("afspraken")
      .select(
        "id, agenda_link_opened_at, agenda_added_at, agenda_provider"
      )
      .eq("manage_token", token)
      .maybeSingle();

    if (error) {
      if (
        error.message?.includes("agenda_") ||
        error.code === "42703" ||
        error.code === "PGRST204"
      ) {
        return NextResponse.json({ ok: true, tracked: false, skipped: true });
      }
      throw new Error(error.message);
    }
    if (!afspraak) {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }

    let tracked = false;
    if (body.event === "open") {
      tracked = await trackAgendaOpen(sb, afspraak.id, afspraak);
    } else if (body.provider) {
      tracked = await trackAgendaAdd(
        sb,
        afspraak.id,
        body.provider,
        afspraak
      );
    }

    return NextResponse.json({ ok: true, tracked });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
