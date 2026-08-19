import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import type { SollicitatieStatus } from "@/types/database";

export const runtime = "nodejs";

const SOLLICITATIE_STATUSES: SollicitatieStatus[] = [
  "nieuw",
  "gescreend",
  "gesprek",
  "aangenomen",
  "afgewezen",
];

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

    const sollicitaties = (data || []) as Array<{
      id: string;
      sollicitatie_bestanden?: Array<{
        id: string;
        storage_path: string;
      }>;
    }>;

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
    const statusInput = pickStr(body.status) as SollicitatieStatus | null;
    const status = SOLLICITATIE_STATUSES.includes(statusInput || "nieuw")
      ? (statusInput as SollicitatieStatus)
      : "nieuw";

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("sollicitaties")
      .insert({
        naam,
        email: pickStr(body.email),
        telefoon: pickStr(body.telefoon),
        bron: pickStr(body.bron) || "crm",
        status,
        notitie: pickStr(body.notitie),
      })
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ sollicitatie: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Aanmaken mislukt") },
      { status: 500 }
    );
  }
}
