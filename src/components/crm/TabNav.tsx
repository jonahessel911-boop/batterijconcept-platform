"use client";

import type { CrmTab } from "@/types/database";

export const CRM_TABS: { id: CrmTab; label: string }[] = [
  { id: "leads", label: "Leads" },
  { id: "bellen", label: "Bellen" },
  { id: "agenda", label: "Agenda" },
  { id: "offertes", label: "Offertes" },
  { id: "projecten", label: "Projecten" },
  { id: "facturen", label: "Facturen" },
  { id: "rapportage", label: "Rapportage" },
  { id: "instellingen", label: "Instellingen" },
];

/** Desktop tab-balk (verborgen op telefoon — daar hamburger) */
export function TabNav({
  active,
  onChange,
  counts,
}: {
  active: CrmTab;
  onChange: (tab: CrmTab) => void;
  counts?: Partial<Record<CrmTab, number>>;
}) {
  return (
    <nav className="hidden gap-0 border-b border-line px-5 md:flex">
      {CRM_TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={[
              "relative shrink-0 px-4 py-3 text-sm font-medium transition-colors",
              isActive
                ? "text-green-deeper"
                : "text-muted hover:text-ink",
            ].join(" ")}
          >
            <span className="font-display tracking-tight">{tab.label}</span>
            {typeof counts?.[tab.id] === "number" && (
              <span
                className={[
                  "ml-2 inline-flex min-w-[1.25rem] items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                  isActive
                    ? "bg-green text-white"
                    : "bg-[#eef1ef] text-muted",
                ].join(" ")}
              >
                {counts[tab.id]}
              </span>
            )}
            {isActive && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-green" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
