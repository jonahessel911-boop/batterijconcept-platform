/**
 * POST /api/fonio/webhook/during
 *
 * Fonio During-Call Webhook — live slots / afspraak boeken.
 *
 * Acties (body.action of afgeleid):
 *   "slots"  → beste momenten voor lead_id
 *   "book"   → plan afspraak met slot_id
 *
 * Auth: x-fonio-secret: FONIO_WEBHOOK_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { loadBestSlotsForLead } from "@/lib/api-v1/best-slots";
import { planAfspraak } from "@/lib/plan-afspraak";
import {
  decodeSlotId,
  filterSlotsByVoorkeur,
  parseFonioVoorkeur,
  type FonioDagdeel,
} from "@/lib/api-v1/best-slots";
import {
  authorizeFonioWebhook,
  findRecentFonioOutboundLead,
  phoneMatchVariants,
  pickStr,
  toE164Nl,
} from "@/lib/fonio";
import { formatInTimeZone } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export const runtime = "nodejs";

function hourOf(iso: string): number {
  return Number(formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "H"));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Fonio stuurt soms onopgeloste {{vars}} of AI-verzinsels — filter die eruit. */
function pickResolved(...values: unknown[]): string | null {
  const v = pickStr(...values);
  if (!v) return null;
  if (v.includes("{{") && v.includes("}}")) return null;
  // Fonio UI-redactie / nonsense
  if (/^XFN0X/i.test(v) || v.length < 8) return null;
  return v;
}

function pickUuid(...values: unknown[]): string | null {
  const v = pickResolved(...values);
  if (!v || !UUID_RE.test(v)) return null;
  return v;
}

async function resolveLeadId(
  body: Record<string, unknown>
): Promise<{ leadId: string | null; error?: string; via?: string }> {
  const ctx =
    body.context && typeof body.context === "object"
      ? (body.context as Record<string, unknown>)
      : null;

  const uuid = pickUuid(
    body.lead_id,
    body.leadId,
    body.leadID,
    ctx?.lead_id,
    ctx?.leadId
  );
  if (uuid) return { leadId: uuid, via: "lead_id" };

  const sb = getSupabaseAdmin();

  const leadNumber = pickResolved(
    body.lead_number,
    body.leadNumber,
    ctx?.lead_number,
    ctx?.leadNumber
  );
  if (leadNumber) {
    const { data: byNr } = await sb
      .from("leads")
      .select("id")
      .eq("lead_number", leadNumber)
      .maybeSingle();
    if (byNr?.id) return { leadId: byNr.id, via: "lead_number" };
  }

  const phone = pickResolved(
    body.telefoon,
    body.phone,
    body.toNumber,
    body.to_number,
    body.fromNumber,
    body.from_number,
    ctx?.telefoon,
    ctx?.phone,
    ctx?.toNumber
  );
  const e164 = toE164Nl(phone);
  if (e164) {
    const variants = phoneMatchVariants(phone);
    const { data: leads } = await sb
      .from("leads")
      .select("id, telefoon")
      .or(variants.map((v) => `telefoon.eq.${v}`).join(","))
      .order("created_at", { ascending: false })
      .limit(5);

    const lead =
      (leads || []).find((l) => toE164Nl(l.telefoon) === e164) || leads?.[0];
    if (lead?.id) return { leadId: lead.id, via: "telefoon" };
  }

  const badLeadId = pickStr(body.lead_id, body.leadId, ctx?.lead_id);

  // Fonio stuurt soms action:"slots" met lege lead_id/telefoon (context-vars
  // niet gekoppeld). Fallback: meest recente outbound-call.
  const recentId = await findRecentFonioOutboundLead(30);
  if (recentId) {
    return { leadId: recentId, via: "recent_outbound" };
  }

  return {
    leadId: null,
    error: badLeadId
      ? `Ongeldige lead_id ontvangen ("${String(badLeadId).slice(0, 40)}"). Gebruik in Fonio {{context.lead_id}} via Add Variable, geen custom variable.`
      : "lead_id / lead_number / telefoon ontbreekt of matcht geen lead",
  };
}

