/**
 * GET/POST /api/stuur/acties — persoonlijke acties op Action Board-rijen.
 * PATCH via ?id=… body { status: 'done' | 'open' }
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import { normalizeRol } from "@/lib/rollen";
import type { StuurUnitId } from "@/lib/stuur-board";
import { STUUR_UNITS } from "@/lib/stuur-board";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

const UNIT_IDS = new Set(STUUR_UNITS.map((u) => u.id));

function missingTable(err: { message?: string; code?: string } | null) {
  return (
    err?.code === "42P01" ||
    /stuur_acties|does not exist|schema cache/i.test(err?.message || "")
  );
}

export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const rol = normalizeRol(session.rol);
    if (rol !== "admin" && rol !== "sales_manager" && rol !== "backoffice") {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const unit = (req.nextUrl.searchParams.get("unit") || "").trim();
    const openOnly = req.nextUrl.searchParams.get("open") !== "0";
    const sb = getSupabaseAdmin();
    let q = sb
      .from("stuur_acties")
      .select(
        "id, unit, row_key, row_label, titel, notitie, status, created_at"
      )
      .eq("owner_id", session.adviseurId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (unit && UNIT_IDS.has(unit as StuurUnitId)) {
      q = q.eq("unit", unit);
    }
    if (openOnly) q = q.eq("status", "open");

    const { data, error } = await q;
    if (error) {
      if (missingTable(error)) {
        return NextResponse.json({
          acties: [],
          hint: "Run supabase/migrate-stuur-acties.sql",
        });
      }
      throw error;
    }
    return NextResponse.json({ acties: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Acties laden mislukt") },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const rol = normalizeRol(session.rol);
    if (rol !== "admin" && rol !== "sales_manager" && rol !== "backoffice") {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      unit?: string;
      row_key?: string;
      row_label?: string;
      titel?: string;
      notitie?: string;
      id?: string;
      status?: "open" | "done";
    };

    const sb = getSupabaseAdmin();

    // Complete existing
    if (body.id && body.status) {
      const { data, error } = await sb
        .from("stuur_acties")
        .update({ status: body.status, updated_at: new Date().toISOString() })
        .eq("id", body.id)
        .eq("owner_id", session.adviseurId)
        .select(
          "id, unit, row_key, row_label, titel, notitie, status, created_at"
        )
        .maybeSingle();
      if (error) {
        if (missingTable(error)) {
          return NextResponse.json(
            { error: "Tabel stuur_acties ontbreekt — run migrate" },
            { status: 503 }
          );
        }
        throw error;
      }
      return NextResponse.json({ actie: data });
    }

    const unit = (body.unit || "").trim() as StuurUnitId;
    const rowKey = (body.row_key || "").trim();
    const titel = (body.titel || "").trim();
    if (!UNIT_IDS.has(unit) || !rowKey || !titel) {
      return NextResponse.json(
        { error: "unit, row_key en titel verplicht" },
        { status: 400 }
      );
    }

    const { data, error } = await sb
      .from("stuur_acties")
      .insert({
        owner_id: session.adviseurId,
        unit,
        row_key: rowKey,
        row_label: (body.row_label || "").trim() || null,
        titel,
        notitie: (body.notitie || "").trim() || null,
        status: "open",
      })
      .select(
        "id, unit, row_key, row_label, titel, notitie, status, created_at"
      )
      .single();

    if (error) {
      if (missingTable(error)) {
        return NextResponse.json(
          {
            error:
              "Tabel stuur_acties ontbreekt — run supabase/migrate-stuur-acties.sql",
          },
          { status: 503 }
        );
      }
      throw error;
    }
    return NextResponse.json({ actie: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Actie opslaan mislukt") },
      { status: 500 }
    );
  }
}
