"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Adviseur } from "@/types/database";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { ZzpContractModal } from "./ZzpContractModal";

type ContractStatus = "geen" | "verzonden" | "ondertekend";
type StatusFilter = "all" | "ondertekend" | "niet_ondertekend";

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

function initials(naam: string): string {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
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

const FILTER_NAV: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Alles" },
  { key: "ondertekend", label: "Ondertekend" },
  { key: "niet_ondertekend", label: "Niet ondertekend" },
];

function stopBtn(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export function OvereenkomstenPanel({
  embedded = false,
}: {
  /** Zonder eigen page-header (parent toont die al). */
  embedded?: boolean;
}) {
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Adviseur | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [zoek, setZoek] = useState("");

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

  const counts = useMemo(() => {
    let ondertekend = 0;
    let niet = 0;
    for (const a of adviseurs) {
      if (statusOf(a) === "ondertekend") ondertekend += 1;
      else niet += 1;
    }
    return { all: adviseurs.length, ondertekend, niet };
  }, [adviseurs]);

  const filtered = useMemo(() => {
    const q = zoek.trim().toLowerCase();
    return adviseurs.filter((a) => {
      const st = statusOf(a);
      if (statusFilter === "ondertekend" && st !== "ondertekend") return false;
      if (statusFilter === "niet_ondertekend" && st === "ondertekend")
        return false;
      if (!q) return true;
      return (
        a.naam.toLowerCase().includes(q) ||
        (a.email || "").toLowerCase().includes(q) ||
        (a.bedrijfsnaam || "").toLowerCase().includes(q)
      );
    });
  }, [adviseurs, statusFilter, zoek]);

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
    <div
      className={
        embedded
          ? "flex h-full min-h-0 flex-col bg-white"
          : "space-y-0 border border-line bg-white"
      }
    >
      {!embedded ? (
        <div className="shrink-0 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="font-display text-xl font-semibold text-ink">
            Overeenkomsten
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            ZZP-samenwerkingsovereenkomst versturen · digitaal tekenen · PDF
            terugzien
          </p>
        </div>
      ) : null}

      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-3 py-2.5 sm:flex-row sm:items-center sm:px-4">
        <div className="relative w-full min-w-0 flex-1 sm:max-w-md">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted">
            ⌕
          </span>
          <input
            type="search"
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            placeholder="Zoek naam, e-mail, bedrijf…"
            className="h-9 w-full rounded-md border border-line bg-white py-2 pr-3 pl-8 text-sm text-ink outline-none placeholder:text-muted/70 focus:border-green"
            aria-label="Zoeken"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_NAV.map((item) => {
            const active = statusFilter === item.key;
            const count =
              item.key === "all"
                ? counts.all
                : item.key === "ondertekend"
                  ? counts.ondertekend
                  : counts.niet;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatusFilter(item.key)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition",
                  active
                    ? "bg-wash text-ink ring-1 ring-line"
                    : "text-muted hover:bg-wash/70 hover:text-ink"
                )}
              >
                {item.label}
                <span className="ml-1 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <div className="shrink-0 border-b border-line px-3 py-2 sm:px-4">
          <p className="rounded-md border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
            {error}
          </p>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="px-5 py-14 text-center text-sm text-muted">Laden…</p>
        ) : adviseurs.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-muted">
            Nog geen actieve teamleden.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-muted">
            Geen overeenkomsten voor dit filter.
          </p>
        ) : (
          <table className="crm-table">
            <thead>
              <tr>
                <th>Persoon / bedrijf</th>
                <th>E-mail</th>
                <th>Status</th>
                <th>Actie</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const st = statusOf(a);
                const ui = STATUS_UI[st];
                return (
                  <tr
                    key={a.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(a)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(a);
                      }
                    }}
                  >
                    <td>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar size="sm" className="size-8">
                          <AvatarFallback className="text-[11px]">
                            {initials(a.naam)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <span className="block truncate font-medium text-ink">
                            {a.naam}
                          </span>
                          {a.bedrijfsnaam ? (
                            <span className="block truncate text-[11px] text-muted">
                              {a.bedrijfsnaam}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="text-muted">{a.email || "—"}</td>
                    <td>
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                          ui.className
                        )}
                      >
                        {ui.label}
                      </span>
                      {st === "ondertekend" && a.contract_uploaded_at ? (
                        <span className="mt-1 block text-[11px] text-muted">
                          {new Date(a.contract_uploaded_at).toLocaleDateString(
                            "nl-NL"
                          )}
                        </span>
                      ) : null}
                    </td>
                    <td onClick={stopBtn}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelected(a)}
                          className={cn(
                            "rounded-md px-3 py-1.5 text-[11px] font-semibold",
                            st === "ondertekend"
                              ? "border border-line text-ink hover:bg-wash"
                              : "bg-green text-white hover:bg-green-dark"
                          )}
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
                            className="rounded-md border border-[#C62828]/40 px-3 py-1.5 text-[11px] font-semibold text-[#C62828] hover:bg-[#FFEBEE]"
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
        )}
      </div>

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
