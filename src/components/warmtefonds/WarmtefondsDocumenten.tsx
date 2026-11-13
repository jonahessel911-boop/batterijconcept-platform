"use client";

export type KlantDocument = {
  id: string;
  soort: "offerte" | "factuur";
  naam: string;
  status: string;
  statusLabel: string;
  pdf: string;
  projectId: string;
  toelichting: string | null;
};

function statusTone(status: string): string {
  if (status === "ondertekend" || status === "betaald") {
    return "bg-green-soft text-green-dark";
  }
  if (status === "verzonden" || status === "deels_betaald") {
    return "bg-[#FFF7ED] text-[#C45A12]";
  }
  if (status === "afgewezen" || status === "vervallen" || status === "verlopen") {
    return "bg-[#FEF2F2] text-[#B91C1C]";
  }
  return "bg-wash text-muted";
}

/** Offerte en facturen direct onder de klantnaam. */
export function KlantDocumenten({ docs }: { docs: KlantDocument[] }) {
  if (docs.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()}>
      {docs.map((d) => (
        <li key={d.id} className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">
            {d.naam}
            {d.toelichting ? (
              <span className="font-normal text-muted"> · {d.toelichting}</span>
            ) : null}
          </span>
          <a
            href={`${d.pdf}${d.pdf.includes("?") ? "&" : "?"}inline=1`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-[#C45A12] hover:bg-wash"
            title="PDF openen"
            aria-label={`PDF ${d.naam}`}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
              <path
                fill="currentColor"
                d="M6 2h8.2L20 7.8V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V8h4.5L13 3.5zM8 13.2h1.3c.9 0 1.5.5 1.5 1.3 0 .8-.6 1.3-1.5 1.3H9.1V17H8v-3.8zm1.1.9v.9h.2c.3 0 .5-.1.5-.45s-.2-.45-.5-.45h-.2zM11.6 13.2H13c1.1 0 1.8.6 1.8 1.9s-.7 1.9-1.8 1.9h-1.4v-3.8zm1.1.9v2h.2c.5 0 .8-.3.8-1s-.3-1-.8-1h-.2zM15.6 13.2h2.6v.9h-1.5V15h1.3v.8h-1.3V17h-1.1v-3.8z"
              />
            </svg>
          </a>
          <span
            className={[
              "inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              statusTone(d.status),
            ].join(" ")}
          >
            {d.statusLabel}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Compacte chips voor tabel/kanban: soort + status, klik opent PDF. */
export function KlantDocumentenCompact({ docs }: { docs: KlantDocument[] }) {
  if (docs.length === 0) return null;
  return (
    <ul
      className="mt-1 flex flex-wrap gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {docs.map((d) => (
        <li key={d.id}>
          <a
            href={`${d.pdf}${d.pdf.includes("?") ? "&" : "?"}inline=1`}
            target="_blank"
            rel="noreferrer"
            title={`${d.naam}${d.toelichting ? ` · ${d.toelichting}` : ""}`}
            className={[
              "inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold hover:border-green-dark/40",
              statusTone(d.status),
            ].join(" ")}
          >
            <span className="uppercase tracking-wide opacity-70">
              {d.soort === "offerte" ? "Off" : "Fac"}
            </span>
            {d.statusLabel}
          </a>
        </li>
      ))}
    </ul>
  );
}
