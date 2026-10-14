import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { ensureOfferteTrackToken } from "@/lib/ensure-track-token";
import { logLeadEvent } from "@/lib/lead-events";
import { formatDateTimeNl } from "@/lib/format";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { overstapFrankEnergieEmail } from "@/lib/email/templates";
import { FRANK_ENERGIE_OVERSTAP_URL } from "@/lib/frank-energie";
import { batterijMerkUitRegels } from "@/lib/offerte-batterij-merk";
import { syncProjectServiceStatus } from "@/lib/service-verzoek";
import {
  datumOptieSoortLabel,
  isDatumOptieSoort,
  type ProjectDatumOptie,
} from "@/lib/project-datum-opties";
import {
  isBoOverstapSlotFree,
  OVERSTAP_SLOT_MINUTES,
} from "@/lib/bo-overstap-slots";

export const runtime = "nodejs";

function publicBrandDataUrl(filename: string): string | null {
  try {
    const full = path.join(process.cwd(), "public", "brands", filename);
    if (!fs.existsSync(full)) return null;
    const b64 = fs.readFileSync(full).toString("base64");
    return `data:image/png;base64,${b64}`;
  } catch {
    return null;
  }
}

/**
 * POST /api/track/[token]/datum-opties
 * Body:
 *  - { soort, slot_index: 0|1|2, naam, email, telefoon }
 *  - overstap alt: { soort: "overstap", custom_start_at, adviseur_id, naam, email, telefoon }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      soort?: unknown;
      slot_index?: unknown;
      custom_start_at?: unknown;
      adviseur_id?: unknown;
      naam?: unknown;
      email?: unknown;
      telefoon?: unknown;
    };

    if (!isDatumOptieSoort(body.soort)) {
      return NextResponse.json({ error: "Ongeldig type" }, { status: 400 });
    }
    const soort = body.soort;
    const customStart =
      typeof body.custom_start_at === "string"
        ? body.custom_start_at.trim()
        : "";
    const customAdviseurId =
      typeof body.adviseur_id === "string" ? body.adviseur_id.trim() : "";
    const useCustom =
      soort === "overstap" && Boolean(customStart && customAdviseurId);
    const slotIndex = Number(body.slot_index);
    if (!useCustom && ![0, 1, 2].includes(slotIndex)) {
      return NextResponse.json(
        { error: "Kies een van de drie tijden" },
        { status: 400 }
      );
    }

    const naam =
      typeof body.naam === "string" ? body.naam.trim() : "";
    const email =
      typeof body.email === "string" ? body.email.trim() : "";
    const telefoon =
      typeof body.telefoon === "string" ? body.telefoon.trim() : "";

    if (naam.length < 2) {
      return NextResponse.json(
        { error: "Vul je naam in" },
        { status: 400 }
      );
    }
    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "Vul een geldig e-mailadres in" },
        { status: 400 }
      );
    }
    if (telefoon.replace(/\D/g, "").length < 8) {
      return NextResponse.json(
        { error: "Vul een geldig telefoonnummer in" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data: offerte, error: offErr } = await sb
      .from("offertes")
      .select("id, lead_id, track_token, status")
      .eq("track_token", token)
      .maybeSingle();

    if (offErr) {
      if (offErr.code === "42703" || offErr.message?.includes("track_token")) {
        return NextResponse.json(
          { error: "Track & trace is nog niet beschikbaar" },
          { status: 503 }
        );
      }
      throw offErr;
    }
    if (!offerte || offerte.status !== "ondertekend") {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }

    const trackToken = await ensureOfferteTrackToken(
      sb,
      offerte.id,
      offerte.track_token
    );
    if (!trackToken) {
      return NextResponse.json(
        { error: "Track & trace is nog niet beschikbaar" },
        { status: 503 }
      );
    }

    let { data: project } = await sb
      .from("projecten")
      .select("id, lead_id, service_notities, project_nummer, offerte_id")
      .eq("offerte_id", offerte.id)
      .maybeSingle();
    if (!project) {
      const { data: byLead } = await sb
        .from("projecten")
        .select("id, lead_id, service_notities, project_nummer, offerte_id")
        .eq("lead_id", offerte.lead_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      project = byLead;
    }
    if (!project?.id) {
      return NextResponse.json(
        { error: "Geen project gekoppeld" },
        { status: 400 }
      );
    }

    const { data: optie, error: optErr } = await sb
      .from("project_datum_opties")
      .select("*")
      .eq("project_id", project.id)
      .eq("soort", soort)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (optErr) {
      if (
        optErr.code === "42P01" ||
        optErr.message?.includes("project_datum_opties")
      ) {
        return NextResponse.json(
          {
            error:
              "Datum-opties nog niet beschikbaar — migrate-project-datum-opties.sql",
          },
          { status: 503 }
        );
      }
      throw optErr;
    }
    if (!optie) {
      return NextResponse.json(
        { error: "Geen open uitnodiging meer — neem contact op" },
        { status: 409 }
      );
    }

    const row = optie as ProjectDatumOptie;
    let gekozen: string;
    let boAdviseurId: string | null = null;

    if (useCustom) {
      const free = await isBoOverstapSlotFree(
        sb,
        customAdviseurId,
        customStart
      );
      if (!free) {
        return NextResponse.json(
          {
            error:
              "Dit tijdslot is niet meer beschikbaar — kies een andere tijd",
          },
          { status: 409 }
        );
      }
      gekozen = new Date(customStart).toISOString();
      boAdviseurId = customAdviseurId;
    } else {
      const slots = [row.slot_1, row.slot_2, row.slot_3];
      gekozen = slots[slotIndex]!;
      if (!gekozen) {
        return NextResponse.json(
          { error: "Ongeldige tijdkeuze" },
          { status: 400 }
        );
      }
    }

    const now = new Date().toISOString();
    const { error: updOptErr } = await sb
      .from("project_datum_opties")
      .update({
        status: "gekozen",
        gekozen_slot: gekozen,
        bevestigd_naam: naam,
        bevestigd_email: email,
        bevestigd_telefoon: telefoon,
        gekozen_at: now,
      })
      .eq("id", row.id)
      .eq("status", "open");

    if (updOptErr) throw updOptErr;

    if (soort === "service") {
      const boNotitie =
        typeof (row as ProjectDatumOptie).service_notitie === "string"
          ? ((row as ProjectDatumOptie).service_notitie || "").trim()
          : "";
      const whenLabel = formatDateTimeNl(gekozen);
      const installerNote =
        boNotitie ||
        `Service · klant gekozen via portaal · ${whenLabel}`;
      const omschrijving = [
        installerNote,
        `Gekozen: ${whenLabel}`,
        `Bevestigd door: ${naam}`,
        `E-mail: ${email}`,
        `Tel: ${telefoon}`,
        "Bron: Mijn portaal · datum-opties",
      ].join("\n");

      const { error: pErr } = await sb
        .from("projecten")
        .update({
          service_at: gekozen,
          service_notities: installerNote,
        })
        .eq("id", project.id);
      if (pErr) throw pErr;

      // Serviceverzoek: update open verzoek of maak nieuw
      const { data: openVerzoek } = await sb
        .from("service_verzoeken")
        .select("id, onderwerp")
        .eq("project_id", project.id)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const leadIdForVerzoek = (project.lead_id ||
        offerte.lead_id) as string;

      if (openVerzoek?.id) {
        await sb
          .from("service_verzoeken")
          .update({
            interne_notitie: omschrijving,
            omschrijving: omschrijving,
            ...(boNotitie
              ? { onderwerp: boNotitie.slice(0, 120) }
              : {}),
          })
          .eq("id", openVerzoek.id);
      } else {
        const insertVerzoek: Record<string, unknown> = {
          project_id: project.id,
          lead_id: leadIdForVerzoek,
          onderwerp: (boNotitie || `Service ${whenLabel}`).slice(0, 120),
          omschrijving,
          interne_notitie: omschrijving,
          status: "open",
          klant_email: email.toLowerCase(),
        };
        const { error: vErr } = await sb
          .from("service_verzoeken")
          .insert(insertVerzoek);
        if (vErr && !vErr.message?.includes("klant_email")) {
          // Retry zonder optionele kolom
          if (vErr.code === "42703") {
            delete insertVerzoek.klant_email;
            delete insertVerzoek.interne_notitie;
            await sb.from("service_verzoeken").insert(insertVerzoek);
          } else {
            console.error("service_verzoeken insert:", vErr.message);
          }
        }
      }

      try {
        await syncProjectServiceStatus(sb, project.id);
      } catch (e) {
        console.error("syncProjectServiceStatus:", e);
      }
    } else {
      const { error: pErr } = await sb
        .from("projecten")
        .update({ overstap_afspraak_at: gekozen })
        .eq("id", project.id);
      if (pErr) {
        if (
          pErr.message?.includes("overstap_afspraak_at") ||
          pErr.code === "42703"
        ) {
          return NextResponse.json(
            {
              error:
                "Kolom overstap_afspraak_at ontbreekt — migrate-project-datum-opties.sql",
            },
            { status: 503 }
          );
        }
        throw pErr;
      }

      // Alt-slot of voorgestelde slot → ook in Taken-agenda (BO)
      {
        let ownerId = boAdviseurId;
        if (!ownerId) {
          // Wijs toe aan eerste vrije BO op dit moment
          const { data: bos } = await sb
            .from("adviseurs")
            .select("id, rol, actief")
            .eq("actief", true);
          for (const a of bos || []) {
            const rol = (a.rol || "").toString();
            if (rol !== "backoffice" && rol !== "admin") continue;
            if (await isBoOverstapSlotFree(sb, a.id as string, gekozen)) {
              ownerId = a.id as string;
              break;
            }
          }
        }
        if (ownerId) {
          const endAt = new Date(
            new Date(gekozen).getTime() + OVERSTAP_SLOT_MINUTES * 60_000
          ).toISOString();
          const { error: boErr } = await sb.from("bo_agenda").insert({
            adviseur_id: ownerId,
            titel: `Overstap · ${naam}`,
            inhoud: `Dynamische energie · ${email} · ${telefoon}\nOrder ${project.project_nummer || ""}`.trim(),
            soort: "afspraak",
            start_at: gekozen,
            end_at: endAt,
            status: "todo",
          });
          if (boErr) {
            console.error("bo_agenda overstap:", boErr.message);
          }
        }
      }

      // Bevestigingsmail: BatterijConcept × Frank Energie + batterijmerk uit offerte
      try {
        const offerteId =
          (project.offerte_id as string | null) || (offerte.id as string);
        const { data: offMeta } = await sb
          .from("offertes")
          .select("id, titel, offerte_nummer")
          .eq("id", offerteId)
          .maybeSingle();
        const { data: regels } = await sb
          .from("offerte_regels")
          .select("omschrijving, sort_order")
          .eq("offerte_id", offerteId)
          .order("sort_order", { ascending: true })
          .limit(10);
        const batterijMerk = batterijMerkUitRegels(
          regels || [],
          offMeta?.titel
        );
        const base = appBaseUrl();
        // Absoluut (na deploy) + fallback data-URI voor lokale/preview mails
        const logoBcUrl =
          publicBrandDataUrl("batterijconcept-mark.png") ||
          `${base}/brands/batterijconcept-mark.png`;
        const logoFrankUrl =
          publicBrandDataUrl("frank-energie.png") ||
          `${base}/brands/frank-energie.png`;
        const html = overstapFrankEnergieEmail({
          naam,
          afspraakAt: gekozen,
          batterijMerk,
          frankUrl: FRANK_ENERGIE_OVERSTAP_URL,
          logoBcUrl,
          logoFrankUrl,
          projectNummer:
            (project.project_nummer as string | null) ||
            offMeta?.offerte_nummer ||
            null,
        });
        const sent = await sendEmail({
          to: email,
          subject:
            "Overstap dynamische energie · BatterijConcept × Frank Energie",
          html,
          tag: "overstap-frank",
        });
        if (!sent.ok) {
          console.error("overstap Frank-mail:", sent.error);
        }
      } catch (mailErr) {
        console.error("overstap Frank-mail:", mailErr);
      }
    }

    const leadId = (project.lead_id || offerte.lead_id) as string | null;
    if (leadId) {
      void logLeadEvent({
        leadId,
        soort: "datum_optie_gekozen",
        titel: `${datumOptieSoortLabel(soort)}-datum gekozen door klant`,
        detail: `${naam} · ${email} · ${telefoon}`,
        meta: {
          project_id: project.id,
          soort,
          gekozen_slot: gekozen,
          optie_id: row.id,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      soort,
      gekozen_slot: gekozen,
    });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
