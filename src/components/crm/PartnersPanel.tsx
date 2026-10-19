"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TeamRol } from "@/lib/rollen";
import { CreditfacturenPanel } from "./CreditfacturenPanel";
import { InstellingenPanel } from "./InstellingenPanel";
import { OvereenkomstenPanel } from "./OvereenkomstenPanel";

type HubView = "team" | "overeenkomsten" | "uitbetalingen";

/** Subfilter binnen Team: login-rollen + Monteurs + Warmtefonds. */
export type TeamSubFilter = "all" | TeamRol | "monteurs" | "warmtefonds";

const HUB_TABS: { key: HubView; label: string }[] = [
  { key: "team", label: "Team" },
  { key: "overeenkomsten", label: "Overeenkomsten" },
  { key: "uitbetalingen", label: "Uitbetalingen" },
];

const TEAM_NAV: { key: TeamSubFilter; label: string }[] = [
  { key: "all", label: "Alles" },
  { key: "admin", label: "Admin" },
  { key: "sales_manager", label: "Sales manager" },
  { key: "adviseur", label: "Adviseurs" },
  { key: "beller", label: "Bellers" },
  { key: "backoffice", label: "Backoffice" },
  { key: "monteurs", label: "Monteurs" },
  { key: "warmtefonds", label: "Warmtefonds" },
];

function hubFromParams(p: string | null): HubView {
  if (p === "uitbetalingen" || p === "facturen") return "uitbetalingen";
  if (p === "overeenkomsten" || p === "contracten") return "overeenkomsten";
  return "team";
}

function teamSubFromParams(
  partners: string | null,
  team: string | null
): TeamSubFilter {
  if (partners === "warmtefonds" || team === "warmtefonds") return "warmtefonds";
  if (
    partners === "partners" ||
    partners === "installatie" ||
    partners === "monteurs" ||
    team === "monteurs" ||
    team === "partners"
  ) {
    return "monteurs";
  }
  if (
    team === "admin" ||
    team === "sales_manager" ||
    team === "adviseur" ||
    team === "beller" ||
    team === "backoffice"
  ) {
    return team;
  }
  return "all";
}

function listFilterForSub(
  sub: TeamSubFilter
): "medewerkers" | "partners" | "warmtefonds" {
  if (sub === "monteurs") return "partners";
  if (sub === "warmtefonds") return "warmtefonds";
  return "medewerkers";
}

function teamRolForSub(sub: TeamSubFilter): "all" | TeamRol {
  if (sub === "all" || sub === "monteurs" || sub === "warmtefonds") return "all";
  return sub;
}

export function PartnersPanel({
  onAdviseursChange,
}: {
  onAdviseursChange?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [hub, setHub] = useState<HubView>(() =>
    hubFromParams(searchParams.get("partners"))
  );
  const [teamSub, setTeamSub] = useState<TeamSubFilter>(() =>
    teamSubFromParams(searchParams.get("partners"), searchParams.get("team"))
  );

  useEffect(() => {
    setHub(hubFromParams(searchParams.get("partners")));
    setTeamSub(
      teamSubFromParams(searchParams.get("partners"), searchParams.get("team"))
    );
  }, [searchParams]);

  const syncUrl = useCallback(
    (nextHub: HubView, nextSub: TeamSubFilter) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", "partners");
      if (nextHub === "team") {
        params.set("partners", "team");
        if (nextSub === "all") params.delete("team");
        else params.set("team", nextSub);
      } else if (nextHub === "overeenkomsten") {
        params.set("partners", "overeenkomsten");
        params.delete("team");
      } else {
        params.set("partners", "uitbetalingen");
        params.delete("team");
      }
      router.replace(`/?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  function selectHub(next: HubView) {
    setHub(next);
    syncUrl(next, teamSub);
  }

  function selectTeamSub(next: TeamSubFilter) {
    setTeamSub(next);
    setHub("team");
    syncUrl("team", next);
  }

  const gcalOk = searchParams.get("gcal") === "ok";
  const gcalError = searchParams.get("gcal_error");

  return (
    <div className="space-y-3">
      {gcalOk && (
        <p className="border border-green/30 bg-green-soft px-4 py-3 text-sm text-green-dark">
          Google Calendar is gekoppeld. Nieuwe schouw-, installatie- en
          service-afspraken verschijnen direct in die agenda.
        </p>
      )}
      {gcalError && (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
          Google Calendar koppelen mislukt ({gcalError}). Probeer opnieuw via
          de monteur → Koppel Google Calendar.
        </p>
      )}

      {/* Eén simpele top-switch */}
      <div className="flex flex-wrap gap-0 border border-line bg-white p-0.5">
        {HUB_TABS.map((tab) => {
          const active = hub === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => selectHub(tab.key)}
              className={[
                "min-h-10 flex-1 px-3 text-sm font-semibold transition sm:flex-none sm:px-5",
                active
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash hover:text-ink",
              ].join(" ")}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {hub === "team" ? (
        <div className="grid gap-3 lg:grid-cols-[200px_minmax(0,1fr)]">
          {/* Linker menu — één klik per type */}
          <nav
            className="border border-line bg-white p-1.5"
            aria-label="Teamfilter"
          >
            <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
              {TEAM_NAV.map((item, i) => {
                const active = teamSub === item.key;
                const showDivider = item.key === "monteurs";
                return (
                  <li
                    key={item.key}
                    className={[
                      "shrink-0 lg:w-full",
                      showDivider
                        ? "lg:mt-1 lg:border-t lg:border-line lg:pt-1"
                        : "",
                    ].join(" ")}
                  >
                    {showDivider && i > 0 ? (
                      <span className="mr-1 hidden" aria-hidden />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => selectTeamSub(item.key)}
                      className={[
                        "w-full px-3 py-2.5 text-left text-sm font-semibold transition",
                        active
                          ? "bg-green text-white"
                          : "text-ink hover:bg-wash",
                      ].join(" ")}
                    >
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-w-0">
            <InstellingenPanel
              onAdviseursChange={onAdviseursChange}
              listFilter={listFilterForSub(teamSub)}
              hideListTabs
              hideTeamRolFilter
              forcedTeamRol={teamRolForSub(teamSub)}
              monteurLabel
            />
          </div>
        </div>
      ) : null}

      {hub === "overeenkomsten" ? (
        <div className="border border-line bg-white">
          <OvereenkomstenPanel embedded />
        </div>
      ) : null}

      {hub === "uitbetalingen" ? (
        <div className="border border-line bg-white">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <p className="text-sm text-muted">
              Commissie adviseurs · monteurfacturen · goedkeuren en betalen
            </p>
          </div>
          <CreditfacturenPanel embedded />
        </div>
      ) : null}
    </div>
  );
}
