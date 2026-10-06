"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Adviseur,
  AdviseurCreditFactuur,
  InstallatiePartner,
  PartnerCreditFactuur,
} from "@/types/database";
import { formatDateShort, formatEuro } from "@/lib/format";
import { VERKOPER_AANBETALING_FEE } from "@/lib/adviseur-creditfactuur";

type Mode = "adviseurs" | "partners";
type StatusFilter = "alles" | "open" | "concept" | "verzonden" | "goedgekeurd" | "betaald";

type OverviewFactuur = AdviseurCreditFactuur & {
  adviseurs?: {
    id: string;
    naam: string;
    bedrijfsnaam?: string | null;
    kvk_nummer?: string | null;
    iban?: string | null;
  } | null;
};

type PartnerOverview = PartnerCreditFactuur & {
  installatie_partners?: {
    id: string;
    naam: string;
    bedrijfsnaam?: string | null;
    kvk_nummer?: string | null;
    iban?: string | null;
  } | null;
};

type FactuurRow = {
  id: string;
  nummer: string;
  bedragInc: number;
  bedragEx: number;
  status: string;
  goedgekeurd_op: string | null;
  betaald_op: string | null;
  factuurdatum: string;
  label?: string | null;
  soort?: "aanbetaling" | "restbetaling" | null;
  searchText: string;
};

type PersonGroup = {
  id: string;
  naam: string;
  kvkOk: boolean;
  facturen: FactuurRow[];
  openCount: number;
  betaaldCount: number;
  totalOpen: number;
  totalEx: number;
};

function kvkIncompleet(r: {
  bedrijfsnaam?: string | null;
  kvk_nummer?: string | null;
  iban?: string | null;
}) {
  return !r.bedrijfsnaam || !r.kvk_nummer || !r.iban;
}

function parseSoort(
  nummer: string
): "aanbetaling" | "restbetaling" | null {
  if (/\/AANBETALING\//i.test(nummer)) return "aanbetaling";
  if (/\/RESTBETALING\//i.test(nummer)) return "restbetaling";
  return null;
}

function StatusBadge({
  status,
  goedgekeurd_op,
  betaald_op,
}: {
  status: string;
  goedgekeurd_op: string | null;
  betaald_op: string | null;
}) {
  if (status === "betaald") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-dark">
        <span aria-hidden>✓</span>
        Betaald
        {betaald_op ? (
          <span className="font-normal text-muted">
            {formatDateShort(betaald_op)}
          </span>
        ) : null}
      </span>
    );
  }
  if (status === "goedgekeurd") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-dark">
        <span aria-hidden>✓</span>
        Goedgekeurd
        {goedgekeurd_op ? (
          <span className="font-normal text-muted">
            {formatDateShort(goedgekeurd_op)}
          </span>
        ) : null}
      </span>
    );
  }
  if (status === "verzonden") {
    return (
      <span className="text-xs font-semibold text-[#854D0E]">Verzonden</span>
    );
  }
  if (status === "concept") {
    return <span className="text-xs font-semibold text-muted">Concept</span>;
  }
  return <span className="text-xs capitalize text-muted">{status}</span>;
}

function SoortBadge({
  soort,
}: {
  soort?: "aanbetaling" | "restbetaling" | null;
}) {
  if (soort === "aanbetaling") {
    return (
      <span className="border border-line bg-wash px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Aanbetaling
      </span>
    );
  }
  if (soort === "restbetaling") {
    return (
      <span className="border border-green/25 bg-green-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-dark">
        Restbetaling
      </span>
    );
  }
  return null;
}

