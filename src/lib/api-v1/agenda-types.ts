/**
 * Agenda-type codes voor projectplanning (schouw / installatie).
 *
 * 1 = schouwweek (alleen ISO-week)
 * 2 = schouwdag + tijd (exacte datetime)
 * 3 = installatie (exacte datetime)
 */

export const AGENDA_TYPES = {
  1: {
    code: 1 as const,
    key: "schouwweek",
    label: "Schouwweek",
    description: "Plant alleen ISO-week (maandag 12:00 placeholder)",
  },
  2: {
    code: 2 as const,
    key: "schouwdag",
    label: "Schouwdag + tijd",
    description: "Plant exacte schouwdag en tijd",
  },
  3: {
    code: 3 as const,
    key: "installatie",
    label: "Installatie",
    description: "Plant installatie-datum/tijd (+ optioneel partner)",
  },
} as const;

export type AgendaTypeCode = keyof typeof AGENDA_TYPES;

export function parseAgendaType(raw: unknown): AgendaTypeCode | null {
  const n = typeof raw === "string" ? Number(raw.trim()) : Number(raw);
  if (n === 1 || n === 2 || n === 3) return n;
  if (typeof raw === "string") {
    const k = raw.trim().toLowerCase();
    if (k === "schouwweek" || k === "week") return 1;
    if (k === "schouwdag" || k === "schouw" || k === "schouw_at") return 2;
    if (k === "installatie" || k === "install") return 3;
  }
  return null;
}

export function agendaTypesDocs() {
  return Object.values(AGENDA_TYPES).map((t) => ({
    type: t.code,
    key: t.key,
    label: t.label,
    description: t.description,
  }));
}
