import type { SupabaseClient } from "@supabase/supabase-js";
import type { Offerte, OfferteRegel } from "@/types/database";
import { adresRegel } from "@/lib/format";
import { buildOffertePdf } from "@/lib/pdf-offerte";

type SignPayload = {
  naam: string;
  handtekeningDataUrl: string;
  ondertekendOp: Date;
};

/**
 * Laadt offerte + regels en bouwt de actuele PDF-layout
 * (zelfde bron als ondertekenpagina / klantmail).
 */
export async function buildOffertePdfForId(
  sb: SupabaseClient,
  offerteId: string,
  sign?: SignPayload
): Promise<{
  blob: Blob;
  filename: string;
  offerte: Offerte;
  leadEmail: string | null;
  leadNaam: string;
}> {
  const { data: offerte, error } = await sb
    .from("offertes")
    .select(
      `*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), offerte_regels(*)`
    )
    .eq("id", offerteId)
    .single();

  if (error || !offerte) {
    throw new Error("Offerte niet gevonden");
  }

  const regels = ((offerte.offerte_regels as OfferteRegel[]) || []).sort(
    (a, b) => a.sort_order - b.sort_order
  );

  const lead = offerte.leads as Offerte["leads"];
  const blob = await buildOffertePdf({
    offerte: offerte as Offerte,
    regels,
    sign,
    adres: lead ? adresRegel(lead) : undefined,
  });

  const signed = Boolean(sign) || offerte.status === "ondertekend";
  const filename = signed
    ? `${offerte.offerte_nummer}-ondertekend.pdf`
    : `${offerte.offerte_nummer}.pdf`;

  return {
    blob,
    filename,
    offerte: offerte as Offerte,
    leadEmail: lead?.email || null,
    leadNaam: lead?.naam || "Klant",
  };
}
