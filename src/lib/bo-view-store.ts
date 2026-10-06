import { useSyncExternalStore } from "react";
import { parseBoView, type BoView } from "@/lib/bo-view";

let current: BoView = "orders";
let initialized = false;
const listeners = new Set<() => void>();

function readFromLocation(): BoView {
  if (typeof window === "undefined") return "orders";
  return parseBoView(new URLSearchParams(window.location.search).get("bo"));
}

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  current = readFromLocation();
  initialized = true;
  window.addEventListener("popstate", () => {
    const next = readFromLocation();
    if (next === current) return;
    current = next;
    emit();
  });
}

function emit() {
  for (const l of listeners) l();
}

export function getBoViewSnapshot(): BoView {
  ensureInit();
  return current;
}

export function getBoViewServerSnapshot(): BoView {
  return "orders";
}

export function subscribeBoView(listener: () => void): () => void {
  ensureInit();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Zet backoffice-subview + URL (zonder Next soft-nav). */
export function setBoViewStore(next: BoView) {
  ensureInit();
  if (current === next) {
    // Toch URL syncen als die achterloopt
    syncUrl(next);
    return;
  }
  current = next;
  syncUrl(next);
  emit();
}

function syncUrl(view: BoView) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.set("tab", "projecten");
  params.set("bo", view);
  const url = `/?${params.toString()}`;
  const now = `${window.location.pathname}${window.location.search}`;
  if (now !== url) {
    window.history.replaceState(window.history.state, "", url);
  }
}

export function useBoViewStore(): [BoView, (next: BoView) => void] {
  const view = useSyncExternalStore(
    subscribeBoView,
    getBoViewSnapshot,
    getBoViewServerSnapshot
  );
  return [view, setBoViewStore];
}
