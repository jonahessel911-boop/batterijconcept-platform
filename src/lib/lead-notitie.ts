export function appendLeadNotitie(
  existing: string | null | undefined,
  line: string
): string {
  const extra = line.trim();
  const base = existing?.trim() || "";
  if (!extra) return base;
  return base ? `${base}\n\n${extra}` : extra;
}

/** Notitie met tijdstempel — elk blok wordt een aparte activiteit. */
export function appendStampedNotitie(
  existing: string | null | undefined,
  line: string,
  at: Date = new Date()
): string {
  const text = line.trim();
  if (!text) return existing?.trim() || "";
  return appendLeadNotitie(existing, `[${at.toISOString()}]\n${text}`);
}

const STAMP_RE = /^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]\s*\n?([\s\S]*)$/;

function isSystemProjectNotitie(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t.startsWith("aangemaakt na afronden backoffice-actie");
}

/**
 * Split project-notities in losse activiteiten (nieuwste eerst bij sortering elders).
 * Systeemregels (project-aanmaak) worden overgeslagen.
 */
export function parseProjectNotitieEntries(
  raw: string | null | undefined,
  fallbackAt?: string | null
): { at: string; text: string }[] {
  const base = raw?.trim();
  if (!base) return [];

  const blocks = base
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const out: { at: string; text: string }[] = [];
  for (const block of blocks) {
    const m = STAMP_RE.exec(block);
    if (m) {
      const at = m[1];
      const text = m[2].trim();
      if (!text || isSystemProjectNotitie(text)) continue;
      const d = new Date(at);
      out.push({
        at: Number.isNaN(d.getTime()) ? fallbackAt || new Date().toISOString() : at,
        text,
      });
      continue;
    }
    if (isSystemProjectNotitie(block)) continue;
    out.push({
      at: fallbackAt || new Date().toISOString(),
      text: block,
    });
  }
  return out;
}
