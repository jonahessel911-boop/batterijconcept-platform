"use client";

import { useMemo, useState } from "react";
import type { Adviseur, Lead } from "@/types/database";
import { isAdminAdviseur } from "@/lib/admin-adviseur";
import {
  gebruikerRolLabel,
  isTerugbelPlanbaar,
  normalizeRol,
  type GebruikerRol,
} from "@/lib/rollen";
import { getSupabaseBrowser } from "@/lib/supabase";

export function LeadTerugbelPlannen({
  lead,
  adviseurs,
  warm = false,
  onPlanned,
  onCancel,
  lockAdviseur = false,
  defaultAdviseurId,
}: {
  lead: Lead;
  adviseurs: Adviseur[];
  /** true = warme_bel, false = bel */
  warm?: boolean;
  onPlanned: () => void;
  onCancel?: () => void;
  lockAdviseur?: boolean;
  defaultAdviseurId?: string;
}) {
  const medewerkers = useMemo(() => {
    const list = adviseurs.filter(
      (a) => a.actief && !isAdminAdviseur(a) && isTerugbelPlanbaar(a)
    );
    if (lockAdviseur && defaultAdviseurId) {
      const self = list.find((a) => a.id === defaultAdviseurId);
      if (self) return [self];
      const raw = adviseurs.find((a) => a.id === defaultAdviseurId);
      return raw ? [raw] : [];
    }
    return list.sort((a, b) => {
      const order = (rol: string | null | undefined) => {
        const r = normalizeRol(rol);
        if (r === "beller") return 0;
        if (r === "backoffice") return 1;
        return 2;
      };
      const d = order(a.rol) - order(b.rol);
      if (d !== 0) return d;
      return a.naam.localeCompare(b.naam, "nl");
    });
  }, [adviseurs, lockAdviseur, defaultAdviseurId]);

  const groepen = useMemo(() => {
    const groups: { rol: GebruikerRol; label: string; items: Adviseur[] }[] = [
      { rol: "beller", label: "Callcenter", items: [] },
      { rol: "backoffice", label: "Backoffice", items: [] },
      { rol: "admin", label: "Admin", items: [] },
      { rol: "adviseur", label: "Adviseurs", items: [] },
    ];
    for (const a of medewerkers) {
      const rol = normalizeRol(a.rol);
      const g = groups.find((x) => x.rol === rol);
      if (g) g.items.push(a);
      else groups[3].items.push(a);
    }
    return groups.filter((g) => g.items.length > 0);
  }, [medewerkers]);

  /** Jezelf als beller → anders Sharath/eerste beller → nooit lead.adviseur. */
  const preferred = (() => {
    const self = defaultAdviseurId
      ? medewerkers.find((a) => a.id === defaultAdviseurId)
      : undefined;
    if (self && normalizeRol(self.rol) === "beller") return self.id;

    const bellers = medewerkers.filter(
      (a) => normalizeRol(a.rol) === "beller"
    );
    const sharath = bellers.find((a) =>
      a.naam.toLowerCase().includes("sharath")
    );
    if (sharath) return sharath.id;
    if (bellers[0]) return bellers[0].id;

    if (self) return self.id;
    if (
      lead.beller_id &&
      medewerkers.some((a) => a.id === lead.beller_id)
    ) {
      return lead.beller_id;
    }
    return medewerkers[0]?.id || "";
  })();

  const [adviseurId, setAdviseurId] = useState(preferred);
  const [startAt, setStartAt] = useState("");
  const [notitie, setNotitie] = useState(lead.terugbel_notitie || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!startAt) throw new Error("Kies datum en tijd");
      const planId =
        lockAdviseur && defaultAdviseurId ? defaultAdviseurId : adviseurId;
      if (!planId) throw new Error("Kies een medewerker");
      const note = notitie.trim();
      if (!note) throw new Error("Vul een notitie in");

      const res = await fetch("/api/afspraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: lead.id,
          adviseur_id: planId,
          start_at: startAt,
          notities: note,
          soort: warm ? "warme_bel" : "bel",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Terugbel-afspraak mislukt");
      }

      const assignee = medewerkers.find((a) => a.id === planId);
      const assigneeRol = normalizeRol(assignee?.rol);
      const sb = getSupabaseBrowser();
      const patch: Record<string, unknown> = {
        terugbellen: true,
        terugbel_notitie: note,
      };
      if (assigneeRol === "beller") patch.beller_id = planId;
      await sb.from("leads").update(patch).eq("id", lead.id);

      void fetch(`/api/leads/${lead.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort: "terugbel",
          titel: warm
            ? "Warme terugbelafspraak gepland"
            : "Terugbelafspraak gepland",
          detail: `${note} · ${startAt.replace("T", " ")}`,
        }),
      }).catch(() => undefined);

      onPlanned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <p className="text-sm font-semibold text-ink">
        {warm ? "Warme terugbelafspraak" : "Terugbelafspraak"}
      </p>
      <p className="text-xs text-muted">
        {warm
          ? "Prioriteit in de bellijst. Intern, geen mail naar de klant."
          : "Intern — de klant krijgt geen mail. Vanaf de geplande dag verschijnt de lead in Bellen."}
      </p>

      {lockAdviseur ? (
        <p className="text-xs text-muted">
          Toewijzen aan:{" "}
          <span className="font-semibold text-ink">
            {medewerkers.find((a) => a.id === adviseurId)?.naam || "Jij"}
          </span>
        </p>
      ) : (
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Toewijzen aan
          <select
            required
            value={adviseurId}
            onChange={(e) => setAdviseurId(e.target.value)}
            className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
          >
            <option value="">Kies medewerker…</option>
            {groepen.map((g) => (
              <optgroup key={g.rol} label={g.label}>
                {g.items.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.naam}
                    {g.rol !== "adviseur"
                      ? ` (${gebruikerRolLabel[g.rol]})`
                      : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}

      <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
        Datum &amp; tijd
        <input
          type="datetime-local"
          required
          value={startAt}
          onChange={(e) => setStartAt(e.target.value)}
          className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
        />
      </label>

      <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
        Notitie
        <textarea
          required
          value={notitie}
          onChange={(e) => setNotitie(e.target.value)}
          rows={3}
          placeholder="Bijv. bel terug over offerte, bereikbaar na 17:00…"
          className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
        />
      </label>

      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={
            busy || !adviseurId || !startAt || !notitie.trim()
          }
          className={[
            "min-h-11 flex-1 px-4 text-sm font-semibold text-white disabled:opacity-60",
            warm
              ? "bg-[#C9A227] hover:bg-[#b08f1f]"
              : "bg-[#C45A12] hover:bg-[#a84a0e]",
          ].join(" ")}
        >
          {busy
            ? "Bezig…"
            : warm
              ? "Warme terugbel opslaan"
              : "Terugbel opslaan"}
        </button>
        {onCancel ? (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-11 border border-line px-3 text-sm font-semibold text-muted hover:text-ink"
          >
            Annuleren
          </button>
        ) : null}
      </div>
    </form>
  );
}
