"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { PartnerCreditFactuur, Project } from "@/types/database";
import { formatDateShort, formatEuro } from "@/lib/format";
import { RELATIE_BTW_PCT } from "@/lib/relatie-btw";
import { Planbord } from "@/components/crm/Planbord";
import { PartnerTeamgenotenPanel } from "@/components/installatie/PartnerTeamgenotenPanel";

type OrderRow = Project & {
  leads?: Project["leads"];
};

type PortalTab = "agenda" | "facturen" | "team";

type FactuurRow = Pick<
  PartnerCreditFactuur,
  | "id"
  | "factuur_nummer"
  | "status"
  | "week_jaar"
  | "week_nummer"
  | "periode_van"
  | "periode_tot"
  | "omschrijving"
  | "offerte_nummer"
  | "project_nummer"
  | "bedrag_ex_btw"
  | "btw_bedrag"
  | "bedrag_inc_btw"
  | "factuurdatum"
  | "betaald_op"
  | "goedgekeurd_op"
>;

type DraftRegel = { omschrijving: string; bedrag: string };

const NAV: { id: PortalTab; label: string }[] = [
  { id: "agenda", label: "Agenda" },
  { id: "team", label: "Team" },
  { id: "facturen", label: "Facturen" },
];

function factuurStatusLabel(f: FactuurRow): {
  label: string;
  tone: "ok" | "wait" | "muted";
} {
  if (f.status === "betaald") return { label: "Betaald", tone: "ok" };
  if (f.status === "goedgekeurd") return { label: "Ingediend · te betalen", tone: "ok" };
  if (f.status === "verzonden") return { label: "Te goedkeuren", tone: "wait" };
  if (f.status === "concept") return { label: "Concept", tone: "muted" };
  return { label: f.status, tone: "muted" };
}

function emptyRegel(): DraftRegel {
  return { omschrijving: "", bedrag: "" };
}

