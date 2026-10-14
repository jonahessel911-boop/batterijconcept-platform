"use client";

import { useMemo, useState } from "react";
import { formatEuro } from "@/lib/format";
import {
  buildBankQuarterKasstroom,
  defaultBankQuarterKey,
  listBankQuarters,
  type BankTransaction,
} from "@/lib/bank-kasstroom";

function TxList({
  lines,
  tone,
}: {
  lines: BankTransaction[];
  tone: "in" | "out";
}) {
  if (lines.length === 0) {
    return (
      <p className="px-4 py-4 text-sm text-muted">Geen regels.</p>
    );
  }
  return (
    <ul className="divide-y divide-line/60">
      {lines.map((t, i) => (
        <li
          key={`${t.date}-${t.amount}-${i}`}
          className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">
              {t.name || "—"}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {t.date}
              {t.description ? ` · ${t.description.slice(0, 120)}` : ""}
            </p>
          </div>
          <p
            className={[
              "shrink-0 text-sm font-semibold tabular-nums",
              tone === "in" ? "text-green-deeper" : "text-[#C62828]",
            ].join(" ")}
          >
            {tone === "in"
              ? formatEuro(t.amount)
              : `− ${formatEuro(Math.abs(t.amount))}`}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function BankKasstroomPanel() {
  const quarters = useMemo(() => listBankQuarters(), []);
  const [quarterKey, setQuarterKey] = useState(defaultBankQuarterKey);
  const [openIn, setOpenIn] = useState(false);
  const [openOut, setOpenOut] = useState(false);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const data = useMemo(
    () => buildBankQuarterKasstroom(quarterKey),
    [quarterKey]
  );

  if (!data) {
    return (
      <p className="rounded-xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">
        Geen bankdata voor dit kwartaal.
      </p>
    );
  }

  const hasData =
    data.inkomstenLines.length > 0 || data.uitgavenLines.length > 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-base font-semibold text-ink">
            Kasstroom bank
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {data.periodStart && data.periodEnd
              ? `${data.periodStart} t/m ${data.periodEnd}`
              : "Geen mutaties"}
            {data.account ? ` · ${data.account}` : ""}
            {" · uitgaven excl. BTW-afdracht"}
          </p>
        </div>
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
          Kwartaal
          <select
            value={quarterKey}
            onChange={(e) => {
              setQuarterKey(e.target.value);
              setOpenIn(false);
              setOpenOut(false);
              setOpenMonth(null);
            }}
            className="border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink outline-none focus:border-green"
          >
            {quarters.map((q) => (
              <option key={q.key} value={q.key}>
                {q.label}
                {q.hasData ? "" : " (leeg)"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!hasData ? (
        <div className="rounded-xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">
          Nog geen bankexport geladen voor {data.label}.
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-line bg-white">
            <button
              type="button"
              onClick={() => setOpenIn((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-wash/40"
            >
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Inkomsten {openIn ? "▾" : "▸"}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {data.inkomstenLines.length} mutaties
                </p>
              </div>
              <p className="font-display text-lg font-semibold tabular-nums text-green-deeper">
                {formatEuro(data.inkomsten)}
              </p>
            </button>
            {openIn ? (
              <div className="border-t border-line">
                <TxList lines={data.inkomstenLines} tone="in" />
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setOpenOut((v) => !v)}
              className="flex w-full items-center justify-between gap-3 border-t border-line px-4 py-3 text-left hover:bg-wash/40"
            >
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Uitgaven (excl. BTW) {openOut ? "▾" : "▸"}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {data.uitgavenLines.length} mutaties
                  {data.btwUitgaven > 0
                    ? ` · BTW-afdracht ${formatEuro(data.btwUitgaven)} buiten deze som`
                    : ""}
                </p>
              </div>
              <p className="font-display text-lg font-semibold tabular-nums text-[#C62828]">
                − {formatEuro(data.uitgavenExBtw)}
              </p>
            </button>
            {openOut ? (
              <div className="border-t border-line">
                <TxList lines={data.uitgavenLines} tone="out" />
              </div>
            ) : null}

            <div className="border-t-2 border-ink/20" />

            <div className="flex items-center justify-between gap-3 bg-wash/50 px-4 py-3.5">
              <p className="font-display text-base font-semibold text-ink">
                Netto kastroom {data.label}
              </p>
              <p
                className={[
                  "font-display text-xl font-semibold tabular-nums",
                  data.netto >= 0 ? "text-green-deeper" : "text-[#C62828]",
                ].join(" ")}
              >
                {data.netto < 0
                  ? `− ${formatEuro(Math.abs(data.netto))}`
                  : formatEuro(data.netto)}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-line bg-white">
            <div className="border-b border-line px-4 py-3">
              <p className="font-display text-base font-semibold text-ink">
                Per maand
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Inkomsten − uitgaven excl. BTW
              </p>
            </div>
            <div className="divide-y divide-line/60">
              {data.months.map((m) => {
                const open = openMonth === m.monthKey;
                return (
                  <div key={m.monthKey}>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenMonth(open ? null : m.monthKey)
                      }
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-wash/40"
                    >
                      <span className="w-4 text-sm text-muted">
                        {open ? "▾" : "▸"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold capitalize text-ink">
                          {m.label}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {m.inkomstenCount} in · {m.uitgavenCount} uit
                        </p>
                      </div>
                      <p
                        className={[
                          "shrink-0 text-sm font-semibold tabular-nums",
                          m.netto >= 0
                            ? "text-green-deeper"
                            : "text-[#C62828]",
                        ].join(" ")}
                      >
                        {m.netto < 0
                          ? `− ${formatEuro(Math.abs(m.netto))}`
                          : formatEuro(m.netto)}
                      </p>
                    </button>
                    {open ? (
                      <div className="space-y-1 border-t border-line bg-wash/30 px-4 py-3 pl-11 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="text-muted">Inkomsten</span>
                          <span className="tabular-nums text-green-deeper">
                            {formatEuro(m.inkomsten)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted">
                            Uitgaven excl. BTW
                          </span>
                          <span className="tabular-nums text-[#C62828]">
                            − {formatEuro(m.uitgavenExBtw)}
                          </span>
                        </div>
                        {m.btwUitgaven > 0 ? (
                          <div className="flex justify-between gap-3 text-xs">
                            <span className="text-muted">
                              BTW-afdracht (niet in netto)
                            </span>
                            <span className="tabular-nums text-muted">
                              − {formatEuro(m.btwUitgaven)}
                            </span>
                          </div>
                        ) : null}
                        <div className="mt-1 flex justify-between gap-3 border-t border-line/60 pt-2 font-semibold">
                          <span>Netto</span>
                          <span
                            className={[
                              "tabular-nums",
                              m.netto >= 0
                                ? "text-green-deeper"
                                : "text-[#C62828]",
                            ].join(" ")}
                          >
                            {m.netto < 0
                              ? `− ${formatEuro(Math.abs(m.netto))}`
                              : formatEuro(m.netto)}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
