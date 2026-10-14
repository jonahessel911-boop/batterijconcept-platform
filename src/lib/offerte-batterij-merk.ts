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
