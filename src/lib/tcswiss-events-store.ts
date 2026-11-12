/**
 * Persist TC Swiss / RelayPro webhook + poll events (idempotent op volgnummer).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { TcSwissGebeurtenis } from "@/lib/tcswiss";

const STORE_PATH = join(process.cwd(), "data", "tcswiss-events.json");

export type TcSwissStoredEvent = {
  id: string;
  volgnummer: number | null;
  soort: string;
  lead: string | null;
  externId: string | null;
  receivedAt: string;
  source: "webhook" | "poll" | "manual";
  payload: TcSwissGebeurtenis | Record<string, unknown>;
  /** CRM lead_id als we hem konden matchen */
  crmLeadId?: string | null;
  /** lead_events insert gedaan */
  logged?: boolean;
};

type Store = {
  updatedAt: string;
  /** hoogste verwerkte volgnummer (voor pollen) */
  lastVolgnummer: number;
  items: TcSwissStoredEvent[];
};

function empty(): Store {
  return { updatedAt: new Date().toISOString(), lastVolgnummer: 0, items: [] };
}

export function readTcSwissEvents(): Store {
  try {
    if (!existsSync(STORE_PATH)) return empty();
    const parsed = JSON.parse(readFileSync(STORE_PATH, "utf8")) as Store;
    if (!parsed?.items) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

function writeStore(store: Store): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(
    STORE_PATH,
    JSON.stringify(
      { ...store, updatedAt: new Date().toISOString() },
      null,
      2
    ),
    "utf8"
  );
}

export function upsertTcSwissEvent(
  event: Omit<TcSwissStoredEvent, "id" | "receivedAt"> & {
    id?: string;
    receivedAt?: string;
  }
): { store: Store; created: boolean; item: TcSwissStoredEvent } {
  const store = readTcSwissEvents();
  const volg = event.volgnummer;
  if (volg != null) {
    const existing = store.items.find((i) => i.volgnummer === volg);
    if (existing) {
      return { store, created: false, item: existing };
    }
  }
  const item: TcSwissStoredEvent = {
    id: event.id || `tcs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    volgnummer: event.volgnummer,
    soort: event.soort,
    lead: event.lead,
    externId: event.externId,
    receivedAt: event.receivedAt || new Date().toISOString(),
    source: event.source,
    payload: event.payload,
    crmLeadId: event.crmLeadId ?? null,
    logged: event.logged ?? false,
  };
  store.items.unshift(item);
  store.items = store.items.slice(0, 2000);
  if (volg != null && volg > store.lastVolgnummer) {
    store.lastVolgnummer = volg;
  }
  writeStore(store);
  return { store, created: true, item };
}

export function markTcSwissEventLogged(
  id: string,
  crmLeadId: string | null
): void {
  const store = readTcSwissEvents();
  store.items = store.items.map((i) =>
    i.id === id ? { ...i, logged: true, crmLeadId } : i
  );
  writeStore(store);
}
