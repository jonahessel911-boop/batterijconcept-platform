/**
 * GET /api/cron/unite-cdr-sync
 * Haalt recente Unite CDR op en logt gesprekken op leads (nummer-match).
 * Auth: Authorization: Bearer CRON_SECRET
 */

import { NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import { syncUniteCdrToLeads } from "@/lib/unite-call-activity";
import { uniteConfigured } from "@/lib/unite";

export const runtime = "nodejs";
/** Genoeg tijd voor ~10 CDR-pagina's + korte opname-inhaal (geen per-call recording). */
export const maxDuration = 120;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const q = new URL(req.url).searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!uniteConfigured()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Unite niet geconfigureerd",
    });
  }

  // Default 6u: vangt korte cron-uitval op; nieuwste first → verse bel-events eerst.
  const hours = Math.min(
    48,
    Math.max(1, Number(new URL(req.url).searchParams.get("hours") || 6) || 6)
  );
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600_000);
  // Unite filters verwachten lokale wall-clock; gebruik Amsterdam via toLocale
  const fmt = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Amsterdam",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const g = (t: string) => parts.find((p) => p.type === t)?.value || "00";
    return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}:${g("second")}`;
  };

  try {
    const result = await syncUniteCdrToLeads({
      dateStart: fmt(start),
      dateEnd: fmt(end),
      maxPages: 12,
      skipRecording: true,
    });
    return NextResponse.json({ ok: true, hours, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: errMessage(e, "Unite CDR sync mislukt") },
      { status: 500 }
    );
  }
}
