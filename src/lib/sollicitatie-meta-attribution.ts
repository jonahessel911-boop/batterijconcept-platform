/**
 * Haal Meta / UTM-attributie uit webhook-payload of landings-URL.
 *
 * Meta URL-tags (aanbevolen op BANEN-lander):
 *   ?campaign_id={{campaign.id}}
 *   &adset_id={{adset.id}}
 *   &ad_id={{ad.id}}
 *   &campaign_name={{campaign.name}}
 *   &adset_name={{adset.name}}
 *   &ad_name={{ad.name}}
 *   &utm_source=meta
 *   &utm_medium=paid
 *   &utm_campaign={{campaign.name}}
 *   &utm_content={{ad.name}}
 *   &placement={{placement}}
 */

function pickStr(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
  }
  return null;
}

/** Alleen plausibele Meta-ids (cijfers, soms met prefix). */
function normalizeMetaId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^\d{8,}$/.test(t)) return t;
  if (/^act_/i.test(t)) return null;
  const m = t.match(/(?:campaign|adset|ad)[_:]?(\d{8,})/i);
  if (m?.[1]) return m[1];
  return null;
}

function paramsFromUrl(urlLike: string | null): URLSearchParams | null {
  if (!urlLike?.trim()) return null;
  try {
    const raw = urlLike.trim();
    if (raw.includes("://")) {
      return new URL(raw).searchParams;
    }
    if (raw.startsWith("?")) {
      return new URLSearchParams(raw.slice(1));
    }
    if (raw.includes("=") && !raw.includes(" ")) {
      return new URLSearchParams(raw.includes("?") ? raw.split("?").pop() : raw);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function clip(s: string | null, max = 240): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export type SollicitatieMetaAttribution = {
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_ad_id: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  landing_url: string | null;
  meta_placement: string | null;
  meta_fbc: string | null;
  meta_fbp: string | null;
};

/** Lees Meta/UTM uit body-velden + eventuele landings-URL. */
export function pickSollicitatieMetaAttribution(
  body: Record<string, unknown>
): SollicitatieMetaAttribution {
  const landingUrl = pickStr(
    body.landing_url,
    body.landingUrl,
    body.page_url,
    body.pageUrl,
    body.url,
    body.event_source_url,
    body.meta_event_source_url,
    body.referrer,
    body.referer
  );

  const urlParams = paramsFromUrl(landingUrl) || null;

  const fromUrl = (keys: string[]) => {
    if (!urlParams) return null;
    for (const k of keys) {
      const v = urlParams.get(k);
      if (v?.trim()) return v.trim();
    }
    return null;
  };

  const campaignIdRaw = pickStr(
    body.meta_campaign_id,
    body.campaign_id,
    body.campaignId,
    body.Campaign_id,
    body.utm_campaign_id,
    fromUrl([
      "campaign_id",
      "campaignId",
      "meta_campaign_id",
      "utm_campaign_id",
    ])
  );

  const adsetIdRaw = pickStr(
    body.meta_adset_id,
    body.adset_id,
    body.adsetId,
    body.Adset_id,
    body.ad_set_id,
    fromUrl(["adset_id", "adsetId", "meta_adset_id", "ad_set_id"])
  );

  const adIdRaw = pickStr(
    body.meta_ad_id,
    body.ad_id,
    body.adId,
    body.Ad_id,
    fromUrl(["ad_id", "adId", "meta_ad_id"])
  );

  // utm_campaign alleen als Meta-id als we nog geen campaign_id hebben
  const campaignFromUtm = normalizeMetaId(
    pickStr(body.utm_campaign, fromUrl(["utm_campaign", "campaign"]))
  );

  const campaignName = clip(
    pickStr(
      body.campaign_name,
      body.Campaign_name,
      fromUrl(["campaign_name", "Campaign_name"]),
      // tekst-naam in utm_campaign (niet numeriek)
      normalizeMetaId(pickStr(body.utm_campaign, fromUrl(["utm_campaign"])))
        ? null
        : pickStr(body.utm_campaign, fromUrl(["utm_campaign"]))
    )
  );

  const adsetName = clip(
    pickStr(
      body.adset_name,
      body.Adset_name,
      body.ad_set_name,
      fromUrl(["adset_name", "Adset_name", "ad_set_name"])
    )
  );

  const adName = clip(
    pickStr(
      body.ad_name,
      body.Ad_name,
      fromUrl(["ad_name", "Ad_name"]),
      pickStr(body.utm_content, fromUrl(["utm_content"]))
    )
  );

  let metaFbc = pickStr(
    body.meta_fbc,
    body.fbc,
    body._fbc,
    fromUrl(["fbc", "meta_fbc"])
  );
  const fbclid = pickStr(body.fbclid, fromUrl(["fbclid"]));
  if (!metaFbc && fbclid) {
    metaFbc = `fb.1.${Date.now()}.${fbclid}`;
  }

  return {
    meta_campaign_id:
      normalizeMetaId(campaignIdRaw) || campaignFromUtm || null,
    meta_adset_id: normalizeMetaId(adsetIdRaw),
    meta_ad_id: normalizeMetaId(adIdRaw),
    campaign_name: campaignName,
    adset_name: adsetName,
    ad_name: adName,
    utm_source: clip(
      pickStr(body.utm_source, fromUrl(["utm_source"])),
      80
    ),
    utm_medium: clip(
      pickStr(body.utm_medium, fromUrl(["utm_medium"])),
      80
    ),
    utm_campaign: clip(
      pickStr(body.utm_campaign, fromUrl(["utm_campaign"])),
      160
    ),
    utm_content: clip(
      pickStr(body.utm_content, fromUrl(["utm_content"])),
      160
    ),
    utm_term: clip(pickStr(body.utm_term, fromUrl(["utm_term"])), 160),
    landing_url: clip(landingUrl, 1000),
    meta_placement: clip(
      pickStr(
        body.placement,
        body.meta_placement,
        body.site_source_name,
        fromUrl(["placement", "meta_placement", "site_source_name"])
      ),
      80
    ),
    meta_fbc: clip(metaFbc, 255),
    meta_fbp: clip(
      pickStr(body.meta_fbp, body.fbp, body._fbp, fromUrl(["fbp", "meta_fbp"])),
      255
    ),
  };
}

/** Velden die op sollicitaties-insert mogen (voor graceful column-fallback). */
export const SOLLICITATIE_META_COLUMNS = [
  "meta_campaign_id",
  "meta_adset_id",
  "meta_ad_id",
  "campaign_name",
  "adset_name",
  "ad_name",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "landing_url",
  "meta_placement",
  "meta_fbc",
  "meta_fbp",
] as const;

export function attributionHasCampaign(
  attr: Pick<SollicitatieMetaAttribution, "meta_campaign_id">
): boolean {
  return Boolean(attr.meta_campaign_id);
}
