"use client";

import { useEffect, useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type { Adviseur, Afspraak, Lead } from "@/types/database";
import { isAdminAdviseur } from "@/lib/admin-adviseur";
import { AMSTERDAM_TZ, formatTimeNl } from "@/lib/format";
import { FastDirectionButton } from "./FastDirectionButton";
import { ReistijdHint } from "./ReistijdHint";

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

export function LeadAfspraakPlannen({
  lead,
  adviseurs,
  onPlanned,
}: {
  lead: Lead;
  adviseurs: Adviseur[];
  onPlanned: () => void;
}) {
  const planAdviseurs = useMemo(
    () => adviseurs.filter((a) => a.actief && !isAdminAdviseur(a)),
    [adviseurs]
  );

  const preferred =
    (lead.adviseur_id &&
      planAdviseurs.some((a) => a.id === lead.adviseur_id) &&
      lead.adviseur_id) ||
    planAdviseurs[0]?.id ||
    "";

  const [open, setOpen] = useState(false);
  const [adviseurId, setAdviseurId] = useState(preferred);
  const [slots, setSlots] = useState<
    { start_at: string; end_at: string; busy?: boolean }[]
  >([]);
  const [allAfspraken, setAllAfspraken] = useState<Afspraak[]>([]);
  const [startAt, setStartAt] = useState("");
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [notities, setNotities] = useState(lead.notities || "");
  const [partnerAanwezig, setPartnerAanwezig] = useState<boolean | null>(null);
  const [andereOffertes, setAndereOffertes] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAdviseurId(preferred);
    setNotities(lead.notities || "");
    setPartnerAanwezig(null);
    setAndereOffertes(null);
    setStartAt("");
    setCustomStart("");
    setUseCustomTime(false);
    setError(null);
  }, [open, lead.id, preferred, lead.notities]);

  useEffect(() => {
    if (!open || !adviseurId) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    queueMicrotask(async () => {
      const res = await fetch(`/api/adviseurs?adviseur_id=${adviseurId}`);
      const data = await res.json().catch(() => ({}));
      if (!cancelled) setSlots(data.blocks || data.slots || []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, adviseurId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(async () => {
      const res = await fetch("/api/afspraken");
      const data = await res.json().catch(() => ({}));
      if (!cancelled) setAllAfspraken((data.afspraken as Afspraak[]) || []);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

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

  async function plan(e: React.FormEvent) {
    e.preventDefault();
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
          lead_id: lead.id,
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

      setOpen(false);
      onPlanned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full bg-green px-3 py-2.5 text-sm font-semibold text-white hover:bg-green-dark"
      >
        Afspraak inplannen
      </button>
    );
  }

  const selectedAdviseur = planAdviseurs.find((a) => a.id === adviseurId);

  return (
    <form
      onSubmit={(e) => void plan(e)}
      className="space-y-3 border border-line bg-white p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-base font-semibold text-ink">
          Afspraak inplannen
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-medium text-muted hover:text-ink"
        >
          Annuleren
        </button>
      </div>
      <p className="text-xs text-muted">
        Zelfde flow als bij Bellen — bevestigingsmail gaat mee.
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
          <div className="max-h-56 space-y-3 overflow-y-auto pr-0.5">
            <p className="text-[11px] text-muted">
              Groen = vrij · rood = al ingepland
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

      {adviseurId && !useCustomTime && (
        <FastDirectionButton
          key={`${lead.id}-${adviseurId}`}
          adviseurId={adviseurId}
          lead={lead}
          afspraken={allAfspraken}
          allLeads={[lead]}
          startAdres={selectedAdviseur?.start_adres || null}
          startAdresLabel={selectedAdviseur?.naam || null}
          freeSlots={slots
            .filter((s) => !s.busy)
            .map((s) => ({
              start_at: s.start_at,
              end_at: s.end_at,
            }))}
          onSelectSlot={(iso) => {
            setUseCustomTime(false);
            setCustomStart("");
            setStartAt(iso);
          }}
        />
      )}

      <ReistijdHint
        adviseurId={adviseurId}
        startAt={useCustomTime ? customStart : startAt}
        lead={lead}
        afspraken={allAfspraken}
        allLeads={[lead]}
        startAdres={selectedAdviseur?.start_adres || null}
        startAdresLabel={selectedAdviseur?.naam || null}
      />

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

      {error && (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      )}

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
  );
}
