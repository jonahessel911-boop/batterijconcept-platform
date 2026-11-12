import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { sendEmail } from "@/lib/email/postmark";
import { INFO_REPLY_TO } from "@/lib/email/adviseur-reply-to";
import { klantContactEmail } from "@/lib/email/templates";
import { logLeadEvent } from "@/lib/lead-events";
import { adresRegel, formatDateTimeNl } from "@/lib/format";
import {
  isWarmtefondsPortalProject,
  resolveWarmtefondsOperator,
} from "@/lib/warmtefonds-portal";

export const runtime = "nodejs";

function vul(tekst: string, vars: Record<string, string>): string {
  return tekst.replace(
    /\{(voornaam|naam|project|afspraak|adres|warmtefonds)\}/gi,
    (_, key: string) => vars[key.toLowerCase()] ?? ""
  );
}

/** POST /api/warmtefonds/[token]/orders/[projectId]/mail */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; projectId: string }> }
) {
  const { token, projectId } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json({ error: "Portaal niet gevonden" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      to?: string;
      subject?: string;
      bericht?: string;
    };
    const subjectIn = body.subject?.trim() || "";
    const berichtIn = body.bericht?.trim() || "";
    if (!subjectIn) {
      return NextResponse.json({ error: "Onderwerp is verplicht" }, { status: 400 });
    }
    if (!berichtIn) {
      return NextResponse.json({ error: "Bericht is verplicht" }, { status: 400 });
    }

    const { data: project, error } = await sb
      .from("projecten")
      .select(
        "id, project_nummer, titel, status, betaalwijze, financiering_status, lead_id, warmtefonds_afspraak_at, warmtefonds_contact_pogingen, leads(id, naam, email, straat, huisnummer, toevoeging, postcode, plaats)"
      )
      .eq("id", projectId)
      .maybeSingle();
    if (error || !project || !isWarmtefondsPortalProject(project)) {
      return NextResponse.json({ error: "Aanvraag niet gevonden" }, { status: 404 });
    }

    const leadRaw = project.leads as
      | {
          id?: string;
          naam?: string | null;
          email?: string | null;
          straat?: string | null;
          huisnummer?: string | null;
          toevoeging?: string | null;
          postcode?: string | null;
          plaats?: string | null;
        }
      | {
          id?: string;
          naam?: string | null;
          email?: string | null;
          straat?: string | null;
          huisnummer?: string | null;
          toevoeging?: string | null;
          postcode?: string | null;
          plaats?: string | null;
        }[]
      | null;
    const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
    const to = (body.to?.trim() || lead?.email?.trim() || "").trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return NextResponse.json({ error: "Ongeldig e-mailadres" }, { status: 400 });
    }

    const naam = lead?.naam?.trim() || project.titel?.trim() || "klant";
    const adres = lead ? adresRegel(lead) : "";
    const vars: Record<string, string> = {
      voornaam: naam.split(/\s+/)[0] || naam,
      naam,
      project: project.project_nummer || "",
      afspraak: project.warmtefonds_afspraak_at
        ? formatDateTimeNl(project.warmtefonds_afspraak_at)
        : "",
      adres: adres === "—" ? "" : adres,
      warmtefonds: "",
    };
    const subject = vul(subjectIn, vars);
    const bericht = vul(berichtIn, vars);
    const html = klantContactEmail({
      klantNaam: naam,
      bericht,
      medewerkerNaam: operator.naam,
    });
    const result = await sendEmail({
      to,
      subject,
      html,
      tag: "warmtefonds-contact",
      replyTo: INFO_REPLY_TO,
      bcc:
        to.toLowerCase() === "info@batterijconcept.nl"
          ? null
          : "info@batterijconcept.nl",
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Mail versturen mislukt", sent: false },
        { status: 502 }
      );
    }

    // Mail verstuurd → markeer contact (status + teller als Contact-knop dat nog niet deed)
    const curFs = project.financiering_status as string | null;
    const early =
      !curFs ||
      curFs === "doorgestuurd_naar_edwin" ||
      curFs === "documenten_aanleveren" ||
      curFs === "contact_verstuurd" ||
      curFs === "afspraak_ingepland";
    const prevPogingen = Number(
      (project as { warmtefonds_contact_pogingen?: number | null })
        .warmtefonds_contact_pogingen || 0
    );
    const projectPatch: Record<string, unknown> = {};
    if (early) projectPatch.financiering_status = "contact_verstuurd";
    // Alleen +1 als nog geen poging geregistreerd (anders deed Contact-knop dat al)
    if (!Number.isFinite(prevPogingen) || prevPogingen < 1) {
      projectPatch.warmtefonds_contact_pogingen = 1;
    }
    if (Object.keys(projectPatch).length > 0) {
      const { error: patchErr } = await sb
        .from("projecten")
        .update(projectPatch)
        .eq("id", projectId);
      if (
        patchErr &&
        !(
          patchErr.code === "42703" ||
          /warmtefonds_contact_pogingen/i.test(patchErr.message || "")
        )
      ) {
        console.error("WF contact status patch:", patchErr);
      } else if (patchErr) {
        // Kolom ontbreekt: alleen status zetten
        if (early) {
          await sb
            .from("projecten")
            .update({ financiering_status: "contact_verstuurd" })
            .eq("id", projectId);
        }
      }
    }

    const leadId = lead?.id || (project.lead_id as string | null);
    if (leadId) {
      await logLeadEvent({
        leadId,
        soort: "email",
        titel: "Contactmail Warmtefonds",
        detail: `Naar ${to}\n\n${bericht}`,
        meta: {
          to,
          subject,
          project_id: projectId,
          by: operator.naam,
          bron: "warmtefonds_portaal",
          ok: true,
          wf_contact: true,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      to,
      financiering_status: early ? "contact_verstuurd" : curFs,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
