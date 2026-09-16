import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  parseAdminTargetsStore,
  serializeAdminTargetsStore,
  computeTeamDashboardTargets,
  type AdminTargetsStore,
  type PersonOverride,
  type TargetFields,
  type TargetRole,
} from "@/lib/admin-targets";

export const runtime = "nodejs";

async function loadStore(
  sb: ReturnType<typeof getSupabaseAdmin>
): Promise<{ id: string | null; store: AdminTargetsStore }> {
  const { data, error } = await sb
    .from("dashboard_instellingen")
    .select("id, dashboard_v2_doelen")
    .eq("actief", true)
    .limit(1)
    .maybeSingle();
  if (
    error &&
    (error.code === "42703" ||
      error.message?.includes("dashboard_v2_doelen"))
  ) {
    return { id: null, store: parseAdminTargetsStore({}) };
  }
  if (error) throw error;
  return {
    id: (data?.id as string) || null,
    store: parseAdminTargetsStore(data?.dashboard_v2_doelen),
  };
}

async function saveStore(
  sb: ReturnType<typeof getSupabaseAdmin>,
  id: string | null,
  store: AdminTargetsStore
) {
  const { data: people } = await sb
    .from("adviseurs")
    .select("id, rol, actief");
  const refs = (people || []).map((a) => ({
    id: a.id as string,
    rol: ((a as { rol?: string }).rol as string) || "adviseur",
    actief: Boolean(a.actief),
  }));
  const payload = serializeAdminTargetsStore(store, refs);
  if (id) {
    const { error } = await sb
      .from("dashboard_instellingen")
      .update({ dashboard_v2_doelen: payload })
      .eq("id", id);
    if (error) throw error;
  } else {
    const { error } = await sb.from("dashboard_instellingen").insert({
      dashboard_v2_doelen: payload,
      actief: true,
    });
    if (error) throw error;
  }
}

/** GET /api/admin-targets — standaard + personen/partners + lijsten */
export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const [{ store }, adviseursRes, partnersRes] = await Promise.all([
      loadStore(sb),
      sb
        .from("adviseurs")
        .select("id, naam, email, rol, actief")
        .order("naam"),
      sb
        .from("installatie_partners")
        .select("id, naam, email, actief")
        .order("naam"),
    ]);

    const adviseurs = (adviseursRes.error ? [] : adviseursRes.data || []).map(
      (a) => ({
        id: a.id as string,
        naam: a.naam as string,
        email: (a.email as string) || null,
        rol: ((a as { rol?: string }).rol as string) || "adviseur",
        actief: Boolean(a.actief),
      })
    );
    const partners = (partnersRes.error ? [] : partnersRes.data || []).map(
      (p) => ({
        id: p.id as string,
        naam: p.naam as string,
        email: (p.email as string) || null,
        actief: Boolean(p.actief),
      })
    );

    store.defaults.team = computeTeamDashboardTargets(store, adviseurs);

    return NextResponse.json({ store, adviseurs, partners });  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Admin targets laden mislukt") },
      { status: 500 }
    );
  }
}

type PatchBody = {
  defaults?: Partial<Record<TargetRole, Partial<TargetFields>>>;
  personId?: string;
  personOverride?: PersonOverride | null;
  /** true = wis override → terug naar standaard */
  clearPerson?: boolean;
  partnerId?: string;
  partnerOverride?: PersonOverride | null;
  clearPartner?: boolean;
};

/** PATCH /api/admin-targets */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as PatchBody;
    const sb = getSupabaseAdmin();
    const { id, store } = await loadStore(sb);

    if (body.defaults && typeof body.defaults === "object") {
      for (const role of Object.keys(body.defaults) as TargetRole[]) {
        if (role === "team") continue; // team = altijd berekend
        const patch = body.defaults[role];
        if (!patch) continue;
        store.defaults[role] = {
          ...store.defaults[role],
          ...Object.fromEntries(
            Object.entries(patch).map(([k, v]) => [k, Number(v) || 0])
          ),
        } as TargetFields;
      }
    }

    if (body.personId) {
      if (body.clearPerson) {
        delete store.personen[body.personId];
      } else if (body.personOverride) {
        store.personen[body.personId] = {
          ...(store.personen[body.personId] || {}),
          ...body.personOverride,
        };
      }
    }

    if (body.partnerId) {
      if (body.clearPartner) {
        delete store.partners[body.partnerId];
      } else if (body.partnerOverride) {
        store.partners[body.partnerId] = {
          ...(store.partners[body.partnerId] || {}),
          ...body.partnerOverride,
        };
      }
    }

    await saveStore(sb, id, store);

    const { data: people } = await sb
      .from("adviseurs")
      .select("id, rol, actief");
    store.defaults.team = computeTeamDashboardTargets(
      store,
      (people || []).map((a) => ({
        id: a.id as string,
        rol: ((a as { rol?: string }).rol as string) || "adviseur",
        actief: Boolean(a.actief),
      }))
    );

    return NextResponse.json({ ok: true, store });  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Admin targets opslaan mislukt") },
      { status: 500 }
    );
  }
}
