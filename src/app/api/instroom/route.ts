import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { parseSollicitatieStatus } from "@/lib/sollicitatie";
import {
  extractAdresFromNotitie,
  mergeSollicitatieAdres,
  pickAdresFromPayload,
  resolveSollicitatieAdres,
} from "@/lib/sollicitatie-adres";
import { normalizePostcode } from "@/lib/postcode";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";

export const runtime = "nodejs";

function pickStr(v: unknown) {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed || null;
}

export async function GET() {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

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
      notitie?: string | null;
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

    // Read-only list: geen N+1 updates / PDOK op GET (dat maakte Recruitment traag).
    // Adres-normalisatie gebeurt bij create/PATCH; response normaliseert postcode in-memory.
    const sollicitaties = ((data || []) as Row[]).map((row) => {
      let postcode = row.postcode || null;
      let huisnummer = row.huisnummer || null;
      let toevoeging = row.toevoeging || null;
      let straat = row.straat || null;
      let plaats = row.plaats || null;

      if (!postcode?.trim() || !huisnummer?.trim()) {
        const fromNote = extractAdresFromNotitie(row.notitie);
        if (fromNote.postcode || fromNote.huisnummer) {
          const merged = mergeSollicitatieAdres(
            { postcode, huisnummer, toevoeging, straat, plaats },
            fromNote
          );
          postcode = merged.postcode;
          huisnummer = merged.huisnummer;
          toevoeging = merged.toevoeging || toevoeging;
          straat = merged.straat || straat;
          plaats = merged.plaats || plaats;
        }
      }

      const fixed = postcode?.trim()
        ? normalizePostcode(postcode.trim())
        : null;
      if (fixed) postcode = fixed;

      return {
        ...row,
        postcode,
        huisnummer,
        toevoeging,
        straat,
        plaats,
      };
    });

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
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const naam = pickStr(body.naam);
    if (!naam) {
      return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
    }
    const status = parseSollicitatieStatus(body.status);
    const notitie = pickStr(body.notitie);
    const adres = await resolveSollicitatieAdres(
      mergeSollicitatieAdres(
        pickAdresFromPayload(body),
        extractAdresFromNotitie(notitie)
      )
    );

    const sb = getSupabaseAdmin();
    const insertRow: Record<string, unknown> = {
      naam,
      email: pickStr(body.email),
      telefoon: pickStr(body.telefoon),
      functie: pickStr(body.functie),
      bron: pickStr(body.bron) || "crm",
      status,
      notitie,
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
