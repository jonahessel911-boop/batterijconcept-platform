"use client";

import { useEffect, useMemo, useState } from "react";
import type { Product } from "@/types/database";
import { formatEuro } from "@/lib/format";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import {
  extraKortingOmschrijving,
  INTERN_KORTING_OMSCHRIJVING,
  isAlphaEssMetOmvormerRegel,
  isKortingRegel,
  isVerborgenOfferteRegel,
  omvormerOmschrijvingVoor,
} from "@/lib/offerte-regels";
import { productZichtbaarVoorAdviseur } from "@/lib/warmtepomp-producten";

type Line = {
  key: string;
  product_id: string | null;
  omschrijving: string;
  aantal: number;
  prijs_ex_btw: number;
  btw_percentage: number;
  /** Korting incl. btw, alleen bij extra’s die niet op de klantofferte staan. */
  kortingInc?: number;
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

export function MaakOfferteModal({
  open,
  leadId,
  leadNaam,
  adviseurId,
  onClose,
  onCreated,
}: {
  open: boolean;
  leadId: string;
  leadNaam: string;
  adviseurId?: string | null;
  onClose: () => void;
  onCreated: (offerteId: string) => void;
}) {
  const [producten, setProducten] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
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
      const prodRes = await sb
        .from("producten")
        .select("*")
        .eq("actief", true)
        .order("naam");
      if (!cancelled) {
        setProducten(
          ((prodRes.data as Product[]) || []).filter((p) =>
            productZichtbaarVoorAdviseur(p, adviseurId)
          )
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, adviseurId]);

  const kortingInput = Number(korting.replace(",", ".")) || 0;

  const extraKortingSomInc = useMemo(
    () =>
      Math.round(
        lines.reduce((s, l) => {
          if (!isVerborgenOfferteRegel(l)) return s;
          const max = lineIncBtw(l);
          return s + Math.min(Math.max(0, Number(l.kortingInc) || 0), max);
        }, 0) * 100
      ) / 100,
    [lines]
  );
  const basisTotaalInc = useMemo(
    () =>
      Math.round((linesTotaalInc(lines) - extraKortingSomInc) * 100) / 100,
    [lines, extraKortingSomInc]
  );
  const basisTotaalEx = useMemo(
    () =>
      Math.round(
        (linesTotaalEx(lines) - extraKortingSomInc / 1.21) * 100
      ) / 100,
    [lines, extraKortingSomInc]
  );

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
    const withExtraKorting: Line[] = [];
    for (const l of lines) {
      withExtraKorting.push({ ...l, kortingInc: undefined });
      if (!isVerborgenOfferteRegel(l)) continue;
      const maxInc = lineIncBtw(l);
      const kort = Math.min(Math.max(0, Number(l.kortingInc) || 0), maxInc);
      if (kort <= 0) continue;
      const ex = Math.round((kort / (1 + l.btw_percentage / 100)) * 100) / 100;
      withExtraKorting.push({
        key: `korting-${l.key}`,
        product_id: null,
        omschrijving: extraKortingOmschrijving(l.omschrijving),
        aantal: 1,
        prijs_ex_btw: -ex,
        btw_percentage: l.btw_percentage,
      });
    }

    let out: Line[];

    if (useKorting && kortingInc > 0) {
      const ex = Math.round((kortingInc / 1.21) * 100) / 100;
      out = [
        ...withExtraKorting,
        {
          key: "korting",
          product_id: null,
          omschrijving:
            kortingZichtbaar === "zichtbaar"
              ? "Korting"
              : INTERN_KORTING_OMSCHRIJVING,
          aantal: 1,
          prijs_ex_btw: -ex,
          btw_percentage: 21,
        },
      ];
    } else {
      out = withExtraKorting;
    }

    return out;
  }, [lines, useKorting, kortingInc, kortingZichtbaar]);

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
          kortingInc: 0,
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
    const rawPrijs = customPrijs.trim().replace(",", ".");
    const prijs = rawPrijs === "" ? 0 : Number(rawPrijs);
    if (!omschrijving) {
      setError("Vul een omschrijving in voor de eigen regel.");
      return;
    }
    if (Number.isNaN(prijs)) {
      setError("Vul een geldige prijs excl. btw in (of laat leeg voor €0).");
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
      if (!lines.some((l) => l.prijs_ex_btw > 0)) {
        setError("Korting vereist minstens één regel met een prijs.");
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
              <div className="mt-1 space-y-2">
                <div className="max-h-48 overflow-y-auto overscroll-contain border border-line bg-white sm:max-h-56">
                  {producten.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-muted">
                      Geen actieve producten
                    </p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {producten.map((p) => {
                        const fase = p.naam.includes("G3 S5")
                          ? "1-fase"
                          : p.naam.includes("G3 T10")
                            ? "3-fase"
                            : null;
                        const selected = productId === p.id;
                        const ex = Number(p.prijs_ex_btw);
                        return (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => setProductId(p.id)}
                              className={[
                                "flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-sm transition",
                                selected
                                  ? "bg-green-soft text-green-dark"
                                  : "bg-white text-ink hover:bg-wash",
                              ].join(" ")}
                            >
                              <span className="min-w-0">
                                <span className="block font-medium leading-snug">
                                  {p.naam}
                                  {fase ? (
                                    <span className="ml-1 font-normal text-muted">
                                      ({fase})
                                    </span>
                                  ) : null}
                                </span>
                              </span>
                              <span className="shrink-0 tabular-nums text-xs font-semibold text-muted">
                                {formatEuro(ex)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="grid grid-cols-[80px_1fr] gap-2">
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
            </div>

            <div className="border border-line bg-wash/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Eigen regel
              </p>
              <p className="mt-1 text-xs text-muted">
                Vrije regel die ook op de offerte bij de klant verschijnt (PDF +
                ondertekenpagina). Prijs mag €0 zijn.
              </p>
              <div
                className="mt-2 space-y-2"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  addCustomLine();
                }}
              >
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
                      placeholder="0,00"
                      className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={addCustomLine}
                      disabled={!customOmschrijving.trim()}
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
                {lines.map((l) => {
                  return (
                  <li
                    key={l.key}
                    className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0 flex-1">
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
                  );
                })}
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
                            Als − € onder de totaalprijs op de offerte
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
                            Niet op de klantofferte — intern en op de
                            factuur wél zichtbaar
                          </span>
                        </span>
                      </label>
                    </div>
                  </fieldset>

                  {kortingInc > 0 && (
                    <p className="text-xs text-muted">
                      Korting {formatEuro(kortingInc)} incl. btw
                      {kortingZichtbaar === "verborgen"
                        ? " · intern / op factuur, niet op klantofferte"
                        : " · onder de prijs op de klantofferte"}
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
                  Onder voorbehoud van financiering Warmtefonds (tekst
                  onderaan de offerte).
                </span>
              </span>
            </label>

            <div className="border-t border-line pt-3 text-right space-y-1">
              {(() => {
                const brutoEx =
                  Math.round(
                    previewLines
                      .filter((l) => !isKortingRegel(l))
                      .reduce((s, l) => s + l.aantal * l.prijs_ex_btw, 0) * 100
                  ) / 100;
                const kortingEx =
                  Math.round(
                    previewLines
                      .filter((l) => isKortingRegel(l))
                      .reduce((s, l) => s + l.aantal * l.prijs_ex_btw, 0) * 100
                  ) / 100;
                const netEx = Math.round((brutoEx + kortingEx) * 100) / 100;
                const btw = Math.round((totaalInc - netEx) * 100) / 100;
                return (
                  <>
                    <p className="text-sm text-muted">
                      Subtotaal excl. btw{" "}
                      <span className="ml-2 inline-block min-w-[6rem] tabular-nums text-ink">
                        {formatEuro(brutoEx)}
                      </span>
                    </p>
                    {kortingEx < 0 ? (
                      <p className="text-sm font-semibold text-green-deeper">
                        Korting
                        {kortingZichtbaar === "verborgen"
                          ? " (intern)"
                          : ""}{" "}
                        <span className="ml-2 inline-block min-w-[6rem] tabular-nums">
                          {formatEuro(kortingEx)}
                        </span>
                      </p>
                    ) : null}
                    {kortingEx < 0 ? (
                      <p className="text-sm text-muted">
                        Totaal excl. btw{" "}
                        <span className="ml-2 inline-block min-w-[6rem] tabular-nums text-ink">
                          {formatEuro(netEx)}
                        </span>
                      </p>
                    ) : null}
                    <p className="text-sm text-muted">
                      BTW{" "}
                      <span className="ml-2 inline-block min-w-[6rem] tabular-nums text-ink">
                        {formatEuro(btw)}
                      </span>
                    </p>
                    <p className="font-display text-lg font-semibold text-green-deeper">
                      Totaal incl. btw{" "}
                      <span className="ml-2 tabular-nums">
                        {formatEuro(totaalInc)}
                      </span>
                    </p>
                  </>
                );
              })()}
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
