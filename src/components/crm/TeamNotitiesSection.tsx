"use client";

import { useMemo, useState } from "react";
import {
  appendStampedNotitie,
  parseProjectNotitieEntries,
} from "@/lib/lead-notitie";
import { formatDateTimeNl } from "@/lib/format";

type Props = {
  /** Huidige opgeslagen notities */
  value: string | null | undefined;
  authorNaam?: string | null;
  disabled?: boolean;
  /**
   * Direct opslaan via API (aanbevolen).
   * Ontvangt de volledige nieuwe notitie-string.
   */
  onSave: (next: string) => Promise<void>;
};

export function TeamNotitiesSection({
  value,
  authorNaam,
  disabled = false,
  onSave,
}: Props) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = useMemo(
    () => parseProjectNotitieEntries(value),
    [value]
  );

  async function addNote() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const next = appendStampedNotitie(value, text, new Date(), authorNaam);
      await onSave(next);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border border-line bg-wash/40 px-3 py-3 sm:px-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Interne notities
        </p>
        <p className="mt-0.5 text-[11px] text-muted">
          Alleen voor het team — bijv. te laat, laptop vergeten, gesprekken.
        </p>
      </div>

      <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
        Nieuwe notitie
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          disabled={disabled || busy}
          placeholder="Wat is er gebeurd?"
          className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green disabled:opacity-60"
        />
      </label>
      <button
        type="button"
        disabled={disabled || busy || !draft.trim()}
        onClick={() => void addNote()}
        className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
      >
        {busy ? "Opslaan…" : "Notitie toevoegen"}
      </button>

      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-xs text-muted">Nog geen notities.</p>
      ) : (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {[...entries].reverse().map((e, i) => (
            <li
              key={`${e.at}-${i}`}
              className="border border-line bg-white px-3 py-2"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                {formatDateTimeNl(e.at)}
                {e.author ? ` · ${e.author}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                {e.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
