import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { logLeadEvent } from "@/lib/lead-events";

export const runtime = "nodejs";

/** PATCH /api/leads/[id] — contact + adres bijwerken */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    naam?: string | null;
    email?: string | null;
    telefoon?: string | null;
    straat?: string | null;
    huisnummer?: string | null;
    toevoeging?: string | null;
    postcode?: string | null;
    plaats?: string | null;
    adviseur_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.naam !== undefined) {
    const naam = body.naam?.trim() || "";
    if (!naam) {
      return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
    }
    patch.naam = naam;
  }
  if (body.email !== undefined) {
    const email = body.email?.trim() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Ongeldig e-mailadres" },
        { status: 400 }
      );
    }
    patch.email = email;
  }
  if (body.telefoon !== undefined) {
    patch.telefoon = body.telefoon?.trim() || null;
  }
  if (body.straat !== undefined) patch.straat = body.straat?.trim() || null;
  if (body.huisnummer !== undefined) {
    patch.huisnummer = body.huisnummer?.trim() || null;
  }
  if (body.toevoeging !== undefined) {
    patch.toevoeging = body.toevoeging?.trim() || null;
  }
  if (body.postcode !== undefined) {
    patch.postcode = body.postcode?.trim() || null;
  }
  if (body.plaats !== undefined) patch.plaats = body.plaats?.trim() || null;
  if (body.adviseur_id !== undefined) {
    patch.adviseur_id = body.adviseur_id?.trim() || null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: before } = await sb
      .from("leads")
      .select(
        "id, naam, email, telefoon, straat, huisnummer, toevoeging, postcode, plaats, adviseur_id"
      )
      .eq("id", id)
      .maybeSingle();

    if (!before) {
      return NextResponse.json({ error: "Lead niet gevonden" }, { status: 404 });
    }

    const { data, error } = await sb
      .from("leads")
      .update(patch)
      .eq("id", id)
      .select(
        "id, naam, email, telefoon, straat, huisnummer, toevoeging, postcode, plaats, lead_number, adviseur_id, adviseurs!adviseur_id(id, naam)"
      )
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Opslaan mislukt", detail: error?.message },
        { status: 500 }
      );
    }

    // Openstaande afspraken meenemen naar de nieuwe adviseur-agenda
    let afsprakenVerplaatst = 0;
    if (
      patch.adviseur_id !== undefined &&
      patch.adviseur_id !== before.adviseur_id
    ) {
      const newAdviseurId = (patch.adviseur_id as string | null) || null;
      if (newAdviseurId) {
        const { data: moved, error: afErr } = await sb
          .from("afspraken")
          .update({ adviseur_id: newAdviseurId })
          .eq("lead_id", id)
          .in("status", ["gepland", "bevestigd", "verzet"])
          .select("id");
        if (afErr) {
          console.error("Afspraken meeverhuizen bij adviseur-wijziging:", afErr);
        } else {
          afsprakenVerplaatst = moved?.length ?? 0;
        }
      }
    }

    const changes = [
      patch.naam !== undefined && patch.naam !== before.naam
        ? `Naam: ${patch.naam}`
        : null,
      patch.telefoon !== undefined && patch.telefoon !== before.telefoon
        ? `Tel: ${(patch.telefoon as string) || "—"}`
        : null,
      patch.email !== undefined && patch.email !== before.email
        ? `E-mail: ${(patch.email as string) || "—"}`
        : null,
      (patch.straat !== undefined ||
        patch.huisnummer !== undefined ||
        patch.postcode !== undefined ||
        patch.plaats !== undefined) &&
      "Adres bijgewerkt",
      patch.adviseur_id !== undefined &&
        patch.adviseur_id !== before.adviseur_id &&
        (afsprakenVerplaatst > 0
          ? `Sales-adviseur bijgewerkt (${afsprakenVerplaatst} afspraak${afsprakenVerplaatst === 1 ? "" : "ken"} meeverhuisd)`
          : "Sales-adviseur bijgewerkt"),
    ].filter(Boolean);

    if (changes.length) {
      await logLeadEvent({
        leadId: id,
        soort: "contact",
        titel: "Contact-/adresgegevens aangepast",
        detail: changes.join(" · "),
      });
    }

    return NextResponse.json({ lead: data, afspraken_verplaatst: afsprakenVerplaatst });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/leads/[id]
 * Verwijdert lead + gekoppelde afspraken/events (cascade).
 * Offertes/conceptfacturen worden meegenomen als er géén project is.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();

    const { data: lead, error: leadErr } = await sb
      .from("leads")
      .select("id, naam, lead_number")
      .eq("id", id)
      .maybeSingle();

    if (leadErr) throw leadErr;
    if (!lead) {
      return NextResponse.json({ error: "Lead niet gevonden" }, { status: 404 });
    }

    const { count: projectCount, error: projErr } = await sb
      .from("projecten")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", id);
    if (projErr && projErr.code !== "42P01") throw projErr;
    if ((projectCount || 0) > 0) {
      return NextResponse.json(
        {
          error:
            "Deze lead heeft een project en kan niet worden verwijderd. Archiveer of verwijder eerst het project.",
        },
        { status: 409 }
      );
    }

    const { data: facturen, error: facErr } = await sb
      .from("facturen")
      .select("id, factuur_nummer, status")
      .eq("lead_id", id);
    if (facErr && facErr.code !== "42P01") throw facErr;

    const blockedFac = (facturen || []).find((f) => {
      const s = String(f.status || "").toLowerCase();
      return s === "betaald" || s === "verstuurd" || s === "deels_betaald";
    });
    if (blockedFac) {
      return NextResponse.json(
        {
          error: `Lead heeft factuur ${blockedFac.factuur_nummer} (${blockedFac.status}) — die moet eerst weg of op concept.`,
        },
        { status: 409 }
      );
    }

    // Concept-/overige facturen
    if ((facturen || []).length > 0) {
      const { error: delFac } = await sb
        .from("facturen")
        .delete()
        .eq("lead_id", id);
      if (delFac) {
        if (
          delFac.code === "23503" ||
          /foreign key|violates foreign key/i.test(delFac.message || "")
        ) {
          return NextResponse.json(
            {
              error:
                "Facturen zijn gekoppeld aan andere gegevens en blokkeren verwijderen.",
              detail: delFac.message,
            },
            { status: 409 }
          );
        }
        throw delFac;
      }
    }

    const { data: offertes, error: offErr } = await sb
      .from("offertes")
      .select("id")
      .eq("lead_id", id);
    if (offErr && offErr.code !== "42P01") throw offErr;

    const offerteIds = (offertes || []).map((o) => o.id as string);
    if (offerteIds.length > 0) {
      const { error: delRegels } = await sb
        .from("offerte_regels")
        .delete()
        .in("offerte_id", offerteIds);
      if (
        delRegels &&
        delRegels.code !== "42P01" &&
        !/does not exist|schema cache/i.test(delRegels.message || "")
      ) {
        throw delRegels;
      }

      const { error: delOff } = await sb
        .from("offertes")
        .delete()
        .eq("lead_id", id);
      if (delOff) {
        if (
          delOff.code === "23503" ||
          /foreign key|violates foreign key/i.test(delOff.message || "")
        ) {
          return NextResponse.json(
            {
              error:
                "Offertes zijn gekoppeld aan andere gegevens en blokkeren verwijderen.",
              detail: delOff.message,
            },
            { status: 409 }
          );
        }
        throw delOff;
      }
    }

    const { error: delLead } = await sb.from("leads").delete().eq("id", id);
    if (delLead) {
      if (
        delLead.code === "23503" ||
        /foreign key|violates foreign key/i.test(delLead.message || "")
      ) {
        return NextResponse.json(
          {
            error:
              "Lead is gekoppeld aan andere gegevens en kan niet worden verwijderd.",
            detail: delLead.message,
          },
          { status: 409 }
        );
      }
      throw delLead;
    }

    return NextResponse.json({
      ok: true,
      deleted: {
        id: lead.id,
        naam: lead.naam,
        lead_number: lead.lead_number,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verwijderen mislukt") },
      { status: 500 }
    );
  }
}
