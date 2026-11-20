import { belSchouwDeadline, isPrioDeadline, type BackofficeActie } from "@/lib/backoffice-acties";

export type ActieSnoozeMap = Record<string, string>;

export const ACTIE_SNOOZE_LS_KEY = "bc.actie-snooze.v1";

/** Morgen 17:00 Amsterdam — zelfde conventie als overige Acties-deadlines. */
export function snoozeTotMorgen(now = new Date()): string {
  return belSchouwDeadline(now).toISOString();
}

export function readActieSnoozeLocal(): ActieSnoozeMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(ACTIE_SNOOZE_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: ActieSnoozeMap = {};
    for (const [id, tot] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof tot === "string" && tot) out[id] = tot;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeActieSnoozeLocal(map: ActieSnoozeMap) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACTIE_SNOOZE_LS_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode */
  }
}

export function mergeActieSnoozeMaps(
  a: ActieSnoozeMap,
  b: ActieSnoozeMap
): ActieSnoozeMap {
  const out = { ...a };
  for (const [id, tot] of Object.entries(b)) {
    const prev = out[id];
    if (!prev || new Date(tot).getTime() > new Date(prev).getTime()) {
      out[id] = tot;
    }
  }
  return out;
}

/** Actieve snooze: tot ligt nog in de toekomst → toon op die dag, niet als te laat. */
export function applyActieSnoozes(
  acties: BackofficeActie[],
  snoozes: ActieSnoozeMap,
  now = new Date()
): BackofficeActie[] {
  if (!snoozes || Object.keys(snoozes).length === 0) return acties;
  const nowMs = now.getTime();
  return acties.map((a) => {
    const tot = snoozes[a.id];
    if (!tot) return a;
    const totMs = new Date(tot).getTime();
    if (!Number.isFinite(totMs) || totMs <= nowMs) return a;
    return {
      ...a,
      deadlineAt: tot,
      overdue: false,
      vastgelopen: false,
      prio: isPrioDeadline(new Date(tot), now),
    };
  });
}
