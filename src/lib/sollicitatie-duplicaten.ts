import type { Sollicitatie, SollicitatieStatus } from "@/types/database";
import { normalizeSollicitatieStatus } from "@/lib/sollicitatie";
import { sollicitatieContactKeys } from "@/lib/sollicitatie-bel";

/**
 * Statussen die altijd in Aanmeldingen blijven, ook bij hetzelfde
 * telefoonnummer/e-mail als een andere rij.
 */
const ALTIJD_TONEN: ReadonlySet<SollicitatieStatus> = new Set([
  "gesprek_gepland",
  "gesprek_gehad",
  "gesprek_gehad_diskwalificatie",
  "aangenomen_training_gepland",
  "aangenomen_actief",
]);

function parentOf(
  parent: Map<string, string>,
  id: string
): string {
  let cur = id;
  while (parent.get(cur) && parent.get(cur) !== cur) {
    cur = parent.get(cur)!;
  }
  parent.set(id, cur);
  return cur;
}

function union(parent: Map<string, string>, a: string, b: string) {
  const pa = parentOf(parent, a);
  const pb = parentOf(parent, b);
  if (pa !== pb) parent.set(pa, pb);
}

/**
 * Verberg dubbele aanmeldingen (zelfde tel/mail).
 * “Gesprek gepland” blijft altijd staan.
 * Van de rest in een cluster blijft de nieuwste over.
 */
export function filterSollicitatieDuplicaten(
  list: Sollicitatie[]
): Sollicitatie[] {
  if (list.length < 2) return list;

  const parent = new Map<string, string>();
  for (const s of list) parent.set(s.id, s.id);

  const byKey = new Map<string, string>();
  for (const s of list) {
    for (const key of sollicitatieContactKeys(s)) {
      const prev = byKey.get(key);
      if (prev) union(parent, prev, s.id);
      else byKey.set(key, s.id);
    }
  }

  const groups = new Map<string, Sollicitatie[]>();
  for (const s of list) {
    const keys = sollicitatieContactKeys(s);
    const root = keys.length ? parentOf(parent, s.id) : s.id;
    const g = groups.get(root) || [];
    g.push(s);
    groups.set(root, g);
  }

  const keep = new Set<string>();
  for (const group of groups.values()) {
    const altijd = group.filter((s) =>
      ALTIJD_TONEN.has(normalizeSollicitatieStatus(s.status))
    );
    for (const s of altijd) keep.add(s.id);

    const rest = group.filter((s) => !keep.has(s.id));
    if (rest.length === 0) continue;
    if (altijd.length > 0) continue;

    rest.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    keep.add(rest[0]!.id);
  }

  return list.filter((s) => keep.has(s.id));
}
