import { NextRequest, NextResponse } from "next/server";
import { addMinutes } from "date-fns";
import { getSupabaseAdmin } from "@/lib/supabase";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { afspraakBevestigingEmail } from "@/lib/email/templates";

export const runtime = "nodejs";

/** GET — lijst afspraken */
export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("afspraken")
      .select(
        "*, leads(naam, email, telefoon, lead_number), adviseurs(naam, email)"
      )
      .order("start_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ afspraken: data || [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST — nieuwe afspraak plannen */
export async function POST(req: NextRequest) {
  let body: {
    lead_id: string;
    adviseur_id: string;
    start_at: string;
    notities?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.lead_id || !body.adviseur_id || !body.start_at) {
    return NextResponse.json(
      { error: "lead_id, adviseur_id en start_at zijn verplicht" },
      { status: 400 }
    );
  }

  const start = new Date(body.start_at);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "Ongeldige start_at" }, { status: 400 });
  }
  const end = addMinutes(start, 60);

  try {
    const sb = getSupabaseAdmin();

    // Conflict check
    const { data: busy } = await sb
      .from("afspraken")
      .select("id, start_at, end_at")
      .eq("adviseur_id", body.adviseur_id)
      .neq("status", "geannuleerd")
      .lt("start_at", end.toISOString())
      .gt("end_at", start.toISOString());

    if (busy && busy.length > 0) {
      return NextResponse.json(
        { error: "Dit tijdslot is al bezet voor deze adviseur" },
        { status: 409 }
      );
    }

    const { data: afspraak, error } = await sb
      .from("afspraken")
      .insert({
        lead_id: body.lead_id,
        adviseur_id: body.adviseur_id,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        status: "bevestigd",
        notities: body.notities || null,
        bevestiging_verstuurd: false,
      })
      .select(
        "*, leads(naam, email, telefoon, lead_number), adviseurs(naam, email)"
      )
      .single();

    if (error || !afspraak) {
      return NextResponse.json(
        { error: "Afspraak opslaan mislukt", detail: error?.message },
        { status: 500 }
      );
    }

    await sb
      .from("leads")
      .update({ status: "afspraak" })
      .eq("id", body.lead_id);

    const email = afspraak.leads?.email;
    const manageUrl = `${appBaseUrl()}/afspraak/${afspraak.manage_token}`;

    if (email) {
      const html = afspraakBevestigingEmail({
        naam: afspraak.leads?.naam || "klant",
        startAt: afspraak.start_at,
        adviseurNaam: afspraak.adviseurs?.naam || "Batterijconcept",
        manageUrl,
      });
      const sent = await sendEmail({
        to: email,
        subject: "Afspraak bevestigd — Batterijconcept",
        html,
        tag: "afspraak-bevestiging",
      });
      if (sent.ok) {
        await sb
          .from("afspraken")
          .update({ bevestiging_verstuurd: true })
          .eq("id", afspraak.id);
      }
    }

    return NextResponse.json(
      { ok: true, afspraak, manage_url: manageUrl },
      { status: 201 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
