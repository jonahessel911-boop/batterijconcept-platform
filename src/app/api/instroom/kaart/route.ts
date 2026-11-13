import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { geocodeAddress } from "@/lib/travel-time";
import { formatSollicitatieAdres } from "@/lib/sollicitatie-adres";
import {
  BEZORG_HQ,
  classifyRecruitmentRol,
  isAangenomenStatus,
  type RecruitmentKaartPin,
} from "@/lib/recruitment-rollen";
import { RECRUITMENT_GESPREK_LOCATIE } from "@/lib/sollicitatie";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";

export const runtime = "nodejs";

const HQ_ADRES = RECRUITMENT_GESPREK_LOCATIE;

async function geocodeNl(
  adres: string
): Promise<{ lat: number; lng: number } | null> {
  const t = adres.trim();
  if (!t) return null;
  const point = /nederland|netherlands|belgië|belgie|belgium/i.test(t)
    ? await geocodeAddress(t)
    : await geocodeAddress(`${t}, Nederland`);
  if (!point) return null;
  const lat = Number(point.lat);
  const lng = Number(point.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Pins: HQ + adviseurs + monteurs (teamgenoten) + aangenomen/pipeline kandidaten.
 */
export async function GET() {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const sb = getSupabaseAdmin();

    let hqPoint = await geocodeNl(HQ_ADRES);
    if (!hqPoint) hqPoint = { lat: BEZORG_HQ.lat, lng: BEZORG_HQ.lng };

    const pins: RecruitmentKaartPin[] = [
      {
        id: "hq-daltonlaan",
        kind: "hq",
        rol: "hq",
        naam: BEZORG_HQ.label,
        functie: "Hoofdkantoor · Daltonlaan 500",
        status: null,
        plaats: "Utrecht",
        lat: hqPoint.lat,
        lng: hqPoint.lng,
        aangenomen: false,
        start_adres: HQ_ADRES,
      },
    ];

    let geocoded = 1;
    let skipped = 0;

    const { data: adviseurs, error: advErr } = await sb
      .from("adviseurs")
      .select("id, naam, start_adres, rol, actief")
      .eq("actief", true)
      .not("start_adres", "is", null)
      .order("naam", { ascending: true })
      .limit(80);

    if (advErr && advErr.code !== "42P01") throw advErr;

    for (const row of adviseurs || []) {
      const adres = (row.start_adres as string | null)?.trim();
      if (!adres || adres === "—") {
        skipped += 1;
        continue;
      }
      const point = await geocodeNl(adres);
      if (!point) {
        skipped += 1;
        continue;
      }
      geocoded += 1;
      pins.push({
        id: `adviseur-${row.id}`,
        kind: "adviseur",
        rol: "adviseur",
        naam: (row.naam as string) || "Adviseur",
        functie: (row.rol as string) || "adviseur",
        status: "actief",
        plaats: null,
        lat: point.lat,
        lng: point.lng,
        aangenomen: true,
        start_adres: adres,
      });
    }

    // Monteurs = actieve teamgenoten bij installatiepartners (partner startadres)
    const { data: teamgenoten, error: tgErr } = await sb
      .from("installatie_partner_teamgenoten")
      .select(
        "id, naam, actief, partner_id, installatie_partners(id, naam, start_adres, factuur_plaats, actief)"
      )
      .eq("actief", true)
      .limit(120);

    if (tgErr && tgErr.code !== "42P01" && !tgErr.message?.includes("installatie_partner_teamgenoten")) {
      throw tgErr;
    }

    for (const row of teamgenoten || []) {
      const partnerRaw = row.installatie_partners as
        | {
            id?: string;
            naam?: string | null;
            start_adres?: string | null;
            factuur_plaats?: string | null;
            actief?: boolean | null;
          }
        | {
            id?: string;
            naam?: string | null;
            start_adres?: string | null;
            factuur_plaats?: string | null;
            actief?: boolean | null;
          }[]
        | null;
      const partner = Array.isArray(partnerRaw) ? partnerRaw[0] : partnerRaw;
      if (partner && partner.actief === false) {
        skipped += 1;
        continue;
      }
      const adres = (partner?.start_adres || "").trim();
      if (!adres || adres === "—") {
        skipped += 1;
        continue;
      }
      const point = await geocodeNl(adres);
      if (!point) {
        skipped += 1;
        continue;
      }
      geocoded += 1;
      pins.push({
        id: `monteur-${row.id}`,
        kind: "monteur",
        rol: "monteur",
        naam: (row.naam as string) || "Monteur",
        functie: partner?.naam ? `Monteur · ${partner.naam}` : "Monteur",
        status: "actief",
        plaats: partner?.factuur_plaats || null,
        lat: point.lat,
        lng: point.lng,
        aangenomen: true,
        start_adres: adres,
      });
    }

    const { data, error } = await sb
      .from("sollicitaties")
      .select(
        "id, naam, functie, status, postcode, huisnummer, toevoeging, straat, plaats"
      )
      .in("status", [
        "aangenomen_training_gepland",
        "aangenomen_actief",
        "aangenomen",
        "gesprek_gepland",
        "gesprek_gehad",
      ])
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error && error.code !== "42P01") throw error;

    const rows = data || [];
    const toGeo = rows.slice(0, 60);
    for (const row of toGeo) {
      const adres = formatSollicitatieAdres({
        straat: row.straat,
        huisnummer: row.huisnummer,
        toevoeging: row.toevoeging,
        postcode: row.postcode,
        plaats: row.plaats,
      });
      const query =
        adres && adres !== "—"
          ? adres
          : row.postcode?.trim()
            ? `${row.postcode.trim()} ${row.plaats || ""}`.trim()
            : null;
      if (!query) {
        skipped += 1;
        continue;
      }
      const point = await geocodeNl(query);
      if (!point) {
        skipped += 1;
        continue;
      }
      geocoded += 1;
      const rol = classifyRecruitmentRol(row.functie);
      pins.push({
        id: row.id as string,
        kind: "kandidaat",
        rol,
        naam: (row.naam as string) || "Onbekend",
        functie: (row.functie as string) || null,
        status: (row.status as string) || null,
        plaats: (row.plaats as string) || null,
        lat: point.lat,
        lng: point.lng,
        aangenomen: isAangenomenStatus(row.status as string),
      });
    }

    return NextResponse.json({
      pins,
      hq: {
        lat: hqPoint.lat,
        lng: hqPoint.lng,
        label: BEZORG_HQ.label,
        adres: HQ_ADRES,
      },
      geocoded,
      skipped: skipped + Math.max(0, rows.length - toGeo.length),
    });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
