"use client";

import { useCallback, useEffect, useState } from "react";
import type { WfMail } from "@/lib/warmtefonds-automatisering";

type Mails = {
  binnenkomst: WfMail;
  dag_ervoor: WfMail;
};

const LEEG: WfMail = { actief: false, onderwerp: "", bericht: "" };

const VELDEN: {
  id: keyof Mails;
  titel: string;
  uitleg: string;
}[] = [
  {
    id: "binnenkomst",
    titel: "Aanvraag komt binnen",
    uitleg: "Gaat eruit zodra de aanvraag bij je binnenkomt.",
  },
  {
    id: "dag_ervoor",
    titel: "1 dag voor de afspraak",
    uitleg: "Gaat de ochtend ervoor naar de klant.",
  },
];

export function WarmtefondsInstellingen({ token }: { token: string }) {
  const [mails, setMails] = useState<Mails>({
    binnenkomst: LEEG,
    dag_ervoor: LEEG,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warmtefonds/${token}/instellingen`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setMails({
        binnenkomst: { ...LEEG, ...data.binnenkomst },
        dag_ervoor: { ...LEEG, ...data.dag_ervoor },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  function zet(id: keyof Mails, patch: Partial<WfMail>) {
    setMails((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    setOk(null);
  }

  async function opslaan() {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(`/api/warmtefonds/${token}/instellingen`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mails),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setMails({
        binnenkomst: { ...LEEG, ...data.binnenkomst },
        dag_ervoor: { ...LEEG, ...data.dag_ervoor },
      });
      setOk("Opgeslagen");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="border border-line bg-white px-5 py-14 text-center text-sm text-muted">
        Laden…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {VELDEN.map((veld) => {
        const mail = mails[veld.id];
        return (
          <section key={veld.id} className="border border-line bg-white">
            <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
              <div>
                <h2 className="font-display text-base font-semibold text-ink">
                  {veld.titel}
                </h2>
                <p className="mt-0.5 text-xs text-muted">{veld.uitleg}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={mail.actief}
                onClick={() => zet(veld.id, { actief: !mail.actief })}
                className={[
                  "inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold",
                  mail.actief
                    ? "bg-green-dark text-white"
                    : "bg-wash text-muted ring-1 ring-line",
                ].join(" ")}
              >
                <span
                  className={[
                    "h-2 w-2 rounded-full",
                    mail.actief ? "bg-white" : "bg-muted",
                  ].join(" ")}
                />
                {mail.actief ? "Aan" : "Uit"}
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <label className="block text-xs font-semibold text-ink">
                Onderwerp
                <input
                  value={mail.onderwerp}
                  onChange={(e) => zet(veld.id, { onderwerp: e.target.value })}
                  className="mt-1 w-full border border-line px-3 py-2 text-sm font-normal outline-none focus:border-green-dark"
                />
              </label>
              <label className="block text-xs font-semibold text-ink">
                Bericht
                <textarea
                  value={mail.bericht}
                  onChange={(e) => zet(veld.id, { bericht: e.target.value })}
                  rows={6}
                  placeholder="Beste {voornaam},"
                  className="mt-1 w-full border border-line px-3 py-2 text-sm font-normal outline-none focus:border-green-dark"
                />
              </label>
              <p className="text-[11px] text-muted">
                {"{voornaam} {naam} {project} {afspraak} {adres}"}
              </p>
            </div>
          </section>
        );
      })}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void opslaan()}
          className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
        >
          {saving ? "Bezig…" : "Opslaan"}
        </button>
        {ok ? <p className="text-xs text-green-dark">{ok}</p> : null}
        {error ? <p className="text-xs text-[#C45A12]">{error}</p> : null}
      </div>
    </div>
  );
}
