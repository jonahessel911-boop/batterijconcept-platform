export {
  buildManagementDashboard,
  serializeManagementDashboard,
  type MgmtRaw,
} from "./build";
export type { ManagementDashboardData, MgmtKpi, MgmtAlert, DrilldownRef } from "./types";
export {
  PERIOD_PRESET_LABELS,
  DEFAULT_INSTELLINGEN,
  parseInstellingen,
  type MgmtFilters,
  type MgmtPeriodPreset,
  type DashboardInstellingen,
} from "./periods";
