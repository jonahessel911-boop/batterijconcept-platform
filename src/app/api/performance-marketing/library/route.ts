import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeRol } from "@/lib/rollen";
import {
  libraryByTier,
  readCreativeLibrary,
  setCreativeStatuses,
  setCreativeTiers,
  upsertCreativeItems,
  type CreativeStatusAction,
} from "@/lib/creative-library-store";
import type {
  CreativeLibraryItem,
  CreativeLibraryTier,
  CreativeVariationKind,
} from "@/lib/performance-marketing";
import {
  BC_FUNNEL_HOOKS,
  BC_UGC_VIDEO_CTA,
  buildStructuredAdName,
} from "@/lib/performance-marketing";
import {
  aggressiveCardboard,
  buildMetaAlternativeBriefs,
  buildUgcVideoScript,
  buildVariationPrompt,
  type MetaGeoMode,
} from "@/lib/creative-variants";
import { cardboardForAngle, type TofRegion } from "@/lib/tof-creative";
import { NL_PROVINCES } from "@/lib/nl-geo-targeting";
import {
  enqueueHiggsfieldJobs,
  higgsfieldQueueSummary,
  markHiggsfieldJob,
  pendingHiggsfieldJobs,
} from "@/lib/higgsfield-queue";
import {
  generateCreativeStillPng,
  openaiImagesConfigured,
} from "@/lib/generate-creative-still";

export const runtime = "nodejs";
export const maxDuration = 60;

async function requireAdmin() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session?.adviseurId) {
    return { error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }) };
  }
  const sb = getSupabaseAdmin();
  const { data: me } = await sb
    .from("adviseurs")
    .select("rol")
    .eq("id", session.adviseurId)
    .maybeSingle();
  if (normalizeRol(me?.rol) !== "admin") {
    return { error: NextResponse.json({ error: "Alleen admin" }, { status: 403 }) };
  }
  return { ok: true as const };
}

function funnelCopy(
  angle:
    | "tijdelijke_regeling"
    | "bijna_gratis"
    | "nul_aanbetaling"
    | "qualify_check"
    | "regio",
  region: string = "Nederland"
) {
  const r = (
    ["Limburg", "Noord-Brabant", "Zeeland", "Zuid-Holland", "Nederland"].includes(
      region
    )
      ? region
      : "Nederland"
  ) as TofRegion;
  return cardboardForAngle(angle, r);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;
    const library = readCreativeLibrary();
    const tiers = libraryByTier(library);
    const queue = higgsfieldQueueSummary();
    const onlyQueue =
      req.nextUrl.searchParams.get("queue") === "1" ||
      req.nextUrl.searchParams.get("queueOnly") === "1";
    if (onlyQueue) {
      return NextResponse.json({ ok: true, queue, updatedAt: new Date().toISOString() });
    }
    return NextResponse.json({
      library,
      ...tiers,
      queue,
      funnelHooks: BC_FUNNEL_HOOKS,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Library fout" },
      { status: 500 }
    );
  }
}

