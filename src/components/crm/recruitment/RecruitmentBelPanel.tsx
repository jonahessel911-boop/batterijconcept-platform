"use client";

import { useEffect, useMemo, useState } from "react";
import type { Sollicitatie, SollicitatieAfspraak } from "@/types/database";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import {
  AMSTERDAM_TZ,
  formatDateTimeNl,
  formatTimeNl,
} from "@/lib/format";
import {
  normalizeSollicitatieStatus,
  SOLLICITATIE_STATUS_LABEL,
  sollicitatieHeeftInfoToegestuurd,
} from "@/lib/sollicitatie";
import {
  blockedSollicitatieContactKeys,
  mergeBlockedContactKeys,
  buildSollicitatieGeenContactPatch,
  isSollicitatieTerugbelDue,
  listSollicitatieTerugbels,
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
import { RecruitmentKandidaatMailModal } from "@/components/crm/recruitment/RecruitmentKandidaatMailModal";

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

function defaultTerugbelLocal(): string {
  const now = new Date();
  const inHalfUur = new Date(now.getTime() + 30 * 60 * 1000);
  const stamp = formatInTimeZone(
    inHalfUur,
    AMSTERDAM_TZ,
    "yyyy-MM-dd'T'HH:mm"
  );
  return stamp;
}

function datetimeLocalToIso(value: string): string {
  const stamp = value.length === 16 ? `${value}:00` : value;
  return fromZonedTime(stamp, AMSTERDAM_TZ).toISOString();
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
  alleKandidaten,
  afspraken = [],
  leadContactKeys = [],
  onKandidaatUpdated,
  onOpenKandidaat,
  onPlanGesprek,
  advanceAfterPlanKey = 0,
}: {
  kandidaten: Sollicitatie[];
  /** Volledige lijst — duplicaten met een gesprek herkennen. */
  alleKandidaten?: Sollicitatie[];
  afspraken?: SollicitatieAfspraak[];
  /** Sales-leads met hetzelfde nummer/mail — niet opnieuw in recruitment bellen. */
  leadContactKeys?: string[];
  onKandidaatUpdated: (updated: Sollicitatie) => void;
  onOpenKandidaat?: (id: string) => void;
  onPlanGesprek?: (id: string) => void;
  /** Verhoog na succesvol gesprek-plannen → dan pas volgende kandidaat. */
  advanceAfterPlanKey?: number;
}) {
  const [skippedIds, setSkippedIds] = useState(() => new Set<string>());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const queue = useMemo(() => {
    const ctx = mergeBlockedContactKeys(
      blockedSollicitatieContactKeys(
        alleKandidaten && alleKandidaten.length > 0
          ? alleKandidaten
          : kandidaten,
        afspraken
      ),
      leadContactKeys
    );
    return sortSollicitatieBelQueue(kandidaten, ctx).filter(
      (k) => !skippedIds.has(k.id)
    );
  }, [kandidaten, alleKandidaten, afspraken, leadContactKeys, skippedIds]);
  const terugbels = useMemo(
    () =>
      listSollicitatieTerugbels(
        alleKandidaten && alleKandidaten.length > 0
          ? alleKandidaten
          : kandidaten
      ),
    [kandidaten, alleKandidaten]
  );
  const [busy, setBusy] = useState(false);
  const [nextMode, setNextMode] = useState<false | "status" | "terugbel">(
    false
  );
  const [terugbelAt, setTerugbelAt] = useState("");
  const [terugbelNotitie, setTerugbelNotitie] = useState("");
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [lastAdvanceKey, setLastAdvanceKey] = useState(advanceAfterPlanKey);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailTemplateId, setMailTemplateId] = useState("ontvangen_sollicitatie");

  const current =
    (currentId ? queue.find((k) => k.id === currentId) : null) ||
    queue[0] ||
    null;
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
    setTerugbelNotitie("");
    setError(null);
  }

  function pickAfter(excludeId: string | null | undefined) {
    resetQueueUi();
    const next = queue.find((k) => k.id !== excludeId) || null;
    setCurrentId(next?.id ?? null);
  }

  /** Overslaan: deze kandidaat uit de bel-sessie, volgende tonen. */
  function goNext() {
    if (!current) return;
    const skipId = current.id;
    pickAfter(skipId);
    setSkippedIds((prev) => {
      const next = new Set(prev);
      next.add(skipId);
      return next;
    });
  }

  /** Na uitkomst: volgende (niet dezelfde). */
  function goNewest() {
    pickAfter(current?.id);
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
          terugbel_at: null,
          terugbel_notitie: null,
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

  async function markGeenInteresse() {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/instroom/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "geen_interesse",
          notitie_append: "Gebeld — geen interesse",
          laatst_gebeld_at: new Date().toISOString(),
          terugbel_at: null,
          terugbel_notitie: null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      onKandidaatUpdated(data.sollicitatie as Sollicitatie);
      setMsg("Geen interesse");
      window.setTimeout(() => setMsg(null), 2800);
      goNewest();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function planTerugbel(e: React.FormEvent) {
    e.preventDefault();
    if (!current || busy) return;
    if (!terugbelAt) {
      setError("Kies datum en tijd");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const iso = datetimeLocalToIso(terugbelAt);
      const note = terugbelNotitie.trim();
      const res = await fetch(`/api/instroom/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "terugbelafspraak",
          terugbel_at: iso,
          terugbel_notitie: note || null,
          laatst_gebeld_at: new Date().toISOString(),
          notitie_append: note
            ? `Terugbelafspraak ${terugbelAt.replace("T", " ")} — ${note}`
            : `Terugbelafspraak ${terugbelAt.replace("T", " ")}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      onKandidaatUpdated(data.sollicitatie as Sollicitatie);
      setMsg("Terugbelafspraak gezet — staat bovenaan tot je belt");
      window.setTimeout(() => setMsg(null), 3200);
      goNewest();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mislukt");
    } finally {
      setBusy(false);
    }
  }

  const terugbelBanner =
    terugbels.length > 0 ? (
      <div className="border-b border-[#C45A12]/25 bg-[#FFF8F3] px-4 py-2.5 sm:px-5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C45A12]">
          Terugbellen ({terugbels.length}) — klik naar kandidaat
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {terugbels.map((s) => {
            const due = isSollicitatieTerugbelDue(s);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenKandidaat?.(s.id)}
                className={[
                  "inline-flex max-w-full items-center gap-2 border px-2.5 py-1 text-left text-xs transition",
                  due
                    ? "border-[#C45A12]/35 bg-white text-ink hover:border-[#C45A12]"
                    : "border-line bg-white text-muted hover:border-[#C45A12]/40 hover:text-ink",
                ].join(" ")}
              >
                <span
                  className={[
                    "shrink-0 font-bold tabular-nums",
                    due ? "text-[#C45A12]" : "text-muted",
                  ].join(" ")}
                >
                  {s.terugbel_at ? formatTimeNl(s.terugbel_at) : "—"}
                </span>
                <span className="truncate font-medium">{s.naam}</span>
              </button>
            );
          })}
        </div>
      </div>
    ) : null;

  if (!current) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {terugbelBanner}
        <div className="border-b border-line bg-[#F7FBF8] px-4 py-2 sm:px-5">
          <p className="text-xs text-muted">
            <span className="font-semibold text-ink">Recruitment bellen</span>
            <span className="ml-1.5">· 0 in wachtrij</span>
          </p>
        </div>
        <p className="px-4 py-16 text-center text-sm text-muted sm:px-6">
          Niemand om te bellen (Nieuw / Geen contact met telefoonnummer).
          Openstaande terugbelafspraken staan hierboven — klik om naar de
          kandidaat te gaan.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {terugbelBanner}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-[#F7FBF8] px-4 py-2 sm:px-5">
        <p className="text-xs text-muted">
          <span className="font-semibold text-ink">Recruitment bellen</span>
          <span className="ml-1.5">
            · {queue.length} in wachtrij · eerst nog niet gebeld · max{" "}
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:border-r">
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {position > 0 ? position : "—"} van {queue.length} in de bellijst
              <span className="ml-2 font-normal normal-case tracking-normal">
                · eerst iedereen die nog niet gebeld is
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
              {current.email?.trim() ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMailTemplateId("ontvangen_sollicitatie");
                      setMailOpen(true);
                    }}
                    className="text-left text-sm font-medium text-green-dark underline-offset-2 hover:underline"
                  >
                    {current.email.trim()}
                  </button>
                  {sollicitatieHeeftInfoToegestuurd(current.notitie) ? (
                    <span className="rounded-md bg-green-soft px-2.5 py-1 text-[11px] font-semibold text-green-dark">
                      Info toegestuurd
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setMailTemplateId("info_toegestuurd");
                        setMailOpen(true);
                      }}
                      className="rounded-md border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-wash"
                    >
                      Info toesturen
                    </button>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted">Geen e-mail</p>
              )}
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

            {(current.sollicitatie_bestanden || []).length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Bestanden
                </p>
                <ul className="divide-y divide-line border border-line bg-white">
                  {(current.sollicitatie_bestanden || []).map((file) => (
                    <li key={file.id} className="px-3 py-2">
                      <a
                        href={`/api/instroom/${current.id}/files/${file.id}`}
                        download={file.bestandsnaam || "cv.pdf"}
                        className="text-sm font-semibold text-green-dark underline-offset-2 hover:underline"
                      >
                        {file.bestandsnaam || "Download CV"}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {antwoordRows.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Antwoorden
                </p>
                <SollicitatieAntwoordenRows
                  rows={antwoordRows}
                  sollicitatieId={current.id}
                  bestanden={current.sollicitatie_bestanden || []}
                />
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

        <aside className="flex max-h-[48vh] shrink-0 flex-col overflow-y-auto border-t border-line bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-5 lg:max-h-none lg:border-t-0 lg:bg-wash/40">
          <div className="lg:sticky lg:top-0">
            {!nextMode ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setNextMode("status");
                  setError(null);
                }}
                className="flex min-h-12 w-full items-center justify-center bg-orange px-4 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60 sm:min-h-14 sm:text-base"
              >
                Volgende
              </button>
            ) : nextMode === "status" ? (
              <div className="space-y-2 rounded-2xl border border-line bg-white p-4">
                <p className="text-sm font-semibold text-ink">Kies de status</p>
                <p className="text-xs text-muted">
                  Geen contact → eerst de rest bellen. Wel bereikt → eerst
                  gesprek plannen. Wie al een gesprek heeft (ook een andere
                  aanmelding met hetzelfde nummer) komt hier niet in.
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
                  onClick={() => void markGeenInteresse()}
                  className="flex min-h-11 w-full items-center justify-center border border-line bg-[#F3F4F6] px-4 text-sm font-semibold text-[#4B5563] hover:bg-[#E5E7EB] disabled:opacity-60"
                >
                  Geen interesse
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
                  onClick={() => {
                    setTerugbelAt(defaultTerugbelLocal());
                    setTerugbelNotitie("");
                    setNextMode("terugbel");
                    setError(null);
                  }}
                  className="flex min-h-12 w-full items-center justify-center border border-[#C45A12]/40 bg-[#FFF0E6] px-4 text-sm font-semibold text-[#C45A12] hover:bg-[#FFE4D4] disabled:opacity-60"
                >
                  Terugbel afspraak
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
                  disabled={busy || !current}
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
            ) : (
              <form
                onSubmit={(e) => void planTerugbel(e)}
                className="space-y-3 rounded-2xl border border-line bg-white p-4"
              >
                <p className="text-sm font-semibold text-ink">
                  Terugbel afspraak
                </p>
                <p className="text-xs text-muted">
                  Kandidaat verdwijnt uit de wachtrij. Vanaf het geplande
                  moment staat er bovenaan een chip — klik om naar de
                  kandidaat te gaan.
                </p>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                  Datum &amp; tijd
                  <input
                    type="datetime-local"
                    required
                    value={terugbelAt}
                    onChange={(e) => setTerugbelAt(e.target.value)}
                    className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
                  />
                </label>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                  Notitie
                  <textarea
                    value={terugbelNotitie}
                    onChange={(e) => setTerugbelNotitie(e.target.value)}
                    rows={3}
                    placeholder="Bijv. bel terug na 17:00, vraagt om meer info…"
                    className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy || !terugbelAt}
                  className="flex min-h-12 w-full items-center justify-center bg-[#C45A12] px-4 text-sm font-semibold text-white hover:bg-[#a84a0e] disabled:opacity-60"
                >
                  {busy ? "Bezig…" : "Terugbel afspraak opslaan"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setNextMode("status")}
                  className="flex min-h-10 w-full items-center justify-center text-sm font-medium text-muted hover:text-ink"
                >
                  Terug
                </button>
              </form>
            )}
          </div>
        </aside>
      </div>
      <RecruitmentKandidaatMailModal
        kandidaat={mailOpen ? current : null}
        initialTemplateId={mailTemplateId}
        onClose={() => {
          setMailOpen(false);
          setMailTemplateId("ontvangen_sollicitatie");
        }}
        onSent={() => {
          setMsg(
            current?.email
              ? `Mail verstuurd naar ${current.email}`
              : "Mail verstuurd"
          );
          window.setTimeout(() => setMsg(null), 2800);
        }}
      />
    </div>
  );
}
