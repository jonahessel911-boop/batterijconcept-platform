/**
 * Gedeelde “afspraak plannen”-flow voor CRM en webhook.
 */

import { addMinutes } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AMSTERDAM_TZ } from "@/lib/format";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import {
  afspraakBevestigingSequenceEmail,
  afspraakMailVars,
} from "@/lib/email/afspraak-sequence";
import { hasBlockingOverlap } from "@/lib/afspraak-busy";
import {
  afspraakBlokkeertAgenda,
  afspraakDuurMinuten,
  afspraakSoortLabel,
  afspraakStuurtMail,
  isInterneAfspraakSoort,
  leadStatusVoorAfspraakSoort,
  normalizeAfspraakSoort,
} from "@/lib/afspraak-soort";
import { logLeadEvent } from "@/lib/lead-events";
import {
  loadUnavailableWeekKeys,
  weekKeyFromDate,
  weekKeyString,
  isSlotAfgeblokt,
} from "@/lib/adviseur-beschikbaarheid";
import type { AfspraakSoort } from "@/types/database";

export const AFSPRAAK_SELECT =
  "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), adviseurs(naam, email)";

export type PlanAfspraakInput = {
  lead_id: string;
  adviseur_id: string;
  start_at: string | Date;
  notities?: string | null;
  partner_aanwezig?: boolean;
  andere_offertes_gehad?: boolean;
  soort?: string | null;
};

export type PlanAfspraakSuccess = {
  ok: true;
  afspraak: Record<string, unknown>;
  manage_url: string;
  bevestiging_direct: boolean;
  bevestiging_error: string | null;
};

export type PlanAfspraakFailure = {
  ok: false;
  status: number;
  error: string;
  detail?: string;
};

export type PlanAfspraakResult = PlanAfspraakSuccess | PlanAfspraakFailure;

/** Parse ja/nee / true/false / 1/0. */
export function parseJaNee(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") {
    if (raw === 1) return true;
    if (raw === 0) return false;
    return undefined;
  }
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toLowerCase();
  if (["ja", "yes", "true", "1", "y"].includes(v)) return true;
  if (["nee", "no", "false", "0", "n"].includes(v)) return false;
  return undefined;
}

/**
 * start_at: ISO met Z/offset, of Amsterdam-lokaal `YYYY-MM-DDTHH:mm` / `YYYY-MM-DD HH:mm`.
 */
