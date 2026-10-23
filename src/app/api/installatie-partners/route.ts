import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { randomBytes } from "crypto";
import { logRelatieActiviteit } from "@/lib/relatie-activiteit";

export const runtime = "nodejs";

const PUBLIC_FIELDS =
  "id, naam, email, telefoon, actief, portal_token, start_adres, reistijd_buffer_min, bedrijfsnaam, kvk_nummer, btw_nummer, factuur_adres, factuur_postcode, factuur_plaats, iban, contract_storage_path, contract_bestandsnaam, contract_uploaded_at, kvk_uitreksel_storage_path, kvk_uitreksel_bestandsnaam, kvk_uitreksel_uploaded_at, certificaten_storage_path, certificaten_bestandsnaam, certificaten_uploaded_at, google_connected_email, google_connected_at, created_at, updated_at";
const PUBLIC_FIELDS_FALLBACK =
  "id, naam, email, telefoon, actief, portal_token, created_at, updated_at";
const PUBLIC_FIELDS_NO_AGENDA =
  "id, naam, email, telefoon, actief, portal_token, bedrijfsnaam, kvk_nummer, btw_nummer, factuur_adres, factuur_postcode, factuur_plaats, iban, contract_storage_path, contract_bestandsnaam, contract_uploaded_at, kvk_uitreksel_storage_path, kvk_uitreksel_bestandsnaam, kvk_uitreksel_uploaded_at, certificaten_storage_path, certificaten_bestandsnaam, certificaten_uploaded_at, google_connected_email, google_connected_at, created_at, updated_at";

function isMissingGoogleCols(error: SbError): boolean {
  if (!error?.message) return false;
  return (
    error.code === "42703" ||
    /google_connected_email|google_connected_at|schema cache/i.test(
      error.message
    )
  );
}

type SbError = { code?: string; message?: string } | null;

function isMissingCompanyCols(error: SbError): boolean {
  if (!error?.message) return false;
  return (
    error.code === "42703" ||
    /bedrijfsnaam|kvk_nummer|contract_storage_path|schema cache/i.test(
      error.message
    )
  );
}

function isMissingAgendaCols(error: SbError): boolean {
  if (!error?.message) return false;
  return (
    error.code === "42703" ||
    /start_adres|reistijd_buffer_min|schema cache/i.test(error.message)
  );
}

