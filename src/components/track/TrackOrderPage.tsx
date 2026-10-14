"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import type {
  KlantAgendaItem,
  KlantServiceAfspraak,
  KlantTrackPayload,
} from "@/lib/klant-track";
import {
  formatDateNl,
  formatDateTimeLongNl,
  formatEuro,
  formatTimeNl,
} from "@/lib/format";
import type {
  DatumOptieSoort,
  KlantDatumOptie,
} from "@/lib/project-datum-opties";
import { datumOptieSoortLabel } from "@/lib/project-datum-opties";
import { FRANK_ENERGIE_OVERSTAP_URL } from "@/lib/frank-energie";

type TabId = "overzicht" | "agenda" | "documenten" | "service" | "overstap";

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

  const tabs = useMemo(() => {
    const base: { id: TabId; label: string; badge?: number }[] = [
      { id: "overzicht", label: "Overzicht" },
      { id: "agenda", label: "Agenda" },
      { id: "documenten", label: "Documenten" },
    ];
    if (!data) return base;
    const opts = data.datum_opties || [];
    const openService = opts.filter(
      (o) => o.soort === "service" && o.status === "open"
    ).length;
    const openOverstap = opts.filter(
      (o) => o.soort === "overstap" && o.status === "open"
    ).length;
    const showService =
      openService > 0 ||
      opts.some((o) => o.soort === "service") ||
      (data.service_afspraken || []).length > 0 ||
      data.agenda.some((a) => a.id === "service");
    const showOverstap =
      openOverstap > 0 ||
      opts.some((o) => o.soort === "overstap") ||
      data.agenda.some((a) => a.id === "overstap");
    if (showService) {
      base.push({
        id: "service",
        label: "Service",
        badge: openService > 0 ? openService : undefined,
      });
    }
    if (showOverstap) {
      base.push({
        id: "overstap",
        label: "Overstap",
        badge: openOverstap > 0 ? openOverstap : undefined,
      });
    }
    return base;
  }, [data]);

  // Deep-link ?tab=service|overstap
  useEffect(() => {
    if (!data) return;
    try {
      const q = new URLSearchParams(window.location.search).get("tab");
      if (q === "service" || q === "overstap") {
        const allowed = tabs.some((t) => t.id === q);
        if (allowed) setTab(q);
      }
    } catch {
      /* ignore */
    }
  }, [data, tabs]);

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
        className="mt-6 flex flex-wrap gap-1 border-b border-[#D8E4DC]"
        aria-label="Portaal menu"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold transition ${
              tab === t.id
                ? "text-[#0D5C32]"
                : "text-[#7A8B80] hover:text-[#122018]"
            }`}
          >
            {t.label}
            {t.badge != null && t.badge > 0 ? (
              <span className="inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-[#C45A12] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                {t.badge}
              </span>
            ) : null}
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
      {tab === "service" || tab === "overstap" ? (
        <DatumOptieTab
          soort={tab}
          token={token}
          data={data}
          onDone={() => void load()}
        />
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
    case "overstap":
      return 60;
    default:
      return 99;
  }
}

function FrankEnergieLogo({
  size = 56,
}: {
  size?: number;
}) {
  return (
    <Image
      src="/brands/frank-energie.png"
      alt="Frank Energie"
      width={size}
      height={size}
      className="shrink-0 rounded-xl object-cover"
    />
  );
}

function OverstapHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <a
          href={FRANK_ENERGIE_OVERSTAP_URL}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-xl outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-[#0D5C32]"
          aria-label="Naar Frank Energie (BatterijConcept-uitnodiging)"
        >
          <FrankEnergieLogo />
        </a>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0D5C32]">
            Overstap · Frank Energie
          </p>
          <h2 className="mt-0.5 font-display text-lg font-semibold text-[#122018]">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-sm leading-relaxed text-[#5A6B60]">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      <a
        href={FRANK_ENERGIE_OVERSTAP_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-xl border border-[#D8E4DC] bg-[#F4F8F5] px-3.5 py-2.5 text-sm font-semibold text-[#0D5C32] transition hover:border-[#0D5C32]/40 hover:bg-[#E8F5EE]"
      >
        Naar Frank Energie →
      </a>
    </div>
  );
}

function serviceAfspraakStatus(at: string): string {
  const ms = new Date(at).getTime();
  if (Number.isNaN(ms)) return "Gepland";
  return ms < Date.now() ? "Afgelopen" : "Gepland";
}

function ServiceAfsprakenTable({
  afspraken,
}: {
  afspraken: KlantServiceAfspraak[];
}) {
  if (afspraken.length === 0) {
    return (
      <p className="mt-2 text-sm text-[#5A6B60]">
        Er staan nog geen service-afspraken gepland.
      </p>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[280px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[#D8E4DC] text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5A6B60]">
            <th className="pb-2 pr-3 font-semibold">Datum</th>
            <th className="pb-2 pr-3 font-semibold">Tijd</th>
            <th className="pb-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {afspraken.map((a) => (
            <tr
              key={a.at}
              className="border-b border-[#E8F0EB] last:border-b-0"
            >
              <td className="py-2.5 pr-3 font-medium text-[#122018]">
                {formatDateNl(a.at)}
              </td>
              <td className="py-2.5 pr-3 text-[#122018]">{formatTimeNl(a.at)}</td>
              <td className="py-2.5 text-[#5A6B60]">
                {serviceAfspraakStatus(a.at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DatumOptieTab({
  soort,
  token,
  data,
  onDone,
}: {
  soort: DatumOptieSoort;
  token: string;
  data: KlantTrackPayload;
  onDone: () => void;
}) {
  const optie =
    (data.datum_opties || []).find((o) => o.soort === soort) || null;
  const agendaItem =
    data.agenda.find((a) => a.id === soort) || null;
  const serviceAfspraken = data.service_afspraken || [];

  // Service: overzichtstabel van alle geplande afspraken (niet clickable)
  if (soort === "service") {
    const openOptie = optie?.status === "open" ? optie : null;
    if (openOptie) {
      return (
        <div className="mt-6 space-y-4">
          <DatumOptieWizard
            soort={soort}
            token={token}
            optie={openOptie}
            prefNaam={data.klant_naam}
            prefEmail={data.klant_email}
            prefTelefoon={data.klant_telefoon}
            onDone={onDone}
          />
          {serviceAfspraken.length > 0 ? (
            <section className="rounded-xl border border-[#D8E4DC] bg-white px-4 py-5 sm:px-5">
              <h2 className="font-display text-lg font-semibold text-[#122018]">
                Jouw service-afspraken
              </h2>
              <ServiceAfsprakenTable afspraken={serviceAfspraken} />
            </section>
          ) : null}
        </div>
      );
    }

    return (
      <section className="mt-6 rounded-xl border border-[#D8E4DC] bg-white px-4 py-5 sm:px-5">
        <h2 className="font-display text-lg font-semibold text-[#122018]">
          Service-afspraken
        </h2>
        <p className="mt-1 text-sm text-[#5A6B60]">
          Overzicht van je geplande service-afspraken.
        </p>
        <ServiceAfsprakenTable afspraken={serviceAfspraken} />
      </section>
    );
  }

  if (!optie && agendaItem) {
    return (
      <section className="mt-6 rounded-xl border border-[#D8E4DC] bg-white px-4 py-5 sm:px-5">
        {soort === "overstap" ? (
          <OverstapHeader
            title="Overstap gepland"
            subtitle={`Je afspraak staat gepland op ${agendaItem.when}.`}
          />
        ) : (
          <>
            <h2 className="font-display text-lg font-semibold text-[#122018]">
              {datumOptieSoortLabel(soort)}
            </h2>
            <p className="mt-2 text-sm text-[#5A6B60]">
              Je afspraak staat gepland op{" "}
              <strong className="text-[#122018]">{agendaItem.when}</strong>.
            </p>
          </>
        )}
      </section>
    );
  }

  if (!optie) {
    return (
      <section className="mt-6 rounded-xl border border-[#D8E4DC] bg-white px-4 py-5 sm:px-5">
        {soort === "overstap" ? (
          <OverstapHeader
            title="Overstap"
            subtitle="Er is nu geen open uitnodiging. We sturen je een mail zodra je een datum kunt kiezen."
          />
        ) : (
          <>
            <h2 className="font-display text-lg font-semibold text-[#122018]">
              {datumOptieSoortLabel(soort)}
            </h2>
            <p className="mt-2 text-sm text-[#5A6B60]">
              Er is nu geen open uitnodiging. We sturen je een mail zodra je een
              datum kunt kiezen.
            </p>
          </>
        )}
      </section>
    );
  }

  if (optie.status === "gekozen" && optie.gekozen_slot) {
    return (
      <section className="mt-6 rounded-xl border border-[#D8E4DC] bg-white px-4 py-5 sm:px-5">
        {soort === "overstap" ? (
          <OverstapHeader
            title="Overstap bevestigd"
            subtitle={`Je hebt gekozen voor ${formatDateTimeLongNl(optie.gekozen_slot)}. We nemen telefonisch contact met je op om de overstap voor je te regelen — we bellen naar het nummer dat je hebt doorgegeven.`}
          />
        ) : (
          <>
            <h2 className="font-display text-lg font-semibold text-[#122018]">
              {datumOptieSoortLabel(soort)} bevestigd
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#5A6B60]">
              Je hebt gekozen voor{" "}
              <strong className="text-[#122018]">
                {formatDateTimeLongNl(optie.gekozen_slot)}
              </strong>
              .
            </p>
          </>
        )}
      </section>
    );
  }

  return (
    <DatumOptieWizard
      soort={soort}
      token={token}
      optie={optie}
      prefNaam={data.klant_naam}
      prefEmail={data.klant_email}
      prefTelefoon={data.klant_telefoon}
      onDone={onDone}
    />
  );
}

type AltOverstapSlot = {
  start_at: string;
  end_at: string;
  adviseur_id: string;
  adviseur_naam: string;
};

function DatumOptieWizard({
  soort,
  token,
  optie,
  prefNaam,
  prefEmail,
  prefTelefoon,
  onDone,
}: {
  soort: DatumOptieSoort;
  token: string;
  optie: KlantDatumOptie;
  prefNaam: string;
  prefEmail: string | null;
  prefTelefoon: string | null;
  onDone: () => void;
}) {
  const [step, setStep] = useState<
    "slots" | "alt" | "gegevens" | "done"
  >("slots");
  const [slotIndex, setSlotIndex] = useState<number | null>(null);
  const [altSlot, setAltSlot] = useState<AltOverstapSlot | null>(null);
  const [altSlots, setAltSlots] = useState<AltOverstapSlot[]>([]);
  const [altLoading, setAltLoading] = useState(false);
  const [naam, setNaam] = useState(prefNaam || "");
  const [email, setEmail] = useState(prefEmail || "");
  const [telefoon, setTelefoon] = useState(prefTelefoon || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gekozenIso =
    altSlot?.start_at ||
    (slotIndex != null ? optie.slots[slotIndex] : null) ||
    null;

  async function loadAltSlots() {
    setAltLoading(true);
    setError(null);
    setAltSlot(null);
    setSlotIndex(null);
    try {
      const res = await fetch(`/api/track/${token}/overstap-slots`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Slots laden mislukt"
        );
      }
      setAltSlots(
        ((json as { slots?: AltOverstapSlot[] }).slots || []).slice(0, 10)
      );
      setStep("alt");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Slots laden mislukt");
    } finally {
      setAltLoading(false);
    }
  }

  async function bevestigen() {
    if (!gekozenIso && slotIndex == null && !altSlot) return;
    setBusy(true);
    setError(null);
    try {
      const payload = altSlot
        ? {
            soort,
            custom_start_at: altSlot.start_at,
            adviseur_id: altSlot.adviseur_id,
            naam: naam.trim(),
            email: email.trim(),
            telefoon: telefoon.trim(),
          }
        : {
            soort,
            slot_index: slotIndex,
            naam: naam.trim(),
            email: email.trim(),
            telefoon: telefoon.trim(),
          };
      const res = await fetch(`/api/track/${token}/datum-opties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Bevestigen mislukt"
        );
      }
      setStep("done");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bevestigen mislukt");
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    const when = gekozenIso ? formatDateTimeLongNl(gekozenIso) : null;
    if (soort === "overstap") {
      return (
        <section className="mt-6 rounded-xl border border-[#D8E4DC] bg-white px-4 py-5 sm:px-5">
          <OverstapHeader
            title="Bedankt!"
            subtitle={
              when
                ? `Je overstap-afspraak staat vast op ${when}. We nemen telefonisch contact met je op om de overstap voor je te regelen — we bellen naar het nummer dat je hebt doorgegeven.`
                : "Je overstap-afspraak staat vast. We nemen telefonisch contact met je op om de overstap voor je te regelen — we bellen naar het nummer dat je hebt doorgegeven."
            }
          />
        </section>
      );
    }
    return (
      <section className="mt-6 rounded-xl border border-[#D8E4DC] bg-white px-4 py-5 sm:px-5">
        <h2 className="font-display text-lg font-semibold text-[#122018]">
          Bedankt!
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[#5A6B60]">
          Je {datumOptieSoortLabel(soort).toLowerCase()}-afspraak staat vast
          {when ? (
            <>
              {" "}
              op <strong className="text-[#122018]">{when}</strong>
            </>
          ) : null}
          . Je vindt hem ook terug onder Agenda.
        </p>
      </section>
    );
  }

  const canNext =
    step === "slots"
      ? slotIndex != null
      : step === "alt"
        ? altSlot != null
        : true;

  const wizardTitle =
    step === "gegevens"
      ? "Gegevens bevestigen"
      : step === "alt"
        ? "Kies een ander tijdslot"
        : "Kies een datum";
  const wizardSubtitle =
    step === "gegevens"
      ? "Controleer je gegevens zodat we je kunnen bereiken."
      : step === "alt"
        ? "Andere vrije momenten (30 min · ma–vr 09:00–17:00, lunch 12:00–12:30 dicht)."
        : soort === "overstap"
          ? "Kies één van de drie voorgestelde tijden. Een overstap naar Frank Energie duurt ongeveer 30 minuten."
          : "Kies één van de drie voorgestelde tijden. Een service duurt meestal 1 uur.";

  return (
    <section className="mt-6 space-y-4">
      <div className="rounded-xl border border-[#D8E4DC] bg-white px-4 py-4 sm:px-5">
        {soort === "overstap" ? (
          <OverstapHeader title={wizardTitle} subtitle={wizardSubtitle} />
        ) : (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0D5C32]">
              {datumOptieSoortLabel(soort)}
            </p>
            <h2 className="mt-1 font-display text-lg font-semibold text-[#122018]">
              {wizardTitle}
            </h2>
            <p className="mt-1 text-sm text-[#5A6B60]">{wizardSubtitle}</p>
          </>
        )}
        {step === "slots" || step === "alt" ? (
          <p className="mt-3 inline-flex rounded-lg bg-[#F4F8F5] px-2.5 py-1 text-[11px] font-semibold text-[#0D5C32]">
            {soort === "overstap"
              ? "Duur · ca. 30 min"
              : "Duur · meestal 1 uur"}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-[#E8C4B8] bg-[#FFF6F2] px-3 py-2 text-sm text-[#9A3B1A]">
          {error}
        </p>
      ) : null}

      {step === "slots" || step === "alt" ? (
        <div className="space-y-2">
          {step === "slots"
            ? optie.slots.map((iso, i) => {
                const selected = slotIndex === i && !altSlot;
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => {
                      setSlotIndex(i);
                      setAltSlot(null);
                    }}
                    className={[
                      "flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-left transition",
                      selected
                        ? "border-[#0D5C32] bg-[#E8F5EE] ring-1 ring-[#0D5C32]"
                        : "border-[#D8E4DC] bg-white hover:border-[#0D5C32]/40",
                    ].join(" ")}
                  >
                    <span className="text-sm font-semibold text-[#122018]">
                      {formatDateTimeLongNl(iso)}
                    </span>
                    <span
                      className={[
                        "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
                        selected
                          ? "border-[#0D5C32] bg-[#0D5C32] text-white"
                          : "border-[#C5D4CA] text-transparent",
                      ].join(" ")}
                    >
                      ✓
                    </span>
                  </button>
                );
              })
            : null}

          {step === "alt" ? (
            altLoading ? (
              <p className="py-6 text-center text-sm text-[#5A6B60]">
                Beschikbare tijden laden…
              </p>
            ) : altSlots.length === 0 ? (
              <p className="rounded-xl border border-[#D8E4DC] bg-white px-4 py-6 text-center text-sm text-[#5A6B60]">
                Geen extra tijdsloten beschikbaar. Kies een van de drie
                voorgestelde tijden.
              </p>
            ) : (
              altSlots.map((s) => {
                const selected = altSlot?.start_at === s.start_at;
                return (
                  <button
                    key={s.start_at}
                    type="button"
                    onClick={() => {
                      setAltSlot(s);
                      setSlotIndex(null);
                    }}
                    className={[
                      "flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-left transition",
                      selected
                        ? "border-[#0D5C32] bg-[#E8F5EE] ring-1 ring-[#0D5C32]"
                        : "border-[#D8E4DC] bg-white hover:border-[#0D5C32]/40",
                    ].join(" ")}
                  >
                    <span className="text-sm font-semibold text-[#122018]">
                      {formatDateTimeLongNl(s.start_at)}
                    </span>
                    <span
                      className={[
                        "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
                        selected
                          ? "border-[#0D5C32] bg-[#0D5C32] text-white"
                          : "border-[#C5D4CA] text-transparent",
                      ].join(" ")}
                    >
                      ✓
                    </span>
                  </button>
                );
              })
            )
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            {soort === "overstap" ? (
              step === "slots" ? (
                <button
                  type="button"
                  disabled={altLoading}
                  onClick={() => void loadAltSlots()}
                  className="rounded-xl border border-[#D8E4DC] bg-white px-4 py-2.5 text-sm font-semibold text-[#122018] hover:bg-[#F4F8F5] disabled:opacity-50"
                >
                  {altLoading ? "Laden…" : "Kies ander tijdslot"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setStep("slots");
                    setAltSlot(null);
                  }}
                  className="rounded-xl border border-[#D8E4DC] bg-white px-4 py-2.5 text-sm font-semibold text-[#122018] hover:bg-[#F4F8F5]"
                >
                  ← Voorgestelde tijden
                </button>
              )
            ) : (
              <span />
            )}
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setStep("gegevens")}
              className="rounded-xl bg-[#0D5C32] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              Volgende
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-[#D8E4DC] bg-white px-4 py-4 sm:px-5">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#5A6B60]">
              Naam
            </span>
            <input
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#D8E4DC] px-3 py-2 text-sm text-[#122018] outline-none focus:border-[#0D5C32]"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#5A6B60]">
              E-mail
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#D8E4DC] px-3 py-2 text-sm text-[#122018] outline-none focus:border-[#0D5C32]"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#5A6B60]">
              Telefoon
            </span>
            <input
              type="tel"
              value={telefoon}
              onChange={(e) => setTelefoon(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#D8E4DC] px-3 py-2 text-sm text-[#122018] outline-none focus:border-[#0D5C32]"
            />
          </label>
          {gekozenIso ? (
            <p className="rounded-lg bg-[#F4F8F5] px-3 py-2 text-xs text-[#5A6B60]">
              Gekozen tijd:{" "}
              <strong className="text-[#122018]">
                {formatDateTimeLongNl(gekozenIso)}
              </strong>
            </p>
          ) : null}
          <div className="flex flex-wrap justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => setStep(altSlot ? "alt" : "slots")}
              className="rounded-xl border border-[#D8E4DC] bg-white px-4 py-2.5 text-sm font-semibold text-[#122018] hover:bg-[#F4F8F5]"
            >
              ← Terug
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void bevestigen()}
              className="rounded-xl bg-[#0D5C32] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Bezig…" : "Bevestigen"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
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
  const facturen = data.documenten.facturen;

  return (
    <div className="mt-6 space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-[#122018]">
          Documenten
        </h2>
        <p className="mt-1 text-sm text-[#5A6B60]">
          Alles wat je van ons hebt ontvangen: getekende offerte en facturen.
        </p>
      </div>

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0D5C32]">
          Getekende offerte
        </h3>
        <ul className="mt-2 space-y-2">
          <li>
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
                  {data.documenten.offerte.ondertekend_op
                    ? ` · ondertekend`
                    : null}
                </span>
              </span>
              <span className="shrink-0 font-semibold text-[#0D5C32]">
                Open PDF →
              </span>
            </a>
          </li>
        </ul>
      </section>

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0D5C32]">
          Facturen
        </h3>
        <ul className="mt-2 space-y-2">
          {facturen.length === 0 ? (
            <li className="rounded-xl border border-dashed border-[#D8E4DC] px-4 py-3 text-sm text-[#7A8B80]">
              Nog geen facturen verstuurd. Zodra we een factuur mailen, staat die
              hier klaar.
            </li>
          ) : (
            facturen.map((f) => (
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
      </section>
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
