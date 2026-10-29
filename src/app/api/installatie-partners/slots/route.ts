import { NextRequest, NextResponse } from "next/server";
import { addMinutes, differenceInCalendarDays, parseISO } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { getSupabaseAdmin } from "@/lib/supabase";
import { AMSTERDAM_TZ, adresRegel } from "@/lib/format";
import {
  installatieDuurVoorVenster,
  SCHOUW_DUUR_MINUTEN,
} from "@/lib/planning-duur";
import {
  DEFAULT_PARTNER_REISTIJD_BUFFER_MIN,
  busyByDay,
  dayKeyAmsterdam,
  fitsWithTravelGap,
  generatePartnerDaySlots,
  isPartnerVenster,
  vensterForStart,
  type BusySlot,
  type PartnerSlotSoort,
  type PartnerVenster,
} from "@/lib/partner-slots";
import { loadPartnerAfblokkingen } from "@/lib/partner-afblokkingen-db";
import { travelTimeBetween } from "@/lib/travel-time";

export const runtime = "nodejs";

function isMissingCol(error: { code?: string; message?: string } | null, col: string) {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    msg.includes(col) ||
    msg.includes("schema cache")
  );
}

/**
 * GET /api/installatie-partners/slots
 *   ?partner_id=&van=yyyy-MM-dd&tot=yyyy-MM-dd&soort=schouw|installatie
 *   &lead_id= (optioneel, voor reistijd)
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const partnerId = p.get("partner_id");
  const van = p.get("van");
  const tot = p.get("tot");
  const soortRaw = (p.get("soort") || "schouw").toLowerCase();
  const leadId = p.get("lead_id");
  const excludeProjectId = p.get("exclude_project_id");

  if (!partnerId) {
    return NextResponse.json(
      { error: "partner_id is verplicht" },
      { status: 400 }
    );
  }
  if (!van || !tot || !/^\d{4}-\d{2}-\d{2}$/.test(van) || !/^\d{4}-\d{2}-\d{2}$/.test(tot)) {
    return NextResponse.json(
      { error: "van en tot (yyyy-MM-dd) zijn verplicht" },
      { status: 400 }
    );
  }
  if (soortRaw !== "schouw" && soortRaw !== "installatie") {
    return NextResponse.json(
      { error: "soort moet schouw of installatie zijn" },
      { status: 400 }
    );
  }
  const soort = soortRaw as PartnerSlotSoort;

  const daysAhead = Math.max(
    0,
    differenceInCalendarDays(parseISO(tot), parseISO(van))
  );

  try {
    const sb = getSupabaseAdmin();

    let partnerRes = await sb
      .from("installatie_partners")
      .select("id, naam, start_adres, reistijd_buffer_min, actief")
      .eq("id", partnerId)
      .maybeSingle();

    if (partnerRes.error && isMissingCol(partnerRes.error, "start_adres")) {
      partnerRes = await sb
        .from("installatie_partners")
        .select("id, naam, actief")
        .eq("id", partnerId)
        .maybeSingle() as typeof partnerRes;
    }

    if (partnerRes.error) throw partnerRes.error;
    if (!partnerRes.data) {
      return NextResponse.json({ error: "Partner niet gevonden" }, { status: 404 });
    }

    const partner = partnerRes.data as {
      id: string;
      naam: string;
      start_adres?: string | null;
      reistijd_buffer_min?: number | null;
      actief: boolean;
    };
    const bufferMin =
      typeof partner.reistijd_buffer_min === "number" &&
      partner.reistijd_buffer_min >= 0
        ? partner.reistijd_buffer_min
        : DEFAULT_PARTNER_REISTIJD_BUFFER_MIN;
    const startAdres = (partner.start_adres || "").trim() || null;

    // Bestaande planningen (ruim venster; filteren per dag hieronder)
    const rangeStartIso = fromZonedTime(`${van}T00:00:00`, AMSTERDAM_TZ).toISOString();
    const rangeEndIso = fromZonedTime(`${tot}T23:59:59`, AMSTERDAM_TZ).toISOString();

    const { data: projects, error: projErr } = await sb
      .from("projecten")
      .select(
        "id, schouw_at, installatie_at, installatie_partner_id, leads(straat, huisnummer, toevoeging, postcode, plaats)"
      )
      .eq("installatie_partner_id", partnerId)
      .or(
        `and(schouw_at.gte.${rangeStartIso},schouw_at.lte.${rangeEndIso}),and(installatie_at.gte.${rangeStartIso},installatie_at.lte.${rangeEndIso})`
      );
    if (projErr) throw projErr;

    type BusyWithMeta = BusySlot & {
      kind: "schouw" | "installatie";
      project_nummer?: string | null;
    };
    const busy: BusyWithMeta[] = [];
    for (const row of projects || []) {
      if (excludeProjectId && row.id === excludeProjectId) continue;
      const lead = row.leads as
        | {
            straat?: string | null;
            huisnummer?: string | null;
            toevoeging?: string | null;
            postcode?: string | null;
            plaats?: string | null;
          }
        | null
        | { straat?: string | null }[];
      const leadObj = Array.isArray(lead) ? lead[0] : lead;
      const address = leadObj ? adresRegel(leadObj) : null;
      const usableAddress =
        address && address !== "—" ? address : null;

      if (row.schouw_at) {
        const start = new Date(row.schouw_at);
        if (!Number.isNaN(start.getTime())) {
          busy.push({
            start_at: start.toISOString(),
            end_at: addMinutes(start, SCHOUW_DUUR_MINUTEN).toISOString(),
            address: usableAddress,
            kind: "schouw",
          });
        }
      }
      if (row.installatie_at) {
        const start = new Date(row.installatie_at);
        if (!Number.isNaN(start.getTime())) {
          const duur = installatieDuurVoorVenster(vensterForStart(start));
          busy.push({
            start_at: start.toISOString(),
            end_at: addMinutes(start, duur).toISOString(),
            address: usableAddress,
            kind: "installatie",
          });
        }
      }
    }

    // Afblokkingen: partner-breed OF alle actieve teamgenoten geblokkeerd
    const afblokMap = new Map<string, Set<PartnerVenster>>();
    const [{ data: teamRows }, afblokLoaded] = await Promise.all([
      sb
        .from("installatie_partner_teamgenoten")
        .select("id")
        .eq("partner_id", partnerId)
        .eq("actief", true),
      loadPartnerAfblokkingen(sb, {
        partnerIds: [partnerId],
        van,
        tot,
      }),
    ]);
    const activeTgIds = (teamRows || []).map((t) => t.id as string);
    const tgCount = activeTgIds.length;

    {
      const byDayVenster = new Map<
        string,
        { partnerWide: boolean; tgBlocked: Set<string> }
      >();
      for (const row of afblokLoaded.items) {
        if (!isPartnerVenster(row.venster)) continue;
        const k = `${row.dag}:${row.venster}`;
        const cur = byDayVenster.get(k) || {
          partnerWide: false,
          tgBlocked: new Set<string>(),
        };
        if (!row.teamgenoot_id) cur.partnerWide = true;
        else cur.tgBlocked.add(row.teamgenoot_id);
        byDayVenster.set(k, cur);
      }
      for (const [k, info] of byDayVenster) {
        const [dag, venster] = k.split(":") as [string, PartnerVenster];
        const allTgBlocked =
          tgCount > 0 &&
          activeTgIds.every((id) => info.tgBlocked.has(id));
        // Partner-breed dicht, of alle monteurs hebben dit venster geblokkeerd
        // (zonder teamgenoot-kolom: partnerWide-items gelden voor iedereen)
        if (
          info.partnerWide ||
          allTgBlocked ||
          (!afblokLoaded.perMonteur && info.partnerWide)
        ) {
          const set = afblokMap.get(dag) || new Set<PartnerVenster>();
          set.add(venster);
          afblokMap.set(dag, set);
        }
      }
      // Legacy zonder teamgenoot_id: elk item is partner-breed
      if (!afblokLoaded.perMonteur) {
        for (const row of afblokLoaded.items) {
          if (!isPartnerVenster(row.venster)) continue;
          const set = afblokMap.get(row.dag) || new Set<PartnerVenster>();
          set.add(row.venster);
          afblokMap.set(row.dag, set);
        }
      }
    }

    // Target-adres voor reistijd
    let targetAddress: string | null = null;
    if (leadId) {
      const { data: leadRow } = await sb
        .from("leads")
        .select("straat, huisnummer, toevoeging, postcode, plaats")
        .eq("id", leadId)
        .maybeSingle();
      if (leadRow) {
        const a = adresRegel(leadRow);
        if (a && a !== "—") targetAddress = a;
      }
    }

    const fromDate = fromZonedTime(`${van}T00:00:00`, AMSTERDAM_TZ);
    // Niet slots in het verleden van vandaag filteren weg als van = vandaag:
    // generatePartnerDaySlots skip al startUtc <= now via fromDate = now max(van)
    const now = new Date();
    const slotFrom = fromDate.getTime() > now.getTime() ? fromDate : now;
    const allSlots = generatePartnerDaySlots({
      soort,
      daysAhead,
      busy,
      afblokkingen: afblokMap,
      fromDate: slotFrom,
    }).filter((s) => {
      const key = dayKeyAmsterdam(s.start);
      return key >= van && key <= tot;
    });

    const byDay = busyByDay(busy);
    const travelCache = new Map<string, number>();

    async function travelMin(from: string | null, to: string | null): Promise<number> {
      if (!from || !to || from === to) return 0;
      const key = `${from}|||${to}`;
      const cached = travelCache.get(key);
      if (cached != null) return cached;
      try {
        const leg = await travelTimeBetween(from, to);
        const mins = Math.max(0, Math.ceil(leg.durationSec / 60));
        travelCache.set(key, mins);
        return mins;
      } catch {
        travelCache.set(key, bufferMin);
        return bufferMin;
      }
    }

    const slotsOut: {
      start_at: string;
      end_at: string;
      venster: PartnerVenster;
      beschikbaar: boolean;
      reason?: string;
      reistijd_min?: number | null;
      reistijd_vanaf?: "vorige_installatie" | "vorige_schouw" | "startadres" | null;
      reistijd_label?: string | null;
    }[] = [];

    const busyMetaByStart = new Map(
      busy.map((b) => [b.start_at, b] as const)
    );

    for (const slot of allSlots) {
      if (slot.busy) {
        slotsOut.push({
          start_at: slot.start.toISOString(),
          end_at: slot.end.toISOString(),
          venster: slot.venster,
          beschikbaar: false,
          reason: "Bezet of afgeblokt",
        });
        continue;
      }

      const dayKey = dayKeyAmsterdam(slot.start);
      const dayStops = (byDay.get(dayKey) || []).map((b) => {
        const meta = busyMetaByStart.get(b.start_at);
        return {
          start: new Date(b.start_at),
          end: new Date(b.end_at),
          address: b.address || null,
          kind: meta?.kind || null,
        };
      });

      // Reistijd: vorige stop (of startadres) → target → volgende stop
      let travelBefore = bufferMin;
      let travelAfter = bufferMin;
      let reistijdShown: number | null = null;
      let reistijdVanaf:
        | "vorige_installatie"
        | "vorige_schouw"
        | "startadres"
        | null = null;
      let reistijdLabel: string | null = null;

      if (targetAddress) {
        const prev = [...dayStops]
          .filter((s) => s.end.getTime() <= slot.start.getTime())
          .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
        const next = [...dayStops]
          .filter((s) => s.start.getTime() >= slot.end.getTime())
          .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

        const fromAddr = prev?.address || startAdres;
        travelBefore = fromAddr
          ? await travelMin(fromAddr, targetAddress)
          : bufferMin;
        travelAfter = next?.address
          ? await travelMin(targetAddress, next.address)
          : bufferMin;
        reistijdShown = travelBefore;
        if (prev?.kind === "installatie") {
          reistijdVanaf = "vorige_installatie";
          reistijdLabel = prev.address
            ? `Vorige installatie · ${prev.address}`
            : "Vorige installatie";
        } else if (prev?.kind === "schouw") {
          reistijdVanaf = "vorige_schouw";
          reistijdLabel = prev.address
            ? `Vorige schouw · ${prev.address}`
            : "Vorige schouw";
        } else if (startAdres && fromAddr === startAdres) {
          reistijdVanaf = "startadres";
          reistijdLabel = `Startadres · ${startAdres}`;
        }
      } else if (dayStops.length > 0) {
        // Geen lead-adres: vaste buffer tussen stops
        travelBefore = bufferMin;
        travelAfter = bufferMin;
      } else {
        travelBefore = 0;
        travelAfter = 0;
      }

      const fits = fitsWithTravelGap({
        candidateStart: slot.start,
        candidateEnd: slot.end,
        sameDayStops: dayStops.map((s) => ({ start: s.start, end: s.end })),
        travelMinBefore: travelBefore,
        travelMinAfter: travelAfter,
      });

      if (!fits) {
        slotsOut.push({
          start_at: slot.start.toISOString(),
          end_at: slot.end.toISOString(),
          venster: slot.venster,
          beschikbaar: false,
          reason: "Onvoldoende reistijd",
          reistijd_min: reistijdShown,
          reistijd_vanaf: reistijdVanaf,
          reistijd_label: reistijdLabel,
        });
        continue;
      }

      slotsOut.push({
        start_at: slot.start.toISOString(),
        end_at: slot.end.toISOString(),
        venster: slot.venster,
        beschikbaar: true,
        reistijd_min: reistijdShown,
        reistijd_vanaf: reistijdVanaf,
        reistijd_label: reistijdLabel,
      });
    }

    const beschikbaar = slotsOut.filter((s) => s.beschikbaar);

    return NextResponse.json({
      partner_id: partnerId,
      partner_naam: partner.naam,
      soort,
      van,
      tot,
      buffer_min: bufferMin,
      start_adres: startAdres,
      max_installaties_per_dag: 2,
      slots: slotsOut,
      beschikbaar,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}
