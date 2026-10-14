/**
 * Zichtbare app-versie in de CRM-header.
 * Semver uit package.json + korte git-sha (Vercel) zodat deploys herkenbaar zijn.
 */

export const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "0.1.0";

export const APP_COMMIT =
  process.env.NEXT_PUBLIC_APP_COMMIT?.trim() || "";

/** Bijv. "v0.1.0" of "v0.1.0 · 41c7911" */
export function appVersionLabel(): string {
  const base = APP_VERSION.startsWith("v") ? APP_VERSION : `v${APP_VERSION}`;
  if (APP_COMMIT) return `${base} · ${APP_COMMIT}`;
  return base;
}
