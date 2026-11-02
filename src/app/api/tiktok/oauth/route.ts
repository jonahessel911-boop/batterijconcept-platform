import { NextRequest, NextResponse } from "next/server";
import { exchangeTikTokAuthCode } from "@/lib/tiktok-ads-spend";

export const runtime = "nodejs";

/**
 * TikTok stuurt de auth_code naar de site-root. Middleware zet die
 * door naar dit pad. De code wordt omgewisseld voor een access token.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("auth_code")?.trim() || "";
  const back = new URL("/", req.url);
  back.searchParams.set("tab", "rapportage");
  back.searchParams.set("view", "marketing");

  if (!code) {
    back.searchParams.set("tiktok", "missing");
    return NextResponse.redirect(back);
  }

  try {
    const auth = await exchangeTikTokAuthCode(code);
    back.searchParams.set("tiktok", auth.advertiser_ids.length ? "ok" : "no_ads");
    return NextResponse.redirect(back);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "TikTok-login mislukt";
    back.searchParams.set("tiktok", "error");
    back.searchParams.set("tiktok_error", msg.slice(0, 180));
    return NextResponse.redirect(back);
  }
}
