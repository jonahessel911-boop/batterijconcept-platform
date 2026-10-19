import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { parseSollicitatieStatus } from "@/lib/sollicitatie";
import {
  pickAdresFromPayload,
  resolveSollicitatieAdres,
} from "@/lib/sollicitatie-adres";

export const runtime = "nodejs";

function pickStr(v: unknown) {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed || null;
}

export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("sollicitaties")
      .select("*, sollicitatie_bestanden(*)")
      .order("created_at", { ascending: false });

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json(
          { error: "Voer eerst supabase/migrate-instroom-ats.sql uit." },
          { status: 400 }
        );
      }
      throw error;
    }

    type Row = {
      id: string;
      postcode?: string | null;
      huisnummer?: string | null;
      toevoeging?: string | null;
      straat?: string | null;
      plaats?: string | null;
      sollicitatie_bestanden?: Array<{
        id: string;
        storage_path: string;
      }>;
    };

    const sollicitaties = (data || []) as Row[];

    // Bestaande rijen met PC+nr maar zonder straat/plaats → postcode-API (max 15/request)
    const needsEnrich = sollicitaties.filter(
      (s) =>
        s.postcode?.trim() &&
        s.huisnummer?.trim() &&
        (!s.straat?.trim() || !s.plaats?.trim())
    );
    for (const row of needsEnrich.slice(0, 15)) {
      try {
        const resolved = await resolveSollicitatieAdres({
          postcode: row.postcode || null,
          huisnummer: row.huisnummer || null,
          toevoeging: row.toevoeging || null,
          straat: row.straat || null,
          plaats: row.plaats || null,
        });
        if (
          resolved.straat === (row.straat || null) &&
          resolved.plaats === (row.plaats || null)
        ) {
          continue;
        }
        const { error: upErr } = await sb
          .from("sollicitaties")
          .update({
            postcode: resolved.postcode,
            huisnummer: resolved.huisnummer,
            toevoeging: resolved.toevoeging,
            straat: resolved.straat,
            plaats: resolved.plaats,
          })
          .eq("id", row.id);
        if (!upErr) {
          row.postcode = resolved.postcode;
          row.huisnummer = resolved.huisnummer;
          row.toevoeging = resolved.toevoeging;
          row.straat = resolved.straat;
          row.plaats = resolved.plaats;
        }
      } catch {
        /* lookup optioneel */
      }
    }

    const paths = sollicitaties.flatMap((s) =>
      (s.sollicitatie_bestanden || []).map((b) => b.storage_path)
    );
    const urlMap = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await sb.storage
        .from("sollicitaties")
        .createSignedUrls(paths, 60 * 60 * 6);
      for (const item of signed || []) {
        if (item.path && item.signedUrl) urlMap.set(item.path, item.signedUrl);
      }
    }

    return NextResponse.json({
      sollicitaties: sollicitaties.map((s) => ({
        ...s,
        sollicitatie_bestanden: (s.sollicitatie_bestanden || []).map((b) => ({
          ...b,
          url: urlMap.get(b.storage_path) || null,
        })),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Kon instroom niet laden") },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const naam = pickStr(body.naam);
    if (!naam) {
      return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
    }
    const status = parseSollicitatieStatus(body.status);
    const adres = await resolveSollicitatieAdres(pickAdresFromPayload(body));

    const sb = getSupabaseAdmin();
    const insertRow: Record<string, unknown> = {
      naam,
      email: pickStr(body.email),
      telefoon: pickStr(body.telefoon),
      functie: pickStr(body.functie),
      bron: pickStr(body.bron) || "crm",
      status,
      notitie: pickStr(body.notitie),
      postcode: adres.postcode,
      huisnummer: adres.huisnummer,
      toevoeging: adres.toevoeging,
      straat: adres.straat,
      plaats: adres.plaats,
    };

    let { data, error } = await sb
      .from("sollicitaties")
      .insert(insertRow)
      .select("*")
      .single();

    if (
      error &&
      (error.message?.includes("postcode") ||
        error.message?.includes("huisnummer") ||
        error.message?.includes("straat") ||
        error.message?.includes("plaats") ||
        error.code === "42703")
    ) {
      return NextResponse.json(
        {
          error:
            "Voer supabase/migrate-sollicitatie-adres.sql uit in Supabase.",
          detail: error.message,
        },
        { status: 400 }
      );
    }

    if (error) throw error;
    return NextResponse.json({ sollicitatie: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Aanmaken mislukt") },
      { status: 500 }
    );
  }
}
