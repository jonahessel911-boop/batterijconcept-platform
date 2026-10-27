export type {
  TargetRole,
  TargetFields,
  TargetFieldKey,
  PersonOverride,
  AdminTargetsStore,
  FieldMeta,
} from "./types";
export {
  TARGET_FIELD_META,
  FIELDS_BY_ROLE,
  EDITABLE_FIELDS_BY_ROLE,
  DEFAULT_TARGETS,
  ROLE_LABELS,
} from "./types";
export {
  parseAdminTargetsStore,
  mergeFields,
  resolvePersonTargets,
  resolvePartnerTargets,
  teamWeeklySnapshot,
  computeTeamDashboardTargets,
  salesPeopleForTeam,
  personTargetWeight,
  serializeAdminTargetsStore,
  rolToTargetRole,
  isSalesAdviseurRol,
  deriveFunnelFromInputs,
  withDerivedFunnelTargets,
  DEFAULT_AFSPRAAK_TO_SALE_PCT,
  type TargetPersonRef,
  type TeamSnapshotOpts,
} from "./store";
