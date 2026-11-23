import { isWarmtepompProduct } from "@/lib/inkoop";

/** Partner-intake-status op `project.materiaal_checks`. */
export const TCSWISS_INTAKE_CHECK_KEY = "__tcswiss_intake";

export type TcSwissIntakeStored = {
  at: string;
  lead: string | null;
  externId: string | null;
  duplicate: boolean;
};

export function parseTcSwissIntakeStored(
  checks: Record<string, boolean | string> | null | undefined
): TcSwissIntakeStored | null {
  const raw = checks?.[TCSWISS_INTAKE_CHECK_KEY];
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== "object") return null;
    return {
      at: typeof o.at === "string" ? o.at : "",
      lead: typeof o.lead === "string" ? o.lead : null,
      externId: typeof o.externId === "string" ? o.externId : null,
      duplicate: Boolean(o.duplicate),
    };
  } catch {
    return null;
  }
}

export function serializeTcSwissIntakeStored(
  stored: TcSwissIntakeStored
): string {
  return JSON.stringify(stored);
}

export function splitNaamVoorTcSwiss(naam: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const t = (naam || "").trim();
  if (!t) return { firstName: "", lastName: "Onbekend" };
  const i = t.indexOf(" ");
  if (i <= 0) return { firstName: "", lastName: t };
  const lastName = t.slice(i + 1).trim();
  return {
    firstName: t.slice(0, i).trim(),
    lastName: lastName || t,
  };
}

export function regelsZijnWarmtepomp(
  regels: {
    sku?: string | null;
    omschrijving?: string | null;
    naam?: string | null;
  }[]
): boolean {
  return regels.some((r) =>
    isWarmtepompProduct({
      sku: r.sku,
      naam: r.naam || r.omschrijving,
    })
  );
}
