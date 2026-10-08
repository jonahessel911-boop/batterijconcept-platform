"use client";

import { useState } from "react";
import { normalizePostcode } from "@/lib/postcode";

const fieldLabel =
  "block text-[10px] font-semibold uppercase tracking-wide text-muted";
const fieldInput =
  "mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green";

/** Bouw een adresregel zoals reistijd/Maps die verwacht. */
export function composeStartAdres(opts: {
  straat: string;
  huisnummer: string;
  toevoeging?: string;
  postcode: string;
  plaats: string;
}): string {
  const nr = [opts.huisnummer.trim(), opts.toevoeging?.trim()]
    .filter(Boolean)
    .join("");
  const street = [opts.straat.trim(), nr].filter(Boolean).join(" ");
  const pc = opts.postcode.trim()
    ? normalizePostcode(opts.postcode)
    : "";
  const cityLine = [pc, opts.plaats.trim()].filter(Boolean).join(" ");
  return [street, cityLine].filter(Boolean).join(", ");
}

/**
 * Startadres via postcode + huisnummer ophalen (api-postcode.nl),
 * of handmatig de volledige regel zetten.
 */
export function StartAdresPostcodeField({
  value,
  onChange,
  inputClassName = fieldInput,
}: {
  value: string;
  onChange: (next: string) => void;
  inputClassName?: string;
}) {
  const [postcode, setPostcode] = useState("");
  const [huisnummer, setHuisnummer] = useState("");
  const [toevoeging, setToevoeging] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function lookup() {
    const pc = postcode.trim();
    const nr = huisnummer.trim();
    if (!pc || !nr) {
      setErr("Vul postcode en huisnummer in");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const qs = new URLSearchParams({
        postcode: pc,
        number: nr,
      });
      if (toevoeging.trim()) qs.set("toevoeging", toevoeging.trim());
      const res = await fetch(`/api/postcode?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Adres niet gevonden"
        );
      }
      const composed = composeStartAdres({
        straat: String((data as { straat?: string }).straat || ""),
        huisnummer: String(
          (data as { huisnummer?: string }).huisnummer || nr
        ),
        toevoeging: toevoeging.trim(),
        postcode: String((data as { postcode?: string }).postcode || pc),
        plaats: String((data as { plaats?: string }).plaats || ""),
      });
      if (!composed) throw new Error("Adres niet gevonden");
      onChange(composed);
      setMsg("Adres opgehaald — controleer en sla op");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lookup mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(4.5rem,0.55fr)_minmax(4rem,0.45fr)_auto] items-end gap-2">
        <label className={fieldLabel}>
          Postcode
          <input
            value={postcode}
            onChange={(e) => {
              setPostcode(e.target.value.toUpperCase());
              setErr(null);
              setMsg(null);
            }}
            placeholder="1234 AB"
            className={inputClassName}
            autoComplete="postal-code"
          />
        </label>
        <label className={fieldLabel}>
          Nr
          <input
            value={huisnummer}
            onChange={(e) => {
              setHuisnummer(e.target.value);
              setErr(null);
              setMsg(null);
            }}
            className={inputClassName}
            autoComplete="off"
          />
        </label>
        <label className={fieldLabel}>
          Toev.
          <input
            value={toevoeging}
            onChange={(e) => {
              setToevoeging(e.target.value);
              setErr(null);
              setMsg(null);
            }}
            placeholder="A"
            className={inputClassName}
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          disabled={busy || !postcode.trim() || !huisnummer.trim()}
          onClick={() => void lookup()}
          className="mb-0 h-[42px] shrink-0 border border-line bg-white px-3 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
        >
          {busy ? "…" : "Ophalen"}
        </button>
      </div>

      <label className={fieldLabel}>
        Startadres (reistijd)
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setMsg(null);
            setErr(null);
          }}
          placeholder="Straat 12, 1234 AB Plaats"
          className={inputClassName}
          autoComplete="street-address"
        />
      </label>
      <p className="text-[11px] text-muted">
        Wordt gebruikt als vertrekpunt bij het inplannen van afspraken
        (reistijd / Fast Direction).
      </p>
      {err ? (
        <p className="text-xs text-[#C45A12]">{err}</p>
      ) : null}
      {msg ? <p className="text-xs text-green-dark">{msg}</p> : null}
    </div>
  );
}
