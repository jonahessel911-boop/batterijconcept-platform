import {
  statusTone,
  leadStatusLabel,
  prioriteitLabel,
  offerteStatusLabel,
  projectStatusLabel,
  factuurStatusLabel,
} from "@/lib/labels";

export function StatusBadge({
  kind,
  value,
}: {
  kind: "lead" | "offerte" | "project" | "factuur" | "prioriteit";
  value: string;
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
            : prioriteitLabel;

  const label = (labels as Record<string, string>)[value] ?? value;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone(kind, value)}`}
    >
      {label}
    </span>
  );
}
