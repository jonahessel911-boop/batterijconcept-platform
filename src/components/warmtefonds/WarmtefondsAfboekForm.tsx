"use client";

import { useEffect, useState } from "react";
import { formatDateTimeNl } from "@/lib/format";

export type WfAfboekUitkomst =
  | "in_behandeling"
  | "vervolg_tel"
  | "vervolg_fysiek";

const UITKOMSTEN: {
  id: WfAfboekUitkomst;
  label: string;
  hint: string;
}[] = [
  {
    id: "in_behandeling",
    label: "WF in behandeling",
    hint: "Geen nieuwe afspraak. Status → in behandeling.",
  },
  {
    id: "vervolg_tel",
    label: "Vervolg telefonisch",
    hint: "Kies hieronder wanneer je belt — komt in de agenda, geen klantmail.",
  },
  {
    id: "vervolg_fysiek",
    label: "Vervolg op locatie",
    hint: "Kies hieronder het huisbezoek — komt in de agenda.",
  },
];

/** Lokale `YYYY-MM-DDTHH:mm` voor datetime-local (Amsterdam-browser). */
function defaultVervolgLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function WarmtefondsAfboekForm({
  token,
  projectId,
  huidigeAfspraak,
  onKlaar,
}: {
  token: string;
  projectId: string;
  huidigeAfspraak?: string | null;
  onKlaar: (bericht: string) => void;
}) {
  const [uitkomst, setUitkomst] = useState<WfAfboekUitkomst | "">("");
  const [vervolgAt, setVervolgAt] = useState("");
  const [notitie, setNotitie] = useState("");
  const [bevestigingMail, setBevestigingMail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsVervolg =
    uitkomst === "vervolg_tel" || uitkomst === "vervolg_fysiek";
  const isFysiekVervolg = uitkomst === "vervolg_fysiek";

  useEffect(() => {
    if (!needsVervolg) return;
    if (vervolgAt) return;
    setVervolgAt(defaultVervolgLocal());
  }, [needsVervolg, vervolgAt]);

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!uitkomst) {
      setError("Kies een uitkomst.");
      return;
    }
    const note = notitie.trim();

    let vervolgLocal: string | undefined;
    if (needsVervolg) {
      if (!vervolgAt.trim()) {
        setError("Kies datum en tijd voor het vervolg.");
        return;
      }
      const d = new Date(vervolgAt.trim());
      if (Number.isNaN(d.getTime())) {
        setError("Ongeldige datum of tijd.");
        return;
      }
      if (d.getTime() <= Date.now()) {
        setError("Vervolg moet in de toekomst liggen.");
        return;
      }
      // Amsterdam-lokaal doorsturen (zelfde als adviseur-agenda)
      vervolgLocal = vervolgAt.trim();
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/warmtefonds/${token}/orders/${projectId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            afboek: {
              uitkomst,
              vervolg_at: vervolgLocal ?? null,
              notitie: note || null,
              bevestiging_mail: isFysiekVervolg ? bevestigingMail : false,
            },
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Afboeken mislukt");

      const label =
        UITKOMSTEN.find((u) => u.id === uitkomst)?.label || uitkomst;
      let msg = `Afgeboekt: ${label}.`;
      if (vervolgLocal) {
        const preview = new Date(vervolgLocal);
        msg += ` Vervolg ${formatDateTimeNl(preview.toISOString())}.`;
        if (data.bevestiging === "verzonden") {
          msg += " Bevestiging naar de klant.";
        } else if (data.bevestiging === "geen_email") {
          msg += " Geen e-mail — geen bevestiging.";
        } else if (data.bevestiging === "mislukt") {
          msg += " Bevestigingsmail mislukt.";
        }
      }
      onKlaar(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Afboeken mislukt");
    } finally {
      setBusy(false);
    }
  }

  const kanOpslaan =
    Boolean(uitkomst) && (!needsVervolg || Boolean(vervolgAt.trim()));

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      {huidigeAfspraak ? (
        <p className="text-sm text-ink">
          Gepland:{" "}
          <span className="font-semibold">
            {formatDateTimeNl(huidigeAfspraak)}
          </span>
        </p>
      ) : null}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Uitkomst
        </p>
        <div className="mt-2 grid gap-2">
          {UITKOMSTEN.map((u) => {
            const active = uitkomst === u.id;
            return (
              <button
                key={u.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  setUitkomst(u.id);
                  setError(null);
                }}
                className={[
                  "min-h-11 w-full rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition",
                  active
                    ? "border-[#C45A12] bg-[#C45A12] text-white"
                    : "border-line bg-white text-ink hover:border-[#C45A12]/50 hover:bg-[#FFF8F3]",
                ].join(" ")}
              >
                {u.label}
              </button>
            );
          })}
        </div>
      </div>

      {uitkomst ? (
        <p className="text-[12px] text-muted">
          {UITKOMSTEN.find((u) => u.id === uitkomst)?.hint}
        </p>
      ) : null}

      {needsVervolg ? (
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Datum &amp; tijd vervolg
          <input
            type="datetime-local"
            required
            disabled={busy}
            value={vervolgAt}
            onChange={(e) => setVervolgAt(e.target.value)}
            className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm font-normal text-ink outline-none focus:border-green-dark"
          />
        </label>
      ) : null}

      {isFysiekVervolg ? (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-white px-3 py-2.5">
          <input
            type="checkbox"
            checked={bevestigingMail}
            disabled={busy}
            onChange={(e) => setBevestigingMail(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#C45A12]"
          />
          <span className="text-sm text-ink">
            <span className="font-semibold">Bevestiging naar de klant</span>
            <span className="mt-0.5 block text-[12px] text-muted">
              Standaard aan — mail met datum/tijd van het huisbezoek.
            </span>
          </span>
        </label>
      ) : null}

      <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
        Notitie <span className="font-normal normal-case">(optioneel)</span>
        <textarea
          value={notitie}
          onChange={(e) => setNotitie(e.target.value)}
          rows={2}
          disabled={busy}
          placeholder={
            needsVervolg
              ? "Korte toelichting bij het vervolg…"
              : "Korte toelichting bij de uitkomst…"
          }
          className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green-dark"
        />
      </label>

      {error ? <p className="text-xs font-medium text-[#C45A12]">{error}</p> : null}

      <button
        type="submit"
        disabled={busy || !kanOpslaan}
        className="min-h-11 w-full bg-[#C45A12] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#a84b0f] disabled:opacity-60"
      >
        {busy ? "Bezig…" : "Opslaan"}
      </button>
    </form>
  );
}
