"use client";

import { useEffect, useMemo, useState } from "react";
import type { CrmTab } from "@/types/database";
import {
  normalizeRol,
  tabsVoorRol,
  type GebruikerRol,
} from "@/lib/rollen";
import { CRM_TABS } from "@/components/crm/TabNav";

export type CrmSessionUser = {
  id: string;
  naam: string;
  email: string;
  rol: GebruikerRol;
};

/**
 * Laadt de ingelogde CRM-gebruiker + toegestane tabs.
 * Zolang de sessie niet bekend is: géén tabs (nooit admin-fallback).
 */
export function useCrmSession() {
  const [session, setSession] = useState<CrmSessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/auth/login");
        if (!res.ok) {
          if (!cancelled) {
            setSession(null);
            setReady(true);
          }
          return;
        }
        const data = await res.json();
        if (!cancelled && data.adviseur) {
          setSession({
            id: data.adviseur.id,
            naam: data.adviseur.naam,
            email: data.adviseur.email || "",
            rol: normalizeRol(data.adviseur.rol),
          });
        }
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rol: GebruikerRol | null = session
    ? normalizeRol(session.rol)
    : null;

  const visibleTabs = useMemo(() => {
    if (!rol) return [] as { id: CrmTab; label: string }[];
    const allowed = new Set(tabsVoorRol(rol));
    return CRM_TABS.filter((t) => allowed.has(t.id));
  }, [rol]);

  return { session, ready, rol, visibleTabs };
}
