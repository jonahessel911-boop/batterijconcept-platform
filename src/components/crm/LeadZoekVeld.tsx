"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Lead } from "@/types/database";

function leadLabel(lead: Pick<Lead, "naam" | "lead_number">): string {
  return `${lead.naam} (${lead.lead_number})`;
}

export function LeadZoekVeld({
  value,
  onChange,
  suggestions = [],
}: {
  value: Lead | null;
  onChange: (lead: Lead | null) => void;
  suggestions?: Lead[];
}) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<Lead[]>([]);
  const [active, setActive] = useState(0);

  const searching = open && query.trim().length > 0;
  const results = searching ? hits : suggestions.slice(0, 12);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 1) {
      setHits([]);
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads?q=${encodeURIComponent(q)}`, {
          signal: ac.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Zoeken mislukt");
        setHits(data.leads || []);
        setActive(0);
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [query, open]);

  function pick(lead: Lead) {
    onChange(lead);
    setQuery("");
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setQuery("");
    setHits([]);
    setOpen(true);
  }

  return (
    <div ref={wrapRef} className="relative">
      <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
        Lead
      </span>
      <div className="relative mt-1">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="Typ een naam…"
          value={value && !query ? leadLabel(value) : query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (value) onChange(null);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            if (value) {
              setQuery("");
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            if (!open || results.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % results.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i - 1 + results.length) % results.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              const hit = results[active];
              if (hit) pick(hit);
            }
          }}
          className="w-full border border-line bg-white px-3 py-2.5 pr-9 text-sm text-ink outline-none focus:border-green sm:py-2"
        />
        {value && !open && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted hover:text-ink"
            aria-label="Lead wissen"
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto border border-line bg-white shadow-sm"
        >
          {searching && loading && results.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-muted">Zoeken…</li>
          )}
          {searching && !loading && results.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-muted">
              Geen leads gevonden
            </li>
          )}
          {!searching && results.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-muted">
              Typ een naam om te zoeken
            </li>
          )}
          {results.map((lead, i) => (
            <li key={lead.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(lead)}
                className={[
                  "flex w-full flex-col px-3 py-2 text-left",
                  i === active ? "bg-green-soft" : "hover:bg-wash",
                ].join(" ")}
              >
                <span className="text-sm font-semibold text-ink">
                  {lead.naam}
                </span>
                <span className="text-xs text-muted">
                  {lead.lead_number}
                  {lead.plaats ? ` · ${lead.plaats}` : ""}
                  {lead.telefoon ? ` · ${lead.telefoon}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
