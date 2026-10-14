"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Lead, Project } from "@/types/database";
import {
  emptySchouwFormulier,
  formatSchouwAdres,
  SCHOUW_AANSLUITING_OPTIES,
  SCHOUW_AANVOER_OPTIES,
  SCHOUW_AARDLEK_OPTIES,
  SCHOUW_BINNEN_BUITEN_OPTIES,
  SCHOUW_BOORMATERIAAL_OPTIES,
  SCHOUW_HOOFDZEKERING_OPTIES,
  SCHOUW_KABELDOORSNEDE_OPTIES,
  SCHOUW_KABELROUTE_OPTIES,
  SCHOUW_MEE_TE_NEMEN_OPTIES,
  SCHOUW_MODEL_OPTIES,
  SCHOUW_MONTAGE_OPTIES,
  SCHOUW_RUIMTE_GROEP_OPTIES,
  SCHOUW_WANDTYPE_OPTIES,
  SCHOUW_WIFI_OPTIES,
  type SchouwFormulierData,
  type SchouwJaNee,
} from "@/lib/schouw-formulier";

type PrefillLead = Pick<
  Lead,
  | "naam"
  | "email"
  | "telefoon"
  | "straat"
  | "huisnummer"
  | "toevoeging"
  | "postcode"
  | "plaats"
  | "lead_number"
>;

function leadFromProject(project: Project): PrefillLead | null {
  const raw = Array.isArray(project.leads) ? project.leads[0] : project.leads;
  if (!raw || typeof raw !== "object") return null;
  return raw as PrefillLead;
}

function partnerNaamFromProject(project: Project): string {
  const raw = Array.isArray(project.installatie_partners)
    ? project.installatie_partners[0]
    : project.installatie_partners;
  return (raw && typeof raw === "object" && "naam" in raw
    ? String((raw as { naam?: string }).naam || "")
    : "") || project.monteur || "";
}

function schouwDatumYmd(project: Project): string {
  if (project.schouw_at) {
    try {
      const d = new Date(project.schouw_at);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
      }
    } catch {
      /* fall through */
    }
  }
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "Europe/Amsterdam",
  });
}

function buildPrefill(
  project: Project,
  opnemerOverride?: string | null
): SchouwFormulierData {
  const lead = leadFromProject(project);
  const opnemer = (opnemerOverride || partnerNaamFromProject(project)).trim();
  const klant = lead?.naam?.trim() || project.titel || "";
  return emptySchouwFormulier({
    klantNaam: klant,
    adres: lead ? formatSchouwAdres(lead) : "",
    telefoon: lead?.telefoon?.trim() || "",
    email: lead?.email?.trim() || "",
    datum: schouwDatumYmd(project),
    rapportNr: `SCH-${project.project_nummer || ""}`.replace(/-$/, ""),
    opnemer,
    klusNr: project.project_nummer || "",
    handtekeningOpnemerNaam: opnemer,
    handtekeningKlantNaam: klant,
  });
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-[#0D9488]";
const selectCls = inputCls;

function JaNeeSelect({
  value,
  onChange,
}: {
  value: SchouwJaNee;
  onChange: (v: SchouwJaNee) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SchouwJaNee)}
      className={selectCls}
    >
      <option value="">— kies —</option>
      <option value="ja">Ja</option>
      <option value="nee">Nee</option>
    </select>
  );
}