export function CreditfacturenPanel() {
  const [mode, setMode] = useState<Mode>("adviseurs");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("alles");

  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [allAdvFacturen, setAllAdvFacturen] = useState<OverviewFactuur[]>([]);
  const [advLoading, setAdvLoading] = useState(true);

  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [allPartnerFacturen, setAllPartnerFacturen] = useState<
    PartnerOverview[]
  >([]);
  const [partnerLoading, setPartnerLoading] = useState(true);

  const loadAdviseurs = useCallback(async () => {
    setAdvLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/adviseurs/creditfacturen");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setAllAdvFacturen((data.facturen || []) as OverviewFactuur[]);
      setAdviseurs((data.adviseurs || []) as Adviseur[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setAdvLoading(false);
    }
  }, []);

  const loadPartners = useCallback(async () => {
    setPartnerLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/partners/creditfacturen");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setAllPartnerFacturen((data.facturen || []) as PartnerOverview[]);
      setPartners((data.partners || []) as InstallatiePartner[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setPartnerLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "adviseurs") void loadAdviseurs();
    else void loadPartners();
  }, [mode, loadAdviseurs, loadPartners]);

  const advGroups = useMemo((): PersonGroup[] => {
    const byId = new Map<string, PersonGroup>();

    for (const a of adviseurs) {
      byId.set(a.id, {
        id: a.id,
        naam: a.naam,
        kvkOk: !kvkIncompleet(a),
        facturen: [],
        openCount: 0,
        betaaldCount: 0,
        totalOpen: 0,
        totalEx: 0,
      });
    }

    for (const f of allAdvFacturen) {
      if (f.status === "geannuleerd") continue;
      const id = f.adviseur_id;
      let g = byId.get(id);
      if (!g) {
        g = {
          id,
          naam: f.adviseurs?.naam || "Onbekend",
          kvkOk: !kvkIncompleet(f.adviseurs || {}),
          facturen: [],
          openCount: 0,
          betaaldCount: 0,
          totalOpen: 0,
          totalEx: 0,
        };
        byId.set(id, g);
      }
      const nummer = f.factuur_nummer;
      const soort = parseSoort(nummer);
      g.facturen.push({
        id: f.id,
        nummer,
        bedragInc: Number(f.bedrag_inc_btw || 0),
        bedragEx: Number(f.bedrag_ex_btw || 0),
        status: f.status,
        goedgekeurd_op: f.goedgekeurd_op ?? null,
        betaald_op: f.betaald_op ?? null,
        factuurdatum: f.factuurdatum,
        label:
          f.week_jaar != null && f.week_nummer != null
            ? `Week ${f.week_nummer}`
            : null,
        soort,
        searchText: [
          nummer,
          f.adviseurs?.naam,
          f.notities,
          soort,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      });
    }

    return [...byId.values()]
      .map((g) => {
        g.facturen.sort((a, b) =>
          (b.factuurdatum || "").localeCompare(a.factuurdatum || "")
        );
        g.betaaldCount = g.facturen.filter((f) => f.status === "betaald").length;
        g.openCount = g.facturen.filter((f) => f.status !== "betaald").length;
        g.totalOpen = g.facturen
          .filter((f) => f.status !== "betaald")
          .reduce((s, f) => s + f.bedragEx, 0);
        g.totalEx = g.facturen.reduce((s, f) => s + f.bedragEx, 0);
        return g;
      })
      .filter((g) => g.facturen.length > 0)
      .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
  }, [adviseurs, allAdvFacturen]);

  const partnerGroups = useMemo((): PersonGroup[] => {
    const byId = new Map<string, PersonGroup>();

    for (const p of partners) {
      byId.set(p.id, {
        id: p.id,
        naam: p.naam,
        kvkOk: !kvkIncompleet(p),
        facturen: [],
        openCount: 0,
        betaaldCount: 0,
        totalOpen: 0,
        totalEx: 0,
      });
    }

    for (const f of allPartnerFacturen) {
      if (f.status === "geannuleerd") continue;
      const id = f.partner_id;
      let g = byId.get(id);
      if (!g) {
        g = {
          id,
          naam: f.installatie_partners?.naam || "Onbekend",
          kvkOk: !kvkIncompleet(f.installatie_partners || {}),
          facturen: [],
          openCount: 0,
          betaaldCount: 0,
          totalOpen: 0,
          totalEx: 0,
        };
        byId.set(id, g);
      }
      const nummer = f.factuur_nummer;
      g.facturen.push({
        id: f.id,
        nummer,
        bedragInc: Number(f.bedrag_inc_btw || 0),
        bedragEx: Number(f.bedrag_ex_btw || 0),
        status: f.status,
        goedgekeurd_op: f.goedgekeurd_op ?? null,
        betaald_op: f.betaald_op ?? null,
        factuurdatum: f.factuurdatum,
        label: f.project_nummer || f.omschrijving || null,
        soort: null,
        searchText: [
          nummer,
          f.installatie_partners?.naam,
          f.omschrijving,
          f.project_nummer,
          f.offerte_nummer,
          f.notities,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      });
    }

    return [...byId.values()]
      .map((g) => {
        g.facturen.sort((a, b) =>
          (b.factuurdatum || "").localeCompare(a.factuurdatum || "")
        );
        g.betaaldCount = g.facturen.filter((f) => f.status === "betaald").length;
        g.openCount = g.facturen.filter((f) => f.status !== "betaald").length;
        g.totalOpen = g.facturen
          .filter((f) => f.status !== "betaald")
          .reduce((s, f) => s + f.bedragEx, 0);
        g.totalEx = g.facturen.reduce((s, f) => s + f.bedragEx, 0);
        return g;
      })
      .filter((g) => g.facturen.length > 0)
      .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
  }, [partners, allPartnerFacturen]);

  const groups = mode === "adviseurs" ? advGroups : partnerGroups;
  const loading = mode === "adviseurs" ? advLoading : partnerLoading;

  const q = search.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    return groups
      .map((g) => {
        let facturen = g.facturen;
        if (statusFilter === "open") {
          facturen = facturen.filter((f) => f.status !== "betaald");
        } else if (statusFilter !== "alles") {
          facturen = facturen.filter((f) => f.status === statusFilter);
        }
        if (q) {
          const naamHit = g.naam.toLowerCase().includes(q);
          facturen = facturen.filter(
            (f) => naamHit || f.searchText.includes(q)
          );
        }
        if (facturen.length === 0) return null;
        const openCount = facturen.filter((f) => f.status !== "betaald").length;
        const betaaldCount = facturen.filter(
          (f) => f.status === "betaald"
        ).length;
        const totalOpen = facturen
          .filter((f) => f.status !== "betaald")
          .reduce((s, f) => s + f.bedragEx, 0);
        const totalEx = facturen.reduce((s, f) => s + f.bedragEx, 0);
        return {
          ...g,
          facturen,
          openCount,
          betaaldCount,
          totalOpen,
          totalEx,
        };
      })
      .filter(Boolean) as PersonGroup[];
  }, [groups, q, statusFilter]);

  useEffect(() => {
    if (!filteredGroups.length) return;
    if (q || statusFilter !== "alles") {
      const next: Record<string, boolean> = {};
      for (const g of filteredGroups) next[g.id] = true;
      setOpenIds(next);
      return;
    }
    setOpenIds((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const firstOpen =
        filteredGroups.find((g) => g.openCount > 0) || filteredGroups[0];
      return { [firstOpen.id]: true };
    });
  }, [filteredGroups, q, statusFilter]);

  function toggle(id: string) {
    setOpenIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function patchStatus(
    kind: Mode,
    id: string,
    status: "verzonden" | "betaald"
  ) {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const url =
        kind === "adviseurs"
          ? "/api/adviseurs/creditfacturen"
          : "/api/partners/creditfacturen";
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Bijwerken mislukt");
      if (status === "verzonden") {
        setOkMsg(`Factuur ${json.factuur.factuur_nummer} verstuurd.`);
      } else {
        setOkMsg(
          `Factuur ${json.factuur.factuur_nummer} gemarkeerd als betaald.`
        );
      }
      if (kind === "adviseurs") await loadAdviseurs();
      else await loadPartners();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bijwerken mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf(kind: Mode, id: string, nummer: string) {
    try {
      const url =
        kind === "adviseurs"
          ? `/api/adviseurs/creditfacturen/${id}/pdf`
          : `/api/partners/creditfacturen/${id}/pdf`;
      const res = await fetch(url);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string }).error || "PDF download mislukt"
        );
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${nummer.replace(/\//g, "-")}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download mislukt");
    }
  }

  const matchCount = filteredGroups.reduce(
    (s, g) => s + g.facturen.length,
    0
  );

  return (
    <div className="space-y-4">
      <div className="border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">
              Creditfacturen
            </h2>
            <p className="mt-1 text-sm text-muted">
              {mode === "adviseurs"
                ? `10% omzet excl. · €${VERKOPER_AANBETALING_FEE} aanbetaling · rest bij installatie · +21% btw`
                : "Automatisch na voltooide installatie"}
            </p>
          </div>
          <div className="flex border border-line p-0.5">
            <button
              type="button"
              onClick={() => {
                setMode("adviseurs");
                setOpenIds({});
                setSearch("");
                setStatusFilter("alles");
                setError(null);
                setOkMsg(null);
              }}
              className={[
                "px-3 py-1.5 text-xs font-semibold",
                mode === "adviseurs"
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              Adviseurs
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("partners");
                setOpenIds({});
                setSearch("");
                setStatusFilter("alles");
                setError(null);
                setOkMsg(null);
              }}
              className={[
                "px-3 py-1.5 text-xs font-semibold",
                mode === "partners"
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              Installatiepartners
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="relative w-full sm:max-w-md">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted/50">
              ⌕
            </span>
            <input
              type="search"
              inputMode="search"
              placeholder="Zoek factuurnr, offerte, adviseur, klant…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-line bg-white py-2.5 pl-8 pr-3 text-sm outline-none transition placeholder:text-muted/60 focus:border-green"
            />
          </div>
          <div className="flex flex-wrap border border-line p-0.5">
            {(
              [
                ["alles", "Alles"],
                ["open", "Open"],
                ["concept", "Concept"],
                ["verzonden", "Verzonden"],
                ["goedgekeurd", "Goedgekeurd"],
                ["betaald", "Betaald"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatusFilter(id)}
                className={[
                  "px-2.5 py-1.5 text-[11px] font-semibold",
                  statusFilter === id
                    ? "bg-green text-white"
                    : "bg-white text-muted hover:bg-wash",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {(error || okMsg) && (
          <div className="space-y-2 border-b border-line px-4 py-3 sm:px-5">
            {error && (
              <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                {error}
              </p>
            )}
            {okMsg && (
              <p className="border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
                {okMsg}
              </p>
            )}
          </div>
        )}

        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-muted">Laden…</p>
        ) : filteredGroups.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            {q || statusFilter !== "alles"
              ? "Geen facturen gevonden voor deze zoekopdracht."
              : "Nog geen facturen. Ze ontstaan automatisch bij orders."}
          </p>
        ) : (
          <>
            <div className="border-b border-line px-4 py-2 text-xs text-muted sm:px-5">
              {matchCount} factuur{matchCount === 1 ? "" : "en"}
              {filteredGroups.length > 1
                ? ` · ${filteredGroups.length} ${mode === "adviseurs" ? "adviseurs" : "partners"}`
                : ""}
              {q ? ` · zoek: “${search.trim()}”` : ""}
            </div>
            <ul className="divide-y divide-line">
              {filteredGroups.map((g) => {
                const open = Boolean(openIds[g.id]);
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => toggle(g.id)}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-wash sm:px-5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-base font-semibold text-ink">
                            {g.naam}
                          </span>
                          {!g.kvkOk && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#C45A12]">
                              KvK incompleet
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {g.facturen.length} factuur
                          {g.facturen.length === 1 ? "" : "en"}
                          {g.openCount > 0
                            ? ` · ${g.openCount} open`
                            : " · alles betaald"}
                          {` · totaal ${formatEuro(g.totalEx)} excl.`}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        {g.openCount > 0 ? (
                          <>
                            <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                              Open excl.
                            </span>
                            <span className="block text-sm font-semibold tabular-nums text-ink">
                              {formatEuro(g.totalOpen)}
                            </span>
                          </>
                        ) : (
                          <span className="block text-xs font-semibold text-green-dark">
                            ✓ Betaald
                          </span>
                        )}
                        <span className="text-xs text-muted">
                          {open ? "▾" : "▸"}
                        </span>
                      </span>
                    </button>

                    {open ? (
                      <div className="border-t border-line bg-wash/40">
                        <ul className="divide-y divide-line/70">
                          {g.facturen.map((f) => (
                            <li
                              key={f.id}
                              className="flex flex-wrap items-center gap-3 px-4 py-3.5 pl-5 sm:px-5 sm:pl-8"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-mono text-[12px] font-semibold text-ink break-all">
                                    {f.nummer}
                                  </p>
                                  <SoortBadge soort={f.soort} />
                                </div>
                                <p className="mt-1 text-xs text-muted">
                                  {formatDateShort(f.factuurdatum)}
                                  {f.label ? ` · ${f.label}` : ""}
                                  {" · "}
                                  <span className="font-medium text-ink">
                                    {formatEuro(f.bedragEx)} excl.
                                  </span>
                                  {" · "}
                                  {formatEuro(f.bedragInc)} incl.
                                </p>
                              </div>
                              <div className="shrink-0">
                                <StatusBadge
                                  status={f.status}
                                  goedgekeurd_op={f.goedgekeurd_op}
                                  betaald_op={f.betaald_op}
                                />
                              </div>
                              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void downloadPdf(mode, f.id, f.nummer)
                                  }
                                  className="border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink hover:bg-wash"
                                >
                                  PDF
                                </button>
                                {(f.status === "concept" ||
                                  f.status === "verzonden") && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void patchStatus(mode, f.id, "verzonden")
                                    }
                                    className="bg-orange px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                                  >
                                    {f.status === "verzonden"
                                      ? "Opnieuw"
                                      : "Verstuur"}
                                  </button>
                                )}
                                {(f.status === "goedgekeurd" ||
                                  f.status === "verzonden") && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void patchStatus(mode, f.id, "betaald")
                                    }
                                    className="bg-green px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                                  >
                                    Betaald
                                  </button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
