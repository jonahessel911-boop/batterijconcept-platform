"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CreditfacturenPanel } from "./CreditfacturenPanel";
import { InstellingenPanel } from "./InstellingenPanel";

type PartnersView = "team" | "facturen";

export function PartnersPanel({
  onAdviseursChange,
}: {
  onAdviseursChange?: () => void;
}) {
  const searchParams = useSearchParams();
  const initialView: PartnersView = (() => {
    const p = searchParams.get("partners");
    if (p === "uitbetalingen" || p === "facturen") return "facturen";
    return "team";
  })();
  const [view, setView] = useState<PartnersView>(initialView);

  useEffect(() => {
    const p = searchParams.get("partners");
    if (p === "uitbetalingen" || p === "facturen") setView("facturen");
    else setView("team");
  }, [searchParams]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-white px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex border border-line p-0.5">
            <button
              type="button"
              onClick={() => setView("team")}
              className={[
                "px-3 py-1.5 text-xs font-semibold",
                view === "team"
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              Team
            </button>
            <button
              type="button"
              onClick={() => setView("facturen")}
              className={[
                "px-3 py-1.5 text-xs font-semibold",
                view === "facturen"
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              Uitbetalingen
            </button>
          </div>
          <p className="text-xs text-muted">
            {view === "team"
              ? "Actief = wordt ingepland · Inactief = niet · commissie standaard 10%"
              : "Commissie- en partnerfacturen"}
          </p>
        </div>
      </div>

      {view === "facturen" ? (
        <CreditfacturenPanel />
      ) : (
        <InstellingenPanel onAdviseursChange={onAdviseursChange} />
      )}
    </div>
  );
}
