"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { adresRegel, formatDateTimeNl } from "@/lib/format";
import {
  wfPortalStatusLabel,
} from "@/lib/warmtefonds-portal";

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
      ? "bg-red-50 text-red-800 border-red-200"
      : status === "uitbetaald" || status === "aanvraag_goedgekeurd"
        ? "bg-[#E8F5EE] text-[#0D5C32] border-[#B7D9C4]"
        : status === "afspraak_ingepland" || status === "aanvraag_gedaan"
          ? "bg-[#FFF4E8] text-[#C45A12] border-[#FDBA74]"
          : "bg-[#F4F8F5] text-[#5A6B60] border-[#D8E4DC]";
  return (
    <span
      className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {label}
    </span>
  );
}

export function WarmtefondsPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [tab, setTab] = useState<TabId>("agenda");
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

  return (
    <div className="min-h-screen bg-wash">
      <header className="border-b border-line bg-green-dark px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-5xl">
          <p className="font-display text-lg font-bold text-white">
            Batterij<span className="text-orange">concept</span>
          </p>
          <h1 className="mt-2 font-display text-xl font-semibold text-white sm:text-2xl">
            Warmtefonds-portaal
          </h1>
          {operatorNaam ? (
            <p className="mt-1 text-sm text-white/70">{operatorNaam}</p>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-5 flex border border-line bg-white p-0.5">
          {(
            [
              { id: "agenda", label: "Agenda" },
              { id: "aanvragen", label: "Aanvragen" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 px-3 py-2.5 text-sm font-semibold transition ${
                tab === t.id
                  ? "bg-green-dark text-white"
                  : "bg-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error ? (
          <p className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="py-12 text-center text-sm text-muted">Laden…</p>
        ) : tab === "agenda" ? (
          <section>
            <h2 className="font-display text-lg font-semibold text-ink">
              Warmtefonds-afspraken
            </h2>
            <p className="mt-1 text-sm text-muted">
              Afspraken die je hebt ingepland bij klanten.
            </p>
            {agendaItems.length === 0 ? (
              <p className="mt-6 rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
                Nog geen afspraken gezet. Open een aanvraag om een datum in te
                plannen.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
                {agendaItems.map((o) => {
                  const lead = leadOf(o);
                  const at = o.warmtefonds_afspraak_at!;
                  const d = new Date(at);
                  const day = new Intl.DateTimeFormat("nl-NL", {
                    day: "numeric",
                    timeZone: "Europe/Amsterdam",
                  }).format(d);
                  const month = new Intl.DateTimeFormat("nl-NL", {
                    month: "short",
                    timeZone: "Europe/Amsterdam",
                  }).format(d);
                  const weekday = new Intl.DateTimeFormat("nl-NL", {
                    weekday: "short",
                    timeZone: "Europe/Amsterdam",
                  }).format(d);
                  const time = new Intl.DateTimeFormat("nl-NL", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Europe/Amsterdam",
                  }).format(d);
                  return (
                    <li key={o.id}>
                      <Link
                        href={`/warmtefonds/${token}/orders/${o.id}`}
                        className="flex gap-0 hover:bg-[#FAFCFA]"
                      >
                        <div className="flex w-[4.5rem] shrink-0 flex-col items-center justify-center border-r border-line bg-[#FAFCFA] px-2 py-4 text-center">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                            {month}
                          </span>
                          <span className="font-display text-2xl font-semibold leading-none text-green-dark">
                            {day}
                          </span>
                          <span className="mt-1 text-[10px] capitalize text-muted">
                            {weekday}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1 px-4 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-ink">
                              {lead?.naam || o.titel || o.project_nummer}
                            </p>
                            <StatusBadge status={o.financiering_status} />
                          </div>
                          <p className="mt-1 text-sm font-medium text-green-dark">
                            {time}
                          </p>
                          <p className="mt-0.5 text-xs text-muted">
                            {o.project_nummer}
                            {lead
                              ? ` · ${adresRegel(lead) || "geen adres"}`
                              : ""}
                          </p>
                          <p className="mt-1 text-xs text-muted">
                            {formatDateTimeNl(at)}
                          </p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : (
          <section>
            <h2 className="font-display text-lg font-semibold text-ink">
              Alle Warmtefonds-aanvragen
            </h2>
            <p className="mt-1 text-sm text-muted">
              {orders.length} openstaande / lopende orders
            </p>
            {openQueue.length === 0 ? (
              <p className="mt-6 rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
                Geen Warmtefonds-aanvragen gevonden.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
                {openQueue.map((o) => {
                  const lead = leadOf(o);
                  return (
                    <li key={o.id}>
                      <Link
                        href={`/warmtefonds/${token}/orders/${o.id}`}
                        className="block px-4 py-3.5 hover:bg-[#FAFCFA]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-ink">
                            {lead?.naam || o.titel || "Klant"}
                          </p>
                          <StatusBadge status={o.financiering_status} />
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {o.project_nummer}
                          {lead?.telefoon ? ` · ${lead.telefoon}` : ""}
                          {o.warmtefonds_afspraak_at
                            ? ` · afspraak ${formatDateTimeNl(o.warmtefonds_afspraak_at)}`
                            : " · nog geen afspraak"}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
