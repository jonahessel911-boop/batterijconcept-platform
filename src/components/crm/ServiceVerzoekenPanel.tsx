"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { InstallatiePartner, ServiceVerzoek } from "@/types/database";
import { adresRegel, formatDateTimeNl, formatTimeNl } from "@/lib/format";
import { projectStatusLabel } from "@/lib/labels";

type Filter = "open" | "afgehandeld" | "alles";

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dagenOpen(iso: string): number {
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 86_400_000));
}

function partnerNaam(
  p: ServiceVerzoek["projecten"]
): string | null {
  if (!p?.installatie_partners) return null;
  const raw = p.installatie_partners;
  const one = Array.isArray(raw) ? raw[0] : raw;
  return one?.naam || null;
}

function leadAdres(lead: ServiceVerzoek["leads"]): string | null {
  if (!lead) return null;
  return adresRegel(lead) || null;
}

export function ServiceVerzoekenPanel() {
  const [verzoeken, setVerzoeken] = useState<ServiceVerzoek[]>([]);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planAt, setPlanAt] = useState("");
  const [planPartnerId, setPlanPartnerId] = useState("");
  const [planNotes, setPlanNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [vRes, pRes] = await Promise.all([
        fetch("/api/service-verzoeken"),
        fetch("/api/installatie-partners"),
      ]);
      const vData = await vRes.json().catch(() => ({}));
      const pData = await pRes.json().catch(() => ({}));
      if (!vRes.ok) throw new Error(vData.error || "Laden mislukt");
      const list = (vData.verzoeken as ServiceVerzoek[]) || [];
      setVerzoeken(list);
      setPartners(
        ((pData.partners as InstallatiePartner[]) || []).filter(
          (p) => p.actief !== false
        )
      );
      setSelectedId((prev) => {
        if (prev && list.some((v) => v.id === prev)) return prev;
        const firstOpen = list.find((v) => v.status === "open");
        return firstOpen?.id || list[0]?.id || null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setVerzoeken([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return verzoeken.filter((v) => {
      if (filter === "open" && v.status !== "open") return false;
      if (filter === "afgehandeld" && v.status !== "afgehandeld") return false;
      if (!needle) return true;
      const hay = [
        v.onderwerp,
        v.omschrijving,
        v.klant_email,
        v.leads?.naam,
        v.leads?.lead_number,
        v.leads?.plaats,
        v.leads?.telefoon,
        v.projecten?.project_nummer,
        v.projecten?.titel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [verzoeken, filter, q]);

  const counts = useMemo(() => {
    const open = verzoeken.filter((v) => v.status === "open");
    const urgent = open.filter((v) => dagenOpen(v.created_at) >= 3).length;
    return {
      open: open.length,
      urgent,
      afgehandeld: verzoeken.filter((v) => v.status === "afgehandeld").length,
      alles: verzoeken.length,
    };
  }, [verzoeken]);

  const selected = useMemo(
    () => filtered.find((v) => v.id === selectedId) || null,
    [filtered, selectedId]
  );

  useEffect(() => {
    if (!selected) return;
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    setPlanAt(toDatetimeLocalValue(d));
    setPlanPartnerId(selected.projecten?.installatie_partner_id || "");
    setPlanNotes(selected.onderwerp || "");
    setOkMsg(null);
    setError(null);
  }, [selected?.id]);

  async function submitPlan(v: ServiceVerzoek) {
    if (!planAt.trim()) {
      setError("Kies datum + tijd");
      return;
    }
    if (!planPartnerId) {
      setError("Kies een installatiepartner");
      return;
    }
    const parsed = new Date(planAt);
    if (Number.isNaN(parsed.getTime())) {
      setError("Ongeldige datum");
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/projecten/${v.project_id}/service`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_at: parsed.toISOString(),
          installatie_partner_id: planPartnerId,
          service_notities: planNotes.trim() || null,
          service_verzoek_id: v.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Inplannen mislukt");
      setOkMsg(
        `Ingepland · ${formatDateTimeNl(parsed.toISOString())} · zichtbaar op Planbord`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inplannen mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function afhandelen(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-verzoeken/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "afgehandeld" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Afhandelen mislukt");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Afhandelen mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="border border-line bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Open
          </p>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
            {counts.open}
          </p>
        </div>
        <div className="border border-line bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Urgent (≥3d)
          </p>
          <p
            className={[
              "mt-1 font-display text-2xl font-semibold tabular-nums",
              counts.urgent > 0 ? "text-[#C45A12]" : "text-ink",
            ].join(" ")}
          >
            {counts.urgent}
          </p>
        </div>
        <div className="border border-line bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Afgehandeld
          </p>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
            {counts.afgehandeld}
          </p>
        </div>
        <div className="border border-line bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Totaal
          </p>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
            {counts.alles}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex border border-line bg-white">
          {(
            [
              ["open", "Wachtrij", counts.open],
              ["afgehandeld", "Klaar", counts.afgehandeld],
              ["alles", "Alles", counts.alles],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={[
                "px-3.5 py-2 text-xs font-semibold",
                filter === id
                  ? "bg-[#0a4727] text-white"
                  : "text-muted hover:bg-wash hover:text-ink",
              ].join(" ")}
            >
              {label}
              <span
                className={[
                  "ml-1.5 tabular-nums",
                  filter === id ? "text-white/70" : "text-muted",
                ].join(" ")}
              >
                {n}
              </span>
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Zoek klant, project, plaats, onderwerp…"
          className="w-full max-w-sm border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green sm:w-80"
        />
      </div>

      {error ? (
        <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {okMsg ? (
        <p className="border border-green/30 bg-green-soft px-3 py-2 text-sm text-green-dark">
          {okMsg}
        </p>
      ) : null}

      {/* Master–detail desk */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              Service-tickets
            </p>
            <p className="text-[11px] tabular-nums text-muted">
              {filtered.length} zichtbaar
            </p>
          </div>

          {loading ? (
            <p className="px-5 py-16 text-center text-sm text-muted">Laden…</p>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="font-display text-base font-semibold text-ink">
                Geen tickets
              </p>
              <p className="mt-1 text-sm text-muted">
                {filter === "open"
                  ? "Wachtrij is leeg — niets om in te plannen."
                  : "Geen resultaten in deze filter."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {filtered.map((v) => {
                const days = dagenOpen(v.created_at);
                const active = selectedId === v.id;
                const lead = v.leads;
                const project = v.projecten;
                const urgent = v.status === "open" && days >= 3;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(v.id)}
                      className={[
                        "flex w-full gap-3 px-4 py-3.5 text-left transition-colors",
                        active
                          ? "bg-[#0a4727]/[0.04] ring-inset ring-1 ring-[#0a4727]/20"
                          : "hover:bg-wash/80",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "mt-1 h-10 w-1 shrink-0",
                          v.status === "afgehandeld"
                            ? "bg-[#0D5C32]/40"
                            : urgent
                              ? "bg-[#C45A12]"
                              : "bg-[#EA580C]",
                        ].join(" ")}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-ink">
                            {v.onderwerp}
                          </p>
                          {v.status === "open" ? (
                            <span
                              className={[
                                "shrink-0 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                                urgent
                                  ? "bg-[#C45A12] text-white"
                                  : "bg-[#FFF0E6] text-[#C45A12]",
                              ].join(" ")}
                            >
                              {urgent ? `${days}d open` : "Open"}
                            </span>
                          ) : (
                            <span className="shrink-0 bg-[#E8F6EC] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0D5C32]">
                              Klaar
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-sm text-ink/80">
                          {lead?.naam || "Onbekende klant"}
                          {lead?.plaats ? ` · ${lead.plaats}` : ""}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {project?.project_nummer || "Geen projectnr"}
                          {" · "}
                          {formatDateTimeNl(v.created_at)}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Detail / planning */}
        <div className="border border-line bg-white lg:sticky lg:top-20 lg:self-start">
          {!selected ? (
            <div className="px-5 py-16 text-center">
              <p className="font-display text-base font-semibold text-ink">
                Selecteer een ticket
              </p>
              <p className="mt-1 text-sm text-muted">
                Plan service in en stuur naar het planbord.
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="border-b border-line bg-[#0a4727] px-5 py-4 text-white">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
                  Service-ticket
                </p>
                <h3 className="mt-1 font-display text-lg font-semibold leading-snug">
                  {selected.onderwerp}
                </h3>
                <p className="mt-1 text-sm text-white/75">
                  {selected.leads?.naam || "Klant"}
                  {selected.projecten?.project_nummer
                    ? ` · ${selected.projecten.project_nummer}`
                    : ""}
                </p>
              </div>

              <div className="space-y-4 px-5 py-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                      Klant
                    </p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {selected.leads?.naam || "—"}
                    </p>
                    {leadAdres(selected.leads) ? (
                      <p className="mt-0.5 text-xs text-muted">
                        {leadAdres(selected.leads)}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selected.leads?.telefoon ? (
                        <a
                          href={`tel:${selected.leads.telefoon}`}
                          className="bg-[#0D9488] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0F766E]"
                        >
                          Bel
                        </a>
                      ) : null}
                      {(selected.leads?.email || selected.klant_email) && (
                        <a
                          href={`mailto:${selected.leads?.email || selected.klant_email}`}
                          className="border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                        >
                          Mail
                        </a>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                      Project
                    </p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {selected.projecten?.project_nummer || "—"}
                    </p>
                    {selected.projecten?.status ? (
                      <p className="mt-0.5 text-xs text-muted">
                        {projectStatusLabel[selected.projecten.status] ||
                          selected.projecten.status}
                      </p>
                    ) : null}
                    {partnerNaam(selected.projecten) ? (
                      <p className="mt-0.5 text-xs text-muted">
                        Partner · {partnerNaam(selected.projecten)}
                      </p>
                    ) : null}
                    {selected.projecten?.service_at ? (
                      <p className="mt-1 text-xs font-semibold text-[#C45A12]">
                        Al gepland ·{" "}
                        {formatDateTimeNl(selected.projecten.service_at)}
                      </p>
                    ) : null}
                  </div>
                </div>

                {selected.omschrijving ? (
                  <div className="border border-line bg-wash/50 px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                      Melding
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                      {selected.omschrijving}
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/projecten/${selected.project_id}?from=orders`}
                    className="border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-wash"
                  >
                    Open project
                  </Link>
                  {selected.status === "open" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void afhandelen(selected.id)}
                      className="border border-line px-3 py-2 text-xs font-semibold text-muted hover:bg-wash disabled:opacity-50"
                    >
                      Markeer afgehandeld
                    </button>
                  ) : (
                    <span className="px-3 py-2 text-xs font-semibold text-[#0D5C32]">
                      Afgehandeld
                      {selected.afgehandeld_op
                        ? ` · ${formatDateTimeNl(selected.afgehandeld_op)}`
                        : ""}
                    </span>
                  )}
                </div>

                {selected.status === "open" ? (
                  <div className="space-y-3 border-t border-line pt-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                        Inplannen op planbord
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        Datum, partner en notitie · verschijnt als service op
                        Planbord
                      </p>
                    </div>
                    <label className="block">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Datum + tijd
                      </span>
                      <input
                        type="datetime-local"
                        value={planAt}
                        onChange={(e) => setPlanAt(e.target.value)}
                        className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Installatiepartner
                      </span>
                      <select
                        value={planPartnerId}
                        onChange={(e) => setPlanPartnerId(e.target.value)}
                        className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                      >
                        <option value="">Kies partner…</option>
                        {partners.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.naam}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Werkbon / notitie
                      </span>
                      <textarea
                        value={planNotes}
                        onChange={(e) => setPlanNotes(e.target.value)}
                        rows={3}
                        placeholder="Wat moet de monteur doen…"
                        className="mt-1.5 w-full resize-y border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy || !planAt || !planPartnerId}
                      onClick={() => void submitPlan(selected)}
                      className="w-full bg-[#C45A12] px-4 py-3 text-sm font-semibold text-white hover:bg-[#9A4510] disabled:opacity-50"
                    >
                      {busy
                        ? "Bezig…"
                        : planAt
                          ? `Plan in · ${formatTimeNl(new Date(planAt).toISOString())}`
                          : "Plan in op planbord"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
