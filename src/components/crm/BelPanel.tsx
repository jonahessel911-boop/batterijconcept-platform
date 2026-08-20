"use client";

import { useEffect, useMemo, useState } from "react";
import type { Adviseur, Afspraak, Lead, LeadStatus } from "@/types/database";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { getSupabaseBrowser } from "@/lib/supabase";
import { isAdminAdviseur } from "@/lib/admin-adviseur";
import { AMSTERDAM_TZ, adresRegel, formatDateTimeNl, formatTimeNl } from "@/lib/format";
import {
  MAX_BELPOGINGEN,
  MAX_BELPOGINGEN_PER_DAG,
  activeBelAfspraak,
  belpogingenOf,
  belpogingenVandaagOf,
  geenContactPogingLabel,
  inBelQueue,
  isTerugbelDueToday,
  sortBelQueue,
} from "@/lib/bel-queue";

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

function JaNeeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
        <span className="ml-1 font-normal normal-case tracking-normal text-[#C45A12]">
          *
        </span>
      </legend>
      <div className="flex gap-2">
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            className={[
              "min-h-11 flex-1 border px-3 py-2.5 text-sm font-semibold",
              value === v
                ? "border-green bg-green-soft text-green-dark"
                : "border-line bg-white text-ink hover:border-green/50",
            ].join(" ")}
          >
            {v ? "Ja" : "Nee"}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function BelPanel({
  leads,
  afspraken = [],
  adviseurs,
  appointmentLeadIds,
  defaultAdviseurId,
  onLeadUpdated,
  onNeedReload,
}: {
  leads: Lead[];
  afspraken?: Afspraak[];
  adviseurs: Adviseur[];
  appointmentLeadIds: Set<string>;
  defaultAdviseurId?: string;
  onLeadUpdated: (id: string, patch: Partial<Lead>) => void;
  onNeedReload?: () => void;
}) {
  const normalQueue = useMemo(
    () => sortBelQueue(leads.filter((l) => inBelQueue(l, appointmentLeadIds))),
    [leads, appointmentLeadIds]
  );

  /** Terugbel-afspraken die vandaag (Amsterdam) aan de beurt zijn. */
  const terugbelToday = useMemo(() => {
    const items: { lead: Lead; afspraak: Afspraak }[] = [];
    for (const a of afspraken) {
      if (!isTerugbelDueToday(a)) continue;
      const lead = leads.find((l) => l.id === a.lead_id);
      if (!lead?.telefoon?.trim()) continue;
      items.push({ lead, afspraak: a });
    }
    items.sort(
      (a, b) =>
        new Date(a.afspraak.start_at).getTime() -
        new Date(b.afspraak.start_at).getTime()
    );
    return items;
  }, [afspraken, leads]);

  const queue = useMemo(() => {
    const terugbelLeads = terugbelToday.map((t) => t.lead);
    const ids = new Set(terugbelLeads.map((l) => l.id));
    return [...terugbelLeads, ...normalQueue.filter((l) => !ids.has(l.id))];
  }, [terugbelToday, normalQueue]);

  const planAdviseurs = useMemo(
    () => adviseurs.filter((a) => a.actief && !isAdminAdviseur(a)),
    [adviseurs]
  );

  const [currentId, setCurrentId] = useState<string | null>(null);
  /** null = Volgende-knop · status = uitkomsten · terugbel = interne terugbel-afspraak */
  const [nextMode, setNextMode] = useState<"status" | "terugbel" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [adviseurId, setAdviseurId] = useState(defaultAdviseurId || "");
  const [slots, setSlots] = useState<
    { start_at: string; end_at: string; busy?: boolean }[]
  >([]);
  const [startAt, setStartAt] = useState("");
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [notities, setNotities] = useState("");
  const [partnerAanwezig, setPartnerAanwezig] = useState<boolean | null>(null);
  const [andereOffertes, setAndereOffertes] = useState<boolean | null>(null);
  const [terugbelAt, setTerugbelAt] = useState("");
  const [terugbelNotitie, setTerugbelNotitie] = useState("");

  const current =
    queue.find((l) => l.id === currentId) ||
    terugbelToday[0]?.lead ||
    normalQueue[0] ||
    null;

  const currentTerugbel = current
    ? activeBelAfspraak(afspraken, current.id)
    : null;
  const currentIsTerugbelDue = Boolean(
    currentTerugbel && isTerugbelDueToday(currentTerugbel)
  );

  const slotsByDay = useMemo(() => {
    const map = new Map<
      string,
      { start_at: string; end_at: string; busy?: boolean }[]
    >();
    for (const s of slots) {
      const key = formatInTimeZone(s.start_at, AMSTERDAM_TZ, "yyyy-MM-dd");
      const list = map.get(key) || [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [slots]);

  useEffect(() => {
    if (!current) {
      setCurrentId(null);
      return;
    }
    if (currentId !== current.id) setCurrentId(current.id);
  }, [current, currentId]);

  useEffect(() => {
    if (!current) return;
    setNextMode(null);
    setError(null);
    setCopied(false);
    setStartAt("");
    setCustomStart("");
    setUseCustomTime(false);
    setNotities(current.notities || "");
    setPartnerAanwezig(null);
    setAndereOffertes(null);
    setTerugbelAt("");
    setTerugbelNotitie(current.terugbel_notitie || "");
    const preferred = current.adviseur_id || defaultAdviseurId || "";
    const allowed = planAdviseurs.some((a) => a.id === preferred)
      ? preferred
      : planAdviseurs[0]?.id || "";
    setAdviseurId(allowed);
  }, [current?.id, defaultAdviseurId, planAdviseurs]);

  useEffect(() => {
    if (!adviseurId) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    queueMicrotask(async () => {
      const res = await fetch(`/api/adviseurs?adviseur_id=${adviseurId}`);
      const data = await res.json();
      if (!cancelled) setSlots(data.blocks || data.slots || []);
    });
    return () => {
      cancelled = true;
    };
  }, [adviseurId]);

  function goNextLead(excludeId: string) {
    const rest = queue.filter((l) => l.id !== excludeId);
    const nextTerugbel = terugbelToday.find((t) => t.lead.id !== excludeId);
    setCurrentId(nextTerugbel?.lead.id || rest[0]?.id || null);
    setNextMode(null);
  }

  async function completeTerugbelAfspraak(leadId: string) {
    const afspraak = activeBelAfspraak(afspraken, leadId);
    if (!afspraak) return;
    const sb = getSupabaseBrowser();
    await sb
      .from("afspraken")
      .update({ status: "voltooid" })
      .eq("id", afspraak.id);
  }

  async function copyPhone(nummer: string) {
    const value = nummer.trim();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.createElement("textarea");
      el.value = value;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function saveOutcome(status: LeadStatus) {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const pogingen =
        status === "geen_contact"
          ? Math.min(belpogingenOf(current) + 1, MAX_BELPOGINGEN)
          : belpogingenOf(current);
      const vandaag =
        status === "geen_contact"
          ? belpogingenVandaagOf(current) + 1
          : belpogingenVandaagOf(current);
      const patch: Partial<Lead> = {
        status,
        belpogingen: pogingen,
        belpogingen_vandaag: Math.min(vandaag, MAX_BELPOGINGEN_PER_DAG),
        laatst_gebeld_at: now,
        terugbellen: false,
        terugbel_notitie: null,
      };
      const sb = getSupabaseBrowser();
      let { error: err } = await sb
        .from("leads")
        .update(patch)
        .eq("id", current.id);
      if (
        err &&
        (err.message?.includes("belpogingen_vandaag") || err.code === "42703")
      ) {
        const { belpogingen_vandaag: _, ...withoutDay } = patch;
        const retry = await sb
          .from("leads")
          .update(withoutDay)
          .eq("id", current.id);
        err = retry.error;
      }
      if (err) {
        if (
          err.message?.includes("belpogingen") ||
          err.message?.includes("laatst_gebeld_at") ||
          err.code === "42703"
        ) {
          throw new Error(
            "Voer eerst supabase/migrate-lead-belpogingen.sql uit in Supabase."
          );
        }
        throw err;
      }
      await completeTerugbelAfspraak(current.id);
      onLeadUpdated(current.id, patch);
      onNeedReload?.();
      goNextLead(current.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function plan(e: React.FormEvent) {
    e.preventDefault();
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      let resolvedStart = startAt;
      if (useCustomTime) {
        if (!customStart) throw new Error("Kies een tijdstip");
        const parsed = new Date(customStart);
        if (Number.isNaN(parsed.getTime())) throw new Error("Ongeldig tijdstip");
        resolvedStart = parsed.toISOString();
      }
      if (!resolvedStart) throw new Error("Kies een tijdslot");
      if (!adviseurId) throw new Error("Kies een adviseur");
      if (partnerAanwezig === null) {
        throw new Error("Beantwoord: Partner aanwezig?");
      }
      if (andereOffertes === null) {
        throw new Error("Beantwoord: Andere offertes al gehad?");
      }

      const res = await fetch("/api/afspraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: current.id,
          adviseur_id: adviseurId,
          start_at: resolvedStart,
          notities: notities || undefined,
          soort: "nieuw",
          partner_aanwezig: partnerAanwezig,
          andere_offertes_gehad: andereOffertes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Inplannen mislukt");

      onLeadUpdated(current.id, { status: "afspraak" });
      await completeTerugbelAfspraak(current.id);
      onNeedReload?.();
      goNextLead(current.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  async function planTerugbel(e: React.FormEvent) {
    e.preventDefault();
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      if (!terugbelAt) throw new Error("Kies datum en tijd");
      const parsed = new Date(terugbelAt);
      if (Number.isNaN(parsed.getTime())) throw new Error("Ongeldige datum/tijd");
      if (!adviseurId) throw new Error("Kies een adviseur");
      const note = terugbelNotitie.trim();
      if (!note) throw new Error("Vul een notitie in");

      const res = await fetch("/api/afspraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: current.id,
          adviseur_id: adviseurId,
          start_at: parsed.toISOString(),
          notities: note,
          soort: "bel",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Terugbel-afspraak mislukt");

      const now = new Date().toISOString();
      const leadPatch: Partial<Lead> = {
        terugbellen: true,
        terugbel_notitie: note,
        laatst_gebeld_at: now,
      };
      const sb = getSupabaseBrowser();
      await sb.from("leads").update(leadPatch).eq("id", current.id);

      onLeadUpdated(current.id, leadPatch);
      onNeedReload?.();
      goNextLead(current.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  if (queue.length === 0 && terugbelToday.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="font-display text-lg font-semibold text-ink">
          Bellijst is leeg
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Alleen leads zonder afspraak, deal of “geen interesse” staan hier.
          Max {MAX_BELPOGINGEN_PER_DAG} belpogingen per lead per dag — daarna
          komen ze morgen terug. Na {MAX_BELPOGINGEN} keer geen contact vallen
          ze eruit. Terugbel-afspraken verschijnen hier op de dag zelf.
        </p>
      </div>
    );
  }

  if (!current) return null;

  const pogingen = belpogingenOf(current);
  const pogingenVandaag = belpogingenVandaagOf(current);
  const nextPoging = Math.min(pogingen + 1, MAX_BELPOGINGEN);
  const phone = current.telefoon!.trim();
  const position = queue.findIndex((l) => l.id === current.id) + 1;

  return (
    <div>
      {terugbelToday.length > 0 && (
        <div className="border-b border-[#C45A12]/25 bg-[#FFF8F3] px-4 py-2.5 sm:px-5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C45A12]">
            Terugbellen vandaag ({terugbelToday.length})
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {terugbelToday.map(({ lead, afspraak }) => {
              const active = current?.id === lead.id;
              return (
                <button
                  key={afspraak.id}
                  type="button"
                  onClick={() => {
                    setCurrentId(lead.id);
                    setNextMode(null);
                    setError(null);
                  }}
                  className={[
                    "inline-flex max-w-full items-center gap-2 border px-2.5 py-1 text-left text-xs",
                    active
                      ? "border-[#C45A12] bg-[#C45A12] text-white"
                      : "border-[#C45A12]/35 bg-white text-ink hover:border-[#C45A12]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "shrink-0 font-bold tabular-nums",
                      active ? "text-white" : "text-[#C45A12]",
                    ].join(" ")}
                  >
                    {formatTimeNl(afspraak.start_at)}
                  </span>
                  <span className="truncate font-medium">{lead.naam}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
      <section className="border-b border-line p-4 sm:p-6 lg:border-b-0 lg:border-r">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {currentIsTerugbelDue
            ? "Terugbel afspraak vandaag"
            : `${position} van ${queue.length} in de bellijst`}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {current.status === "geen_contact" || pogingen > 0 ? (
            <span className="rounded-full border border-[#C45A12]/30 bg-[#FFF0E6] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#C45A12]">
              {geenContactPogingLabel(pogingen)}
            </span>
          ) : (
            <span className="rounded-full bg-green-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-green-dark">
              Nieuw
            </span>
          )}
          {current.terugbellen && (
            <span className="rounded-full border border-[#C45A12]/30 bg-[#FFF0E6] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#C45A12]">
              Terugbellen
            </span>
          )}
          <span className="rounded-full border border-line bg-wash px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">
            Vandaag {pogingenVandaag}/{MAX_BELPOGINGEN_PER_DAG}
          </span>
        </div>

        <h2 className="mt-3 font-display text-2xl font-semibold text-ink sm:text-3xl">
          {current.naam}
        </h2>
        <p className="font-mono text-xs text-muted">{current.lead_number}</p>
        <p className="mt-1 text-sm text-muted">
          Aangemeld {formatDateTimeNl(current.created_at)}
        </p>
        <p className="mt-2 text-sm text-muted">{adresRegel(current)}</p>
        {current.email && (
          <p className="mt-1 text-sm text-muted">{current.email}</p>
        )}

        {currentIsTerugbelDue && currentTerugbel && (
          <div className="mt-3 border border-[#C45A12]/30 bg-[#FFF0E6] px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C45A12]">
              Gepland terugbelmoment · {formatTimeNl(currentTerugbel.start_at)}
            </p>
            {(currentTerugbel.notities || current.terugbel_notitie)?.trim() ? (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {currentTerugbel.notities || current.terugbel_notitie}
              </p>
            ) : null}
          </div>
        )}
        {!currentIsTerugbelDue && current.terugbel_notitie?.trim() && (
          <div className="mt-4 border border-[#C45A12]/30 bg-[#FFF0E6] px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#C45A12]">
              Terugbelnotitie
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {current.terugbel_notitie}
            </p>
          </div>
        )}
        {current.notities?.trim() && (
          <div className="mt-4 rounded-xl bg-wash px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Lead-notitie
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {current.notities}
            </p>
          </div>
        )}

        <p className="mt-5 font-mono text-lg font-semibold tabular-nums text-ink">
          {phone}
        </p>
        <button
          type="button"
          onClick={() => void copyPhone(phone)}
          className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 border border-green bg-white px-4 text-sm font-semibold text-green-dark hover:bg-green-soft"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Gekopieerd" : "Copy phone"}
        </button>
      </section>

      <aside className="flex flex-col bg-wash/40 p-4 sm:p-5">
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
                Daarna komt de volgende lead in de bellijst.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveOutcome("geen_contact")}
                className="flex min-h-12 w-full items-center justify-center bg-orange px-4 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
              >
                {geenContactPogingLabel(nextPoging)}
                {nextPoging >= MAX_BELPOGINGEN ? " — uit bellijst" : ""}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveOutcome("geen_interesse")}
                className="flex min-h-12 w-full items-center justify-center border border-line px-4 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-60"
              >
                Geen interesse
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
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
                onClick={() => setNextMode(null)}
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
              <p className="text-sm font-semibold text-ink">Terugbel afspraak</p>
              <p className="text-xs text-muted">
                Alleen intern — de klant krijgt geen mail. Staat in de agenda als
                terugbelmoment.
              </p>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                Adviseur
                <select
                  required
                  value={adviseurId}
                  onChange={(e) => setAdviseurId(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
                >
                  <option value="">Kies adviseur…</option>
                  {planAdviseurs.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.naam}
                    </option>
                  ))}
                </select>
              </label>
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
                  required
                  value={terugbelNotitie}
                  onChange={(e) => setTerugbelNotitie(e.target.value)}
                  rows={3}
                  placeholder="Bijv. bel terug over offerte, bereikbaar na 17:00…"
                  className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !adviseurId || !terugbelAt || !terugbelNotitie.trim()}
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

          {error && (
            <p className="mt-3 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              {error}
            </p>
          )}

          <form
            onSubmit={(e) => void plan(e)}
            className="mt-4 space-y-3 rounded-2xl border border-line bg-white p-5"
          >
            <p className="font-display text-base font-semibold text-ink">
              Direct inplannen
            </p>
            <p className="text-xs text-muted">
              Zelfde flow als in de agenda — bevestigingsmail gaat mee.
            </p>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Adviseur
              <select
                required
                value={adviseurId}
                onChange={(e) => {
                  setAdviseurId(e.target.value);
                  setStartAt("");
                  setCustomStart("");
                }}
                className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
              >
                <option value="">Kies adviseur…</option>
                {planAdviseurs.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.naam}
                    </option>
                  ))}
              </select>
            </label>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Tijdstip
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setUseCustomTime((v) => !v);
                    setStartAt("");
                    setCustomStart("");
                  }}
                  className="text-xs font-medium text-green hover:underline"
                >
                  {useCustomTime ? "Kies vast slot" : "Ander tijdstip…"}
                </button>
              </div>
              {useCustomTime ? (
                <input
                  type="datetime-local"
                  required
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
                />
              ) : !adviseurId ? (
                <p className="text-sm text-muted">Kies eerst een adviseur.</p>
              ) : slotsByDay.length === 0 ? (
                <p className="text-sm text-muted">Geen slots.</p>
              ) : (
                <div className="max-h-64 space-y-3 overflow-y-auto pr-0.5">
                  <p className="text-[11px] text-muted">
                    Groen = vrij · rood = al ingepland · 2 uur afspraak, 1 uur
                    reistijd ertussen
                  </p>
                  {slotsByDay.map(([day, daySlots]) => (
                    <div key={day}>
                      <p className="mb-1.5 text-[11px] font-semibold capitalize text-muted">
                        {formatInTimeZone(
                          daySlots[0].start_at,
                          AMSTERDAM_TZ,
                          "EEE d MMM",
                          { locale: nl }
                        )}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {daySlots.map((s) => {
                          const taken = Boolean(s.busy);
                          const selected = !taken && startAt === s.start_at;
                          return (
                            <button
                              key={s.start_at}
                              type="button"
                              disabled={taken}
                              onClick={() => setStartAt(s.start_at)}
                              className={[
                                "min-h-9 min-w-[3.5rem] border px-2.5 py-1.5 text-sm font-semibold tabular-nums disabled:cursor-not-allowed",
                                taken
                                  ? "border-[#C62828]/40 bg-[#FDECEA] text-[#C62828]"
                                  : selected
                                    ? "border-green bg-green text-white"
                                    : "border-green/40 bg-green-soft text-green-dark hover:border-green",
                              ].join(" ")}
                            >
                              {formatTimeNl(s.start_at)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <JaNeeField
              label="Partner aanwezig?"
              value={partnerAanwezig}
              onChange={setPartnerAanwezig}
            />
            <JaNeeField
              label="Andere offertes al gehad?"
              value={andereOffertes}
              onChange={setAndereOffertes}
            />
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Interne notitie
              <span className="ml-1 font-normal normal-case tracking-normal text-muted/80">
                (niet voor de klant)
              </span>
              <textarea
                value={notities}
                onChange={(e) => setNotities(e.target.value)}
                rows={3}
                placeholder="Bijv. bel vooraf, sleutel bij buren…"
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              />
            </label>
            <button
              type="submit"
              disabled={
                busy || partnerAanwezig === null || andereOffertes === null
              }
              className="min-h-11 w-full bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
            >
              {busy ? "Bezig…" : "Afspraak plannen"}
            </button>
          </form>
        </div>
      </aside>
    </div>
    </div>
  );
}
