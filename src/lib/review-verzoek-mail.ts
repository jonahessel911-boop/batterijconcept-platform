import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email/postmark";
import {
  TRUSTPILOT_AFS_BCC,
  reviewVerzoekKlantEmail,
} from "@/lib/email/templates";

/**
 * Stuur aparte review-mail naar de klant + BCC Trustpilot AFS
 * (verified review invitation). Aanroepen bij eerste Review-afvink.
 */
export async function sendReviewVerzoekKlantMail(
  sb: SupabaseClient,
  projectId: string,
  projectRow?: Record<string, unknown> | null
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  let lead = projectRow?.leads as
    | { naam?: string | null; email?: string | null }
    | { naam?: string | null; email?: string | null }[]
    | null
    | undefined;
  if (Array.isArray(lead)) lead = lead[0] ?? null;

  let email = lead?.email?.trim() || "";
  let naam = lead?.naam?.trim() || "daar";
  const projectNummer =
    (projectRow?.project_nummer as string | null | undefined) || null;

  if (!email) {
    const { data: row } = await sb
      .from("projecten")
      .select("project_nummer, leads(naam, email)")
      .eq("id", projectId)
      .maybeSingle();
    const l = Array.isArray(row?.leads) ? row?.leads[0] : row?.leads;
    email = (l as { email?: string | null } | null)?.email?.trim() || "";
    naam = (l as { naam?: string | null } | null)?.naam?.trim() || naam;
  }

  if (!email) {
    return { ok: false, error: "Geen klant-e-mailadres" };
  }

  const html = reviewVerzoekKlantEmail({
    naam,
    email,
    projectNummer,
    referenceId: projectNummer || projectId,
  });

  const sent = await sendEmail({
    to: email,
    subject: "Hoe was jouw installatie? — Batterijconcept",
    html,
    tag: "review-verzoek",
    bcc: TRUSTPILOT_AFS_BCC,
  });

  if (!sent.ok) {
    console.error("sendReviewVerzoekKlantMail failed:", sent.error);
  }
  return sent;
}
