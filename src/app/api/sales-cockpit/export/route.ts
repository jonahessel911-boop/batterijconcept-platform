import { NextRequest, NextResponse } from "next/server";
import { requireSalesCockpitAdmin } from "@/lib/sales-cockpit/auth";
import { dossierCsv, dossiersForExport } from "@/lib/sales-cockpit/load";
import { parseReportQuery } from "@/app/api/sales-cockpit/route";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireSalesCockpitAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const parsed = parseReportQuery(req.nextUrl.searchParams);
    const rows = await dossiersForExport(auth.sb, {
      range: parsed.range,
      filters: parsed.filters,
      focus: parsed.focus,
      todayYmd: parsed.todayYmd,
    });
    const csv = dossierCsv(rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=salesrapportage.csv",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Export mislukt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
