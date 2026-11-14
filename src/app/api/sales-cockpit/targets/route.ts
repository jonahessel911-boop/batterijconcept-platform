import { NextRequest, NextResponse } from "next/server";
import { requireSalesCockpitAdmin } from "@/lib/sales-cockpit/auth";

export const runtime = "nodejs";

const WEEK = /^\d{4}-W\d{2}$/;

export async function PUT(req: NextRequest) {
  const auth = await requireSalesCockpitAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  let body: {
    adviseurId?: string;
    weekKey?: string;
    gelopenDoel?: number | null;
    dealsDoel?: number | null;
    conversieDoel?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }
  const adviseurId = body.adviseurId?.trim() || "";
  const weekKey = body.weekKey?.trim() || "";
  if (!adviseurId || !WEEK.test(weekKey)) {
    return NextResponse.json({ error: "Adviseur en week zijn verplicht" }, { status: 400 });
  }
  const gelopen = cleanInt(body.gelopenDoel);
  const deals = cleanInt(body.dealsDoel);
  const conversie = cleanPct(body.conversieDoel);
  if (gelopen === "bad" || deals === "bad" || conversie === "bad") {
    return NextResponse.json({ error: "Doel is ongeldig" }, { status: 400 });
  }

  const row = {
    adviseur_id: adviseurId,
    week_key: weekKey,
    gelopen_doel: gelopen,
    deals_doel: deals,
    conversie_doel: conversie,
    updated_at: new Date().toISOString(),
    updated_by: auth.actorId,
  };
  const { error } = await auth.sb
    .from("sales_cockpit_weektargets")
    .upsert(row, { onConflict: "adviseur_id,week_key" });
  if (error) {
    const missing =
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      (error.message || "").includes("sales_cockpit_weektargets");
    return NextResponse.json(
      {
        error: missing
          ? "De targettabel bestaat nog niet. Voer migrate-sales-cockpit-weektargets.sql uit."
          : error.message,
      },
      { status: missing ? 409 : 500 }
    );
  }
  await auth.sb.from("sales_cockpit_weektarget_events").insert({
    adviseur_id: adviseurId,
    week_key: weekKey,
    gelopen_doel: gelopen,
    deals_doel: deals,
    conversie_doel: conversie,
    actor_id: auth.actorId,
  });
  return NextResponse.json({ ok: true });
}

function cleanInt(value: number | null | undefined): number | null | "bad" {
  if (value == null || value === ("" as unknown)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 500) return "bad";
  return Math.round(n);
}

function cleanPct(value: number | null | undefined): number | null | "bad" {
  if (value == null || value === ("" as unknown)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return "bad";
  return Math.round(n * 10) / 10;
}
