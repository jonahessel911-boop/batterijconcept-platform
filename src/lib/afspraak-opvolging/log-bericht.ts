import type { SupabaseClient } from "@supabase/supabase-js";

export const OPVOLGING_BERICHT_STEPS = [
  "bevestiging",
  "social-proof",
  "reminder-48u",
  "avond-vooraf",
  "opwarm",
  "herinnering-24u",
  "test",
] as const;

export type OpvolgingBerichtStep = (typeof OPVOLGING_BERICHT_STEPS)[number];

export type OpvolgingBerichtChannel = "email" | "sms";
export type OpvolgingBerichtStatus = "sent" | "failed" | "skipped";

export const OPVOLGING_BERICHT_STEP_LABELS: Record<
  OpvolgingBerichtStep,
  string
> = {
  bevestiging: "Bevestiging",
  "social-proof": "Social proof",
  "reminder-48u": "Reminder 48u",
  "avond-vooraf": "Avond vooraf",
  opwarm: "Opwarm",
  "herinnering-24u": "Herinnering 24u",
  test: "Test",
};

export type LogOpvolgingBerichtInput = {
  afspraakId?: string | null;
  leadId?: string | null;
  opvolgingFlow?: string | null;
  step: OpvolgingBerichtStep;
  channel: OpvolgingBerichtChannel;
  status: OpvolgingBerichtStatus;
  klantNaam?: string | null;
  toEmail?: string | null;
  toPhone?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  provider?: "postmark" | "bird" | null;
  providerMessageId?: string | null;
  tag?: string | null;
  error?: string | null;
};

function previewText(raw: string | null | undefined, max = 280): string | null {
  if (!raw) return null;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Schrijf één berichtenlog-regel. Mag nooit de verzending zelf blokkeren.
 */
export async function logOpvolgingBericht(
  sb: SupabaseClient,
  input: LogOpvolgingBerichtInput
): Promise<void> {
  try {
    const flow =
      input.opvolgingFlow === "intensief" ||
      input.opvolgingFlow === "rustig" ||
      input.opvolgingFlow === "legacy"
        ? input.opvolgingFlow
        : null;

    const { error } = await sb.from("afspraak_opvolging_berichten").insert({
      afspraak_id: input.afspraakId || null,
      lead_id: input.leadId || null,
      opvolging_flow: flow,
      step: input.step,
      channel: input.channel,
      status: input.status,
      klant_naam: input.klantNaam?.trim() || null,
      to_email: input.toEmail?.trim() || null,
      to_phone: input.toPhone?.trim() || null,
      subject: input.subject?.trim() || null,
      body_preview: previewText(input.bodyPreview),
      provider: input.provider || null,
      provider_message_id: input.providerMessageId || null,
      tag: input.tag || null,
      error: input.error || null,
    });

    if (error) {
      if (
        error.message?.includes("afspraak_opvolging_berichten") ||
        error.code === "42P01" ||
        error.code === "42703" ||
        error.code === "PGRST204"
      ) {
        return;
      }
      console.error("[opvolging-berichten] insert failed", error.message);
    }
  } catch (e) {
    console.error(
      "[opvolging-berichten] insert threw",
      e instanceof Error ? e.message : e
    );
  }
}
