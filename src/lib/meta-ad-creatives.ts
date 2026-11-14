/**
 * Meta Ads creatives ophalen (read-only) voor Performance Marketing library.
 */

const GRAPH_VERSION = "v21.0";

function adsAccessToken(): string | null {
  return (
    process.env.META_ADS_ACCESS_TOKEN?.trim() ||
    process.env.META_CAPI_ACCESS_TOKEN?.trim() ||
    null
  );
}

function adAccountId(): string | null {
  const raw = process.env.META_AD_ACCOUNT_ID?.trim();
  if (!raw) return null;
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

export type MetaAdCreativeRow = {
  adId: string;
  adName: string;
  campaignId: string | null;
  campaignName: string | null;
  status: string | null;
  effectiveStatus: string | null;
  creativeId: string | null;
  title: string | null;
  body: string | null;
  cta: string | null;
  linkUrl: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
};

async function graphGet<T>(
  path: string,
  params: Record<string, string>
): Promise<T> {
  const token = adsAccessToken();
  if (!token) throw new Error("META_ADS_ACCESS_TOKEN ontbreekt");
  const u = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  const res = await fetch(u.toString(), { cache: "no-store" });
  const json = (await res.json()) as T & {
    error?: { message?: string };
  };
  if (!res.ok || (json as { error?: { message?: string } }).error) {
    throw new Error(
      (json as { error?: { message?: string } }).error?.message ||
        `Meta Graph HTTP ${res.status}`
    );
  }
  return json;
}

/** Actieve ads met spend recent — of expliciete ad-ids. */
export async function fetchMetaAdCreatives(opts?: {
  adIds?: string[];
  limit?: number;
}): Promise<{ ok: boolean; rows: MetaAdCreativeRow[]; error?: string }> {
  const account = adAccountId();
  const token = adsAccessToken();
  if (!account || !token) {
    return {
      ok: false,
      rows: [],
      error: "Meta Ads niet geconfigureerd",
    };
  }

  try {
    let adIds = (opts?.adIds || []).filter(Boolean);
    if (adIds.length === 0) {
      const insights = await graphGet<{
        data?: { ad_id?: string; ad_name?: string; spend?: string }[];
      }>(`${account}/insights`, {
        level: "ad",
        fields: "ad_id,ad_name,spend",
        date_preset: "last_30d",
        limit: String(opts?.limit ?? 25),
        sort: "spend_descending",
      });
      adIds = (insights.data || [])
        .map((r) => r.ad_id)
        .filter((id): id is string => Boolean(id))
        .slice(0, opts?.limit ?? 25);
    }

    const rows: MetaAdCreativeRow[] = [];
    for (const adId of adIds.slice(0, opts?.limit ?? 25)) {
      try {
        const ad = await graphGet<{
          id?: string;
          name?: string;
          status?: string;
          effective_status?: string;
          campaign_id?: string;
          campaign?: { id?: string; name?: string };
          creative?: {
            id?: string;
            title?: string;
            body?: string;
            call_to_action_type?: string;
            image_url?: string;
            thumbnail_url?: string;
            object_story_spec?: {
              link_data?: { link?: string; message?: string; name?: string };
              video_data?: {
                call_to_action?: { value?: { link?: string } };
              };
            };
          };
        }>(adId, {
          fields:
            "id,name,status,effective_status,campaign_id,campaign{id,name},creative{id,title,body,call_to_action_type,image_url,thumbnail_url,object_story_spec}",
        });
        const c = ad.creative || {};
        const link =
          c.object_story_spec?.link_data?.link ||
          c.object_story_spec?.video_data?.call_to_action?.value?.link ||
          null;
        rows.push({
          adId: ad.id || adId,
          adName: ad.name || adId,
          campaignId: ad.campaign?.id || ad.campaign_id || null,
          campaignName: ad.campaign?.name || null,
          status: ad.status || null,
          effectiveStatus: ad.effective_status || null,
          creativeId: c.id || null,
          title: c.title || c.object_story_spec?.link_data?.name || null,
          body: c.body || c.object_story_spec?.link_data?.message || null,
          cta: c.call_to_action_type || null,
          linkUrl: link,
          imageUrl: c.image_url || null,
          thumbnailUrl: c.thumbnail_url || null,
        });
      } catch {
        /* skip single ad */
      }
    }

    return { ok: true, rows };
  } catch (e) {
    return {
      ok: false,
      rows: [],
      error: e instanceof Error ? e.message : "Meta creatives laden mislukt",
    };
  }
}
