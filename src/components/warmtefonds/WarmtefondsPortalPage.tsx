"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { adresRegel, formatDateTimeNl } from "@/lib/format";
import { wfPortalStatusLabel } from "@/lib/warmtefonds-portal";

type LeadLite = {
  naam?: string | null;
  telefoon?: string | null;
  email?: string | null;
  postcode?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  straat?: string | null;
  plaats?: string | null;
};

type OrderRow = {
  id: string;
  project_nummer: string;
  titel?: string | null;
  status: string;
  financiering_status?: string | null;
  warmtefonds_afspraak_at?: string | null;
  warmtefonds_notities?: string | null;
  leads?: LeadLite | LeadLite[] | null;
};

type TabId = "agenda" | "aanvragen";

function leadOf(o: OrderRow): LeadLite | null {
  if (!o.leads) return null;
  return Array.isArray(o.leads) ? o.leads[0] || null : o.leads;
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const label = wfPortalStatusLabel(status);
  const tone =
    status === "afgewezen"
      ? "text-[#C45A12]"
      : status === "uitbetaald" || status === "aanvraag_goedgekeurd"
        ? "text-green-dark"
        : status === "afspraak_ingepland" || status === "aanvraag_gedaan"
          ? "text-[#C45A12]"
          : "text-muted";
  return (
    <span
      className={`text-[11px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {label}
    </span>
  );
}

export function WarmtefondsPortalPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("aanvragen");
  const [operatorNaam, setOperatorNaam] = useState("");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warmtefonds/${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Niet gevonden");
      setOperatorNaam(data.operator?.naam || "");
      setOrders(data.orders || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  const agendaItems = useMemo(() => {
    return [...orders]
      .filter((o) => o.warmtefonds_afspraak_at)
      .sort(
        (a, b) =>
          new Date(a.warmtefonds_afspraak_at!).getTime() -
          new Date(b.warmtefonds_afspraak_at!).getTime()
      );
  }, [orders]);

  const openQueue = useMemo(() => {
    return [...orders].sort((a, b) => {
      const rank = (s: string | null | undefined) => {
        if (s === "doorgestuurd_naar_edwin") return 0;
        if (s === "afspraak_ingepland") return 1;
        if (s === "aanvraag_gedaan") return 2;
        if (!s) return 3;
        if (s === "aanvraag_goedgekeurd") return 4;
        if (s === "uitbetaald") return 5;
        if (s === "afgewezen") return 6;
        return 7;
      };
      return rank(a.financiering_status) - rank(b.financiering_status);
    });
  }, [orders]);

  const openCount = openQueue.filter(
    (o) =>
      !o.financiering_status ||
      o.financiering_status === "doorgestuurd_naar_edwin" ||
      o.financiering_status === "afspraak_ingepland" ||
      o.financiering_status === "aanvraag_gedaan"
  ).length;

  return (
    <div className="crm-bg flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-green-deeper bg-green-dark pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="min-w-0">
            <p className="font-display text-sm font-bold text-white">
              Batterij<span className="text-orange">concept</span>
              <span className="ml-2 text-xs font-medium text-white/60">
                Warmtefonds
              </span>
            </p>
            {operatorNaam ? (
              <p className="truncate text-[11px] text-white/55">
                {operatorNaam}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="shrink-0 border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-50"
          >
            {loading ? "…" : "Vernieuwen"}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-line bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex border border-line p-0.5">
              {(
                [
                  { id: "aanvragen" as const, label: "Aanvragen" },
                  { id: "agenda" as const, label: "Agenda" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={[
                    "px-3 py-1.5 text-xs font-semibold",
                    tab === t.id
                      ? "bg-green text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">
              {tab === "aanvragen"
                ? `${orders.length} aanvraag${orders.length === 1 ? "" : "en"} · ${openCount} open`
                : `${agendaItems.length} afspraak${agendaItems.length === 1 ? "" : "en"}`}
            </p>
          </div>
        </div>

        {error ? (
          <p className="mb-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="border border-line bg-white px-5 py-14 text-center text-sm text-muted">
            Laden…
          </p>
        ) : tab === "agenda" ? (
          <section className="border border-line bg-white">
            <div className="border-b border-line px-4 py-3 sm:px-5">
              <h2 className="font-display text-base font-semibold text-ink">
                Warmtefonds-afspraken
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                Afspraken die je hebt ingepland bij klanten
              </p>
            </div>
            {agendaItems.length === 0 ? (
              <div className="px-5 py-14 text-center">
                <p className="font-display text-base font-semibold text-ink">
                  Nog geen afspraken
                </p>
                <p className="mt-1 text-sm text-muted">
                  Open een aanvraag om een datum in te plannen.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="crm-table w-full">
                  <thead>
                    <tr>
                      <th>Wanneer</th>
                      <th>Klant</th>
                      <th>Project</th>
                      <th>Adres</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agendaItems.map((o) => {
                      const lead = leadOf(o);
                      const href = `/warmtefonds/${token}/orders/${o.id}`;
                      return (
                        <tr
                          key={o.id}
                          onClick={() => router.push(href)}
                        >
                          <td className="font-semibold text-ink">
                            {formatDateTimeNl(o.warmtefonds_afspraak_at)}
                          </td>
                          <td className="font-medium text-ink">
                            {lead?.naam || o.titel || "—"}
                          </td>
                          <td className="text-muted">{o.project_nummer}</td>
                          <td className="text-muted">
                            {lead ? adresRegel(lead) || "—" : "—"}
                          </td>
                          <td>
                            <StatusBadge status={o.financiering_status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <section className="border border-line bg-white">
            <div className="border-b border-line px-4 py-3 sm:px-5">
              <h2 className="font-display text-base font-semibold text-ink">
                Warmtefonds-aanvragen
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                Alle lopende Warmtefonds-orders
              </p>
            </div>
            {openQueue.length === 0 ? (
              <div className="px-5 py-14 text-center">
                <p className="font-display text-base font-semibold text-ink">
                  Geen aanvragen
                </p>
                <p className="mt-1 text-sm text-muted">
                  Er staan nog geen Warmtefonds-orders klaar.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="crm-table w-full">
                  <thead>
                    <tr>
                      <th>Klant</th>
                      <th>Project</th>
                      <th>Telefoon</th>
                      <th>Afspraak</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openQueue.map((o) => {
                      const lead = leadOf(o);
                      const href = `/warmtefonds/${token}/orders/${o.id}`;
                      return (
                        <tr
                          key={o.id}
                          onClick={() => router.push(href)}
                        >
                          <td className="font-medium text-ink">
                            {lead?.naam || o.titel || "Klant"}
                          </td>
                          <td className="text-muted">{o.project_nummer}</td>
                          <td className="text-muted">
                            {lead?.telefoon ? (
                              <a
                                href={`tel:${lead.telefoon.replace(/\s/g, "")}`}
                                className="hover:text-green-dark"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {lead.telefoon}
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="text-muted">
                            {o.warmtefonds_afspraak_at
                              ? formatDateTimeNl(o.warmtefonds_afspraak_at)
                              : "—"}
                          </td>
                          <td>
                            <StatusBadge status={o.financiering_status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
