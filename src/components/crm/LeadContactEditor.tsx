"use client";

import { useEffect, useState } from "react";
import type { Lead } from "@/types/database";
import { getSupabaseBrowser } from "@/lib/supabase";

type ContactFields = {
  naam: string;
  email: string;
  telefoon: string;
};

function fromLead(lead: Pick<Lead, "naam" | "email" | "telefoon">): ContactFields {
  return {
    naam: lead.naam || "",
    email: lead.email || "",
    telefoon: lead.telefoon || "",
  };
}

const fieldLabel =
  "block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted";
const fieldInput =
  "mt-1.5 w-full border border-line bg-wash px-3 py-2.5 text-sm text-ink outline-none transition focus:border-green focus:bg-white";

export function LeadContactEditor({
  lead,
  onSaved,
}: {
  lead: Lead;
  onSaved: (patch: Partial<Lead>) => void;
}) {
  const [draft, setDraft] = useState(() => fromLead(lead));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    setDraft(fromLead(lead));
    setError(null);
    setOkMsg(null);
  }, [lead.id, lead.naam, lead.email, lead.telefoon]);

  const dirty =
    draft.naam.trim() !== (lead.naam || "") ||
    (draft.email.trim() || null) !== (lead.email || null) ||
    (draft.telefoon.trim() || null) !== (lead.telefoon || null);

  function setField<K extends keyof ContactFields>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    setOkMsg(null);
    setError(null);
  }

  async function save() {
    const naam = draft.naam.trim();
    if (!naam) {
      setError("Naam is verplicht");
      return;
    }
    const email = draft.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Ongeldig e-mailadres");
      return;
    }

    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const patch: Partial<Lead> = {
        naam,
        email: email || null,
        telefoon: draft.telefoon.trim() || null,
      };
      const sb = getSupabaseBrowser();
      const { error: err } = await sb
        .from("leads")
        .update(patch)
        .eq("id", lead.id);
      if (err) throw err;
      onSaved(patch);
      setOkMsg("Opgeslagen");
      void fetch(`/api/leads/${lead.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort: "contact",
          titel: "Contactgegevens aangepast",
          detail: [
            patch.naam !== lead.naam ? `Naam: ${patch.naam}` : null,
            patch.telefoon !== lead.telefoon
              ? `Tel: ${patch.telefoon || "—"}`
              : null,
            patch.email !== lead.email
              ? `E-mail: ${patch.email || "—"}`
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
        }),
      }).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className={fieldLabel}>
        Naam
        <input
          value={draft.naam}
          onChange={(e) => setField("naam", e.target.value)}
          className={fieldInput}
          autoComplete="name"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={fieldLabel}>
          E-mail
          <input
            type="email"
            value={draft.email}
            onChange={(e) => setField("email", e.target.value)}
            className={fieldInput}
            autoComplete="email"
          />
        </label>
        <label className={fieldLabel}>
          Telefoon
          <input
            type="tel"
            value={draft.telefoon}
            onChange={(e) => setField("telefoon", e.target.value)}
            className={fieldInput}
            autoComplete="tel"
          />
        </label>
      </div>

      {error && <p className="text-xs text-[#C45A12]">{error}</p>}
      {okMsg && !error && (
        <p className="text-xs text-green-dark">{okMsg}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={() => void save()}
          className={[
            "px-4 py-2 text-xs font-semibold transition",
            dirty
              ? "bg-orange text-white hover:bg-[#e0651c]"
              : "cursor-default border border-line bg-wash text-muted",
          ].join(" ")}
        >
          {saving ? "Opslaan…" : "Contact opslaan"}
        </button>
        {dirty && (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setDraft(fromLead(lead));
              setError(null);
              setOkMsg(null);
            }}
            className="border border-line bg-white px-3 py-2 text-xs font-medium text-muted hover:bg-wash"
          >
            Annuleren
          </button>
        )}
      </div>
    </div>
  );
}
