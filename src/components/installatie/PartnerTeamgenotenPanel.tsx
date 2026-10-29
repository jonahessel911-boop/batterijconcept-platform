"use client";

import { useCallback, useEffect, useState } from "react";
import type { InstallatiePartnerTeamgenoot } from "@/types/database";

type Props = {
  portalToken: string;
};

export function PartnerTeamgenotenPanel({ portalToken }: Props) {
  const [items, setItems] = useState<InstallatiePartnerTeamgenoot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [migrationHint, setMigrationHint] = useState<string | null>(null);

  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [telefoon, setTelefoon] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMigrationHint(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setItems((data.teamgenoten || []) as InstallatiePartnerTeamgenoot[]);
      if (data.migration_required && data.hint) {
        setMigrationHint(data.hint);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [portalToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addTeamgenoot(e: React.FormEvent) {
    e.preventDefault();
    if (!naam.trim()) return;
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            naam: naam.trim(),
            email: email.trim() || null,
            telefoon: telefoon.trim() || null,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Toevoegen mislukt");
      setNaam("");
      setEmail("");
      setTelefoon("");
      setOkMsg(`${data.teamgenoot.naam} toegevoegd`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toevoegen mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function setActief(id: string, actief: boolean) {
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, actief }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bijwerken mislukt");
      setItems((list) =>
        list.map((t) => (t.id === id ? { ...t, actief } : t))
      );
      setOkMsg(actief ? "Weer actief" : "Gedeactiveerd");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bijwerken mislukt");
    }
  }

  async function remove(id: string, naamLabel: string) {
    if (!window.confirm(`“${naamLabel}” verwijderen uit je team?`)) return;
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      setItems((list) => list.filter((t) => t.id !== id));
      setOkMsg("Verwijderd");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verwijderen mislukt");
    }
  }

  const actief = items.filter((t) => t.actief);
  const inactief = items.filter((t) => !t.actief);

  return (
    <div className="space-y-5">
      <section className="border border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-semibold text-ink">Team</h2>
          <p className="mt-0.5 text-sm text-muted">
            Monteurs onder jouw bedrijf — nodig voor afblokken per persoon.
          </p>
        </div>

        <form
          onSubmit={(e) => void addTeamgenoot(e)}
          className="grid gap-3 px-5 py-4 sm:grid-cols-3"
        >
          <label className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
            Naam *
            <input
              required
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green-deeper"
              placeholder="Bijv. Mohammed Ahmed"
            />
          </label>
          <label className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green-deeper"
              placeholder="Optioneel"
            />
          </label>
          <label className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
            Telefoon
            <input
              value={telefoon}
              onChange={(e) => setTelefoon(e.target.value)}
              className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green-deeper"
              placeholder="Optioneel"
            />
          </label>
          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={saving || !naam.trim()}
              className="bg-green-deeper px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
            >
              {saving ? "Bezig…" : "Toevoegen"}
            </button>
          </div>
        </form>
      </section>

      {migrationHint ? (
        <p className="border border-[#E8D48B] bg-[#FFFBEB] px-4 py-3 text-sm text-[#92400E]">
          {migrationHint}
        </p>
      ) : null}
      {error ? (
        <p className="border border-[#C45A12]/25 bg-[#FFF7F0] px-4 py-3 text-sm text-[#9A3412]">
          {error}
        </p>
      ) : null}
      {okMsg ? (
        <p className="border border-green/25 bg-green-soft px-4 py-3 text-sm text-green-dark">
          {okMsg}
        </p>
      ) : null}

      {loading ? (
        <p className="py-12 text-center text-sm text-muted">Laden…</p>
      ) : items.length === 0 ? (
        <div className="border border-line bg-white px-5 py-14 text-center">
          <p className="font-display text-base font-semibold text-ink">
            Nog geen monteurs
          </p>
          <p className="mt-1 text-sm text-muted">
            Voeg hierboven de eerste toe.
          </p>
        </div>
      ) : (
        <section className="border border-line bg-white">
          <ul className="divide-y divide-line">
            {actief.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{t.naam}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {[t.email, t.telefoon].filter(Boolean).join(" · ") ||
                      "Geen contactgegevens"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void setActief(t.id, false)}
                    className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-muted hover:bg-wash"
                  >
                    Deactiveren
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(t.id, t.naam)}
                    className="border border-[#C45A12]/30 bg-white px-3 py-1.5 text-xs font-semibold text-[#C45A12] hover:bg-[#FFF7F0]"
                  >
                    Verwijderen
                  </button>
                </div>
              </li>
            ))}
            {inactief.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 bg-[#FAFBFA] px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-muted line-through">
                    {t.naam}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">Inactief</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void setActief(t.id, true)}
                    className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                  >
                    Activeren
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(t.id, t.naam)}
                    className="border border-[#C45A12]/30 bg-white px-3 py-1.5 text-xs font-semibold text-[#C45A12] hover:bg-[#FFF7F0]"
                  >
                    Verwijderen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
