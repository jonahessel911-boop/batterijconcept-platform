import type { LeadStatus } from "@/types/database";
import { leadStatusLabel } from "@/lib/labels";

export type BelUitkomstBron = "bellen" | "leads";

const BEL_TAB_AFBOEK = new Set<LeadStatus>([
  "geen_contact",
  "definitief_geen_contact",
  "foutief_nummer",
  "gegevens_niet_overeen",
  "geen_interesse",
  "geen_interesse_al_batterij",
  "geen_interesse_plugin",
  "geen_interesse_alleen_info",
  "geen_interesse_vertrouwt_niet",
]);

export function isBelTabAfboekStatus(status: LeadStatus): boolean {
  return BEL_TAB_AFBOEK.has(status);
}

export function belUitkomstEventPayload(opts: {
  gekozenStatus: LeadStatus;
  opgeslagenStatus: LeadStatus;
  pogingen: number;
  maxPogingen: number;
  herplan?: boolean;
  definitief?: boolean;
  bron: BelUitkomstBron;
  extraDetail?: string | null;
  titel?: string;
}): {
  soort: "bel";
  titel: string;
  detail: string;
  meta: Record<string, unknown>;
} {
  const label =
    opts.titel?.trim() ||
    leadStatusLabel[opts.opgeslagenStatus] ||
    opts.opgeslagenStatus;
  const isGeenContact = opts.gekozenStatus === "geen_contact";
  const pogingBit = isGeenContact
    ? ` (${opts.pogingen}/${opts.maxPogingen})`
    : "";
  const parts: string[] = [];
  if (isGeenContact) {
    parts.push(`Poging ${opts.pogingen} van ${opts.maxPogingen}`);
    if (opts.herplan) parts.push("Herplan");
    if (opts.definitief) parts.push("Definitief geen contact");
  } else {
    parts.push(`Uitkomst: ${label}`);
    if (opts.pogingen > 0) {
      parts.push(`Eerdere belpogingen: ${opts.pogingen}`);
    }
  }
  if (opts.extraDetail?.trim()) parts.push(opts.extraDetail.trim());

  return {
    soort: "bel",
    titel: `Belpoging: ${label}${pogingBit}`,
    detail: parts.join(" · "),
    meta: {
      bron: opts.bron,
      uitkomst: opts.gekozenStatus,
      status: opts.opgeslagenStatus,
      belpogingen: opts.pogingen,
      belpogingen_max: opts.maxPogingen,
      herplan: Boolean(opts.herplan),
      definitief: Boolean(opts.definitief),
    },
  };
}
