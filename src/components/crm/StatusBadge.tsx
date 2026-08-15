import {
  statusTone,
  leadStatusLabel,
  prioriteitLabel,
  offerteStatusLabel,
  projectStatusLabel,
  factuurStatusLabel,
  afspraakStatusLabel,
} from "@/lib/labels";

export function StatusBadge({
  kind,
  value,
}: {
  kind: "lead" | "offerte" | "project" | "factuur" | "prioriteit" | "afspraak";
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
            : kind === "afspraak"
              ? afspraakStatusLabel
              : prioriteitLabel;

  const label = (labels as Record<string, string>)[value] ?? value;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${statusTone(kind, value)}`}
    >
      {label}
    </span>
  );
}
