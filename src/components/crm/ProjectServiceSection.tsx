"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  InstallatiePartner,
  Project,
  ServiceVerzoek,
} from "@/types/database";
import { formatDateTimeNl, formatTimeNl } from "@/lib/format";

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultPlanAt(): string {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return toDatetimeLocalValue(d.toISOString());
}

function dagenOpen(iso: string): number {
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 86_400_000));
}

export function ProjectServiceSection({
  project,
  verzoeken,
  onChanged,
}: {
  project: Project;
  verzoeken: ServiceVerzoek[];
  onChanged: () => void;
}) {
  const [onderwerp, setOnderwerp] = useState("");
  const [omschrijving, setOmschrijving] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(verzoeken.map((v) => [v.id, v.interne_notitie || ""]))
  );
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [planAt, setPlanAt] = useState(
    () => toDatetimeLocalValue(project.service_at) || defaultPlanAt()
  );
  const [planPartnerId, setPlanPartnerId] = useState(
    project.installatie_partner_id || ""
  );
  const [planNotes, setPlanNotes] = useState(project.service_notities || "");
  const [planVerzoekId, setPlanVerzoekId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    () => verzoeken.find((v) => v.status === "open")?.id || verzoeken[0]?.id || null
  );
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    setNotes(
      Object.fromEntries(verzoeken.map((v) => [v.id, v.interne_notitie || ""]))
    );
    setSelectedId((prev) => {
      if (prev && verzoeken.some((v) => v.id === prev)) return prev;
      return (
        verzoeken.find((v) => v.status === "open")?.id ||
        verzoeken[0]?.id ||
        null
      );
    });
  }, [verzoeken]);

  useEffect(() => {
    setPlanAt(toDatetimeLocalValue(project.service_at) || defaultPlanAt());
    setPlanNotes(project.service_notities || "");
    if (project.installatie_partner_id) {
      setPlanPartnerId(project.installatie_partner_id);
    }
  }, [
    project.service_at,
    project.service_notities,
    project.installatie_partner_id,
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/installatie-partners");
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const list = ((data.partners as InstallatiePartner[]) || []).filter(
          (p) => p.actief !== false
        );
        setPartners(list);
        setPlanPartnerId((prev) => {
          if (prev) return prev;
          if (project.installatie_partner_id) {
            return project.installatie_partner_id;
          }
          return list[0]?.id || "";
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.installatie_partner_id]);

  const openVerzoeken = useMemo(
    () => verzoeken.filter((v) => v.status === "open"),
    [verzoeken]
  );
  const selected = useMemo(
    () => verzoeken.find((v) => v.id === selectedId) || null,
    [verzoeken, selectedId]
  );

  async function createVerzoek(e: React.FormEvent) {
    e.preventDefault();
    if (!onderwerp.trim()) return;
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/service-verzoeken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: project.id,
          onderwerp: onderwerp.trim(),
          omschrijving: omschrijving.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Aanmaken mislukt");
      setOnderwerp("");
      setOmschrijving("");
      setShowAdd(false);
      setOkMsg("Serviceverzoek toegevoegd.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  async function patch(
    id: string,
    body: { interne_notitie?: string; status?: "open" | "afgehandeld" }
  ) {
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/service-verzoeken/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Bijwerken mislukt");
      if (body.status === "afgehandeld") {
        setOkMsg("Verzoek afgehandeld.");
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  async function planService(e: React.FormEvent) {
    e.preventDefault();
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
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}/service`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_at: parsed.toISOString(),
          installatie_partner_id: planPartnerId,
          service_notities: planNotes.trim() || null,
          service_verzoek_id: planVerzoekId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Inplannen mislukt");
      setOkMsg(
        `Service gepland · ${formatDateTimeNl(parsed.toISOString())} · oranje op Planbord`
      );
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  function useVerzoekForPlan(v: ServiceVerzoek) {
    setSelectedId(v.id);
    setPlanVerzoekId(v.id);
    setPlanNotes(v.onderwerp || planNotes);
  }

  return (
    <div className="space-y-4">
      {/* Status strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="border border-line bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Open verzoeken
          </p>
          <p
            className={[
              "mt-1 font-display text-2xl font-semibold tabular-nums",
              openVerzoeken.length > 0 ? "text-[#C45A12]" : "text-ink",
            ].join(" ")}
          >
            {openVerzoeken.length}
          </p>
        </div>
        <div className="border border-line bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Op planbord
          </p>
          <p className="mt-1 font-display text-sm font-semibold text-ink">
            {project.service_at
              ? formatDateTimeNl(project.service_at)
              : "Nog niet gepland"}
          </p>
        </div>
        <div className="col-span-2 border border-line bg-white px-4 py-3 sm:col-span-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Partner
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-ink">
            {partners.find((p) => p.id === planPartnerId)?.naam ||
              "Nog niet gekozen"}
          </p>
        </div>
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

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.92fr)]">
        {/* Tickets */}
        <section className="border border-line bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                Service-tickets
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Via e-mail/webhook of handmatig · koppel bij inplannen
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className={[
                "px-3 py-1.5 text-xs font-semibold",
                showAdd
                  ? "border border-line bg-wash text-muted"
                  : "bg-[#C45A12] text-white hover:bg-[#9A4510]",
              ].join(" ")}
            >
              {showAdd ? "Annuleren" : "+ Verzoek"}
            </button>
          </div>

          {showAdd ? (
            <form
              onSubmit={(e) => void createVerzoek(e)}
              className="space-y-3 border-b border-line bg-[#FFF7ED]/40 px-4 py-4"
            >
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Onderwerp *
                </span>
                <input
                  value={onderwerp}
                  onChange={(e) => setOnderwerp(e.target.value)}
                  placeholder="Bijv. Batterij ontlaadt niet"
                  required
                  className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Melding
                </span>
                <textarea
                  value={omschrijving}
                  onChange={(e) => setOmschrijving(e.target.value)}
                  rows={2}
                  placeholder="Wat speelt er bij de klant…"
                  className="mt-1.5 w-full resize-y border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                />
              </label>
              <button
                type="submit"
                disabled={saving || !onderwerp.trim()}
                className="bg-[#0a4727] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0D5C32] disabled:opacity-50"
              >
                {saving ? "Bezig…" : "Verzoek opslaan"}
              </button>
            </form>
          ) : null}

          {verzoeken.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <p className="font-display text-base font-semibold text-ink">
                Geen tickets
              </p>
              <p className="mt-1 text-sm text-muted">
                Voeg een verzoek toe of wacht op binnenkomende melding.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {verzoeken.map((v) => {
                const active = selectedId === v.id;
                const days = dagenOpen(v.created_at);
                const urgent = v.status === "open" && days >= 3;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => useVerzoekForPlan(v)}
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
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {formatDateTimeNl(v.created_at)}
                          {v.klant_email ? ` · ${v.klant_email}` : ""}
                        </p>
                        {v.omschrijving ? (
                          <p className="mt-1 line-clamp-2 text-sm text-ink/80">
                            {v.omschrijving}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Plan + detail */}
        <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <section className="overflow-hidden border border-line bg-white">
            <div className="bg-[#0a4727] px-5 py-4 text-white">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Inplannen
              </p>
              <h3 className="mt-1 font-display text-lg font-semibold">
                Service op planbord
              </h3>
              <p className="mt-1 text-sm text-white/70">
                Verschijnt oranje ·{" "}
                {planAt
                  ? formatTimeNl(new Date(planAt).toISOString())
                  : "kies tijd"}
              </p>
            </div>

            <form
              onSubmit={(e) => void planService(e)}
              className="space-y-3 px-5 py-4"
            >
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Datum + tijd
                </span>
                <input
                  type="datetime-local"
                  value={planAt}
                  onChange={(e) => setPlanAt(e.target.value)}
                  required
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
                  required
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
              {openVerzoeken.length > 0 ? (
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Koppel ticket
                  </span>
                  <select
                    value={planVerzoekId}
                    onChange={(e) => setPlanVerzoekId(e.target.value)}
                    className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                  >
                    <option value="">Geen specifiek verzoek</option>
                    {openVerzoeken.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.onderwerp}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
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
                type="submit"
                disabled={saving || !planAt || !planPartnerId}
                className="w-full bg-[#C45A12] px-4 py-3 text-sm font-semibold text-white hover:bg-[#9A4510] disabled:opacity-50"
              >
                {saving
                  ? "Bezig…"
                  : project.service_at
                    ? "Herplan op planbord"
                    : "Zet op planbord"}
              </button>
            </form>
          </section>

          {selected ? (
            <section className="border border-line bg-white px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                    Geselecteerd ticket
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {selected.onderwerp}
                  </p>
                </div>
                {selected.status === "open" ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void patch(selected.id, {
                        status: "afgehandeld",
                        interne_notitie: notes[selected.id] ?? "",
                      })
                    }
                    className="shrink-0 bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                  >
                    Afhandelen
                  </button>
                ) : (
                  <span className="text-xs font-semibold text-[#0D5C32]">
                    Afgehandeld
                  </span>
                )}
              </div>
              {selected.omschrijving ? (
                <p className="mt-3 whitespace-pre-wrap border border-line bg-wash/50 px-3 py-2.5 text-sm text-ink">
                  {selected.omschrijving}
                </p>
              ) : null}
              <label className="mt-3 block">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Interne notitie
                </span>
                <textarea
                  value={notes[selected.id] ?? selected.interne_notitie ?? ""}
                  onChange={(e) =>
                    setNotes((prev) => ({
                      ...prev,
                      [selected.id]: e.target.value,
                    }))
                  }
                  rows={2}
                  className="mt-1.5 w-full resize-y border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                  placeholder="Wat is er gedaan / afgesproken…"
                />
              </label>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void patch(selected.id, {
                    interne_notitie: notes[selected.id] ?? "",
                  })
                }
                className="mt-2 border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
              >
                Notitie opslaan
              </button>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
