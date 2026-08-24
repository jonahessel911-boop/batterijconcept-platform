"use client";

import { useEffect, useMemo, useState } from "react";
import type { InstallatiePartner, Product } from "@/types/database";
import { formatEuro } from "@/lib/format";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import {
  isAlphaEssMetOmvormerRegel,
  omvormerOmschrijvingVoor,
} from "@/lib/offerte-regels";

type Line = {
  key: string;
  product_id: string | null;
  omschrijving: string;
  aantal: number;
  prijs_ex_btw: number;
  btw_percentage: number;
};

type KortingModus = "bedrag" | "nieuw_totaal";
type KortingZichtbaar = "zichtbaar" | "verborgen";
type KortingBtw = "incl" | "excl";

function lineIncBtw(l: Line) {
  return (
    Math.round(
      l.aantal * l.prijs_ex_btw * (1 + l.btw_percentage / 100) * 100
    ) / 100
  );
}

function linesTotaalInc(list: Line[]) {
  return Math.round(list.reduce((s, l) => s + lineIncBtw(l), 0) * 100) / 100;
}

function linesTotaalEx(list: Line[]) {
  return (
    Math.round(
      list.reduce((s, l) => s + l.aantal * l.prijs_ex_btw, 0) * 100
    ) / 100
  );
}

function toIncBtw(bedrag: number, btw: KortingBtw) {
  if (btw === "incl") return Math.round(bedrag * 100) / 100;
  return Math.round(bedrag * 1.21 * 100) / 100;
}

/** Verdeel korting (incl. btw) over betaalde regels zodat geen kortingsregel nodig is. */
function applyHiddenKorting(lines: Line[], kortingInc: number): Line[] {
  if (kortingInc <= 0) return lines.map((l) => ({ ...l }));

  const hasPaid = lines.some((l) => l.prijs_ex_btw > 0);
  if (!hasPaid) return lines.map((l) => ({ ...l }));

  const paidInc = linesTotaalInc(lines.filter((l) => l.prijs_ex_btw > 0));
  if (paidInc <= 0) return lines.map((l) => ({ ...l }));

  const targetInc =
    Math.round((linesTotaalInc(lines) - kortingInc) * 100) / 100;
  const scale = Math.max(0, (paidInc - kortingInc) / paidInc);

  const scaled = lines.map((l) => {
    if (l.prijs_ex_btw <= 0) return { ...l };
    return {
      ...l,
      prijs_ex_btw: Math.round(l.prijs_ex_btw * scale * 100) / 100,
    };
  });

  // Afrondingsrest op grootste betaalde regel
  const actual = linesTotaalInc(scaled);
  const diff = Math.round((actual - targetInc) * 100) / 100;
  if (Math.abs(diff) < 0.005) return scaled;

  let best = -1;
  let bestEx = -1;
  for (let i = 0; i < scaled.length; i++) {
    if (scaled[i].prijs_ex_btw > bestEx) {
      bestEx = scaled[i].prijs_ex_btw;
      best = i;
    }
  }
  if (best < 0) return scaled;

  const l = scaled[best];
  const dEx = -diff / (l.aantal * (1 + l.btw_percentage / 100));
  scaled[best] = {
    ...l,
    prijs_ex_btw: Math.round((l.prijs_ex_btw + dEx) * 100) / 100,
  };
  return scaled;
}

