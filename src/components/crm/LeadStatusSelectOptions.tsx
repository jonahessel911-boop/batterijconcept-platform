"use client";

import type { LeadStatus } from "@/types/database";
import { LEAD_STATUS_GROUPS, leadStatusLabel } from "@/lib/labels";

/** Option-lijst met groepen (streepjes) voor leadstatus-selects. */
export function LeadStatusSelectOptions({
  emptyLabel,
}: {
  emptyLabel?: string;
}) {
  return (
    <>
      {emptyLabel != null && <option value="">{emptyLabel}</option>}
      {LEAD_STATUS_GROUPS.map((group) => (
        <optgroup key={group.label} label={`── ${group.label} ──`}>
          {group.statuses.map((s) => (
            <option key={s} value={s}>
              {leadStatusLabel[s as LeadStatus]}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
