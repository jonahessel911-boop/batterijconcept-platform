"use client";

import type { Project } from "@/types/database";
import {
  ENERGIE_CONTRACT_TYPE_LABEL,
  ENERGIE_OVERSTAP_LEVERANCIER_LABEL,
  formatEnergieContractEinddatum,
  isEnergieContractType,
  isEnergieOverstapLeverancier,
} from "@/lib/energie-contract";

/** Compacte weergave energieverbruik voor overstap (backoffice). */
export function EnergieFrankCard({ project }: { project: Project }) {
  const hasAny =
    project.elektra_verbruik_kwh != null ||
    project.gas_verbruik_m3 != null ||
    project.teruglevering_kwh != null ||
    project.energie_contract_type != null ||
    project.energie_overstap_leverancier != null;

  if (!hasAny) {
    return (
      <section className="border border-[#CA8A04]/30 bg-[#FFFBEB] px-4 py-3 sm:px-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#854D0E]">
          Energie-overstap
        </p>
        <p className="mt-1 text-[13px] text-[#854D0E]">
          Nog niet ingevuld door sales — bel de klant voor elektra/gas/teruglevering
          en contracttype. Kies Frank of Next Energy.
        </p>
      </section>
    );
  }

  const type = project.energie_contract_type;
  const typeLabel = isEnergieContractType(type)
    ? ENERGIE_CONTRACT_TYPE_LABEL[type]
    : type || "—";
  const leverancier = project.energie_overstap_leverancier;
  const leverancierLabel = isEnergieOverstapLeverancier(leverancier)
    ? ENERGIE_OVERSTAP_LEVERANCIER_LABEL[leverancier]
    : "—";

  return (
    <section className="border border-[#0a4727]/20 bg-[#F7F9F7] px-4 py-3 sm:px-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0a4727]">
        Energie-overstap
      </p>
      <dl className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2">
        <div className="sm:col-span-2">
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
    </section>
  );
}
