import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { sendEmail } from "@/lib/email/postmark";
import { projectGeannuleerdKlantEmail } from "@/lib/email/templates";
import { logLeadEvent } from "@/lib/lead-events";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/annuleringsmail
 * Verstuur bevestiging van order-annulering naar de klant.
 * Alleen toegestaan als projectstatus = annulering.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: project, error } = await sb
      .from("projecten")
      .select(
        "id, status, project_nummer, lead_id, leads(naam, email)"
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!project) {
      return NextResponse.json({ error: "Project niet gevonden" }, { status: 404 });
    }
    if (project.status !== "annulering") {
      return NextResponse.json(
        { error: "Annuleringsmail alleen bij status Annulering" },
        { status: 400 }
      );
    }

    const leadRaw = project.leads;
    const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
    const to =
      lead && typeof lead === "object" && typeof lead.email === "string"
        ? lead.email.trim()
        : "";
    const naam =
      lead && typeof lead === "object" && typeof lead.naam === "string"
        ? lead.naam
        : "klant";

    if (!to) {
      return NextResponse.json(
        { error: "Geen e-mailadres op de lead" },
        { status: 400 }
      );
    }

    const html = projectGeannuleerdKlantEmail({
      naam,
      projectNummer: (project.project_nummer as string) || null,
    });
    const mail = await sendEmail({
      to,
      subject: "Bestelling geannuleerd — Batterijconcept",
      html,
      tag: "project-annulering",
    });

    const leadId = project.lead_id as string | null;
    if (leadId) {
      await logLeadEvent({
        leadId,
        soort: "email",
        titel: mail.ok
          ? "Annuleringsmail verstuurd naar klant"
          : "Annuleringsmail mislukt",
        detail: mail.ok ? `Naar ${to}` : mail.error || "Onbekende fout",
        meta: {
          project_id: id,
          project_nummer: project.project_nummer,
          to,
          ok: mail.ok,
        },
      });
    }

    if (!mail.ok) {
      return NextResponse.json(
        { error: mail.error || "Mailen mislukt", sent: false },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, sent: true, to });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