function OptionSelect({
  value,
  onChange,
  options,
  allowEmpty = true,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  allowEmpty?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={selectCls}
    >
      {allowEmpty ? <option value="">— kies —</option> : null}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function SchouwFormulierModal({
  open,
  project,
  submitUrl,
  notitie,
  opnemerDefault,
  onClose,
  onCreated,
}: {
  open: boolean;
  project: Project;
  /** POST endpoint that accepts { form, notitie } */
  submitUrl: string;
  notitie?: string;
  opnemerDefault?: string | null;
  onClose: () => void;
  onCreated: (result: {
    foto: { url?: string | null; bestandsnaam?: string | null };
    status_advance?: {
      advanced?: boolean;
      klaarVoorMateriaal?: boolean;
      to?: string;
    };
    project?: Project | null;
  }) => void;
}) {
  const [form, setForm] = useState<SchouwFormulierData>(() =>
    buildPrefill(project, opnemerDefault)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(buildPrefill(project, opnemerDefault));
    setError(null);
    setBusy(false);
  }, [open, project.id, opnemerDefault]);

  if (!open) return null;

  function patch<K extends keyof SchouwFormulierData>(
    key: K,
    value: SchouwFormulierData[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleMee(item: string) {
    setForm((prev) => {
      const has = prev.meeTeNemen.includes(item);
      return {
        ...prev,
        meeTeNemen: has
          ? prev.meeTeNemen.filter((x) => x !== item)
          : [...prev.meeTeNemen, item],
      };
    });
  }

  async function submit() {
    if (!form.klantNaam.trim()) {
      setError("Klantnaam is verplicht");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form,
          notitie:
            (notitie || "").trim() ||
            form.aanvullendeOpmerkingen ||
            form.meerwerkObstakels ||
            "Schouwformulier aangemaakt via platform",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "PDF maken mislukt");
      }
      onCreated({
        foto: data.foto || {},
        status_advance: data.status_advance,
        project: data.project || null,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF maken mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/45 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Schouwformulier"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col bg-white shadow-xl sm:max-h-[90vh]">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              BatterijConcept
            </p>
            <h2 className="text-lg font-semibold text-ink">
              Schouwformulier maken
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Controleer de gegevens en vul de schouw in. Daarna: Maak PDF.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="shrink-0 border border-line px-2.5 py-1 text-sm text-muted hover:bg-wash disabled:opacity-50"
          >
            Sluiten
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-[#0D5C32]">
              Klant & rapport
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Klant">
                <input
                  className={inputCls}
                  value={form.klantNaam}
                  onChange={(e) => patch("klantNaam", e.target.value)}
                />
              </Field>
              <Field label="Datum">
                <input
                  type="date"
                  className={inputCls}
                  value={form.datum}
                  onChange={(e) => patch("datum", e.target.value)}
                />
              </Field>
              <Field label="Adres" className="sm:col-span-2">
                <input
                  className={inputCls}
                  value={form.adres}
                  onChange={(e) => patch("adres", e.target.value)}
                />
              </Field>
              <Field label="Telefoon">
                <input
                  className={inputCls}
                  value={form.telefoon}
                  onChange={(e) => patch("telefoon", e.target.value)}
                />
              </Field>
              <Field label="E-mail">
                <input
                  className={inputCls}
                  value={form.email}
                  onChange={(e) => patch("email", e.target.value)}
                />
              </Field>
              <Field label="Rapportnr.">
                <input
                  className={inputCls}
                  value={form.rapportNr}
                  onChange={(e) => patch("rapportNr", e.target.value)}
                />
              </Field>
              <Field label="Klusnr.">
                <input
                  className={inputCls}
                  value={form.klusNr}
                  onChange={(e) => patch("klusNr", e.target.value)}
                />
              </Field>
              <Field label="Opnemer" className="sm:col-span-2">
                <input
                  className={inputCls}
                  value={form.opnemer}
                  onChange={(e) => {
                    patch("opnemer", e.target.value);
                    patch("handtekeningOpnemerNaam", e.target.value);
                  }}
                />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-[#0D5C32]">
              1. Installatie-object (AlphaESS)
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Model / omvormer">
                <OptionSelect
                  value={form.modelOmvormer}
                  onChange={(v) => patch("modelOmvormer", v)}
                  options={SCHOUW_MODEL_OPTIES}
                />
              </Field>
              <Field label="Totale capaciteit (kWh)">
                <input
                  className={inputCls}
                  value={form.capaciteitKwh}
                  onChange={(e) => patch("capaciteitKwh", e.target.value)}
                  placeholder="bijv. 9,3"
                />
              </Field>
              <Field label="Aantal batterijmodules">
                <input
                  className={inputCls}
                  value={form.aantalModules}
                  onChange={(e) => patch("aantalModules", e.target.value)}
                  placeholder="bijv. 1"
                />
              </Field>
              <Field label="Serienummers" className="sm:col-span-2">
                <textarea
                  className={inputCls}
                  rows={2}
                  value={form.serienummers}
                  onChange={(e) => patch("serienummers", e.target.value)}
                />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-[#0D5C32]">
              2. Meterkast & aansluiting
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type aansluiting">
                <OptionSelect
                  value={form.typeAansluiting}
                  onChange={(v) => patch("typeAansluiting", v)}
                  options={SCHOUW_AANSLUITING_OPTIES}
                />
              </Field>
              <Field label="Hoofdzekering">
                <OptionSelect
                  value={form.hoofdzekering}
                  onChange={(v) => patch("hoofdzekering", v)}
                  options={SCHOUW_HOOFDZEKERING_OPTIES}
                />
              </Field>
              <Field label="Vrije groepen in kast">
                <input
                  className={inputCls}
                  value={form.vrijeGroepen}
                  onChange={(e) => patch("vrijeGroepen", e.target.value)}
                />
              </Field>
              <Field label="Ruimte extra groep + aardlek">
                <OptionSelect
                  value={form.ruimteExtraGroep}
                  onChange={(v) => patch("ruimteExtraGroep", v)}
                  options={SCHOUW_RUIMTE_GROEP_OPTIES}
                />
              </Field>
              <Field label="Aardlek te plaatsen">
                <OptionSelect
                  value={form.aardlekTePlaatsen}
                  onChange={(v) => patch("aardlekTePlaatsen", v)}
                  options={SCHOUW_AARDLEK_OPTIES}
                />
              </Field>
              <Field label="Deugdelijke aarding">
                <JaNeeSelect
                  value={form.deugdelijkeAarding}
                  onChange={(v) => patch("deugdelijkeAarding", v)}
                />
              </Field>
              <Field label="CT-klem plaatsbaar">
                <JaNeeSelect
                  value={form.ctKlemPlaatsbaar}
                  onChange={(v) => patch("ctKlemPlaatsbaar", v)}
                />
              </Field>
              <Field label="Foto meterkast gemaakt">
                <JaNeeSelect
                  value={form.fotoMeterkast}
                  onChange={(v) => patch("fotoMeterkast", v)}
                />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-[#0D5C32]">
              3. Opstelling batterij & omvormer
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Plek batterij + omvormer">
                <input
                  className={inputCls}
                  value={form.plekBatterij}
                  onChange={(e) => patch("plekBatterij", e.target.value)}
                  placeholder="bijv. Zolder / Garage"
                />
              </Field>
              <Field label="Binnen of buiten">
                <OptionSelect
                  value={form.binnenBuiten}
                  onChange={(v) => patch("binnenBuiten", v)}
                  options={SCHOUW_BINNEN_BUITEN_OPTIES}
                />
              </Field>
              <Field label="Montagewijze">
                <OptionSelect
                  value={form.montagewijze}
                  onChange={(v) => patch("montagewijze", v)}
                  options={SCHOUW_MONTAGE_OPTIES}
                />
              </Field>
              <Field label="Wandtype">
                <OptionSelect
                  value={form.wandtype}
                  onChange={(v) => patch("wandtype", v)}
                  options={SCHOUW_WANDTYPE_OPTIES}
                />
              </Field>
              <Field label="Beschikbare ruimte (bxhxd)">
                <input
                  className={inputCls}
                  value={form.beschikbareRuimte}
                  onChange={(e) => patch("beschikbareRuimte", e.target.value)}
                />
              </Field>
              <Field label="Locatie vorstvrij">
                <JaNeeSelect
                  value={form.vorstvrij}
                  onChange={(v) => patch("vorstvrij", v)}
                />
              </Field>
              <Field label="Voldoende ventilatie">
                <JaNeeSelect
                  value={form.ventilatie}
                  onChange={(v) => patch("ventilatie", v)}
                />
              </Field>
              <Field label="Brandveilige vrije afstand">
                <JaNeeSelect
                  value={form.brandveiligeAfstand}
                  onChange={(v) => patch("brandveiligeAfstand", v)}
                />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-[#0D5C32]">
              4. Kabeltracé & boren
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Afstand batterij ↔ meterkast (m)">
                <input
                  className={inputCls}
                  value={form.afstandMeterkastM}
                  onChange={(e) => patch("afstandMeterkastM", e.target.value)}
                />
              </Field>
              <Field label="Kabelroute">
                <OptionSelect
                  value={form.kabelroute}
                  onChange={(v) => patch("kabelroute", v)}
                  options={SCHOUW_KABELROUTE_OPTIES}
                />
              </Field>
              <Field label="Door welke muren/vloeren" className="sm:col-span-2">
                <input
                  className={inputCls}
                  value={form.doorMurenVloeren}
                  onChange={(e) => patch("doorMurenVloeren", e.target.value)}
                />
              </Field>
              <Field label="Materiaal om te boren">
                <OptionSelect
                  value={form.boormateriaal}
                  onChange={(v) => patch("boormateriaal", v)}
                  options={SCHOUW_BOORMATERIAAL_OPTIES}
                />
              </Field>
              <Field label="Aantal doorvoeren">
                <input
                  className={inputCls}
                  value={form.aantalDoorvoeren}
                  onChange={(e) => patch("aantalDoorvoeren", e.target.value)}
                />
              </Field>
              <Field label="Boordiameter">
                <input
                  className={inputCls}
                  value={form.boordiameter}
                  onChange={(e) => patch("boordiameter", e.target.value)}
                  placeholder="bv. 20 mm / kernboor 40 mm"
                />
              </Field>
              <Field label="Kabelgoot/buis nodig">
                <input
                  className={inputCls}
                  value={form.kabelgootNodig}
                  onChange={(e) => patch("kabelgootNodig", e.target.value)}
                />
              </Field>
              <Field label="Lengte kabelgoot/buis (m)">
                <input
                  className={inputCls}
                  value={form.kabelgootLengteM}
                  onChange={(e) => patch("kabelgootLengteM", e.target.value)}
                />
              </Field>
              <Field label="Kabeldoorsnede">
                <OptionSelect
                  value={form.kabeldoorsnede}
                  onChange={(v) => patch("kabeldoorsnede", v)}
                  options={SCHOUW_KABELDOORSNEDE_OPTIES}
                />
              </Field>
              <Field label="Hak-/graafwerk nodig">
                <input
                  className={inputCls}
                  value={form.hakGraafwerk}
                  onChange={(e) => patch("hakGraafwerk", e.target.value)}
                />
              </Field>
              <Field label="Wifi-bereik">
                <OptionSelect
                  value={form.wifiBereik}
                  onChange={(v) => patch("wifiBereik", v)}
                  options={SCHOUW_WIFI_OPTIES}
                />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-[#0D5C32]">
              5. Praktisch & mee te nemen
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ladder/steiger nodig">
                <input
                  className={inputCls}
                  value={form.ladderNodig}
                  onChange={(e) => patch("ladderNodig", e.target.value)}
                />
              </Field>
              <Field label="Aanvoer / parkeren">
                <OptionSelect
                  value={form.aanvoerParkeren}
                  onChange={(v) => patch("aanvoerParkeren", v)}
                  options={SCHOUW_AANVOER_OPTIES}
                />
              </Field>
              <Field label="Geschatte installatietijd (dagdelen)">
                <input
                  className={inputCls}
                  value={form.installatietijdDagdelen}
                  onChange={(e) =>
                    patch("installatietijdDagdelen", e.target.value)
                  }
                  placeholder="bijv. 1,5"
                />
              </Field>
            </div>
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
                Mee te nemen materiaal
              </p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {SCHOUW_MEE_TE_NEMEN_OPTIES.map((item) => {
                  const checked = form.meeTeNemen.includes(item);
                  return (
                    <label
                      key={item}
                      className={[
                        "flex cursor-pointer items-center gap-2 border px-2 py-1.5 text-sm",
                        checked
                          ? "border-[#0D9488] bg-[#F0FDFA] text-ink"
                          : "border-line text-ink hover:bg-wash",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMee(item)}
                        className="accent-[#0D9488]"
                      />
                      {item}
                    </label>
                  );
                })}
              </div>
            </div>
            <Field label="Verwacht meerwerk / obstakels">
              <textarea
                className={inputCls}
                rows={2}
                value={form.meerwerkObstakels}
                onChange={(e) => patch("meerwerkObstakels", e.target.value)}
                placeholder="bijv. kast te klein, extra doorvoer, tuin grazen…"
              />
            </Field>
            <Field label="Aanvullende opmerkingen & afspraken">
              <textarea
                className={inputCls}
                rows={3}
                value={form.aanvullendeOpmerkingen}
                onChange={(e) =>
                  patch("aanvullendeOpmerkingen", e.target.value)
                }
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Naam opnemer (handtekening)">
                <input
                  className={inputCls}
                  value={form.handtekeningOpnemerNaam}
                  onChange={(e) =>
                    patch("handtekeningOpnemerNaam", e.target.value)
                  }
                />
              </Field>
              <Field label="Naam klant (handtekening)">
                <input
                  className={inputCls}
                  value={form.handtekeningKlantNaam}
                  onChange={(e) =>
                    patch("handtekeningKlantNaam", e.target.value)
                  }
                />
              </Field>
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-wash px-4 py-3 sm:px-5">
          {error ? (
            <p className="text-sm text-[#C45A12]">{error}</p>
          ) : (
            <p className="text-xs text-muted">
              PDF wordt opgeslagen als schouwformulier op dit project.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50"
            >
              Annuleren
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="bg-[#0D5C32] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0A4A28] disabled:opacity-50"
            >
              {busy ? "PDF maken…" : "Maak PDF"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
