"use client";

import {
  parseSollicitatieAntwoordRows,
  type SollicitatieAntwoordRow,
} from "@/lib/sollicitatie-antwoorden";
import { cn } from "@/lib/utils";

export function SollicitatieAntwoordenRows({
  notitie,
  rows: rowsProp,
  className,
  emptyLabel = "Geen antwoorden",
}: {
  notitie?: string | null;
  rows?: SollicitatieAntwoordRow[];
  className?: string;
  emptyLabel?: string;
}) {
  const rows =
    rowsProp || parseSollicitatieAntwoordRows(notitie);

  if (!rows.length) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }

  return (
    <ul className={cn("divide-y divide-line border border-line bg-white", className)}>
      {rows.map((row, i) => (
        <li
          key={`${row.vraag}-${i}`}
          className="grid grid-cols-1 gap-0.5 px-3 py-2.5 sm:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)] sm:gap-4 sm:items-start"
        >
          <p className="text-xs font-medium leading-snug text-muted sm:pt-0.5">
            {row.vraag || "Vraag"}
          </p>
          <p className="text-sm font-medium leading-snug text-ink whitespace-pre-wrap break-words">
            {row.antwoord || "—"}
          </p>
        </li>
      ))}
    </ul>
  );
}
