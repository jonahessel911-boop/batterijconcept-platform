"use client";

import { useState } from "react";
import type { Project } from "@/types/database";
import {
  ENERGIE_CONTRACT_TYPE_LABEL,
  ENERGIE_CONTRACT_TYPES,
  ENERGIE_OVERSTAP_LEVERANCIER_LABEL,
  ENERGIE_OVERSTAP_LEVERANCIERS,
  energieFormFromRow,
  formatEnergieContractEinddatum,
  isEnergieContractType,
  isEnergieOverstapLeverancier,
  validateEnergieVerbruikForm,
  type EnergieVerbruikFormValues,
} from "@/lib/energie-contract";

function PencilIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** Compacte weergave + bewerken energieverbruik voor overstap (backoffice). */
export function EnergieFrankCard({
  project,
  compact = false,
  onUpdated,
}: {
  project: Project;
  compact?: boolean;
  onUpdated?: (project: Project) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EnergieVerbruikFormValues>(() =>
    energieFormFromRow(project)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAny =
    project.elektra_verbruik_kwh != null ||
    project.gas_verbruik_m3 != null ||
    project.teruglevering_kwh != null ||
    project.energie_contract_type != null ||
    project.energie_overstap_leverancier != null;

  function openEdit() {
    setDraft(energieFormFromRow(project));
    setError(null);
    setEditing(true);
  }

  async function save() {
    const parsed = validateEnergieVerbruikForm(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      const updated = (data as { project?: Project }).project;
      if (project.offerte_id) {
        await fetch(`/api/offertes/${project.offerte_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        }).catch(() => {
          /* project is leidend */
        });
      }
      if (updated) onUpdated?.(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  const type = project.energie_contract_type;
  const typeLabel = isEnergieContractType(type)
    ? ENERGIE_CONTRACT_TYPE_LABEL[type]
    : type || "—";
  const leverancier = project.energie_overstap_leverancier;
  const leverancierLabel = isEnergieOverstapLeverancier(leverancier)
    ? ENERGIE_OVERSTAP_LEVERANCIER_LABEL[leverancier]
    : "—";

  const shellCls = hasAny
    ? "border border-[#0a4727]/20 bg-[#F7F9F7]"
    : "border border-[#CA8A04]/30 bg-[#FFFBEB]";
  const titleCls = hasAny ? "text-[#0a4727]" : "text-[#854D0E]";

  return (
    <section className={`${shellCls} px-4 py-3 ${compact ? "px-3.5" : "sm:px-5"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${titleCls}`}
          >
            Energie-overstap
          </p>
          {!hasAny && !editing ? (
            <p className="mt-1 text-[13px] text-[#854D0E]">
              Nog niet ingevuld — klik het potlood om elektra, gas en contract
              te zetten.
            </p>
          ) : null}
        </div>
        {editing ? (
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="border border-line bg-white px-2 py-1 text-[11px] font-medium text-muted hover:bg-wash disabled:opacity-50"
            >
              Annuleren
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="bg-orange px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50"
            >
              {saving ? "Opslaan…" : "Opslaan"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={openEdit}
            className="inline-flex shrink-0 items-center gap-1 border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink hover:bg-wash"
            title="Energieverbruik bewerken"
            aria-label="Energieverbruik bewerken"
          >
            <PencilIcon />
            Bewerken
          </button>
        )}
      </div>

      {error ? (
        <p className="mt-2 text-xs font-medium text-[#C62828]">{error}</p>
      ) : null}

      {editing ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {ENERGIE_OVERSTAP_LEVERANCIERS.map((l) => {
              const active = draft.energieOverstapLeverancier === l;
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      energieOverstapLeverancier: active ? "" : l,
                    }))
                  }
                  className={[
                    "min-h-8 border px-2.5 py-1 text-xs font-semibold",
                    active
                      ? "border-[#0a4727] bg-[#0a4727] text-white"
                      : "border-line bg-white text-ink hover:bg-wash",
                  ].join(" ")}
                >
                  {ENERGIE_OVERSTAP_LEVERANCIER_LABEL[l]}
                </button>
              );
            })}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Elektra (kWh/jaar)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={draft.elektraVerbruikKwh}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, elektraVerbruikKwh: e.target.value }))
                }
                className="mt-1 w-full border border-line bg-white px-2 py-1.5 text-sm font-medium normal-case tracking-normal text-ink outline-none focus:border-green"
              />
            </label>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Gas (m³/jaar)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={draft.gasVerbruikM3}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, gasVerbruikM3: e.target.value }))
                }
                className="mt-1 w-full border border-line bg-white px-2 py-1.5 text-sm font-medium normal-case tracking-normal text-ink outline-none focus:border-green"
              />
            </label>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted sm:col-span-2">
              Teruglevering (kWh/jaar)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={draft.terugleveringKwh}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, terugleveringKwh: e.target.value }))
                }
                className="mt-1 w-full border border-line bg-white px-2 py-1.5 text-sm font-medium normal-case tracking-normal text-ink outline-none focus:border-green"
              />
            </label>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Contract
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ENERGIE_CONTRACT_TYPES.map((t) => {
                const active = draft.energieContractType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        energieContractType: active ? "" : t,
                        ...(t !== "vast" ? { energieContractEinddatum: "" } : {}),
                      }))
                    }
                    className={[
                      "min-h-8 border px-2.5 py-1 text-xs font-semibold",
                      active
                        ? "border-[#0a4727] bg-[#0a4727] text-white"
                        : "border-line bg-white text-ink hover:bg-wash",
                    ].join(" ")}
                  >
                    {ENERGIE_CONTRACT_TYPE_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </div>
          {draft.energieContractType === "vast" ? (
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Einddatum vast contract
              <input
                type="date"
                value={draft.energieContractEinddatum}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    energieContractEinddatum: e.target.value,
                  }))
                }
                className="mt-1 w-full border border-line bg-white px-2 py-1.5 text-sm font-medium normal-case tracking-normal text-ink outline-none focus:border-green"
              />
            </label>
          ) : null}
        </div>
      ) : hasAny ? (
        <dl
          className={`mt-2 grid gap-2 text-[13px] ${compact ? "" : "sm:grid-cols-2"}`}
        >
          <div className={compact ? "" : "sm:col-span-2"}>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Leverancier
            </dt>
            <dd className="font-semibold text-ink">{leverancierLabel}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Elektra
            </dt>
            <dd className="font-semibold tabular-nums text-ink">
              {project.elektra_verbruik_kwh != null
                ? `${Number(project.elektra_verbruik_kwh).toLocaleString("nl-NL")} kWh/jaar`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Gas
            </dt>
            <dd className="font-semibold tabular-nums text-ink">
              {project.gas_verbruik_m3 != null
                ? `${Number(project.gas_verbruik_m3).toLocaleString("nl-NL")} m³/jaar`
                : "Geen / niet ingevuld"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Teruglevering
            </dt>
            <dd className="font-semibold tabular-nums text-ink">
              {project.teruglevering_kwh != null
                ? `${Number(project.teruglevering_kwh).toLocaleString("nl-NL")} kWh/jaar`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Contract
            </dt>
            <dd className="font-semibold text-ink">
              {typeLabel}
              {type === "vast" ? (
                <span className="font-medium text-muted">
                  {" "}
                  · eind{" "}
                  {formatEnergieContractEinddatum(
                    project.energie_contract_einddatum
                  )}
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
