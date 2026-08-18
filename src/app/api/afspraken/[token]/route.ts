import { NextRequest, NextResponse } from "next/server";
import { addMinutes } from "date-fns";
import { getSupabaseAdmin } from "@/lib/supabase";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { afspraakGeannuleerdAdviseurEmail } from "@/lib/email/templates";
import {
  afspraakBevestigingSequenceEmail,
  afspraakMailVars,
} from "@/lib/email/afspraak-sequence";
import { generateAvailableSlots, AFSPRAAK_DUUR_MINUTEN } from "@/lib/slots";
import { syncLeadNaAfspraak } from "@/lib/afspraak-lead-status";

export const runtime = "nodejs";

/** GET /api/afspraken/[token] — publieke afspraak + slots */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: afspraak, error } = await sb
      .from("afspraken")
      .select(
        "*, leads(naam, email, telefoon, lead_number), adviseurs(naam, email)"
      )
      .eq("manage_token", token)
      .single();

    if (error || !afspraak) {
      return NextResponse.json({ error: "Afspraak niet gevonden" }, { status: 404 });
    }

    const { data: busy } = await sb
      .from("afspraken")
      .select("start_at, end_at")
      .eq("adviseur_id", afspraak.adviseur_id)
      .neq("status", "geannuleerd")
      .neq("id", afspraak.id);

    const slots = generateAvailableSlots({
      busy: busy || [],
    }).map((s) => ({
      start_at: s.start.toISOString(),
      end_at: s.end.toISOString(),
    }));

    return NextResponse.json({ afspraak, slots });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST /api/afspraken/[token] — { action: 'annuleer' | 'verzet', start_at? } */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  let body: { action: "annuleer" | "verzet"; start_at?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: afspraak, error } = await sb
      .from("afspraken")
      .select(
        "*, leads(naam, email, lead_number), adviseurs(naam, email)"
      )
      .eq("manage_token", token)
      .single();

    if (error || !afspraak) {
      return NextResponse.json({ error: "Afspraak niet gevonden" }, { status: 404 });
    }

    if (afspraak.status === "geannuleerd") {
      return NextResponse.json(
        { error: "Deze afspraak is al geannuleerd" },
        { status: 409 }
      );
    }

    if (body.action === "annuleer") {
      const { error: cancelErr } = await sb
        .from("afspraken")
        .update({ status: "geannuleerd", herinnering_verstuurd: true })
        .eq("id", afspraak.id);

      if (cancelErr) {
        return NextResponse.json(
          { error: "Annuleren mislukt", detail: cancelErr.message },
          { status: 500 }
        );
      }

      // Mail naar de adviseur (persoonlijke mail, niet info@)
      const adviseurEmail = afspraak.adviseurs?.email?.trim();
      if (adviseurEmail) {
        try {
          const html = afspraakGeannuleerdAdviseurEmail({
            adviseurNaam: afspraak.adviseurs?.naam || "adviseur",
            klantNaam: afspraak.leads?.naam || "Klant",
            leadNumber: afspraak.leads?.lead_number,
            startAt: afspraak.start_at,
          });
          await sendEmail({
            to: adviseurEmail,
            subject: "Annulering afspraak",
            html,
            tag: "afspraak-geannuleerd-adviseur",
          });
        } catch (mailErr) {
          console.error("Annulering adviseur-mail:", mailErr);
        }
      }

      await syncLeadNaAfspraak(sb, afspraak.lead_id as string);

      return NextResponse.json({ ok: true, status: "geannuleerd" });
    }

    if (body.action === "verzet") {
      if (!body.start_at) {
        return NextResponse.json(
          { error: "start_at is verplicht bij verzetten" },
          { status: 400 }
        );
      }
      const start = new Date(body.start_at);
      const end = addMinutes(start, AFSPRAAK_DUUR_MINUTEN);

      const { data: busy } = await sb
        .from("afspraken")
        .select("id")
        .eq("adviseur_id", afspraak.adviseur_id)
        .neq("status", "geannuleerd")
        .neq("id", afspraak.id)
        .lt("start_at", end.toISOString())
        .gt("end_at", start.toISOString());

      if (busy && busy.length > 0) {
        return NextResponse.json(
          { error: "Dit tijdslot is niet meer beschikbaar" },
          { status: 409 }
        );
      }

      const { data: updated, error: upErr } = await sb
        .from("afspraken")
        .update({
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          status: "verzet",
          herinnering_verstuurd: false,
          bevestiging_verstuurd: false,
          opwarm_verstuurd: false,
        })
        .eq("id", afspraak.id)
        .select(
          "*, leads(naam, email, lead_number, postcode, huisnummer, toevoeging, straat, plaats), adviseurs(naam, email)"
        )
        .single();

      if (upErr || !updated) {
        // Soft-fail zonder opwarm-kolom
        if (upErr?.message?.includes("opwarm_verstuurd")) {
          const retry = await sb
            .from("afspraken")
            .update({
              start_at: start.toISOString(),
              end_at: end.toISOString(),
              status: "verzet",
              herinnering_verstuurd: false,
              bevestiging_verstuurd: false,
            })
            .eq("id", afspraak.id)
            .select(
              "*, leads(naam, email, lead_number, postcode, huisnummer, toevoeging, straat, plaats), adviseurs(naam, email)"
            )
            .single();
          if (retry.error || !retry.data) {
            return NextResponse.json(
              {
                error: "Verzetten mislukt",
                detail: retry.error?.message || upErr.message,
              },
              { status: 500 }
            );
          }
          return await afterVerzet(sb, retry.data);
        }
        return NextResponse.json(
          { error: "Verzetten mislukt", detail: upErr?.message },
          { status: 500 }
        );
      }

      return await afterVerzet(sb, updated);
    }

    return NextResponse.json({ error: "Onbekende action" }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function afterVerzet(
  sb: ReturnType<typeof getSupabaseAdmin>,
  updated: {
    id: string;
    lead_id?: string;
    start_at: string;
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
  }
) {
  if (updated.lead_id) {
    await syncLeadNaAfspraak(sb, updated.lead_id);
  }

  const email = updated.leads?.email;
  const manageUrl = `${appBaseUrl()}/afspraak/${updated.manage_token}`;
  // Bij verzetten: direct nieuwe bevestiging (nieuwe tijd bevestigen)
  if (email) {
    const vars = afspraakMailVars({
      naam: updated.leads?.naam || "klant",
      startAt: updated.start_at,
      adviseurNaam: updated.adviseurs?.naam || "Batterijconcept",
      manageUrl,
      lead: updated.leads,
    });
    const sent = await sendEmail({
      to: email,
      subject: "Afspraak verzet — nieuwe bevestiging",
      html: afspraakBevestigingSequenceEmail(vars),
      tag: "afspraak-verzet",
    });
    if (sent.ok) {
      await sb
        .from("afspraken")
        .update({ bevestiging_verstuurd: true, status: "bevestigd" })
        .eq("id", updated.id);
    }
  }

  return NextResponse.json({ ok: true, afspraak: updated });
}
