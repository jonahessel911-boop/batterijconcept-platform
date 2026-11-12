import { useSyncExternalStore } from "react";
import {
  parseRecruitmentView,
  type RecruitmentView,
} from "@/lib/recruitment-view";

let current: RecruitmentView = "aanmeldingen";
let initialized = false;
const listeners = new Set<() => void>();

function readFromLocation(): RecruitmentView {
  if (typeof window === "undefined") return "aanmeldingen";
  return parseRecruitmentView(
    new URLSearchParams(window.location.search).get("rc")
  );
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

export function getRecruitmentViewSnapshot(): RecruitmentView {
  ensureInit();
  return current;
}

export function getRecruitmentViewServerSnapshot(): RecruitmentView {
  return "aanmeldingen";
}

export function subscribeRecruitmentView(listener: () => void): () => void {
  ensureInit();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setRecruitmentViewStore(next: RecruitmentView) {
  ensureInit();
  if (current === next) {
    syncUrl(next);
    return;
  }
  current = next;
  syncUrl(next);
  emit();
}

function syncUrl(view: RecruitmentView) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.set("tab", "instroom");
  params.set("rc", view);
  const url = `/?${params.toString()}`;
  const now = `${window.location.pathname}${window.location.search}`;
  if (now !== url) {
    window.history.replaceState(window.history.state, "", url);
  }
}

export function useRecruitmentViewStore(): [
  RecruitmentView,
  (next: RecruitmentView) => void,
] {
  const view = useSyncExternalStore(
    subscribeRecruitmentView,
    getRecruitmentViewSnapshot,
    getRecruitmentViewServerSnapshot
  );
  return [view, setRecruitmentViewStore];
}
