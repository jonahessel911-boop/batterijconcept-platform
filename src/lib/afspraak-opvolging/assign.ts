import type { SupabaseClient } from "@supabase/supabase-js";
import { getOpvolgingAbSettings } from "./settings";
import type { OpvolgingFlow } from "./types";

/**
 * Bepaal opvolgingsflow voor een nieuwe `nieuw`-afspraak.
 * A/B uit → legacy (huidige v1). A/B aan → 50/50 intensief/rustig.
 */
export async function assignOpvolgingFlow(
  sb: SupabaseClient,
  opts?: { soort?: string | null }
): Promise<OpvolgingFlow> {
  // Alleen huisbezoek-nieuw doet de klantsequentie
  if (opts?.soort && opts.soort !== "nieuw") {
    return "legacy";
  }

  const settings = await getOpvolgingAbSettings(sb);
  if (!settings.enabled) return "legacy";

  // Echte 50/50 per nieuwe afspraak
  return Math.random() < 0.5 ? "intensief" : "rustig";
}

export function isAbOpvolgingFlow(
  flow: string | null | undefined
): flow is "intensief" | "rustig" {
  return flow === "intensief" || flow === "rustig";
}
