import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateAvailableSlots, generateDayBlocks } from "@/lib/slots";
import { blockingBusySlots } from "@/lib/afspraak-busy";
import {
  appBaseUrl,
  sendEmail,
} from "@/lib/email/postmark";
import { teamWelkomEmail } from "@/lib/email/templates";
import {
  generatePassword,
  hashPassword,
} from "@/lib/auth-password";
import { cookies } from "next/headers";
import { errMessage } from "@/lib/errors";
import type { Adviseur } from "@/types/database";
import {
  GEBRUIKER_ROLLEN,
  normalizeRol,
} from "@/lib/rollen";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { logRelatieActiviteit } from "@/lib/relatie-activiteit";
import {
  afblokKey,
  blockAgendaUntilStartdatum,
  dayKeyAmsterdam,
  filterSlotsByAfblokkingen,
  filterSlotsByStartdatum,
  filterSlotsByBeschikbaarheid,
  isDateUnavailable,
  isSlotGeblokkeerd,
  loadAfblokkingen,
  loadSlotVrijgaven,
  loadUnavailableWeekKeys,
  nearestSlotHour,
} from "@/lib/adviseur-beschikbaarheid";
import { addDays, getISOWeekYear } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export const runtime = "nodejs";

const ADVISEUR_PUBLIC =
  "id, naam, email, telefoon, actief, geblokkeerd, werktijd_start, werktijd_eind, start_adres, startdatum, bel_planning, rol, commissie_pct, bedrijfsnaam, kvk_nummer, btw_nummer, factuur_adres, factuur_postcode, factuur_plaats, iban, max_factuur_bedrag, contract_storage_path, contract_bestandsnaam, contract_uploaded_at, contract_sign_token, contract_sign_status, contract_sent_at, contract_signed_at, kvk_uitreksel_storage_path, kvk_uitreksel_bestandsnaam, kvk_uitreksel_uploaded_at, interne_notities, created_at, updated_at";
/** Zonder geblokkeerd — tot migrate-adviseur-geblokkeerd.sql is gedraaid. */
const ADVISEUR_PUBLIC_FALLBACK =
  "id, naam, email, telefoon, actief, werktijd_start, werktijd_eind, start_adres, rol, commissie_pct, bedrijfsnaam, kvk_nummer, btw_nummer, factuur_adres, factuur_postcode, factuur_plaats, iban, max_factuur_bedrag, created_at, updated_at";
const ADVISEUR_PUBLIC_MID =
  "id, naam, email, telefoon, actief, werktijd_start, werktijd_eind, start_adres, rol, commissie_pct, created_at, updated_at";
const ADVISEUR_PUBLIC_MIN =
  "id, naam, email, telefoon, actief, werktijd_start, werktijd_eind, created_at, updated_at";

function parseStartdatum(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  return v;
}

type SbError = { code?: string; message?: string } | null;

/** Ontbrekende kolom (Postgres 42703 of PostgREST schema-cache). */
function isMissingColumn(error: SbError, column: string): boolean {
  if (!error?.message) return false;
  const msg = error.message;
  const mentions =
    msg.includes(`'${column}'`) ||
    msg.includes(`"${column}"`) ||
    new RegExp(`\\b${column}\\b`).test(msg);
  if (!mentions) return false;
  return (
    error.code === "42703" ||
    /does not exist/i.test(msg) ||
    /schema cache/i.test(msg) ||
    /could not find/i.test(msg)
  );
}

function isRolCheckViolation(error: SbError): boolean {
  if (!error) return false;
  return (
    error.code === "23514" ||
    (error.message?.includes("adviseurs_rol_check") ?? false)
  );
}

function isSchemaCompatError(error: SbError): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "23514") return true;
  const msg = error.message || "";
  return (
    /does not exist/i.test(msg) ||
    /schema cache/i.test(msg) ||
    /could not find/i.test(msg) ||
    msg.includes("adviseurs_rol_check") ||
    msg.includes("start_adres") ||
    msg.includes("bel_planning") ||
    msg.includes("commissie_pct") ||
    msg.includes("bedrijfsnaam") ||
    msg.includes("kvk_nummer") ||
    msg.includes("max_factuur_bedrag") ||
    msg.includes("startdatum") ||
    isMissingColumn(error, "rol")
  );
}

