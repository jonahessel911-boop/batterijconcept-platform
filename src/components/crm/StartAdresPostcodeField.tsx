"use client";

import { useEffect, useState } from "react";
import { normalizePostcode } from "@/lib/postcode";
import {
  detectStartAdresLand,
  ensureStartAdresCountry,
  isUsableStartAdres,
  type StartAdresLand,
} from "@/lib/start-adres";

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
  land?: StartAdresLand;
}): string {
  const nr = [opts.huisnummer.trim(), opts.toevoeging?.trim()]
    .filter(Boolean)
    .join("");
  const street = [opts.straat.trim(), nr].filter(Boolean).join(" ");
  const pcRaw = opts.postcode.trim();
  const pc =
    opts.land === "BE"
      ? pcRaw.replace(/\s+/g, "")
      : pcRaw
        ? normalizePostcode(pcRaw)
        : "";
  const cityLine = [pc, opts.plaats.trim()].filter(Boolean).join(" ");
  const base = [street, cityLine].filter(Boolean).join(", ");
  return ensureStartAdresCountry(base, opts.land || "NL");
}

/**
 * Startadres via postcode + huisnummer (NL), of handmatig (NL/BE).
 * België: geen api-postcode.nl — volledig adres handmatig.
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
  const [land, setLand] = useState<StartAdresLand>(
    () => detectStartAdresLand(value) || "NL"
  );
  const [postcode, setPostcode] = useState("");
  const [huisnummer, setHuisnummer] = useState("");
  const [toevoeging, setToevoeging] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const detected = detectStartAdresLand(value);
    if (detected) setLand(detected);
  }, [value]);

  async function lookup() {
    if (land === "BE") {
      setErr(
        "Belgische postcodes kun je niet ophalen — vul het volledige adres hieronder in (straat nr, postcode plaats, België)."
      );
      return;
    }
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
        land: "NL",
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

  const usable = isUsableStartAdres(value);

  return (
    <div className="space-y-3">
      <div>
        <p className={fieldLabel}>Land vertrekpunt</p>
        <div className="mt-1 flex border border-line p-0.5">
          {(["NL", "BE"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => {
                setLand(l);
                setErr(null);
                setMsg(null);
                if (value.trim()) {
                  onChange(ensureStartAdresCountry(value, l));
                }
              }}
              className={[
                "flex-1 px-3 py-1.5 text-xs font-semibold sm:flex-none",
                land === l
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              {l === "NL" ? "Nederland" : "België"}
            </button>
          ))}
        </div>
      </div>

      {land === "NL" ? (
        <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(4.5rem,0.55fr)_minmax(4rem,0.45fr)_auto]">
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
            className="h-[42px] w-full shrink-0 border border-line bg-white px-3 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50 sm:mb-0 sm:w-auto"
          >
            {busy ? "…" : "Ophalen"}
          </button>
        </div>
      ) : (
        <p className="border border-line bg-wash/50 px-3 py-2 text-[11px] text-muted">
          Belgisch startadres: vul hieronder handmatig in, bijv.{" "}
          <span className="font-medium text-ink">
            Kerkstraat 12, 8300 Knokke-Heist, België
          </span>
          . Nodig voor juiste reistijd bij inplannen.
        </p>
      )}

      <label className={fieldLabel}>
        Startadres (reistijd)
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setMsg(null);
            setErr(null);
          }}
          onBlur={() => {
            if (value.trim()) {
              onChange(ensureStartAdresCountry(value, land));
            }
          }}
          placeholder={
            land === "BE"
              ? "Straat 12, 9000 Gent, België"
              : "Straat 12, 1234 AB Plaats, Nederland"
          }
          className={inputClassName}
          autoComplete="street-address"
        />
      </label>
      <p className="text-[11px] text-muted">
        Vertrekpunt bij inplannen (reistijd / Fast Direction). Op maandag
        start de eerste afspraak vanaf Daltonlaan 500, Utrecht
        (ochtendmeeting). Inclusief huisnummer + postcode.
      </p>
      {value.trim() && !usable ? (
        <p className="text-xs text-[#C45A12]">
          Adres is onvolledig voor reistijd — voeg huisnummer en postcode/plaats
          toe{land === "BE" ? " (en België)" : ""}.
        </p>
      ) : null}
      {err ? (
        <p className="text-xs text-[#C45A12]">{err}</p>
      ) : null}
      {msg ? <p className="text-xs text-green-dark">{msg}</p> : null}
    </div>
  );
}
