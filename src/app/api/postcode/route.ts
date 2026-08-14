import { NextRequest, NextResponse } from "next/server";
import { lookupPostcode } from "@/lib/postcode";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

/** GET /api/postcode?postcode=1234AB&number=12 */
export async function GET(req: NextRequest) {
  const postcode = req.nextUrl.searchParams.get("postcode") || "";
  const number =
    req.nextUrl.searchParams.get("number") ||
    req.nextUrl.searchParams.get("huisnummer") ||
    "";

  if (!postcode.trim() || !number.trim()) {
    return NextResponse.json(
      { error: "postcode en number zijn verplicht" },
      { status: 400 }
    );
  }

  if (!process.env.POSTCODE_API_TOKEN) {
    return NextResponse.json(
      { error: "POSTCODE_API_TOKEN ontbreekt" },
      { status: 503 }
    );
  }

  try {
    const result = await lookupPostcode(postcode, number);
    if (!result) {
      return NextResponse.json(
        { error: "Adres niet gevonden" },
        { status: 404 }
      );
    }
    return NextResponse.json({
      straat: result.street,
      plaats: result.city,
      postcode: result.postcode,
      huisnummer: result.house_number,
      province: result.province,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Postcode-lookup mislukt") },
      { status: 500 }
    );
  }
}
