import { NextRequest, NextResponse } from "next/server";
import { addMinutes, differenceInMinutes } from "date-fns";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { replyToForAfspraak } from "@/lib/email/adviseur-reply-to";
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
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";
import { appendVerzetNotitie } from "@/lib/format";

export const runtime = "nodejs";

/**
 * Wie plant de afspraak in (bel-credit).
 * Altijd de ingelogde medewerker die POST /api/afspraken doet — niet claim/Tarik.
 */
function resolveIngeplandDoorId(
  session: { adviseurId: string } | null
): string | null {
  return session?.adviseurId?.trim() || null;
}

/** GET — lijst afspraken */
export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("afspraken")
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats, status), adviseurs!adviseur_id(naam, email)"
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
    notities?: string | null;
    adviseur_id?: string;
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
    "send_annuleringsmail",
    "update_notities",
    "overzetten_adviseur",
  ];
  if (!body.id || !body.action || !actions.includes(body.action)) {
    return NextResponse.json(
      {
        error:
          "id en action (send_bevestiging | verzet | annuleer | verwijder_definitief | send_annuleringsmail | update_notities | overzetten_adviseur) zijn verplicht",
      },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: afspraak, error } = await sb
      .from("afspraken")
      .select(
        "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), adviseurs!adviseur_id(naam, email)"
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

    if (body.action === "update_notities") {
      const prevNotities = ((afspraak.notities as string | null) || "").trim();
      const notities =
        typeof body.notities === "string"
          ? body.notities.trim() || null
          : body.notities === null
            ? null
            : (afspraak.notities as string | null);
      const nextNotities = (notities || "").trim();

      const { data: updated, error: updErr } = await sb
        .from("afspraken")
        .update({ notities })
        .eq("id", afspraak.id)
        .select(
          "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats, status), adviseurs!adviseur_id(naam, email)"
        )
        .single();

      if (updErr || !updated) {
        return NextResponse.json(
          { error: "Notitie opslaan mislukt", detail: updErr?.message },
          { status: 500 }
        );
      }

      // Nieuwe/gewijzigde afspraaknotitie ook op de lead zetten.
      if (nextNotities && nextNotities !== prevNotities) {
        const leadId = afspraak.lead_id as string;
        const { appendStampedNotitie } = await import("@/lib/lead-notitie");
        const { data: leadRow } = await sb
          .from("leads")
          .select("notities")
          .eq("id", leadId)
          .maybeSingle();
        const merged = appendStampedNotitie(
          (leadRow as { notities?: string | null } | null)?.notities,
          `Afspraaknotitie: ${nextNotities}`
        );
        await sb.from("leads").update({ notities: merged }).eq("id", leadId);
      }

      return NextResponse.json({ ok: true, afspraak: updated });
    }

    if (body.action === "overzetten_adviseur") {
      const newAdviseurId =
        typeof body.adviseur_id === "string" ? body.adviseur_id.trim() : "";
      if (!newAdviseurId) {
        return NextResponse.json(
          { error: "adviseur_id is verplicht" },
          { status: 400 }
        );
      }
      if (newAdviseurId === afspraak.adviseur_id) {
        return NextResponse.json(
          { error: "Kies een andere adviseur dan de huidige" },
          { status: 400 }
        );
      }

      const { data: nieuweAdviseur, error: advErr } = await sb
        .from("adviseurs")
        .select("id, naam, email, actief")
        .eq("id", newAdviseurId)
        .maybeSingle();
      if (advErr || !nieuweAdviseur) {
        return NextResponse.json(
          { error: "Adviseur niet gevonden" },
          { status: 404 }
        );
      }
      if (nieuweAdviseur.actief === false) {
        return NextResponse.json(
          { error: "Deze adviseur is niet actief" },
          { status: 400 }
        );
      }

      // Alleen intern: geen mail, geen overlap-check (mag over andere afspraken).
      const { data: updated, error: upErr } = await sb
        .from("afspraken")
        .update({ adviseur_id: newAdviseurId })
        .eq("id", afspraak.id)
        .select(
          "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats, status, adviseur_id), adviseurs!adviseur_id(naam, email)"
        )
        .single();

      if (upErr || !updated) {
        return NextResponse.json(
          { error: "Overzetten mislukt", detail: upErr?.message },
          { status: 500 }
        );
      }

      const leadId = afspraak.lead_id as string;
      // Lead + alle open agenda-afspraken van deze lead meenemen
      await sb
        .from("leads")
        .update({ adviseur_id: newAdviseurId })
        .eq("id", leadId);
      await sb
        .from("afspraken")
        .update({ adviseur_id: newAdviseurId })
        .eq("lead_id", leadId)
        .neq("status", "geannuleerd");

      const oudNaam =
        (adviseur as { naam?: string | null } | null)?.naam?.trim() ||
        "Onbekend";
      const nieuwNaam =
        (nieuweAdviseur.naam as string | null)?.trim() || "Onbekend";
      try {
        const { logLeadEvent } = await import("@/lib/lead-events");
        await logLeadEvent({
          leadId,
          soort: "afspraak",
          titel: `Lead overgezet: ${oudNaam} → ${nieuwNaam}`,
          detail: "Intern — agenda + lead; geen mail naar klant",
        });
      } catch {
        /* best-effort */
      }

      return NextResponse.json({
        ok: true,
        afspraak: updated,
        overgezet: true,
      });
    }

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

    if (body.action === "send_annuleringsmail") {
      if (afspraak.status !== "geannuleerd") {
        return NextResponse.json(
          { error: "Annuleringsmail alleen bij geannuleerde afspraak" },
          { status: 400 }
        );
      }
      if (!afspraakStuurtMail(afspraak.soort)) {
        return NextResponse.json(
          { error: "Dit type afspraak krijgt geen klantmail" },
          { status: 400 }
        );
      }
      const email = lead?.email?.trim();
      if (!email) {
        return NextResponse.json(
          { error: "Geen e-mailadres op de lead" },
          { status: 400 }
        );
      }
      const sent = await sendEmail({
        to: email,
        subject: "Afspraak geannuleerd — Batterijconcept",
        html: afspraakGeannuleerdKlantEmail({
          naam: lead?.naam || "klant",
          startAt: afspraak.start_at,
        }),
        tag: "afspraak-verwijderd-klant",
        replyTo: await replyToForAfspraak(sb, {
          adviseurId: afspraak.adviseur_id,
          leadId: afspraak.lead_id,
          adviseurJoin: adviseur,
        }),
      });
      if (!sent.ok) {
        return NextResponse.json(
          { error: sent.error || "Mailen mislukt", sent: false },
          { status: 502 }
        );
      }
      return NextResponse.json({ ok: true, sent: true, to: email });
    }

    if (body.action === "verwijder" || body.action === "annuleer") {
      // Geen automatische klantmail — knop na annuleren.
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

      const jar = await cookies();
      const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
      let geannuleerdDoorNaam =
        (adviseur as { naam?: string | null } | null)?.naam?.trim() || "";
      if (session?.adviseurId) {
        const { data: actor } = await sb
          .from("adviseurs")
          .select("naam")
          .eq("id", session.adviseurId)
          .maybeSingle();
        if (actor?.naam?.trim()) geannuleerdDoorNaam = actor.naam.trim();
      }
      const annuleerPrefix = geannuleerdDoorNaam
        ? `Annulering (CRM) door ${geannuleerdDoorNaam}:`
        : "Annulering (CRM):";
      const bestaande = (afspraak.notities as string | null)?.trim() || "";
      const samengevoegd = bestaande
        ? `${bestaande}\n\n${annuleerPrefix} ${annuleerNotitie}`
        : `${annuleerPrefix} ${annuleerNotitie}`;

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
          "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), adviseurs!adviseur_id(naam, email)"
        )
        .single();

      if (cancelErr || !cancelledRow) {
        return NextResponse.json(
          { error: "Annuleren mislukt", detail: cancelErr?.message },
          { status: 500 }
        );
      }

      await syncLeadNaAfspraak(sb, afspraak.lead_id as string);

      return NextResponse.json({
        ok: true,
        cancelled: true,
        mail_sent: false,
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

      const notities = appendVerzetNotitie(
        afspraak.notities as string | null,
        afspraak.start_at
      );
      // Alleen op de nieuwe datum tonen (geen aparte "verzet"-status/strike).
      // Vorige moment staat in de notitie.
      const updateRow = magMailen
        ? {
            start_at: start.toISOString(),
            end_at: end.toISOString(),
            status: "gepland" as const,
            notities,
            herinnering_verstuurd: false,
            bevestiging_verstuurd: false,
            opwarm_verstuurd: false,
          }
        : {
            start_at: start.toISOString(),
            end_at: end.toISOString(),
            status: "gepland" as const,
            notities,
          };

      let { data: updated, error: upErr } = await sb
        .from("afspraken")
        .update(updateRow)
        .eq("id", afspraak.id)
        .select(
          "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), adviseurs!adviseur_id(naam, email)"
        )
        .single();

      if (upErr?.message?.includes("opwarm_verstuurd")) {
        const { opwarm_verstuurd: _, ...withoutOpwarm } = updateRow;
        const retry = await sb
          .from("afspraken")
          .update(withoutOpwarm)
          .eq("id", afspraak.id)
          .select(
            "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), adviseurs!adviseur_id(naam, email)"
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
          replyTo: await replyToForAfspraak(sb, {
            adviseurId: afspraak.adviseur_id,
            leadId: afspraak.lead_id,
            adviseurJoin: adviseur,
          }),
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
      replyTo: await replyToForAfspraak(sb, {
        adviseurId: afspraak.adviseur_id,
        leadId: afspraak.lead_id,
        adviseurJoin: adviseur,
      }),
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
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    // Adviseur: huisbezoek/vervolg alleen eigen agenda.
    // Terugbel (bel/warme_bel) mag wél aan callcenter/backoffice/zichzelf.
    if (session && normalizeRol(session.rol) === "adviseur") {
      const soortNorm = (body.soort || "nieuw").trim();
      const isTerugbel =
        soortNorm === "bel" || soortNorm === "warme_bel";
      if (!isTerugbel) {
        if (
          body.adviseur_id &&
          body.adviseur_id !== session.adviseurId
        ) {
          return NextResponse.json(
            { error: "Je kunt alleen in je eigen agenda plannen" },
            { status: 403 }
          );
        }
        body.adviseur_id = session.adviseurId;
      } else if (!body.adviseur_id) {
        body.adviseur_id = session.adviseurId;
      }
    }

    const sb = getSupabaseAdmin();
    const ingeplandDoorId = resolveIngeplandDoorId(
      session ? { adviseurId: session.adviseurId } : null
    );
    const result = await planAfspraak(sb, {
      ...body,
      ingepland_door_id: ingeplandDoorId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status }
      );
    }

    // Lead-credit = wie net heeft ingepland (sessie)
    if (ingeplandDoorId && body.lead_id) {
      await sb
        .from("leads")
        .update({
          laatst_gebeld_door: ingeplandDoorId,
          laatst_gebeld_at: new Date().toISOString(),
        })
        .eq("id", body.lead_id);
    }

    return NextResponse.json(
      {
        ok: true,
        afspraak: result.afspraak,
        manage_url: result.manage_url,
        bevestiging_direct: result.bevestiging_direct,
        bevestiging_error: result.bevestiging_error,
        ingepland_door_id: ingeplandDoorId,
      },
      { status: 201 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
