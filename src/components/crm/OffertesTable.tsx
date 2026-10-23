"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Offerte, OfferteStatus, Project } from "@/types/database";
import { offerteStatusLabel } from "@/lib/labels";
import { StatusBadge } from "./StatusBadge";
import { formatDateShort, formatEuro } from "@/lib/format";
import { rememberCrmReturnUrl } from "./DetailChrome";

const OFFERTE_STATUSES: OfferteStatus[] = [
  "concept",
  "verzonden",
  "ondertekend",
  "verlopen",
  "afgewezen",
];

export type HoldSalesOfferteInfo = {
  projectId: string;
  notitie: string | null;
  projectNummer?: string | null;
  klantNaam?: string | null;
  adviseurId?: string | null;
  adviseurNaam?: string | null;
};

/** Adviseur handelt HOLD af; admin/sales_manager ziet overzicht van alle HOLDs. */
export type HoldActieModus = "adviseur" | "overzicht";

type StatusFilter = OfferteStatus | "hold_sales" | "";

export function OffertesTable({
  offertes,
  holdSalesByOfferteId,
  holdActieModus = "adviseur",
  sessionNaam,
  onOpenSign,
  onHoldReleased,
}: {
  offertes: Offerte[];
  /** Offerte-id → project op HOLD SALES ACTIE (zichtbaar hier i.p.v. Projecten). */
  holdSalesByOfferteId?: Map<string, HoldSalesOfferteInfo>;
  /** Alleen adviseur mag “terugsturen”; admin ziet overzicht. */
  holdActieModus?: HoldActieModus;
  /** Naam van ingelogde adviseur (voor notitie-stempel). */
  sessionNaam?: string | null;
  onOpenSign?: (o: Offerte) => void;
  /** Na terugsturen naar backoffice — projectenlijst verversen. */
  onHoldReleased?: (project: Project) => void;
}) {
  const isAdviseurActie = holdActieModus === "adviseur";
  const router = useRouter();
  const [actieOfferte, setActieOfferte] = useState<Offerte | null>(null);
  const [holdModal, setHoldModal] = useState<{
    offerte: Offerte;
    hold: HoldSalesOfferteInfo;
  } | null>(null);
  const [holdReply, setHoldReply] = useState("");
  const [holdBusy, setHoldBusy] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [search, setSearch] = useState("");

  const holdMap = holdSalesByOfferteId;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = offertes.filter((o) => {
      const hold = holdMap?.get(o.id);
      if (statusFilter === "hold_sales") {
        if (!hold) return false;
      } else if (statusFilter) {
        if (o.status !== statusFilter) return false;
      }
      if (!q) return true;
      const hay = [
        o.offerte_nummer,
        o.leads?.naam,
        o.leads?.lead_number,
        o.leads?.email,
        o.leads?.telefoon,
        o.leads?.plaats,
        o.installatie_partners?.naam,
        o.titel,
        hold?.notitie,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    // HOLD bovenaan
    return list.sort((a, b) => {
      const aHold = holdMap?.has(a.id) ? 1 : 0;
      const bHold = holdMap?.has(b.id) ? 1 : 0;
      if (aHold !== bHold) return bHold - aHold;
      return 0;
    });
  }, [offertes, statusFilter, search, holdMap]);

  const holdCount = holdMap?.size ?? 0;
  const holdList = useMemo(() => {
    if (!holdMap?.size) return [];
    return offertes
      .map((o) => {
        const hold = holdMap.get(o.id);
        return hold ? { offerte: o, hold } : null;
      })
      .filter(Boolean) as { offerte: Offerte; hold: HoldSalesOfferteInfo }[];
  }, [offertes, holdMap]);

  function openHold(
    offerte: Offerte,
    hold: HoldSalesOfferteInfo,
    e?: React.MouseEvent
  ) {
    e?.stopPropagation();
    setHoldError(null);
    setHoldReply("");
    setHoldModal({ offerte, hold });
  }

  async function releaseHold() {
    if (!holdModal) return;
    const reply = holdReply.trim();
    if (!reply) {
      setHoldError("Vul een notitie in — verplicht bij terugsturen.");
      return;
    }
    setHoldBusy(true);
    setHoldError(null);
    try {
      const res = await fetch(
        `/api/projecten/${holdModal.hold.projectId}/hold-sales/release`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reply,
            author_naam: sessionNaam?.trim() || null,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Terugsturen mislukt"
        );
      }
      const project = (data as { project?: Project }).project;
      if (project) onHoldReleased?.(project);
      setHoldModal(null);
      setHoldReply("");
    } catch (err) {
      setHoldError(err instanceof Error ? err.message : "Fout");
    } finally {
      setHoldBusy(false);
    }
  }

  if (offertes.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-sm text-muted">Nog geen offertes.</p>
      </div>
    );
  }

  return (
    <div>
      {holdCount > 0 ? (
        <div className="border-b border-[#5A4A6E]/25 bg-[#F0ECF5] px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#4A3A5C]">
                HOLD SALES ACTIE · {holdCount}{" "}
                {holdCount === 1 ? "offerte" : "offertes"}
              </p>
              <p className="mt-0.5 text-sm text-[#4A3A5C]/90">
                {isAdviseurActie
                  ? "Backoffice wacht op jou. Handel de actie af en stuur daarna terug naar de backoffice."
                  : "Overzicht: deze offertes wachten op de adviseur (sales). Alleen de adviseur stuurt ze terug."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStatusFilter("hold_sales")}
              className="shrink-0 border border-[#5A4A6E]/40 bg-white px-3 py-1.5 text-xs font-semibold text-[#4A3A5C] hover:bg-[#F0ECF5]"
            >
              Toon alleen HOLD
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {holdList.slice(0, isAdviseurActie ? 5 : 12).map(({ offerte, hold }) => (
              <li
                key={offerte.id}
                className="flex flex-wrap items-center justify-between gap-2 border border-[#5A4A6E]/20 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {offerte.offerte_nummer}
                    <span className="font-normal text-muted">
                      {" "}
                      · {offerte.leads?.naam || hold.klantNaam || "Klant"}
                    </span>
                    {!isAdviseurActie && hold.adviseurNaam ? (
                      <span className="font-medium text-[#4A3A5C]">
                        {" "}
                        · {hold.adviseurNaam}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-[#4A3A5C] line-clamp-2">
                    {hold.notitie || "Geen toelichting van backoffice"}
                  </p>
                </div>
                {isAdviseurActie ? (
                  <button
                    type="button"
                    onClick={(e) => openHold(offerte, hold, e)}
                    className="shrink-0 bg-[#5A4A6E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4A3A5C]"
                  >
                    Actie / terugsturen
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => openHold(offerte, hold, e)}
                    className="shrink-0 border border-[#5A4A6E]/40 bg-white px-3 py-1.5 text-xs font-semibold text-[#4A3A5C] hover:bg-[#F0ECF5]"
                  >
                    Bekijk
                  </button>
                )}
              </li>
            ))}
            {holdList.length > (isAdviseurActie ? 5 : 12) ? (
              <p className="text-xs text-[#4A3A5C]">
                +{holdList.length - (isAdviseurActie ? 5 : 12)} meer — filter op
                HOLD SALES ACTIE
              </p>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="relative w-full sm:max-w-md">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted/50">
            ⌕
          </span>
          <input
            type="search"
            inputMode="search"
            placeholder="Zoek offertenummer, klant, lead, plaats…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-line bg-white py-2.5 pl-8 pr-3 text-sm outline-none transition placeholder:text-muted/60 focus:border-green"
          />
        </div>
        <p className="text-xs text-muted">
          {filtered.length} van {offertes.length} offerte
          {offertes.length === 1 ? "" : "s"}
          {holdCount > 0 ? (
            <span className="ml-2 font-semibold text-[#4A3A5C]">
              · {holdCount} HOLD sales
            </span>
          ) : null}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="crm-table crm-table--compact">
          <thead>
            <tr>
              <th>Offerte</th>
              <th>Klant</th>
              <th>Lead</th>
              <th>Installateur</th>
              <th>
                <div className="flex items-center gap-2">
                  <span>Status</span>
                  <select
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(e.target.value as StatusFilter)
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="max-w-[9.5rem] cursor-pointer border border-line bg-white px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-ink outline-none focus:border-green"
                    aria-label="Filter op status"
                    title="Filter op status"
                  >
                    <option value="">Alles</option>
                    <option value="hold_sales">HOLD SALES ACTIE</option>
                    {OFFERTE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {offerteStatusLabel[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </th>
              <th>Totaal</th>
              <th>Geldig tot</th>
              <th>Actie</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="!cursor-default">
                  <div className="px-5 py-14 text-center">
                    <p className="font-display text-base font-semibold text-ink">
                      Geen offertes gevonden
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {search.trim()
                        ? `Geen resultaat voor “${search.trim()}”.`
                        : statusFilter === "hold_sales"
                          ? "Geen offertes op HOLD SALES ACTIE."
                          : statusFilter
                            ? `Geen offertes met status “${offerteStatusLabel[statusFilter as OfferteStatus]}”.`
                            : "Pas je zoekopdracht of filter aan."}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((o) => {
                const hold = holdMap?.get(o.id);
                return (
                  <tr
                    key={o.id}
                    className={[
                      "cursor-pointer",
                      hold ? "bg-[#F0ECF5]/70" : "",
                    ].join(" ")}
                    onClick={() => {
                      rememberCrmReturnUrl();
                      if (hold && isAdviseurActie) {
                        openHold(o, hold);
                      } else {
                        router.push(`/offertes/${o.id}`);
                      }
                    }}
                  >
                    <td className="font-mono text-[11px] font-semibold text-green-dark whitespace-nowrap">
                      {o.offerte_nummer}
                    </td>
                    <td className="font-medium whitespace-nowrap">
                      {o.leads?.naam || "—"}
                    </td>
                    <td className="whitespace-nowrap">
                      <Link
                        href={`/leads/${o.lead_id}`}
                        className="font-mono text-[11px] text-muted hover:text-green-dark hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {o.leads?.lead_number || o.lead_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="text-muted whitespace-nowrap">
                      {o.installatie_partners?.naam || "—"}
                    </td>
                    <td>
                      {hold ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide border border-[#5A4A6E]/30 bg-[#F0ECF5] text-[#4A3A5C]"
                          title={hold.notitie || "HOLD SALES ACTIE"}
                        >
                          HOLD SALES ACTIE
                        </span>
                      ) : (
                        <StatusBadge kind="offerte" value={o.status} />
                      )}
                    </td>
                    <td className="whitespace-nowrap font-medium tabular-nums">
                      {formatEuro(o.totaal_inc_btw)}
                    </td>
                    <td className="text-muted whitespace-nowrap">
                      {formatDateShort(o.geldig_tot)}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {hold ? (
                        <div className="max-w-[16rem] space-y-1">
                          {!isAdviseurActie && hold.adviseurNaam ? (
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#4A3A5C]">
                              {hold.adviseurNaam}
                            </p>
                          ) : null}
                          {hold.notitie ? (
                            <p
                              className="text-[11px] leading-snug text-[#4A3A5C] line-clamp-2"
                              title={hold.notitie}
                            >
                              {hold.notitie}
                            </p>
                          ) : (
                            <span className="text-[11px] text-muted">
                              Geen notitie
                            </span>
                          )}
                          {isAdviseurActie ? (
                            <button
                              type="button"
                              onClick={(e) => openHold(o, hold, e)}
                              className="border border-[#5A4A6E]/40 bg-[#F0ECF5] px-2 py-0.5 text-[11px] font-semibold text-[#4A3A5C] hover:bg-[#e8e2f0]"
                            >
                              Actie / terugsturen
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => openHold(o, hold, e)}
                              className="text-[11px] font-semibold text-[#4A3A5C] hover:underline"
                            >
                              Details
                            </button>
                          )}
                        </div>
                      ) : o.status === "ondertekend" ? (
                        o.actie_required ? (
                          <button
                            type="button"
                            onClick={() => setActieOfferte(o)}
                            className="border border-[#C45A12]/35 bg-[#FFF0E6] px-2 py-0.5 text-[11px] font-semibold text-[#C45A12] hover:bg-[#ffe6d4]"
                          >
                            ACTIE
                          </button>
                        ) : (
                          <span className="text-[11px] font-medium text-green-dark">
                            ✓ {o.ondertekend_naam || "Getekend"}
                          </span>
                        )
                      ) : o.sign_token ? (
                        <button
                          type="button"
                          onClick={() => onOpenSign?.(o)}
                          className="border border-orange bg-orange px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-[#e0651c]"
                        >
                          Open link
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {holdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg border border-line bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#4A3A5C]">
                  HOLD SALES ACTIE
                </p>
                <h3 className="mt-1 font-display text-lg font-semibold text-ink">
                  {holdModal.offerte.offerte_nummer}
                  <span className="font-sans text-base font-normal text-muted">
                    {" "}
                    · {holdModal.offerte.leads?.naam || "Klant"}
                  </span>
                </h3>
                {holdModal.hold.projectNummer ? (
                  <p className="mt-1 text-xs text-muted">
                    Project {holdModal.hold.projectNummer} (blijft bij
                    backoffice)
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setHoldModal(null)}
                className="h-10 w-10 text-xl text-muted hover:bg-wash"
                aria-label="Sluiten"
              >
                ×
              </button>
            </div>

            <div className="mt-4 border border-[#5A4A6E]/20 bg-[#F0ECF5] px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#4A3A5C]">
                Wat backoffice vraagt
              </p>
              {!isAdviseurActie && holdModal.hold.adviseurNaam ? (
                <p className="mt-1 text-xs font-medium text-[#4A3A5C]">
                  Adviseur: {holdModal.hold.adviseurNaam}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-ink whitespace-pre-wrap">
                {holdModal.hold.notitie || "Geen toelichting meegegeven."}
              </p>
            </div>

            {isAdviseurActie ? (
              <>
                <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted">
                  Notitie (verplicht)
                  <textarea
                    value={holdReply}
                    onChange={(e) => setHoldReply(e.target.value)}
                    rows={3}
                    required
                    placeholder="Bijv. klant gebeld, afspraak verzet, documenten binnen…"
                    className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                  />
                </label>
                <p className="mt-1 text-[11px] text-muted">
                  Deze notitie komt op de project-tijdlijn (zichtbaar voor
                  backoffice).
                </p>

                {holdError ? (
                  <p className="mt-3 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                    {holdError}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={holdBusy || !holdReply.trim()}
                    onClick={() => void releaseHold()}
                    className="flex-1 bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
                  >
                    {holdBusy ? "Bezig…" : "Terugsturen naar backoffice"}
                  </button>
                  <Link
                    href={`/offertes/${holdModal.offerte.id}`}
                    onClick={() => setHoldModal(null)}
                    className="flex-1 border border-line px-4 py-2.5 text-center text-sm font-semibold text-ink hover:bg-wash"
                  >
                    Open offerte
                  </Link>
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  Na terugsturen verdwijnt de HOLD hier en staat de order weer
                  bij Backoffice.
                </p>
              </>
            ) : (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Link
                  href={`/offertes/${holdModal.offerte.id}`}
                  onClick={() => setHoldModal(null)}
                  className="flex-1 bg-[#5A4A6E] px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-[#4A3A5C]"
                >
                  Open offerte
                </Link>
                <button
                  type="button"
                  onClick={() => setHoldModal(null)}
                  className="flex-1 border border-line px-4 py-2.5 text-sm font-semibold text-muted hover:bg-wash"
                >
                  Sluiten
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {actieOfferte && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md border border-line bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#C45A12]">
                  Actie vereist
                </p>
                <h3 className="mt-1 text-lg font-semibold text-ink">
                  Ondertekende offerte heeft backoffice-actie nodig
                </h3>
                <p className="mt-2 text-sm text-muted">
                  {actieOfferte.offerte_nummer} ·{" "}
                  {actieOfferte.leads?.naam || "Klant"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActieOfferte(null)}
                className="h-10 w-10 text-xl text-muted hover:bg-wash"
                aria-label="Popup sluiten"
              >
                ×
              </button>
            </div>
            <div className="mt-4 flex gap-2">
              <Link
                href={`/offertes/${actieOfferte.id}?backoffice=1`}
                onClick={() => setActieOfferte(null)}
                className="flex-1 bg-orange px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-[#e0651c]"
              >
                Naar back office
              </Link>
              <button
                type="button"
                onClick={() => setActieOfferte(null)}
                className="flex-1 border border-line px-4 py-2.5 text-sm font-semibold text-muted hover:bg-wash"
              >
                Sluiten
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
