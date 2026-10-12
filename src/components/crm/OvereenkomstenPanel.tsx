"use client";

import { useCallback, useEffect, useState } from "react";
import type { Adviseur } from "@/types/database";
import { ZzpContractModal } from "./ZzpContractModal";

type ContractStatus = "geen" | "verzonden" | "ondertekend";

function statusOf(a: Adviseur): ContractStatus {
  if (
    a.contract_sign_status === "ondertekend" ||
    a.contract_bestandsnaam
  ) {
    return "ondertekend";
  }
  if (a.contract_sign_status === "verzonden") return "verzonden";
  return "geen";
}

const STATUS_UI: Record<
  ContractStatus,
  { label: string; className: string }
> = {
  geen: {
    label: "Nog niet verstuurd",
    className: "bg-wash text-muted",
  },
  verzonden: {
    label: "Wacht op handtekening",
    className: "bg-[#FFF0E6] text-[#C45A12]",
  },
  ondertekend: {
    label: "Ondertekend",
    className: "bg-green-soft text-green-dark",
  },
};

export function OvereenkomstenPanel() {
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Adviseur | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/adviseurs");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Laden mislukt"
        );
      }
      const list = ((data.adviseurs || []) as Adviseur[]).filter(
        (a) => a.actief !== false
      );
      list.sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
      setAdviseurs(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function deleteRow(a: Adviseur) {
    if (
      !confirm(
        `Contract van ${a.naam} verwijderen? Je kunt daarna opnieuw versturen.`
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/relaties/adviseur/${a.id}/contract`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Verwijderen mislukt"
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    }
  }

  return (
    <div className="space-y-4 px-4 py-4 sm:px-5">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">
          Overeenkomsten
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          ZZP-samenwerkingsovereenkomst versturen · contactpersoon tekent
          digitaal · ondertekende PDF hier terugzien
        </p>
      </div>

      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted">Laden…</p>
      ) : adviseurs.length === 0 ? (
        <p className="text-sm text-muted">Nog geen actieve teamleden.</p>
      ) : (
        <div className="overflow-hidden border border-line bg-white">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Persoon / bedrijf</th>
                <th className="px-4 py-3 font-semibold">E-mail</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Actie</th>
              </tr>
            </thead>
            <tbody>
              {adviseurs.map((a) => {
                const st = statusOf(a);
                const ui = STATUS_UI[st];
                return (
                  <tr
                    key={a.id}
                    className="border-b border-line/80 last:border-b-0"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{a.naam}</p>
                      {a.bedrijfsnaam ? (
                        <p className="text-xs text-muted">{a.bedrijfsnaam}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {a.email || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex rounded px-2 py-0.5 text-[10px] font-semibold",
                          ui.className,
                        ].join(" ")}
                      >
                        {ui.label}
                      </span>
                      {st === "ondertekend" && a.contract_uploaded_at ? (
                        <p className="mt-1 text-[11px] text-muted">
                          {new Date(a.contract_uploaded_at).toLocaleDateString(
                            "nl-NL"
                          )}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelected(a)}
                          className={[
                            "min-h-8 px-3 text-[11px] font-semibold",
                            st === "ondertekend"
                              ? "border border-line text-ink hover:bg-wash"
                              : "bg-green text-white hover:bg-green-dark",
                          ].join(" ")}
                        >
                          {st === "geen"
                            ? "Verstuur overeenkomst"
                            : st === "verzonden"
                              ? "Open / opnieuw"
                              : "Bekijk PDF"}
                        </button>
                        {st !== "geen" ? (
                          <button
                            type="button"
                            onClick={() => void deleteRow(a)}
                            className="min-h-8 border border-[#C62828]/40 px-3 text-[11px] font-semibold text-[#C62828] hover:bg-[#FFEBEE]"
                          >
                            Verwijderen
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <ZzpContractModal
          adviseur={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
