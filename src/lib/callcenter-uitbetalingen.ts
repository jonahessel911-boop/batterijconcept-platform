/**
 * Bel- + opscommissie automatisch klaarzetten voor de Uitbetalingen-tab
 * (vorige week + week daarvoor, net als sales-concepten).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  previousCreditWeek,
  weekBeforePreviousCreditWeek,
} from "@/lib/adviseur-creditfactuur";
import { createBellerWeekCreditfactuur } from "@/lib/beller-commissie";
import { createOpsManagerWeekCreditfactuur } from "@/lib/ops-manager-commissie";
import { isOpsManagerAdviseur, isSimonBeller } from "@/lib/ops-namen";
import { normalizeRol } from "@/lib/rollen";

export type CallcenterUitbetalingEnsureResult = {
  created: number;
  skipped: number;
  ids: string[];
  errors: string[];
};

export async function ensureBelEnOpsUitbetalingConcepten(
  sb: SupabaseClient,
  now: Date = new Date()
): Promise<CallcenterUitbetalingEnsureResult> {
  const weeks = [
    previousCreditWeek(now),
    weekBeforePreviousCreditWeek(now),
  ];

  const { data: people, error } = await sb
    .from("adviseurs")
    .select("id, naam, rol, actief")
    .eq("actief", true);
  if (error) {
    return { created: 0, skipped: 0, ids: [], errors: [error.message] };
  }

  const simonBelllers = (people || []).filter(
    (a) => normalizeRol(a.rol) === "beller" && isSimonBeller(a)
  );
  const opsManagers = (people || []).filter((a) => isOpsManagerAdviseur(a));

  let created = 0;
  let skipped = 0;
  const ids: string[] = [];
  const errors: string[] = [];

  for (const week of weeks) {
    for (const beller of simonBelllers) {
      const r = await createBellerWeekCreditfactuur(sb, {
        bellerId: beller.id as string,
        jaar: week.jaar,
        week: week.week,
        now,
      });
      if (r.created && r.factuur?.id) {
        created += 1;
        ids.push(String(r.factuur.id));
      } else if (r.factuur) {
        skipped += 1;
        if (r.factuur.id) ids.push(String(r.factuur.id));
      } else if (r.error) {
        // Geen afspraken = stil overslaan; ZZP/andere fout wel melden
        if (!/geen netto afspraken/i.test(r.error)) {
          errors.push(`${beller.naam} W${week.week}: ${r.error}`);
        } else {
          skipped += 1;
        }
      }
    }

    for (const ops of opsManagers) {
      const r = await createOpsManagerWeekCreditfactuur(sb, {
        opsManagerId: ops.id as string,
        jaar: week.jaar,
        week: week.week,
        now,
      });
      if (r.created && r.factuur?.id) {
        created += 1;
        ids.push(String(r.factuur.id));
      } else if (r.factuur) {
        skipped += 1;
        if (r.factuur.id) ids.push(String(r.factuur.id));
      } else if (r.error) {
        if (!/geen weekdata/i.test(r.error)) {
          errors.push(`${ops.naam} W${week.week}: ${r.error}`);
        } else {
          skipped += 1;
        }
      }
    }
  }

  return { created, skipped, ids, errors };
}
