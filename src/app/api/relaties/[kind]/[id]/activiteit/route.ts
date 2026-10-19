import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { isAdminAdviseur, isAdminEmail } from "@/lib/admin-adviseur";
import { normalizeRol } from "@/lib/rollen";
import type { RelatieKind } from "@/lib/relatie-contract";
import { listRelatieActiviteit } from "@/lib/relatie-activiteit";

export const runtime = "nodejs";

function parseKind(raw: string): RelatieKind | null {
  if (raw === "adviseur" || raw === "partner") return raw;
  return null;
}

function tableFor(kind: RelatieKind): string {
  return kind === "adviseur" ? "adviseurs" : "installatie_partners";
}

async function requireAdmin() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) return { error: "Niet ingelogd", status: 401 as const };
  const sb = getSupabaseAdmin();
  const { data: adv } = await sb
    .from("adviseurs")
    .select("rol, naam, email")
    .eq("id", session.adviseurId)
    .maybeSingle();
  const email = adv?.email ?? session.email;
  const naam = adv?.naam || session.naam;
  const rol = normalizeRol(adv?.rol || session.rol);
  const mag =
    rol === "admin" ||
    isAdminEmail(email) ||
    isAdminAdviseur({ naam, email });
  if (!mag) {
    return { error: "Alleen admin", status: 403 as const };
  }
  return { sb };
}

/**
 * GET /api/relaties/[kind]/[id]/activiteit
 * Activiteiten + afgeleide events uit bestaande timestamps.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ kind: string; id: string }> }
) {
  const { kind: kindRaw, id } = await ctx.params;
  const kind = parseKind(kindRaw);
  if (!kind) {
    return NextResponse.json({ error: "Ongeldig type" }, { status: 400 });
  }

  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const [{ data: row }, events] = await Promise.all([
      auth.sb.from(tableFor(kind)).select("*").eq("id", id).maybeSingle(),
      listRelatieActiviteit(auth.sb, kind, id),
    ]);

    type Derived = {
      id: string;
      soort: string;
      titel: string;
      detail: string | null;
      created_at: string;
      source: "derived" | "log";
    };

    const derived: Derived[] = [];
    if (row) {
      const r = row as unknown as Record<string, string | null>;
      if (r.created_at) {
        derived.push({
          id: `d-created`,
          soort: "aangemaakt",
          titel: kind === "adviseur" ? "Adviseur aangemaakt" : "Monteur aangemaakt",
          detail: null,
          created_at: r.created_at,
          source: "derived",
        });
      }
      if (r.contract_sent_at) {
        derived.push({
          id: `d-contract-sent`,
          soort: "contract_verzonden",
          titel: "Samenwerkingsovereenkomst verstuurd",
          detail: null,
          created_at: r.contract_sent_at,
          source: "derived",
        });
      }
      if (r.contract_signed_at) {
        derived.push({
          id: `d-contract-signed`,
          soort: "contract_ondertekend",
          titel: "Samenwerkingsovereenkomst ondertekend",
          detail: r.contract_sign_status || null,
          created_at: r.contract_signed_at,
          source: "derived",
        });
      } else if (r.contract_uploaded_at) {
        derived.push({
          id: `d-contract-upload`,
          soort: "contract_upload",
          titel: "Samenwerkingscontract geüpload",
          detail: r.contract_bestandsnaam,
          created_at: r.contract_uploaded_at,
          source: "derived",
        });
      }
      if (r.kvk_uitreksel_uploaded_at) {
        derived.push({
          id: `d-kvk`,
          soort: "kvk_uitreksel",
          titel: "KvK-uittreksel geüpload",
          detail: r.kvk_uitreksel_bestandsnaam,
          created_at: r.kvk_uitreksel_uploaded_at,
          source: "derived",
        });
      }
      if (r.certificaten_uploaded_at) {
        derived.push({
          id: `d-cert`,
          soort: "certificaten",
          titel: "Certificaten geüpload",
          detail: r.certificaten_bestandsnaam,
          created_at: r.certificaten_uploaded_at,
          source: "derived",
        });
      }
    }

    const logged: Derived[] = events.map((e) => ({
      id: e.id,
      soort: e.soort,
      titel: e.titel,
      detail: e.detail,
      created_at: e.created_at,
      source: "log" as const,
    }));

    // Dedup: skip derived als er al een log-event dichtbij (±2s) met zelfde soort is
    const merged = [...logged];
    for (const d of derived) {
      const t = new Date(d.created_at).getTime();
      const dup = logged.some(
        (l) =>
          l.soort === d.soort &&
          Math.abs(new Date(l.created_at).getTime() - t) < 5000
      );
      if (!dup) merged.push(d);
    }
    merged.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return NextResponse.json({ events: merged.slice(0, 50) });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Activiteit laden mislukt") },
      { status: 500 }
    );
  }
}
