"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Afspraak } from "@/types/database";
import { formatDateTimeLongNl, formatDateTimeNl } from "@/lib/format";

type Slot = { start_at: string; end_at: string };

export function AfspraakManagePage() {
  const { token } = useParams<{ token: string }>();
  const [afspraak, setAfspraak] = useState<Afspraak | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"annuleer" | "verzet" | null>(null);
  const [mode, setMode] = useState<"view" | "verzet" | "annuleer">("view");
  const [newStart, setNewStart] = useState("");
  const [annuleerNotitie, setAnnuleerNotitie] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/afspraken/${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Niet gevonden");
      setAfspraak(data.afspraak);
      setSlots(data.slots || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  async function annuleer() {
    if (annuleerNotitie.trim().length < 3) {
      setError("Vul een reden in bij annuleren");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/afspraken/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "annuleer",
          notitie: annuleerNotitie.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Annuleren mislukt");
      setDone("annuleer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  async function verzet() {
    if (!newStart) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/afspraken/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verzet", start_at: newStart }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verzetten mislukt");
      setAfspraak(data.afspraak);
      setDone("verzet");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Shell>
        <p className="text-center text-sm text-muted">Afspraak laden…</p>
      </Shell>
    );
  }

  if (error && !afspraak) {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-semibold text-green-deeper">
          Afspraak niet gevonden
        </h1>
        <p className="mt-2 text-sm text-muted">{error}</p>
      </Shell>
    );
  }

  if (!afspraak) return null;

  if (done === "annuleer") {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-semibold text-green-deeper">
          Afspraak geannuleerd
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Je afspraak is geannuleerd. Wil je opnieuw plannen? Bel ons op 085 800
          1645 of mail info@batterijconcept.nl.
        </p>
      </Shell>
    );
  }

  if (done === "verzet") {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-semibold text-green-deeper">
          Afspraak verzet
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Je nieuwe tijd is bevestigd:
        </p>
        <p className="mt-2 text-base font-semibold text-ink">
          {formatDateTimeLongNl(afspraak.start_at)}
        </p>
      </Shell>
    );
  }

  const cancelled = afspraak.status === "geannuleerd";

  return (
    <Shell>
      <h1 className="font-display text-2xl font-semibold text-green-deeper">
        Jouw afspraak
      </h1>
      <div className="mt-6 rounded-xl border border-line bg-wash px-4 py-4">
        <p className="text-sm text-muted">Geplande tijd</p>
        <p className="mt-1 text-lg font-semibold text-ink">
          {formatDateTimeLongNl(afspraak.start_at)}
          <span className="text-muted"> (Europe/Amsterdam)</span>
        </p>
        <p className="mt-3 text-sm text-ink">
          <strong>Je afspraak is met</strong>
          <br />
          {afspraak.adviseurs?.naam || "Batterijconcept"}
        </p>
      </div>

      {cancelled ? (
        <p className="mt-6 text-sm text-muted">Deze afspraak is geannuleerd.</p>
      ) : mode === "view" ? (
        <div className="mt-8 space-y-3">
          <p className="text-sm text-muted">
            Liever afspraak verzetten of annuleren?
          </p>
          <button
            type="button"
            onClick={() => {
              setMode("verzet");
              setError(null);
            }}
            className="w-full bg-orange px-4 py-3 text-sm font-semibold text-white hover:bg-[#e0651c]"
          >
            Afspraak verzetten
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMode("annuleer");
              setError(null);
            }}
            className="w-full border border-line bg-white px-4 py-3 text-sm font-semibold text-muted hover:border-[#C45A12]/40 hover:text-[#C45A12]"
          >
            Afspraak annuleren
          </button>
        </div>
      ) : mode === "annuleer" ? (
        <div className="mt-8 space-y-3">
          <h2 className="font-display text-lg font-semibold text-ink">
            Afspraak annuleren
          </h2>
          <p className="text-sm text-muted">
            Laat even weten waarom je wilt annuleren — dat helpt ons.
          </p>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Reden
            <textarea
              value={annuleerNotitie}
              onChange={(e) => setAnnuleerNotitie(e.target.value)}
              rows={3}
              required
              placeholder="Bijv. tijdstip schikt niet, andere prioriteit…"
              className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
            />
          </label>
          {error && (
            <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy || annuleerNotitie.trim().length < 3}
            onClick={() => void annuleer()}
            className="w-full bg-[#C45A12] px-4 py-3 text-sm font-semibold text-white hover:bg-[#a84c0f] disabled:opacity-60"
          >
            {busy ? "Bezig…" : "Bevestig annulering"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("view");
              setAnnuleerNotitie("");
              setError(null);
            }}
            className="w-full border border-line px-4 py-2.5 text-sm text-muted"
          >
            ← Terug
          </button>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          <h2 className="font-display text-lg font-semibold text-ink">
            Kies een nieuw tijdslot
          </h2>
          <select
            value={newStart}
            onChange={(e) => setNewStart(e.target.value)}
            className="w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
          >
            <option value="">Beschikbare tijden…</option>
            {slots.map((s) => (
              <option key={s.start_at} value={s.start_at}>
                {formatDateTimeNl(s.start_at)}
              </option>
            ))}
          </select>
          {error && (
            <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy || !newStart}
            onClick={() => void verzet()}
            className="w-full bg-orange px-4 py-3 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
          >
            {busy ? "Bezig…" : "Bevestig nieuwe tijd"}
          </button>
          <button
            type="button"
            onClick={() => setMode("view")}
            className="w-full border border-line px-4 py-2.5 text-sm text-muted"
          >
            ← Terug
          </button>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="crm-bg min-h-screen px-4 py-10">
      <div className="mx-auto max-w-lg border border-line bg-white p-6 sm:p-8">
        <p className="font-display text-sm font-semibold text-green-dark">
          Batterijconcept
        </p>
        {children}
      </div>
    </div>
  );
}
