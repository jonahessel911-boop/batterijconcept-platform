"use client";

import { useCallback, useEffect, useState } from "react";
import type { MaandLeaderboardRow } from "@/lib/maand-leaderboard";
import { useCrmSession } from "@/hooks/useCrmSession";

const BG_DEFAULT = "/sales/leaderboard-bg.png";
const BG_WINNY = "/sales/leaderboard-bg-winny.jpg";

function isWinnySession(opts: {
  email?: string | null;
  naam?: string | null;
}): boolean {
  const email = (opts.email || "").trim().toLowerCase();
  if (email === "winny@bogerschalets.nl") return true;
  const naam = (opts.naam || "").trim().toLowerCase();
  return naam.startsWith("winny");
}

type ApiResponse = {
  ok?: boolean;
  error?: string;
  monthKey?: string;
  label?: string;
  startYmd?: string;
  endYmd?: string;
  me_id?: string;
  rows?: MaandLeaderboardRow[];
};

function formatConv(pct: number | null): string {
  if (pct == null) return "—";
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
}

function Medal({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#F5C518] text-sm font-black text-black shadow-[0_0_20px_rgba(245,197,24,0.55)]"
        aria-label="1e plaats"
      >
        1
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#E8E8E8] text-sm font-black text-[#333]"
        aria-label="2e plaats"
      >
        2
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#CD7F32] text-sm font-black text-white"
        aria-label="3e plaats"
      >
        3
      </span>
    );
  }
  return (
    <span className="inline-flex h-9 w-9 items-center justify-center text-sm font-bold tabular-nums text-white/55">
      {rank}
    </span>
  );
}

