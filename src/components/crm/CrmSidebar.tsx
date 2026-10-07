"use client";

import { useEffect, useState } from "react";
import type { CrmTab } from "@/types/database";
import { BO_VIEWS } from "@/lib/bo-view";
import { useBoViewStore } from "@/lib/bo-view-store";

type SidebarItem = {
  id: CrmTab;
  label: string;
  icon: React.ReactNode;
};

type SidebarGroup = {
  id: string;
  label: string;
  items: SidebarItem[];
};

function Icon({
  children,
  className = "h-4 w-4",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  leads: (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  ),
  bellen: (
    <Icon>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.74.32 1.53.55 2.34.68A2 2 0 0 1 22 16.92z" />
    </Icon>
  ),
  agenda: (
    <Icon>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </Icon>
  ),
  offertes: (
    <Icon>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </Icon>
  ),
  netto: (
    <Icon>
      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </Icon>
  ),
  instroom: (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </Icon>
  ),
  projecten: (
    <Icon>
      <path d="M3 9h18M9 21V9M5 21h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z" />
    </Icon>
  ),
  facturen: (
    <Icon>
      <path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2z" />
      <path d="M8 10h8M8 14h5" />
    </Icon>
  ),
  creditfacturen: (
    <Icon>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h4" />
    </Icon>
  ),
  inkomend: (
    <Icon>
      <path d="M4 4h16v16H4z" />
      <path d="m22 6-10 7L2 6" />
    </Icon>
  ),
  purchasing: (
    <Icon>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
    </Icon>
  ),
  rapportage: (
    <Icon>
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </Icon>
  ),
  admin: (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </Icon>
  ),
  partners: (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  ),
  instellingen: (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Icon>
  ),
};

const GROUPS: SidebarGroup[] = [
  {
    id: "mijn",
    label: "Mijn werk",
    items: [{ id: "taken", label: "Agenda", icon: ICONS.admin }],
  },
  {
    id: "sales",
    label: "Sales",
    items: [
      { id: "leads", label: "Leads", icon: ICONS.leads },
      { id: "bellen", label: "Bellen", icon: ICONS.bellen },
      { id: "agenda", label: "Agenda", icon: ICONS.agenda },
      { id: "offertes", label: "Offertes", icon: ICONS.offertes },
      { id: "netto", label: "Netto", icon: ICONS.netto },
      { id: "leaderboard", label: "Leaderboard", icon: ICONS.offertes },
    ],
  },
  {
    id: "operatie",
    label: "Operatie",
    items: [
      { id: "projecten", label: "Backoffice", icon: ICONS.projecten },
      { id: "purchasing", label: "Purchasing", icon: ICONS.purchasing },
      { id: "facturen", label: "Facturen", icon: ICONS.facturen },
      { id: "inkomend", label: "Inkomend", icon: ICONS.inkomend },
      { id: "instroom", label: "Recruitment", icon: ICONS.instroom },
    ],
  },
  {
    id: "sturing",
    label: "Sturing",
    items: [
      { id: "rapportage", label: "Rapportage", icon: ICONS.rapportage },
      { id: "admin", label: "Admin", icon: ICONS.admin },
      { id: "partners", label: "Partners", icon: ICONS.partners },
    ],
  },
];

const COLLAPSE_KEY = "bc_crm_sidebar_collapsed_v1";
const BO_OPEN_KEY = "bc_crm_sidebar_bo_open_v1";

export function CrmSidebar({
  active,
  onChange,
  counts,
  allowedTabs,
  collapsed = false,
  onToggleCollapsed,
  mobileOpen = false,
  onMobileClose,
  boCounts,
}: {
  active: CrmTab;
  onChange: (tab: CrmTab) => void;
  counts?: Partial<Record<CrmTab, number>>;
  allowedTabs: CrmTab[];
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  boCounts?: { acties?: number; schouwweek?: number };
}) {
  const [activeBoView, setBoView] = useBoViewStore();
  const allowed = new Set(allowedTabs);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") {
      return { sales: true, operatie: true, sturing: true };
    }
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) return JSON.parse(raw) as Record<string, boolean>;
    } catch {
      /* ignore */
    }
    return { sales: true, operatie: true, sturing: true };
  });
  const [boOpen, setBoOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const raw = localStorage.getItem(BO_OPEN_KEY);
      if (raw === "0") return false;
      if (raw === "1") return true;
    } catch {
      /* ignore */
    }
    return true;
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(openGroups));
    } catch {
      /* ignore */
    }
  }, [openGroups]);

  useEffect(() => {
    try {
      localStorage.setItem(BO_OPEN_KEY, boOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [boOpen]);

  useEffect(() => {
    for (const g of GROUPS) {
      if (g.items.some((i) => i.id === active)) {
        setOpenGroups((prev) =>
          prev[g.id] ? prev : { ...prev, [g.id]: true }
        );
        break;
      }
    }
  }, [active]);

  useEffect(() => {
    if (
      active === "projecten" ||
      active === "purchasing" ||
      active === "facturen"
    ) {
      setBoOpen(true);
    }
  }, [active]);

  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => allowed.has(i.id)),
  })).filter((g) => g.items.length > 0);

  function toggleGroup(id: string) {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const actieCount = boCounts?.acties ?? 0;
  const weekCount = boCounts?.schouwweek ?? 0;
  const hasBackoffice = allowed.has("projecten");
  const boParentActive =
    active === "projecten" ||
    (hasBackoffice && (active === "purchasing" || active === "facturen"));
  const showBoChildren = !collapsed && boOpen;
  const boExtraTabs: SidebarItem[] = hasBackoffice
    ? [
        ...(allowed.has("purchasing")
          ? [
              {
                id: "purchasing" as const,
                label: "Purchasing",
                icon: ICONS.purchasing,
              },
            ]
          : []),
        ...(allowed.has("facturen")
          ? [
              {
                id: "facturen" as const,
                label: "Facturen",
                icon: ICONS.facturen,
              },
            ]
          : []),
      ]
    : [];

  function renderNav() {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-3">
          {!collapsed ? (
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Menu
            </p>
          ) : (
            <span className="sr-only">Menu</span>
          )}
          {onToggleCollapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="hidden h-8 w-8 items-center justify-center border border-line text-muted hover:bg-wash hover:text-ink md:inline-flex"
              title={collapsed ? "Sidebar uitklappen" : "Sidebar inklappen"}
              aria-label={
                collapsed ? "Sidebar uitklappen" : "Sidebar inklappen"
              }
            >
              <Icon className="h-3.5 w-3.5">
                {collapsed ? (
                  <path d="m9 18 6-6-6-6" />
                ) : (
                  <path d="m15 18-6-6 6-6" />
                )}
              </Icon>
            </button>
          ) : null}
          {onMobileClose ? (
            <button
              type="button"
              onClick={onMobileClose}
              className="inline-flex h-8 w-8 items-center justify-center border border-line text-muted hover:bg-wash md:hidden"
              aria-label="Menu sluiten"
            >
              ✕
            </button>
          ) : null}
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {groups.map((group) => {
            const isOpen = collapsed ? true : openGroups[group.id] !== false;
            return (
              <div key={group.id} className="mb-3">
                {!collapsed ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="mb-1 flex w-full items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted hover:text-ink"
                  >
                    <span>{group.label}</span>
                    <span className="text-[10px] opacity-60">
                      {isOpen ? "▾" : "▸"}
                    </span>
                  </button>
                ) : (
                  <div className="mb-1 h-px bg-line" />
                )}

                {isOpen ? (
                  <ul className="space-y-0.5">
                    {group.items.map((item) => {
                      if (
                        hasBackoffice &&
                        (item.id === "purchasing" || item.id === "facturen")
                      ) {
                        return null;
                      }
                      if (item.id === "projecten") {
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => {
                                if (collapsed) {
                                  onToggleCollapsed?.();
                                  setBoOpen(true);
                                  onChange("projecten");
                                  onMobileClose?.();
                                  return;
                                }
                                if (!boOpen) {
                                  setBoOpen(true);
                                  if (active !== "projecten") {
                                    onChange("projecten");
                                  }
                                  return;
                                }
                                if (active !== "projecten") {
                                  onChange("projecten");
                                  return;
                                }
                                setBoOpen(false);
                              }}
                              title={item.label}
                              className={[
                                "flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-sm font-medium transition-colors",
                                boParentActive
                                  ? "bg-green-soft text-green-deeper"
                                  : "text-ink hover:bg-wash",
                                collapsed ? "justify-center" : "",
                              ].join(" ")}
                            >
                              <span
                                className={[
                                  "shrink-0",
                                  boParentActive
                                    ? "text-green-deeper"
                                    : "text-muted",
                                ].join(" ")}
                              >
                                {item.icon}
                              </span>
                              {!collapsed ? (
                                <>
                                  <span className="min-w-0 flex-1 truncate font-display tracking-tight">
                                    {item.label}
                                  </span>
                                  {actieCount > 0 ? (
                                    <span className="inline-flex min-w-[1.25rem] items-center justify-center bg-[#C45A12] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                                      {actieCount}
                                    </span>
                                  ) : null}
                                  <span className="text-[10px] text-muted">
                                    {boOpen ? "▾" : "▸"}
                                  </span>
                                </>
                              ) : null}
                            </button>

                            {showBoChildren ? (
                              <ul className="mb-1 ml-3 mt-0.5 space-y-0.5 border-l border-line pl-2">
                                {BO_VIEWS.map((sub) => {
                                  const isActive =
                                    boParentActive && activeBoView === sub.id;
                                  const badge =
                                    sub.id === "acties" && actieCount > 0
                                      ? actieCount
                                      : sub.id === "schouwweek" &&
                                          weekCount > 0
                                        ? weekCount
                                        : null;
                                  const badgeTone =
                                    sub.id === "acties"
                                      ? "bg-[#C45A12] text-white"
                                      : "bg-[#CA8A04] text-white";
                                  return (
                                    <li key={sub.id}>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          setBoOpen(true);
                                          setBoView(sub.id);
                                          if (active !== "projecten") {
                                            onChange("projecten");
                                          }
                                          onMobileClose?.();
                                        }}
                                        className={[
                                          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors",
                                          isActive
                                            ? "bg-green text-white"
                                            : "text-ink hover:bg-wash",
                                        ].join(" ")}
                                      >
                                        <span className="min-w-0 flex-1 truncate">
                                          {sub.label}
                                        </span>
                                        {badge != null ? (
                                          <span
                                            className={[
                                              "inline-flex min-w-[1.1rem] items-center justify-center px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                                              isActive
                                                ? "bg-white/20 text-white"
                                                : badgeTone,
                                            ].join(" ")}
                                          >
                                            {badge}
                                          </span>
                                        ) : null}
                                      </button>
                                    </li>
                                  );
                                })}
                                {boExtraTabs.map((sub) => {
                                  const isActive = active === sub.id;
                                  return (
                                    <li key={sub.id}>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          setBoOpen(true);
                                          onChange(sub.id);
                                          onMobileClose?.();
                                        }}
                                        className={[
                                          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors",
                                          isActive
                                            ? "bg-green text-white"
                                            : "text-ink hover:bg-wash",
                                        ].join(" ")}
                                      >
                                        <span className="min-w-0 flex-1 truncate">
                                          {sub.label}
                                        </span>
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : null}
                          </li>
                        );
                      }

                      const isActive = active === item.id;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            title={item.label}
                            onClick={() => {
                              onChange(item.id);
                              onMobileClose?.();
                            }}
                            className={[
                              "flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-sm font-medium transition-colors",
                              isActive
                                ? "bg-green-soft text-green-deeper"
                                : "text-ink hover:bg-wash",
                              collapsed ? "justify-center" : "",
                            ].join(" ")}
                          >
                            <span
                              className={[
                                "shrink-0",
                                isActive ? "text-green-deeper" : "text-muted",
                              ].join(" ")}
                            >
                              {item.icon}
                            </span>
                            {!collapsed ? (
                              <>
                                <span className="min-w-0 flex-1 truncate font-display tracking-tight">
                                  {item.label}
                                </span>
                                {typeof counts?.[item.id] === "number" ? (
                                  <span
                                    className={[
                                      "inline-flex min-w-[1.25rem] items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                                      isActive
                                        ? "bg-green text-white"
                                        : "bg-[#eef1ef] text-muted",
                                    ].join(" ")}
                                  >
                                    {counts[item.id]}
                                  </span>
                                ) : null}
                              </>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <>
      <aside
        className={[
          "hidden shrink-0 border-r border-line bg-white md:flex md:flex-col",
          collapsed ? "w-[4.25rem]" : "w-56",
        ].join(" ")}
      >
        {renderNav()}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink/40"
            aria-label="Menu sluiten"
            onClick={onMobileClose}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[16.5rem] flex-col border-r border-line bg-white shadow-xl">
            {renderNav()}
          </aside>
        </div>
      ) : null}
    </>
  );
}
