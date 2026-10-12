"use client";

import { useCallback, useEffect, useState } from "react";
import { SignaturePadField } from "@/components/offerte/SignaturePadField";

type Props = { token: string };

export function SignZzpContractFlow({ token }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("concept");
  const [naam, setNaam] = useState("");
  const [handtekening, setHandtekening] = useState<string | null>(null);
  const [akkoord, setAkkoord] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/contract/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError((data as { error?: string }).error || "Laden mislukt");
          return;
        }
        setNaam((data as { naam?: string }).naam || "");
        setStatus((data as { status?: string }).status || "concept");
        if ((data as { status?: string }).status === "ondertekend") {
          setDone(true);
        }
      } catch {
        if (!cancelled) setError("Laden mislukt");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSigChange = useCallback((url: string | null) => {
    setHandtekening(url);
  }, []);

  async function submit() {
    setError(null);
    if (!handtekening) {
      setError("Zet je handtekening.");
      return;
    }
    if (!akkoord) {
      setError("Bevestig dat je akkoord gaat met de overeenkomst.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/contract/${encodeURIComponent(token)}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handtekening,
          akkoord: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Ondertekenen mislukt"
        );
      }
      setDone(true);
      setStatus("ondertekend");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ondertekenen mislukt");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm text-muted">
        Overeenkomst laden…
      </div>
    );
  }

  if (error && !done && status === "concept" && !naam) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          BatterijConcept
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
          Samenwerkingsovereenkomst
        </h1>
        <p className="mt-2 text-sm text-muted">
          {naam ? `Voor ${naam}` : "ZZP-adviseur"} · Alleen handtekening nodig
        </p>
      </div>

      <a
        href={`/api/contract/${encodeURIComponent(token)}?pdf=1`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-wash"
      >
        Bekijk overeenkomst (PDF)
      </a>

      {done || status === "ondertekend" ? (
        <div className="border border-green/30 bg-green-soft px-4 py-4 text-sm text-green-dark">
          <p className="font-semibold">Ondertekend</p>
          <p className="mt-1">
            Bedankt. Je ontvangt de ondertekende PDF per e-mail.
          </p>
          <a
            href={`/api/contract/${encodeURIComponent(token)}?pdf=1`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block font-semibold underline"
          >
            Download ondertekende PDF
          </a>
        </div>
      ) : (
        <>
          <section className="space-y-3 border border-line bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Handtekening
            </p>
            <p className="text-sm text-muted">
              Je gegevens staan al in de overeenkomst. Zet hier alleen je
              handtekening.
            </p>
            <SignaturePadField onChange={onSigChange} />
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={akkoord}
                onChange={(e) => setAkkoord(e.target.checked)}
                className="mt-1"
              />
              <span>
                Ik heb de samenwerkingsovereenkomst gelezen en ga ermee akkoord,
                inclusief dat BatterijConcept namens mij de provisiefacturen
                opstelt.
              </span>
            </label>
          </section>

          {error ? (
            <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="w-full bg-green px-4 py-3 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
          >
            {submitting ? "Bezig…" : "Onderteken overeenkomst"}
          </button>
        </>
      )}
    </div>
  );
}
