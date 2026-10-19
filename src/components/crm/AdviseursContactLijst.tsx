"use client";

import { useState } from "react";
import type { Adviseur } from "@/types/database";
import { isAgendaAdviseur } from "@/lib/rollen";

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className || "h-3.5 w-3.5"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className || "h-3.5 w-3.5"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function PhoneCopyButton({ telefoon }: { telefoon: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const value = telefoon.trim();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.createElement("textarea");
      el.value = value;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-muted hover:bg-wash hover:text-green-dark"
      title={copied ? "Gekopieerd" : "Kopieer telefoonnummer"}
      aria-label={copied ? "Gekopieerd" : "Kopieer telefoonnummer"}
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-green-deeper" />
      ) : (
        <CopyIcon />
      )}
    </button>
  );
}

export function AdviseursContactLijst({
  adviseurs,
}: {
  adviseurs: Adviseur[];
}) {
  const rows = adviseurs
    .filter((a) => a.actief !== false && isAgendaAdviseur(a))
    .slice()
    .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-5">
      <div className="border border-line bg-white">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <p className="font-display text-base font-semibold text-ink">
            Adviseurs
          </p>
          <p className="mt-0.5 text-sm text-muted">
            Contactgegevens · {rows.length} actief
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            Geen actieve adviseurs.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-line bg-wash/60 text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-semibold sm:px-5">Naam</th>
                  <th className="px-4 py-2.5 font-semibold">Email</th>
                  <th className="px-4 py-2.5 font-semibold">Telefoonnummer</th>
                  <th className="px-4 py-2.5 font-semibold sm:px-5">
                    Startadres
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((a) => {
                  const tel = (a.telefoon || "").trim();
                  const email = (a.email || "").trim();
                  const start = (a.start_adres || "").trim();
                  return (
                    <tr key={a.id}>
                      <td className="px-4 py-3 font-semibold text-ink sm:px-5">
                        {a.naam}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {email || "—"}
                      </td>
                      <td className="px-4 py-3">
                        {tel ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="tabular-nums text-muted">
                              {tel}
                            </span>
                            <PhoneCopyButton telefoon={tel} />
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted sm:px-5">
                        {start || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
