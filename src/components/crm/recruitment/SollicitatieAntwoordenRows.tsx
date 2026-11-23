"use client";

import {
  bestandVoorAntwoord,
  isCvLikeAntwoord,
  parseSollicitatieAntwoordRows,
  sollicitatieFileHref,
  type AntwoordBestand,
  type SollicitatieAntwoordRow,
} from "@/lib/sollicitatie-antwoorden";
import { cn } from "@/lib/utils";

export function SollicitatieAntwoordenRows({
  notitie,
  rows: rowsProp,
  className,
  emptyLabel = "Geen antwoorden",
  sollicitatieId,
  bestanden = [],
}: {
  notitie?: string | null;
  rows?: SollicitatieAntwoordRow[];
  className?: string;
  emptyLabel?: string;
  sollicitatieId?: string;
  bestanden?: AntwoordBestand[];
}) {
  const rows =
    rowsProp || parseSollicitatieAntwoordRows(notitie);

  if (!rows.length) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }

  return (
    <ul className={cn("divide-y divide-line border border-line bg-white", className)}>
      {rows.map((row, i) => {
        const file = sollicitatieId
          ? bestandVoorAntwoord(row.vraag, row.antwoord, bestanden)
          : null;
        const href =
          sollicitatieId && file
            ? sollicitatieFileHref(sollicitatieId, file.id)
            : null;
        const cvLike = isCvLikeAntwoord(row.vraag, row.antwoord);
        return (
          <li
            key={`${row.vraag}-${i}`}
            className="grid grid-cols-1 gap-0.5 px-3 py-2.5 sm:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)] sm:gap-4 sm:items-start"
          >
            <p className="text-xs font-medium leading-snug text-muted sm:pt-0.5">
              {row.vraag || "Vraag"}
            </p>
            {href ? (
              <a
                href={href}
                download={file?.bestandsnaam || row.antwoord || "cv.pdf"}
                className="text-sm font-semibold leading-snug text-green-dark underline-offset-2 hover:underline break-words"
              >
                {row.antwoord || file?.bestandsnaam || "Download CV"}
              </a>
            ) : cvLike ? (
              <p className="text-sm font-medium leading-snug text-ink break-words">
                {row.antwoord || "—"}
                <span className="mt-0.5 block text-xs font-normal text-muted">
                  Bestand niet ontvangen — upload het bij Bestanden.
                </span>
              </p>
            ) : (
              <p className="text-sm font-medium leading-snug text-ink whitespace-pre-wrap break-words">
                {row.antwoord || "—"}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
