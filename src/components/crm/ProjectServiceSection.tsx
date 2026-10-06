"use client";

import { useEffect, useState } from "react";
import type {
  InstallatiePartner,
  Project,
  ServiceVerzoek,
} from "@/types/database";
import { formatDateTimeNl } from "@/lib/format";
import { serviceVerzoekStatusLabel } from "@/lib/labels";

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    toDatetimeLocalValue(project.service_at)
  );
  const [planPartnerId, setPlanPartnerId] = useState(
    project.installatie_partner_id || ""
  );
  const [planNotes, setPlanNotes] = useState(project.service_notities || "");
  const [planVerzoekId, setPlanVerzoekId] = useState("");

  useEffect(() => {
    setNotes(
      Object.fromEntries(verzoeken.map((v) => [v.id, v.interne_notitie || ""]))
    );
  }, [verzoeken]);

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

  async function createVerzoek(e: React.FormEvent) {
    e.preventDefault();
    if (!onderwerp.trim()) return;
    setSaving(true);
    setError(null);
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
    try {
      const res = await fetch(`/api/service-verzoeken/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Bijwerken mislukt");
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
        `Service gepland · ${formatDateTimeNl(parsed.toISOString())} — zichtbaar op planbord.`
      );
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  const openVerzoeken = verzoeken.filter((v) => v.status === "open");

  return (
    <div className="space-y-4">
      <section className="border border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display text-base font-semibold text-ink">
            Service inplannen
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Afspraak komt oranje op het planbord te staan.
            {project.service_at
              ? ` Nu gepland: ${formatDateTimeNl(project.service_at)}.`
              : ""}
          </p>
        </div>
        <form
          onSubmit={planService}
          className="grid gap-3 px-5 py-4 sm:grid-cols-2"
        >
          <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Datum + tijd
            <input
              type="datetime-local"
              value={planAt}
              onChange={(e) => setPlanAt(e.target.value)}
              required
              className="mt-1.5 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
            />
          </label>
          <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Installatiepartner
            <select
              value={planPartnerId}
              onChange={(e) => setPlanPartnerId(e.target.value)}
              required
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
          {openVerzoeken.length > 0 ? (
            <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted sm:col-span-2">
              Koppel aan verzoek (optioneel)
              <select
                value={planVerzoekId}
                onChange={(e) => setPlanVerzoekId(e.target.value)}
                className="mt-1.5 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
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
          <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted sm:col-span-2">
            Notitie
            <input
              value={planNotes}
              onChange={(e) => setPlanNotes(e.target.value)}
              className="mt-1.5 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
              placeholder="Wat moet er gebeuren…"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-[#C45A12] px-4 py-2 text-sm font-semibold text-white hover:bg-[#9A4510] disabled:opacity-50"
            >
              {saving ? "Bezig…" : "Service op planbord zetten"}
            </button>
          </div>
        </form>
      </section>

      <section className="border border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display text-base font-semibold text-ink">
            Service verzoeken
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Binnenkomende verzoeken (via e-mail/webhook) worden hier gekoppeld.
            Open → status Service · Afhandelen → Installatie voltooid.
          </p>
        </div>

        <form
          onSubmit={createVerzoek}
          className="grid gap-3 border-b border-line px-5 py-4 sm:grid-cols-[1fr_1fr_auto]"
        >
          <input
            value={onderwerp}
            onChange={(e) => setOnderwerp(e.target.value)}
            placeholder="Onderwerp *"
            className="border border-line px-3 py-2 text-sm outline-none focus:border-green"
            required
          />
          <input
            value={omschrijving}
            onChange={(e) => setOmschrijving(e.target.value)}
            placeholder="Korte omschrijving"
            className="border border-line px-3 py-2 text-sm outline-none focus:border-green"
          />
          <button
            type="submit"
            disabled={saving || !onderwerp.trim()}
            className="bg-orange px-4 py-2 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50"
          >
            Verzoek toevoegen
          </button>
        </form>

        {error ? (
          <p className="px-5 py-2 text-sm text-[#C45A12]">{error}</p>
        ) : null}
        {okMsg ? (
          <p className="px-5 py-2 text-sm text-green-dark">{okMsg}</p>
        ) : null}

        {verzoeken.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Nog geen verzoeken.</p>
        ) : (
          <ul className="divide-y divide-line">
            {verzoeken.map((v) => (
              <li key={v.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink">{v.onderwerp}</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {formatDateTimeNl(v.created_at)}
                      {v.klant_email ? ` · ${v.klant_email}` : ""}
                      {v.omschrijving ? ` · ${v.omschrijving}` : ""}
                    </p>
                  </div>
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

                <label className="mt-3 block text-[11px] font-medium text-muted">
                  Interne notitie
                  <textarea
                    value={notes[v.id] ?? v.interne_notitie ?? ""}
                    onChange={(e) =>
                      setNotes((prev) => ({ ...prev, [v.id]: e.target.value }))
                    }
                    rows={2}
                    className="mt-1 w-full border border-line px-3 py-2 text-sm text-ink outline-none focus:border-green"
                    placeholder="Wat is er gedaan / afgesproken…"
                  />
                </label>

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      patch(v.id, {
                        interne_notitie: notes[v.id] ?? "",
                      })
                    }
                    className="border border-line px-3 py-1.5 text-xs font-semibold hover:bg-wash disabled:opacity-50"
                  >
                    Notitie opslaan
                  </button>
                  {v.status === "open" ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        patch(v.id, {
                          status: "afgehandeld",
                          interne_notitie: notes[v.id] ?? "",
                        })
                      }
                      className="bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                    >
                      Afhandelen → Installatie voltooid
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
