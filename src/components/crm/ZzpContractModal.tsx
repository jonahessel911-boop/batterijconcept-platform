"use client";

import { useCallback, useEffect, useState } from "react";
import type { Adviseur } from "@/types/database";
import type { ZzpContractFields } from "@/lib/pdf-zzp-overeenkomst";

type Props = {
  adviseur: Adviseur;
  onClose: () => void;
  onChanged?: () => void;
};

function todayNl(): string {
  return new Date().toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Amsterdam",
  });
}

type Step = "form" | "sent" | "signed";

export function ZzpContractModal({ adviseur, onClose, onChanged }: Props) {
  const initialStep: Step =
    adviseur.contract_sign_status === "ondertekend" ||
    Boolean(adviseur.contract_bestandsnaam)
      ? "signed"
      : adviseur.contract_sign_status === "verzonden"
        ? "sent"
        : "form";

  const [step, setStep] = useState<Step>(initialStep);
  const [ingangsdatum, setIngangsdatum] = useState(todayNl);
  const [bedrijfsnaam, setBedrijfsnaam] = useState(
    adviseur.bedrijfsnaam || adviseur.naam || ""
  );
  const [contactpersoon, setContactpersoon] = useState(adviseur.naam || "");
  const [email, setEmail] = useState(adviseur.email || "");
  const [kvk, setKvk] = useState(adviseur.kvk_nummer || "");
  const [postcode, setPostcode] = useState(adviseur.factuur_postcode || "");
  const [huisnummer, setHuisnummer] = useState("");
  const [toevoeging, setToevoeging] = useState("");
  const [straat, setStraat] = useState(adviseur.factuur_adres || "");
  const [plaats, setPlaats] = useState(adviseur.factuur_plaats || "");
  const [iban, setIban] = useState(adviseur.iban || "");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [signUrl, setSignUrl] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const loadSignedPdf = useCallback(async () => {
    setPdfLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/relaties/adviseur/${adviseur.id}/contract`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "PDF laden mislukt"
        );
      }
      const url = (data as { url?: string | null }).url;
      if (!url) {
        throw new Error("Nog geen ondertekende PDF beschikbaar");
      }
      setPdfUrl(url);
      setStep("signed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF laden mislukt");
    } finally {
      setPdfLoading(false);
    }
  }, [adviseur.id]);

  useEffect(() => {
    if (initialStep === "signed") {
      void loadSignedPdf();
    }
  }, [initialStep, loadSignedPdf]);

  async function lookupAdres() {
    if (!postcode.trim() || !huisnummer.trim()) {
      setError("Vul postcode en huisnummer in.");
      return;
    }
    setLookupBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        postcode: postcode.trim(),
        number: huisnummer.trim(),
      });
      if (toevoeging.trim()) qs.set("toevoeging", toevoeging.trim());
      const res = await fetch(`/api/postcode?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Adres niet gevonden"
        );
      }
      const s = (data as { straat?: string }).straat || "";
      const p = (data as { plaats?: string }).plaats || "";
      const pc = (data as { postcode?: string }).postcode || postcode;
      const nr = (data as { huisnummer?: string }).huisnummer || huisnummer;
      const toe = (data as { toevoeging?: string | null }).toevoeging;
      setStraat([s, nr, toe].filter(Boolean).join(" "));
      setPlaats(p);
      setPostcode(pc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adres-lookup mislukt");
    } finally {
      setLookupBusy(false);
    }
  }

  async function send() {
    setError(null);
    setMsg(null);
    if (!bedrijfsnaam.trim()) {
      setError("Bedrijfsnaam is verplicht.");
      return;
    }
    if (!contactpersoon.trim()) {
      setError("Contactpersoon is verplicht.");
      return;
    }
    if (!email.trim()) {
      setError("E-mail is verplicht.");
      return;
    }
    if (!kvk.trim()) {
      setError("KvK-nummer is verplicht.");
      return;
    }
    if (!straat.trim() || !plaats.trim() || !postcode.trim()) {
      setError("Zoek eerst het adres via postcode + huisnummer.");
      return;
    }
    if (!iban.trim()) {
      setError("IBAN is verplicht.");
      return;
    }

    const today = todayNl();
    const fields: ZzpContractFields = {
      ingangsdatum: ingangsdatum.trim() || today,
      bc_naam: "BatterijConcept",
      bc_email: "info@batterijconcept.nl",
      adv_naam_onderneming: bedrijfsnaam.trim(),
      adv_handelsnaam: bedrijfsnaam.trim(),
      adv_adres: straat.trim(),
      adv_postcode_plaats: `${postcode.trim()} ${plaats.trim()}`.trim(),
      adv_kvk: kvk.trim(),
      adv_btw: "",
      adv_email: email.trim(),
      adv_iban: iban.trim(),
      adv_ondertekenaar: contactpersoon.trim(),
      adv_plaats_datum: "",
    };

    setBusy(true);
    try {
      const res = await fetch(
        `/api/relaties/adviseur/${adviseur.id}/contract/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields, send_email: true }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Versturen mislukt"
        );
      }
      setSignUrl((data as { sign_url?: string }).sign_url || null);
      const mailOk = (data as { mail?: { ok?: boolean } }).mail?.ok;
      setMsg(
        mailOk === false
          ? "Link aangemaakt, maar e-mail mislukt — kopieer de link hieronder."
          : "Verstuurd. De contactpersoon ontvangt een mail om te tekenen."
      );
      setStep("sent");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Versturen mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function refreshStatus() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/adviseurs");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("Status vernieuwen mislukt");
      const found = ((data.adviseurs || []) as Adviseur[]).find(
        (a) => a.id === adviseur.id
      );
      if (
        found &&
        (found.contract_sign_status === "ondertekend" ||
          found.contract_bestandsnaam)
      ) {
        await loadSignedPdf();
        onChanged?.();
        setMsg("Overeenkomst is ondertekend.");
      } else {
        setMsg("Nog niet ondertekend — stuur desnoods de link opnieuw.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vernieuwen mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function deleteContract() {
    if (
      !confirm(
        "Contract en ondertekenstatus verwijderen? Je kunt daarna opnieuw versturen."
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/relaties/adviseur/${adviseur.id}/contract`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Verwijderen mislukt"
        );
      }
      setPdfUrl(null);
      setSignUrl(null);
      setStep("form");
      setMsg("Contract verwijderd. Vul opnieuw in en verstuur.");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="zzp-contract-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex max-h-[94dvh] w-full max-w-2xl flex-col border border-line bg-white shadow-lg sm:max-h-[90dvh]">
        <div className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2
              id="zzp-contract-title"
              className="font-display text-lg font-semibold text-green-deeper"
            >
              Samenwerkingsovereenkomst
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {adviseur.naam}
              {adviseur.email ? ` · ${adviseur.email}` : ""}
            </p>
            <p className="mt-2">
              <span
                className={[
                  "inline-flex rounded px-2 py-0.5 text-[10px] font-semibold",
                  step === "signed"
                    ? "bg-green-soft text-green-dark"
                    : step === "sent"
                      ? "bg-[#FFF0E6] text-[#C45A12]"
                      : "bg-wash text-muted",
                ].join(" ")}
              >
                {step === "signed"
                  ? "Ondertekend"
                  : step === "sent"
                    ? "Wacht op handtekening"
                    : "Nog versturen"}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-muted hover:text-ink disabled:opacity-50"
            aria-label="Sluiten"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error ? (
            <p className="mb-3 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
              {error}
            </p>
          ) : null}
          {msg ? (
            <p className="mb-3 border border-green/30 bg-green-soft px-3 py-2 text-sm text-green-dark">
              {msg}
            </p>
          ) : null}

          {step === "form" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                1. Vul hier de bedrijfsgegevens in · 2. Verstuur · 3. Zij zetten
                alleen een handtekening · 4. De getekende PDF verschijnt hier.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-muted sm:col-span-2">
                  Ingangsdatum
                  <input
                    value={ingangsdatum}
                    onChange={(e) => setIngangsdatum(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block text-xs font-semibold text-muted sm:col-span-2">
                  Bedrijfsnaam
                  <input
                    value={bedrijfsnaam}
                    onChange={(e) => setBedrijfsnaam(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block text-xs font-semibold text-muted">
                  Contactpersoon
                  <input
                    value={contactpersoon}
                    onChange={(e) => setContactpersoon(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block text-xs font-semibold text-muted">
                  KvK-nummer
                  <input
                    value={kvk}
                    onChange={(e) => setKvk(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block text-xs font-semibold text-muted sm:col-span-2">
                  E-mail
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block text-xs font-semibold text-muted">
                  Postcode
                  <input
                    value={postcode}
                    onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                    placeholder="1234 AB"
                    className={inputCls}
                  />
                </label>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <label className="block text-xs font-semibold text-muted">
                    Huisnummer
                    <input
                      value={huisnummer}
                      onChange={(e) => setHuisnummer(e.target.value)}
                      className={inputCls}
                    />
                  </label>
                  <label className="block text-xs font-semibold text-muted">
                    Toev.
                    <input
                      value={toevoeging}
                      onChange={(e) => setToevoeging(e.target.value)}
                      className={inputCls}
                    />
                  </label>
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="button"
                    disabled={lookupBusy}
                    onClick={() => void lookupAdres()}
                    className="border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
                  >
                    {lookupBusy ? "Zoeken…" : "Zoek adres"}
                  </button>
                  {straat || plaats ? (
                    <p className="mt-2 text-sm font-medium text-ink">
                      {straat}
                      {plaats ? `, ${postcode} ${plaats}` : ""}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-muted">
                      Nog geen adres — vul postcode + huisnummer en zoek.
                    </p>
                  )}
                </div>
                <label className="block text-xs font-semibold text-muted sm:col-span-2">
                  IBAN
                  <input
                    value={iban}
                    onChange={(e) => setIban(e.target.value.toUpperCase())}
                    placeholder="NL00BANK0123456789"
                    className={inputCls}
                  />
                </label>
              </div>
            </div>
          ) : null}

          {step === "sent" ? (
            <div className="space-y-4">
              <div className="border border-line bg-wash px-4 py-3">
                <p className="text-sm font-semibold text-ink">
                  Mail is verstuurd
                </p>
                <p className="mt-1 text-sm text-muted">
                  {contactpersoon || "De contactpersoon"} opent de link, zet een
                  handtekening, en klaar. Klik hieronder op “Check of getekend”
                  om de PDF te laden.
                </p>
              </div>
              {signUrl ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Ondertekenlink
                  </p>
                  <a
                    href={signUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block break-all text-sm font-medium text-green-dark hover:underline"
                  >
                    {signUrl}
                  </a>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  Link is per e-mail verstuurd naar {email || adviseur.email}.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void refreshStatus()}
                  className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                >
                  {busy ? "Bezig…" : "Check of getekend"}
                </button>
                <button
                  type="button"
                  onClick={() => setStep("form")}
                  className="border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-wash"
                >
                  Gegevens aanpassen / opnieuw
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deleteContract()}
                  className="border border-[#C62828]/40 px-4 py-2 text-sm font-semibold text-[#C62828] hover:bg-[#FFEBEE] disabled:opacity-50"
                >
                  Verwijder contract
                </button>
              </div>
            </div>
          ) : null}

          {step === "signed" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Ondertekende overeenkomst inclusief handtekening.
              </p>
              {pdfLoading ? (
                <p className="text-sm text-muted">PDF laden…</p>
              ) : pdfUrl ? (
                <iframe
                  title="Ondertekende overeenkomst"
                  src={pdfUrl}
                  className="h-[min(60vh,520px)] w-full border border-line bg-wash"
                />
              ) : (
                <p className="text-sm text-muted">
                  PDF nog niet beschikbaar.{" "}
                  <button
                    type="button"
                    onClick={() => void loadSignedPdf()}
                    className="font-semibold text-green-dark underline"
                  >
                    Opnieuw laden
                  </button>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                {pdfUrl ? (
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex text-sm font-semibold text-green-dark hover:underline"
                  >
                    Open PDF in nieuw tabblad
                  </a>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deleteContract()}
                  className="border border-[#C62828]/40 px-3 py-1.5 text-xs font-semibold text-[#C62828] hover:bg-[#FFEBEE] disabled:opacity-50"
                >
                  Verwijder &amp; opnieuw versturen
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          <div>
            {step !== "form" ||
            adviseur.contract_sign_status === "verzonden" ||
            adviseur.contract_sign_status === "ondertekend" ||
            adviseur.contract_bestandsnaam ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void deleteContract()}
                className="text-xs font-semibold text-[#C62828] hover:underline disabled:opacity-50"
              >
                Contract verwijderen
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              className="border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-wash"
            >
              Sluiten
            </button>
            {step === "form" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void send()}
                className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
              >
                {busy ? "Bezig…" : "Verstuur ter ondertekening"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
