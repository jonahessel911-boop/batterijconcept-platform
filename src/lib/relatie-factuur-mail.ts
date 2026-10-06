import { sendEmail } from "@/lib/email/postmark";
import { relatieFactuurAanBcEmail } from "@/lib/email/templates";
import { formatDateShort, formatEuro } from "@/lib/format";
import { relatieFactuurVervaldatum } from "@/lib/pdf-relatie-factuur";

export async function mailRelatieFactuur(opts: {
  to: string | null | undefined;
  naam: string;
  factuurNummer: string;
  bedragInc: number;
  factuurdatum: string;
  iban?: string | null;
  rolLabel: "adviseur" | "installatiepartner";
  pdfBytes: Buffer;
  variant?: "ter_goedkeuring" | "goedgekeurd";
}): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const email = opts.to?.trim().toLowerCase();
  if (!email) {
    return { ok: false, skipped: true, error: "Geen e-mailadres" };
  }

  const variant = opts.variant || "ter_goedkeuring";
  const vervaldatum = relatieFactuurVervaldatum(opts.factuurdatum);
  const html = relatieFactuurAanBcEmail({
    naam: opts.naam,
    factuurNummer: opts.factuurNummer,
    bedrag: formatEuro(opts.bedragInc),
    vervaldatum: formatDateShort(vervaldatum),
    iban: opts.iban,
    rolLabel: opts.rolLabel,
    variant,
  });

  const sent = await sendEmail({
    to: email,
    subject:
      variant === "goedgekeurd"
        ? `Factuur ${opts.factuurNummer} goedgekeurd`
        : `Factuur ${opts.factuurNummer} aan Batterijconcept`,
    html,
    tag:
      opts.rolLabel === "adviseur"
        ? variant === "goedgekeurd"
          ? "adviseur-factuur-goedgekeurd"
          : "adviseur-factuur-verzonden"
        : variant === "goedgekeurd"
          ? "partner-factuur-goedgekeurd"
          : "partner-factuur-verzonden",
    attachments: [
      {
        name: `${opts.factuurNummer}.pdf`,
        contentType: "application/pdf",
        content: opts.pdfBytes,
      },
    ],
  });

  return sent;
}
