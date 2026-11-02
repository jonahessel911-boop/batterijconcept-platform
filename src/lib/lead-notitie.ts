export function appendLeadNotitie(
  existing: string | null | undefined,
  line: string
): string {
  const extra = line.trim();
  const base = existing?.trim() || "";
  if (!extra) return base;
  return base ? `${base}\n\n${extra}` : extra;
}

/** Oud: [ISO]  Nieuw: [ISO|Auteur] */
const STAMP_RE =
  /^\[(\d{4}-\d{2}-\d{2}T[^\|\]]+)(?:\|([^\]]+))?\]\s*\n?([\s\S]*)$/;

/** Notitie met tijdstempel (+ optioneel auteur) — elk blok wordt een aparte activiteit. */
export function appendStampedNotitie(
  existing: string | null | undefined,
  line: string,
  at: Date = new Date(),
  author?: string | null
): string {
  const text = line.trim();
  if (!text) return existing?.trim() || "";
  const who = author?.trim();
  const stamp = who
    ? `[${at.toISOString()}|${who}]`
    : `[${at.toISOString()}]`;
  return appendLeadNotitie(existing, `${stamp}\n${text}`);
}

/**
 * Voeg een gestempelde notitie toe en herschrijf alle gestempelde blokken
 * chronologisch (oud → nieuw). Ongestempelde tekst bovenaan blijft staan.
 */
export function upsertStampedNotitieChronological(
  existing: string | null | undefined,
  line: string,
  at: Date,
  author?: string | null,
  opts?: { dedupeKey?: string | null }
): string {
  const text = line.trim();
  if (!text) return existing?.trim() || "";

  const raw = existing?.trim() || "";
  const blocks = raw
    ? raw
        .split(/\n\n+/)
        .map((b) => b.trim())
        .filter(Boolean)
    : [];

  const unstamped: string[] = [];
  const stamped: { at: string; author: string | null; text: string }[] = [];

  for (const block of blocks) {
    const m = STAMP_RE.exec(block);
    if (m) {
      stamped.push({
        at: m[1],
        author: m[2]?.trim() || null,
        text: m[3].trim(),
      });
    } else {
      unstamped.push(block);
    }
  }

  const dedupe = opts?.dedupeKey?.trim();
  if (dedupe) {
    const already = stamped.some(
      (s) => s.text.includes(dedupe) || s.text === text
    );
    if (already) {
      return serializeNotitieBlocks(unstamped, stamped);
    }
  }

  stamped.push({
    at: at.toISOString(),
    author: author?.trim() || null,
    text,
  });
  stamped.sort((a, b) => {
    const ta = new Date(a.at).getTime();
    const tb = new Date(b.at).getTime();
    return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
  });

  return serializeNotitieBlocks(unstamped, stamped);
}

function serializeNotitieBlocks(
  unstamped: string[],
  stamped: { at: string; author: string | null; text: string }[]
): string {
  const parts: string[] = [...unstamped];
  for (const s of stamped) {
    if (!s.text) continue;
    const stamp = s.author ? `[${s.at}|${s.author}]` : `[${s.at}]`;
    parts.push(`${stamp}\n${s.text}`);
  }
  return parts.join("\n\n");
}

function isSystemProjectNotitie(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t.startsWith("aangemaakt na afronden backoffice-actie");
}

export type ProjectNotitieEntry = {
  at: string;
  text: string;
  author: string | null;
};

/**
 * Split project-notities in losse activiteiten (nieuwste eerst bij sortering elders).
 * Systeemregels (project-aanmaak) worden overgeslagen.
 */
export function parseProjectNotitieEntries(
  raw: string | null | undefined,
  fallbackAt?: string | null
): ProjectNotitieEntry[] {
  const base = raw?.trim();
  if (!base) return [];

  const blocks = base
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const out: ProjectNotitieEntry[] = [];
  for (const block of blocks) {
    const m = STAMP_RE.exec(block);
    if (m) {
      const at = m[1];
      const author = m[2]?.trim() || null;
      const text = m[3].trim();
      if (!text || isSystemProjectNotitie(text)) continue;
      const d = new Date(at);
      out.push({
        at: Number.isNaN(d.getTime())
          ? fallbackAt || new Date().toISOString()
          : at,
        text,
        author,
      });
      continue;
    }
    if (isSystemProjectNotitie(block)) continue;
    // Witregel hoort bij de notitie erboven. Anders krijgt die alinea
    // de laatste project-update als tijdstip en staat hij dubbel onderaan.
    const prev = out[out.length - 1];
    if (prev) {
      prev.text = `${prev.text}\n\n${block}`;
      continue;
    }
    out.push({
      at: fallbackAt || new Date().toISOString(),
      text: block,
      author: null,
    });
  }
  return out;
}
