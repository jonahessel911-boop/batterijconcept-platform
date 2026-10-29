"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { PartnerCreditFactuur, Project } from "@/types/database";
import { formatDateShort, formatEuro } from "@/lib/format";
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
  | "bedrag_inc_btw"
  | "factuurdatum"
  | "betaald_op"
  | "goedgekeurd_op"
>;

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
  if (f.status === "goedgekeurd") return { label: "Goedgekeurd", tone: "ok" };
  if (f.status === "verzonden") return { label: "Te goedkeuren", tone: "wait" };
  if (f.status === "concept") return { label: "Concept", tone: "muted" };
  return { label: f.status, tone: "muted" };
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
        ) : facturen.length === 0 ? (
          <div className="border border-line bg-white px-6 py-16 text-center">
            <p className="font-display text-lg font-semibold text-ink">
              Nog geen facturen
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
              Selfbilling-facturen die Batterijconcept voor je aanmaakt
              verschijnen hier ter goedkeuring.
            </p>
          </div>
        ) : (
          <section className="border border-line bg-white">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">
                  Facturen
                </h2>
                <p className="mt-0.5 text-sm text-muted">
                  Selfbilling · {facturen.length} factuur
                  {facturen.length === 1 ? "" : "en"}
                </p>
              </div>
            </div>
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
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                      <p className="text-base font-semibold tabular-nums text-ink">
                        {formatEuro(f.bedrag_inc_btw)}
                      </p>
                      <button
                        type="button"
                        disabled={pdfBusy === f.id}
                        onClick={() => void downloadPdf(f.id, f.factuur_nummer)}
                        className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-60"
                      >
                        {pdfBusy === f.id ? "…" : "PDF"}
                      </button>
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
      </main>
    </div>
  );
}
