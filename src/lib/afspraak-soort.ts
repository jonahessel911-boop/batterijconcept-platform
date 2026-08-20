import type { AfspraakSoort, LeadStatus } from "@/types/database";
import { AFSPRAAK_DUUR_MINUTEN } from "@/lib/slots";

export const AFSPRAAK_SOORTEN: AfspraakSoort[] = [
  "nieuw",
  "bel",
  "vervolg_fysiek",
  "vervolg_tel",
];

export const afspraakSoortLabel: Record<AfspraakSoort, string> = {
  nieuw: "Afspraak",
  bel: "Terugbel afspraak",
  vervolg_fysiek: "Vervolg fysiek",
  vervolg_tel: "Vervolg telefonisch",
};

export function normalizeAfspraakSoort(
  value: string | null | undefined
): AfspraakSoort {
  if (
    value === "bel" ||
    value === "vervolg_fysiek" ||
    value === "vervolg_tel" ||
    value === "nieuw"
  ) {
    return value;
  }
  return "nieuw";
}

/** Fysieke afspraken blokkeren de agenda; bel/telefonisch niet. */
export function afspraakBlokkeertAgenda(
  soort: string | null | undefined
): boolean {
  const s = normalizeAfspraakSoort(soort);
  return s === "nieuw" || s === "vervolg_fysiek";
}

export function afspraakStuurtMail(soort: string | null | undefined): boolean {
  return normalizeAfspraakSoort(soort) === "nieuw";
}

export function afspraakDuurMinuten(soort: string | null | undefined): number {
  return afspraakBlokkeertAgenda(soort) ? AFSPRAAK_DUUR_MINUTEN : 30;
}

export function leadStatusVoorAfspraakSoort(
  soort: string | null | undefined
): LeadStatus {
  const s = normalizeAfspraakSoort(soort);
  if (s === "vervolg_fysiek") return "vervolg_fysiek";
  if (s === "vervolg_tel") return "vervolg_tel";
  return "afspraak";
}

export function isNaAfspraakStatus(status: string | null | undefined): boolean {
  return status === "na_afspraak";
}
