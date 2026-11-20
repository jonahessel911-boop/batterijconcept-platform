import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { replyToForLeadAdviseur } from "@/lib/email/adviseur-reply-to";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { overstapFrankEnergieEmail } from "@/lib/email/templates";
import { formatDateTimeLongNl } from "@/lib/format";
import { FRANK_ENERGIE_OVERSTAP_URL } from "@/lib/frank-energie";
import { batterijMerkUitRegels } from "@/lib/offerte-batterij-merk";

function publicBrandDataUrl(filename: string): string | null {
  try {
    const full = path.join(process.cwd(), "public", "brands", filename);
    if (!fs.existsSync(full)) return null;
    const b64 = fs.readFileSync(full).toString("base64");
    return `data:image/png;base64,${b64}`;
  } catch {
    return null;
  }
}

/**
 * Batterijconcept × Frank Energie-uitnodiging.
 * Aanroepen bij eerste Overstap-afvink in After sale.
 */
export async function sendOverstapFrankKlantMail(
  sb: SupabaseClient,
  projectId: string,
  projectRow?: Record<string, unknown> | null
): Promise<{
  ok: boolean;
  error?: string;
  messageId?: string;
  to?: string;
  subject?: string;
}> {
  let lead = projectRow?.leads as
    | { naam?: string | null; email?: string | null }
    | { naam?: string | null; email?: string | null }[]
    | null
    | undefined;
  if (Array.isArray(lead)) lead = lead[0] ?? null;

  let email = lead?.email?.trim() || "";
  let naam = lead?.naam?.trim() || "daar";
  let projectNummer =
    (projectRow?.project_nummer as string | null | undefined) || null;
  let leadId = (projectRow?.lead_id as string | null | undefined) || null;
  let offerteId =
    (projectRow?.offerte_id as string | null | undefined) || null;
  let afspraakAt =
    (projectRow?.overstap_afspraak_at as string | null | undefined) || null;

  if (!email || !offerteId) {
    const { data: row } = await sb
      .from("projecten")
      .select(
        "project_nummer, lead_id, offerte_id, overstap_afspraak_at, leads(naam, email)"
      )
      .eq("id", projectId)
      .maybeSingle();
    const l = Array.isArray(row?.leads) ? row?.leads[0] : row?.leads;
    if (!email) {
      email = (l as { email?: string | null } | null)?.email?.trim() || "";
      naam = (l as { naam?: string | null } | null)?.naam?.trim() || naam;
    }
    projectNummer = row?.project_nummer || projectNummer;
    leadId = leadId || row?.lead_id || null;
    offerteId = offerteId || row?.offerte_id || null;
    afspraakAt = afspraakAt || row?.overstap_afspraak_at || null;
  }

  if (!email) {
    return { ok: false, error: "Geen klant-e-mailadres" };
  }

  let batterijMerk = "je thuisbatterij";
  if (offerteId) {
    const [{ data: offMeta }, { data: regels }] = await Promise.all([
      sb
        .from("offertes")
        .select("id, titel, offerte_nummer")
        .eq("id", offerteId)
        .maybeSingle(),
      sb
        .from("offerte_regels")
        .select("omschrijving, sort_order")
        .eq("offerte_id", offerteId)
        .order("sort_order", { ascending: true })
        .limit(10),
    ]);
    batterijMerk = batterijMerkUitRegels(regels || [], offMeta?.titel);
    if (!projectNummer) {
      projectNummer = offMeta?.offerte_nummer || null;
    }
  }

  const base = appBaseUrl();
  const logoBcUrl =
    publicBrandDataUrl("batterijconcept-mark.png") ||
    `${base}/brands/batterijconcept-mark.png`;
  const logoFrankUrl =
    publicBrandDataUrl("frank-energie.png") ||
    `${base}/brands/frank-energie.png`;

  const html = overstapFrankEnergieEmail({
    naam,
    afspraakAt,
    batterijMerk,
    frankUrl: FRANK_ENERGIE_OVERSTAP_URL,
    logoBcUrl,
    logoFrankUrl,
    projectNummer,
  });

  const subject = afspraakAt
    ? `Overstap gepland op ${formatDateTimeLongNl(afspraakAt)} · BatterijConcept × Frank`
    : "Overstap dynamische energie · BatterijConcept × Frank";
  const sent = await sendEmail({
    to: email,
    subject,
    html,
    tag: "overstap-frank",
    replyTo: await replyToForLeadAdviseur(sb, leadId),
  });

  if (!sent.ok) {
    console.error("sendOverstapFrankKlantMail failed:", sent.error);
  }
  return { ...sent, to: email, subject };
}
