"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { InstallatiePartner, ServiceVerzoek } from "@/types/database";
import { formatDateTimeNl } from "@/lib/format";
import { projectStatusLabel, serviceVerzoekStatusLabel } from "@/lib/labels";

type Filter = "open" | "afgehandeld" | "alles";

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ServiceVerzoekenPanel() {
  const [verzoeken, setVerzoeken] = useState<ServiceVerzoek[]>([]);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [planId, setPlanId] = useState<string | null>(null);
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
      setVerzoeken((vData.verzoeken as ServiceVerzoek[]) || []);
      setPartners(
        ((pData.partners as InstallatiePartner[]) || []).filter(
          (p) => p.actief !== false
        )
      );
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
        v.projecten?.project_nummer,
        v.projecten?.titel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [verzoeken, filter, q]);

  const counts = useMemo(
    () => ({
      open: verzoeken.filter((v) => v.status === "open").length,
      afgehandeld: verzoeken.filter((v) => v.status === "afgehandeld").length,
      alles: verzoeken.length,
    }),
    [verzoeken]
  );

  function openPlan(v: ServiceVerzoek) {
    setPlanId(v.id);
    setOkMsg(null);
    setError(null);
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    setPlanAt(toDatetimeLocalValue(d));
    setPlanPartnerId("");
    setPlanNotes(v.onderwerp || "");
  }

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
        `Service gepland · ${formatDateTimeNl(parsed.toISOString())} — staat op het planbord.`
      );
      setPlanId(null);
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            Alle serviceverzoeken · inplannen op het planbord
          </p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Zoek klant, project, onderwerp…"
          className="w-full max-w-xs border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green sm:w-72"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["open", `Open (${counts.open})`],
            ["afgehandeld", `Afgehandeld (${counts.afgehandeld})`],
            ["alles", `Alles (${counts.alles})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={[
              "px-3 py-1.5 text-xs font-semibold",
              filter === id
                ? "bg-green text-white"
                : "border border-line bg-white text-muted hover:bg-wash",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
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

      <div className="border border-line bg-white">
        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-muted">Laden…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            Geen serviceverzoeken in deze filter.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((v) => {
              const planning = planId === v.id;
              const project = v.projecten;
              const lead = v.leads;
              return (
                <li key={v.id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink">{v.onderwerp}</p>
                        <span
                          className={[
                            "inline-block border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            v.status === "open"
                              ? "border-[#C45A12]/25 bg-[#FFF0E6] text-[#C45A12]"
                              : "border-[#0D5C32]/25 bg-[#E8F6EC] text-[#0D5C32]",
                          ].join(" ")}
                        >
                          {serviceVerzoekStatusLabel[v.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {formatDateTimeNl(v.created_at)}
                        {lead?.naam ? ` · ${lead.naam}` : ""}
                        {project?.project_nummer
                          ? ` · ${project.project_nummer}`
                          : ""}
                        {project?.status
                          ? ` · ${projectStatusLabel[project.status] || project.status}`
                          : ""}
                        {v.klant_email ? ` · ${v.klant_email}` : ""}
                      </p>
                      {v.omschrijving ? (
                        <p className="mt-1.5 text-sm text-ink">{v.omschrijving}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/projecten/${v.project_id}?from=orders`}
                        className="border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                      >
                        Project
                      </Link>
                      {v.status === "open" ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              planning ? setPlanId(null) : openPlan(v)
                            }
                            className="bg-[#C45A12] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#9A4510] disabled:opacity-50"
                          >
                            {planning ? "Annuleren" : "Service inplannen"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void afhandelen(v.id)}
                            className="border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:bg-wash disabled:opacity-50"
                          >
                            Afhandelen
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {planning ? (
                    <div className="mt-4 grid gap-3 border border-line bg-wash p-4 sm:grid-cols-[1fr_1fr_auto]">
                      <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                        Datum + tijd
                        <input
                          type="datetime-local"
                          value={planAt}
                          onChange={(e) => setPlanAt(e.target.value)}
                          className="mt-1.5 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                        />
                      </label>
                      <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                        Installatiepartner
                        <select
                          value={planPartnerId}
                          onChange={(e) => setPlanPartnerId(e.target.value)}
                          className="mt-1.5 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                        >
                          <option value="">Kies partner…</option>
                          {partners.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.naam}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="flex items-end">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void submitPlan(v)}
                          className="w-full bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-50 sm:w-auto"
                        >
                          {busy ? "Bezig…" : "Opslaan op planbord"}
                        </button>
                      </div>
                      <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted sm:col-span-3">
                        Notitie
                        <input
                          value={planNotes}
                          onChange={(e) => setPlanNotes(e.target.value)}
                          className="mt-1.5 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                          placeholder="Wat moet er gebeuren…"
                        />
                      </label>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
