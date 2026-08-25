"use client";

import { useEffect, useState } from "react";
import type { Lead } from "@/types/database";
import { getSupabaseBrowser } from "@/lib/supabase";
import { normalizePostcode } from "@/lib/postcode";

export type AdresFields = {
  postcode: string;
  huisnummer: string;
  toevoeging: string;
  straat: string;
  plaats: string;
};

function fromLead(lead: Pick<
  Lead,
  "postcode" | "huisnummer" | "toevoeging" | "straat" | "plaats"
>): AdresFields {
  return {
    postcode: lead.postcode || "",
    huisnummer: lead.huisnummer || "",
    toevoeging: lead.toevoeging || "",
    straat: lead.straat || "",
    plaats: lead.plaats || "",
  };
}

export function LeadAdresEditor({
  lead,
  onSaved,
}: {
  lead: Lead;
  onSaved: (patch: Partial<Lead>) => void;
}) {
  const [draft, setDraft] = useState(() => fromLead(lead));
  const [lookupBusy, setLookupBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    setDraft(fromLead(lead));
    setError(null);
    setOkMsg(null);
  }, [
    lead.id,
    lead.postcode,
    lead.huisnummer,
    lead.toevoeging,
    lead.straat,
    lead.plaats,
  ]);

  const dirty =
    (draft.postcode.trim() || null) !== (lead.postcode || null) ||
    (draft.huisnummer.trim() || null) !== (lead.huisnummer || null) ||
    (draft.toevoeging.trim() || null) !== (lead.toevoeging || null) ||
    (draft.straat.trim() || null) !== (lead.straat || null) ||
    (draft.plaats.trim() || null) !== (lead.plaats || null);

  function setField<K extends keyof AdresFields>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    setOkMsg(null);
    setError(null);
  }

  async function lookupAdres() {
    const pc = draft.postcode.trim();
    const nr = draft.huisnummer.trim();
    if (!pc || !nr) {
      setError("Vul postcode en huisnummer in");
      return;
    }
    setLookupBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const qs = new URLSearchParams({
        postcode: pc,
        number: nr,
      });
      if (draft.toevoeging.trim()) {
        qs.set("toevoeging", draft.toevoeging.trim());
      }
      const res = await fetch(`/api/postcode?${qs}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Adres niet gevonden");
      }
      setDraft((d) => ({
        ...d,
        postcode: data.postcode
          ? normalizePostcode(String(data.postcode))
          : d.postcode,
        huisnummer: data.huisnummer ? String(data.huisnummer) : d.huisnummer,
        straat: data.straat || d.straat,
        plaats: data.plaats || d.plaats,
      }));
      setOkMsg("Adres opgehaald — controleer en sla op");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup mislukt");
    } finally {
      setLookupBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const patch: Partial<Lead> = {
        postcode: draft.postcode.trim()
          ? normalizePostcode(draft.postcode)
          : null,
        huisnummer: draft.huisnummer.trim() || null,
        toevoeging: draft.toevoeging.trim() || null,
        straat: draft.straat.trim() || null,
        plaats: draft.plaats.trim() || null,
      };
      const sb = getSupabaseBrowser();
      const { error: err } = await sb
        .from("leads")
        .update(patch)
        .eq("id", lead.id);
      if (err) throw err;
      onSaved(patch);
      setOkMsg("Adres opgeslagen");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "mt-1 w-full border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-green";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_72px_56px] gap-2">
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
          Postcode
          <input
            value={draft.postcode}
            onChange={(e) => setField("postcode", e.target.value.toUpperCase())}
            placeholder="1234 AB"
            className={inputClass}
            autoComplete="postal-code"
          />
        </label>
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
          Nr
          <input
            value={draft.huisnummer}
            onChange={(e) => setField("huisnummer", e.target.value)}
            className={inputClass}
            autoComplete="off"
          />
        </label>
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
          Toev.
          <input
            value={draft.toevoeging}
            onChange={(e) => setField("toevoeging", e.target.value)}
            placeholder="A"
            className={inputClass}
            autoComplete="off"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={lookupBusy || !draft.postcode.trim() || !draft.huisnummer.trim()}
        onClick={() => void lookupAdres()}
        className="w-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
      >
        {lookupBusy ? "Adres ophalen…" : "Adres ophalen"}
      </button>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
          Straat
          <input
            value={draft.straat}
            onChange={(e) => setField("straat", e.target.value)}
            className={inputClass}
            autoComplete="address-line1"
          />
        </label>
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
          Plaats
          <input
            value={draft.plaats}
            onChange={(e) => setField("plaats", e.target.value)}
            className={inputClass}
            autoComplete="address-level2"
          />
        </label>
      </div>

      {error && (
        <p className="text-xs text-[#C45A12]">{error}</p>
      )}
      {okMsg && !error && (
        <p className="text-xs text-green-dark">{okMsg}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={() => void save()}
          className="bg-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50"
        >
          {saving ? "Opslaan…" : "Adres opslaan"}
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
            className="border border-line bg-white px-3 py-1.5 text-xs font-medium text-muted hover:bg-wash"
          >
            Annuleren
          </button>
        )}
      </div>
    </div>
  );
}
