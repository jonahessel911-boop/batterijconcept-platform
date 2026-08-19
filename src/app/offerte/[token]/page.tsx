import { SignOfferteFlow } from "@/components/offerte/SignOfferteFlow";
import { companyInfo } from "@/lib/pdf-brand";
import { getSupabaseAdmin, hasSupabaseConfig } from "@/lib/supabase";
import type { Offerte, OfferteRegel } from "@/types/database";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Offerte ondertekenen | Batterijconcept",
};

async function loadOfferte(token: string): Promise<{
  offerte: Offerte;
  regels: OfferteRegel[];
} | null> {
  if (!hasSupabaseConfig() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("offertes")
      .select(
        `*, leads(naam, email, lead_number, postcode, huisnummer, toevoeging, straat, plaats), offerte_regels(*)`
      )
      .eq("sign_token", token)
      .single();

    if (error || !data) return null;

    const regels = ((data.offerte_regels as OfferteRegel[]) || []).sort(
      (a, b) => a.sort_order - b.sort_order
    );

    return { offerte: data as Offerte, regels };
  } catch {
    return null;
  }
}

export default async function OfferteSignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await loadOfferte(token);
  if (!data) notFound();
  const co = companyInfo();

  return (
    <SignOfferteFlow
      offerte={data.offerte}
      regels={data.regels}
      bedrijf={{
        naam: co.legal || co.naam,
        legal: co.legal || co.naam,
        kvk: co.kvk || "42141855",
        vestigingsnummer: co.vestigingsnummer || "000066465834",
        adres: co.adres || "Alfred Nobellaan 68",
        postcodePlaats: co.postcodePlaats || "3731DW De Bilt",
      }}
    />
  );
}
