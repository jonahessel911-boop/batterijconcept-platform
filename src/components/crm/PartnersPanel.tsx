"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CreditfacturenPanel } from "./CreditfacturenPanel";
import { InstellingenPanel } from "./InstellingenPanel";

type PartnersView =
  | "medewerkers"
  | "partners"
  | "warmtefonds"
  | "facturen";

const TABS: { key: PartnersView; label: string }[] = [
  { key: "medewerkers", label: "Team" },
  { key: "partners", label: "Installatiepartners" },
  { key: "warmtefonds", label: "Warmtefonds" },
  { key: "facturen", label: "Uitbetalingen" },
];

function viewFromParams(p: string | null): PartnersView {
  if (p === "uitbetalingen" || p === "facturen") return "facturen";
  if (p === "partners" || p === "installatie") return "partners";
  if (p === "warmtefonds") return "warmtefonds";
  return "medewerkers";
}

export function PartnersPanel({
  onAdviseursChange,
}: {
  onAdviseursChange?: () => void;
}) {
  const searchParams = useSearchParams();
  const [view, setView] = useState<PartnersView>(() =>
    viewFromParams(searchParams.get("partners"))
  );

  useEffect(() => {
    setView(viewFromParams(searchParams.get("partners")));
  }, [searchParams]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 border border-line bg-white px-4 py-3 sm:px-5">
        <div className="flex flex-wrap border border-line p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setView(tab.key)}
              className={[
                "px-3 py-1.5 text-xs font-semibold",
                view === tab.key
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          {view === "facturen"
            ? "Commissie- en partnerfacturen"
            : view === "medewerkers"
              ? "Login-accounts: Admin · Adviseur · Beller · Backoffice"
              : view === "warmtefonds"
                ? "Warmtefonds-partners en portaallinks"
                : "Installatiepartners voor schouw en montage"}
        </p>
      </div>

      {view === "facturen" ? (
        <CreditfacturenPanel />
      ) : (
        <InstellingenPanel
          onAdviseursChange={onAdviseursChange}
          listFilter={view}
          hideListTabs
        />
      )}
    </div>
  );
}