export function MaakOfferteModal({
  open,
  leadId,
  leadNaam,
  onClose,
  onCreated,
}: {
  open: boolean;
  leadId: string;
  leadNaam: string;
  onClose: () => void;
  onCreated: (offerteId: string) => void;
}) {
  const [producten, setProducten] = useState<Product[]>([]);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [productId, setProductId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [aantal, setAantal] = useState(1);
  const [customOmschrijving, setCustomOmschrijving] = useState("");
  const [customAantal, setCustomAantal] = useState(1);
  const [customPrijs, setCustomPrijs] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [useKorting, setUseKorting] = useState(false);
  const [kortingModus, setKortingModus] = useState<KortingModus>("bedrag");
  const [kortingZichtbaar, setKortingZichtbaar] =
    useState<KortingZichtbaar>("zichtbaar");
  const [kortingBtw, setKortingBtw] = useState<KortingBtw>("incl");
  const [korting, setKorting] = useState("");
  const [financiering, setFinanciering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !hasSupabaseConfig()) return;
    let cancelled = false;
    queueMicrotask(async () => {
      const sb = getSupabaseBrowser();
      const [prodRes, partnerRes] = await Promise.all([
        sb.from("producten").select("*").eq("actief", true).order("naam"),
        fetch("/api/installatie-partners").then((r) => r.json()),
      ]);
      if (!cancelled) {
        setProducten((prodRes.data as Product[]) || []);
        setPartners((partnerRes.partners as InstallatiePartner[]) || []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const kortingInput = Number(korting.replace(",", ".")) || 0;

  const basisTotaalInc = useMemo(() => linesTotaalInc(lines), [lines]);
  const basisTotaalEx = useMemo(() => linesTotaalEx(lines), [lines]);

  /** Ingevoerd bedrag omgerekend naar incl. btw (voor korting/nieuw totaal). */
  const kortingInputInc = useMemo(
    () => toIncBtw(kortingInput, kortingBtw),
    [kortingInput, kortingBtw]
  );

  const kortingInc = useMemo(() => {
    if (!useKorting || kortingInput <= 0) return 0;
    if (kortingModus === "nieuw_totaal") {
      if (kortingInputInc >= basisTotaalInc) return 0;
      return Math.round((basisTotaalInc - kortingInputInc) * 100) / 100;
    }
    return Math.min(kortingInputInc, basisTotaalInc);
  }, [
    useKorting,
    kortingInput,
    kortingInputInc,
    kortingModus,
    basisTotaalInc,
  ]);

  const previewLines = useMemo(() => {
    let out: Line[];

    if (useKorting && kortingInc > 0) {
      if (kortingZichtbaar === "zichtbaar") {
        const ex = Math.round((kortingInc / 1.21) * 100) / 100;
        out = [
          ...lines,
          {
            key: "korting",
            product_id: null,
            omschrijving: "Korting",
            aantal: 1,
            prijs_ex_btw: -ex,
            btw_percentage: 21,
          },
        ];
      } else {
        out = applyHiddenKorting(lines, kortingInc);
      }
    } else {
      out = [...lines];
    }

    if (
      financiering &&
      !out.some((l) => /warmtefonds\s+aanvraag/i.test(l.omschrijving))
    ) {
      out.push({
        key: "warmtefonds-service",
        product_id: null,
        omschrijving: "Warmtefonds aanvraag service",
        aantal: 1,
        prijs_ex_btw: 0,
        btw_percentage: 21,
      });
    }
    return out;
  }, [lines, useKorting, kortingInc, kortingZichtbaar, financiering]);

  const totaalInc = useMemo(() => linesTotaalInc(previewLines), [previewLines]);

  if (!open) return null;

  function addProduct() {
    const p = producten.find((x) => x.id === productId);
    if (!p) return;
    const isAlpha = p.naam.startsWith("Alpha ESS");
    const qty = Math.max(1, aantal);
    const omvormerLabel = omvormerOmschrijvingVoor(p.naam);
    setLines((prev) => {
      const next: Line[] = [
        ...prev,
        {
          key: `${p.id}-${Date.now()}`,
          product_id: p.id,
          omschrijving: p.naam,
          aantal: qty,
          prijs_ex_btw: Number(p.prijs_ex_btw),
          btw_percentage: Number(p.btw_percentage ?? 21),
        },
      ];
      if (isAlpha) {
        if (omvormerLabel && isAlphaEssMetOmvormerRegel(p.naam)) {
          const hasOmvormer = [...prev, ...next].some((l) =>
            /omvormer/i.test(l.omschrijving)
          );
          if (!hasOmvormer) {
            next.push({
              key: `omvormer-${p.id}-${Date.now()}`,
              product_id: null,
              omschrijving: omvormerLabel,
              aantal: qty,
              prijs_ex_btw: 0,
              btw_percentage: 21,
            });
          }
        }
        next.push({
          key: `subsidie-${p.id}-${Date.now()}`,
          product_id: null,
          omschrijving: "BTW subsidie-aanvraag",
          aantal: 1,
          prijs_ex_btw: 0,
          btw_percentage: 21,
        });
        const hasInstallatie = [...prev, ...next].some((l) =>
          /installatie\s*\+\s*installatieopname/i.test(l.omschrijving)
        );
        if (!hasInstallatie) {
          next.push({
            key: `installatie-${p.id}-${Date.now()}`,
            product_id: null,
            omschrijving: "Installatie + installatieopname",
            aantal: 1,
            prijs_ex_btw: 0,
            btw_percentage: 21,
          });
        }
      }
      return next;
    });
    setProductId("");
    setAantal(1);
  }

  function addCustomLine() {
    const omschrijving = customOmschrijving.trim();
    const prijs = Number(customPrijs.replace(",", "."));
    if (!omschrijving) {
      setError("Vul een omschrijving in voor de eigen regel.");
      return;
    }
    if (Number.isNaN(prijs)) {
      setError("Vul een geldige prijs excl. btw in.");
      return;
    }
    setError(null);
    setLines((prev) => [
      ...prev,
      {
        key: `custom-${Date.now()}`,
        product_id: null,
        omschrijving,
        aantal: Math.max(1, customAantal),
        prijs_ex_btw: Math.round(prijs * 100) / 100,
        btw_percentage: 21,
      },
    ]);
    setCustomOmschrijving("");
    setCustomAantal(1);
    setCustomPrijs("");
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lines.length === 0) {
      setError("Voeg minstens één regel toe (product of eigen regel).");
      return;
    }
    if (!partnerId) {
      setError("Kies een installateur (intern).");
      return;
    }
    if (useKorting) {
      if (kortingInput <= 0) {
        setError("Vul een geldig kortingsbedrag of nieuw totaal in.");
        return;
      }
      if (kortingModus === "nieuw_totaal") {
        const teHoog =
          kortingBtw === "incl"
            ? kortingInput >= basisTotaalInc
            : kortingInput >= basisTotaalEx;
        if (teHoog) {
          setError(
            kortingBtw === "incl"
              ? "Het nieuwe totaal moet lager zijn dan het huidige totaal incl. btw."
              : "Het nieuwe totaal moet lager zijn dan het huidige totaal excl. btw."
          );
          return;
        }
      } else if (kortingInputInc >= basisTotaalInc) {
        setError("De korting mag niet groter of gelijk zijn aan het totaal.");
        return;
      }
      if (
        kortingZichtbaar === "verborgen" &&
        !lines.some((l) => l.prijs_ex_btw > 0)
      ) {
        setError(
          "Verborgen korting vereist minstens één regel met een prijs."
        );
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const regels = previewLines.map((l) => ({
        product_id: l.product_id || undefined,
        omschrijving: l.omschrijving,
        aantal: l.aantal,
        prijs_ex_btw: l.prijs_ex_btw,
        btw_percentage: l.btw_percentage,
      }));

      const res = await fetch("/api/offertes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          titel: `Offerte voor ${leadNaam}`,
          financiering_voorbehoud: financiering,
          installatie_partner_id: partnerId,
          regels,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Offerte aanmaken mislukt");

      setLines([]);
      setUseKorting(false);
      setKortingModus("bedrag");
      setKortingZichtbaar("zichtbaar");
      setKortingBtw("incl");
      setKorting("");
      setFinanciering(false);
      setPartnerId("");
      setCustomOmschrijving("");
      setCustomAantal(1);
      setCustomPrijs("");
      onCreated(data.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="maak-offerte-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col border border-line bg-white shadow-lg sm:max-h-[90dvh]">
        <div className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2
              id="maak-offerte-title"
              className="font-display text-lg font-semibold text-green-deeper"
            >
              Maak offerte
            </h2>
            <p className="mt-0.5 text-xs text-muted">Voor {leadNaam}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-muted hover:text-ink"
            aria-label="Sluiten"
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={submit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div className="space-y-4 overflow-y-auto p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Product uit catalogus
              </p>
              <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_80px_auto]">
                <label className="block text-xs font-medium text-muted sm:col-span-1">
                  Product
                  <select
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                    className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                  >
                    <option value="">Kies product…</option>
                    {producten.map((p) => {
                      const fase = p.naam.includes("G3 S5")
                        ? "1-fase"
                        : p.naam.includes("G3 T10")
                          ? "3-fase"
                          : null;
                      return (
                        <option key={p.id} value={p.id}>
                          {p.naam}
                          {fase ? ` (${fase})` : ""} —{" "}
                          {formatEuro(Number(p.prijs_ex_btw))} excl. btw
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="block text-xs font-medium text-muted">
                  Aantal
                  <input
                    type="number"
                    min={1}
                    value={aantal}
                    onChange={(e) => setAantal(Number(e.target.value) || 1)}
                    className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={addProduct}
                    disabled={!productId}
                    className="w-full border border-green bg-green-soft px-3 py-2 text-sm font-semibold text-green-dark disabled:opacity-50"
                  >
                    Toevoegen
                  </button>
                </div>
              </div>
            </div>

            <div className="border border-line bg-wash/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Eigen regel
              </p>
              <p className="mt-1 text-xs text-muted">
                Vrije regel die ook op de offerte bij de klant verschijnt (PDF +
                ondertekenpagina).
              </p>
              <div className="mt-2 space-y-2">
                <label className="block text-xs font-medium text-muted">
                  Omschrijving
                  <input
                    type="text"
                    value={customOmschrijving}
                    onChange={(e) => setCustomOmschrijving(e.target.value)}
                    placeholder="Bijv. Extra kabelwerk / montagebeugel"
                    className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                  />
                </label>
                <div className="grid gap-2 sm:grid-cols-[80px_1fr_auto]">
                  <label className="block text-xs font-medium text-muted">
                    Aantal
                    <input
                      type="number"
                      min={1}
                      value={customAantal}
                      onChange={(e) =>
                        setCustomAantal(Number(e.target.value) || 1)
                      }
                      className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                    />
                  </label>
                  <label className="block text-xs font-medium text-muted">
                    Prijs excl. btw (€)
                    <input
                      type="text"
                      inputMode="decimal"
                      value={customPrijs}
                      onChange={(e) => setCustomPrijs(e.target.value)}
                      placeholder="Bijv. 125,00"
                      className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={addCustomLine}
                      disabled={!customOmschrijving.trim() || customPrijs === ""}
                      className="w-full border border-green bg-white px-3 py-2 text-sm font-semibold text-green-dark hover:bg-green-soft disabled:opacity-50"
                    >
                      Regel toevoegen
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {lines.length > 0 && (
              <ul className="divide-y divide-line border border-line">
                {lines.map((l) => (
                  <li
                    key={l.key}
                    className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink">
                        {l.omschrijving}
                        {!l.product_id && (
                          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                            Eigen
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {l.aantal} × {formatEuro(l.prijs_ex_btw)} excl. →{" "}
                        {formatEuro(lineIncBtw(l))} incl.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(l.key)}
                      className="shrink-0 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                    >
                      Weg
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="border border-line bg-wash/60 p-3">
              <label className="flex items-start gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={useKorting}
                  onChange={(e) => setUseKorting(e.target.checked)}
                  className="mt-1 accent-green"
                />
                <span>
                  <span className="font-medium">Korting toepassen</span>
                  <span className="mt-1 block text-xs text-muted">
                    {basisTotaalInc > 0
                      ? `Huidig totaal ${formatEuro(basisTotaalEx)} excl. / ${formatEuro(basisTotaalInc)} incl.`
                      : "Stel korting of nieuw offertebedrag in"}
                  </span>
                </span>
              </label>

              {useKorting && (
                <div className="mt-3 space-y-3 border-t border-line pt-3">
                  <fieldset>
                    <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Hoe bepalen?
                    </legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(
                        [
                          {
                            id: "bedrag" as const,
                            label: "Kortingsbedrag",
                          },
                          {
                            id: "nieuw_totaal" as const,
                            label: "Nieuw totaal",
                          },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setKortingModus(opt.id)}
                          className={[
                            "border px-3 py-1.5 text-sm font-medium transition",
                            kortingModus === opt.id
                              ? "border-green bg-green text-white"
                              : "border-line bg-white text-ink hover:bg-wash",
                          ].join(" ")}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Bedrag is
                    </legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(
                        [
                          { id: "excl" as const, label: "Excl. btw" },
                          { id: "incl" as const, label: "Incl. btw" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setKortingBtw(opt.id)}
                          className={[
                            "border px-3 py-1.5 text-sm font-medium transition",
                            kortingBtw === opt.id
                              ? "border-green bg-green text-white"
                              : "border-line bg-white text-ink hover:bg-wash",
                          ].join(" ")}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <label className="block text-xs font-medium text-muted">
                    {kortingModus === "nieuw_totaal"
                      ? `Nieuw offertebedrag ${kortingBtw === "incl" ? "incl." : "excl."} btw (€)`
                      : `Korting ${kortingBtw === "incl" ? "incl." : "excl."} btw (€)`}
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder={
                        kortingModus === "nieuw_totaal"
                          ? "Bijv. 7500"
                          : "Bijv. 250"
                      }
                      value={korting}
                      onChange={(e) => setKorting(e.target.value)}
                      className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                    />
                  </label>
                  {kortingModus === "nieuw_totaal" &&
                    kortingInput > 0 &&
                    kortingBtw === "excl" && (
                      <p className="text-xs text-muted">
                        = {formatEuro(kortingInputInc)} incl. btw
                      </p>
                    )}
                  {kortingModus === "bedrag" &&
                    kortingInput > 0 &&
                    kortingBtw === "excl" && (
                      <p className="text-xs text-muted">
                        = {formatEuro(kortingInputInc)} korting incl. btw
                      </p>
                    )}

                  <fieldset>
                    <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Op de offerte
                    </legend>
                    <div className="mt-2 space-y-2">
                      <label className="flex items-start gap-2 text-sm text-ink">
                        <input
                          type="radio"
                          name="korting-zichtbaar"
                          checked={kortingZichtbaar === "zichtbaar"}
                          onChange={() => setKortingZichtbaar("zichtbaar")}
                          className="mt-1 accent-green"
                        />
                        <span>
                          <span className="font-medium">Korting tonen</span>
                          <span className="mt-0.5 block text-xs text-muted">
                            Apart kortingsregel op de offerte
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2 text-sm text-ink">
                        <input
                          type="radio"
                          name="korting-zichtbaar"
                          checked={kortingZichtbaar === "verborgen"}
                          onChange={() => setKortingZichtbaar("verborgen")}
                          className="mt-1 accent-green"
                        />
                        <span>
                          <span className="font-medium">
                            Alleen totaalprijs aanpassen
                          </span>
                          <span className="mt-0.5 block text-xs text-muted">
                            Geen kortingsregel — productprijzen worden
                            herberekend
                          </span>
                        </span>
                      </label>
                    </div>
                  </fieldset>

                  {kortingInc > 0 && (
                    <p className="text-xs text-muted">
                      Korting {formatEuro(kortingInc)} incl. btw
                      {kortingZichtbaar === "verborgen"
                        ? " · verwerkt in de regelprijzen"
                        : " · als aparte regel"}
                    </p>
                  )}
                </div>
              )}
            </div>

            <label className="flex items-start gap-3 border border-line bg-wash px-3 py-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={financiering}
                onChange={(e) => setFinanciering(e.target.checked)}
                className="mt-1 accent-green"
              />
              <span>
                <span className="font-medium">Warmtefonds</span>
                <span className="mt-1 block text-xs text-muted">
                  Onder voorbehoud van financiering · regel “Warmtefonds
                  aanvraag service” op de offerte.
                </span>
              </span>
            </label>

            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Installateur (intern)
              <span className="ml-1 font-normal normal-case tracking-normal text-muted/80">
                — klant ziet dit niet
              </span>
              <select
                required
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              >
                <option value="">Kies installateur…</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.naam}
                  </option>
                ))}
              </select>
              {partners.length === 0 && (
                <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-[#C45A12]">
                  Voeg eerst een installatiepartner toe onder Instellingen.
                </span>
              )}
            </label>

            <div className="border-t border-line pt-3 text-right space-y-1">
              {useKorting && kortingInc > 0 && (
                <p className="text-sm text-muted">
                  Was{" "}
                  <span className="ml-2 inline-block min-w-[6rem] tabular-nums line-through">
                    {formatEuro(basisTotaalInc)}
                  </span>
                </p>
              )}
              <p className="text-sm text-muted">
                Subtotaal excl. btw{" "}
                <span className="ml-2 inline-block min-w-[6rem] tabular-nums text-ink">
                  {formatEuro(
                    Math.round(
                      previewLines.reduce(
                        (s, l) => s + l.aantal * l.prijs_ex_btw,
                        0
                      ) * 100
                    ) / 100
                  )}
                </span>
              </p>
              <p className="text-sm text-muted">
                BTW{" "}
                <span className="ml-2 inline-block min-w-[6rem] tabular-nums text-ink">
                  {formatEuro(
                    Math.round(
                      (totaalInc -
                        previewLines.reduce(
                          (s, l) => s + l.aantal * l.prijs_ex_btw,
                          0
                        )) *
                        100
                    ) / 100
                  )}
                </span>
              </p>
              <p className="font-display text-lg font-semibold text-green-deeper">
                Totaal incl. btw{" "}
                <span className="ml-2 tabular-nums">
                  {formatEuro(totaalInc)}
                </span>
              </p>
            </div>

            {error && (
              <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                {error}
              </p>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-wash disabled:opacity-60"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={saving || lines.length === 0}
              className="bg-orange px-4 py-2 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
            >
              {saving ? "Bezig…" : "Offerte aanmaken"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
