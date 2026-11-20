import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requirePartnerPortal } from "@/lib/installatie-portal";
import {
  isInstallatieGedaan,
  isInstallatieVanafCutoff,
} from "@/lib/installatie-vanaf";
import type { InstallatiePartnerKoppel } from "@/types/database";
import { resolveInstallatieKoppelId } from "@/lib/installatie-koppel";

export const runtime = "nodejs";

const GEDAAN_OR =
  "installatie_voltooid_at.not.is.null,status.in.(installatie_voltooid,after_sale,review_gevraagd,afgerond,service)";

const SELECT = `
  id, project_nummer, titel, status, schouw_at, installatie_at,
  installatie_voltooid_at, monteur, installatie_teamgenoot_id,
  installatie_koppel_id, materiaal_checks,
  schouw_notities, installatie_notities,
  monteur_beoordeling_sterren, monteur_beoordeling_notitie,
  monteur_beoordeling_op, monteur_beoordeling_door,
  klantvriendelijkheid_sterren, klantvriendelijkheid_notitie,
  klantvriendelijkheid_op, klantvriendelijkheid_door,
  leads(naam, plaats, postcode, straat, huisnummer, toevoeging),
  installatie_teamgenoot:installatie_partner_teamgenoten!installatie_teamgenoot_id(id, naam)
`;

const SELECT_FALLBACK = `
  id, project_nummer, titel, status, schouw_at, installatie_at,
  installatie_voltooid_at, monteur, installatie_koppel_id, materiaal_checks,
  schouw_notities, installatie_notities,
  monteur_beoordeling_sterren, monteur_beoordeling_notitie,
  monteur_beoordeling_op, monteur_beoordeling_door,
  leads(naam, plaats, postcode, straat, huisnummer, toevoeging)
`;

const SELECT_NO_KOPPEL = `
  id, project_nummer, titel, status, schouw_at, installatie_at,
  installatie_voltooid_at, monteur, materiaal_checks,
  schouw_notities, installatie_notities,
  monteur_beoordeling_sterren, monteur_beoordeling_notitie,
  monteur_beoordeling_op, monteur_beoordeling_door,
  leads(naam, plaats, postcode, straat, huisnummer, toevoeging)
`;

const KOPPEL_SELECT =
  "id, partner_id, naam, monteur_1_id, monteur_2_id, beoordeling_sterren, beoordeling_notitie, actief, monteur_1:installatie_partner_teamgenoten!monteur_1_id(id, naam), monteur_2:installatie_partner_teamgenoten!monteur_2_id(id, naam)";
const KOPPEL_SELECT_FLAT =
  "id, partner_id, naam, monteur_1_id, monteur_2_id, beoordeling_sterren, beoordeling_notitie, actief";

/**
 * GET — partner: installaties (gepland/afgerond) + beoordeling.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await requirePartnerPortal(token, req);
    if (!partner) {
      return NextResponse.json(
        { error: "Geen toegang — alleen beheerders zien Installaties." },
        { status: 403 }
      );
    }

    const sb = getSupabaseAdmin();
    const load = (select: string) =>
      sb
        .from("projecten")
        .select(select)
        .eq("installatie_partner_id", partner.id)
        .not("status", "in", "(annulering,hold_sales_actie)")
        .or(GEDAAN_OR)
        .order("installatie_at", { ascending: false, nullsFirst: false });

    const first = await load(SELECT);
    let error = first.error;
    let data: Record<string, unknown>[] | null =
      (first.data as Record<string, unknown>[] | null) ?? null;

    if (
      error &&
      (error.code === "42703" ||
        error.message?.includes("monteur_beoordeling") ||
        error.message?.includes("klantvriendelijkheid") ||
        error.message?.includes("installatie_teamgenoot") ||
        error.message?.includes("installatie_koppel") ||
        error.code === "PGRST200")
    ) {
      const soft = await load(
        error.message?.includes("installatie_koppel")
          ? SELECT_NO_KOPPEL
          : SELECT_FALLBACK
      );
      data = (soft.data as Record<string, unknown>[] | null) ?? null;
      error = soft.error;
    }

    if (error) throw error;

    const rows = (data || []).filter((r) => {
      const status = typeof r.status === "string" ? r.status : null;
      const voltooid =
        typeof r.installatie_voltooid_at === "string"
          ? r.installatie_voltooid_at
          : null;
      const at =
        typeof r.installatie_at === "string" ? r.installatie_at : null;
      return (
        isInstallatieGedaan({ status, installatie_voltooid_at: voltooid }) &&
        isInstallatieVanafCutoff(at, voltooid)
      );
    });

    let koppels: InstallatiePartnerKoppel[] = [];
    {
      const nested = await sb
        .from("installatie_partner_koppels")
        .select(KOPPEL_SELECT)
        .eq("partner_id", partner.id);
      const kq = nested.error
        ? await sb
            .from("installatie_partner_koppels")
            .select(KOPPEL_SELECT_FLAT)
            .eq("partner_id", partner.id)
        : nested;
      if (!kq.error) {
        koppels = (kq.data || []) as unknown as InstallatiePartnerKoppel[];
      }
    }
    const koppelById = new Map(koppels.map((k) => [k.id, k]));
    const installaties = rows.map((r) => {
      const koppelId = resolveInstallatieKoppelId(
        {
          installatie_koppel_id:
            typeof r.installatie_koppel_id === "string"
              ? r.installatie_koppel_id
              : null,
          installatie_partner_id: partner.id,
        },
        koppels
      );
      return {
        ...r,
        installatie_koppel_id: koppelId,
        installatie_koppel: koppelId ? koppelById.get(koppelId) || null : null,
      };
    }) as Array<
      Record<string, unknown> & {
        monteur_beoordeling_sterren?: number | null;
      }
    >;

    const openBeoordeling = installaties.filter(
      (r) => r.monteur_beoordeling_sterren == null
    ).length;

    return NextResponse.json({
      partner: { id: partner.id, naam: partner.naam },
      installaties,
      open_beoordeling: openBeoordeling,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Installaties laden mislukt") },
      { status: 500 }
    );
  }
}
