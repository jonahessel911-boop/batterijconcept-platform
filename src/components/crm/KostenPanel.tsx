"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Adviseur,
  AdviseurKosten,
  AdviseurKostenSoort,
  AdviseurKostenStatus,
} from "@/types/database";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatEuro } from "@/lib/format";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | AdviseurKostenStatus;

const STATUS_NAV: { key: StatusFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "ingedekt", label: "Ingedekt" },
  { key: "geannuleerd", label: "Geannuleerd" },
  { key: "all", label: "Alles" },
];

const SOORT_LABEL: Record<AdviseurKostenSoort, string> = {
  voorschot: "Voorschot",
  kosten: "Kosten",
  correctie: "Correctie",
};

function initials(naam: string): string {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function KostenPanel({ embedded = false }: { embedded?: boolean }) {
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [kosten, setKosten] = useState<AdviseurKosten[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [zoek, setZoek] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [adviseurId, setAdviseurId] = useState("");
  const [soort, setSoort] = useState<AdviseurKostenSoort>("voorschot");
  const [omschrijving, setOmschrijving] = useState("");
  const [bedrag, setBedrag] = useState("");
  const [kostenDatum, setKostenDatum] = useState(todayIso);
  const [notities, setNotities] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [advRes, kostRes] = await Promise.all([
        fetch("/api/adviseurs"),
        fetch(
          `/api/adviseurs/kosten?status=${
            statusFilter === "all" ? "all" : statusFilter
          }`
        ),
      ]);
      const advData = await advRes.json().catch(() => ({}));
      const kostData = await kostRes.json().catch(() => ({}));
      if (!advRes.ok) {
        throw new Error(
          (advData as { error?: string }).error || "Medewerkers laden mislukt"
        );
      }
      if (!kostRes.ok) {
        throw new Error(
          (kostData as { error?: string }).error || "Kosten laden mislukt"
        );
      }
      const list = ((advData.adviseurs || []) as Adviseur[])
        .filter((a) => a.actief !== false)
        .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
      setAdviseurs(list);
      setKosten((kostData.kosten || []) as AdviseurKosten[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = zoek.trim().toLowerCase();
    if (!q) return kosten;
    return kosten.filter((k) => {
      const naam = (k.adviseur_naam || "").toLowerCase();
      return (
        naam.includes(q) ||
        k.omschrijving.toLowerCase().includes(q) ||
        (k.factuur_nummer || "").toLowerCase().includes(q)
      );
    });
  }, [kosten, zoek]);

  const openSom = useMemo(
    () =>
      kosten
        .filter((k) => k.status === "open")
        .reduce((s, k) => s + (Number(k.bedrag_ex_btw) || 0), 0),
    [kosten]
  );

  function resetForm() {
    setAdviseurId("");
    setSoort("voorschot");
    setOmschrijving("");
    setBedrag("");
    setKostenDatum(todayIso());
    setNotities("");
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/adviseurs/kosten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adviseur_id: adviseurId,
          soort,
          omschrijving: omschrijving.trim(),
          bedrag_ex_btw: bedrag,
          kosten_datum: kostenDatum || null,
          notities: notities.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      setOkMsg("Kostenpost toegevoegd.");
      setAddOpen(false);
      resetForm();
      if (statusFilter !== "open" && statusFilter !== "all") {
        setStatusFilter("open");
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function annuleer(k: AdviseurKosten) {
    if (!confirm(`Kostenpost “${k.omschrijving}” annuleren?`)) return;
    setError(null);
    try {
      const res = await fetch("/api/adviseurs/kosten", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: k.id, status: "geannuleerd" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Annuleren mislukt"
        );
      }
      setOkMsg("Kostenpost geannuleerd.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Annuleren mislukt");
    }
  }

  async function heropen(k: AdviseurKosten) {
    setError(null);
    try {
      const res = await fetch("/api/adviseurs/kosten", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: k.id, status: "open" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Heropenen mislukt"
        );
      }
      setOkMsg("Kostenpost weer open — aftrekbaar bij uitbetaling.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Heropenen mislukt");
    }
  }

  return (
    <div
      className={
        embedded
          ? "flex h-full min-h-0 flex-col bg-white"
          : "border border-line bg-white"
      }
    >
      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-3 py-2.5 sm:flex-row sm:items-center sm:px-4">
        <div className="relative w-full min-w-0 flex-1 sm:max-w-md">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted">
            ⌕
          </span>
          <input
            type="search"
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            placeholder="Zoek medewerker of omschrijving…"
            className="h-9 w-full rounded-md border border-line bg-white py-2 pr-3 pl-8 text-sm text-ink outline-none placeholder:text-muted/70 focus:border-green"
            aria-label="Zoeken"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_NAV.map((item) => {
            const active = statusFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatusFilter(item.key)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition",
                  active
                    ? "bg-wash text-ink ring-1 ring-line"
                    : "text-muted hover:bg-wash/70 hover:text-ink"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {statusFilter === "open" || statusFilter === "all" ? (
          <p className="text-xs text-muted sm:ml-auto">
            Open:{" "}
            <span className="font-semibold tabular-nums text-ink">
              {formatEuro(openSom)}
            </span>{" "}
            excl.
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => {
            resetForm();
            setAddOpen(true);
            setError(null);
          }}
          className="shrink-0 rounded-lg bg-green px-3 py-2 text-sm font-semibold text-white hover:bg-green-dark"
        >
          + Kosten
        </button>
      </div>

      {(error || okMsg) && (
        <div className="shrink-0 space-y-2 border-b border-line px-3 py-2 sm:px-4">
          {error ? (
            <p className="rounded-md border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              {error}
            </p>
          ) : null}
          {okMsg ? (
            <p className="rounded-md border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
              {okMsg}
            </p>
          ) : null}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="px-5 py-14 text-center text-sm text-muted">Laden…</p>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="font-display text-base font-semibold text-ink">
              Geen kostenposten
            </p>
            <p className="mt-1 text-sm text-muted">
              Voeg een voorschot of kostenpost toe; die kun je later aftrekken bij
              de wekelijkse uitbetaling.
            </p>
          </div>
        ) : (
          <table className="crm-table">
            <thead>
              <tr>
                <th>Medewerker</th>
                <th>Soort</th>
                <th>Omschrijving</th>
                <th>Datum</th>
                <th>Bedrag excl.</th>
                <th>Status</th>
                <th>Actie</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((k) => {
                const naam = k.adviseur_naam || "Onbekend";
                return (
                  <tr key={k.id} className="!cursor-default">
                    <td>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar size="sm" className="size-8">
                          <AvatarFallback className="text-[11px]">
                            {initials(naam)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate font-medium text-ink">
                          {naam}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-muted">
                      {SOORT_LABEL[k.soort] || k.soort}
                    </td>
                    <td>
                      <span className="block truncate text-ink">
                        {k.omschrijving}
                      </span>
                      {k.factuur_nummer ? (
                        <span className="block truncate text-[11px] text-muted">
                          Factuur {k.factuur_nummer}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap text-muted">
                      {k.kosten_datum
                        ? new Date(k.kosten_datum).toLocaleDateString("nl-NL")
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap tabular-nums font-medium text-ink">
                      {formatEuro(Number(k.bedrag_ex_btw) || 0)}
                    </td>
                    <td>
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                          k.status === "open"
                            ? "bg-[#FFF0E6] text-[#C45A12]"
                            : k.status === "ingedekt"
                              ? "bg-green-soft text-green-dark"
                              : "bg-wash text-muted"
                        )}
                      >
                        {k.status === "open"
                          ? "Open"
                          : k.status === "ingedekt"
                            ? "Ingedekt"
                            : "Geannuleerd"}
                      </span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {k.status === "open" ? (
                          <button
                            type="button"
                            onClick={() => void annuleer(k)}
                            className="rounded-md border border-[#C62828]/40 px-2.5 py-1 text-[11px] font-semibold text-[#C62828] hover:bg-[#FFEBEE]"
                          >
                            Annuleren
                          </button>
                        ) : k.status === "geannuleerd" ||
                          k.status === "ingedekt" ? (
                          <button
                            type="button"
                            onClick={() => void heropen(k)}
                            className="rounded-md border border-line px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-wash"
                            title={
                              k.status === "ingedekt"
                                ? "Weer openzetten (handmatig, als aftrek van factuur is gehaald)"
                                : "Weer openzetten"
                            }
                          >
                            Heropen
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <form
            onSubmit={(e) => void submitAdd(e)}
            className="w-full max-w-md space-y-3 rounded-lg border border-line bg-white p-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-ink">
                Kosten toevoegen
              </h3>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="text-sm text-muted hover:text-ink"
              >
                Sluiten
              </button>
            </div>
            <p className="text-xs text-muted">
              Bijv. een voorschot dat je later aftrekt bij de wekelijkse
              uitbetaling van deze medewerker.
            </p>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted">Medewerker</span>
              <select
                required
                value={adviseurId}
                onChange={(e) => setAdviseurId(e.target.value)}
                className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              >
                <option value="">Kies…</option>
                {adviseurs.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.naam}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted">Soort</span>
              <select
                value={soort}
                onChange={(e) =>
                  setSoort(e.target.value as AdviseurKostenSoort)
                }
                className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              >
                <option value="voorschot">Voorschot</option>
                <option value="kosten">Kosten</option>
                <option value="correctie">Correctie</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted">
                Omschrijving
              </span>
              <input
                required
                value={omschrijving}
                onChange={(e) => setOmschrijving(e.target.value)}
                placeholder="Bijv. Laptop voorschot"
                className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">
                  Bedrag excl. btw
                </span>
                <input
                  required
                  inputMode="decimal"
                  value={bedrag}
                  onChange={(e) => setBedrag(e.target.value)}
                  placeholder="0,00"
                  className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-muted">Datum</span>
                <input
                  type="date"
                  value={kostenDatum}
                  onChange={(e) => setKostenDatum(e.target.value)}
                  className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted">
                Notitie (optioneel)
              </span>
              <input
                value={notities}
                onChange={(e) => setNotities(e.target.value)}
                className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-wash"
              >
                Annuleren
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-green px-3 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
              >
                {saving ? "Opslaan…" : "Toevoegen"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
