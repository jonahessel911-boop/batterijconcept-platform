/**
 * Interne creative library (JSON op disk).
 * Tiers: winner (top) · rising (opkomers) · new (verse / varianten).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type {
  CreativeLibrary,
  CreativeLibraryItem,
  CreativeLibraryTier,
} from "@/lib/performance-marketing";

const LIBRARY_PATH = join(process.cwd(), "data", "creative-library.json");

function emptyLibrary(): CreativeLibrary {
  return { updatedAt: new Date().toISOString(), items: [] };
}

function normalizeItem(
  raw: CreativeLibraryItem & { tier?: CreativeLibraryTier }
): CreativeLibraryItem {
  const tier: CreativeLibraryTier =
    raw.tier ||
    (raw.status === "ready"
      ? "winner"
      : raw.id.startsWith("winner-") || raw.id.startsWith("hf-ad11")
        ? "winner"
        : "new");
  return { ...raw, tier, publishable: false };
}

export function readCreativeLibrary(): CreativeLibrary {
  try {
    if (!existsSync(LIBRARY_PATH)) return emptyLibrary();
    const raw = readFileSync(LIBRARY_PATH, "utf8");
    const parsed = JSON.parse(raw) as CreativeLibrary;
    if (!parsed || !Array.isArray(parsed.items)) return emptyLibrary();
    return {
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      items: parsed.items.map((i) => normalizeItem(i)),
    };
  } catch {
    return emptyLibrary();
  }
}

export function writeCreativeLibrary(lib: CreativeLibrary): void {
  mkdirSync(dirname(LIBRARY_PATH), { recursive: true });
  const next: CreativeLibrary = {
    updatedAt: new Date().toISOString(),
    items: lib.items.map((i) => normalizeItem(i)),
  };
  writeFileSync(LIBRARY_PATH, JSON.stringify(next, null, 2), "utf8");
}

export function upsertCreativeItems(
  items: CreativeLibraryItem[]
): CreativeLibrary {
  const lib = readCreativeLibrary();
  const byId = new Map(lib.items.map((i) => [i.id, i]));
  for (const item of items) byId.set(item.id, normalizeItem(item));
  const next = {
    updatedAt: new Date().toISOString(),
    items: [...byId.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    ),
  };
  writeCreativeLibrary(next);
  return next;
}

export type CreativeStatusAction = "approve" | "reject" | "unapprove";

export function setCreativeStatuses(
  ids: string[],
  action: CreativeStatusAction
): CreativeLibrary {
  const lib = readCreativeLibrary();
  const idSet = new Set(ids);
  const now = new Date().toISOString();
  const items = lib.items.map((item) => {
    if (!idSet.has(item.id)) return item;
    if (action === "approve") {
      return normalizeItem({
        ...item,
        status: "ready",
        tier: "winner",
        approvedAt: now,
        notes: [item.notes, "Goedgekeurd → winner / launch seed"]
          .filter(Boolean)
          .join(" · "),
      });
    }
    if (action === "reject") {
      return normalizeItem({
        ...item,
        status: "archived",
        approvedAt: null,
        notes: [item.notes, "Afgekeurd"].filter(Boolean).join(" · "),
      });
    }
    return normalizeItem({
      ...item,
      status: "draft",
      tier: item.tier === "winner" ? "new" : item.tier,
      approvedAt: null,
    });
  });
  const next = { updatedAt: now, items };
  writeCreativeLibrary(next);
  return next;
}

export function setCreativeTiers(
  ids: string[],
  tier: CreativeLibraryTier
): CreativeLibrary {
  const lib = readCreativeLibrary();
  const idSet = new Set(ids);
  const items = lib.items.map((item) => {
    if (!idSet.has(item.id)) return item;
    return normalizeItem({
      ...item,
      tier,
      status: tier === "winner" ? "ready" : item.status === "archived" ? "draft" : item.status,
      approvedAt:
        tier === "winner" ? item.approvedAt || new Date().toISOString() : item.approvedAt,
    });
  });
  const next = { updatedAt: new Date().toISOString(), items };
  writeCreativeLibrary(next);
  return next;
}

export function libraryByTier(lib?: CreativeLibrary): {
  winners: CreativeLibraryItem[];
  rising: CreativeLibraryItem[];
  news: CreativeLibraryItem[];
} {
  const items = (lib || readCreativeLibrary()).items.filter(
    (i) => i.status !== "archived"
  );
  return {
    winners: items.filter((i) => i.tier === "winner").slice(0, 30),
    rising: items.filter((i) => i.tier === "rising"),
    news: items.filter((i) => i.tier === "new" || (!i.tier && i.status === "draft")),
  };
}

export function launchReadyCreatives(): CreativeLibraryItem[] {
  return readCreativeLibrary().items.filter(
    (i) => i.status === "ready" || i.tier === "winner"
  );
}
