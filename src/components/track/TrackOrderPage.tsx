"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import type { KlantAgendaItem, KlantTrackPayload } from "@/lib/klant-track";
import { formatEuro } from "@/lib/format";

type TabId = "overzicht" | "agenda" | "documenten";

const TABS: { id: TabId; label: string }[] = [
  { id: "overzicht", label: "Overzicht" },
  { id: "agenda", label: "Agenda" },
  { id: "documenten", label: "Documenten" },
];

export function TrackOrderPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<KlantTrackPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("overzicht");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/track/${token}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Niet gevonden");
      setData(json as KlantTrackPayload);
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

  if (loading) {
    return (
      <Shell>
        <p className="text-center text-sm text-[#5A6B60]">Order laden…</p>
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-semibold text-[#122018]">
          Link niet geldig
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#5A6B60]">
          {error || "Deze track & trace-pagina bestaat niet of is verlopen."}
        </p>
        <p className="mt-6 text-sm text-[#5A6B60]">
          Vragen? Mail{" "}
          <a
            className="text-[#0D5C32] underline"
            href="mailto:info@batterijconcept.nl"
          >
            info@batterijconcept.nl
          </a>{" "}
          of bel 085 800 1645.
        </p>
      </Shell>
    );
  }

  const progressDone = data.stappen.filter((s) => s.state === "done").length;
  const progressTotal = data.stappen.length;
  const progressPct = Math.round((progressDone / progressTotal) * 100);

  return (
    <Shell>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0D5C32]">
            Mijn portaal
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-[#122018] sm:text-3xl">
            Hoi {firstName(data.klant_naam)}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#5A6B60]">
            {data.huidige_samenvatting}
          </p>
        </div>
        <div className="shrink-0 rounded-lg border border-[#D8E4DC] bg-[#F4F8F5] px-4 py-3 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5A6B60]">
            Order
          </p>
          <p className="mt-0.5 font-semibold text-[#122018]">
            {data.project_nummer || data.offerte_nummer}
          </p>
          {data.adres ? (
            <p className="mt-1 max-w-[14rem] text-xs leading-snug text-[#5A6B60]">
              {data.adres}
            </p>
          ) : null}
        </div>
      </header>

      <nav
        className="mt-6 flex gap-1 border-b border-[#D8E4DC]"
        aria-label="Portaal menu"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative px-3 py-2.5 text-sm font-semibold transition ${
              tab === t.id
                ? "text-[#0D5C32]"
                : "text-[#7A8B80] hover:text-[#122018]"
            }`}
          >
            {t.label}
            {tab === t.id ? (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#0D5C32]" />
            ) : null}
          </button>
        ))}
      </nav>

      {data.geannuleerd ? (
        <div className="mt-6 rounded-lg border border-[#E8C4B8] bg-[#FFF6F2] px-4 py-3 text-sm text-[#9A3B1A]">
          Deze order is geannuleerd. Documenten blijven hier beschikbaar.
        </div>
      ) : null}

      {tab === "overzicht" ? (
        <OverzichtTab
          data={data}
          progressDone={progressDone}
          progressTotal={progressTotal}
          progressPct={progressPct}
        />
      ) : null}
      {tab === "agenda" ? <AgendaTab agenda={data.agenda || []} /> : null}
      {tab === "documenten" ? (
        <DocumentenTab data={data} token={token} />
      ) : null}

      <footer className="mt-12 border-t border-[#D8E4DC] pt-6 text-sm text-[#5A6B60]">
        <p>
          Vragen over je order? Mail{" "}
          <a
            className="font-medium text-[#0D5C32] underline"
            href="mailto:info@batterijconcept.nl"
          >
            info@batterijconcept.nl
          </a>{" "}
          of bel{" "}
          <a
            className="font-medium text-[#0D5C32] underline"
            href="tel:0858001645"
          >
            085 800 1645
          </a>
          .
        </p>
        <p className="mt-2 text-xs text-[#9AA89F]">
          Bewaar deze link — hiermee volg je je hele order bij BatterijConcept.
        </p>
      </footer>
    </Shell>
  );
}

function OverzichtTab({
  data,
  progressDone,
  progressTotal,
  progressPct,
}: {
  data: KlantTrackPayload;
  progressDone: number;
  progressTotal: number;
  progressPct: number;
}) {
  return (
    <>
      {!data.geannuleerd ? (
        <div className="mt-6">
          <div className="flex items-center justify-between text-xs text-[#5A6B60]">
            <span>Voortgang</span>
            <span>
              {progressDone}/{progressTotal} stappen
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E4EDE7]">
            <div
              className="h-full rounded-full bg-[#0D5C32] transition-[width] duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      ) : null}

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold text-[#122018]">
          Jouw traject
        </h2>
        <ol className="mt-4 space-y-0">
          {data.stappen.map((stap, i) => (
            <li key={stap.id} className="relative flex gap-4 pb-6 last:pb-0">
              {i < data.stappen.length - 1 ? (
                <span
                  className={`absolute left-[15px] top-8 bottom-0 w-px ${
                    stap.state === "done" ? "bg-[#0D5C32]/40" : "bg-[#D8E4DC]"
                  }`}
                  aria-hidden
                />
              ) : null}
              <span
                className={`relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  stap.state === "done"
                    ? "bg-[#0D5C32] text-white"
                    : stap.state === "current"
                      ? "bg-[#F18A1F] text-white ring-4 ring-[#F18A1F]/20"
                      : "bg-[#E4EDE7] text-[#7A8B80]"
                }`}
              >
                {stap.state === "done" ? "✓" : i + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p
                  className={`font-semibold ${
                    stap.state === "upcoming"
                      ? "text-[#7A8B80]"
                      : "text-[#122018]"
                  }`}
                >
                  {stap.title}
                  {stap.state === "current" ? (
                    <span className="ml-2 rounded bg-[#FFF4E8] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#C45A12]">
                      Nu
                    </span>
                  ) : null}
                </p>
                {stap.detail ? (
                  <p
                    className={`mt-1 text-sm leading-relaxed ${
                      stap.state === "upcoming"
                        ? "text-[#9AA89F]"
                        : "text-[#5A6B60]"
                    }`}
                  >
                    {stap.detail}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {data.nazorg.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold text-[#122018]">
            Na de installatie
          </h2>
          <p className="mt-1 text-sm text-[#5A6B60]">
            Dit regelen wij voor je — je hoeft zelf niets te doen.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {data.nazorg.map((n) => (
              <div
                key={n.id}
                className="rounded-xl border border-[#D8E4DC] bg-white p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-[#122018]">{n.title}</p>
                  <NazorgBadge status={n.status} />
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[#5A6B60]">
                  {n.detail}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function agendaSortKey(id: KlantAgendaItem["id"]): number {
  switch (id) {
    case "warmtefonds_afspraak":
      return 10;
    case "schouwdag":
      return 30;
    case "installatie":
      return 40;
    case "service":
      return 50;
    default:
      return 99;
  }
}

function AgendaTab({ agenda }: { agenda: KlantAgendaItem[] }) {
  // Schouwweek is geen agenda-punt (week ≠ dag) — apart boven de echte afspraken
  const schouwweek = agenda.find((a) => a.id === "schouwweek") || null;
  const echteAgenda = agenda.filter((a) => a.id !== "schouwweek");
  const gepland = [...echteAgenda]
    .filter((a) => a.sortAt)
    .sort((a, b) => {
      const ta = new Date(a.sortAt!).getTime();
      const tb = new Date(b.sortAt!).getTime();
      if (ta !== tb) return ta - tb;
      return agendaSortKey(a.id) - agendaSortKey(b.id);
    });
  const open = echteAgenda.filter((a) => !a.sortAt);

  return (
    <div className="mt-6 space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-[#122018]">
          Agenda
        </h2>
        <p className="mt-1 text-sm text-[#5A6B60]">
          Afspraken bij jou thuis — rechtstreeks uit je order.
        </p>
      </div>

      {schouwweek ? (
        <div className="rounded-xl border border-[#D8E4DC] bg-[#F4F8F5] px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5A6B60]">
              Schouwweek
            </p>
            <AgendaBadge status={schouwweek.status} />
          </div>
          {schouwweek.when || schouwweek.timeLabel ? (
            <p className="mt-2 font-display text-lg font-semibold text-[#0D5C32]">
              {schouwweek.timeLabel || schouwweek.when}
            </p>
          ) : null}
          {schouwweek.when && schouwweek.timeLabel ? (
            <p className="mt-0.5 text-sm text-[#5A6B60]">{schouwweek.when}</p>
          ) : null}
          <p className="mt-2 text-sm leading-relaxed text-[#5A6B60]">
            {schouwweek.detail}
          </p>
        </div>
      ) : null}

      {gepland.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-[#D8E4DC] bg-white">
          <div className="border-b border-[#D8E4DC] bg-[#F4F8F5] px-4 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5A6B60]">
              Geplande momenten
            </p>
          </div>
          <ul className="divide-y divide-[#E8EEEA]">
            {gepland.map((item) => (
              <li key={item.id} className="flex gap-0">
                <div className="flex w-[4.5rem] shrink-0 flex-col items-center justify-center border-r border-[#E8EEEA] bg-[#FAFCFA] px-2 py-4 text-center">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[#7A8B80]">
                    {item.month}
                  </span>
                  <span className="font-display text-2xl font-semibold leading-none text-[#0D5C32]">
                    {item.day}
                  </span>
                  <span className="mt-1 text-[10px] capitalize text-[#7A8B80]">
                    {item.weekday}
                  </span>
                </div>
                <div className="min-w-0 flex-1 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-[#122018]">{item.titel}</p>
                    <AgendaBadge status={item.status} />
                  </div>
                  {item.timeLabel ? (
                    <p className="mt-1 text-sm font-medium text-[#0D5C32]">
                      {item.timeLabel}
                    </p>
                  ) : null}
                  {item.when ? (
                    <p className="mt-0.5 text-xs text-[#5A6B60]">{item.when}</p>
                  ) : null}
                  <p className="mt-2 text-sm leading-relaxed text-[#5A6B60]">
                    {item.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {open.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-dashed border-[#D8E4DC] bg-white">
          <div className="border-b border-[#D8E4DC] bg-[#FAFCFA] px-4 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5A6B60]">
              Nog te plannen
            </p>
          </div>
          <ul className="divide-y divide-[#E8EEEA]">
            {open.map((item) => (
              <li key={item.id} className="flex gap-3 px-4 py-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#E4EDE7] bg-[#F4F8F5] text-[#7A8B80]">
                  <span className="text-lg leading-none">·</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-[#122018]">{item.titel}</p>
                    <AgendaBadge status={item.status} />
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-[#5A6B60]">
                    {item.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!schouwweek && gepland.length === 0 && open.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#D8E4DC] px-4 py-6 text-center text-sm text-[#7A8B80]">
          Nog geen agenda-items voor deze order.
        </p>
      ) : null}

      <section className="rounded-xl border border-[#D8E4DC] bg-[#F4F8F5] p-4 sm:p-5">
        <h3 className="font-display text-base font-semibold text-[#122018]">
          Wat is de schouwweek?
        </h3>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-[#5A6B60]">
          <p>
            De <strong className="font-semibold text-[#122018]">schouw</strong>{" "}
            is een afspraak bij jou thuis. Een installatiepartner bekijkt ter
            plaatse of alles klaar is voor de batterij: meterkast, plek voor de
            batterij, bekabeling en eventuele bijzonderheden.
          </p>
          <p>
            We plannen eerst een{" "}
            <strong className="font-semibold text-[#122018]">schouwweek</strong>{" "}
            — een week waarin de schouw plaatsvindt. De exacte dag en tijd in
            die week stemmen we ongeveer{" "}
            <strong className="font-semibold text-[#122018]">
              één week van tevoren
            </strong>{" "}
            met je af. Zo kun je erop rekenen dat er iemand aanwezig is.
          </p>
          <p>
            Na een geslaagde schouw en de Warmtefonds-declaratie kopen we je
            batterij in.{" "}
            <strong className="font-semibold text-[#122018]">
              Eén dag na de schouw
            </strong>{" "}
            plannen we je installatiedatum in.
          </p>
        </div>
      </section>
    </div>
  );
}

function DocumentenTab({
  data,
  token,
}: {
  data: KlantTrackPayload;
  token: string;
}) {
  return (
    <div className="mt-6">
      <h2 className="font-display text-lg font-semibold text-[#122018]">
        Documenten
      </h2>
      <p className="mt-1 text-sm text-[#5A6B60]">
        Getekende offerte en facturen op één plek.
      </p>
      <ul className="mt-4 space-y-2">
        <li>
          {data.documenten.offerte.beschikbaar ? (
            <a
              href={`/api/track/${token}/offerte`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 rounded-xl border border-[#D8E4DC] bg-white px-4 py-3 text-sm transition hover:border-[#0D5C32]/40 hover:bg-[#F4F8F5]"
            >
              <span>
                <span className="font-semibold text-[#122018]">
                  Getekende offerte
                </span>
                <span className="mt-0.5 block text-xs text-[#5A6B60]">
                  {data.documenten.offerte.nummer}
                </span>
              </span>
              <span className="shrink-0 font-semibold text-[#0D5C32]">
                Open PDF →
              </span>
            </a>
          ) : (
            <div className="rounded-xl border border-dashed border-[#D8E4DC] px-4 py-3 text-sm text-[#7A8B80]">
              Getekende offerte volgt zo.
            </div>
          )}
        </li>
        {data.documenten.facturen.length === 0 ? (
          <li className="rounded-xl border border-dashed border-[#D8E4DC] px-4 py-3 text-sm text-[#7A8B80]">
            Nog geen facturen. Zodra we een factuur sturen, verschijnt die hier.
          </li>
        ) : (
          data.documenten.facturen.map((f) => (
            <li key={f.id}>
              <a
                href={`/api/track/${token}/facturen/${f.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 rounded-xl border border-[#D8E4DC] bg-white px-4 py-3 text-sm transition hover:border-[#0D5C32]/40 hover:bg-[#F4F8F5]"
              >
                <span>
                  <span className="font-semibold text-[#122018]">
                    {f.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-[#5A6B60]">
                    {f.factuur_nummer} · {formatEuro(f.bedrag_inc_btw)} ·{" "}
                    {factuurStatusLabel(f.status, f.betaald_op)}
                  </span>
                </span>
                <span className="shrink-0 font-semibold text-[#0D5C32]">
                  Open PDF →
                </span>
              </a>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function AgendaBadge({
  status,
}: {
  status: KlantAgendaItem["status"];
}) {
  const map = {
    wacht: { label: "Nog te plannen", cls: "bg-[#E4EDE7] text-[#5A6B60]" },
    gepland: { label: "Gepland", cls: "bg-[#E7F5EC] text-[#0D5C32]" },
    voltooid: { label: "Afgerond", cls: "bg-[#0D5C32] text-white" },
  } as const;
  const m = map[status];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

function NazorgBadge({ status }: { status: "wacht" | "bezig" | "klaar" }) {
  const map = {
    wacht: { label: "Nog te doen", cls: "bg-[#E4EDE7] text-[#5A6B60]" },
    bezig: { label: "Bezig (±3 mnd)", cls: "bg-[#FFF4E8] text-[#C45A12]" },
    klaar: { label: "Geregeld", cls: "bg-[#E7F5EC] text-[#0D5C32]" },
  } as const;
  const m = map[status];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

function factuurStatusLabel(status: string, betaaldOp: string | null): string {
  if (status === "betaald" || betaaldOp) return "Betaald";
  if (status === "deels_betaald") return "Deels betaald";
  return "Verstuurd";
}

function firstName(naam: string): string {
  return naam.trim().split(/\s+/)[0] || naam;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[linear-gradient(165deg,#F7FBF8_0%,#EEF5F0_45%,#F8F3EC_100%)]">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <div className="mb-8 flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="BatterijConcept"
            width={52}
            height={52}
            className="h-12 w-12 object-contain"
            priority
          />
          <div>
            <p className="font-display text-lg font-semibold leading-none text-[#0D5C32]">
              BatterijConcept
            </p>
            <p className="mt-1 text-xs text-[#5A6B60]">Jouw orderportaal</p>
          </div>
        </div>
        <div className="rounded-2xl border border-[#D8E4DC] bg-white/90 p-5 shadow-[0_12px_40px_-24px_rgba(13,92,50,0.35)] backdrop-blur-sm sm:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
