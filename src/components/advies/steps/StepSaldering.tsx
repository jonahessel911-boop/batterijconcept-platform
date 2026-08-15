"use client";

import { SalderingScene } from "../SalderingScene";
import { stepEyebrow, stepLead, stepTitle } from "../ui";

export function StepSaldering({ leadNaam }: { leadNaam: string }) {
  return (
    <div className="space-y-6">
      <div>
        <p className={stepEyebrow}>Stap 3 · Saldering uitleggen</p>
        <h1 className={stepTitle}>Wat verandert er voor {leadNaam}?</h1>
        <p className={stepLead}>
          Bekijk samen de slides. Zo wordt duidelijk wat er nú gebeurt — en wat
          er verandert vanaf 1 januari 2027.
        </p>
      </div>

      <SalderingScene playing leadNaam={leadNaam} />
    </div>
  );
}
