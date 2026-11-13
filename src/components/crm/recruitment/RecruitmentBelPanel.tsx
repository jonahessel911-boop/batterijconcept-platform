"use client";

import { useEffect, useMemo, useState } from "react";
import type { Sollicitatie } from "@/types/database";
import { formatDateTimeNl } from "@/lib/format";
import {
  normalizeSollicitatieStatus,
  SOLLICITATIE_STATUS_LABEL,
} from "@/lib/sollicitatie";
import {
  buildSollicitatieGeenContactPatch,
  sollicitatieBelpogingenOf,
  sollicitatieGeenContactLabel,
  sortSollicitatieBelQueue,
  SOLLICITATIE_MAX_BELPOGINGEN,
} from "@/lib/sollicitatie-bel";
import { provincieVanPostcode } from "@/lib/postcode-provincie";
import {
  enrichAntwoordRowsWithAdres,
  parseSollicitatieAntwoordRows,
} from "@/lib/sollicitatie-antwoorden";
import {
  extractAdresFromNotitie,
  mergeSollicitatieAdres,
} from "@/lib/sollicitatie-adres";
import { SollicitatieAntwoordenRows } from "@/components/crm/recruitment/SollicitatieAntwoordenRows";

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function adresOf(s: Sollicitatie) {
  return mergeSollicitatieAdres(
    {
      postcode: s.postcode || null,
      huisnummer: s.huisnummer || null,
      toevoeging: s.toevoeging || null,
      straat: s.straat || null,
      plaats: s.plaats || null,
    },
    extractAdresFromNotitie(s.notitie)
  );
}

function adresRegel(s: Sollicitatie) {
  const a = adresOf(s);
  const straat = [a.straat, a.huisnummer, a.toevoeging]
    .filter(Boolean)
    .join(" ")
    .trim();
  const plaats = [a.postcode, a.plaats].filter(Boolean).join(" ").trim();
  return [straat, plaats].filter(Boolean).join(", ");
}

