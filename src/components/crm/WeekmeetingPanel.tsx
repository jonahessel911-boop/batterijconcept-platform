"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WeekmeetingPayload, WeekmeetingRow } from "@/lib/weekmeeting";
import { weekKeyFromDate } from "@/lib/weekmeeting";

type Step = "overzicht" | "aandachtspunten";
type WeekTab = "huidig" | "vorige";

function initials(naam: string): string {
  return naam
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

function AdviseurAvatar({
  naam,
  fotoUrl,
}: {
  naam: string;
  fotoUrl?: string | null;
}) {
  if (fotoUrl) {
    return (
      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-wash ring-1 ring-line">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={fotoUrl}
          alt={naam}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0a4727] text-[10px] font-bold text-white">
      {initials(naam)}
    </span>
  );
}

export function WeekmeetingPanel() {
  const currentKey = useMemo(() => weekKeyFromDate(), []);
  const [weekKey, setWeekKey] = useState(currentKey);
  const [weekTab, setWeekTab] = useState<WeekTab>("huidig");
  const [step, setStep] = useState<Step>("overzicht");
  const [data, setData] = useState<WeekmeetingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draftTarget, setDraftTarget] = useState<Record<string, string>>({});
  const [draftAandacht, setDraftAandacht] = useState<Record<string, string>>(
    {}
  );

  const load = useCallback(async (wk: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/weekmeeting?week=${encodeURIComponent(wk)}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Laden mislukt"
        );
      }
      const payload = json as WeekmeetingPayload;
      setData(payload);
      const targets: Record<string, string> = {};
      const aandacht: Record<string, string> = {};
      for (const r of payload.rows || []) {
        targets[r.adviseur_id] =
          r.target != null ? String(r.target) : "";
        aandacht[r.adviseur_id] = r.aandachtspunten || "";
      }
      setDraftTarget(targets);
      setDraftAandacht(aandacht);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(weekKey);
  }, [weekKey, load]);

  function selectWeekTab(tab: WeekTab) {
    setWeekTab(tab);
    setStep("overzicht");
    if (!data) return;
    setWeekKey(tab === "huidig" ? currentKey : data.prevWeekKey);
  }

  // Keep weekTab in sync when navigating via Volgende/Terug
  useEffect(() => {
    if (weekKey === currentKey) setWeekTab("huidig");
    else if (data && weekKey === data.prevWeekKey) setWeekTab("vorige");
  }, [weekKey, currentKey, data]);

  async function saveTarget(adviseurId: string) {
    const raw = (draftTarget[adviseurId] ?? "").trim().replace(",", ".");
    const target = raw === "" ? null : Number(raw);
    if (raw !== "" && (!Number.isFinite(target) || (target as number) < 0)) {
      setError("Target moet een getal zijn (0–200)");
      return;
    }
    setSavingId(adviseurId);
    setError(null);
    try {
      const res = await fetch("/api/weekmeeting", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          week: weekKey,
          adviseur_id: adviseurId,
          target,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Opslaan mislukt"
        );
      }
      const payload = json as WeekmeetingPayload;
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSavingId(null);
    }
  }

  async function saveAandacht(adviseurId: string) {
    const text = (draftAandacht[adviseurId] ?? "").trim();
    setSavingId(adviseurId);
    setError(null);
    try {
      const res = await fetch("/api/weekmeeting", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          week: weekKey,
          adviseur_id: adviseurId,
          aandachtspunten: text,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Opslaan mislukt"
        );
      }
      const payload = json as WeekmeetingPayload;
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSavingId(null);
    }
  }

  const rows = data?.rows || [];
  const isPrev = weekTab === "vorige" || (data && weekKey === data.prevWeekKey);

  return (
    <div className="space-y-5 px-4 py-4 sm:px-5 sm:py-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-green/20 bg-[#0a4727] px-5 py-5 text-white sm:px-7 sm:py-6">
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-green/30 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
              Weekmeeting
            </p>
            <h2 className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              WEEK {data?.weekNumber ?? "—"}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-white/70">
              {data?.weekLabel || "Sales targets & aandachtspunten"}
            </p>
          </div>
          <div className="flex flex-wrap gap-1 rounded-xl bg-white/10 p-1 ring-1 ring-white/20">
            {(
              [
                ["huidig", "Huidige week"],
                ["vorige", "Vorige week"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => selectWeekTab(id)}
                className={[
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  weekTab === id
                    ? "bg-white text-[#0a4727]"
                    : "text-white/80 hover:bg-white/10",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {/* Step tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-xl border border-line bg-white p-0.5">
          <button
            type="button"
            onClick={() => setStep("overzicht")}
            className={[
              "rounded-lg px-3 py-1.5 text-xs font-semibold",
              step === "overzicht"
                ? "bg-green text-white"
                : "text-muted hover:bg-wash",
            ].join(" ")}
          >
            1 · Targets
          </button>
          <button
            type="button"
            onClick={() => setStep("aandachtspunten")}
            className={[
              "rounded-lg px-3 py-1.5 text-xs font-semibold",
              step === "aandachtspunten"
                ? "bg-green text-white"
                : "text-muted hover:bg-wash",
            ].join(" ")}
          >
            2 · Aandachtspunten
          </button>
        </div>
        {step === "overzicht" ? (
          <button
            type="button"
            onClick={() => setStep("aandachtspunten")}
            className="rounded-xl bg-green px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90"
          >
            Volgende → Aandachtspunten
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep("overzicht")}
              className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-wash"
            >
              ← Targets
            </button>
            {data?.nextWeekKey ? (
              <button
                type="button"
                onClick={() => {
                  setWeekKey(data.nextWeekKey);
                  setWeekTab("huidig");
                  setStep("overzicht");
                }}
                className="rounded-xl bg-[#0a4727] px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90"
              >
                Volgende week →
              </button>
            ) : null}
          </div>
        )}
      </div>

      {loading && !data ? (
        <p className="py-10 text-center text-sm text-muted">Laden…</p>
      ) : step === "overzicht" ? (
        <TargetsTable
          rows={rows}
          isPrev={Boolean(isPrev)}
          draftTarget={draftTarget}
          setDraftTarget={setDraftTarget}
          savingId={savingId}
          onSave={saveTarget}
        />
      ) : (
        <AandachtspuntenView
          rows={rows}
          draftAandacht={draftAandacht}
          setDraftAandacht={setDraftAandacht}
          savingId={savingId}
          onSave={saveAandacht}
        />
      )}
    </div>
  );
}

function TargetsTable({
  rows,
  isPrev,
  draftTarget,
  setDraftTarget,
  savingId,
  onSave,
}: {
  rows: WeekmeetingRow[];
  isPrev: boolean;
  draftTarget: Record<string, string>;
  setDraftTarget: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  savingId: string | null;
  onSave: (id: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5 sm:px-5">
        <div>
          <h3 className="font-display text-base font-semibold text-ink">
            WEEKMEETING
          </h3>
          <p className="text-[11px] text-muted">
            {isPrev
              ? "Vorige week · groen = target gehaald, rood = niet"
              : "Vul sales target week in · afspraken staan vast"}
          </p>
        </div>
        <span className="rounded-full bg-wash px-2.5 py-1 text-[10px] font-semibold tabular-nums text-muted">
          {rows.length}
        </span>
      </div>

      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[640px] border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-wash/95 backdrop-blur">
            <tr className="border-b border-line text-left text-[9px] font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5 font-semibold sm:px-5">Adviseur</th>
              <th className="px-2 py-2.5 font-semibold text-center">
                Afspraken week
              </th>
              <th className="px-2 py-2.5 font-semibold text-center">
                Sales target week
              </th>
              {isPrev ? (
                <th className="px-4 py-2.5 font-semibold text-center sm:px-5">
                  Resultaat
                </th>
              ) : (
                <th className="px-4 py-2.5 font-semibold sm:px-5">
                  Meenemen vorige week
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted">
                  Geen actieve adviseurs.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.adviseur_id}
                  className="border-b border-line/70 last:border-0 hover:bg-wash/40"
                >
                  <td className="px-4 py-2.5 sm:px-5">
                    <div className="flex items-center gap-2.5">
                      <AdviseurAvatar
                        naam={r.naam}
                        fotoUrl={r.profielfoto_url}
                      />
                      <span className="font-semibold text-ink">{r.naam}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="inline-flex min-w-[2.5rem] items-center justify-center rounded-lg bg-wash px-2.5 py-1.5 text-sm font-semibold tabular-nums text-ink ring-1 ring-line">
                      {r.afspraken_week}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <input
                      type="number"
                      min={0}
                      max={200}
                      step={1}
                      inputMode="numeric"
                      value={draftTarget[r.adviseur_id] ?? ""}
                      onChange={(e) =>
                        setDraftTarget((d) => ({
                          ...d,
                          [r.adviseur_id]: e.target.value,
                        }))
                      }
                      onBlur={() => {
                        const cur =
                          r.target != null ? String(r.target) : "";
                        const next = (
                          draftTarget[r.adviseur_id] ?? ""
                        ).trim();
                        if (next === cur) return;
                        void onSave(r.adviseur_id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      disabled={savingId === r.adviseur_id}
                      placeholder="—"
                      className="w-16 rounded-lg border border-line bg-white px-2 py-1.5 text-center text-sm font-semibold tabular-nums text-green-dark outline-none focus:border-green disabled:opacity-50"
                    />
                  </td>
                  {isPrev ? (
                    <td className="px-4 py-2.5 text-center sm:px-5">
                      {r.gehaald == null ? (
                        <span className="text-[11px] text-muted">
                          Geen target
                        </span>
                      ) : r.gehaald ? (
                        <span className="inline-flex items-center rounded-full bg-green-soft px-2.5 py-1 text-[11px] font-bold text-green-dark">
                          Gehaald
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-[#FFEBEE] px-2.5 py-1 text-[11px] font-bold text-[#C62828]">
                          Niet gehaald
                        </span>
                      )}
                    </td>
                  ) : (
                    <td className="px-4 py-2.5 sm:px-5">
                      {r.aandachtspunten_vorige ? (
                        <span className="inline-block max-w-[220px] truncate rounded-lg bg-[#FFF8D6] px-2 py-1 text-[11px] text-[#7A5C00]">
                          {r.aandachtspunten_vorige}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AandachtspuntenView({
  rows,
  draftAandacht,
  setDraftAandacht,
  savingId,
  onSave,
}: {
  rows: WeekmeetingRow[];
  draftAandacht: Record<string, string>;
  setDraftAandacht: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  savingId: string | null;
  onSave: (id: string) => void;
}) {
  const withAgenda = rows.filter((r) => r.afspraken_week > 0);

  if (withAgenda.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">
        Geen adviseurs met afspraken deze week.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Sticker-aandachtspunten voor adviseurs die deze week lopen. Komt terug
        in de volgende weekmeeting.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {withAgenda.map((r) => (
          <article
            key={r.adviseur_id}
            className="relative overflow-hidden rounded-2xl border border-line bg-[#FFFDF5] shadow-[0_1px_0_rgba(26,31,28,0.04)]"
          >
            <div
              className="absolute -right-2 -top-2 rotate-12 select-none text-2xl opacity-30"
              aria-hidden
            >
              📌
            </div>
            <div className="border-b border-[#f0e6c8] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <AdviseurAvatar naam={r.naam} fotoUrl={r.profielfoto_url} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{r.naam}</p>
                  <p className="text-[10px] text-muted">
                    {r.afspraken_week} afspraak
                    {r.afspraken_week === 1 ? "" : "en"} deze week
                    {r.target != null ? ` · target ${r.target}` : ""}
                  </p>
                </div>
              </div>
              {r.aandachtspunten_vorige ? (
                <p className="mt-2 rounded-lg bg-[#FFF0E6] px-2 py-1.5 text-[11px] text-[#C45A12]">
                  <span className="font-semibold">Vorige week: </span>
                  {r.aandachtspunten_vorige}
                </p>
              ) : null}
            </div>
            <div className="px-4 py-3">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Aandachtspunten deze week
                <textarea
                  value={draftAandacht[r.adviseur_id] ?? ""}
                  onChange={(e) =>
                    setDraftAandacht((d) => ({
                      ...d,
                      [r.adviseur_id]: e.target.value,
                    }))
                  }
                  onBlur={() => {
                    const cur = r.aandachtspunten || "";
                    const next = (draftAandacht[r.adviseur_id] ?? "").trim();
                    if (next === cur) return;
                    void onSave(r.adviseur_id);
                  }}
                  disabled={savingId === r.adviseur_id}
                  rows={3}
                  placeholder="Bijv. conversie laag · meer vervolg · route Noord…"
                  className="mt-1 w-full resize-y rounded-xl border border-[#f0e6c8] bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green disabled:opacity-50"
                />
              </label>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
