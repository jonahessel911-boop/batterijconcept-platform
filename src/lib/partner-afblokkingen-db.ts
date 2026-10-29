/**
 * Partner-afblokkingen lezen/schrijven, met fallback als teamgenoot_id
 * (migrate-partner-afblokkingen-teamgenoot.sql) nog niet is gedraaid.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PartnerVenster } from "@/lib/partner-slots";

export type PartnerAfblokRow = {
  id: string;
  partner_id: string;
  dag: string;
  venster: PartnerVenster;
  teamgenoot_id?: string | null;
};

function isTeamgenootColumnMissing(
  error: { code?: string; message?: string } | null
): boolean {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    msg.includes("teamgenoot_id") ||
    (msg.includes("column") && msg.includes("does not exist"))
  );
}

function isTableMissing(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (msg.includes("partner_afblokkingen") && msg.includes("schema cache")) ||
    msg.includes("Could not find the table")
  );
}

export type AfblokQueryResult = {
  items: PartnerAfblokRow[];
  /** false = kolom teamgenoot_id ontbreekt → partner-breed */
  perMonteur: boolean;
  migrationRequired?: boolean;
  error?: string;
};

export async function loadPartnerAfblokkingen(
  sb: SupabaseClient,
  opts: {
    partnerIds: string[];
    van: string;
    tot: string;
    teamgenootId?: string | null;
  }
): Promise<AfblokQueryResult> {
  if (!opts.partnerIds.length) {
    return { items: [], perMonteur: true };
  }

  let withTgQ = sb
    .from("partner_afblokkingen")
    .select("id, partner_id, dag, venster, teamgenoot_id")
    .in("partner_id", opts.partnerIds)
    .gte("dag", opts.van)
    .lte("dag", opts.tot)
    .order("dag")
    .order("venster");
  if (opts.teamgenootId) {
    withTgQ = withTgQ.eq("teamgenoot_id", opts.teamgenootId);
  }
  const withTg = await withTgQ;

  if (!withTg.error) {
    return {
      items: (withTg.data || []) as PartnerAfblokRow[],
      perMonteur: true,
    };
  }

  if (isTableMissing(withTg.error)) {
    return {
      items: [],
      perMonteur: false,
      migrationRequired: true,
      error:
        "Tabel partner_afblokkingen ontbreekt. Run supabase/migrate-partner-agenda.sql",
    };
  }

  if (!isTeamgenootColumnMissing(withTg.error)) {
    return {
      items: [],
      perMonteur: false,
      error: withTg.error.message,
    };
  }

  // Fallback: partner-breed (geen teamgenoot_id kolom)
  const legacy = await sb
    .from("partner_afblokkingen")
    .select("id, partner_id, dag, venster")
    .in("partner_id", opts.partnerIds)
    .gte("dag", opts.van)
    .lte("dag", opts.tot)
    .order("dag")
    .order("venster");

  if (legacy.error) {
    return {
      items: [],
      perMonteur: false,
      migrationRequired: true,
      error: legacy.error.message,
    };
  }

  return {
    items: (legacy.data || []).map((r) => ({
      ...r,
      venster: r.venster as PartnerVenster,
      teamgenoot_id: null,
    })),
    perMonteur: false,
    migrationRequired: true,
  };
}

export type AfblokToggleResult = {
  geblokkeerd: boolean;
  perMonteur: boolean;
  migrationRequired?: boolean;
  item?: PartnerAfblokRow | null;
  message: string;
  error?: string;
};