function PodiumCard({
  row,
  place,
  isMe,
}: {
  row: MaandLeaderboardRow;
  place: 1 | 2 | 3;
  isMe: boolean;
}) {
  const height =
    place === 1 ? "min-h-[11.5rem]" : place === 2 ? "min-h-[9.5rem]" : "min-h-[8.5rem]";
  const order = place === 1 ? "order-2" : place === 2 ? "order-1" : "order-3";
  const accent =
    place === 1
      ? "border-[#F5C518]/70 shadow-[0_0_40px_rgba(245,197,24,0.35)]"
      : place === 2
        ? "border-white/35"
        : "border-[#CD7F32]/50";

  return (
    <div
      className={[
        order,
        "flex flex-1 flex-col items-center",
        place === 1 ? "sm:-mt-4" : "sm:mt-6",
      ].join(" ")}
    >
      <div
        className={[
          "lb-pop relative flex w-full max-w-[14rem] flex-col items-center justify-end border bg-black/55 px-3 py-5 backdrop-blur-md",
          height,
          accent,
          isMe ? "ring-2 ring-[#F5C518]" : "",
        ].join(" ")}
      >
        <Medal rank={place} />
        <p className="mt-3 text-center font-display text-lg font-black leading-tight text-white sm:text-xl">
          {row.naam}
        </p>
        {isMe ? (
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#F5C518]">
            Jij
          </p>
        ) : null}
        <p className="mt-3 font-display text-3xl font-black tabular-nums text-[#F5C518] sm:text-4xl">
          {row.sales}
        </p>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/55">
          sales
        </p>
        <div className="mt-3 grid w-full grid-cols-3 gap-1 border-t border-white/15 pt-3 text-center">
          <div>
            <p className="text-sm font-bold tabular-nums text-white">
              {row.aanbetalingen}
            </p>
            <p className="text-[9px] uppercase tracking-wide text-white/45">
              Aanbet.
            </p>
          </div>
          <div>
            <p className="text-sm font-bold tabular-nums text-white">
              {row.gelopen}
            </p>
            <p className="text-[9px] uppercase tracking-wide text-white/45">
              Gelopen
            </p>
          </div>
          <div>
            <p className="text-sm font-bold tabular-nums text-white">
              {formatConv(row.conversie_pct)}
            </p>
            <p className="text-[9px] uppercase tracking-wide text-white/45">
              Conv.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MaandLeaderboardPanel() {
  const { session } = useCrmSession();
  const [rows, setRows] = useState<MaandLeaderboardRow[]>([]);
  const [label, setLabel] = useState("");
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/maand-leaderboard", {
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok) {
        throw new Error(data.error || "Laden mislukt");
      }
      setRows(data.rows || []);
      setLabel(data.label || "");
      setMeId(data.me_id || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);
  const myRow = meId ? rows.find((r) => r.adviseur_id === meId) : null;
  const bgSrc = isWinnySession({
    email: session?.email,
    naam: session?.naam || myRow?.naam,
  })
    ? BG_WINNY
    : BG_DEFAULT;

  return (
    <div className="relative min-h-[calc(100dvh-7.5rem)] w-full overflow-auto bg-black text-white sm:min-h-[calc(100dvh-8.5rem)]">
      <style>{`
        @keyframes lb-pop-in {
          0% { opacity: 0; transform: translateY(24px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes lb-glow {
          0%, 100% {
            text-shadow: 0 0 18px rgba(245,197,24,0.45), 0 4px 0 rgba(0,0,0,0.4);
          }
          50% {
            text-shadow: 0 0 36px rgba(245,197,24,0.85), 0 4px 0 rgba(0,0,0,0.4);
          }
        }
        .lb-pop { animation: lb-pop-in 0.55s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .lb-glow { animation: lb-glow 2.2s ease-in-out infinite; }
      `}</style>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={bgSrc}
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-90"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-black/45 to-black/85" />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col px-4 py-6 sm:px-6 sm:py-8">
        <header className="lb-pop text-center">
          <p className="text-xs font-black uppercase tracking-[0.4em] text-[#F5C518]">
            Maandleaderboard
          </p>
          <h1 className="lb-glow mt-2 font-display text-[clamp(2rem,8vw,3.75rem)] font-black leading-none tracking-tight text-white">
            {label || "Deze maand"}
          </h1>
          <p className="mt-3 text-sm text-white/65">
            Ranking op sales · aanbetalingen · conversie · gelopen
          </p>
        </header>

        {error ? (
          <p className="mt-8 text-center text-sm text-[#FCA5A5]">{error}</p>
        ) : null}

        {loading ? (
          <p className="mt-16 text-center text-sm text-white/55">Laden…</p>
        ) : rows.length === 0 ? (
          <p className="mt-16 text-center text-sm text-white/55">
            Nog geen resultaten deze maand.
          </p>
        ) : (
          <>
            {myRow ? (
              <div className="lb-pop mx-auto mt-6 inline-flex items-center gap-3 border border-[#F5C518]/40 bg-black/50 px-4 py-2 backdrop-blur">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#F5C518]">
                  Jouw plek
                </span>
                <span className="font-display text-xl font-black text-white">
                  #{myRow.rank}
                </span>
                <span className="text-white/40">·</span>
                <span className="tabular-nums text-sm text-white/80">
                  {myRow.sales} sales · {formatConv(myRow.conversie_pct)} conv.
                </span>
              </div>
            ) : null}

            <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:items-end sm:justify-center sm:gap-4">
              {top3[1] ? (
                <PodiumCard
                  row={top3[1]}
                  place={2}
                  isMe={top3[1].adviseur_id === meId}
                />
              ) : (
                <div className="order-1 hidden flex-1 sm:block" />
              )}
              {top3[0] ? (
                <PodiumCard
                  row={top3[0]}
                  place={1}
                  isMe={top3[0].adviseur_id === meId}
                />
              ) : null}
              {top3[2] ? (
                <PodiumCard
                  row={top3[2]}
                  place={3}
                  isMe={top3[2].adviseur_id === meId}
                />
              ) : (
                <div className="order-3 hidden flex-1 sm:block" />
              )}
            </div>

            {rest.length > 0 ? (
              <div className="lb-pop mt-8 overflow-hidden border border-white/15 bg-black/50 backdrop-blur-md sm:mt-10">
                <div className="hidden grid-cols-[3rem_1fr_5rem_6rem_5rem_5rem] gap-2 border-b border-white/10 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-white/45 sm:grid">
                  <span>#</span>
                  <span>Adviseur</span>
                  <span className="text-right">Sales</span>
                  <span className="text-right">Aanbetalingen</span>
                  <span className="text-right">Gelopen</span>
                  <span className="text-right">Conversie</span>
                </div>
                <ul>
                  {rest.map((row, i) => {
                    const isMe = row.adviseur_id === meId;
                    return (
                      <li
                        key={row.adviseur_id}
                        className={[
                          "grid grid-cols-[2.5rem_1fr_auto] items-center gap-2 border-b border-white/8 px-3 py-3 last:border-b-0 sm:grid-cols-[3rem_1fr_5rem_6rem_5rem_5rem] sm:gap-2 sm:px-4",
                          isMe ? "bg-[#F5C518]/12" : i % 2 === 0 ? "bg-white/[0.02]" : "",
                        ].join(" ")}
                        style={{ animationDelay: `${0.04 * i}s` }}
                      >
                        <span className="text-sm font-bold tabular-nums text-white/50">
                          {row.rank}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-display text-base font-bold text-white">
                            {row.naam}
                            {isMe ? (
                              <span className="ml-2 text-[10px] font-black uppercase tracking-wider text-[#F5C518]">
                                Jij
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-[11px] text-white/45 sm:hidden">
                            {row.aanbetalingen} aanbet. · {row.gelopen} gelopen ·{" "}
                            {formatConv(row.conversie_pct)}
                          </p>
                        </div>
                        <p className="text-right font-display text-lg font-black tabular-nums text-[#F5C518] sm:text-base">
                          {row.sales}
                        </p>
                        <p className="hidden text-right text-sm font-semibold tabular-nums text-white/85 sm:block">
                          {row.aanbetalingen}
                        </p>
                        <p className="hidden text-right text-sm font-semibold tabular-nums text-white/85 sm:block">
                          {row.gelopen}
                        </p>
                        <p className="hidden text-right text-sm font-semibold tabular-nums text-white/85 sm:block">
                          {formatConv(row.conversie_pct)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
