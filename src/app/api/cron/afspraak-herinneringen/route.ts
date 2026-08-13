import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { afspraakHerinneringEmail } from "@/lib/email/templates";

export const runtime = "nodejs";

/**
 * GET /api/cron/afspraak-herinneringen
 * Stuurt herinneringen voor afspraken die over ~24 uur starten.
 * Beveilig met CRON_SECRET header of query.
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
    const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const { data: afspraken, error } = await sb
      .from("afspraken")
      .select(
        "*, leads(naam, email), adviseurs(naam)"
      )
      .in("status", ["gepland", "bevestigd", "verzet"])
      .eq("herinnering_verstuurd", false)
      .gte("start_at", in23h.toISOString())
      .lte("start_at", in25h.toISOString());

    if (error) throw error;

    let sent = 0;
    for (const a of afspraken || []) {
      const email = a.leads?.email;
      if (!email || !a.manage_token) continue;

      const html = afspraakHerinneringEmail({
        naam: a.leads?.naam || "klant",
        startAt: a.start_at,
        adviseurNaam: a.adviseurs?.naam || "Batterijconcept",
        manageUrl: `${appBaseUrl()}/afspraak/${a.manage_token}`,
      });

      const result = await sendEmail({
        to: email,
        subject: "Herinnering: jouw adviesafspraak morgen",
        html,
        tag: "afspraak-herinnering",
      });

      if (result.ok) {
        await sb
          .from("afspraken")
          .update({ herinnering_verstuurd: true })
          .eq("id", a.id);
        sent += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      checked: (afspraken || []).length,
      sent,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
