import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendEmail } from "@/lib/email/postmark";
import {
  installatieHerinneringKlantEmail,
  schouwHerinneringKlantEmail,
} from "@/lib/email/templates";
import { adresRegel } from "@/lib/format";
import { isTomorrowAmsterdam } from "@/lib/planning-window";

export const runtime = "nodejs";

/**
 * GET /api/cron/project-herinneringen
 * Stuurt klant-herinnering 1 dag voor schouw of installatie.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const q = new URL(req.url).searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const sb = getSupabaseAdmin();
    const now = new Date();

    const { data: projects, error } = await sb
      .from("projecten")
      .select(
        "id, project_nummer, schouw_at, schouw_notities, installatie_at, installatie_notities, installateur_notitie, schouw_herinnering_verstuurd, installatie_herinnering_verstuurd, leads(naam, email, postcode, huisnummer, toevoeging, straat, plaats, notities)"
      )
      .or(
        "schouw_at.not.is.null,installatie_at.not.is.null"
      );

    if (error) {
      if (
        error.message?.includes("installatie_at") ||
        error.message?.includes("herinnering") ||
        error.code === "42703"
      ) {
        return NextResponse.json(
          {
            error:
              "Run migrate-project-installatie-agenda.sql in Supabase.",
          },
          { status: 400 }
        );
      }
      throw error;
    }

    let schouwSent = 0;
    let installatieSent = 0;
    const errors: string[] = [];

    for (const p of projects || []) {
      const lead = Array.isArray(p.leads) ? p.leads[0] : p.leads;
      if (!lead?.email?.trim()) continue;

      const adres = lead ? adresRegel(lead) : null;
      const belangrijkeInfo = [
        p.schouw_notities?.trim(),
        p.installatie_notities?.trim(),
        p.installateur_notitie?.trim(),
        lead?.notities?.trim(),
      ]
        .filter(Boolean)
        .join("\n\n");

      if (
        p.schouw_at &&
        !p.schouw_herinnering_verstuurd &&
        isTomorrowAmsterdam(p.schouw_at, now)
      ) {
        const mail = await sendEmail({
          to: lead.email.trim(),
          subject: "Morgen is je schouw — Batterijconcept",
          html: schouwHerinneringKlantEmail({
            naam: lead.naam || "klant",
            schouwAt: p.schouw_at,
            adres: adres !== "—" ? adres : null,
            belangrijkeInfo: belangrijkeInfo || null,
          }),
          tag: "schouw-herinnering",
        });
        if (mail.ok) {
          await sb
            .from("projecten")
            .update({ schouw_herinnering_verstuurd: true })
            .eq("id", p.id);
          schouwSent++;
        } else if (mail.error) {
          errors.push(`schouw ${p.project_nummer}: ${mail.error}`);
        }
      }

      if (
        p.installatie_at &&
        !p.installatie_herinnering_verstuurd &&
        isTomorrowAmsterdam(p.installatie_at, now)
      ) {
        const mail = await sendEmail({
          to: lead.email.trim(),
          subject: "Morgen is je installatie — Batterijconcept",
          html: installatieHerinneringKlantEmail({
            naam: lead.naam || "klant",
            installatieAt: p.installatie_at,
            adres: adres !== "—" ? adres : null,
            belangrijkeInfo: belangrijkeInfo || null,
          }),
          tag: "installatie-herinnering",
        });
        if (mail.ok) {
          await sb
            .from("projecten")
            .update({ installatie_herinnering_verstuurd: true })
            .eq("id", p.id);
          installatieSent++;
        } else if (mail.error) {
          errors.push(`installatie ${p.project_nummer}: ${mail.error}`);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      schouw_herinneringen: schouwSent,
      installatie_herinneringen: installatieSent,
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Cron mislukt",
      },
      { status: 500 }
    );
  }
}
