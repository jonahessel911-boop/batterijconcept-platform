import { parseOpleverFormulierSnapshot } from "@/lib/oplever-formulier";
import { toOperationalStatus } from "@/lib/project-status-config";

export function snapshotIsOpleverFormulier(raw: unknown): boolean {
  const snap = parseOpleverFormulierSnapshot(raw);
  if (!snap) return false;
  return Boolean(
    snap.akkoord || snap.sin || snap.afgevinkt.length > 0 || snap.monteurNaam
  );
}

/** Installatie is gedaan: opleverformulier of status ná oplevering. */
export function installatieIsOpgeleverd(project: {
  status?: string | null;
  installatie_voltooid_at?: string | null;
  oplever_formulier?: unknown;
}): boolean {
  if (project.installatie_voltooid_at) return true;
  if (snapshotIsOpleverFormulier(project.oplever_formulier)) return true;
  const op = toOperationalStatus(project.status);
  return (
    op === "installatie_voltooid" ||
    op === "after_sale" ||
    op === "review_gevraagd" ||
    op === "afgerond" ||
    op === "service"
  );
}
