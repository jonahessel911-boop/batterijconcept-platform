import { NextRequest, NextResponse } from "next/server";
import { addMinutes } from "date-fns";
import { getSupabaseAdmin } from "@/lib/supabase";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import {
  afspraakBevestigingSequenceEmail,
  afspraakMailVars,
  shouldSendBevestigingNow,
} from "@/lib/email/afspraak-sequence";

export const runtime = "nodejs";

/** GET — lijst afspraken */
export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("afspraken")
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities), adviseurs(naam, email)"
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
        herinnering_verstuurd: false,
        opwarm_verstuurd: false,
      })
      .select(
        "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), adviseurs(naam, email)"
      )
      .single();

    if (error || !afspraak) {
      if (error?.message?.includes("opwarm_verstuurd")) {
        const retry = await sb
          .from("afspraken")
          .insert({
            lead_id: body.lead_id,
            adviseur_id: body.adviseur_id,
            start_at: start.toISOString(),
            end_at: end.toISOString(),
            status: "bevestigd",
            notities: body.notities || null,
            bevestiging_verstuurd: false,
            herinnering_verstuurd: false,
          })
          .select(
            "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), adviseurs(naam, email)"
          )
          .single();
        if (retry.error || !retry.data) {
          return NextResponse.json(
            {
              error: "Afspraak opslaan mislukt",
              detail: retry.error?.message || error.message,
            },
            { status: 500 }
          );
        }
        return await afterCreate(sb, retry.data, body);
      }
      return NextResponse.json(
        { error: "Afspraak opslaan mislukt", detail: error?.message },
        { status: 500 }
      );
    }

    return await afterCreate(sb, afspraak, body);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function afterCreate(
  sb: ReturnType<typeof getSupabaseAdmin>,
  afspraak: {
    id: string;
    start_at: string;
    created_at: string;
    manage_token: string;
    leads?: {
      naam?: string | null;
      email?: string | null;
      postcode?: string | null;
      huisnummer?: string | null;
      toevoeging?: string | null;
      straat?: string | null;
      plaats?: string | null;
    } | null;
    adviseurs?: { naam?: string | null } | null;
  },
  body: { lead_id: string; adviseur_id: string }
) {
  await sb.from("leads").update({ status: "afspraak" }).eq("id", body.lead_id);

  if (body.adviseur_id) {
    await sb
      .from("leads")
      .update({ adviseur_id: body.adviseur_id })
      .eq("id", body.lead_id);
  }

  const manageUrl = `${appBaseUrl()}/afspraak/${afspraak.manage_token}`;
  const email = afspraak.leads?.email;
  const now = new Date();
  const startAt = new Date(afspraak.start_at);
  const createdAt = new Date(afspraak.created_at);

  // Alleen direct bij korte termijn (< 36u); anders wacht cron tot dag erna
  let mailedNow = false;
  if (
    email &&
    shouldSendBevestigingNow({
      now,
      createdAt,
      startAt,
      alreadySent: false,
    })
  ) {
    const vars = afspraakMailVars({
      naam: afspraak.leads?.naam || "klant",
      startAt,
      adviseurNaam: afspraak.adviseurs?.naam || "Batterijconcept",
      manageUrl,
      lead: afspraak.leads,
    });
    const sent = await sendEmail({
      to: email,
      subject: "Afspraak bevestigd — Batterijconcept",
      html: afspraakBevestigingSequenceEmail(vars),
      tag: "afspraak-bevestiging",
    });
    if (sent.ok) {
      await sb
        .from("afspraken")
        .update({ bevestiging_verstuurd: true })
        .eq("id", afspraak.id);
      mailedNow = true;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      afspraak,
      manage_url: manageUrl,
      bevestiging_direct: mailedNow,
    },
    { status: 201 }
  );
}
