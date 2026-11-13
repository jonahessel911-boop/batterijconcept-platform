import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ensureEindafrekeningVoorProject } from "@/lib/ensure-btw-factuur";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Projecten waarbij de batterij staat — alles moet dan gefactureerd zijn. */
const OPGELEVERD_STATUSSEN = [
  "installatie_voltooid",
  "review_gevraagd",
  "afgerond",
  "service",
];

/**
 * GET /api/cron/eindafrekening
 * Zet voor opgeleverde projecten een CONCEPT-eindafrekening klaar voor het
 * deel van de order dat op geen enkele factuur staat (Warmtefonds-plafond
 * € 8.500, of een order zonder aanbetaling). Verstuurt nooit iets.
 *
 * ?dry=1 → alleen rapporteren wat er aangemaakt zou worden.
 * Auth: Authorization: Bearer CRON_SECRET (of ?secret=).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const q = url.searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const dryRun = url.searchParams.get("dry") === "1";

  try {
    const sb = getSupabaseAdmin();
    const { data: projecten, error } = await sb
      .from("projecten")
      .select("id, project_nummer")
      .in("status", OPGELEVERD_STATUSSEN);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const aangemaakt: {
      project_nummer: string | null;
      factuur_nummer?: string;
      bedrag_inc_btw: number;
    }[] = [];
    let bijgewerkt = 0;
    let overgeslagen = 0;
    let mislukt = 0;

    for (const project of projecten || []) {
      try {
        const res = await ensureEindafrekeningVoorProject(sb, project.id, {
          dryRun,
        });
        if (!res.ok) {
          mislukt += 1;
          continue;
        }
        if (dryRun) {
          if ((res.bedrag_inc_btw ?? 0) > 0) {
            aangemaakt.push({
              project_nummer: res.project_nummer ?? null,
              bedrag_inc_btw: res.bedrag_inc_btw ?? 0,
            });
          } else {
            overgeslagen += 1;
          }
          continue;
        }
        if (!res.factuur) {
          overgeslagen += 1;
        } else if (res.factuur.created) {
          aangemaakt.push({
            project_nummer: res.project_nummer ?? null,
            factuur_nummer: res.factuur.factuur_nummer,
            bedrag_inc_btw: res.factuur.bedrag_inc_btw,
          });
        } else {
          bijgewerkt += 1;
        }
      } catch (e) {
        console.error("eindafrekening cron:", project.id, e);
        mislukt += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      dry_run: dryRun,
      bekeken: (projecten || []).length,
      aangemaakt: aangemaakt.length,
      bijgewerkt,
      overgeslagen,
      mislukt,
      totaal_inc_btw:
        Math.round(
          aangemaakt.reduce((s, a) => s + (a.bedrag_inc_btw || 0), 0) * 100
        ) / 100,
      details: aangemaakt,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
