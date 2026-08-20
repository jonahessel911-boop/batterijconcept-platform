"use client";

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import type { Offerte, OfferteRegel } from "@/types/database";
import { formatDateNl, formatEuro, adresRegel } from "@/lib/format";
import { offerteRegelsVoorWeergave } from "@/lib/offerte-regels";
import { SignaturePadField } from "./SignaturePadField";

type Props = {
  offerte: Offerte;
  regels: OfferteRegel[];
  bedrijf: {
    naam: string;
    legal: string;
    kvk: string;
    vestigingsnummer?: string;
    adres: string;
    postcodePlaats: string;
    telefoon?: string;
    email?: string;
    website?: string;
  };
};

export function SignOfferteFlow({ offerte, regels, bedrijf }: Props) {
  const [naam, setNaam] = useState(offerte.leads?.naam || "");
  const [handtekening, setHandtekening] = useState<string | null>(null);
  const [akkoord, setAkkoord] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const today = useMemo(() => formatDateNl(new Date()), []);
  const offerteDatum = useMemo(
    () => formatDateNl(offerte.created_at),
    [offerte.created_at]
  );
  const weergaveRegels = useMemo(
    () =>
      offerteRegelsVoorWeergave(regels, {
        financieringVoorbehoud: offerte.financiering_voorbehoud,
      }),
    [regels, offerte.financiering_voorbehoud]
  );
  const alreadySigned = offerte.status === "ondertekend";
  const klantAdres = offerte.leads ? adresRegel(offerte.leads) : "—";

  const onSigChange = useCallback((url: string | null) => {
    setHandtekening(url);
  }, []);

  async function submit() {
    setError(null);
    if (!naam.trim()) {
      setError("Vul je naam in.");
      return;
    }
    if (!handtekening) {
      setError("Zet je handtekening.");
      return;
    }
    if (!akkoord) {
      setError("Bevestig dat je akkoord gaat met deze offerte.");
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

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Ondertekenen mislukt"
        );
      }

      setDone(true);

      const pdfB64 = (data as { pdf_base64?: string; filename?: string })
        .pdf_base64;
      const filename =
        (data as { filename?: string }).filename ||
        `${offerte.offerte_nummer}-ondertekend.pdf`;

      if (pdfB64) {
        try {
          const binary = atob(pdfB64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: "application/pdf" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } catch (dlErr) {
          console.warn("PDF-download overgeslagen:", dlErr);
        }
      }
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
            Bedankt{naam ? `, ${naam}` : ""}. Je ondertekende offerte staat in
            je mailbox en is bij Batterijconcept opgeslagen.
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
              {offerte.titel || "Offerte"}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto scroll-smooth px-3 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-[820px] pb-16">
          <article className="pdf-page relative overflow-hidden !p-0">
            {/* Diagonale header */}
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-[210px] sm:h-[230px]"
              aria-hidden
            >
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(118deg, #0a4727 0%, #1a8a3e 42%, #3ecf8e 78%, #c8f0dc 100%)",
                  clipPath: "polygon(0 0, 100% 0, 100% 42%, 0 100%)",
                }}
              />
            </div>

            <div className="relative px-6 pb-10 pt-8 sm:px-10 sm:pt-10">
              <div className="mb-10 flex flex-wrap items-start justify-between gap-6">
                <h2 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
                  OFFERTE
                </h2>

                <div className="flex max-w-[240px] flex-col items-end text-right">
                  <div className="mb-2 flex items-center gap-2">
                    <Image
                      src="/logo.png"
                      alt="BatterijConcept"
                      width={40}
                      height={40}
                      className="h-10 w-10 object-contain"
                      priority
                    />
                    <p className="font-display text-sm font-semibold leading-tight text-ink">
                      Batterij
                      <span className="text-[#C45A12]">concept</span>
                    </p>
                  </div>
                  <div className="space-y-0.5 text-[11px] leading-snug text-ink/90 sm:text-xs">
                    <p className="font-semibold uppercase tracking-wide">
                      {bedrijf.legal || bedrijf.naam}
                    </p>
                    {bedrijf.telefoon ? <p>{bedrijf.telefoon}</p> : null}
                    {bedrijf.email ? <p>{bedrijf.email}</p> : null}
                    {bedrijf.website ? <p>{bedrijf.website}</p> : null}
                    <p>KvK {bedrijf.kvk}</p>
                  </div>
                </div>
              </div>

              <div className="mb-8 flex flex-wrap items-end gap-6 sm:gap-10">
                <div>
                  <div className="inline-block bg-[#e8ece9] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-ink">
                    Datum
                  </div>
                  <p className="mt-2 text-sm font-medium text-ink">
                    {offerteDatum}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink">
                    Offertenummer
                  </p>
                  <p className="mt-2 font-mono text-sm font-medium text-ink">
                    {offerte.offerte_nummer}
                  </p>
                </div>
              </div>

              {offerte.leads && (
                <div className="mb-8">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink">
                    Offerte aan:
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {offerte.leads.naam}
                  </p>
                  {klantAdres !== "—" ? (
                    <p className="mt-0.5 text-sm text-muted">{klantAdres}</p>
                  ) : null}
                  {offerte.leads.email ? (
                    <p className="mt-0.5 text-sm text-muted">
                      {offerte.leads.email}
                    </p>
                  ) : null}
                  {offerte.leads.telefoon ? (
                    <p className="mt-0.5 text-sm text-muted">
                      {offerte.leads.telefoon}
                    </p>
                  ) : null}
                </div>
              )}

              {offerte.intro_tekst && (
                <p className="mb-8 text-sm leading-relaxed text-ink">
                  {offerte.intro_tekst}
                </p>
              )}

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-green-deeper text-left text-[11px] font-bold uppercase tracking-wide text-green-deeper">
                      <th className="pb-2 pr-3 font-bold">Omschrijving</th>
                      <th className="pb-2 text-right font-bold">Aantal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weergaveRegels.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-[#e2e8e4] text-ink"
                      >
                        <td className="py-3 pr-3 align-top font-medium">
                          {r.omschrijving}
                        </td>
                        <td className="py-3 align-top text-right tabular-nums">
                          {r.aantal}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 ml-auto w-full max-w-[280px] space-y-0">
                <div className="flex items-center justify-between border border-[#d5ddd8] px-3 py-2 text-sm">
                  <span className="text-muted">Totaal excl. BTW</span>
                  <span className="tabular-nums text-ink">
                    {formatEuro(offerte.subtotaal_ex_btw)}
                  </span>
                </div>
                <div className="flex items-center justify-between border border-t-0 border-[#d5ddd8] px-3 py-2 text-sm">
                  <span className="text-muted">21% BTW</span>
                  <span className="tabular-nums text-ink">
                    {formatEuro(offerte.btw_bedrag)}
                  </span>
                </div>
                <div className="flex items-center justify-between border border-t-0 border-[#d5ddd8] bg-wash px-3 py-2.5 text-sm font-semibold">
                  <span className="text-green-deeper">Totaal incl. BTW</span>
                  <span className="tabular-nums text-green-deeper">
                    {formatEuro(offerte.totaal_inc_btw)}
                  </span>
                </div>
              </div>

              <div className="mt-10 space-y-2 text-sm text-muted">
                <p>Deze offerte heeft een geldigheidstermijn van 30 dagen.</p>
                <p>Graag vernemen we van je wat we voor je kunnen betekenen.</p>
                <p className="pt-2 text-ink">
                  Met vriendelijke groet,
                  <br />
                  <span className="font-medium">
                    {bedrijf.legal || bedrijf.naam}
                  </span>
                </p>
              </div>

              <div className="relative z-10 mt-10 rounded-2xl border border-[#e2e8e4] bg-wash/80 p-5">
                <h3 className="font-display text-base font-semibold text-ink">
                  Ondertekening
                </h3>
                <p className="mt-1 text-sm text-muted">
                  Vul je naam in en zet je handtekening hieronder.
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

                <label className="mt-5 flex items-start gap-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={akkoord}
                    onChange={(e) => setAkkoord(e.target.checked)}
                    className="mt-1 accent-green"
                  />
                  <span>Ik ga akkoord met deze offerte.</span>
                </label>

                <div className="mt-4">
                  <p className="mb-1.5 text-sm font-medium text-ink">
                    Handtekening
                  </p>
                  <SignaturePadField onChange={onSigChange} />
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
            </div>

            {/* Diagonale hoek rechtsonder */}
            <div
              className="pointer-events-none absolute bottom-0 right-0 h-24 w-40"
              aria-hidden
              style={{
                background:
                  "linear-gradient(135deg, transparent 40%, #1a8a3e 40%, #3ecf8e 100%)",
                clipPath: "polygon(100% 0, 100% 100%, 0 100%)",
              }}
            />
          </article>
        </div>
      </div>
    </div>
  );
}
