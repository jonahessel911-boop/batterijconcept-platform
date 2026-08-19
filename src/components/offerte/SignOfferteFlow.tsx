"use client";

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import type { Offerte, OfferteRegel } from "@/types/database";
import { formatDateNl, formatEuro, adresRegel } from "@/lib/format";
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
  const alreadySigned = offerte.status === "ondertekend";

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
          <article className="pdf-page relative">
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

            <div className="mb-6 rounded-xl border border-[#e2e8e4] bg-wash/60 p-4">
              <p className="text-sm font-semibold text-ink">{bedrijf.naam}</p>
              <p className="mt-1 text-sm text-muted">
                Detailhandel via internet van thuisbatterijen. Installatie door derden.
              </p>
              <div className="mt-3 space-y-1 text-sm text-ink">
                <p>KVK-nummer: {bedrijf.kvk}</p>
                {bedrijf.vestigingsnummer ? (
                  <p>Vestigingsnummer: {bedrijf.vestigingsnummer}</p>
                ) : null}
                <p>
                  {bedrijf.adres}, {bedrijf.postcodePlaats}
                </p>
              </div>
            </div>

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

            <div className="mt-5 space-y-1.5 border-t-2 border-green pt-4 text-right">
              <p className="text-sm text-muted">
                Subtotaal excl. btw{" "}
                <span className="ml-4 inline-block min-w-[6rem] tabular-nums text-ink">
                  {formatEuro(offerte.subtotaal_ex_btw)}
                </span>
              </p>
              <p className="text-sm text-muted">
                BTW{" "}
                <span className="ml-4 inline-block min-w-[6rem] tabular-nums text-ink">
                  {formatEuro(offerte.btw_bedrag)}
                </span>
              </p>
              <p className="font-display text-lg font-semibold text-green-deeper">
                Totaal incl. btw{" "}
                <span className="ml-4 inline-block min-w-[6rem] tabular-nums">
                  {formatEuro(offerte.totaal_inc_btw)}
                </span>
              </p>
            </div>

            <div className="mt-10 rounded-2xl border border-[#e2e8e4] bg-wash/80 p-5">
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
          </article>
        </div>
      </div>
    </div>
  );
}
