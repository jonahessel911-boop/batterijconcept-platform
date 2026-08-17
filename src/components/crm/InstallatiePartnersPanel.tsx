"use client";

import { useCallback, useEffect, useState } from "react";
import type { InstallatiePartner } from "@/types/database";

function portalBase(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "https://platform.batterijconcept.nl";
}

export function InstallatiePartnersPanel() {
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [telefoon, setTelefoon] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/installatie-partners?include_inactive=1");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setPartners(data.partners || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  async function addPartner(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/installatie-partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ naam, email, telefoon }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setNaam("");
      setEmail("");
      setTelefoon("");
      setOkMsg(`${data.partner.naam} is toegevoegd als installatiepartner.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActief(p: InstallatiePartner) {
    try {
      const res = await fetch("/api/installatie-partners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, actief: !p.actief }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bijwerken mislukt");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    }
  }

  function copyPortalLink(p: InstallatiePartner) {
    const url = `${portalBase()}/installatie/${p.portal_token}`;
    void navigator.clipboard.writeText(url).then(
      () => setOkMsg(`Portaallink gekopieerd voor ${p.naam}.`),
      () => setError("Kopiëren mislukt")
    );
  }

  return (
    <div className="border-t border-line">
      <div className="grid gap-0 lg:grid-cols-[340px_1fr]">
        <aside className="border-b border-line p-5 lg:border-b-0 lg:border-r">
          <h2 className="font-display text-base font-semibold text-ink">
            Installatiepartner toevoegen
          </h2>
          <p className="mt-1 text-xs text-muted">
            Partners ontvangen schouw-mails en zien hun orders in het
            installatieportaal.
          </p>

          <form onSubmit={addPartner} className="mt-4 space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Naam
              <input
                required
                value={naam}
                onChange={(e) => setNaam(e.target.value)}
                placeholder="Bijv. Installatie BV"
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              E-mail *
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="planning@partner.nl"
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Telefoon
              <input
                value={telefoon}
                onChange={(e) => setTelefoon(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
              />
            </label>

            {error && (
              <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                {error}
              </p>
            )}
            {okMsg && (
              <p className="border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
                {okMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
            >
              {saving ? "Bezig…" : "Partner toevoegen"}
            </button>
          </form>
        </aside>

        <div className="min-w-0 p-5">
          <h3 className="font-display text-sm font-semibold text-ink">
            Installatiepartners
          </h3>
          {loading ? (
            <p className="mt-6 text-sm text-muted">Laden…</p>
          ) : partners.length === 0 ? (
            <p className="mt-6 text-sm text-muted">
              Nog geen partners. Voeg links de eerste toe.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {partners.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-start justify-between gap-3 border border-line bg-white px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-ink">{p.naam}</p>
                    <p className="text-sm text-muted">{p.email}</p>
                    {p.telefoon && (
                      <p className="text-sm text-muted">{p.telefoon}</p>
                    )}
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {p.actief ? "Actief" : "Uit"}
                    </p>
                  </div>
                  <div className="flex flex-col items-start gap-1">
                    <button
                      type="button"
                      onClick={() => copyPortalLink(p)}
                      className="text-xs font-medium text-green-dark underline-offset-2 hover:underline"
                    >
                      Kopieer portaallink
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleActief(p)}
                      className="text-xs font-medium text-green-dark underline-offset-2 hover:underline"
                    >
                      {p.actief ? "Deactiveren" : "Activeren"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
