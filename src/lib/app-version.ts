/**
 * Zichtbare app-versie in de CRM-header.
 * Semver uit package.json + korte git-sha (Vercel) zodat deploys herkenbaar zijn.
 */

export const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "1.5.0";

export const APP_COMMIT = (
  process.env.NEXT_PUBLIC_APP_COMMIT ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  ""
)
  .trim()
  .slice(0, 7);

/** Bijv. "v1.5.0" of "v1.5.0 · 1a664da" */
export function appVersionLabel(): string {
  const base = APP_VERSION.startsWith("v") ? APP_VERSION : `v${APP_VERSION}`;
  if (APP_COMMIT) return `${base} · ${APP_COMMIT}`;
  return base;
}
