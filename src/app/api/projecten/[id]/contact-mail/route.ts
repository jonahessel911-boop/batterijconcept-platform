import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol, gebruikerRolLabel } from "@/lib/rollen";
import { sendEmail } from "@/lib/email/postmark";
import { klantContactEmail } from "@/lib/email/templates";
import { logLeadEvent } from "@/lib/lead-events";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/contact-mail
 * Branded klantmail vanuit Projecten / backoffice.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  let body: {
    to?: string;
    subject?: string;
    bericht?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const to = body.to?.trim() || "";
  const subject = body.subject?.trim() || "";
  const bericht = body.bericht?.trim() || "";
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json({ error: "Ongeldig e-mailadres" }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json({ error: "Onderwerp is verplicht" }, { status: 400 });
  }
  if (!bericht) {
    return NextResponse.json({ error: "Bericht is verplicht" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: project, error } = await sb
      .from("projecten")
      .select(
        "id, project_nummer, titel, lead_id, leads(id, naam, email)"
      )
      .eq("id", id)
      .maybeSingle();
    if (error || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }

    const leadJoin = project.leads as
      | { id: string; naam: string | null; email: string | null }
      | { id: string; naam: string | null; email: string | null }[]
      | null;
    const lead = Array.isArray(leadJoin) ? leadJoin[0] : leadJoin;
    const klantNaam =
      lead?.naam?.trim() ||
      project.titel?.trim() ||
      project.project_nummer ||
      "klant";

    const { data: adviseur } = await sb
      .from("adviseurs")
      .select("id, naam, email, rol")
      .eq("id", session.adviseurId)
      .maybeSingle();

    const rol = normalizeRol(adviseur?.rol || session.rol);
    const afdelingLabel =
      rol === "admin" ? "Backoffice" : gebruikerRolLabel[rol] || "Backoffice";
    const medewerkerNaam =
      adviseur?.naam?.trim() || session.naam || "Batterijconcept";

    const html = klantContactEmail({
      klantNaam,
      bericht,
      afdelingLabel,
      medewerkerNaam,
    });

    const result = await sendEmail({
      to,
      subject,
      html,
      tag: "project-klant-contact",
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Mail versturen mislukt" },
        { status: 502 }
      );
    }

    if (lead?.id || project.lead_id) {
      await logLeadEvent({
        leadId: (lead?.id || project.lead_id) as string,
        soort: "email",
        titel: "Klantmail verstuurd",
        detail: subject,
        meta: {
          to,
          project_id: id,
          message_id: result.messageId || null,
          by: medewerkerNaam,
        },
      });
    }

    return NextResponse.json({ ok: true, messageId: result.messageId });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
