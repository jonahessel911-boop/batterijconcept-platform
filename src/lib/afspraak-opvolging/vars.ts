import {
  afspraakMailVars,
  type AfspraakMailVars,
} from "@/lib/email/afspraak-sequence";
import type { AfspraakMailVarsV2 } from "@/lib/email/afspraak-sequence-v2";
import { afspraakCalendarUrl } from "@/lib/email/postmark";

type LeadBits = {
  naam?: string | null;
  postcode?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  straat?: string | null;
  plaats?: string | null;
};

export function buildOpvolgingVars(opts: {
  naam: string;
  startAt: Date;
  adviseurNaam: string;
  manageToken: string;
  manageUrl: string;
  lead?: LeadBits | null;
}): { v1: AfspraakMailVars; v2: AfspraakMailVarsV2 } {
  const v1 = afspraakMailVars({
    naam: opts.naam,
    startAt: opts.startAt,
    adviseurNaam: opts.adviseurNaam,
    manageUrl: opts.manageUrl,
    lead: opts.lead,
  });
  const v2: AfspraakMailVarsV2 = {
    ...v1,
    calendarUrl: afspraakCalendarUrl(opts.manageToken),
  };
  return { v1, v2 };
}