function stripHash(row: Record<string, unknown>): Adviseur {
  const copy = { ...row };
  delete copy.password_hash;
  return copy as unknown as Adviseur;
}

/** GET /api/adviseurs — lijst + optioneel ?adviseur_id= voor slots */
export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const adviseurId = req.nextUrl.searchParams.get("adviseur_id");
    // Eigen agenda (adviseur_id) altijd ophalen, ook als inactief.
    const includeInactive =
      req.nextUrl.searchParams.get("include_inactive") === "1" ||
      Boolean(adviseurId);

    let query = sb
      .from("adviseurs")
      .select(ADVISEUR_PUBLIC)
      .order("naam");
    if (!includeInactive) {
      query = query.eq("actief", true);
    }

    let { data: adviseurs, error } = await query;
    if (
      error &&
      (error.code === "42703" ||
        error.code === "PGRST204" ||
        error.message?.includes("start_adres") ||
        error.message?.includes("startdatum") ||
        error.message?.includes("bel_planning") ||
        error.message?.includes("geblokkeerd") ||
        error.message?.includes("rol") ||
        error.message?.includes("commissie_pct") ||
        error.message?.includes("bedrijfsnaam") ||
        error.message?.includes("kvk_nummer") ||
        error.message?.includes("max_factuur_bedrag") ||
        error.message?.includes("contract_storage_path") ||
        error.message?.includes("contract_sign_token") ||
        error.message?.includes("contract_sign_status"))
    ) {
      let retry = sb
        .from("adviseurs")
        .select(ADVISEUR_PUBLIC_FALLBACK)
        .order("naam");
      if (!includeInactive) retry = retry.eq("actief", true);
      const second = await retry;
      if (
        second.error &&
        (second.error.code === "42703" ||
          second.error.message?.includes("bedrijfsnaam") ||
          second.error.message?.includes("kvk_nummer") ||
          second.error.message?.includes("max_factuur_bedrag"))
      ) {
        let mid = sb
          .from("adviseurs")
          .select(ADVISEUR_PUBLIC_MID)
          .order("naam");
        if (!includeInactive) mid = mid.eq("actief", true);
        const midRes = await mid;
        if (
          midRes.error &&
          (midRes.error.code === "42703" ||
            midRes.error.message?.includes("start_adres") ||
            midRes.error.message?.includes("commissie_pct") ||
            midRes.error.message?.includes("rol"))
        ) {
          let bare = sb
            .from("adviseurs")
            .select(ADVISEUR_PUBLIC_MIN)
            .order("naam");
          if (!includeInactive) bare = bare.eq("actief", true);
          const third = await bare;
          adviseurs = (third.data || null) as typeof adviseurs;
          error = third.error;
        } else {
          adviseurs = (midRes.data || null) as typeof adviseurs;
          error = midRes.error;
        }
      } else {
        adviseurs = (second.data || null) as typeof adviseurs;
        error = second.error;
      }
    }
    if (error) throw error;

    if (!adviseurId) {
      return NextResponse.json({ adviseurs: adviseurs || [] });
    }

    const adviseur = (adviseurs || []).find((a) => a.id === adviseurId);
    if (!adviseur) {
      return NextResponse.json({ error: "Adviseur niet gevonden" }, { status: 404 });
    }

    const busyRows = await blockingBusySlots(sb, adviseurId);
    const rawSlots = generateAvailableSlots({
      busy: busyRows,
    }).map((s) => ({
      start_at: s.start.toISOString(),
      end_at: s.end.toISOString(),
    }));
    const rawBlocks = generateDayBlocks({
      busy: busyRows,
    }).map((s) => ({
      start_at: s.start.toISOString(),
      end_at: s.end.toISOString(),
      busy: s.busy,
    }));

    const nowLocal = toZonedTime(new Date(), AMSTERDAM_TZ);
    const y = getISOWeekYear(nowLocal);
    const unavailable = await loadUnavailableWeekKeys(sb, adviseurId, [
      y - 1,
      y,
      y + 1,
    ]);
    const van = dayKeyAmsterdam(new Date());
    const tot = dayKeyAmsterdam(addDays(new Date(), 40));
    const [afgeblokt, vrijgaven] = await Promise.all([
      loadAfblokkingen(sb, {
        adviseurIds: [adviseurId],
        van,
        tot,
      }),
      loadSlotVrijgaven(sb, {
        adviseurIds: [adviseurId],
        van,
        tot,
      }),
    ]);
    const startdatum =
      (adviseur as { startdatum?: string | null }).startdatum ?? null;
    const slots = filterSlotsByStartdatum(
      filterSlotsByAfblokkingen(
        filterSlotsByBeschikbaarheid(rawSlots, unavailable),
        adviseurId,
        afgeblokt,
        vrijgaven
      ),
      startdatum
    );
    // Blocks: alle dagblokken houden (ook fysiek bezet / afgeblokt), gemarkeerd
    // met busy — nodig voor telefonisch vervolg over een bezet slot.
    // slots blijft alleen vrije (huisbezoek) opties.
    const blocks = filterSlotsByStartdatum(
      filterSlotsByBeschikbaarheid(rawBlocks, unavailable),
      startdatum
    ).map((b) => {
      const blocked = isSlotGeblokkeerd(
        adviseurId,
        dayKeyAmsterdam(b.start_at),
        nearestSlotHour(b.start_at),
        afgeblokt,
        vrijgaven
      );
      return {
        ...b,
        busy:
          b.busy ||
          blocked ||
          isDateUnavailable(new Date(b.start_at), unavailable),
      };
    });

    return NextResponse.json({
      adviseurs: adviseurs || [],
      slots,
      blocks,
      unavailable_weeks: [...unavailable],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** POST /api/adviseurs — nieuw teamlid + welkomstmail met wachtwoord */
export async function POST(req: NextRequest) {
  let body: {
    naam?: string;
    email?: string;
    telefoon?: string;
    rol?: string;
    commissie_pct?: number | null;
    startdatum?: string | null;
    bedrijfsnaam?: string | null;
    kvk_nummer?: string | null;
    btw_nummer?: string | null;
    factuur_adres?: string | null;
    factuur_postcode?: string | null;
    factuur_plaats?: string | null;
    iban?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const naam = body.naam?.trim();
  const email = body.email?.trim().toLowerCase();
  const rol = normalizeRol(body.rol);
  if (!naam) {
    return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json(
      { error: "E-mail is verplicht (voor login + welkomstmail)" },
      { status: 400 }
    );
  }
  if (!GEBRUIKER_ROLLEN.includes(rol)) {
    return NextResponse.json({ error: "Ongeldige rol" }, { status: 400 });
  }

  const startdatum = parseStartdatum(body.startdatum);
  if (body.startdatum !== undefined && body.startdatum !== null && body.startdatum !== "" && startdatum === undefined) {
    return NextResponse.json(
      { error: "Startdatum moet yyyy-MM-dd zijn" },
      { status: 400 }
    );
  }
  if (rol === "adviseur" && !startdatum) {
    return NextResponse.json(
      { error: "Startdatum is verplicht voor adviseurs" },
      { status: 400 }
    );
  }

  const kvkFields = {
    bedrijfsnaam: body.bedrijfsnaam?.trim() || null,
    kvk_nummer: body.kvk_nummer?.trim() || null,
    btw_nummer: body.btw_nummer?.trim() || null,
    factuur_adres: body.factuur_adres?.trim() || null,
    factuur_postcode: body.factuur_postcode?.trim() || null,
    factuur_plaats: body.factuur_plaats?.trim() || null,
    iban: body.iban?.trim().toUpperCase() || null,
  };

  // Standaard 10% commissie voor sales-adviseurs; anders null/0.
  const isSales = rol === "adviseur";
  let commissiePct: number | null = null;
  if (isSales) {
    const raw =
      body.commissie_pct === undefined || body.commissie_pct === null
        ? 10
        : Number(body.commissie_pct);
    if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
      return NextResponse.json(
        { error: "Commissie moet tussen 0 en 100% zijn" },
        { status: 400 }
      );
    }
    commissiePct = Math.round(raw * 100) / 100;
  }

  try {
    const sb = getSupabaseAdmin();
    const password = generatePassword(12);
    const password_hash = hashPassword(password);

    const baseRow: Record<string, unknown> = {
      naam,
      email,
      telefoon: body.telefoon?.trim() || null,
      password_hash,
      actief: true,
      rol,
      ...(commissiePct != null ? { commissie_pct: commissiePct } : {}),
      ...kvkFields,
    };
    if (startdatum !== undefined) baseRow.startdatum = startdatum;

    let insert = await sb
      .from("adviseurs")
      .insert(baseRow)
      .select(ADVISEUR_PUBLIC)
      .single();

    // Select/insert faalt op ontbrekende startdatum-kolom → retry zonder die kolom
    if (
      insert.error &&
      (isMissingColumn(insert.error, "startdatum") ||
        insert.error.message?.includes("startdatum") ||
        insert.error.code === "PGRST204")
    ) {
      if (startdatum) {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-adviseur-startdatum.sql uit in Supabase.",
            detail: insert.error.message,
          },
          { status: 503 }
        );
      }
      const withoutStart = { ...baseRow };
      delete withoutStart.startdatum;
      insert = await sb
        .from("adviseurs")
        .insert(withoutStart)
        .select(ADVISEUR_PUBLIC_FALLBACK)
        .single();
    }

    // Kolom password_hash / rol nog niet gemigreerd
    if (
      insert.error &&
      (insert.error.message?.includes("password_hash") ||
        insert.error.message?.includes("rol") ||
        insert.error.code === "42703")
    ) {
      const fallback: Record<string, unknown> = {
        naam,
        email,
        telefoon: body.telefoon?.trim() || null,
        actief: true,
        password_hash,
      };
      if (insert.error.message?.includes("rol")) {
        // password ok, rol mist
      } else {
        delete fallback.password_hash;
      }
      insert = await sb
        .from("adviseurs")
        .insert(fallback)
        .select(ADVISEUR_PUBLIC_FALLBACK)
        .single();

      if (insert.error || !insert.data) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-adviseur-password.sql en migrate-rollen.sql uit in Supabase.",
            detail: insert.error?.message,
          },
          { status: 503 }
        );
      }
    }

    if (insert.error || !insert.data) {
      return NextResponse.json(
        { error: insert.error?.message || "Opslaan mislukt" },
        { status: 500 }
      );
    }

    let agendaBlocked: { blockedDays: number; blockedSlots: number } | null =
      null;
    if (startdatum) {
      try {
        agendaBlocked = await blockAgendaUntilStartdatum(
          sb,
          insert.data.id as string,
          startdatum
        );
      } catch (blockErr) {
        console.error("startdatum afblokken mislukt:", blockErr);
      }
    }

    const loginUrl = `${appBaseUrl()}/login`;
    const html = teamWelkomEmail({
      naam,
      email,
      password,
      loginUrl,
    });
    const sent = await sendEmail({
      to: email,
      subject: `Welkom bij het team, ${naam}`,
      html,
      tag: "team-welkom",
    });

    return NextResponse.json(
      {
        adviseur: stripHash(insert.data as Record<string, unknown>),
        mail_sent: sent.ok,
        mail_error: sent.error,
        agenda_blocked: agendaBlocked,
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** PATCH /api/adviseurs — bijwerken / deactiveren / opnieuw uitnodigen / wachtwoord */
export async function PATCH(req: NextRequest) {
  let body: {
    id?: string;
    naam?: string;
    email?: string | null;
    telefoon?: string | null;
    actief?: boolean;
    geblokkeerd?: boolean;
    start_adres?: string | null;
    startdatum?: string | null;
    bel_planning?: boolean;
    rol?: string;
    commissie_pct?: number | null;
    bedrijfsnaam?: string | null;
    kvk_nummer?: string | null;
    btw_nummer?: string | null;
    factuur_adres?: string | null;
    factuur_postcode?: string | null;
    factuur_plaats?: string | null;
    iban?: string | null;
    max_factuur_bedrag?: number | null;
    interne_notities?: string | null;
    resend_invite?: boolean;
    password?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: "id is verplicht" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    if (body.resend_invite) {
      const { data: current, error: fetchErr } = await sb
        .from("adviseurs")
        .select("id, naam, email")
        .eq("id", body.id)
        .single();
      if (fetchErr || !current?.email) {
        return NextResponse.json(
          { error: "Adviseur of e-mail niet gevonden" },
          { status: 404 }
        );
      }

      const password = generatePassword(12);
      const password_hash = hashPassword(password);
      const { data, error } = await sb
        .from("adviseurs")
        .update({ password_hash })
        .eq("id", body.id)
        .select(ADVISEUR_PUBLIC)
        .single();

      if (error || !data) {
        return NextResponse.json(
          {
            error:
              error?.message?.includes("password_hash")
                ? "Voer migrate-adviseur-password.sql uit in Supabase"
                : error?.message || "Bijwerken mislukt",
          },
          { status: 500 }
        );
      }

      const loginUrl = `${appBaseUrl()}/login`;
      const sent = await sendEmail({
        to: current.email,
        subject: `Welkom bij het team, ${current.naam}`,
        html: teamWelkomEmail({
          naam: current.naam,
          email: current.email,
          password,
          loginUrl,
        }),
        tag: "team-welkom",
      });

      return NextResponse.json({
        adviseur: data,
        mail_sent: sent.ok,
        mail_error: sent.error,
      });
    }

    if (typeof body.password === "string") {
      const password = body.password.trim();
      if (password.length < 8) {
        return NextResponse.json(
          { error: "Wachtwoord moet minstens 8 tekens zijn" },
          { status: 400 }
        );
      }

      const { data, error } = await sb
        .from("adviseurs")
        .update({ password_hash: hashPassword(password) })
        .eq("id", body.id)
        .select(ADVISEUR_PUBLIC)
        .single();

      if (error || !data) {
        return NextResponse.json(
          {
            error:
              error?.message?.includes("password_hash")
                ? "Voer migrate-adviseur-password.sql uit in Supabase"
                : error?.message || "Wachtwoord bijwerken mislukt",
          },
          { status: 500 }
        );
      }

      return NextResponse.json({ adviseur: data, password_updated: true });
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.naam === "string" && body.naam.trim()) {
      patch.naam = body.naam.trim();
    }
    if (body.email !== undefined) {
      patch.email = body.email?.trim().toLowerCase() || null;
    }
    if (body.telefoon !== undefined) {
      patch.telefoon = body.telefoon?.trim() || null;
    }
    if (typeof body.actief === "boolean") {
      patch.actief = body.actief;
    }
    if (typeof body.geblokkeerd === "boolean") {
      patch.geblokkeerd = body.geblokkeerd;
    }
    if (body.start_adres !== undefined) {
      patch.start_adres = body.start_adres?.trim() || null;
    }
    if (body.startdatum !== undefined) {
      const sd = parseStartdatum(body.startdatum);
      if (sd === undefined) {
        return NextResponse.json(
          { error: "Startdatum moet yyyy-MM-dd zijn" },
          { status: 400 }
        );
      }
      patch.startdatum = sd;
    }
    if (typeof body.bel_planning === "boolean") {
      patch.bel_planning = body.bel_planning;
    }
    if (body.rol !== undefined) {
      const r = normalizeRol(body.rol);
      if (!GEBRUIKER_ROLLEN.includes(r)) {
        return NextResponse.json({ error: "Ongeldige rol" }, { status: 400 });
      }
      patch.rol = r;
    }
    if (body.commissie_pct !== undefined) {
      const pct = Number(body.commissie_pct) || 0;
      if (pct < 0 || pct > 100) {
        return NextResponse.json(
          { error: "Commissie moet tussen 0 en 100% zijn" },
          { status: 400 }
        );
      }
      patch.commissie_pct = Math.round(pct * 100) / 100;
    }

    const zzpFields = [
      "bedrijfsnaam",
      "kvk_nummer",
      "btw_nummer",
      "factuur_adres",
      "factuur_postcode",
      "factuur_plaats",
      "iban",
    ] as const;
    for (const key of zzpFields) {
      if (body[key] !== undefined) {
        const v = body[key];
        patch[key] = typeof v === "string" ? v.trim() || null : null;
      }
    }
    if (body.max_factuur_bedrag !== undefined) {
      if (body.max_factuur_bedrag === null || body.max_factuur_bedrag === ("" as unknown)) {
        patch.max_factuur_bedrag = null;
      } else {
        const max = Number(body.max_factuur_bedrag);
        if (!Number.isFinite(max) || max < 0) {
          return NextResponse.json(
            { error: "Max factuurbedrag ongeldig" },
            { status: 400 }
          );
        }
        patch.max_factuur_bedrag = Math.round(max * 100) / 100;
      }
    }
    if (body.interne_notities !== undefined) {
      patch.interne_notities =
        typeof body.interne_notities === "string"
          ? body.interne_notities.trim() || null
          : null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
    }

    let { data, error } = await sb
      .from("adviseurs")
      .update(patch)
      .eq("id", body.id)
      .select(ADVISEUR_PUBLIC)
      .single();

    if (error && isSchemaCompatError(error)) {
      if (isRolCheckViolation(error)) {
        return NextResponse.json(
          {
            error:
              "Deze rol is nog niet toegestaan in de database. Voer supabase/migrate-beller-rol.sql uit (of opnieuw migrate-rollen.sql).",
            detail: error.message,
          },
          { status: 503 }
        );
      }

      if (isMissingColumn(error, "rol") && patch.rol !== undefined) {
        return NextResponse.json(
          {
            error: "Voer eerst supabase/migrate-rollen.sql uit in Supabase.",
            detail: error.message,
          },
          { status: 503 }
        );
      }

      const creditKeys = [
        "bedrijfsnaam",
        "kvk_nummer",
        "btw_nummer",
        "factuur_adres",
        "factuur_postcode",
        "factuur_plaats",
        "iban",
        "max_factuur_bedrag",
      ] as const;
      const wantsCredit = creditKeys.some((k) => patch[k] !== undefined);
      if (
        wantsCredit &&
        creditKeys.some((k) => isMissingColumn(error, k))
      ) {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-adviseur-creditfacturen.sql uit in Supabase.",
            detail: error.message,
          },
          { status: 503 }
        );
      }

      if (
        patch.commissie_pct !== undefined &&
        isMissingColumn(error, "commissie_pct")
      ) {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-adviseur-beschikbaarheid.sql uit in Supabase.",
            detail: error.message,
          },
          { status: 503 }
        );
      }

      if (
        patch.interne_notities !== undefined &&
        isMissingColumn(error, "interne_notities")
      ) {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-team-interne-notities.sql uit in Supabase.",
            detail: error.message,
          },
          { status: 503 }
        );
      }

      if (
        patch.geblokkeerd !== undefined &&
        isMissingColumn(error, "geblokkeerd")
      ) {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-adviseur-geblokkeerd.sql uit in Supabase.",
            detail: error.message,
          },
          { status: 503 }
        );
      }

      if (
        patch.start_adres !== undefined &&
        isMissingColumn(error, "start_adres")
      ) {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-adviseur-startadres.sql uit in Supabase.",
            detail: error.message,
          },
          { status: 503 }
        );
      }

      if (
        patch.bel_planning !== undefined &&
        isMissingColumn(error, "bel_planning")
      ) {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-adviseur-bel-planning.sql uit in Supabase.",
            detail: error.message,
          },
          { status: 503 }
        );
      }

      if (
        patch.startdatum !== undefined &&
        isMissingColumn(error, "startdatum")
      ) {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-adviseur-startdatum.sql uit in Supabase.",
            detail: error.message,
          },
          { status: 503 }
        );
      }

      // Update ok / select faalt op optionele kolommen → retry met smaller select.
      // Strip ook optionele patch-velden die nog niet bestaan.
      const slimPatch = { ...patch };
      for (const k of creditKeys) delete slimPatch[k];
      if (isMissingColumn(error, "commissie_pct")) {
        delete slimPatch.commissie_pct;
      }
      if (isMissingColumn(error, "start_adres")) {
        delete slimPatch.start_adres;
      }
      if (isMissingColumn(error, "bel_planning")) {
        delete slimPatch.bel_planning;
      }
      if (isMissingColumn(error, "startdatum")) {
        delete slimPatch.startdatum;
      }
      if (isMissingColumn(error, "rol")) {
        delete slimPatch.rol;
      }
      if (isMissingColumn(error, "geblokkeerd")) {
        delete slimPatch.geblokkeerd;
      }

      const retry = await sb
        .from("adviseurs")
        .update(slimPatch)
        .eq("id", body.id)
        .select(ADVISEUR_PUBLIC_FALLBACK)
        .single();

      if (
        retry.error &&
        (isMissingColumn(retry.error, "start_adres") ||
          isMissingColumn(retry.error, "rol") ||
          isMissingColumn(retry.error, "commissie_pct") ||
          retry.error.code === "42703")
      ) {
        const minPatch = { ...slimPatch };
        delete minPatch.start_adres;
        delete minPatch.rol;
        delete minPatch.commissie_pct;
        const bare = await sb
          .from("adviseurs")
          .update(minPatch)
          .eq("id", body.id)
          .select(ADVISEUR_PUBLIC_MIN)
          .single();
        data = bare.data as typeof data;
        error = bare.error;
      } else {
        data = retry.data as typeof data;
        error = retry.error;
      }
    }

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Bijwerken mislukt" },
        { status: 500 }
      );
    }

    let agendaBlocked: { blockedDays: number; blockedSlots: number } | null =
      null;
    if (typeof patch.startdatum === "string" && patch.startdatum) {
      try {
        agendaBlocked = await blockAgendaUntilStartdatum(
          sb,
          body.id,
          patch.startdatum
        );
      } catch (blockErr) {
        console.error("startdatum afblokken mislukt:", blockErr);
      }
    }

    if (typeof patch.iban === "string" && patch.iban.trim()) {
      await logRelatieActiviteit(sb, {
        kind: "adviseur",
        relatieId: body.id,
        soort: "iban",
        titel: "IBAN opgeslagen",
        detail: String(patch.iban),
      });
    }

    return NextResponse.json({
      adviseur: data,
      agenda_blocked: agendaBlocked,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/adviseurs?id=…
 * Verwijdert een team-account. Alleen admin. Je kunt jezelf niet verwijderen.
 * Bij gekoppelde data: deactiveert + login uit (soft delete).
 */
export async function DELETE(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    if (normalizeRol(session.rol) !== "admin") {
      return NextResponse.json(
        { error: "Alleen admin mag accounts verwijderen" },
        { status: 403 }
      );
    }

    const id = req.nextUrl.searchParams.get("id")?.trim() || "";
    if (!id) {
      return NextResponse.json({ error: "id is verplicht" }, { status: 400 });
    }
    if (id === session.adviseurId) {
      return NextResponse.json(
        { error: "Je kunt je eigen account niet verwijderen" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data: row, error: findErr } = await sb
      .from("adviseurs")
      .select("id, naam, email, rol")
      .eq("id", id)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!row) {
      return NextResponse.json(
        { error: "Account niet gevonden" },
        { status: 404 }
      );
    }

    const { error: delErr } = await sb.from("adviseurs").delete().eq("id", id);
    if (!delErr) {
      return NextResponse.json({
        ok: true,
        mode: "deleted",
        naam: row.naam as string,
      });
    }

    // FK-koppelingen → soft delete: geen login meer
    const { error: softErr } = await sb
      .from("adviseurs")
      .update({
        actief: false,
        password_hash: null,
        email: row.email
          ? `verwijderd+${id.slice(0, 8)}@invalid.local`
          : null,
      })
      .eq("id", id);

    if (softErr) {
      // password_hash/email update kan falen → alleen actief uit
      const { error: minErr } = await sb
        .from("adviseurs")
        .update({ actief: false })
        .eq("id", id);
      if (minErr) {
        return NextResponse.json(
          {
            error:
              delErr.message ||
              softErr.message ||
              minErr.message ||
              "Verwijderen mislukt",
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      mode: "deactivated",
      naam: row.naam as string,
      detail:
        "Account had gekoppelde data en is gedeactiveerd (kan niet meer inloggen).",
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verwijderen mislukt") },
      { status: 500 }
    );
  }
}
