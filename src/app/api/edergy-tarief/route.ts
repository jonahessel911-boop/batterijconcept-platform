import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import {
  leesEdergyTarief,
  schrijfEdergyTarief,
} from "@/lib/edergy-tarief";

export const runtime = "nodejs";

/** GET /api/edergy-tarief — admin: Edergy-vergoeding per WF-aanvraag */
export async function GET() {
  try {
    const tarief = await leesEdergyTarief();
    return NextResponse.json({
      per_aanvraag_inc: tarief.perAanvraagInc,
      per_aanvraag_excl: tarief.perAanvraagExcl,
      per_aanvraag_btw: tarief.perAanvraagBtw,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** PUT /api/edergy-tarief — admin: zet vergoeding incl. btw */
export async function PUT(req: NextRequest) {
  let body: { per_aanvraag_inc?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const inc = Number(body.per_aanvraag_inc);
  if (!Number.isFinite(inc) || inc <= 0 || inc > 100_000) {
    return NextResponse.json(
      { error: "Vul een geldig bedrag in (incl. btw)" },
      { status: 400 }
    );
  }

  try {
    const tarief = await schrijfEdergyTarief(inc);
    return NextResponse.json({
      per_aanvraag_inc: tarief.perAanvraagInc,
      per_aanvraag_excl: tarief.perAanvraagExcl,
      per_aanvraag_btw: tarief.perAanvraagBtw,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Opslaan mislukt") },
      { status: 500 }
    );
  }
}
