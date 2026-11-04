"use client";

import { useEffect, useState } from "react";
import { adresRegel } from "@/lib/format";

type Template = {
  id: string;
  naam: string;
  onderwerp: string;
  bericht: string;
};

type Lead = {
  naam?: string | null;
  email?: string | null;
  telefoon?: string | null;
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
};

function onderwerpVan(projectNummer: string): string {
  return `Warmtefonds - ${projectNummer}`.trim();
}

function groetVan(naam: string | null | undefined): string {
  const n = naam?.trim();
  return n ? `Beste ${n},` : "Beste,";
}

function vulBericht(
  tekst: string,
  vars: Record<string, string>
): string {
  return tekst.replace(
    /\{(voornaam|naam|project|afspraak|adres)\}/gi,
    (_, key: string) => vars[key.toLowerCase()] ?? ""
  );
}

export function WarmtefondsContactMail({
  token,
  projectId,
  projectNummer,
  lead,
  onClose,
}: {
  token: string;
  projectId: string;
  projectNummer: string;
  lead: Lead | null;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const naam = lead?.naam?.trim() || "";
  const voornaam = naam.split(/\s+/)[0] || naam;
  const groet = groetVan(naam);
  const [to, setTo] = useState(lead?.email?.trim() || "");
  const [subject, setSubject] = useState(onderwerpVan(projectNummer));
  const [bericht, setBericht] = useState(`${groet}\n\n`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/warmtefonds/${token}/instellingen`);
      const data = await res.json().catch(() => ({}));
      if (!cancelled && res.ok) setTemplates(data.templates || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function verstuur() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(
        `/api/warmtefonds/${token}/orders/${projectId}/mail`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to, subject, bericht }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Versturen mislukt");
      setOk(`Verstuurd naar ${data.to || to}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Versturen mislukt");
    } finally {
      setBusy(false);
    }
  }

  const adres = lead ? adresRegel(lead) : "";

  return (
    <div
      role="dialog"
      aria-label="Contact"
      className="fixed inset-0 z-[70] flex flex-col bg-white"
    >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Contact
            </p>
            <h2 className="mt-0.5 font-display text-lg font-semibold text-ink">
              {lead?.naam || "Klant"}
            </h2>
            <p className="text-xs text-muted">{projectNummer}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-line px-2.5 py-1 text-xs font-semibold hover:bg-wash"
          >
            Sluiten
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {lead?.telefoon ? (
            <a
              href={`tel:${lead.telefoon.replace(/\s/g, "")}`}
              className="block text-sm font-medium text-green-dark hover:underline"
            >
              {lead.telefoon}
            </a>
          ) : null}
          {adres && adres !== "—" ? (
            <p className="text-sm text-muted">{adres}</p>
          ) : null}
          <label className="block text-xs font-semibold text-ink">
            Aan
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full border border-line px-3 py-2 text-sm outline-none focus:border-green"
            />
          </label>
          <label className="block text-xs font-semibold text-ink">
            Template
            <select
              defaultValue=""
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                setSubject(onderwerpVan(projectNummer));
                if (!t) {
                  setBericht(`${groet}\n\n`);
                  return;
                }
                const ingevuld = vulBericht(t.bericht, {
                  voornaam,
                  naam,
                  project: projectNummer,
                  afspraak: "",
                  adres: adres && adres !== "—" ? adres : "",
                })
                  .replace(/^\s*beste\b[^\n]*/i, "")
                  .trim();
                setBericht(ingevuld ? `${groet}\n\n${ingevuld}` : `${groet}\n\n`);
              }}
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
            >
              <option value="">Zelf schrijven</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.naam}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-ink">
            Onderwerp
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full border border-line px-3 py-2 text-sm outline-none focus:border-green"
            />
          </label>
          <label className="flex min-h-[16rem] flex-1 flex-col text-xs font-semibold text-ink">
            Bericht
            <textarea
              value={bericht}
              onChange={(e) => setBericht(e.target.value)}
              className="mt-1 w-full flex-1 border border-line px-3 py-2 text-sm font-normal outline-none focus:border-green"
            />
          </label>
          <p className="text-[11px] text-muted">
            {"{voornaam} {naam} {project} {afspraak} {adres}"}
          </p>
          {error ? (
            <p className="text-xs text-[#C45A12]">{error}</p>
          ) : null}
          {ok ? <p className="text-xs text-green-dark">{ok}</p> : null}
        </div>
        <div className="border-t border-line px-5 py-4">
          <button
            type="button"
            disabled={busy || Boolean(ok)}
            onClick={() => void verstuur()}
            className="h-11 w-full bg-green text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
          >
            {busy ? "Bezig…" : "Versturen"}
          </button>
        </div>
    </div>
  );
}
