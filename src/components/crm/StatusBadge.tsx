import {
  statusTone,
  leadStatusLabel,
  prioriteitLabel,
  offerteStatusLabel,
  projectStatusLabel,
  factuurStatusLabel,
  afspraakStatusLabel,
  normalizeProjectStatus,
  resolveDisplayProjectStatus,
  resolveProjectStatusLabel,
} from "@/lib/labels";

export function StatusBadge({
  kind,
  value,
  project,
}: {
  kind: "lead" | "offerte" | "project" | "factuur" | "prioriteit" | "afspraak";
  value: string;
  /** Voor project: corrigeert week-placeholder → juiste label */
  project?: {
    status?: string | null;
    schouw_at?: string | null;
    schouw_jaar?: number | null;
    schouw_week?: number | null;
    betaalwijze?: string | null;
    leads?: { status?: string | null } | null;
    offertes?:
      | { financiering_voorbehoud?: boolean | null }
      | { financiering_voorbehoud?: boolean | null }[]
      | null;
  };
}) {
  const labels =
    kind === "lead"
      ? leadStatusLabel
      : kind === "offerte"
        ? offerteStatusLabel
        : kind === "project"
          ? projectStatusLabel
          : kind === "factuur"
            ? factuurStatusLabel
            : kind === "afspraak"
              ? afspraakStatusLabel
              : prioriteitLabel;

  const resolved =
    kind === "project"
      ? project
        ? resolveDisplayProjectStatus({ ...project, status: value })
        : normalizeProjectStatus(value)
      : value;
  const label =
    kind === "project"
      ? resolveProjectStatusLabel(resolved, project)
      : ((labels as Record<string, string>)[resolved] ?? value);

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${statusTone(kind, resolved)}`}
    >
      {label}
    </span>
  );
}
