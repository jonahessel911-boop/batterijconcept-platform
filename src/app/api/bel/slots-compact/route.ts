/**
 * GET /api/bel/slots-compact?days=14&adviseur_id=…
 * Compact overzicht: open slots (vrij/bezet) per planbare adviseur.
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { addDays, getISOWeekYear } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import {
  dayKeyAmsterdam,
  isBeforeStartdatum,
  isSlotGeblokkeerd,
  loadAfblokkingen,
  loadSlotVrijgaven,
  nearestSlotHour,
  weekKeyFromDate,
  weekKeyString,
} from "@/lib/adviseur-beschikbaarheid";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import { AMSTERDAM_TZ, formatTimeNl } from "@/lib/format";
import { normalizeRol } from "@/lib/rollen";
import {
  AFSPRAAK_DUUR_MINUTEN,
  generateDayBlocks,
  type BusySlot,
} from "@/lib/slots";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

function initials(naam: string): string {
  const clean = (naam || "").trim();
  if (!clean) return "??";
  const letters = clean.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  return (clean.slice(0, 2) || "??").toUpperCase();
}

async function loadUnavailableByAdviseur(
  sb: ReturnType<typeof getSupabaseAdmin>,
  adviseurIds: string[],
  jaren: number[]
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (!adviseurIds.length || !jaren.length) return map;
  const { data, error } = await sb
    .from("adviseur_beschikbaarheid")
    .select("adviseur_id, jaar, week, beschikbaar")
    .in("adviseur_id", adviseurIds)
    .in("jaar", jaren)
    .eq("beschikbaar", false);
  if (error) {
    if (
      error.code === "42703" ||
      error.code === "42P01" ||
      error.message?.includes("adviseur_beschikbaarheid") ||
      error.message?.includes("schema cache")
    ) {
      return map;
    }
    throw error;
  }
  for (const row of data || []) {
    const aid = row.adviseur_id as string;
    const key = weekKeyString(row.jaar as number, row.week as number);
    if (!map.has(aid)) map.set(aid, new Set());
    map.get(aid)!.add(key);
  }
  return map;
}

export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const daysRaw = Number(req.nextUrl.searchParams.get("days") || "14");
    const daysAhead = Math.min(
      Math.max(Number.isFinite(daysRaw) ? daysRaw : 14, 1),
      21
    );
    let lockAdviseurId =
      req.nextUrl.searchParams.get("adviseur_id")?.trim() || null;

    if (normalizeRol(session.rol) === "adviseur") {
      lockAdviseurId = session.adviseurId;
    }

    const sb = getSupabaseAdmin();
    const now = new Date();
    const van = dayKeyAmsterdam(now);
    const tot = dayKeyAmsterdam(addDays(now, daysAhead + 2));
    const y = getISOWeekYear(toZonedTime(now, AMSTERDAM_TZ));

    const { data: adviseursRaw, error: advErr } = await sb
      .from("adviseurs")
      .select("id, naam, email, rol, actief, startdatum")
      .eq("actief", true)
      .order("naam");
    if (advErr) throw advErr;

    let adviseurs = (adviseursRaw || []).filter((a) =>
      isPlanbaarAdviseur({
        naam: a.naam,
        email: a.email,
        actief: a.actief,
        rol: a.rol,
      })
    );
    if (lockAdviseurId) {
      adviseurs = adviseurs.filter((a) => a.id === lockAdviseurId);
    }

    const ids = adviseurs.map((a) => a.id);
    if (!ids.length) {
      return NextResponse.json({
        daysAhead,
        vrij: 0,
        bezet: 0,
        days: [],
        adviseurs: [],
      });
    }

    const [unavailableByAdviseur, afblokkingen, vrijgaven, afsprakenRes] =
      await Promise.all([
        loadUnavailableByAdviseur(sb, ids, [y - 1, y, y + 1]),
        loadAfblokkingen(sb, { adviseurIds: ids, van, tot }),
        loadSlotVrijgaven(sb, { adviseurIds: ids, van, tot }),
        sb
          .from("afspraken")
          .select("adviseur_id, start_at, end_at, status, soort")
          .in("adviseur_id", ids)
          .gte("start_at", now.toISOString())
          .lte("start_at", addDays(now, daysAhead + 2).toISOString())
          .neq("status", "geannuleerd"),
      ]);

    type CompactSlot = {
      adviseur_id: string;
      adviseur_naam: string;
      initials: string;
      start_at: string;
      end_at: string;
      day: string;
      time_label: string;
      busy: boolean;
    };

    const slots: CompactSlot[] = [];
    const daySet = new Set<string>();

    for (const adv of adviseurs) {
      const busy: BusySlot[] = (afsprakenRes.data || [])
        .filter(
          (a) =>
            a.adviseur_id === adv.id &&
            a.status !== "geannuleerd" &&
            a.status !== "voltooid" &&
            afspraakBlokkeertAgenda(a.soort as string | null)
        )
        .map((a) => {
          const start = a.start_at as string;
          const end =
            a.end_at && a.end_at !== a.start_at
              ? (a.end_at as string)
              : new Date(
                  new Date(start).getTime() + AFSPRAAK_DUUR_MINUTEN * 60_000
                ).toISOString();
          return { start_at: start, end_at: end };
        });

      const unavailable = unavailableByAdviseur.get(adv.id) || new Set();
      const blocks = generateDayBlocks({
        daysAhead,
        busy,
        fromDate: now,
      });
      const ini = initials(adv.naam || "");

      for (const block of blocks) {
        if (isBeforeStartdatum(block.start, adv.startdatum)) continue;
        const wk = weekKeyFromDate(block.start);
        const wkKey = weekKeyString(wk.jaar, wk.week);
        if (unavailable.has(wkKey)) continue;

        const dag = dayKeyAmsterdam(block.start);
        const hour = nearestSlotHour(block.start);
        const blocked = isSlotGeblokkeerd(
          adv.id,
          dag,
          hour,
          afblokkingen,
          vrijgaven
        );
        if (blocked) continue;

        daySet.add(dag);
        slots.push({
          adviseur_id: adv.id,
          adviseur_naam: adv.naam || "Adviseur",
          initials: ini,
          start_at: block.start.toISOString(),
          end_at: block.end.toISOString(),
          day: dag,
          time_label: formatTimeNl(block.start.toISOString()),
          busy: block.busy,
        });
      }
    }

    slots.sort(
      (a, b) =>
        a.start_at.localeCompare(b.start_at) ||
        a.adviseur_naam.localeCompare(b.adviseur_naam, "nl")
    );

    const days = [...daySet].sort().map((ymd) => {
      const [y0, m0, d0] = ymd.split("-").map(Number);
      const noonUtc = fromZonedTime(
        new Date(y0, m0 - 1, d0, 12, 0, 0),
        AMSTERDAM_TZ
      );
      const label = formatInTimeZone(noonUtc, AMSTERDAM_TZ, "EEE d MMM", {
        locale: nl,
      });
      return { ymd, label };
    });

    const vrij = slots.filter((s) => !s.busy).length;
    const bezet = slots.filter((s) => s.busy).length;

    return NextResponse.json({
      daysAhead,
      vrij,
      bezet,
      days,
      adviseurs: adviseurs.map((a) => ({
        id: a.id,
        naam: a.naam,
        initials: initials(a.naam || ""),
      })),
      slots,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
