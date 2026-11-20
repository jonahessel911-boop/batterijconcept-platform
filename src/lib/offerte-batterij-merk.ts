import { isKortingRegel, isVerborgenOfferteRegel } from "@/lib/offerte-regels";

/**
 * Haal thuisbatterij-merk/-product uit offerte regels (voor klantmails).
 */

export function batterijMerkUitRegels(
  regels: { omschrijving?: string | null }[] | null | undefined,
  fallbackTitel?: string | null
): string {
  const list = regels || [];
  const batterijRegel = list.find((r) => {
    const o = (r.omschrijving || "").toLowerCase();
    return (
      o.includes("batterij") ||
      o.includes("alpha") ||
      o.includes("kwh") ||
      o.includes("smile") ||
      o.includes("enphase") ||
      o.includes("huawei") ||
      o.includes("growatt") ||
      o.includes("byd") ||
      o.includes("tesla")
    );
  });
  const raw =
    batterijRegel?.omschrijving?.trim() ||
    list[0]?.omschrijving?.trim() ||
    fallbackTitel?.trim() ||
    "";

  if (!raw) return "thuisbatterij";

  const t = raw.toLowerCase();
  if (t.includes("alpha ess") || t.includes("alphaess") || t.includes("alpha-ess")) {
    return "Alpha ESS";
  }
  if (t.includes("enphase")) return "Enphase";
  if (t.includes("huawei")) return "Huawei";
  if (t.includes("growatt")) return "Growatt";
  if (t.includes("byd")) return "BYD";
  if (t.includes("tesla") || t.includes("powerwall")) return "Tesla Powerwall";
  if (t.includes("solaredge")) return "SolarEdge";

  // Kort label: eerste deel tot komma / max ~60 chars
  const short = raw.split(/[|,–—]/)[0]?.trim() || raw;
  return short.length > 60 ? `${short.slice(0, 57)}…` : short;
}

function kwhUitTekst(text: string): number | null {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*kwh/i);
  if (!m) return null;
  const kwh = Number(m[1].replace(",", "."));
  return Number.isFinite(kwh) && kwh > 0 ? kwh : null;
}

function formatKwhNl(kwh: number): string {
  const rounded = Math.round(kwh * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1).replace(".", ",");
}

function isAccessoireRegel(omschrijving: string): boolean {
  const o = omschrijving.toLowerCase();
  return (
    o.includes("kabel") ||
    o.includes("dtsu") ||
    o.includes("meter") ||
    o.includes("omvormer") ||
    o.includes("baseplate") ||
    o.includes("base plate") ||
    o.includes("wall bracket") ||
    o.includes("beugel")
  );
}

/** Kort planbord-label: "Alpha ESS 9,3" of "Alpha ESS 18,6". */
export function installatieBatterijKortLabel(
  regels:
    | { omschrijving?: string | null; aantal?: number | null }[]
    | null
    | undefined
): string | null {
  if (!regels?.length) return null;
  let kwh = 0;
  let merk: string | null = null;
  for (const r of regels) {
    const raw = (r.omschrijving || "").trim();
    if (!raw) continue;
    if (isVerborgenOfferteRegel(r)) continue;
    if (isKortingRegel({ omschrijving: raw })) continue;
    if (isAccessoireRegel(raw)) continue;
    const one = kwhUitTekst(raw);
    if (one == null) continue;
    const n = Math.max(1, Number(r.aantal) || 1);
    kwh += one * n;
    if (!merk) {
      const found = batterijMerkUitRegels([r]);
      if (found && found !== "thuisbatterij") merk = found;
    }
  }
  if (kwh <= 0) return null;
  const size = formatKwhNl(kwh);
  return merk ? `${merk} ${size}` : size;
}