export function InstallatieOrdersPage() {
  const { token } = useParams<{ token: string }>();

  const [tab, setTab] = useState<PortalTab>(() => {
    if (typeof window === "undefined") return "agenda";
    const q = new URLSearchParams(window.location.search).get("tab");
    return q === "team" || q === "facturen" || q === "agenda" ? q : "agenda";
  });
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [partnerNaam, setPartnerNaam] = useState("");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [facturen, setFacturen] = useState<FactuurRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [facturenLoading, setFacturenLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [approveBusy, setApproveBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [regels, setRegels] = useState<DraftRegel[]>([emptyRegel()]);
  const [projectNummer, setProjectNummer] = useState("");
  const [creating, setCreating] = useState(false);
  const [heeftKvk, setHeeftKvk] = useState(true);

  const draftTotals = useMemo(() => {
    const ex = regels.reduce((s, r) => {
      const n = Number(String(r.bedrag).replace(",", "."));
      return s + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);
    const btw = Math.round(ex * RELATIE_BTW_PCT * 100) / 100;
    const inc = Math.round((ex + btw) * 100) / 100;
    return { ex, btw, inc };
  }, [regels]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/installatie/${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Niet gevonden");
      setPartnerId(data.partner?.id || null);
      setPartnerNaam(data.partner?.naam || "");
      setOrders(data.orders || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadFacturen = useCallback(async () => {
    setFacturenLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/installatie/${token}/facturen`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Facturen laden mislukt");
      if (data.partner?.naam) setPartnerNaam(data.partner.naam);
      setFacturen((data.facturen || []) as FactuurRow[]);
      if (typeof data.partner?.heeft_kvk === "boolean") {
        setHeeftKvk(data.partner.heeft_kvk);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setFacturenLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void loadOrders());
    return () => cancelAnimationFrame(id);
  }, [loadOrders]);

  useEffect(() => {
    if (tab === "facturen") void loadFacturen();
  }, [tab, loadFacturen]);

  async function downloadPdf(id: string, nummer: string) {
    setPdfBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/installatie/${token}/facturen/${id}/pdf`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string }).error || "PDF download mislukt"
        );
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${nummer}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download mislukt");
    } finally {
      setPdfBusy(null);
    }
  }

  async function goedkeuren(id: string) {
    setApproveBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/installatie/${token}/facturen/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "goedkeuren" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Goedkeuren mislukt");
      await loadFacturen();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Goedkeuren mislukt");
    } finally {
      setApproveBusy(null);
    }
  }

  async function verstuurConcept(id: string) {
    setApproveBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/installatie/${token}/facturen/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "versturen" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Versturen mislukt");
      await loadFacturen();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Versturen mislukt");
    } finally {
      setApproveBusy(null);
    }
  }

  async function createFactuur(verstuur: boolean) {
    setCreating(true);
    setError(null);
    try {
      const payloadRegels = regels
        .map((r) => ({
          omschrijving: r.omschrijving.trim(),
          bedrag_ex_btw: Number(String(r.bedrag).replace(",", ".")),
          project_nummer: projectNummer.trim() || null,
        }))
        .filter(
          (r) =>
            r.omschrijving &&
            Number.isFinite(r.bedrag_ex_btw) &&
            r.bedrag_ex_btw > 0
        );
      if (payloadRegels.length === 0) {
        throw new Error(
          "Voeg minstens één regel toe met omschrijving en bedrag."
        );
      }
      const res = await fetch(`/api/installatie/${token}/facturen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regels: payloadRegels,
          project_nummer: projectNummer.trim() || undefined,
          verstuur,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Aanmaken mislukt");
      setShowCreate(false);
      setRegels([emptyRegel()]);
      setProjectNummer("");
      await loadFacturen();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aanmaken mislukt");
    } finally {
      setCreating(false);
    }
  }

  const projectOptions = useMemo(() => {
    const nums = new Set<string>();
    for (const o of orders) {
      if (o.project_nummer) nums.add(o.project_nummer);
    }
    return [...nums].sort();
  }, [orders]);

  return (
    <div className="min-h-screen bg-[#F7F9F7]">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-4 px-4 pt-5 sm:px-6 sm:pt-6">
          <div className="min-w-0 pb-4">
            <p className="font-display text-[13px] font-semibold tracking-[0.04em] text-green-deeper">
              Batterij<span className="text-orange">concept</span>
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">
              {partnerNaam || "Installatieportaal"}
            </h1>
          </div>
          <nav
            className="flex w-full gap-1 sm:w-auto sm:gap-0"
            aria-label="Hoofdnavigatie"
          >
            {NAV.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={[
                    "relative flex-1 px-4 pb-3.5 pt-1 text-sm font-semibold transition sm:flex-none sm:px-5",
                    active
                      ? "text-green-deeper"
                      : "text-muted hover:text-ink",
                  ].join(" ")}
                >
                  {item.label}
                  <span
                    className={[
                      "absolute inset-x-3 bottom-0 h-[2px] transition",
                      active ? "bg-green-deeper" : "bg-transparent",
                    ].join(" ")}
                    aria-hidden
                  />
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {error ? (
          <p className="mb-5 border border-[#C45A12]/25 bg-[#FFF7F0] px-4 py-3 text-sm text-[#9A3412]">
            {error}
          </p>
        ) : null}

        {tab === "team" ? (
          <PartnerTeamgenotenPanel portalToken={token} />
        ) : tab === "agenda" ? (
          loading ? (
            <p className="py-20 text-center text-sm text-muted">
              Agenda laden…
            </p>
          ) : (
            <Planbord
              projecten={orders}
              variant="portal"
              portalToken={token}
              title="Agenda"
              afblokPartnerId={partnerId}
              projectHref={(id) => `/installatie/${token}/orders/${id}`}
            />
          )
        ) : facturenLoading ? (
          <p className="py-20 text-center text-sm text-muted">
            Facturen laden…
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">
                  Facturen
                </h2>
                <p className="mt-0.5 text-sm text-muted">
                  Selfbilling met 21% btw · dien zelf regels in of keur
                  weekfacturen goed
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate((v) => !v)}
                className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-deeper"
              >
                {showCreate ? "Sluiten" : "Nieuwe factuur"}
              </button>
            </div>

            {showCreate ? (
              <section className="space-y-4 border border-line bg-white p-5">
                <p className="text-sm text-muted">
                  Voeg vrije regels toe (meterkast, materiaal, meerwerk, …).
                  Bedragen excl. btw — er komt 21% btw overheen.
                </p>
                {!heeftKvk ? (
                  <p className="border border-[#C45A12]/30 bg-[#FFF7F0] px-3 py-2 text-xs text-[#9A3412]">
                    Vul eerst bedrijfsnaam, KvK en IBAN in via Team / Batterijconcept
                    voordat je kunt factureren.
                  </p>
                ) : null}
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Project (optioneel)
                  <select
                    value={projectNummer}
                    onChange={(e) => setProjectNummer(e.target.value)}
                    className="mt-1 w-full max-w-md border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                  >
                    <option value="">Geen projectkoppeling</option>
                    {projectOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="space-y-2">
                  {regels.map((r, idx) => (
                    <div
                      key={idx}
                      className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]"
                    >
                      <input
                        type="text"
                        placeholder="Omschrijving (bijv. Meterkast)"
                        value={r.omschrijving}
                        onChange={(e) =>
                          setRegels((prev) =>
                            prev.map((x, i) =>
                              i === idx
                                ? { ...x, omschrijving: e.target.value }
                                : x
                            )
                          )
                        }
                        className="border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="€ excl."
                        value={r.bedrag}
                        onChange={(e) =>
                          setRegels((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, bedrag: e.target.value } : x
                            )
                          )
                        }
                        className="border border-line bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-green"
                      />
                      <button
                        type="button"
                        disabled={regels.length <= 1}
                        onClick={() =>
                          setRegels((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="border border-line px-3 py-2 text-xs font-semibold text-muted hover:bg-wash disabled:opacity-40"
                      >
                        Weg
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setRegels((prev) => [...prev, emptyRegel()])}
                    className="text-xs font-semibold text-green-dark hover:underline"
                  >
                    + Regel toevoegen
                  </button>
                </div>
                <div className="border border-line bg-wash px-4 py-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">Excl. btw</span>
                    <span className="font-semibold tabular-nums">
                      {formatEuro(draftTotals.ex)}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between gap-3">
                    <span className="text-muted">BTW 21%</span>
                    <span className="tabular-nums">
                      {formatEuro(draftTotals.btw)}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between gap-3 border-t border-line pt-1">
                    <span className="font-medium text-ink">Incl. btw</span>
                    <span className="font-semibold tabular-nums text-green-deeper">
                      {formatEuro(draftTotals.inc)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={creating || !heeftKvk}
                    onClick={() => void createFactuur(false)}
                    className="border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50"
                  >
                    {creating ? "Bezig…" : "Opslaan als concept"}
                  </button>
                  <button
                    type="button"
                    disabled={creating || !heeftKvk}
                    onClick={() => void createFactuur(true)}
                    className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-50"
                  >
                    {creating ? "Bezig…" : "Versturen naar Batterijconcept"}
                  </button>
                </div>
              </section>
            ) : null}

            {facturen.length === 0 ? (
              <div className="border border-line bg-white px-6 py-16 text-center">
                <p className="font-display text-lg font-semibold text-ink">
                  Nog geen facturen
                </p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
                  Maak een selfbilling-factuur met vrije regels, of wacht op
                  weekfacturen van Batterijconcept.
                </p>
              </div>
            ) : (
              <section className="border border-line bg-white">
                <ul className="divide-y divide-line">
                  {facturen.map((f) => {
                    const st = factuurStatusLabel(f);
                    const omschrijving =
                      [
                        f.omschrijving ||
                          (f.week_nummer != null
                            ? `Week ${f.week_nummer}`
                            : null),
                        f.project_nummer ? f.project_nummer : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—";
                    return (
                      <li
                        key={f.id}
                        className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <p className="font-semibold tabular-nums text-ink">
                              {f.factuur_nummer}
                            </p>
                            <span
                              className={[
                                "text-xs font-semibold",
                                st.tone === "ok"
                                  ? "text-green-dark"
                                  : st.tone === "wait"
                                    ? "text-[#C45A12]"
                                    : "text-muted",
                              ].join(" ")}
                            >
                              {st.label}
                              {f.goedgekeurd_op
                                ? ` · ${formatDateShort(f.goedgekeurd_op)}`
                                : ""}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-sm text-muted">
                            {formatDateShort(f.factuurdatum)} · {omschrijving}
                            {f.btw_bedrag != null
                              ? ` · btw ${formatEuro(f.btw_bedrag)}`
                              : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                          <p className="text-base font-semibold tabular-nums text-ink">
                            {formatEuro(f.bedrag_inc_btw)}
                          </p>
                          <button
                            type="button"
                            disabled={pdfBusy === f.id}
                            onClick={() =>
                              void downloadPdf(f.id, f.factuur_nummer)
                            }
                            className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-60"
                          >
                            {pdfBusy === f.id ? "…" : "PDF"}
                          </button>
                          {f.status === "concept" ? (
                            <button
                              type="button"
                              disabled={approveBusy === f.id}
                              onClick={() => void verstuurConcept(f.id)}
                              className="bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-deeper disabled:opacity-60"
                            >
                              {approveBusy === f.id ? "…" : "Versturen"}
                            </button>
                          ) : null}
                          {f.status === "verzonden" ? (
                            <button
                              type="button"
                              disabled={approveBusy === f.id}
                              onClick={() => void goedkeuren(f.id)}
                              className="bg-green-deeper px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-60"
                            >
                              {approveBusy === f.id ? "…" : "Goedkeuren"}
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
