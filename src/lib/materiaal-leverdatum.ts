/** Speciale key in materiaal_checks als kolom materiaal_leverdatum nog ontbreekt. */
export const MATERIAAL_LEVERDATUM_CHECK_KEY = "__leverdatum";

export function resolveMateriaalLeverdatum(project: {
  materiaal_leverdatum?: string | null;
  materiaal_checks?: Record<string, unknown> | null;
}): string | null {
  const col = project.materiaal_leverdatum?.trim();
  if (col) return col;
  const raw = project.materiaal_checks?.[MATERIAAL_LEVERDATUM_CHECK_KEY];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

/** Merge leverdatum in checks (fallback zonder DB-kolom). */
export function withLeverdatumInChecks(
  checks: Record<string, unknown> | null | undefined,
  leverdatumIso: string | null
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(checks && typeof checks === "object" ? checks : {}),
  };
  if (leverdatumIso) next[MATERIAAL_LEVERDATUM_CHECK_KEY] = leverdatumIso;
  else delete next[MATERIAAL_LEVERDATUM_CHECK_KEY];
  return next;
}

export function isMateriaalLeverdatumColumnError(error: {
  message?: string;
  code?: string;
} | null): boolean {
  if (!error) return false;
  const msg = error.message || "";
  return (
    msg.includes("materiaal_leverdatum") ||
    (error.code === "42703" && msg.toLowerCase().includes("leverdatum"))
  );
}
