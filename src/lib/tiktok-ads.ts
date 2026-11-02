/** Publieke TikTok Marketing-app. Het app-secret hoort alleen in de omgeving. */
export const TIKTOK_APP_ID = "7702869763067740180";

/** Exact de redirect die in het TikTok-portaal staat (site-root, geen pad). */
export const TIKTOK_REDIRECT_URI = "https://platform.batterijconcept.nl";

export const TIKTOK_OAUTH_STATE = "bc_tiktok_ads";

export function tiktokAppId(): string {
  return process.env.TIKTOK_APP_ID?.trim() || TIKTOK_APP_ID;
}

export function tiktokAuthUrl(): string {
  const u = new URL("https://business-api.tiktok.com/portal/auth");
  u.searchParams.set("app_id", tiktokAppId());
  u.searchParams.set("state", TIKTOK_OAUTH_STATE);
  u.searchParams.set("redirect_uri", TIKTOK_REDIRECT_URI);
  return u.toString();
}
