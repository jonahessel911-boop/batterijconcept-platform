"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { addDays, format, isSameDay, startOfWeek } from "date-fns";
import { nl } from "date-fns/locale";
import { formatDateTimeNl } from "@/lib/format";
import {
  FINANCIERING_PIPELINE,
  normalizeFinancieringStatus,
} from "@/lib/financiering-status";
import {
  wfPortalOpenRank,
  wfPortalStatusLabelKort,
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
  leads?: LeadLite | LeadLite[] | null;
};

type TabId = "aanvragen" | "agenda";

function leadOf(o: OrderRow): LeadLite | null {
  if (!o.leads) return null;
  return Array.isArray(o.leads) ? o.leads[0] || null : o.leads;
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const n = normalizeFinancieringStatus(status);
  const label = wfPortalStatusLabelKort(status);
  const tone =
    status === "afgewezen"
      ? "text-[#C45A12]"
      : n === "uitbetaald"
        ? "text-green-dark"
        : n && FINANCIERING_PIPELINE.indexOf(n) >= 3
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
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );

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

  const openQueue = useMemo(() => {
    return [...orders].sort(
      (a, b) =>
        wfPortalOpenRank(a.financiering_status) -
        wfPortalOpenRank(b.financiering_status)
    );
  }, [orders]);

  const openCount = openQueue.filter((o) => {
    const n = normalizeFinancieringStatus(o.financiering_status);
    if (!n || n === "afgewezen" || n === "uitbetaald") return false;
    return true;
  }).length;

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const agendaByDay = useMemo(() => {
    const map = new Map<string, OrderRow[]>();
    for (const d of weekDays) {
      map.set(format(d, "yyyy-MM-dd"), []);
    }
    for (const o of orders) {
      if (!o.warmtefonds_afspraak_at) continue;
      const at = new Date(o.warmtefonds_afspraak_at);
      if (Number.isNaN(at.getTime())) continue;
      const key = format(at, "yyyy-MM-dd");
      const list = map.get(key);
      if (list) list.push(o);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.warmtefonds_afspraak_at!).getTime() -
          new Date(b.warmtefonds_afspraak_at!).getTime()
      );
    }
    return map;
  }, [orders, weekDays]);

  const weekLabel = `${format(weekStart, "d MMM", { locale: nl })} – ${format(
    addDays(weekStart, 6),
    "d MMM yyyy",
    { locale: nl }
  )}`;

  return (
    <div className="crm-bg flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-green-deeper bg-green-dark pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/brands/warmtefonds-logo.png"
              alt="Nationaal Warmtefonds"
              width={120}
              height={36}
              className="h-8 w-auto object-contain brightness-0 invert"
              priority
            />
            <div className="min-w-0 border-l border-white/20 pl-3">
              <p className="font-display text-sm font-bold text-white">
                Batterij<span className="text-orange">concept</span>
              </p>
              {operatorNaam ? (
                <p className="truncate text-[11px] text-white/55">
                  {operatorNaam}
                </p>
              ) : (
                <p className="text-[11px] text-white/55">Warmtefonds-portaal</p>
              )}
            </div>
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
                      ? "bg-[#C45A12] text-white"
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
                : "Interne Warmtefonds-afspraken (geen klantmail)"}
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
              <div>
                <h2 className="font-display text-base font-semibold text-ink">
                  Weekagenda
                </h2>
                <p className="mt-0.5 text-xs text-muted">{weekLabel}</p>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setWeekStart((w) => addDays(w, -7))}
                  className="border border-line px-3 py-1.5 text-xs font-semibold hover:bg-wash"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))
                  }
                  className="border border-line px-3 py-1.5 text-xs font-semibold hover:bg-wash"
                >
                  Vandaag
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStart((w) => addDays(w, 7))}
                  className="border border-line px-3 py-1.5 text-xs font-semibold hover:bg-wash"
                >
                  →
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-7 sm:divide-x sm:divide-y-0">
              {weekDays.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const items = agendaByDay.get(key) || [];
                const isToday = isSameDay(day, new Date());
                return (
                  <div
                    key={key}
                    className={[
                      "min-h-[140px] p-2.5",
                      isToday ? "bg-[#FFF7ED]" : "bg-white",
                    ].join(" ")}
                  >
                    <p
                      className={[
                        "text-[11px] font-semibold uppercase tracking-wide",
                        isToday ? "text-[#C45A12]" : "text-muted",
                      ].join(" ")}
                    >
                      {format(day, "EEE d", { locale: nl })}
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {items.length === 0 ? (
                        <li className="text-[11px] text-muted/70">—</li>
                      ) : (
                        items.map((o) => {
                          const lead = leadOf(o);
                          const time = format(
                            new Date(o.warmtefonds_afspraak_at!),
                            "HH:mm"
                          );
                          return (
                            <li key={o.id}>
                              <button
                                type="button"
                                onClick={() =>
                                  router.push(
                                    `/warmtefonds/${token}/orders/${o.id}`
                                  )
                                }
                                className="w-full border border-[#FDBA74]/50 bg-white px-2 py-1.5 text-left hover:border-[#C45A12]"
                              >
                                <p className="text-[11px] font-bold text-[#C45A12]">
                                  {time}
                                </p>
                                <p className="truncate text-[12px] font-semibold text-ink">
                                  {lead?.naam || o.project_nummer}
                                </p>
                              </button>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="border border-line bg-white">
            <div className="border-b border-line px-4 py-3 sm:px-5">
              <h2 className="font-display text-base font-semibold text-ink">
                Warmtefonds-aanvragen
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                Klik een klant om de volledige flow en stap te zien
              </p>
            </div>
            {openQueue.length === 0 ? (
              <div className="px-5 py-14 text-center">
                <p className="font-display text-base font-semibold text-ink">
                  Geen aanvragen
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
                      <th>Stap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openQueue.map((o) => {
                      const lead = leadOf(o);
                      const href = `/warmtefonds/${token}/orders/${o.id}`;
                      const n = normalizeFinancieringStatus(
                        o.financiering_status
                      );
                      const stapNr =
                        n && n !== "afgewezen"
                          ? FINANCIERING_PIPELINE.indexOf(n) + 1
                          : null;
                      return (
                        <tr
                          key={o.id}
                          onClick={() => router.push(href)}
                          className="cursor-pointer"
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
                            <div className="flex flex-col gap-0.5">
                              {stapNr ? (
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                                  Stap {stapNr}/7
                                </span>
                              ) : null}
                              <StatusBadge status={o.financiering_status} />
                            </div>
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
