"use client";

import { useState } from "react";
import type { Lead } from "@/types/database";

export function LeadToevoegenModal({
  open,
  onClose,
  onCreated,
  defaultAdviseurId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (lead: Lead) => void;
  defaultAdviseurId?: string;
}) {
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [postcode, setPostcode] = useState("");
  const [huisnummer, setHuisnummer] = useState("");
  const [straat, setStraat] = useState("");
  const [plaats, setPlaats] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setNaam("");
    setEmail("");
    setTelefoon("");
    setPostcode("");
    setHuisnummer("");
    setStraat("");
    setPlaats("");
    setError(null);
  }

  async function lookupAdres(pc = postcode, nr = huisnummer) {
    if (!pc.trim() || !nr.trim()) return;
    // Alleen ophalen als adres nog leeg is
    if (straat.trim() && plaats.trim()) return;

    setLookupBusy(true);
    try {
      const qs = new URLSearchParams({
        postcode: pc.trim(),
        number: nr.trim(),
      });
      const res = await fetch(`/api/postcode?${qs}`);
      const data = await res.json();
      if (!res.ok) return;
      if (!straat.trim() && data.straat) setStraat(data.straat);
      if (!plaats.trim() && data.plaats) setPlaats(data.plaats);
    } catch {
      /* stil — opslaan mag nog zonder lookup */
    } finally {
      setLookupBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Laatste poging als adres nog leeg is
      if ((!straat.trim() || !plaats.trim()) && postcode && huisnummer) {
        await lookupAdres();
      }

      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          naam,
          email,
          telefoon,
          postcode,
          huisnummer,
          straat: straat.trim() || undefined,
          plaats: plaats.trim() || undefined,
          adviseur_id: defaultAdviseurId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      reset();
      onCreated(data.lead as Lead);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-toevoegen-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="w-full max-w-md border border-line bg-white shadow-lg max-sm:max-h-[90dvh] max-sm:overflow-y-auto">
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2
              id="lead-toevoegen-title"
              className="font-display text-lg font-semibold text-green-deeper"
            >
              Lead toevoegen
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Vul postcode + huisnummer in — straat en plaats worden automatisch
              aangevuld.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-muted hover:text-ink disabled:opacity-50"
            aria-label="Sluiten"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3 p-5">
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Naam *
            <input
              required
              autoFocus
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Tel
            <input
              type="tel"
              value={telefoon}
              onChange={(e) => setTelefoon(e.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            />
          </label>
          <div className="grid grid-cols-[1fr_100px] gap-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Postcode
              <input
                value={postcode}
                onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                onBlur={() => void lookupAdres()}
                placeholder="1234 AB"
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Huisnr
              <input
                value={huisnummer}
                onChange={(e) => setHuisnummer(e.target.value)}
                onBlur={() => void lookupAdres()}
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              />
            </label>
          </div>
          <div className="grid grid-cols-[1fr_1fr] gap-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Straat
              <input
                value={straat}
                onChange={(e) => setStraat(e.target.value)}
                placeholder={lookupBusy ? "Zoeken…" : "Automatisch"}
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Plaats
              <input
                value={plaats}
                onChange={(e) => setPlaats(e.target.value)}
                placeholder={lookupBusy ? "Zoeken…" : "Automatisch"}
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              />
            </label>
          </div>

          {error && (
            <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-wash disabled:opacity-60"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-orange px-4 py-2 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
            >
              {saving ? "Bezig…" : "Opslaan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
