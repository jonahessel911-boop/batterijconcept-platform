import type { InkoopLeverancierStatus } from "@/lib/project-inkoop-checklist";
import { parseInkoopLeverancierStatus } from "@/lib/project-inkoop-checklist";

/** Fallback keys in materiaal_checks als DB-kolommen nog ontbreken. */
export const INKOOP_LEV_STATUS_CHECK_KEY = "__inkoop_leverancier_status";
export const INKOOP_LEV_BETAALD_OP_CHECK_KEY = "__inkoop_leverancier_betaald_op";

export function resolveInkoopLeverancierStatus(project: {
  inkoop_leverancier_status?: string | null;
  materiaal_checks?: Record<string, unknown> | null;
}): InkoopLeverancierStatus {
  if (
    project.inkoop_leverancier_status === "betaald" ||
    project.inkoop_leverancier_status === "op_krediet" ||
    project.inkoop_leverancier_status === "geen"
  ) {
    return project.inkoop_leverancier_status;
  }
  return parseInkoopLeverancierStatus(
    project.materiaal_checks?.[INKOOP_LEV_STATUS_CHECK_KEY]
  );
}

export function resolveInkoopLeverancierBetaaldOp(project: {
  inkoop_leverancier_betaald_op?: string | null;
  materiaal_checks?: Record<string, unknown> | null;
}): string | null {
  const col = project.inkoop_leverancier_betaald_op?.trim();
  if (col) return col;
  const raw = project.materiaal_checks?.[INKOOP_LEV_BETAALD_OP_CHECK_KEY];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

export function withLeverancierBetalingInChecks(
  checks: Record<string, unknown> | null | undefined,
  status: InkoopLeverancierStatus,
  betaaldOp: string | null
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(checks && typeof checks === "object" ? checks : {}),
  };
  if (status === "geen") {
    delete next[INKOOP_LEV_STATUS_CHECK_KEY];
    delete next[INKOOP_LEV_BETAALD_OP_CHECK_KEY];
  } else {
    next[INKOOP_LEV_STATUS_CHECK_KEY] = status;
    if (betaaldOp) next[INKOOP_LEV_BETAALD_OP_CHECK_KEY] = betaaldOp;
    else delete next[INKOOP_LEV_BETAALD_OP_CHECK_KEY];
  }
  return next;
}

export function isInkoopLeverancierColumnError(error: {
  message?: string;
  code?: string;
} | null): boolean {
  if (!error) return false;
  const msg = error.message || "";
  return (
    msg.includes("inkoop_leverancier_status") ||
    msg.includes("inkoop_leverancier_betaald_op") ||
    (error.code === "42703" && msg.toLowerCase().includes("inkoop_leverancier"))
  );
}
