/**
 * Queue voor Higgsfield stills (MCP in Cursor).
 * CRM maakt drafts + queue-items; agent genereert en koppelt terug.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const QUEUE_PATH = join(process.cwd(), "data", "higgsfield-queue.json");

export type HiggsfieldQueueItem = {
  id: string;
  libraryItemId: string;
  prompt: string;
  cardboardText: string;
  fileStem: string;
  seedLocalPath: string;
  /** image = still · video = UGC 9:16 (script-first) */
  media?: "image" | "video";
  /** Shotlist / VO / SFX voor video jobs */
  videoScript?: string | null;
  status: "pending" | "running" | "done" | "failed";
  jobId?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HiggsfieldQueue = {
  updatedAt: string;
  items: HiggsfieldQueueItem[];
};

function empty(): HiggsfieldQueue {
  return { updatedAt: new Date().toISOString(), items: [] };
}

export function readHiggsfieldQueue(): HiggsfieldQueue {
  try {
    if (!existsSync(QUEUE_PATH)) return empty();
    const parsed = JSON.parse(readFileSync(QUEUE_PATH, "utf8")) as HiggsfieldQueue;
    if (!parsed?.items) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

export function writeHiggsfieldQueue(q: HiggsfieldQueue): void {
  mkdirSync(dirname(QUEUE_PATH), { recursive: true });
  writeFileSync(
    QUEUE_PATH,
    JSON.stringify(
      { ...q, updatedAt: new Date().toISOString() },
      null,
      2
    ),
    "utf8"
  );
}

export function enqueueHiggsfieldJobs(
  jobs: Omit<HiggsfieldQueueItem, "status" | "createdAt" | "updatedAt">[]
): HiggsfieldQueue {
  const q = readHiggsfieldQueue();
  const now = new Date().toISOString();
  for (const j of jobs) {
    q.items.unshift({
      ...j,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  }
  // keep last 200
  q.items = q.items.slice(0, 200);
  writeHiggsfieldQueue(q);
  return q;
}

export function pendingHiggsfieldJobs(
  limit = 12,
  media?: "image" | "video"
): HiggsfieldQueueItem[] {
  return readHiggsfieldQueue()
    .items.filter((i) => {
      if (i.status !== "pending") return false;
      if (!media) return true;
      const m = i.media || "image";
      return m === media;
    })
    .slice(0, limit);
}

export function markHiggsfieldJob(
  id: string,
  patch: Partial<HiggsfieldQueueItem>
): HiggsfieldQueue {
  const q = readHiggsfieldQueue();
  q.items = q.items.map((i) =>
    i.id === id
      ? { ...i, ...patch, updatedAt: new Date().toISOString() }
      : i
  );
  writeHiggsfieldQueue(q);
  return q;
}

/** Samenvatting voor CRM progress UI */
export function higgsfieldQueueSummary(): {
  pending: number;
  running: number;
  done: number;
  failed: number;
  items: HiggsfieldQueueItem[];
} {
  const items = readHiggsfieldQueue().items;
  const active = items.filter(
    (i) =>
      i.status === "pending" ||
      i.status === "running" ||
      i.status === "failed"
  );
  return {
    pending: items.filter((i) => i.status === "pending").length,
    running: items.filter((i) => i.status === "running").length,
    done: items.filter((i) => i.status === "done").length,
    failed: items.filter((i) => i.status === "failed").length,
    items: active.slice(0, 40),
  };
}
