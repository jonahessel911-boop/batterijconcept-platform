"use client";

import { CrmHeader } from "./CrmHeader";
import { CrmSidebar } from "./CrmSidebar";
import { CRM_TABS } from "./TabNav";
import type { CrmTab } from "@/types/database";

/** Zelfde chrome als CrmShell — voorkomt layout-flash bij terug-navigatie. */
export function CrmPageSkeleton({
  activeTab = "projecten",
}: {
  activeTab?: CrmTab;
}) {
  const tabs = CRM_TABS.filter((t) =>
    ["leads", "bellen", "agenda", "offertes", "netto", "instroom", "projecten", "facturen", "inkomend", "rapportage", "admin", "instellingen"].includes(
      t.id
    )
  );

  return (
    <div className="crm-bg flex min-h-screen flex-col">
      <CrmHeader
        activeTab={activeTab}
        tabs={tabs}
        hideTabNav
        showBekijkAls={false}
      />

      <div className="flex w-full flex-1">
        <CrmSidebar
          active={activeTab}
          onChange={() => {}}
          allowedTabs={tabs.map((t) => t.id)}
          collapsed={false}
          onToggleCollapsed={() => {}}
          mobileOpen={false}
          onMobileClose={() => {}}
        />

        <main className="flex min-w-0 flex-1 flex-col px-3 py-4 sm:px-6 sm:py-8">
          <div className="mb-4 sm:mb-5">
            <div className="h-8 w-48 animate-pulse rounded bg-wash" />
            <div className="mt-2 h-4 w-64 animate-pulse rounded bg-wash" />
          </div>

          <div className="flex flex-1 flex-col overflow-hidden border border-line bg-white">
            <div className="flex-1 overflow-auto p-4">
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-11 animate-pulse rounded bg-wash"
                  />
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
