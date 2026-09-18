import { NextRequest, NextResponse } from "next/server";
import { addMinutes, differenceInMinutes } from "date-fns";
import { getSupabaseAdmin } from "@/lib/supabase";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import {
  afspraakBevestigingSequenceEmail,
  afspraakMailVars,
} from "@/lib/email/afspraak-sequence";
import { afspraakGeannuleerdKlantEmail } from "@/lib/email/templates";
import { syncLeadNaAfspraak } from "@/lib/afspraak-lead-status";
import { hasBlockingOverlap } from "@/lib/afspraak-busy";
import {
  afspraakBlokkeertAgenda,
  afspraakDuurMinuten,
  afspraakStuurtMail,
} from "@/lib/afspraak-soort";
import { planAfspraak } from "@/lib/plan-afspraak";

export const runtime = "nodejs";

/** GET — lijst afspraken */
export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("afspraken")
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats, status), adviseurs(naam, email)"
      )
      .order("start_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ afspraken: data || [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH — bevestigingsmail / verzetten / annuleren (admin) */
export async function PATCH(req: NextRequest) {
  let body: {
    id?: string;
    action?: string;
    start_at?: string;
    mail_klant?: boolean;
    notitie?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const actions = [
    "send_bevestiging",
    "verzet",
    "verwijder",
    "annuleer",
    "verwijder_definitief",
  ];
  if (!body.id || !body.action || !actions.includes(body.action)) {
    return NextResponse.json(
      {
        error:
          "id en action (send_bevestiging | verzet | annuleer | verwijder_definitief) zijn verplicht",
      },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: afspraak, error } = await sb
      .from("afspraken")
      .select(
        "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), adviseurs(naam, email)"
      )
      .eq("id", body.id)
      .single();

    if (error || !afspraak) {
      return NextResponse.json(
        { error: "Afspraak niet gevonden" },
        { status: 404 }
      );
    }

    const lead = Array.isArray(afspraak.leads)
      ? afspraak.leads[0]
      : afspraak.leads;
    const adviseur = Array.isArray(afspraak.adviseurs)
      ? afspraak.adviseurs[0]
      : afspraak.adviseurs;

    if (body.action === "verwijder_definitief") {
      const leadId = afspraak.lead_id as string;
      const { error: delErr } = await sb
        .from("afspraken")
        .delete()
        .eq("id", afspraak.id);
      if (delErr) {
        return NextResponse.json(
          { error: "Verwijderen mislukt", detail: delErr.message },
          { status: 500 }
        );
      }
      await syncLeadNaAfspraak(sb, leadId);
      return NextResponse.json({ ok: true, deleted: true, id: afspraak.id });
    }

    if (body.action === "verwijder" || body.action === "annuleer") {
      const magMailen = afspraakStuurtMail(afspraak.soort);
      if (magMailen && typeof body.mail_klant !== "boolean") {
        return NextResponse.json(
          { error: "Kies of de klant een mail moet krijgen (ja/nee)" },
          { status: 400 }
        );
      }
      const annuleerNotitie = body.notitie?.trim() || "";
      if (annuleerNotitie.length < 3) {
        return NextResponse.json(
          { error: "Vul een notitie in bij annuleren (min. 3 tekens)" },
          { status: 400 }
        );
      }
      if (afspraak.status === "geannuleerd") {
        return NextResponse.json(
          { error: "Deze afspraak is al geannuleerd" },
          { status: 400 }
        );
      }

      const bestaande = (afspraak.notities as string | null)?.trim() || "";
      const samengevoegd = bestaande
        ? `${bestaande}\n\nAnnulering (CRM): ${annuleerNotitie}`
        : `Annulering (CRM): ${annuleerNotitie}`;

      const { data: cancelledRow, error: cancelErr } = await sb
        .from("afspraken")
        .update({
          status: "geannuleerd",
          // Cron stuurt herinnering/opwarm alleen bij actieve status —
          // extra vlag zodat een eventuele inhaler ook stopt.
          herinnering_verstuurd: true,
          notities: samengevoegd,
        })
        .eq("id", afspraak.id)
        .select(
          "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), adviseurs(naam, email)"
        )
        .single();

      if (cancelErr || !cancelledRow) {
        return NextResponse.json(
          { error: "Annuleren mislukt", detail: cancelErr?.message },
          { status: 500 }
        );
      }

      let mailSent = false;
      const email = lead?.email?.trim();
      if (magMailen && body.mail_klant && email) {
        const sent = await sendEmail({
          to: email,
          subject: "Afspraak geannuleerd — Batterijconcept",
          html: afspraakGeannuleerdKlantEmail({
            naam: lead?.naam || "klant",
            startAt: afspraak.start_at,
          }),
          tag: "afspraak-verwijderd-klant",
        });
        mailSent = sent.ok;
      }

      await syncLeadNaAfspraak(sb, afspraak.lead_id as string);

      return NextResponse.json({
        ok: true,
        cancelled: true,
        mail_sent: mailSent,
        afspraak: cancelledRow,
      });
    }

    if (afspraak.status === "geannuleerd") {
      return NextResponse.json(
        { error: "Deze afspraak is al geannuleerd" },
        { status: 400 }
      );
    }

    if (body.action === "verzet") {
      const magMailen = afspraakStuurtMail(afspraak.soort);
      if (magMailen && typeof body.mail_klant !== "boolean") {
        return NextResponse.json(
          { error: "Kies of de klant een mail moet krijgen (ja/nee)" },
          { status: 400 }
        );
      }
      if (!body.start_at) {
        return NextResponse.json(
          { error: "start_at is verplicht bij verzetten" },
          { status: 400 }
        );
      }
      const start = new Date(body.start_at);
      if (Number.isNaN(start.getTime())) {
        return NextResponse.json({ error: "Ongeldige start_at" }, { status: 400 });
      }
      const bestaandeDuur = differenceInMinutes(
        new Date(afspraak.end_at),
        new Date(afspraak.start_at)
      );
      const duurMin =
        bestaandeDuur > 0
          ? bestaandeDuur
          : afspraakDuurMinuten(afspraak.soort);
      const end = addMinutes(start, duurMin);

      if (afspraakBlokkeertAgenda(afspraak.soort)) {
        const overlap = await hasBlockingOverlap(sb, {
          adviseurId: afspraak.adviseur_id,
          start,
          end,
          excludeId: afspraak.id,
        });
        if (overlap) {
          return NextResponse.json(
            { error: "Dit tijdslot is al bezet voor deze adviseur" },
            { status: 409 }
          );
        }
      }

      const updateRow = magMailen
        ? {
            start_at: start.toISOString(),
            end_at: end.toISOString(),
            status: "verzet" as const,
            herinnering_verstuurd: false,
            bevestiging_verstuurd: false,
            opwarm_verstuurd: false,
          }
        : {
            start_at: start.toISOString(),
            end_at: end.toISOString(),
            status: "verzet" as const,
          };

      let { data: updated, error: upErr } = await sb
        .from("afspraken")
        .update(updateRow)
        .eq("id", afspraak.id)
        .select(
          "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), adviseurs(naam, email)"
        )
        .single();

      if (upErr?.message?.includes("opwarm_verstuurd")) {
        const { opwarm_verstuurd: _, ...withoutOpwarm } = updateRow;
        const retry = await sb
          .from("afspraken")
          .update(withoutOpwarm)
          .eq("id", afspraak.id)
          .select(
            "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), adviseurs(naam, email)"
          )
          .single();
        updated = retry.data;
        upErr = retry.error;
      }

      if (upErr || !updated) {
        return NextResponse.json(
          { error: "Verzetten mislukt", detail: upErr?.message },
          { status: 500 }
        );
      }

      await syncLeadNaAfspraak(sb, afspraak.lead_id as string);

      const email = lead?.email?.trim();
      let mailSent = false;
      if (magMailen && body.mail_klant && email && updated.manage_token) {
        const vars = afspraakMailVars({
          naam: lead?.naam || "klant",
          startAt: updated.start_at,
          adviseurNaam: adviseur?.naam || "Batterijconcept",
          manageUrl: `${appBaseUrl()}/afspraak/${updated.manage_token}`,
          lead,
        });
        const sent = await sendEmail({
          to: email,
          subject: "Afspraak verzet — nieuwe bevestiging",
          html: afspraakBevestigingSequenceEmail(vars),
          tag: "afspraak-verzet",
        });
        mailSent = sent.ok;
        if (sent.ok) {
          await sb
            .from("afspraken")
            .update({ bevestiging_verstuurd: true, status: "bevestigd" })
            .eq("id", updated.id);
          updated = {
            ...updated,
            bevestiging_verstuurd: true,
            status: "bevestigd",
          };
        }
      }

      return NextResponse.json({
        ok: true,
        afspraak: updated,
        mail_sent: mailSent,
      });
    }

    if (!afspraakStuurtMail(afspraak.soort)) {
      return NextResponse.json(
        { error: "Klantmail gaat alleen bij een eerste afspraak (nieuw)" },
        { status: 400 }
      );
    }

    const email = lead?.email?.trim();
    if (!email) {
      return NextResponse.json(
        { error: "Lead heeft geen e-mailadres" },
        { status: 400 }
      );
    }
    if (!afspraak.manage_token) {
      return NextResponse.json(
        { error: "Afspraak mist manage-token" },
        { status: 400 }
      );
    }

    const startAt = new Date(afspraak.start_at);
    const manageUrl = `${appBaseUrl()}/afspraak/${afspraak.manage_token}`;
    const vars = afspraakMailVars({
      naam: lead?.naam || "klant",
      startAt,
      adviseurNaam: adviseur?.naam || "Batterijconcept",
      manageUrl,
      lead,
    });

    const sent = await sendEmail({
      to: email,
      subject: "Afspraak bevestigd — Batterijconcept",
      html: afspraakBevestigingSequenceEmail(vars),
      tag: "afspraak-bevestiging",
    });

    if (!sent.ok) {
      return NextResponse.json(
        { error: sent.error || "Mail versturen mislukt" },
        { status: 502 }
      );
    }

    await sb
      .from("afspraken")
      .update({ bevestiging_verstuurd: true })
      .eq("id", afspraak.id);

    return NextResponse.json({
      ok: true,
      bevestiging_verstuurd: true,
      to: email,
    });
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
    partner_aanwezig?: boolean;
    andere_offertes_gehad?: boolean;
    soort?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const result = await planAfspraak(sb, body);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status }
      );
    }
    return NextResponse.json(
      {
        ok: true,
        afspraak: result.afspraak,
        manage_url: result.manage_url,
        bevestiging_direct: result.bevestiging_direct,
        bevestiging_error: result.bevestiging_error,
      },
      { status: 201 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
