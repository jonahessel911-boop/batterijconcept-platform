"use client";

import { useEffect, useMemo, useState } from "react";
import type { InstallatiePartner, Product } from "@/types/database";
import { formatEuro } from "@/lib/format";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";

type Line = {
  key: string;
  product_id: string | null;
  omschrijving: string;
  aantal: number;
  prijs_ex_btw: number;
  btw_percentage: number;
};

function lineIncBtw(l: Line) {
  return (
    Math.round(
      l.aantal * l.prijs_ex_btw * (1 + l.btw_percentage / 100) * 100
    ) / 100
  );
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
  onCreated: (signUrl?: string) => void;
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
  const [korting, setKorting] = useState("");
  const [useKorting, setUseKorting] = useState(false);
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

  const kortingBedrag = Number(korting.replace(",", ".")) || 0;

  const previewLines = useMemo(() => {
    const out = [...lines];
    if (useKorting && kortingBedrag > 0) {
      // Korting ex BTW zodat aftrek zichtbaar is op totaal incl BTW
      const ex = Math.round((kortingBedrag / 1.21) * 100) / 100;
      out.push({
        key: "korting",
        product_id: null,
        omschrijving: "Korting",
        aantal: 1,
        prijs_ex_btw: -ex,
        btw_percentage: 21,
      });
    }
    return out;
  }, [lines, useKorting, kortingBedrag]);

  const totaalInc = useMemo(
    () =>
      Math.round(previewLines.reduce((s, l) => s + lineIncBtw(l), 0) * 100) /
      100,
    [previewLines]
  );

  if (!open) return null;

  function addProduct() {
    const p = producten.find((x) => x.id === productId);
    if (!p) return;
    const isAlpha = p.naam.startsWith("Alpha ESS");
    const qty = Math.max(1, aantal);
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
        next.push({
          key: `subsidie-${p.id}-${Date.now()}`,
          product_id: null,
          omschrijving: "Incl. BTW subsidie-aanvraag",
          aantal: 1,
          prijs_ex_btw: 0,
          btw_percentage: 21,
        });
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
      setKorting("");
      setFinanciering(false);
      setPartnerId("");
      setCustomOmschrijving("");
      setCustomAantal(1);
      setCustomPrijs("");
      onCreated(data.sign_url);
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

            <label className="flex items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={useKorting}
                onChange={(e) => setUseKorting(e.target.checked)}
                className="mt-1 accent-green"
              />
              <span className="flex-1">
                <span className="font-medium">Kortingsregel</span>
                <span className="mt-1 block text-xs text-muted">
                  Bedrag incl. btw dat van het totaal afgaat
                </span>
                {useKorting && (
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Bijv. 250"
                    value={korting}
                    onChange={(e) => setKorting(e.target.value)}
                    className="mt-2 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
                  />
                )}
              </span>
            </label>

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
                  Onder voorbehoud van financiering.
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
              {saving ? "Bezig…" : "Offerte versturen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