type PatchBody =
  | { action: CreativeStatusAction; ids: string[] }
  | { action: "set_tier"; ids: string[]; tier: CreativeLibraryTier }
  | {
      action: "add_from_foreplay";
      ad: {
        id: string;
        name?: string | null;
        headline?: string | null;
        description?: string | null;
        image?: string | null;
        thumbnail?: string | null;
        foreplay_url?: string | null;
        running_days?: number;
      };
      nicheLabel?: string;
      funnelAngle?: "tijdelijke_regeling" | "bijna_gratis" | "nul_aanbetaling" | "qualify_check" | "regio";
      region?: string;
      tier?: CreativeLibraryTier;
    }
  | {
      action: "create_variation";
      parentId: string;
      kind: CreativeVariationKind;
      region?: string;
    }
  | {
      action: "generate_meta_alternatives";
      meta: {
        adId: string;
        adName: string;
        title?: string | null;
        body?: string | null;
        imageUrl?: string | null;
        thumbnailUrl?: string | null;
        campaignName?: string | null;
        linkUrl?: string | null;
      };
      province: string;
      /** province_only = N provincie-varianten · all_places = 1× per plaats */
      mode: MetaGeoMode;
      places?: string[];
      /** still = Meta 1:1 karton · video = UGC 9:16 script-first */
      output?: "still" | "video";
      basePrompt?: string;
      count?: number;
    }
  | {
      action: "attach_higgsfield_images";
      updates: {
        libraryItemId: string;
        imageUrl: string;
        jobId?: string | null;
      }[];
    }
  | {
      action: "attach_higgsfield_videos";
      updates: {
        libraryItemId: string;
        videoUrl: string;
        thumbnailUrl?: string | null;
        jobId?: string | null;
      }[];
    }
  | {
      /** Verwerk pending stills via OpenAI (max N per call) */
      action: "process_generation_queue";
      limit?: number;
      media?: "image" | "video";
    };

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;
    const body = (await req.json()) as PatchBody;

    if (
      body.action === "approve" ||
      body.action === "reject" ||
      body.action === "unapprove"
    ) {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      if (!ids.length) {
        return NextResponse.json({ error: "Geen ids" }, { status: 400 });
      }
      const library = setCreativeStatuses(ids, body.action);
      return NextResponse.json({
        ok: true,
        action: body.action,
        library,
        ...libraryByTier(library),
      });
    }

    if (body.action === "set_tier") {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      if (!ids.length || !body.tier) {
        return NextResponse.json({ error: "ids + tier verplicht" }, { status: 400 });
      }
      const library = setCreativeTiers(ids, body.tier);
      return NextResponse.json({ ok: true, library, ...libraryByTier(library) });
    }

    if (body.action === "add_from_foreplay") {
      const ad = body.ad;
      if (!ad?.id) {
        return NextResponse.json({ error: "ad.id verplicht" }, { status: 400 });
      }
      const angle = body.funnelAngle || "tijdelijke_regeling";
      const region = body.region || "Nederland";
      const copy = funnelCopy(angle, region);
      const id = `fp-${ad.id}`;
      const item: CreativeLibraryItem = {
        id,
        adName: buildStructuredAdName({
          platform: "Meta",
          campaignName: "BATTERIJ - NL - CAMPAIGN - V1 - ADV",
          baseAdName: angle.replace(/_/g, "-"),
          variant: Math.floor(Math.random() * 90) + 10,
          format: "1x1",
        }),
        status: "draft",
        tier: body.tier || "new",
        publishable: false,
        platform: "Meta",
        format: "1x1",
        channel: "social",
        sourceWinnerAdId: ad.id,
        sourceWinnerAdName: `${ad.name || "Foreplay"} · research`,
        campaignHint: "BATTERIJ - NL - CAMPAIGN - V1 - ADV",
        primaryText: copy.primary,
        headline: copy.headline,
        description: copy.description,
        cta: "SEE_DETAILS",
        linkUrl: "https://info-promotie.nl/lp/747223",
        imageUrl: ad.image || ad.thumbnail || "/creatives/winners/AD11-meta-1x1.jpg",
        thumbnailUrl: ad.thumbnail || ad.image,
        higgsfieldJobId: null,
        createdAt: new Date().toISOString(),
        foreplayAdId: ad.id,
        foreplayUrl: ad.foreplay_url || null,
        cardboardText: copy.cardboard,
        notes: [
          "Foreplay research → BC funnel",
          body.nicheLabel ? `niche: ${body.nicheLabel}` : null,
          ad.running_days != null ? `${ad.running_days}d running` : null,
          `hooks: ${BC_FUNNEL_HOOKS.join(" · ")}`,
          ad.headline ? `bron headline: ${ad.headline}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      };
      const library = upsertCreativeItems([item]);
      return NextResponse.json({
        ok: true,
        item,
        library,
        ...libraryByTier(library),
      });
    }

    if (body.action === "create_variation") {
      const lib = readCreativeLibrary();
      const parent = lib.items.find((i) => i.id === body.parentId);
      if (!parent) {
        return NextResponse.json({ error: "Parent niet gevonden" }, { status: 404 });
      }
      const region = body.region?.trim() || "Limburg";
      const built = buildVariationPrompt(parent, body.kind, { region });
      const n =
        lib.items.filter(
          (i) =>
            i.parentCreativeId === parent.id && i.variationKind === body.kind
        ).length + 1;
      const stamp = Date.now().toString(36);
      const stem = `BC-${built.format === "9x16" ? "TT" : "META"}-${body.kind}-v${n}-${stamp}`;
      const itemId = `${parent.id}-var-${body.kind}-v${n}-${stamp}`;
      const cardboard =
        body.kind === "animation_video" || body.kind === "other_region"
          ? `TIJDELIJKE REGELING\nBIJNA GRATIS\nTHUISBATTERIJ\nIN ${region.toUpperCase()}\nCHECK NU`
          : parent.cardboardText ||
            `${built.label}\n${region}`.toUpperCase();
      const isVideo = built.media === "video";
      const item: CreativeLibraryItem = {
        ...parent,
        id: itemId,
        adName: buildStructuredAdName({
          platform: built.format === "9x16" ? "TikTok" : "Meta",
          campaignName: parent.campaignHint || "BATTERIJ - NL - CAMPAIGN - V1 - ADV",
          baseAdName: body.kind.replace(/_/g, "-"),
          variant: n,
          format: built.format,
        }),
        status: "draft",
        tier: "new",
        platform: built.format === "9x16" ? "TikTok" : parent.platform,
        format: built.format,
        // Seed tot Higgsfield klaar is — preview toont cardboardText overlay
        imageUrl: parent.imageUrl.startsWith("/creatives/")
          ? parent.imageUrl
          : "/creatives/winners/AD11-meta-1x1.jpg",
        thumbnailUrl: null,
        videoUrl: null,
        parentCreativeId: parent.id,
        variationKind: body.kind,
        variationPrompt: built.prompt,
        videoScript: built.videoScript || null,
        cardboardText: cardboard,
        cta: isVideo ? BC_UGC_VIDEO_CTA : parent.cta,
        primaryText: isVideo
          ? `${built.videoScript || ""}\n\nCTA: ${BC_UGC_VIDEO_CTA}`
          : parent.primaryText,
        higgsfieldJobId: null,
        approvedAt: null,
        createdAt: new Date().toISOString(),
        headline: isVideo
          ? `UGC video · ${region} · ${built.label}`
          : `${built.label} · ${parent.headline}`,
        notes: `Variatie op ${parent.adName} · ${built.label} · regio ${region} · higgsfield: pending (${built.media})`,
      };
      enqueueHiggsfieldJobs([
        {
          id: `hfq-${stamp}-${n}`,
          libraryItemId: itemId,
          prompt: built.prompt,
          cardboardText: cardboard,
          fileStem: stem,
          seedLocalPath: "public/creatives/winners/AD11-meta-1x1.jpg",
          media: built.media,
          videoScript: built.videoScript || null,
        },
      ]);
      const library = upsertCreativeItems([item]);
      return NextResponse.json({
        ok: true,
        item,
        variation: built,
        higgsfieldQueued: true,
        queueMedia: built.media,
        message: isVideo
          ? `UGC-script klaar voor ${region}. Video in Higgsfield-queue — zeg in chat: “genereer ugc video”.`
          : `Still in Higgsfield-queue — zeg in chat: “genereer higgsfield stills”.`,
        library,
        ...libraryByTier(library),
      });
    }

    if (body.action === "generate_meta_alternatives") {
      const meta = body.meta;
      if (!meta?.adId) {
        return NextResponse.json({ error: "meta.adId verplicht" }, { status: 400 });
      }
      if (!body.province?.trim()) {
        return NextResponse.json({ error: "provincie verplicht" }, { status: 400 });
      }
      const output = body.output === "video" ? "video" : "still";
      const mode: MetaGeoMode =
        body.mode === "all_places" ? "all_places" : "province_only";
      const province = body.province.trim();
      const matched = NL_PROVINCES.find(
        (p) => p.label.toLowerCase() === province.toLowerCase()
      );
      const places =
        mode === "all_places"
          ? (body.places?.length ? body.places : matched?.places || []).filter(
              (p) => p.trim()
            )
          : [];
      if (mode === "all_places" && places.length === 0) {
        return NextResponse.json(
          { error: "Geen plaatsen voor deze provincie" },
          { status: 400 }
        );
      }

      const stamp = Date.now().toString(36);
      const parentId = `meta-winner-${meta.adId}`;
      const campaign =
        meta.campaignName || "BATTERIJ - NL - CAMPAIGN - V1 - ADV";
      const seedImg =
        meta.imageUrl?.startsWith("http") || meta.imageUrl?.startsWith("/")
          ? meta.imageUrl
          : "/creatives/winners/AD11-meta-1x1.jpg";

      if (output === "video") {
        const locations =
          mode === "all_places" ? places : [province];
        const items: CreativeLibraryItem[] = locations.map((loc, i) => {
          const ugc = buildUgcVideoScript({ region: loc });
          const locSlug = loc
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 20);
          const cardboard = aggressiveCardboard(loc);
          return {
            id: `${parentId}-vid-${locSlug}-v${i + 1}-${stamp}`,
            adName: buildStructuredAdName({
              platform: "TikTok",
              campaignName: campaign,
              baseAdName: `ugc-${locSlug}`,
              variant: i + 1,
              format: "9x16",
            }),
            status: "draft" as const,
            tier: "new" as const,
            publishable: false as const,
            platform: "TikTok" as const,
            format: "9x16" as const,
            channel: "social" as const,
            sourceWinnerAdId: meta.adId,
            sourceWinnerAdName: meta.adName,
            campaignHint: campaign,
            primaryText: ugc.scriptText,
            headline: `UGC video · ${ugc.angle}`,
            description: `UGC video · ${loc} · swipe SFX · CTA vast`,
            cta: BC_UGC_VIDEO_CTA,
            linkUrl: meta.linkUrl || "https://info-promotie.nl/lp/747223",
            imageUrl: seedImg,
            thumbnailUrl: meta.thumbnailUrl || seedImg,
            videoUrl: null,
            videoScript: ugc.scriptText,
            higgsfieldJobId: null,
            createdAt: new Date().toISOString(),
            parentCreativeId: parentId,
            variationKind: "animation_video" as const,
            variationPrompt: ugc.generationPrompt,
            cardboardText: cardboard,
            notes: [
              `UGC video op Meta winner ${meta.adName}`,
              ugc.angle,
              `locatie: ${loc}`,
              "higgsfield: pending (video)",
            ].join(" · "),
          };
        });

        enqueueHiggsfieldJobs(
          items.map((item, i) => {
            const loc = locations[i]!;
            const locSlug = loc
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")
              .slice(0, 20);
            return {
              id: `hfq-vid-${stamp}-${i + 1}`,
              libraryItemId: item.id,
              prompt: item.variationPrompt || "",
              cardboardText: item.cardboardText || "",
              fileStem: `BC-TT-ugc-${locSlug}-v${i + 1}-${stamp}`,
              seedLocalPath: "public/creatives/winners/AD11-meta-1x1.jpg",
              media: "video" as const,
              videoScript: item.videoScript || null,
            };
          })
        );

        const library = upsertCreativeItems(items);
        return NextResponse.json({
          ok: true,
          output: "video",
          count: items.length,
          higgsfieldQueued: items.length,
          mode,
          places: locations,
          items,
          library,
          ...libraryByTier(library),
          message: `${items.length} UGC-video script(s) in queue. Render via Higgsfield (credits nodig). Voortgang zie je bovenaan. CTA: ${BC_UGC_VIDEO_CTA}`,
        });
      }

      if (!body.basePrompt?.trim()) {
        return NextResponse.json({ error: "prompt verplicht voor stills" }, { status: 400 });
      }

      const briefs = buildMetaAlternativeBriefs({
        basePrompt: body.basePrompt.trim(),
        province,
        mode,
        places,
        count: body.count ?? 5,
      });
      const provSlug = province
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 20);

      const items: CreativeLibraryItem[] = briefs.map((b) => {
        const locSlug = b.location
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 20);
        return {
          id: `${parentId}-alt-${locSlug}-v${b.index}-${stamp}`,
          adName: buildStructuredAdName({
            platform: "Meta",
            campaignName: campaign,
            baseAdName: `agressief-${locSlug}`,
            variant: b.index,
            format: "1x1",
          }),
          status: "draft" as const,
          tier: "new" as const,
          publishable: false as const,
          platform: "Meta" as const,
          format: "1x1" as const,
          channel: "social" as const,
          sourceWinnerAdId: meta.adId,
          sourceWinnerAdName: meta.adName,
          campaignHint: campaign,
          primaryText: b.primaryText,
          headline: b.headline,
          description:
            mode === "all_places"
              ? `Agressief · plaats ${b.location} · ${province}`
              : `Agressief · provincie ${province}`,
          cta: "SEE_DETAILS",
          linkUrl: meta.linkUrl || "https://info-promotie.nl/lp/747223",
          imageUrl: "/creatives/winners/AD11-meta-1x1.jpg",
          thumbnailUrl: null,
          higgsfieldJobId: null,
          createdAt: new Date().toISOString(),
          parentCreativeId: parentId,
          variationKind: "aggressive_copy" as const,
          variationPrompt: b.prompt,
          cardboardText: b.cardboardText,
          notes: [
            `Meta-alternatief op ${meta.adName}`,
            b.label,
            `mode: ${mode}`,
            `provincie: ${province}`,
            mode === "all_places" ? `plaats: ${b.location}` : `slug: ${provSlug}`,
            "higgsfield: pending",
          ].join(" · "),
        };
      });

      enqueueHiggsfieldJobs(
        items.map((item, i) => {
          const b = briefs[i]!;
          const locSlug = b.location
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 20);
          return {
            id: `hfq-${stamp}-${b.index}`,
            libraryItemId: item.id,
            prompt: b.prompt,
            cardboardText: b.cardboardText,
            fileStem: `BC-META-agressief-${locSlug}-v${b.index}-${stamp}`,
            seedLocalPath: "public/creatives/winners/AD11-meta-1x1.jpg",
            media: "image" as const,
          };
        })
      );

      const library = upsertCreativeItems(items);
      return NextResponse.json({
        ok: true,
        output: "still",
        count: items.length,
        higgsfieldQueued: items.length,
        processQueue: openaiImagesConfigured(),
        mode,
        places: mode === "all_places" ? places : [province],
        items,
        library,
        ...libraryByTier(library),
        message: openaiImagesConfigured()
          ? `${items.length} stills in queue — OpenAI maakt ze nu op de achtergrond.`
          : `${items.length} still-drafts gequeued (geen OPENAI_API_KEY voor auto-render).`,
      });
    }

    if (body.action === "process_generation_queue") {
      const limit = Math.min(Math.max(body.limit ?? 2, 1), 4);
      const media = body.media === "video" ? "video" : "image";
      if (media === "video") {
        const pending = pendingHiggsfieldJobs(40, "video");
        for (const job of pending) {
          markHiggsfieldJob(job.id, {
            status: "failed",
            error:
              "Video-render via Higgsfield — te weinig credits of niet server-side. Top-up Higgsfield of zeg in chat “genereer ugc video”.",
          });
        }
        return NextResponse.json({
          ok: true,
          processed: 0,
          failed: pending.length,
          media: "video",
          queue: higgsfieldQueueSummary(),
          message:
            pending.length > 0
              ? `${pending.length} video(s) wachten op Higgsfield-credits.`
              : "Geen video-jobs in queue.",
        });
      }

      if (!openaiImagesConfigured()) {
        return NextResponse.json(
          { error: "OPENAI_API_KEY ontbreekt — stills kunnen niet auto-genereren" },
          { status: 400 }
        );
      }

      const jobs = pendingHiggsfieldJobs(limit, "image");
      const lib = readCreativeLibrary();
      const byId = new Map(lib.items.map((i) => [i.id, i]));
      let done = 0;
      let failed = 0;
      const results: { libraryItemId: string; imageUrl?: string; error?: string }[] =
        [];

      for (const job of jobs) {
        markHiggsfieldJob(job.id, { status: "running", error: null });
        try {
          const out = await generateCreativeStillPng({
            prompt: job.prompt,
            fileStem: job.fileStem || `still-${job.id}`,
          });
          markHiggsfieldJob(job.id, {
            status: "done",
            imageUrl: out.relativeUrl,
            jobId: `openai-${Date.now().toString(36)}`,
          });
          const cur = byId.get(job.libraryItemId);
          if (cur) {
            byId.set(job.libraryItemId, {
              ...cur,
              imageUrl: out.relativeUrl,
              thumbnailUrl: out.relativeUrl,
              notes: [cur.notes, "openai still: done"]
                .filter(Boolean)
                .join(" · ")
                .replace(/higgsfield: pending/g, "openai still: done"),
            });
          }
          done += 1;
          results.push({ libraryItemId: job.libraryItemId, imageUrl: out.relativeUrl });
        } catch (e) {
          const err = e instanceof Error ? e.message : "Still generatie mislukt";
          markHiggsfieldJob(job.id, { status: "failed", error: err });
          failed += 1;
          results.push({ libraryItemId: job.libraryItemId, error: err });
        }
      }

      const library = upsertCreativeItems([...byId.values()]);
      const queue = higgsfieldQueueSummary();
      return NextResponse.json({
        ok: true,
        processed: done,
        failed,
        results,
        queue,
        library,
        ...libraryByTier(library),
        message: `Stills: ${done} klaar · ${failed} fout · nog ${queue.pending} wachtend`,
      });
    }

    if (body.action === "attach_higgsfield_images") {
      const updates = Array.isArray(body.updates) ? body.updates : [];
      if (!updates.length) {
        return NextResponse.json({ error: "updates verplicht" }, { status: 400 });
      }
      const lib = readCreativeLibrary();
      const byId = new Map(lib.items.map((i) => [i.id, i]));
      for (const u of updates) {
        const cur = byId.get(u.libraryItemId);
        if (!cur) continue;
        byId.set(u.libraryItemId, {
          ...cur,
          imageUrl: u.imageUrl,
          thumbnailUrl: u.imageUrl,
          higgsfieldJobId: u.jobId || cur.higgsfieldJobId || null,
          notes: [cur.notes, "higgsfield: done"]
            .filter(Boolean)
            .join(" · ")
            .replace(/higgsfield: pending/g, "higgsfield: done"),
        });
      }
      const library = upsertCreativeItems([...byId.values()]);
      return NextResponse.json({
        ok: true,
        attached: updates.length,
        library,
        ...libraryByTier(library),
      });
    }

    if (body.action === "attach_higgsfield_videos") {
      const updates = Array.isArray(body.updates) ? body.updates : [];
      if (!updates.length) {
        return NextResponse.json({ error: "updates verplicht" }, { status: 400 });
      }
      const lib = readCreativeLibrary();
      const byId = new Map(lib.items.map((i) => [i.id, i]));
      for (const u of updates) {
        const cur = byId.get(u.libraryItemId);
        if (!cur) continue;
        byId.set(u.libraryItemId, {
          ...cur,
          videoUrl: u.videoUrl,
          thumbnailUrl: u.thumbnailUrl || cur.thumbnailUrl || cur.imageUrl,
          higgsfieldJobId: u.jobId || cur.higgsfieldJobId || null,
          notes: [cur.notes, "higgsfield video: done"]
            .filter(Boolean)
            .join(" · ")
            .replace(/higgsfield: pending \(video\)/g, "higgsfield video: done")
            .replace(/higgsfield: pending/g, "higgsfield video: done"),
        });
      }
      const library = upsertCreativeItems([...byId.values()]);
      return NextResponse.json({
        ok: true,
        attached: updates.length,
        library,
        ...libraryByTier(library),
      });
    }

    return NextResponse.json({ error: "Onbekende action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Library PATCH fout" },
      { status: 500 }
    );
  }
}
