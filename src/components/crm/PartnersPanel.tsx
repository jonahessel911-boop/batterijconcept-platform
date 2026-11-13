"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FileText,
  Receipt,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { TeamRol } from "@/lib/rollen";
import { cn } from "@/lib/utils";
import { CreditfacturenPanel } from "./CreditfacturenPanel";
import { InstellingenPanel } from "./InstellingenPanel";
import { KostenPanel } from "./KostenPanel";
import { OvereenkomstenPanel } from "./OvereenkomstenPanel";

type HubView = "mensen" | "overeenkomsten" | "kosten" | "uitbetalingen";

/** Subfilter binnen Mensen: login-rollen + Installatie partners + Warmtefonds. */
export type TeamSubFilter = "all" | TeamRol | "monteurs" | "warmtefonds";

const HUB_NAV: { key: HubView; label: string; icon: LucideIcon; group: "werk" | "beheer" }[] = [
  { key: "mensen", label: "Mensen", icon: Users, group: "werk" },
  { key: "overeenkomsten", label: "Overeenkomsten", icon: FileText, group: "beheer" },
  { key: "kosten", label: "Kosten", icon: Receipt, group: "beheer" },
  { key: "uitbetalingen", label: "Uitbetalingen", icon: Wallet, group: "beheer" },
];

const TEAM_NAV: { key: TeamSubFilter; label: string }[] = [
  { key: "all", label: "Alles" },
  { key: "admin", label: "Admin" },
  { key: "sales_manager", label: "Sales manager" },
  { key: "adviseur", label: "Adviseurs" },
  { key: "beller", label: "Bellers" },
  { key: "backoffice", label: "Backoffice" },
  { key: "recruiter", label: "Recruiters" },
  { key: "monteurs", label: "Installatie partners" },
  { key: "warmtefonds", label: "Warmtefonds" },
];

function hubFromParams(p: string | null): HubView {
  if (p === "uitbetalingen" || p === "facturen") return "uitbetalingen";
  if (p === "overeenkomsten" || p === "contracten") return "overeenkomsten";
  if (p === "kosten") return "kosten";
  return "mensen";
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
    team === "backoffice" ||
    team === "recruiter"
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
      if (nextHub === "mensen") {
        params.set("partners", "team");
        if (nextSub === "all") params.delete("team");
        else params.set("team", nextSub);
      } else if (nextHub === "overeenkomsten") {
        params.set("partners", "overeenkomsten");
        params.delete("team");
      } else if (nextHub === "kosten") {
        params.set("partners", "kosten");
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
    setHub("mensen");
    syncUrl("mensen", next);
  }

  const gcalOk = searchParams.get("gcal") === "ok";
  const gcalError = searchParams.get("gcal_error");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line bg-white">
        <div className="flex items-center gap-2 overflow-x-auto px-3 py-2 sm:px-4">
          <nav
            className="flex min-w-0 flex-1 items-center gap-1"
            aria-label="Business menu"
          >
            {HUB_NAV.filter((v) => v.group === "werk").map((item) => {
              const Icon = item.icon;
              const active = hub === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => selectHub(item.key)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition",
                    active
                      ? "bg-green text-white"
                      : "text-ink hover:bg-wash"
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </button>
              );
            })}
            <span
              className="mx-1 hidden h-6 w-px shrink-0 bg-line sm:block"
              aria-hidden
            />
            {HUB_NAV.filter((v) => v.group === "beheer").map((item) => {
              const Icon = item.icon;
              const active = hub === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => selectHub(item.key)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition",
                    active
                      ? "bg-green text-white"
                      : "text-muted hover:bg-wash hover:text-ink"
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {hub === "mensen" ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2 sm:px-4">
            {TEAM_NAV.map((item) => {
              const active = teamSub === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => selectTeamSub(item.key)}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition",
                    active
                      ? "bg-wash text-ink ring-1 ring-line"
                      : "text-muted hover:bg-wash/70 hover:text-ink"
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {(gcalOk || gcalError) && (
        <div className="shrink-0 border-b border-line px-3 py-2 sm:px-4">
          {gcalOk ? (
            <p className="rounded-lg border border-green/30 bg-green-soft px-3 py-2 text-sm text-green-dark">
              Google Calendar is gekoppeld. Nieuwe schouw-, installatie- en
              service-afspraken verschijnen direct in die agenda.
            </p>
          ) : null}
          {gcalError ? (
            <p className="rounded-lg border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
              Google Calendar koppelen mislukt ({gcalError}). Probeer opnieuw via
              de installatiepartner → Koppel Google Calendar.
            </p>
          ) : null}
        </div>
      )}

      <div
        className={
          hub === "mensen" || hub === "overeenkomsten" || hub === "kosten"
            ? "min-h-0 flex-1 overflow-hidden"
            : "min-h-0 flex-1 overflow-auto"
        }
      >
        {hub === "mensen" ? (
          <InstellingenPanel
            onAdviseursChange={onAdviseursChange}
            listFilter={listFilterForSub(teamSub)}
            hideListTabs
            hideTeamRolFilter
            forcedTeamRol={teamRolForSub(teamSub)}
          />
        ) : null}

        {hub === "overeenkomsten" ? (
          <OvereenkomstenPanel embedded />
        ) : null}

        {hub === "kosten" ? <KostenPanel embedded /> : null}

        {hub === "uitbetalingen" ? (
          <div className="flex min-h-0 flex-col">
            <div className="shrink-0 border-b border-line px-4 py-2.5 sm:px-5">
              <p className="text-sm text-muted">
                Commissie adviseurs · bel-/opscommissie ·
                installatiepartner-facturen · goedkeuren en betalen
              </p>
            </div>
            <CreditfacturenPanel embedded />
          </div>
        ) : null}
      </div>
    </div>
  );
}
