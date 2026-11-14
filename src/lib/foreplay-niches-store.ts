/**
 * Which hot lead-gen niches the admin follows.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { HOT_LEADGEN_NICHES } from "@/lib/hot-leadgen-niches";

const PATH = join(process.cwd(), "data", "foreplay-followed-niches.json");

export type FollowedNichesStore = {
  updatedAt: string;
  /** Niche ids from HOT_LEADGEN_NICHES */
  followedIds: string[];
};

const DEFAULT_FOLLOWED = [
  "solar_battery",
  "windows_zero_down",
  "bath_oneday",
  "final_expense",
  "stairlift",
];

function empty(): FollowedNichesStore {
  return {
    updatedAt: new Date().toISOString(),
    followedIds: [...DEFAULT_FOLLOWED],
  };
}

export function readFollowedNiches(): FollowedNichesStore {
  try {
    if (!existsSync(PATH)) {
      const init = empty();
      writeFollowedNiches(init);
      return init;
    }
    const parsed = JSON.parse(
      readFileSync(PATH, "utf8")
    ) as FollowedNichesStore;
    if (!parsed || !Array.isArray(parsed.followedIds)) return empty();
    const valid = new Set(HOT_LEADGEN_NICHES.map((n) => n.id));
    return {
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      followedIds: parsed.followedIds.filter((id) => valid.has(id)),
    };
  } catch {
    return empty();
  }
}

export function writeFollowedNiches(store: FollowedNichesStore): void {
  mkdirSync(dirname(PATH), { recursive: true });
  writeFileSync(
    PATH,
    JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

export function setFollowedNiches(ids: string[]): FollowedNichesStore {
  const valid = new Set(HOT_LEADGEN_NICHES.map((n) => n.id));
  const next: FollowedNichesStore = {
    updatedAt: new Date().toISOString(),
    followedIds: [...new Set(ids.filter((id) => valid.has(id)))],
  };
  writeFollowedNiches(next);
  return next;
}

export function toggleFollowedNiche(id: string): FollowedNichesStore {
  const store = readFollowedNiches();
  const set = new Set(store.followedIds);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return setFollowedNiches([...set]);
}
