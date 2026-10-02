import type {
  Adviseur,
  Afspraak,
  Factuur,
  Lead,
  Offerte,
  Project,
} from "@/types/database";
import type { GebruikerRol } from "@/lib/rollen";

const BOOTSTRAP_KEY = "bc_crm_bootstrap_v1";
const SESSION_KEY = "bc_crm_session_v1";
const MAX_AGE_MS = 30 * 60 * 1000;

export type CrmSessionCache = {
  id: string;
  naam: string;
  email: string;
  rol: GebruikerRol;
};

export type CrmBootstrapCache = {
  at: number;
  leads: Lead[];
  afspraken: Afspraak[];
  offertes: Offerte[];
  projecten: Project[];
  facturen: Factuur[];
  instroomCount: number;
  adviseurs: Adviseur[];
};

function isFresh(at: number): boolean {
  return Date.now() - at < MAX_AGE_MS;
}

export function readCrmSessionCache(): CrmSessionCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CrmSessionCache;
  } catch {
    return null;
  }
}

export function writeCrmSessionCache(session: CrmSessionCache): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore quota */
  }
}

export function readCrmBootstrapCache(): CrmBootstrapCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(BOOTSTRAP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CrmBootstrapCache;
    if (!parsed?.at || !isFresh(parsed.at)) {
      sessionStorage.removeItem(BOOTSTRAP_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCrmBootstrapCache(data: Omit<CrmBootstrapCache, "at">): void {
  if (typeof window === "undefined") return;
  try {
    const payload: CrmBootstrapCache = { ...data, at: Date.now() };
    sessionStorage.setItem(BOOTSTRAP_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

export function hasCrmBootstrapCache(): boolean {
  return readCrmBootstrapCache() !== null;
}

export function clearCrmShellCache(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(BOOTSTRAP_KEY);
  } catch {
    /* ignore */
  }
}
