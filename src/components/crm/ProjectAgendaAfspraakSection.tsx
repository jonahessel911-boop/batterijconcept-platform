"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { InstallatiePartner, Project } from "@/types/database";
import { recommendedSchouwWeekForProject } from "@/lib/backoffice-acties";
import {
  formatProjectSchouwWeek,
  isSchouwdagDefinitief,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
  upcomingSchouwWeekOptions,
} from "@/lib/schouw-week";
import { PlanningAgenda } from "@/components/planning/PlanningAgenda";

type AfspraakSoort = "schouwweek" | "schouwdag" | "installatie";

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initialWeekValue(project: Project): string {
  if (project.schouw_jaar && project.schouw_week) {
    return schouwWeekValue(project.schouw_jaar, project.schouw_week);
  }
  if (project.schouw_at) {
    const { jaar, week } = schouwWeekFromDate(project.schouw_at);
    return schouwWeekValue(jaar, week);
  }
  const def = recommendedSchouwWeekForProject(project);
  return schouwWeekValue(def.jaar, def.week);
}

function mailSummary(mails: {
  klant?: { ok?: boolean; skipped?: boolean; error?: string };
  partner?: { ok?: boolean; skipped?: boolean; error?: string };
}): { ok: string; warn: string | null } {
  const parts: string[] = [];
  const warns: string[] = [];
  if (mails.klant?.ok) parts.push("klant");
  else if (mails.klant?.skipped)
    warns.push(mails.klant.error || "geen klantmail");
  else if (mails.klant?.error) warns.push(`klant: ${mails.klant.error}`);

  if (mails.partner?.ok) parts.push("installateur");
  else if (mails.partner?.skipped)
    warns.push(mails.partner.error || "geen partnermail");
  else if (mails.partner?.error) warns.push(`partner: ${mails.partner.error}`);

  return {
    ok:
      parts.length > 0
        ? `Bevestiging verstuurd naar ${parts.join(" + ")}.`
        : "Afspraak opgeslagen.",
    warn: warns.length ? warns.join(" · ") : null,
  };
}

