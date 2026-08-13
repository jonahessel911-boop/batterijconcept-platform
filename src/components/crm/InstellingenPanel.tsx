"use client";

import { useCallback, useEffect, useState } from "react";
import type { Adviseur } from "@/types/database";

export function InstellingenPanel({
  onAdviseursChange,
}: {
  onAdviseursChange?: () => void;
}) {
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
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
      const res = await fetch("/api/adviseurs?include_inactive=1");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setAdviseurs(data.adviseurs || []);
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

  async function addPerson(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/adviseurs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ naam, email, telefoon }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setNaam("");
      setEmail("");
      setTelefoon("");
      setOkMsg(
        data.mail_sent
          ? `${data.adviseur.naam} is toegevoegd — welkomstmail met wachtwoord verstuurd.`
          : `${data.adviseur.naam} is toegevoegd${data.mail_error ? ` (mail mislukt: ${data.mail_error})` : ""}.`
      );
      await load();
      onAdviseursChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActief(a: Adviseur) {
    setError(null);
    try {
      const res = await fetch("/api/adviseurs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id, actief: !a.actief }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bijwerken mislukt");
      await load();
      onAdviseursChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    }
  }

  async function resendInvite(a: Adviseur) {
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/adviseurs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id, resend_invite: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Uitnodiging mislukt");
      setOkMsg(
        data.mail_sent
          ? `Nieuw wachtwoord gemaild naar ${a.email}.`
          : `Wachtwoord gezet, maar mail mislukt${data.mail_error ? `: ${data.mail_error}` : ""}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    }
  }

  async function saveRow(a: Adviseur, patch: Partial<Adviseur>) {
    setError(null);
    try {
      const res = await fetch("/api/adviseurs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bijwerken mislukt");
      await load();
      onAdviseursChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    }
  }

  return (
    <div className="grid gap-0 lg:grid-cols-[340px_1fr]">
      <aside className="border-b border-line p-5 lg:border-b-0 lg:border-r">
        <h2 className="font-display text-base font-semibold text-ink">
          Teamlid toevoegen
        </h2>
        <p className="mt-1 text-xs text-muted">
          Elk teamlid krijgt een eigen agenda, leads en sales. Na toevoegen
          ontvangt diegene een welkomstmail met inlogwachtwoord.
        </p>

        <form onSubmit={addPerson} className="mt-4 space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Naam
            <input
              required
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              placeholder="Bijv. Jona"
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            E-mail *
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="naam@batterijconcept.nl"
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Telefoon
            <input
              value={telefoon}
              onChange={(e) => setTelefoon(e.target.value)}
              placeholder="06 …"
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
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
            {saving ? "Bezig…" : "Toevoegen"}
          </button>
        </form>
      </aside>

      <div className="min-w-0">
        {loading ? (
          <p className="px-6 py-14 text-center text-sm text-muted">Laden…</p>
        ) : adviseurs.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-muted">
            Nog geen teamleden. Voeg links de eerste toe.
          </p>
        ) : (
          <>
            <div className="crm-card-list flex md:hidden">
              {adviseurs.map((a) => (
                <article key={a.id} className="crm-card space-y-2">
                  <input
                    defaultValue={a.naam}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== a.naam) void saveRow(a, { naam: v });
                    }}
                    className="w-full border border-line bg-white px-3 py-2.5 font-medium text-ink outline-none focus:border-green"
                    aria-label="Naam"
                  />
                  <input
                    defaultValue={a.email || ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim() || null;
                      if (v !== a.email) void saveRow(a, { email: v });
                    }}
                    className="w-full border border-line bg-white px-3 py-2.5 text-muted outline-none focus:border-green"
                    placeholder="E-mail"
                    aria-label="E-mail"
                  />
                  <input
                    defaultValue={a.telefoon || ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim() || null;
                      if (v !== a.telefoon) void saveRow(a, { telefoon: v });
                    }}
                    className="w-full border border-line bg-white px-3 py-2.5 text-muted outline-none focus:border-green"
                    placeholder="Telefoon"
                    aria-label="Telefoon"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span
                      className={
                        a.actief
                          ? "text-[11px] font-semibold uppercase tracking-wide text-green-dark"
                          : "text-[11px] font-semibold uppercase tracking-wide text-muted"
                      }
                    >
                      {a.actief ? "Actief" : "Uit"}
                    </span>
                    <div className="flex gap-3">
                      {a.email && (
                        <button
                          type="button"
                          onClick={() => void resendInvite(a)}
                          className="min-h-10 text-sm font-medium text-green-dark underline-offset-2 hover:underline"
                        >
                          Stuur loginmail
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void toggleActief(a)}
                        className="min-h-10 text-sm font-medium text-green-dark underline-offset-2 hover:underline"
                      >
                        {a.actief ? "Deactiveren" : "Activeren"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden md:block">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Naam</th>
                    <th>E-mail</th>
                    <th>Telefoon</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {adviseurs.map((a) => (
                    <tr key={a.id} className="cursor-default">
                      <td>
                        <input
                          defaultValue={a.naam}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v && v !== a.naam) void saveRow(a, { naam: v });
                          }}
                          className="w-full border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-ink outline-none hover:border-line focus:border-green"
                        />
                      </td>
                      <td>
                        <input
                          defaultValue={a.email || ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            if (v !== a.email) void saveRow(a, { email: v });
                          }}
                          className="w-full border border-transparent bg-transparent px-1 py-0.5 text-sm text-muted outline-none hover:border-line focus:border-green"
                        />
                      </td>
                      <td>
                        <input
                          defaultValue={a.telefoon || ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            if (v !== a.telefoon)
                              void saveRow(a, { telefoon: v });
                          }}
                          className="w-full border border-transparent bg-transparent px-1 py-0.5 text-sm text-muted outline-none hover:border-line focus:border-green"
                        />
                      </td>
                      <td>
                        <span
                          className={
                            a.actief
                              ? "text-[11px] font-semibold uppercase tracking-wide text-green-dark"
                              : "text-[11px] font-semibold uppercase tracking-wide text-muted"
                          }
                        >
                          {a.actief ? "Actief" : "Uit"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          {a.email && (
                            <button
                              type="button"
                              onClick={() => void resendInvite(a)}
                              className="text-xs font-medium text-green-dark underline-offset-2 hover:underline"
                            >
                              Stuur loginmail
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void toggleActief(a)}
                            className="text-xs font-medium text-green-dark underline-offset-2 hover:underline"
                          >
                            {a.actief ? "Deactiveren" : "Activeren"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