export async function togglePartnerAfblokking(
  sb: SupabaseClient,
  opts: {
    partnerId: string;
    dag: string;
    venster: PartnerVenster;
    geblokkeerd: boolean;
    teamgenootId?: string | null;
  }
): Promise<AfblokToggleResult> {
  const { partnerId, dag, venster, geblokkeerd } = opts;
  const teamgenootId = opts.teamgenootId?.trim() || null;

  // Probeer met teamgenoot_id
  let find = sb
    .from("partner_afblokkingen")
    .select("id, partner_id, dag, venster, teamgenoot_id")
    .eq("partner_id", partnerId)
    .eq("dag", dag)
    .eq("venster", venster);
  find = teamgenootId
    ? find.eq("teamgenoot_id", teamgenootId)
    : find.is("teamgenoot_id", null);

  const existingTry = await find.maybeSingle();

  if (
    existingTry.error &&
    isTeamgenootColumnMissing(existingTry.error)
  ) {
    return togglePartnerAfblokkingLegacy(sb, {
      partnerId,
      dag,
      venster,
      geblokkeerd,
    });
  }

  if (existingTry.error && isTableMissing(existingTry.error)) {
    return {
      geblokkeerd: false,
      perMonteur: false,
      migrationRequired: true,
      message: "Afblokken niet beschikbaar",
      error:
        "Tabel ontbreekt. Run supabase/migrate-partner-agenda.sql + migrate-partner-afblokkingen-teamgenoot.sql",
    };
  }

  if (existingTry.error) {
    return {
      geblokkeerd: false,
      perMonteur: true,
      message: "Afblokken mislukt",
      error: existingTry.error.message,
    };
  }

  const existing = existingTry.data;

  if (!geblokkeerd) {
    if (existing?.id) {
      const { error } = await sb
        .from("partner_afblokkingen")
        .delete()
        .eq("id", existing.id);
      if (error) {
        return {
          geblokkeerd: true,
          perMonteur: true,
          message: "Openzetten mislukt",
          error: error.message,
        };
      }
    }
    return {
      geblokkeerd: false,
      perMonteur: true,
      message: `${dag} ${venster} weer open`,
    };
  }

  if (existing?.id) {
    return {
      geblokkeerd: true,
      perMonteur: true,
      item: existing as PartnerAfblokRow,
      message: `${dag} ${venster} geblokkeerd`,
    };
  }

  const { data, error } = await sb
    .from("partner_afblokkingen")
    .insert({
      partner_id: partnerId,
      dag,
      venster,
      teamgenoot_id: teamgenootId,
    })
    .select("id, partner_id, dag, venster, teamgenoot_id")
    .single();

  if (error) {
    if (isTeamgenootColumnMissing(error)) {
      return togglePartnerAfblokkingLegacy(sb, {
        partnerId,
        dag,
        venster,
        geblokkeerd: true,
      });
    }
    if (error.code === "23505") {
      return {
        geblokkeerd: true,
        perMonteur: true,
        message: `${dag} ${venster} geblokkeerd`,
      };
    }
    return {
      geblokkeerd: false,
      perMonteur: true,
      message: "Afblokken mislukt",
      error: error.message,
    };
  }

  return {
    geblokkeerd: true,
    perMonteur: true,
    item: data as PartnerAfblokRow,
    message: `${dag} ${venster} geblokkeerd`,
  };
}

async function togglePartnerAfblokkingLegacy(
  sb: SupabaseClient,
  opts: {
    partnerId: string;
    dag: string;
    venster: PartnerVenster;
    geblokkeerd: boolean;
  }
): Promise<AfblokToggleResult> {
  const { partnerId, dag, venster, geblokkeerd } = opts;
  const { data: existing } = await sb
    .from("partner_afblokkingen")
    .select("id, partner_id, dag, venster")
    .eq("partner_id", partnerId)
    .eq("dag", dag)
    .eq("venster", venster)
    .maybeSingle();

  if (!geblokkeerd) {
    if (existing?.id) {
      const { error } = await sb
        .from("partner_afblokkingen")
        .delete()
        .eq("id", existing.id);
      if (error) {
        return {
          geblokkeerd: true,
          perMonteur: false,
          migrationRequired: true,
          message: "Openzetten mislukt",
          error: error.message,
        };
      }
    }
    return {
      geblokkeerd: false,
      perMonteur: false,
      migrationRequired: true,
      message: `${dag} ${venster} weer open (heel team)`,
    };
  }

  if (existing?.id) {
    return {
      geblokkeerd: true,
      perMonteur: false,
      migrationRequired: true,
      item: { ...existing, venster: existing.venster as PartnerVenster, teamgenoot_id: null },
      message: `${dag} ${venster} geblokkeerd (heel team)`,
    };
  }

  const { data, error } = await sb
    .from("partner_afblokkingen")
    .insert({ partner_id: partnerId, dag, venster })
    .select("id, partner_id, dag, venster")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        geblokkeerd: true,
        perMonteur: false,
        migrationRequired: true,
        message: `${dag} ${venster} geblokkeerd (heel team)`,
      };
    }
    return {
      geblokkeerd: false,
      perMonteur: false,
      migrationRequired: true,
      message: "Afblokken mislukt",
      error: error.message,
    };
  }

  return {
    geblokkeerd: true,
    perMonteur: false,
    migrationRequired: true,
    item: {
      ...data,
      venster: data.venster as PartnerVenster,
      teamgenoot_id: null,
    },
    message: `${dag} ${venster} geblokkeerd (heel team)`,
  };
}