export function RecruitmentBelPanel({
  kandidaten,
  onKandidaatUpdated,
  onOpenKandidaat,
  onPlanGesprek,
  advanceAfterPlanKey = 0,
}: {
  kandidaten: Sollicitatie[];
  onKandidaatUpdated: (updated: Sollicitatie) => void;
  onOpenKandidaat?: (id: string) => void;
  onPlanGesprek?: (id: string) => void;
  /** Verhoog na succesvol gesprek-plannen → dan pas volgende kandidaat. */
  advanceAfterPlanKey?: number;
}) {
  const queue = useMemo(
    () => sortSollicitatieBelQueue(kandidaten),
    [kandidaten]
  );
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [nextMode, setNextMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [lastAdvanceKey, setLastAdvanceKey] = useState(advanceAfterPlanKey);

  const current = queue[Math.min(index, Math.max(queue.length - 1, 0))] || null;
  const position = current
    ? queue.findIndex((k) => k.id === current.id) + 1
    : 0;
  const pogingen = current ? sollicitatieBelpogingenOf(current) : 0;
  const nextPoging = Math.min(pogingen + 1, SOLLICITATIE_MAX_BELPOGINGEN);
  const phone = current?.telefoon?.trim() || "";
  const currentAdres = current ? adresOf(current) : null;
  const provincie = currentAdres?.postcode
    ? provincieVanPostcode(currentAdres.postcode)
    : null;
  const antwoordRows = current
    ? enrichAntwoordRowsWithAdres(
        parseSollicitatieAntwoordRows(current.notitie),
        currentAdres || {},
        provincie && provincie !== "(onbekend)" ? provincie : null
      )
    : [];

  function resetQueueUi() {
    setNextMode(false);
    setNoteDraft("");
    setError(null);
  }

  /** Overslaan: volgende in de huidige volgorde. */
  function goNext() {
    resetQueueUi();
    setIndex((i) => {
      if (queue.length <= 1) return 0;
      return (i + 1) % queue.length;
    });
  }

  /** Na afboeking / ingepland gesprek: altijd weer de nieuwste vooraan. */
  function goNewest() {
    resetQueueUi();
    setIndex(0);
  }

  useEffect(() => {
    if (advanceAfterPlanKey <= 0) return;
    if (advanceAfterPlanKey === lastAdvanceKey) return;
    setLastAdvanceKey(advanceAfterPlanKey);
    goNewest();
    setMsg("Gesprek ingepland — volgende kandidaat");
    window.setTimeout(() => setMsg(null), 2800);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alleen reageren op nieuwe plan-key
  }, [advanceAfterPlanKey, lastAdvanceKey]);

  async function copyPhone(nummer: string) {
    try {
      await navigator.clipboard.writeText(nummer.replace(/[\s().-]/g, ""));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  async function addNotitie() {
    if (!current || !noteDraft.trim() || savingNote) return;
    setSavingNote(true);
    setError(null);
    try {
      const res = await fetch(`/api/instroom/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notitie_append: noteDraft.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Notitie mislukt");
      onKandidaatUpdated(data.sollicitatie as Sollicitatie);
      setNoteDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Notitie mislukt");
    } finally {
      setSavingNote(false);
    }
  }

  async function markGeenContact() {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const gc = buildSollicitatieGeenContactPatch(current);
      const res = await fetch(`/api/instroom/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...gc.patch,
          notitie_append: `Belpoging ${gc.pogingen}/${SOLLICITATIE_MAX_BELPOGINGEN} — geen contact`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      onKandidaatUpdated(data.sollicitatie as Sollicitatie);

      if (gc.sendGeenContactMail) {
        const mailRes = await fetch(
          `/api/instroom/${current.id}/geen-contact-mail`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ poging: gc.pogingen }),
          }
        );
        const mailData = await mailRes.json().catch(() => ({}));
        if (mailRes.ok && mailData.skipped) {
          setMsg(
            `${sollicitatieGeenContactLabel(gc.pogingen)} · geen e-mailadres`
          );
        } else if (mailRes.ok) {
          setMsg(
            `${sollicitatieGeenContactLabel(gc.pogingen)} · mail verstuurd`
          );
        } else {
          setMsg(
            `${sollicitatieGeenContactLabel(gc.pogingen)} · mailfout: ${mailData.error || "onbekend"}`
          );
        }
      } else {
        setMsg(sollicitatieGeenContactLabel(gc.pogingen));
      }

      window.setTimeout(() => setMsg(null), 3200);
      goNewest();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function markWelBereikt() {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = current.id;
      // Status nog niet wijzigen — pas na inplannen uit de bel-queue.
      // Zo blijf je op deze kandidaat tot het gesprek echt staat.
      const res = await fetch(`/api/instroom/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notitie_append: "Gebeld — wel bereikt, gesprek inplannen",
          laatst_gebeld_at: new Date().toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      onKandidaatUpdated(data.sollicitatie as Sollicitatie);
      setNextMode(false);
      onPlanGesprek?.(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function markDiskwalificatie() {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/instroom/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "diskwalificatie",
          notitie_append: "Gebeld — diskwalificatie",
          laatst_gebeld_at: new Date().toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      onKandidaatUpdated(data.sollicitatie as Sollicitatie);
      goNewest();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mislukt");
    } finally {
      setBusy(false);
    }
  }

  if (!current) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-line bg-[#F7FBF8] px-4 py-2 sm:px-5">
          <p className="text-xs text-muted">
            <span className="font-semibold text-ink">Recruitment bellen</span>
            <span className="ml-1.5">· 0 in wachtrij</span>
          </p>
        </div>
        <p className="px-4 py-16 text-center text-sm text-muted sm:px-6">
          Niemand om te bellen (Nieuw / Geen contact met telefoonnummer).
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-[#F7FBF8] px-4 py-2 sm:px-5">
        <p className="text-xs text-muted">
          <span className="font-semibold text-ink">Recruitment bellen</span>
          <span className="ml-1.5">
            · {queue.length} in wachtrij · nieuwste eerst · max{" "}
            {SOLLICITATIE_MAX_BELPOGINGEN}×
          </span>
        </p>
      </div>

      {(error || msg) && (
        <div
          className={[
            "shrink-0 border-b px-4 py-2 text-sm",
            error
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-900",
          ].join(" ")}
        >
          {error || msg}
        </div>
      )}

      <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
        <section className="flex min-h-0 flex-col border-b border-line lg:border-b-0 lg:border-r">
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {position > 0 ? position : "—"} van {queue.length} in de bellijst
              <span className="ml-2 font-normal normal-case tracking-normal">
                · nieuwste aanmeldingen eerst
              </span>
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {pogingen > 0 ||
              normalizeSollicitatieStatus(current.status) === "geen_contact" ? (
                <span className="rounded-full border border-[#C45A12]/30 bg-[#FFF0E6] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#C45A12]">
                  {sollicitatieGeenContactLabel(pogingen)}
                </span>
              ) : (
                <span className="rounded-full bg-green-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-green-dark">
                  Nieuw
                </span>
              )}
              {current.functie ? (
                <span className="rounded-full border border-line bg-wash px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                  {current.functie}
                </span>
              ) : null}
            </div>

            <h2 className="mt-3 font-display text-2xl font-semibold text-ink sm:text-3xl">
              <button
                type="button"
                onClick={() => onOpenKandidaat?.(current.id)}
                className="text-left hover:underline"
              >
                {current.naam}
              </button>
            </h2>
            <p className="mt-1 text-sm text-muted">
              Aangemeld {formatDateTimeNl(current.created_at)}
              {current.bron ? ` · ${current.bron}` : ""}
            </p>

            {phone ? (
              <div className="mt-3">
                <a
                  href={`tel:${phone.replace(/[\s().-]/g, "")}`}
                  className="block font-mono text-xl font-semibold tabular-nums text-ink underline-offset-2 hover:text-green-dark hover:underline sm:text-2xl"
                >
                  {phone}
                </a>
                <button
                  type="button"
                  onClick={() => void copyPhone(phone)}
                  className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 border border-green bg-white px-4 text-sm font-semibold text-green-dark hover:bg-green-soft"
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Gekopieerd" : "Copy phone"}
                </button>
              </div>
            ) : (
              <p className="mt-3 border border-dashed border-line px-3 py-3 text-center text-sm text-muted">
                Geen telefoonnummer
              </p>
            )}

            <div className="mt-4 border border-line bg-white px-3.5 py-3">
              <p className="text-sm text-ink">
                {adresRegel(current) || "Geen adres"}
              </p>
              {provincie ? (
                <p className="mt-1 text-xs text-muted">
                  Provincie:{" "}
                  <span className="font-semibold text-ink">{provincie}</span>
                </p>
              ) : null}
              <p className="mt-1 text-sm text-muted">
                {current.email?.trim() || "Geen e-mail"}
              </p>
              <p className="mt-1 text-xs text-muted">
                Status:{" "}
                {
                  SOLLICITATIE_STATUS_LABEL[
                    normalizeSollicitatieStatus(current.status)
                  ]
                }{" "}
                · belpoging {pogingen}/{SOLLICITATIE_MAX_BELPOGINGEN}
              </p>
            </div>

            {antwoordRows.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Antwoorden
                </p>
                <SollicitatieAntwoordenRows rows={antwoordRows} />
              </div>
            ) : current.notitie?.trim() ? (
              <div className="mt-4 border border-line bg-wash/40 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Notitie
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {current.notitie}
                </p>
              </div>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-line bg-white px-4 py-3 sm:px-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Notitie toevoegen
            </p>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={3}
              placeholder="Schrijf een notitie…"
              className="mt-2 w-full border border-line bg-white px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-green"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                disabled={savingNote || !noteDraft.trim()}
                onClick={() => void addNotitie()}
                className="bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
              >
                {savingNote ? "Opslaan…" : "Notitie toevoegen"}
              </button>
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col overflow-y-auto bg-wash/40 p-4 sm:p-5">
          <div className="lg:sticky lg:top-0">
            {!nextMode ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setNextMode(true);
                  setError(null);
                }}
                className="flex min-h-12 w-full items-center justify-center bg-orange px-4 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60 sm:min-h-14 sm:text-base"
              >
                Volgende
              </button>
            ) : (
              <div className="space-y-2 rounded-2xl border border-line bg-white p-4">
                <p className="text-sm font-semibold text-ink">Kies de status</p>
                <p className="text-xs text-muted">
                  Afboeken → volgende. Wel bereikt → eerst gesprek plannen,
                  daarna pas volgende.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void markGeenContact()}
                  className="flex min-h-12 w-full items-center justify-center bg-orange px-4 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
                >
                  {sollicitatieGeenContactLabel(nextPoging)}
                  {nextPoging >= SOLLICITATIE_MAX_BELPOGINGEN
                    ? " — definitief"
                    : nextPoging === 1 || nextPoging === 3
                      ? " + mail"
                      : ""}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void markWelBereikt()}
                  className="flex min-h-12 w-full items-center justify-center border border-green bg-green-soft px-4 text-sm font-semibold text-green-dark hover:bg-green/20 disabled:opacity-60"
                >
                  Wel bereikt — gesprek plannen
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void markDiskwalificatie()}
                  className="flex min-h-11 w-full items-center justify-center border border-line px-4 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-60"
                >
                  Diskwalificatie
                </button>
                <button
                  type="button"
                  disabled={busy || queue.length < 2}
                  onClick={goNext}
                  className="flex min-h-11 w-full items-center justify-center border border-line px-4 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-60"
                >
                  Overslaan
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setNextMode(false)}
                  className="flex min-h-10 w-full items-center justify-center text-sm font-medium text-muted hover:text-ink"
                >
                  Terug
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