export async function POST(req: NextRequest) {
  const auth = authorizeFonioWebhook(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const actionRaw = pickStr(body.action, body.soort, body.intent)?.toLowerCase();
  const slotId = pickStr(body.slot_id, body.slotId);
  const action =
    actionRaw === "book" || actionRaw === "plan" || slotId
      ? "book"
      : actionRaw === "check" ||
          actionRaw === "voorkeur" ||
          actionRaw === "beschikbaarheid"
        ? "check"
        : actionRaw === "slots" || !actionRaw
          ? "slots"
          : actionRaw;

  try {
    const { leadId, error: leadErr } = await resolveLeadId(body);
    if (!leadId) {
      // 200 i.p.v. 404: Fonio toont anders "Failed" i.p.v. de spoken tekst
      console.warn("Fonio during: geen lead", { body, leadErr });
      return NextResponse.json({
        ok: false,
        error: leadErr || "Lead niet gevonden",
        spoken:
          "Ik kan je gegevens nu niet vinden. Mag ik je naam en postcode even noteren, dan belt een adviseur je terug.",
      });
    }

    const sb = getSupabaseAdmin();

    const loadPool = () =>
      loadBestSlotsForLead(sb, {
        leadId,
        daysAhead: 14,
        limit: 3,
        poolSize: 48,
        diversifyHours: true,
      });

    const preferRaw = pickStr(
      body.voorkeur,
      body.preference,
      body.gewenst,
      body.dagdeel,
      body.tijd
    );
    const preferParsed = parseFonioVoorkeur(preferRaw);
    const dagdeelDirect = pickStr(body.dagdeel, body.daypart)?.toLowerCase() as
      | FonioDagdeel
      | null;
    if (
      dagdeelDirect === "ochtend" ||
      dagdeelDirect === "middag" ||
      dagdeelDirect === "avond"
    ) {
      preferParsed.dagdeel = dagdeelDirect;
    }

    if (action === "slots" || action === "check") {
      const result = await loadPool();
      if (!result.ok) {
        return NextResponse.json({
          ok: false,
          error: result.error,
          spoken:
            "Ik zie nu geen vrije momenten in de agenda. Een adviseur belt je zo snel mogelijk terug.",
        });
      }

      const hasVoorkeur = Boolean(
        preferParsed.dagdeel || preferParsed.weekday || preferParsed.date
      );

      // Klant vraagt specifiek moment → check of dat kan
      if (action === "check" || hasVoorkeur) {
        const allRes = await loadBestSlotsForLead(sb, {
          leadId,
          daysAhead: 14,
          limit: 20,
          diversifyHours: false,
        });
        const pool = allRes.ok ? allRes.slots : result.slots;
        const matches = filterSlotsByVoorkeur(pool, preferParsed).slice(0, 3);

        if (matches.length === 0) {
          const alt = result.slots;
          const altList = alt.map((s, i) => `optie ${i + 1}: ${s.label_nl}`).join("; ");
          return NextResponse.json({
            ok: true,
            action: "check",
            beschikbaar: false,
            lead_id: leadId,
            voorkeur: preferParsed,
            opties: alt.map((s, i) => ({
              nr: i + 1,
              slot_id: s.slot_id,
              label: s.label_nl,
              label_kort: s.label_kort,
              start_at: s.start_at,
            })),
            spoken: alt.length
              ? `Dat moment lukt helaas niet. Wel kan ik: ${altList}. Welke past?`
              : "Dat moment lukt niet, en ik zie nu geen alternatieven. Een adviseur belt je terug.",
          });
        }

        const opties = matches.map((s, i) => ({
          nr: i + 1,
          slot_id: s.slot_id,
          label: s.label_nl,
          label_kort: s.label_kort,
          start_at: s.start_at,
        }));
        const spokenList = opties.map((o) => `optie ${o.nr}: ${o.label}`).join("; ");
        return NextResponse.json({
          ok: true,
          action: "check",
          beschikbaar: true,
          lead_id: leadId,
          voorkeur: preferParsed,
          count: opties.length,
          opties,
          spoken: `Dat kan. Ik heb: ${spokenList}. Zal ik er één voor je vastleggen?`,
        });
      }

      const opties = result.slots.map((s, i) => ({
        nr: i + 1,
        slot_id: s.slot_id,
        label: s.label_nl,
        label_kort: s.label_kort,
        start_at: s.start_at,
        dagdeel:
          hourOf(s.start_at) === 10
            ? "ochtend"
            : hourOf(s.start_at) === 19
              ? "avond"
              : "middag",
      }));

      const spokenList = opties
        .map((o) => `optie ${o.nr}: ${o.label}`)
        .join("; ");

      return NextResponse.json({
        ok: true,
        action: "slots",
        lead_id: leadId,
        count: opties.length,
        slots_tekst: result.slots_tekst,
        opties,
        spoken: opties.length
          ? `Ik heb ${opties.length} momenten op verschillende dagen: ${spokenList}. Welke past het beste?`
          : "Ik zie nu geen vrije momenten. Een adviseur belt je terug.",
      });
    }

    if (action === "book") {
      let resolvedSlotId = slotId;

      // Stem: "optie 2" → opnieuw slots laden en index kiezen
      if (!resolvedSlotId) {
        const keuzeRaw = pickStr(
          body.optie,
          body.keuze,
          body.nr,
          body.option,
          body.slot_nr
        );
        const keuzeNum = keuzeRaw
          ? Number(String(keuzeRaw).replace(/[^\d]/g, ""))
          : NaN;
        if (Number.isFinite(keuzeNum) && keuzeNum >= 1) {
          const slotsRes = await loadPool();
          if (slotsRes.ok && slotsRes.slots[keuzeNum - 1]) {
            resolvedSlotId = slotsRes.slots[keuzeNum - 1].slot_id;
          }
        }
      }

      if (!resolvedSlotId) {
        return NextResponse.json({
          ok: false,
          error: "slot_id of optie (1/2/3) verplicht om te boeken",
          spoken:
            "Welk van de momenten wil je? Noem optie 1, 2 of 3, dan plan ik die in.",
        });
      }

      const token = decodeSlotId(resolvedSlotId);
      if (!token) {
        return NextResponse.json({
          ok: false,
          error: "Ongeldige slot_id",
          spoken:
            "Dat moment is niet meer geldig. Zal ik opnieuw beschikbare tijden opzoeken?",
        });
      }

      const partnerRaw = body.partner_aanwezig ?? body.partnerAanwezig ?? body.partner;
      const offertesRaw =
        body.andere_offertes_gehad ?? body.andereOffertes ?? body.offertes;
      const asBool = (v: unknown, fallback: boolean): boolean => {
        if (typeof v === "boolean") return v;
        if (typeof v === "string") {
          if (/^(ja|yes|true|1)$/i.test(v.trim())) return true;
          if (/^(nee|no|false|0)$/i.test(v.trim())) return false;
        }
        return fallback;
      };
      const partnerAanwezig = asBool(partnerRaw, true);
      const andereOffertes = asBool(offertesRaw, false);

      const result = await planAfspraak(sb, {
        lead_id: leadId,
        adviseur_id: token.a,
        start_at: token.s,
        soort: "nieuw",
        notities: "Ingepland via Fonio",
        partner_aanwezig: partnerAanwezig,
        andere_offertes_gehad: andereOffertes,
      });

      if (!result.ok) {
        return NextResponse.json({
          ok: false,
          error: result.error,
          spoken:
            "Dat moment lukte net niet om in te plannen. Zal ik een ander moment voorstellen?",
        });
      }

      return NextResponse.json({
        ok: true,
        action: "book",
        lead_id: leadId,
        afspraak_id: result.afspraak?.id || null,
        start_at: result.afspraak?.start_at || token.s,
        manage_url: result.manage_url || null,
        spoken:
          "Top, je afspraak staat genoteerd. Je ontvangt een bevestiging per mail. Tot dan!",
      });
    }

    return NextResponse.json({
      ok: false,
      error: `Onbekende action: ${action}`,
      hint: 'Gebruik action "slots" of "book"',
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: errMessage(e, "During-call mislukt"),
        spoken: "Er ging even iets mis aan mijn kant. Een collega belt je terug.",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/fonio/webhook/during",
    method: "POST",
    auth: "x-fonio-secret: FONIO_WEBHOOK_SECRET",
    actions: {
      slots: {
        body: { action: "slots", lead_id: "uuid" },
        note: "Geeft opties[] + spoken tekst voor de assistant",
      },
      book: {
        body: { action: "book", lead_id: "uuid", slot_id: "…" },
        note: "Plant huisbezoek via planAfspraak",
      },
    },
    fonio_tip:
      "Maak 2 during-call webhooks of 1 met dynamic param action=slots|book. Stuur altijd lead_id mee uit outbound context.",
  });
}