export function parseAfspraakStartAt(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  if (/Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const day = Number(m[3]);
    const h = Number(m[4]);
    const min = Number(m[5]);
    const sec = Number(m[6] || 0);
    return fromZonedTime(new Date(y, mo - 1, day, h, min, sec, 0), AMSTERDAM_TZ);
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function planAfspraak(
  sb: SupabaseClient,
  input: PlanAfspraakInput
): Promise<PlanAfspraakResult> {
  if (!input.lead_id || !input.adviseur_id || !input.start_at) {
    return {
      ok: false,
      status: 400,
      error: "lead_id, adviseur_id en start_at zijn verplicht",
    };
  }

  const soort = normalizeAfspraakSoort(input.soort);
  const isHuisbezoek = soort === "nieuw";

  if (
    isHuisbezoek &&
    (typeof input.partner_aanwezig !== "boolean" ||
      typeof input.andere_offertes_gehad !== "boolean")
  ) {
    return {
      ok: false,
      status: 400,
      error:
        "Partner aanwezig en andere offertes gehad zijn verplicht (ja/nee)",
    };
  }

  const start =
    input.start_at instanceof Date
      ? input.start_at
      : parseAfspraakStartAt(String(input.start_at));
  if (!start || Number.isNaN(start.getTime())) {
    return { ok: false, status: 400, error: "Ongeldige start_at" };
  }
  const end = addMinutes(start, afspraakDuurMinuten(soort));

  const magMailen = afspraakStuurtMail(soort);
  const insertRow = {
    lead_id: input.lead_id,
    adviseur_id: input.adviseur_id,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    status: "bevestigd" as const,
    soort,
    notities: input.notities?.trim() || null,
    partner_aanwezig: isHuisbezoek ? input.partner_aanwezig : null,
    andere_offertes_gehad: isHuisbezoek ? input.andere_offertes_gehad : null,
    bevestiging_verstuurd: !magMailen,
    herinnering_verstuurd: !magMailen,
    opwarm_verstuurd: !magMailen,
  };

  const wk = weekKeyFromDate(start);
  const unavailable = await loadUnavailableWeekKeys(sb, input.adviseur_id, [
    wk.jaar,
  ]);
  if (unavailable.has(weekKeyString(wk.jaar, wk.week))) {
    return {
      ok: false,
      status: 409,
      error: `Deze adviseur is niet beschikbaar in week ${wk.week} (${wk.jaar})`,
    };
  }

  if (await isSlotAfgeblokt(sb, input.adviseur_id, start)) {
    return {
      ok: false,
      status: 409,
      error: "Dit tijdsblok is afgeblokt voor deze adviseur",
    };
  }

  if (afspraakBlokkeertAgenda(soort)) {
    const overlap = await hasBlockingOverlap(sb, {
      adviseurId: input.adviseur_id,
      start,
      end,
    });
    if (overlap) {
      return {
        ok: false,
        status: 409,
        error: "Dit tijdslot is al bezet voor deze adviseur",
      };
    }
  }

  let { data: afspraak, error } = await sb
    .from("afspraken")
    .insert(insertRow)
    .select(AFSPRAAK_SELECT)
    .single();

  if (error && (error.message?.includes("soort") || error.code === "42703")) {
    if (soort !== "nieuw") {
      return {
        ok: false,
        status: 500,
        error:
          "Afspraaksoort niet ondersteund. Voer supabase/migrate-afspraak-vervolg-punt.sql uit in Supabase.",
        detail: error.message,
      };
    }
    const { soort: _soort, ...withoutSoort } = insertRow;
    const retry = await sb
      .from("afspraken")
      .insert(withoutSoort)
      .select(AFSPRAAK_SELECT)
      .single();
    afspraak = retry.data;
    error = retry.error;
  }

  if (error?.message?.includes("opwarm_verstuurd")) {
    const { opwarm_verstuurd: _opwarm, ...rest } = insertRow;
    const retry = await sb
      .from("afspraken")
      .insert(rest)
      .select(AFSPRAAK_SELECT)
      .single();
    afspraak = retry.data;
    error = retry.error;
  }

  if (error || !afspraak) {
    return {
      ok: false,
      status: 500,
      error: "Afspraak opslaan mislukt",
      detail: error?.message,
    };
  }

  return afterCreate(sb, afspraak, input, soort);
}

async function afterCreate(
  sb: SupabaseClient,
  afspraak: {
    id: string;
    start_at: string;
    manage_token: string;
    notities?: string | null;
    leads?: {
      naam?: string | null;
      email?: string | null;
      postcode?: string | null;
      huisnummer?: string | null;
      toevoeging?: string | null;
      straat?: string | null;
      plaats?: string | null;
    } | null;
    adviseurs?: { naam?: string | null } | null;
  },
  body: { lead_id: string; adviseur_id: string },
  soort: AfspraakSoort
): Promise<PlanAfspraakSuccess> {
  const { data: leadRow } = await sb
    .from("leads")
    .select("status")
    .eq("id", body.lead_id)
    .single();
  if (leadRow?.status !== "deal" && !isInterneAfspraakSoort(soort)) {
    await sb
      .from("leads")
      .update({ status: leadStatusVoorAfspraakSoort(soort) })
      .eq("id", body.lead_id);
    const { queueLeadMetaCapi } = await import("@/lib/meta-capi");
    queueLeadMetaCapi(body.lead_id);
  }

  if (soort === "bel" || soort === "warme_bel") {
    await sb
      .from("leads")
      .update({
        terugbellen: true,
        terugbel_notitie: afspraak.notities || null,
        ...(body.adviseur_id ? { adviseur_id: body.adviseur_id } : {}),
      })
      .eq("id", body.lead_id);
  } else if (body.adviseur_id) {
    await sb
      .from("leads")
      .update({ adviseur_id: body.adviseur_id })
      .eq("id", body.lead_id);
  }

  await logLeadEvent({
    leadId: body.lead_id,
    soort: isInterneAfspraakSoort(soort) ? "terugbel" : "afspraak",
    titel: `${afspraakSoortLabel[soort] || soort} gepland`,
    detail: new Date(afspraak.start_at).toLocaleString("nl-NL", {
      timeZone: "Europe/Amsterdam",
    }),
    meta: { afspraak_id: afspraak.id, soort },
  });

  const manageUrl = `${appBaseUrl()}/afspraak/${afspraak.manage_token}`;
  const email = afspraak.leads?.email?.trim();
  const startAt = new Date(afspraak.start_at);

  let mailedNow = false;
  let mailError: string | null = null;
  if (afspraakStuurtMail(soort)) {
    if (email) {
      const vars = afspraakMailVars({
        naam: afspraak.leads?.naam || "klant",
        startAt,
        adviseurNaam: afspraak.adviseurs?.naam || "Batterijconcept",
        manageUrl,
        lead: afspraak.leads,
      });
      const sent = await sendEmail({
        to: email,
        subject: "Afspraak bevestigd — Batterijconcept",
        html: afspraakBevestigingSequenceEmail(vars),
        tag: "afspraak-bevestiging",
      });
      if (sent.ok) {
        await sb
          .from("afspraken")
          .update({ bevestiging_verstuurd: true })
          .eq("id", afspraak.id);
        mailedNow = true;
      } else {
        mailError = sent.error || "Mail versturen mislukt";
      }
    } else {
      mailError = "Lead heeft geen e-mailadres";
    }
  }

  return {
    ok: true,
    afspraak: {
      ...afspraak,
      bevestiging_verstuurd: mailedNow,
    },
    manage_url: manageUrl,
    bevestiging_direct: mailedNow,
    bevestiging_error: mailError,
  };
}