export function ProjectAgendaAfspraakSection({
  project,
  onChanged,
}: {
  project: Project;
  onChanged: () => void;
}) {
  const weekOptions = useMemo(() => upcomingSchouwWeekOptions(60), []);
  const [open, setOpen] = useState(false);
  const [soort, setSoort] = useState<AfspraakSoort>("schouwweek");
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [schouwWeek, setSchouwWeek] = useState(() =>
    initialWeekValue(project)
  );
  const [schouwAtLocal, setSchouwAtLocal] = useState(
    isSchouwdagDefinitief(project)
      ? toDatetimeLocalValue(project.schouw_at)
      : ""
  );
  const [installatieAt, setInstallatieAt] = useState(
    toDatetimeLocalValue(project.installatie_at)
  );
  const [partnerId, setPartnerId] = useState(
    project.installatie_partner_id || ""
  );
  const [notities, setNotities] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [agendaOrders, setAgendaOrders] = useState<Project[]>([]);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [agendaError, setAgendaError] = useState<string | null>(null);

  const agendaPartnerId = partnerId || project.installatie_partner_id || "";

  const agendaAnchor = useMemo(() => {
    if (project.schouw_at) return project.schouw_at;
    if (project.schouw_jaar && project.schouw_week) {
      try {
        return schouwWeekToMondayIso(project.schouw_jaar, project.schouw_week);
      } catch {
        /* ignore */
      }
    }
    if (project.installatie_at) return project.installatie_at;
    return null;
  }, [
    project.schouw_at,
    project.schouw_jaar,
    project.schouw_week,
    project.installatie_at,
  ]);

  const selectedPartner = useMemo(
    () => partners.find((p) => p.id === agendaPartnerId) || null,
    [partners, agendaPartnerId]
  );

  const loadPartners = useCallback(async () => {
    try {
      const res = await fetch("/api/installatie-partners");
      const data = await res.json().catch(() => ({}));
      const list = (data.partners as InstallatiePartner[]) || [];
      setPartners(list);
      setPartnerId((prev) => {
        if (prev) return prev;
        if (project.installatie_partner_id) return project.installatie_partner_id;
        return list[0]?.id || "";
      });
    } catch {
      /* ignore */
    }
  }, [project.installatie_partner_id]);

  const loadAgenda = useCallback(async (pid: string) => {
    if (!pid) {
      setAgendaOrders([]);
      return;
    }
    setAgendaLoading(true);
    setAgendaError(null);
    try {
      const res = await fetch(`/api/installatie-partners/${pid}/agenda`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Agenda laden mislukt"
        );
      }
      const orders = (data.orders as Project[]) || [];
      // Huidig project altijd meenemen (ook zonder geplande sloten)
      if (!orders.some((o) => o.id === project.id)) {
        orders.unshift(project);
      }
      setAgendaOrders(orders);
    } catch (e) {
      setAgendaError(e instanceof Error ? e.message : "Agenda laden mislukt");
      setAgendaOrders([project]);
    } finally {
      setAgendaLoading(false);
    }
  }, [project]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void loadPartners());
    return () => cancelAnimationFrame(id);
  }, [loadPartners]);

  useEffect(() => {
    if (!agendaPartnerId) {
      setAgendaOrders([project]);
      return;
    }
    const frame = requestAnimationFrame(() => void loadAgenda(agendaPartnerId));
    return () => cancelAnimationFrame(frame);
  }, [agendaPartnerId, loadAgenda, project]);

  useEffect(() => {
    setSchouwWeek(initialWeekValue(project));
    setSchouwAtLocal(
      isSchouwdagDefinitief(project)
        ? toDatetimeLocalValue(project.schouw_at)
        : ""
    );
    setInstallatieAt(toDatetimeLocalValue(project.installatie_at));
    if (project.installatie_partner_id) {
      setPartnerId(project.installatie_partner_id);
    }
  }, [
    project.id,
    project.schouw_at,
    project.schouw_jaar,
    project.schouw_week,
    project.installatie_at,
    project.installatie_partner_id,
  ]);

  const schouwSelectOptions = useMemo(() => {
    const base = [...weekOptions];
    if (schouwWeek && !base.some((o) => o.value === schouwWeek)) {
      const parsed = parseSchouwWeekValue(schouwWeek);
      if (parsed) {
        base.unshift({
          value: schouwWeek,
          label:
            formatProjectSchouwWeek({
              schouw_jaar: parsed.jaar,
              schouw_week: parsed.week,
            }) || schouwWeek,
          jaar: parsed.jaar,
          week: parsed.week,
        });
      }
    }
    return base;
  }, [weekOptions, schouwWeek]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      if (!partnerId) throw new Error("Kies een installatiepartner");

      if (soort === "schouwweek" || soort === "schouwdag") {
        const payload: Record<string, unknown> = {
          installatie_partner_id: partnerId,
          schouw_notities: notities.trim() || null,
        };

        if (soort === "schouwdag") {
          if (!schouwAtLocal.trim()) {
            throw new Error("Kies schouwdatum + tijd");
          }
          const parsed = new Date(schouwAtLocal);
          if (Number.isNaN(parsed.getTime())) {
            throw new Error("Ongeldige schouwdatum");
          }
          payload.schouw_at = parsed.toISOString();
          const derived = schouwWeekFromDate(parsed);
          payload.schouw_jaar = derived.jaar;
          payload.schouw_week = derived.week;
        } else {
          const opt = schouwSelectOptions.find((o) => o.value === schouwWeek);
          if (!opt) throw new Error("Kies een schouwweek");
          payload.schouw_jaar = opt.jaar;
          payload.schouw_week = opt.week;
        }

        const res = await fetch(`/api/projecten/${project.id}/schouw`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Inplannen mislukt"
          );
        }
        const summary = mailSummary(
          (data as { mails?: Parameters<typeof mailSummary>[0] }).mails || {}
        );
        setOkMsg(
          `${soort === "schouwdag" ? "Schouwdag" : "Schouwweek"} ingepland. ${summary.ok}`
        );
        if (summary.warn) setError(summary.warn);
        setOpen(false);
        setNotities("");
        onChanged();
        void loadAgenda(partnerId);
        return;
      }

      if (!installatieAt.trim()) {
        throw new Error("Kies installatiedatum + tijd");
      }
      const parsed = new Date(installatieAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error("Ongeldige installatiedatum");
      }
      const res = await fetch(`/api/projecten/${project.id}/installatie`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installatie_at: parsed.toISOString(),
          installatie_partner_id: partnerId,
          installatie_notities: notities.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Inplannen mislukt"
        );
      }
      const summary = mailSummary(
        (data as { mails?: Parameters<typeof mailSummary>[0] }).mails || {}
      );
      setOkMsg(`Installatie ingepland. ${summary.ok}`);
      if (summary.warn) setError(summary.warn);
      setOpen(false);
      setNotities("");
      onChanged();
      void loadAgenda(partnerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            Agenda installateur
          </h2>
          {selectedPartner ? (
            <p className="mt-0.5 text-xs text-muted">{selectedPartner.naam}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setError(null);
            setOkMsg(null);
          }}
          className="bg-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e0651c]"
        >
          {open ? "Sluiten" : "+ Afspraak"}
        </button>
      </div>

      <div className="border-b border-line px-4 py-3">
        <label className="block text-[10px] font-semibold uppercase text-muted">
          Installateur
          <select
            value={agendaPartnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
          >
            <option value="">Kies installateur…</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.naam}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(okMsg || error) && !open ? (
        <div className="space-y-1 border-b border-line px-4 py-2.5">
          {okMsg ? (
            <p className="text-sm text-green-dark">{okMsg}</p>
          ) : null}
          {error ? <p className="text-sm text-[#C45A12]">{error}</p> : null}
        </div>
      ) : null}

      {open ? (
        <form
          onSubmit={(e) => void submit(e)}
          className="space-y-3 border-b border-line px-4 py-4"
        >
          <p className="text-xs text-muted">
            Kies het type afspraak. Klant en installateur krijgen een
            bevestigingsmail.
          </p>

          <fieldset>
            <legend className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Type afspraak
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {(
                [
                  {
                    id: "schouwweek" as const,
                    label: "Schouwweek",
                    hint: "Week selecteren",
                  },
                  {
                    id: "schouwdag" as const,
                    label: "Schouwdag",
                    hint: "Datum + tijd",
                  },
                  {
                    id: "installatie" as const,
                    label: "Installatie",
                    hint: "Datum + tijd",
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSoort(opt.id)}
                  className={[
                    "border px-3 py-2.5 text-left transition-colors",
                    soort === opt.id
                      ? "border-green bg-[#E6F7F5]"
                      : "border-line bg-white hover:bg-wash",
                  ].join(" ")}
                >
                  <span className="block text-sm font-semibold text-ink">
                    {opt.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    {opt.hint}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          {soort === "schouwweek" ? (
            <label className="block text-[10px] font-semibold uppercase text-muted">
              Schouwweek
              <select
                required
                value={schouwWeek}
                onChange={(e) => setSchouwWeek(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              >
                <option value="">Kies week…</option>
                {schouwSelectOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {soort === "schouwdag" ? (
            <label className="block text-[10px] font-semibold uppercase text-muted">
              Schouwdatum + tijd
              <input
                type="datetime-local"
                required
                value={schouwAtLocal}
                onChange={(e) => setSchouwAtLocal(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              />
            </label>
          ) : null}

          {soort === "installatie" ? (
            <label className="block text-[10px] font-semibold uppercase text-muted">
              Installatiedatum + tijd
              <input
                type="datetime-local"
                required
                value={installatieAt}
                onChange={(e) => setInstallatieAt(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              />
            </label>
          ) : null}

          <label className="block text-[10px] font-semibold uppercase text-muted">
            Notities (optioneel)
            <textarea
              value={notities}
              onChange={(e) => setNotities(e.target.value)}
              rows={2}
              placeholder="Bijv. meterkast, parkeerplek…"
              className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
            />
          </label>

          {error ? <p className="text-sm text-[#C45A12]">{error}</p> : null}
          {okMsg ? <p className="text-sm text-green-dark">{okMsg}</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-wash"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={busy || !partnerId}
              className="bg-green px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy
                ? "Bezig…"
                : soort === "schouwweek"
                  ? "Schouwweek inplannen"
                  : soort === "schouwdag"
                    ? "Schouwdag inplannen"
                    : "Installatie inplannen"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="px-2 py-2 sm:px-3 sm:py-3">
        {!agendaPartnerId ? (
          <p className="px-2 py-6 text-center text-sm text-muted">
            Kies een installateur om de agenda te zien.
          </p>
        ) : agendaLoading && agendaOrders.length <= 1 ? (
          <p className="px-2 py-6 text-center text-sm text-muted">
            Agenda laden…
          </p>
        ) : (
          <>
            {agendaError ? (
              <p className="mb-2 px-2 text-xs text-[#C45A12]">{agendaError}</p>
            ) : null}
            <PlanningAgenda
              key={`${agendaPartnerId}-${agendaAnchor || "now"}`}
              orders={agendaOrders}
              showPartner={false}
              initialWeekAnchor={agendaAnchor}
              linkHref={(event) =>
                event.order.id === project.id
                  ? undefined
                  : `/projecten/${event.order.id}?from=orders`
              }
              onOrderUpdated={() => {
                onChanged();
                if (agendaPartnerId) void loadAgenda(agendaPartnerId);
              }}
            />
          </>
        )}
      </div>
    </section>
  );
}
