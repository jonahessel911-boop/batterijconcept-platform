/**
 * GET  /api/call-popups — sync recente CDR → popups + open popups voor sessie
 * PATCH /api/call-popups — dismiss of nagesprek opslaan
 *
 * Op localhost bereikt de Unite-webhook de app niet; daarom sync’t GET
 * periodiek CDR voor de ingelogde medewerker (unite_lijn / unite_ext).
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import {
  dismissCallPopup,
  listOpenCallPopups,
  saveCallPopupNotitie,
  syncRecentCallPopupsForAdviseur,
} from "@/lib/call-popups";

export const runtime = "nodejs";
export const maxDuration = 60;

async function requireSession() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session?.adviseurId) return null;
  return session;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const wantSync = req.nextUrl.searchParams.get("sync") === "1";
    let sync: { synced: number; skipped?: string } | null = null;
    if (wantSync) {
      try {
        sync = await syncRecentCallPopupsForAdviseur(session.adviseurId, {
          force: true,
          lookbackMinutes: 25,
        });
      } catch (e) {
        console.warn("call-popups sync:", errMessage(e));
      }
    }

    const popups = await listOpenCallPopups(session.adviseurId);
    return NextResponse.json({ popups, sync });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Popups laden mislukt") },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: {
      id?: string;
      action?: "dismiss" | "save";
      notitie?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
    }

    if (!body.id?.trim()) {
      return NextResponse.json({ error: "id verplicht" }, { status: 400 });
    }

    if (body.action === "save") {
      const res = await saveCallPopupNotitie({
        id: body.id.trim(),
        adviseurId: session.adviseurId,
        adviseurNaam: session.naam,
        notitie: body.notitie || "",
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: res.error || "Opslaan mislukt" },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true });
    }

    await dismissCallPopup(body.id.trim(), session.adviseurId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Popup bijwerken mislukt") },
      { status: 500 }
    );
  }
}
