"use client";

import { useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { AMSTERDAM_TZ, formatDateTimeNl } from "@/lib/format";

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

function splitIso(iso: string | null | undefined): {
  datum: string;
  tijd: string;
} {
  if (!iso) return { datum: "", tijd: "10:00" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { datum: "", tijd: "10:00" };
  return {
    datum: formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd"),
    tijd: formatInTimeZone(d, AMSTERDAM_TZ, "HH:mm"),
  };
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
  const init = splitIso(huidige);
  const [datum, setDatum] = useState(init.datum);
  const [tijd, setTijd] = useState(init.tijd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tijden = useMemo(() => {
    const list: string[] = [];
    for (let min = 8 * 60; min <= 18 * 60; min += 30) {
      const h = String(Math.floor(min / 60)).padStart(2, "0");
      const m = String(min % 60).padStart(2, "0");
      list.push(`${h}:${m}`);
    }
    return list.includes(tijd) ? list : [tijd, ...list];
  }, [tijd]);

  async function opslaan(iso: string | null, ok: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/warmtefonds/${token}/orders/${projectId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ warmtefonds_afspraak_at: iso }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      onKlaar(iso ? berichtVan(data.bevestiging) : ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function bevestig() {
    if (!datum || !tijd) {
      setError("Kies een datum en een tijd.");
      return;
    }
    const d = new Date(`${datum}T${tijd}`);
    if (Number.isNaN(d.getTime())) {
      setError("Ongeldige datum of tijd.");
      return;
    }
    await opslaan(d.toISOString(), "Afspraak gezet.");
  }

  return (
    <div className="space-y-5">
      {huidige ? (
        <div className="border border-line bg-wash/50 px-3 py-2.5 text-sm">
          <p className="text-ink">
            Nu gepland:{" "}
            <span className="font-semibold">{formatDateTimeNl(huidige)}</span>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void opslaan(null, "Afspraak gewist.")}
            className="mt-1 text-xs font-semibold text-muted underline hover:text-ink disabled:opacity-60"
          >
            Afspraak wissen
          </button>
        </div>
      ) : null}

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

      <button
        type="button"
        disabled={busy || !datum || !tijd}
        onClick={() => void bevestig()}
        className="w-full bg-green px-4 py-3 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60 sm:w-auto"
      >
        {busy ? "Bezig…" : "Maak WF afspraak"}
      </button>
    </div>
  );
}