/** GET /api/installatie-partners */
export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const includeInactive =
      req.nextUrl.searchParams.get("include_inactive") === "1";

    let query = sb
      .from("installatie_partners")
      .select(PUBLIC_FIELDS)
      .order("naam");
    if (!includeInactive) {
      query = query.eq("actief", true);
    }

    let { data, error } = await query;
    if (
      error &&
      (isMissingAgendaCols(error) ||
        isMissingCompanyCols(error) ||
        isMissingGoogleCols(error))
    ) {
      const selectFields = isMissingCompanyCols(error)
        ? PUBLIC_FIELDS_FALLBACK
        : isMissingAgendaCols(error)
          ? PUBLIC_FIELDS_NO_AGENDA
          : PUBLIC_FIELDS.replace(
              ", google_connected_email, google_connected_at",
              ""
            );
      let q2 = sb
        .from("installatie_partners")
        .select(selectFields)
        .order("naam");
      if (!includeInactive) q2 = q2.eq("actief", true);
      const retry = await q2;
      data = (retry.data || null) as typeof data;
      error = retry.error;
      if (error && (isMissingCompanyCols(error) || isMissingAgendaCols(error))) {
        let q3 = sb
          .from("installatie_partners")
          .select(PUBLIC_FIELDS_FALLBACK)
          .order("naam");
        if (!includeInactive) q3 = q3.eq("actief", true);
        const retry2 = await q3;
        data = (retry2.data || null) as typeof data;
        error = retry2.error;
      }
    }
    if (error) throw error;
    return NextResponse.json({ partners: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** POST /api/installatie-partners — nieuw partner */
export async function POST(req: NextRequest) {
  let body: {
    naam?: string;
    email?: string;
    telefoon?: string;
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
  if (!naam) {
    return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ error: "E-mail is verplicht" }, { status: 400 });
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

  try {
    const sb = getSupabaseAdmin();
    const portal_token = randomBytes(24).toString("hex");
    let { data, error } = await sb
      .from("installatie_partners")
      .insert({
        naam,
        email,
        telefoon: body.telefoon?.trim() || null,
        portal_token,
        actief: true,
        ...kvkFields,
      })
      .select(PUBLIC_FIELDS)
      .single();

    if (error && isMissingCompanyCols(error)) {
      const retry = await sb
        .from("installatie_partners")
        .insert({
          naam,
          email,
          telefoon: body.telefoon?.trim() || null,
          portal_token,
          actief: true,
        })
        .select(PUBLIC_FIELDS_FALLBACK)
        .single();
      data = retry.data as typeof data;
      error = retry.error;
    }

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Opslaan mislukt" },
        { status: 500 }
      );
    }

    return NextResponse.json({ partner: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** PATCH /api/installatie-partners */
export async function PATCH(req: NextRequest) {
  let body: {
    id?: string;
    naam?: string;
    email?: string | null;
    telefoon?: string | null;
    actief?: boolean;
    regenerate_token?: boolean;
    start_adres?: string | null;
    reistijd_buffer_min?: number | null;
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

  if (!body.id) {
    return NextResponse.json({ error: "id is verplicht" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
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
    if (body.regenerate_token) {
      patch.portal_token = randomBytes(24).toString("hex");
    }
    if (body.start_adres !== undefined) {
      patch.start_adres =
        typeof body.start_adres === "string"
          ? body.start_adres.trim() || null
          : null;
    }
    if (body.reistijd_buffer_min !== undefined) {
      const n = Number(body.reistijd_buffer_min);
      patch.reistijd_buffer_min =
        Number.isFinite(n) && n >= 0 ? Math.round(n) : 30;
    }

    const companyKeys = [
      "bedrijfsnaam",
      "kvk_nummer",
      "btw_nummer",
      "factuur_adres",
      "factuur_postcode",
      "factuur_plaats",
      "iban",
    ] as const;
    for (const key of companyKeys) {
      if (body[key] !== undefined) {
        const raw = body[key];
        if (typeof raw === "string") {
          const trimmed = raw.trim();
          patch[key] =
            key === "iban" ? trimmed.toUpperCase() || null : trimmed || null;
        } else {
          patch[key] = null;
        }
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Niets om bij te werken" },
        { status: 400 }
      );
    }

    let { data, error } = await sb
      .from("installatie_partners")
      .update(patch)
      .eq("id", body.id)
      .select(PUBLIC_FIELDS)
      .single();

    if (error && (isMissingCompanyCols(error) || isMissingAgendaCols(error))) {
      if (
        isMissingAgendaCols(error) &&
        (patch.start_adres !== undefined ||
          patch.reistijd_buffer_min !== undefined)
      ) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-partner-agenda.sql uit in Supabase",
          },
          { status: 503 }
        );
      }
      // Probeer zonder bedrijfsvelden als migratie nog niet is gedraaid
      const basePatch: Record<string, unknown> = {};
      for (const k of [
        "naam",
        "email",
        "telefoon",
        "actief",
        "portal_token",
        "start_adres",
        "reistijd_buffer_min",
      ]) {
        if (k in patch) basePatch[k] = patch[k];
      }
      if (Object.keys(basePatch).length === 0) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-relatie-gegevens-contract.sql uit in Supabase",
          },
          { status: 503 }
        );
      }
      const retry = await sb
        .from("installatie_partners")
        .update(basePatch)
        .eq("id", body.id)
        .select(
          isMissingAgendaCols(error)
            ? PUBLIC_FIELDS_FALLBACK
            : PUBLIC_FIELDS_NO_AGENDA
        )
        .single();
      data = (retry.data || null) as typeof data;
      error = retry.error;
      if (!error && Object.keys(patch).some((k) => companyKeys.includes(k as typeof companyKeys[number]))) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-relatie-gegevens-contract.sql uit in Supabase",
            partner: data,
          },
          { status: 503 }
        );
      }
    }

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Bijwerken mislukt" },
        { status: 500 }
      );
    }

    if (typeof patch.iban === "string" && patch.iban.trim()) {
      await logRelatieActiviteit(sb, {
        kind: "partner",
        relatieId: body.id as string,
        soort: "iban",
        titel: "IBAN opgeslagen",
        detail: String(patch.iban),
      });
    }

    return NextResponse.json({ partner: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
