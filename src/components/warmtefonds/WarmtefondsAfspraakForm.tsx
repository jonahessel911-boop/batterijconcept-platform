"use client";

import { useEffect, useState } from "react";
import { formatDateTimeNl } from "@/lib/format";

const TIJDEN: string[] = [];
for (let min = 8 * 60; min <= 18 * 60; min += 30) {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  TIJDEN.push(`${h}:${m}`);
}

function delen(iso: string | null | undefined): { datum: string; tijd: string } {
  if (!iso) return { datum: "", tijd: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { datum: "", tijd: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    datum: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    tijd: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function berichtVan(bevestiging: string | null | undefined): string {
  if (bevestiging === "verzonden") {
    return "Afspraak gezet. Bevestiging is naar de klant gestuurd.";
  }
  if (bevestiging === "geen_email") {
    return "Afspraak gezet. De klant heeft geen e-mailadres, dus geen bevestiging.";
  }
  if (bevestiging === "mislukt") {
    return "Afspraak gezet. De bevestigingsmail is niet verstuurd.";
  }
  return "Afspraak gezet.";
}

export function WarmtefondsAfspraakForm({
  token,
  projectId,
  huidige,
  onKlaar,
}: {
  token: string;
  projectId: string;
  huidige?: string | null;
  onKlaar: (bericht: string) => void;
}) {
  const start = delen(huidige);
  const [datum, setDatum] = useState(start.datum);
  const [tijd, setTijd] = useState(start.tijd || "10:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = delen(huidige);
    setDatum(next.datum);
    setTijd(next.tijd || "10:00");
  }, [huidige]);

  const tijden = TIJDEN.includes(tijd) ? TIJDEN : [tijd, ...TIJDEN];

  async function opslaan(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/warmtefonds/${token}/orders/${projectId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      onKlaar(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function maak() {
    if (!datum || !tijd) {
      setError("Kies een datum en een tijd.");
      return;
    }
    const d = new Date(`${datum}T${tijd}`);
    if (Number.isNaN(d.getTime())) {
      setError("Ongeldige datum of tijd.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/warmtefonds/${token}/orders/${projectId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ warmtefonds_afspraak_at: d.toISOString() }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      onKlaar(berichtVan(data.bevestiging));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {huidige ? (
        <p className="text-sm text-ink">
          Nu gepland:{" "}
          <span className="font-semibold">{formatDateTimeNl(huidige)}</span>
        </p>
      ) : (
        <p className="text-sm text-muted">Nog geen afspraak.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-ink">
          Datum
          <input
            type="date"
            value={datum}
            onChange={(e) => setDatum(e.target.value)}
            className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-green-dark"
          />
        </label>
        <label className="block text-xs font-semibold text-ink">
          Tijd
          <select
            value={tijd}
            onChange={(e) => setTijd(e.target.value)}
            className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-green-dark"
          >
            {tijden.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="text-xs text-[#C45A12]">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void maak()}
          className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
        >
          {busy ? "Bezig…" : "Maak WF Afspraak"}
        </button>
        {huidige ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void opslaan(
                { warmtefonds_afspraak_at: null },
                "Afspraak gewist."
              )
            }
            className="border border-line bg-white px-4 py-2.5 text-sm font-medium hover:bg-wash"
          >
            Wissen
          </button>
        ) : null}
      </div>
    </div>
  );
}
