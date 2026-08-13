"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { Offerte, OfferteRegel } from "@/types/database";
import { BEDRIJFSWAARDEN } from "@/types/database";
import { formatDateNl, formatEuro, adresRegel } from "@/lib/format";
import { SignaturePadField } from "./SignaturePadField";

type Props = {
  offerte: Offerte;
  regels: OfferteRegel[];
};

/**
 * PDF-reader stijl: 2 scrollbare pagina's.
 * Pagina 1 — merk + waarden + naam + handtekening + datum
 * Pagina 2 — offerteproducten + handtekening-preview + Ondertekenen
 */
export function SignOfferteFlow({ offerte, regels }: Props) {
  const [naam, setNaam] = useState(offerte.leads?.naam || "");
  const [handtekening, setHandtekening] = useState<string | null>(null);
  const [akkoord, setAkkoord] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [visiblePage, setVisiblePage] = useState<1 | 2>(1);

  const page1Ref = useRef<HTMLElement>(null);
  const page2Ref = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => formatDateNl(new Date()), []);
  const alreadySigned = offerte.status === "ondertekend";

  const onSigChange = useCallback((url: string | null) => {
    setHandtekening(url);
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const p1 = page1Ref.current;
    const p2 = page2Ref.current;
    if (!scroller || !p1 || !p2) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        if (visible.target === p2) setVisiblePage(2);
        else if (visible.target === p1) setVisiblePage(1);
      },
      { root: scroller, threshold: [0.35, 0.55, 0.75] }
    );

    observer.observe(p1);
    observer.observe(p2);
    return () => observer.disconnect();
  }, [alreadySigned, done]);

  function scrollToPage(n: 1 | 2) {
    const el = n === 1 ? page1Ref.current : page2Ref.current;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submit() {
    setError(null);
    if (!naam.trim()) {
      setError("Vul je naam in op pagina 1.");
      scrollToPage(1);
      return;
    }
    if (!handtekening) {
      setError("Zet je handtekening op pagina 1.");
      scrollToPage(1);
      return;
    }
    if (!akkoord) {
      setError("Bevestig dat je akkoord gaat met onze waarden (pagina 1).");
      scrollToPage(1);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/offertes/${offerte.id}/sign?token=${encodeURIComponent(offerte.sign_token || "")}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            naam: naam.trim(),
            handtekening,
            waarden_akkoord: true,
          }),
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Ondertekenen mislukt");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${offerte.offerte_nummer}-ondertekend.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Er ging iets mis");
    } finally {
      setSubmitting(false);
    }
  }

  if (alreadySigned || done) {
    return (
      <div className="pdf-viewer flex min-h-screen flex-col items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-soft text-2xl text-green">
            ✓
          </div>
          <h1 className="font-display text-2xl font-semibold text-green-deeper">
            Offerte ondertekend
          </h1>
          <p className="mt-2 text-sm text-muted">
            Bedankt{naam ? `, ${naam}` : ""}. Je PDF is gedownload en
            opgeslagen bij Batterijconcept.
          </p>
          <p className="mt-4 font-mono text-xs text-green-dark">
            {offerte.offerte_nummer} · {today}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-viewer flex h-[100dvh] flex-col">
      {/* Toolbar */}
      <header className="z-20 flex shrink-0 items-center justify-between gap-3 border-b border-black/20 bg-[#1a1f1c] px-3 py-2.5 text-white sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Image
            src="/logo.png"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 rounded-full bg-white/10 object-contain"
          />
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold">
              {offerte.offerte_nummer}
            </p>
            <p className="truncate text-[11px] text-white/50">
              {offerte.titel || "Offerte"} · 2 pagina&apos;s
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-full bg-white/10 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => scrollToPage(1)}
            className={`rounded-full px-3 py-1.5 transition ${
              visiblePage === 1
                ? "bg-green text-white"
                : "text-white/70 hover:text-white"
            }`}
          >
            1
          </button>
          <button
            type="button"
            onClick={() => scrollToPage(2)}
            className={`rounded-full px-3 py-1.5 transition ${
              visiblePage === 2
                ? "bg-green text-white"
                : "text-white/70 hover:text-white"
            }`}
          >
            2
          </button>
        </div>
      </header>

      {/* Scrollable pages */}
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto scroll-smooth px-3 py-6 sm:px-6 sm:py-8"
      >
        <div className="mx-auto flex max-w-[820px] flex-col gap-8 pb-28">
          {/* —— PAGINA 1 —— */}
          <article
            ref={page1Ref}
            id="pdf-page-1"
            className="pdf-page relative scroll-mt-4"
          >
            <PageLabel n={1} />

            <div className="-mx-6 -mt-6 mb-8 bg-green px-6 py-8 text-white sm:-mx-10 sm:-mt-10 sm:px-10 sm:py-10">
              <div className="flex flex-wrap items-center gap-4">
                <Image
                  src="/logo.png"
                  alt="Batterijconcept"
                  width={64}
                  height={64}
                  className="h-14 w-14 rounded-full bg-white/15 object-contain p-1"
                  priority
                />
                <div>
                  <h1 className="font-display text-2xl font-semibold sm:text-3xl">
                    Batterij<span className="text-orange">concept</span>
                  </h1>
                  <p className="mt-1 text-sm text-white/80">
                    Opwekken · Opladen · Opslaan
                  </p>
                </div>
              </div>
            </div>

            <h2 className="font-display text-xl font-semibold text-green-deeper">
              Onze waarden
            </h2>
            <p className="mt-1 text-sm text-muted">
              Scroll naar pagina 2 om de offerte te bekijken en te ondertekenen.
            </p>

            <ul className="mt-6 space-y-3">
              {BEDRIJFSWAARDEN.map((w) => (
                <li
                  key={w.titel}
                  className="rounded-xl border border-[#e2e8e4] bg-wash px-4 py-3"
                >
                  <p className="font-display font-semibold text-green-dark">
                    {w.titel}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">{w.tekst}</p>
                </li>
              ))}
            </ul>

            <div className="mt-10 border-t border-[#e2e8e4] pt-8">
              <h3 className="font-display text-lg font-semibold text-ink">
                Ondertekening
              </h3>
              <p className="mt-1 text-sm text-muted">
                Vul je gegevens in — je handtekening verschijnt ook op pagina 2.
              </p>

              <label className="mt-5 block text-sm font-medium text-ink">
                Volledige naam
                <input
                  type="text"
                  value={naam}
                  onChange={(e) => setNaam(e.target.value)}
                  placeholder="Voor- en achternaam"
                  className="mt-1.5 w-full rounded-xl border border-[#d5e0d8] bg-white px-4 py-2.5 text-sm outline-none ring-green/30 focus:ring-2"
                />
              </label>

              <div className="mt-4">
                <p className="mb-1.5 text-sm font-medium text-ink">Datum</p>
                <div className="rounded-xl bg-green-soft px-4 py-2.5 text-sm font-medium text-green-dark">
                  {today}
                  <span className="ml-2 font-normal text-muted">
                    (Europe/Amsterdam)
                  </span>
                </div>
              </div>

              <div className="mt-4">
                <p className="mb-1.5 text-sm font-medium text-ink">
                  Handtekening
                </p>
                <SignaturePadField onChange={onSigChange} />
              </div>

              <label className="mt-4 flex items-start gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={akkoord}
                  onChange={(e) => setAkkoord(e.target.checked)}
                  className="mt-1 accent-green"
                />
                <span>
                  Ik ga akkoord met de waarden van Batterijconcept.nl.
                </span>
              </label>

              {offerte.financiering_voorbehoud && (
                <p className="mt-5 border border-orange/30 bg-[#FFF0E6] px-4 py-3 text-sm font-medium text-[#C45A12]">
                  Onder voorbehoud van financiering Warmtefonds
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => scrollToPage(2)}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-full border border-[#d5e0d8] bg-wash py-3 text-sm font-semibold text-green-dark hover:bg-green-soft"
            >
              Scroll naar pagina 2 — Offerte ↓
            </button>
          </article>

          {/* —— PAGINA 2 —— */}
          <article
            ref={page2Ref}
            id="pdf-page-2"
            className="pdf-page relative scroll-mt-4"
          >
            <PageLabel n={2} />

            <div className="-mx-6 -mt-6 mb-8 flex flex-wrap items-end justify-between gap-3 bg-green-deeper px-6 py-6 text-white sm:-mx-10 sm:-mt-10 sm:px-10">
              <div>
                <p className="text-xs uppercase tracking-wider text-white/60">
                  Offerte
                </p>
                <h2 className="font-display text-xl font-semibold sm:text-2xl">
                  {offerte.titel || "Offerte thuisbatterij"}
                </h2>
                <p className="mt-1 font-mono text-xs text-white/70">
                  {offerte.offerte_nummer}
                </p>
              </div>
              {offerte.geldig_tot && (
                <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
                  Geldig tot {formatDateNl(offerte.geldig_tot)}
                </span>
              )}
            </div>

            {offerte.leads && (
              <p className="mb-4 text-sm text-muted">
                Voor <strong className="text-ink">{offerte.leads.naam}</strong>
                {adresRegel(offerte.leads) !== "—"
                  ? ` · ${adresRegel(offerte.leads)}`
                  : ""}
              </p>
            )}

            {offerte.intro_tekst && (
              <p className="mb-6 text-sm leading-relaxed text-ink">
                {offerte.intro_tekst}
              </p>
            )}

            <div className="overflow-hidden rounded-xl border border-[#e2e8e4]">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Omschrijving</th>
                    <th>Aantal</th>
                    <th>Prijs</th>
                  </tr>
                </thead>
                <tbody>
                  {regels.map((r) => {
                    const lineInc =
                      Math.round(
                        r.aantal *
                          r.prijs_ex_btw *
                          (1 + (r.btw_percentage ?? 21) / 100) *
                          100
                      ) / 100;
                    return (
                      <tr key={r.id}>
                        <td className="font-medium">{r.omschrijving}</td>
                        <td>{r.aantal}</td>
                        <td className="whitespace-nowrap font-medium">
                          {formatEuro(lineInc)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-5 border-t-2 border-green pt-4 text-right">
              <p className="font-display text-lg font-semibold text-green-deeper">
                Totaal incl. btw{" "}
                <span className="ml-4 inline-block min-w-[6rem] tabular-nums">
                  {formatEuro(offerte.totaal_inc_btw)}
                </span>
              </p>
            </div>

            {/* Handtekening op pagina 2 */}
            <div className="mt-10 rounded-2xl border border-[#e2e8e4] bg-wash/80 p-5">
              <h3 className="font-display text-base font-semibold text-ink">
                Handtekening
              </h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                    Naam
                  </p>
                  <p className="mt-1 text-sm font-medium text-ink">
                    {naam.trim() || (
                      <span className="text-muted">Nog niet ingevuld</span>
                    )}
                  </p>
                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    Datum
                  </p>
                  <p className="mt-1 text-sm font-medium text-green-dark">
                    {today}
                  </p>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    Handtekening
                  </p>
                  <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-[#c5d4c9] bg-white">
                    {handtekening ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={handtekening}
                        alt="Handtekening"
                        className="max-h-24 max-w-full object-contain"
                      />
                    ) : (
                      <p className="px-4 text-center text-xs text-muted">
                        Zet je handtekening op pagina 1
                      </p>
                    )}
                  </div>
                </div>
              </div>
              {offerte.financiering_voorbehoud && (
                <p className="mt-4 text-sm font-medium text-[#C45A12]">
                  Onder voorbehoud van financiering Warmtefonds
                </p>
              )}
            </div>

            {error && (
              <p className="mt-4 rounded-xl bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
                {error}
              </p>
            )}

            <button
              type="button"
              disabled={submitting}
              onClick={submit}
              className="mt-8 w-full rounded-full bg-orange py-3.5 text-sm font-semibold text-white shadow-md transition hover:brightness-105 disabled:opacity-60"
            >
              {submitting ? "PDF opslaan…" : "Ondertekenen"}
            </button>
            <p className="mt-3 text-center text-[11px] text-muted">
              Na ondertekenen download je direct de ondertekende PDF.
            </p>
          </article>
        </div>
      </div>

      {/* Floating page hint */}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-30 -translate-x-1/2">
        <div className="pointer-events-auto rounded-full border border-white/10 bg-[#1a1f1c]/90 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur">
          Pagina {visiblePage} van 2
          {visiblePage === 1 && (
            <button
              type="button"
              onClick={() => scrollToPage(2)}
              className="ml-3 text-orange hover:underline"
            >
              Naar pagina 2 ↓
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PageLabel({ n }: { n: number }) {
  return (
    <div className="absolute -top-3 right-4 rounded-full bg-charcoal px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white shadow">
      Pagina {n}
    </div>
  );
}
