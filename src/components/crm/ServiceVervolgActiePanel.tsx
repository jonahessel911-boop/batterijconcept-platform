"use client";

import { useMemo, useState } from "react";
import { fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import type { Project } from "@/types/database";
import {
  VERVOLG_OPLEVERFORMULIER_LABEL,
  formatServiceVvNotitie,
  parseOpleverFormulierSnapshot,
} from "@/lib/oplever-formulier";
import {
  parseServiceInkoopRegels,
  setServiceInkoopRegels,
  type ServiceInkoopRegel,
} from "@/lib/project-inkoop-checklist";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function datetimeLocalToIso(value: string): string {
  const t = value.trim();
  if (!t) return "";
  const d = fromZonedTime(t, AMSTERDAM_TZ);
  if (Number.isNaN(d.getTime())) return t;
  return d.toISOString();
}

export function ServiceVervolgActiePanel({
  project,
  telefoon,
  serviceVerzoekId,
  onUpdated,
}: {
  project: Project;
  telefoon?: string | null;
  serviceVerzoekId?: string | null;
  onUpdated?: (p: Project) => void;
}) {
  const snap = parseOpleverFormulierSnapshot(project.oplever_formulier);
  const verzoekId =
    serviceVerzoekId || snap?.vervolgServiceVerzoekId || null;
  const [rows, setRows] = useState<ServiceInkoopRegel[]>(() =>
    parseServiceInkoopRegels(project.materiaal_checks)
  );
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState<"mat" | "plan" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const wat = snap?.vervolgActie?.trim() || "Restpunt na oplevering.";
  const tel = (telefoon || "").trim();

  const dirty = useMemo(() => {
    const a = JSON.stringify(parseServiceInkoopRegels(project.materiaal_checks));
    const b = JSON.stringify(
      rows
        .filter((r) => r.label.trim())
        .map((r) => ({
          id: r.id,
          label: r.label.trim(),
          aantal: r.aantal,
        }))
    );
    return a !== b;
  }, [project.materiaal_checks, rows]);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/projecten/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        (data as { error?: string }).error || "Opslaan mislukt"
      );
    }
    return data.project as Project;
  }

  async function saveMaterialen() {
    setBusy("mat");
    setError(null);
    setMsg(null);
    try {
      const next = setServiceInkoopRegels(
        project.materiaal_checks,
        rows.filter((r) => r.label.trim())
      );
      const p = await patch({ materiaal_checks: next });
      onUpdated?.(p);
      setRows(parseServiceInkoopRegels(p.materiaal_checks));
      setMsg("Inkoopregels opgeslagen — zichtbaar in Purchasing.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function planService() {
    const iso = datetimeLocalToIso(when);
    if (!iso) {
      setError("Kies datum en tijd voor de service.");
      return;
    }
    if (!project.installatie_partner_id) {
      setError("Koppel eerst een installatiepartner op het project.");
      return;
    }
    setBusy("plan");
    setError(null);
    setMsg(null);
    try {
      let verzoek = verzoekId;
      if (!verzoek) {
        const created = await fetch("/api/service-verzoeken", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: project.id,
            onderwerp: VERVOLG_OPLEVERFORMULIER_LABEL,
            omschrijving: wat,
          }),
        });
        const createdData = await created.json().catch(() => ({}));
        if (created.ok) {
          verzoek =
            (createdData as { verzoek?: { id?: string } }).verzoek?.id ||
            null;
        }
      }
      const res = await fetch(`/api/projecten/${project.id}/service`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_at: iso,
          installatie_partner_id: project.installatie_partner_id,
          service_notities: formatServiceVvNotitie(wat),
          service_verzoek_id: verzoek,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Inplannen mislukt"
        );
      }
      const p = (data as { project?: Project }).project;
      if (p) onUpdated?.(p);
      else onUpdated?.({ ...project, service_at: iso });
      setMsg("Service-afspraak gezet.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inplannen mislukt");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-sm border border-line bg-white px-3.5 py-3">
      <div>
        <p className="text-sm font-semibold text-ink">
          Serviceverzoek · Vervolg Opleverformulier
        </p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
          Restpunt na oplevering. Bel de klant om een service-moment in te
          plannen (geen mail).
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{wat}</p>
        {tel ? (
          <a
            href={`tel:${tel.replace(/\s+/g, "")}`}
            className="mt-2 inline-flex h-9 items-center bg-green px-3 text-xs font-semibold text-white hover:bg-green-dark"
          >
            Bel {tel}
          </a>
        ) : (
          <p className="mt-2 text-xs text-[#C45A12]">Geen telefoonnummer.</p>
        )}
      </div>

      <div className="space-y-1.5 border-t border-line pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          In te kopen voor dit serviceverzoek
        </p>
        {rows.map((row, i) => (
          <div key={row.id} className="flex gap-2">
            <input
              value={row.label}
              onChange={(e) =>
                setRows((list) =>
                  list.map((r, j) =>
                    j === i ? { ...r, label: e.target.value } : r
                  )
                )
              }
              placeholder="Materiaal / onderdeel"
              className="min-w-0 flex-1 border border-line bg-white px-2.5 py-1.5 text-sm outline-none focus:border-green"
            />
            <input
              type="number"
              min={1}
              value={row.aantal}
              onChange={(e) =>
                setRows((list) =>
                  list.map((r, j) =>
                    j === i
                      ? {
                          ...r,
                          aantal: Math.max(1, Number(e.target.value) || 1),
                        }
                      : r
                  )
                )
              }
              className="w-16 border border-line px-2 py-1.5 text-sm tabular-nums outline-none focus:border-green"
              aria-label="Aantal"
            />
            <button
              type="button"
              className="px-2 text-xs font-semibold text-muted hover:text-ink"
              onClick={() =>
                setRows((list) => list.filter((_, j) => j !== i))
              }
            >
              ×
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="text-xs font-semibold text-green-dark hover:underline"
            onClick={() =>
              setRows((list) => [
                ...list,
                { id: newId(), label: "", aantal: 1 },
              ])
            }
          >
            + Regel toevoegen
          </button>
          <button
            type="button"
            disabled={busy !== null || !dirty}
            onClick={() => void saveMaterialen()}
            className="inline-flex h-8 items-center border border-line px-2.5 text-xs font-semibold text-ink disabled:opacity-50"
          >
            {busy === "mat" ? "Opslaan…" : "Inkoop opslaan"}
          </button>
        </div>
      </div>

      <div className="space-y-1.5 border-t border-line pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Service-afspraak inplannen
        </p>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="w-full border border-line px-2.5 py-1.5 text-sm outline-none focus:border-green"
        />
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void planService()}
          className="inline-flex h-9 items-center bg-green px-3 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
        >
          {busy === "plan" ? "Bezig…" : "Afspraak zetten"}
        </button>
      </div>

      {error ? (
        <p className="text-xs text-[#C45A12]">{error}</p>
      ) : null}
      {msg ? <p className="text-xs text-green-dark">{msg}</p> : null}
    </div>
  );
}
