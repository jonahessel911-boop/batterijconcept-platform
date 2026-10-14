"use client";

import { useState } from "react";
import type { DatumOptieSoort } from "@/lib/project-datum-opties";

function toDatetimeLocalValue(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function defaultSlots(): [string, string, string] {
  const a = new Date();
  a.setDate(a.getDate() + 2);
  a.setHours(10, 0, 0, 0);
  const b = new Date(a);
  b.setDate(b.getDate() + 2);
  b.setHours(14, 0, 0, 0);
  const c = new Date(a);
  c.setDate(c.getDate() + 4);
  c.setHours(10, 0, 0, 0);
  return [
    toDatetimeLocalValue(a),
    toDatetimeLocalValue(b),
    toDatetimeLocalValue(c),
  ];
}

export function VerstuurDatumOptieModal({
  projectId,
  onClose,
  onSent,
}: {
  projectId: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [soort, setSoort] = useState<DatumOptieSoort>("service");
  const [slots, setSlots] = useState<[string, string, string]>(defaultSlots);
  const [serviceNotitie, setServiceNotitie] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      if (soort === "service" && serviceNotitie.trim().length < 3) {
        throw new Error(
          "Notitie voor installateur is verplicht bij Service"
        );
      }
      const isoSlots = slots.map((s) => {
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) throw new Error("Ongeldige datum");
        return d.toISOString();
      });
      const res = await fetch(`/api/projecten/${projectId}/datum-opties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort,
          slots: isoSlots,
          service_notitie:
            soort === "service" ? serviceNotitie.trim() : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Versturen mislukt"
        );
      }
      setOkMsg(
        soort === "service"
          ? "Service-datumopties verstuurd naar de klant"
          : "Overstap-datumopties verstuurd naar de klant"
      );
      onSent?.();
      window.setTimeout(() => onClose(), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Versturen mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center"
      role="dialog"
      aria-modal
      aria-labelledby="datum-optie-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-line px-4 py-3.5 sm:px-5">
          <div>
            <h2
              id="datum-optie-title"
              className="font-display text-base font-semibold text-ink"
            >
              Verstuur datum optie
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Klant kiest 1 van 3 tijden in Mijn portaal
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-wash hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          {error ? (
            <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              {error}
            </p>
          ) : null}
          {okMsg ? (
            <p className="rounded-xl border border-green/25 bg-green-soft px-3 py-2 text-xs text-green-dark">
              {okMsg}
            </p>
          ) : null}

          <fieldset>
            <legend className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Type
            </legend>
            <div className="mt-1.5 flex gap-2">
              {(
                [
                  ["service", "Service"],
                  ["overstap", "Overstap"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSoort(id)}
                  className={[
                    "flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition",
                    soort === id
                      ? "border-green bg-green text-white"
                      : "border-line bg-white text-ink hover:bg-wash",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Drie tijden
            </p>
            {([0, 1, 2] as const).map((i) => (
              <label key={i} className="block">
                <span className="mb-1 block text-[11px] text-muted">
                  Optie {i + 1}
                </span>
                <input
                  type="datetime-local"
                  value={slots[i]}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSlots((prev) => {
                      const next: [string, string, string] = [...prev];
                      next[i] = v;
                      return next;
                    });
                  }}
                  className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                />
              </label>
            ))}
          </div>

          {soort === "service" ? (
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Notitie voor installateur *
              </span>
              <textarea
                value={serviceNotitie}
                onChange={(e) => setServiceNotitie(e.target.value)}
                rows={3}
                placeholder="Wat moet de monteur doen / weten bij deze service…"
                className="mt-1.5 w-full resize-y rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              />
              <span className="mt-1 block text-[11px] text-muted">
                Verplicht — komt op het serviceverzoek en de planbord-afspraak
              </span>
            </label>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-line bg-white px-3.5 py-2 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
          >
            Annuleren
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || slots.some((s) => !s)}
            className="rounded-xl bg-green px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Versturen…" : "Versturen naar klant"}
          </button>
        </div>
      </div>
    </div>
  );
}
