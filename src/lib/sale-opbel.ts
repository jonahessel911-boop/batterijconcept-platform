/**
 * Post-sale opbel: vandaag / morgen terugbel na deal getekend (backoffice).
 */

import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { isAdminAdviseur } from "@/lib/admin-adviseur";
import { AMSTERDAM_TZ } from "@/lib/format";
import { isTerugbelPlanbaar, normalizeRol } from "@/lib/rollen";
import { getSupabaseBrowser } from "@/lib/supabase";

export type SaleOpbelMoment = "vandaag" | "morgen";

/** Amsterdam-lokaal `YYYY-MM-DDTHH:mm` voor POST /api/afspraken. */
export function saleOpbelStartAtLocal(
  moment: SaleOpbelMoment,
  now = new Date()
): string {
  if (moment === "vandaag") {
    return formatInTimeZone(
      new Date(now.getTime() + 15 * 60_000),
      AMSTERDAM_TZ,
      "yyyy-MM-dd'T'HH:mm"
    );
  }
  const local = toZonedTime(now, AMSTERDAM_TZ);
  const morgen = addDays(local, 1);
  morgen.setHours(10, 0, 0, 0);
  return formatInTimeZone(
    fromZonedTime(morgen, AMSTERDAM_TZ),
    AMSTERDAM_TZ,
    "yyyy-MM-dd'T'HH:mm"
  );
}

export function saleOpbelNotitie(moment: SaleOpbelMoment): string {
  return moment === "vandaag"
    ? "Sale — vandaag opbellen (aanbetaling / schouw)"
    : "Sale — morgen opbellen (aanbetaling / schouw)";
}

/** Wie de post-sale bel krijgt: beller op lead → callcenter → backoffice → sessie. */
export async function resolveSaleOpbelAdviseurId(opts: {
  leadId: string;
  sessionAdviseurId?: string | null;
}): Promise<string | null> {
  const sb = getSupabaseBrowser();
  const { data: lead } = await sb
    .from("leads")
    .select("beller_id")
    .eq("id", opts.leadId)
    .maybeSingle();
  const bellerId = (lead?.beller_id || "").trim();
  if (bellerId) return bellerId;

  const { data: adviseurs } = await sb
    .from("adviseurs")
    .select("id, naam, rol, actief")
    .eq("actief", true);
  const list = (adviseurs || []).filter(
    (a) =>
      a.actief !== false &&
      !isAdminAdviseur({ naam: a.naam || "", email: null }) &&
      isTerugbelPlanbaar(a)
  );
  const sorted = [...list].sort((a, b) => {
    const order = (rol: string | null | undefined) => {
      const r = normalizeRol(rol);
      if (r === "beller") return 0;
      if (r === "backoffice") return 1;
      return 2;
    };
    const d = order(a.rol) - order(b.rol);
    if (d !== 0) return d;
    return String(a.naam || "").localeCompare(String(b.naam || ""), "nl");
  });
  if (sorted[0]?.id) return sorted[0].id;
  return (opts.sessionAdviseurId || "").trim() || null;
}

/** Plant bel-afspraak; returnt error-string of null bij succes. */
export async function planSaleOpbel(opts: {
  leadId: string;
  moment: SaleOpbelMoment;
  sessionAdviseurId?: string | null;
}): Promise<string | null> {
  const adviseurId = await resolveSaleOpbelAdviseurId({
    leadId: opts.leadId,
    sessionAdviseurId: opts.sessionAdviseurId,
  });
  if (!adviseurId) {
    return "Geen medewerker om opbel aan te wijzen";
  }
  const startAt = saleOpbelStartAtLocal(opts.moment);
  const notitie = saleOpbelNotitie(opts.moment);
  const res = await fetch("/api/afspraken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lead_id: opts.leadId,
      adviseur_id: adviseurId,
      start_at: startAt,
      notities: notitie,
      soort: "bel",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    return data.error || "Opbel plannen mislukt";
  }

  const sb = getSupabaseBrowser();
  const { data: adv } = await sb
    .from("adviseurs")
    .select("id, rol")
    .eq("id", adviseurId)
    .maybeSingle();
  const patch: Record<string, unknown> = {
    terugbellen: true,
    terugbel_notitie: notitie,
  };
  if (normalizeRol(adv?.rol) === "beller") {
    patch.beller_id = adviseurId;
  }
  await sb.from("leads").update(patch).eq("id", opts.leadId);

  void fetch(`/api/leads/${opts.leadId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      soort: "terugbel",
      titel: "Terugbelafspraak gepland",
      detail: `${notitie} · ${startAt.replace("T", " ")}`,
    }),
  }).catch(() => undefined);

  return null;
}
