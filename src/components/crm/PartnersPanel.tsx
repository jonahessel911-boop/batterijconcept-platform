"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Adviseur, InstallatiePartner } from "@/types/database";
import { formatEuro } from "@/lib/format";
import { RelatieContractUpload } from "./RelatieContractUpload";
import { CreditfacturenPanel } from "./CreditfacturenPanel";

type PartnerKind = "adviseur" | "installatiepartner";
type PartnersView = "relaties" | "facturen";

type ListRow = {
  kind: PartnerKind;
  id: string;
  naam: string;
  email: string | null;
  telefoon: string | null;
  actief: boolean;
  bedrijfsnaam: string | null;
  kvk_nummer: string | null;
  btw_nummer: string | null;
  factuur_adres: string | null;
  factuur_postcode: string | null;
  factuur_plaats: string | null;
  iban: string | null;
  contract_bestandsnaam?: string | null;
  contract_uploaded_at?: string | null;
  contract_storage_path?: string | null;
  portal_token?: string | null;
  totaalCommissie: number;
  openCommissie: number;
  factuurCount: number;
};

type FormState = {
  kind: PartnerKind;
  naam: string;
  email: string;
  telefoon: string;
  bedrijfsnaam: string;
  kvk_nummer: string;
  btw_nummer: string;
  factuur_adres: string;
  factuur_postcode: string;
  factuur_plaats: string;
  iban: string;
  actief: boolean;
};

const emptyForm = (kind: PartnerKind = "adviseur"): FormState => ({
  kind,
  naam: "",
  email: "",
  telefoon: "",
  bedrijfsnaam: "",
  kvk_nummer: "",
  btw_nummer: "",
  factuur_adres: "",
  factuur_postcode: "",
  factuur_plaats: "",
  iban: "",
  actief: true,
});

const inputCls =
  "mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green";

function kvkCompleet(r: {
  bedrijfsnaam?: string | null;
  kvk_nummer?: string | null;
  iban?: string | null;
}) {
  return Boolean(r.bedrijfsnaam && r.kvk_nummer && r.iban);
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
    <label
      className={`block text-[10px] font-semibold uppercase tracking-wide text-muted ${className}`}
    >
      {label}
      {children}
    </label>
  );
}

function portalBase(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "https://platform.batterijconcept.nl";
}

type CommissieTotals = Record<
  string,
  { totaal: number; open: number; count: number }
>;

function accumulateCommissie(
  map: CommissieTotals,
  id: string,
  bedragEx: number,
  status: string
) {
  if (status === "geannuleerd") return;
  const cur = map[id] || { totaal: 0, open: 0, count: 0 };
  cur.totaal += bedragEx;
  cur.count += 1;
  if (status !== "betaald") cur.open += bedragEx;
  map[id] = cur;
}

export function PartnersPanel({
  onAdviseursChange,
}: {
  onAdviseursChange?: () => void;
}) {
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [advCommissie, setAdvCommissie] = useState<CommissieTotals>({});
  const [partnerCommissie, setPartnerCommissie] = useState<CommissieTotals>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [view, setView] = useState<PartnersView>("relaties");
  const [filter, setFilter] = useState<"alle" | PartnerKind>("alle");
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editKey, setEditKey] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [aRes, pRes, advCfRes, partnerCfRes] = await Promise.all([
        fetch("/api/adviseurs?include_inactive=1"),
        fetch("/api/installatie-partners?include_inactive=1"),
        fetch("/api/adviseurs/creditfacturen"),
        fetch("/api/partners/creditfacturen"),
      ]);
      const aData = await aRes.json();
      const pData = await pRes.json();
      if (!aRes.ok) throw new Error(aData.error || "Adviseurs laden mislukt");
      if (!pRes.ok) throw new Error(pData.error || "Partners laden mislukt");
      setAdviseurs((aData.adviseurs || []) as Adviseur[]);
      setPartners((pData.partners || []) as InstallatiePartner[]);

      const advMap: CommissieTotals = {};
      if (advCfRes.ok) {
        const j = await advCfRes.json();
        for (const f of j.facturen || []) {
          accumulateCommissie(
            advMap,
            f.adviseur_id as string,
            Number(f.bedrag_ex_btw) || 0,
            String(f.status || "")
          );
        }
      }
      setAdvCommissie(advMap);

      const partnerMap: CommissieTotals = {};
      if (partnerCfRes.ok) {
        const j = await partnerCfRes.json();
        for (const f of j.facturen || []) {
          accumulateCommissie(
            partnerMap,
            f.partner_id as string,
            Number(f.bedrag_ex_btw) || 0,
            String(f.status || "")
          );
        }
      }
      setPartnerCommissie(partnerMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  const rows = useMemo(() => {
    const advRows: ListRow[] = adviseurs
      .filter((a) => (a.rol || "adviseur") === "adviseur")
      .map((a) => {
        const c = advCommissie[a.id] || { totaal: 0, open: 0, count: 0 };
        return {
          kind: "adviseur" as const,
          id: a.id,
          naam: a.naam,
          email: a.email,
          telefoon: a.telefoon,
          actief: a.actief !== false,
          bedrijfsnaam: a.bedrijfsnaam ?? null,
          kvk_nummer: a.kvk_nummer ?? null,
          btw_nummer: a.btw_nummer ?? null,
          factuur_adres: a.factuur_adres ?? null,
          factuur_postcode: a.factuur_postcode ?? null,
          factuur_plaats: a.factuur_plaats ?? null,
          iban: a.iban ?? null,
          contract_bestandsnaam: a.contract_bestandsnaam,
          contract_uploaded_at: a.contract_uploaded_at,
          contract_storage_path: a.contract_storage_path,
          totaalCommissie: c.totaal,
          openCommissie: c.open,
          factuurCount: c.count,
        };
      });

    const partnerRows: ListRow[] = partners.map((p) => {
      const c = partnerCommissie[p.id] || { totaal: 0, open: 0, count: 0 };
      return {
        kind: "installatiepartner" as const,
        id: p.id,
        naam: p.naam,
        email: p.email,
        telefoon: p.telefoon,
        actief: p.actief !== false,
        bedrijfsnaam: p.bedrijfsnaam ?? null,
        kvk_nummer: p.kvk_nummer ?? null,
        btw_nummer: p.btw_nummer ?? null,
        factuur_adres: p.factuur_adres ?? null,
        factuur_postcode: p.factuur_postcode ?? null,
        factuur_plaats: p.factuur_plaats ?? null,
        iban: p.iban ?? null,
        contract_bestandsnaam: p.contract_bestandsnaam,
        contract_uploaded_at: p.contract_uploaded_at,
        contract_storage_path: p.contract_storage_path,
        portal_token: p.portal_token,
        totaalCommissie: c.totaal,
        openCommissie: c.open,
        factuurCount: c.count,
      };
    });

    const all = [...advRows, ...partnerRows].sort((a, b) => {
      if (a.actief !== b.actief) return a.actief ? -1 : 1;
      return a.naam.localeCompare(b.naam, "nl");
    });

    if (filter === "alle") return all;
    return all.filter((r) => r.kind === filter);
  }, [adviseurs, partners, filter, advCommissie, partnerCommissie]);

  function openCreate() {
    setForm(emptyForm("adviseur"));
    setEditKey(null);
    setMode("create");
    setError(null);
    setOkMsg(null);
  }

  function openEdit(row: ListRow) {
    setForm({
      kind: row.kind,
      naam: row.naam,
      email: row.email || "",
      telefoon: row.telefoon || "",
      bedrijfsnaam: row.bedrijfsnaam || "",
      kvk_nummer: row.kvk_nummer || "",
      btw_nummer: row.btw_nummer || "",
      factuur_adres: row.factuur_adres || "",
      factuur_postcode: row.factuur_postcode || "",
      factuur_plaats: row.factuur_plaats || "",
      iban: row.iban || "",
      actief: row.actief,
    });
    setEditKey(`${row.kind}:${row.id}`);
    setMode("edit");
    setError(null);
    setOkMsg(null);
  }

  function backToList() {
    setMode("list");
    setEditKey(null);
    setForm(emptyForm());
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    const naam = form.naam.trim();
    const email = form.email.trim().toLowerCase();
    if (!naam) {
      setError("Naam is verplicht");
      return;
    }
    if (!email) {
      setError("E-mail is verplicht");
      return;
    }

    const kvk = {
      bedrijfsnaam: form.bedrijfsnaam.trim() || null,
      kvk_nummer: form.kvk_nummer.trim() || null,
      btw_nummer: form.btw_nummer.trim() || null,
      factuur_adres: form.factuur_adres.trim() || null,
      factuur_postcode: form.factuur_postcode.trim() || null,
      factuur_plaats: form.factuur_plaats.trim() || null,
      iban: form.iban.trim().toUpperCase() || null,
    };

    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      if (mode === "create") {
        if (form.kind === "adviseur") {
          const res = await fetch("/api/adviseurs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              naam,
              email,
              telefoon: form.telefoon.trim() || null,
              rol: "adviseur",
              ...kvk,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Aanmaken mislukt");
          setOkMsg(
            data.mail_sent
              ? `Adviseur ${naam} aangemaakt · welkomstmail verstuurd.`
              : `Adviseur ${naam} aangemaakt.`
          );
          onAdviseursChange?.();
        } else {
          const res = await fetch("/api/installatie-partners", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              naam,
              email,
              telefoon: form.telefoon.trim() || null,
              ...kvk,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Aanmaken mislukt");
          setOkMsg(`Installatiepartner ${naam} aangemaakt.`);
        }
        await load();
        setMode("list");
        setEditKey(null);
      } else if (mode === "edit" && editKey) {
        const [kind, id] = editKey.split(":") as [PartnerKind, string];
        if (kind === "adviseur") {
          const res = await fetch("/api/adviseurs", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id,
              naam,
              email,
              telefoon: form.telefoon.trim() || null,
              actief: form.actief,
              ...kvk,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
          setOkMsg("Adviseur opgeslagen.");
          onAdviseursChange?.();
        } else {
          const res = await fetch("/api/installatie-partners", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id,
              naam,
              email,
              telefoon: form.telefoon.trim() || null,
              actief: form.actief,
              ...kvk,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
          setOkMsg("Installatiepartner opgeslagen.");
        }
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  const editingRow =
    mode === "edit" && editKey
      ? rows.find((r) => `${r.kind}:${r.id}` === editKey) || null
      : null;

  if (mode === "create" || mode === "edit") {
    const isAdviseur = form.kind === "adviseur";
    return (
      <div className="space-y-4">
        <div className="border border-line bg-white">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={backToList}
              className="text-xs font-semibold text-green hover:underline"
            >
              ← Terug naar overzicht
            </button>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-semibold text-ink">
                  {mode === "create" ? "Nieuwe partner" : form.naam || "Partner"}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {mode === "create"
                    ? "Kies type en vul contact- en KvK-gegevens in."
                    : isAdviseur
                      ? "Adviseur · KvK, contract en commissie"
                      : "Installatiepartner · KvK, contract en vergoedingen"}
                </p>
              </div>
              {mode === "edit" && editingRow && (
                <div className="min-w-[10rem] border border-line bg-wash/40 px-4 py-3 text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Totaal commissie
                  </p>
                  <p className="mt-1 font-display text-xl font-semibold tabular-nums text-ink">
                    {formatEuro(editingRow.totaalCommissie)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    excl. btw (10% omzet)
                    {editingRow.openCommissie > 0
                      ? ` · ${formatEuro(editingRow.openCommissie)} open`
                      : editingRow.factuurCount > 0
                        ? " · alles betaald"
                        : ""}
                  </p>
                </div>
              )}
            </div>
          </div>

          {(error || okMsg) && (
            <div className="space-y-2 border-b border-line px-4 py-3 sm:px-5">
              {error && (
                <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                  {error}
                </p>
              )}
              {okMsg && (
                <p className="border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
                  {okMsg}
                </p>
              )}
            </div>
          )}

          <div className="space-y-5 p-4 sm:p-5">
            {mode === "create" && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Type
                </p>
                <div className="mt-2 flex border border-line p-0.5">
                  <button
                    type="button"
                    onClick={() => setField("kind", "adviseur")}
                    className={[
                      "flex-1 px-3 py-2 text-sm font-semibold",
                      form.kind === "adviseur"
                        ? "bg-green text-white"
                        : "bg-white text-muted hover:bg-wash",
                    ].join(" ")}
                  >
                    Adviseur
                  </button>
                  <button
                    type="button"
                    onClick={() => setField("kind", "installatiepartner")}
                    className={[
                      "flex-1 px-3 py-2 text-sm font-semibold",
                      form.kind === "installatiepartner"
                        ? "bg-green text-white"
                        : "bg-white text-muted hover:bg-wash",
                    ].join(" ")}
                  >
                    Installatiepartner
                  </button>
                </div>
              </div>
            )}

            <section>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Contact
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Naam">
                  <input
                    value={form.naam}
                    onChange={(e) => setField("naam", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="E-mail">
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setField("email", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Telefoon">
                  <input
                    value={form.telefoon}
                    onChange={(e) => setField("telefoon", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                {mode === "edit" && (
                  <Field label="Status">
                    <select
                      value={form.actief ? "1" : "0"}
                      onChange={(e) =>
                        setField("actief", e.target.value === "1")
                      }
                      className={inputCls}
                    >
                      <option value="1">Actief</option>
                      <option value="0">Uit</option>
                    </select>
                  </Field>
                )}
              </div>
            </section>

            <section className="border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  KvK / factuurgegevens
                </p>
                {mode === "edit" && (
                  <span
                    className={
                      kvkCompleet(form)
                        ? "text-xs font-semibold text-green-dark"
                        : "text-xs font-semibold text-[#C45A12]"
                    }
                  >
                    {kvkCompleet(form) ? "Compleet" : "Incompleet"}
                  </span>
                )}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Bedrijfsnaam" className="sm:col-span-2">
                  <input
                    value={form.bedrijfsnaam}
                    onChange={(e) => setField("bedrijfsnaam", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="KvK-nummer">
                  <input
                    value={form.kvk_nummer}
                    onChange={(e) => setField("kvk_nummer", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Btw-nummer">
                  <input
                    value={form.btw_nummer}
                    onChange={(e) => setField("btw_nummer", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Factuuradres" className="sm:col-span-2">
                  <input
                    value={form.factuur_adres}
                    onChange={(e) => setField("factuur_adres", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Postcode">
                  <input
                    value={form.factuur_postcode}
                    onChange={(e) =>
                      setField("factuur_postcode", e.target.value)
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Plaats">
                  <input
                    value={form.factuur_plaats}
                    onChange={(e) => setField("factuur_plaats", e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="IBAN" className="sm:col-span-2">
                  <input
                    value={form.iban}
                    onChange={(e) => setField("iban", e.target.value)}
                    className={inputCls}
                    placeholder="NL00 BANK 0123 4567 89"
                  />
                </Field>
              </div>
            </section>

            {mode === "edit" && editingRow && (
              <section>
                <RelatieContractUpload
                  kind={
                    editingRow.kind === "adviseur" ? "adviseur" : "partner"
                  }
                  id={editingRow.id}
                  bestandsnaam={editingRow.contract_bestandsnaam}
                  uploadedAt={editingRow.contract_uploaded_at}
                  onUploaded={() => {
                    setOkMsg("Contract geüpload.");
                    void load();
                  }}
                  onMessage={(msg, isError) => {
                    if (isError) setError(msg);
                    else setOkMsg(msg);
                  }}
                />
                {editingRow.kind === "installatiepartner" &&
                  editingRow.portal_token && (
                    <p className="mt-3 text-xs text-muted">
                      Portaal:{" "}
                      <button
                        type="button"
                        className="font-semibold text-green-dark hover:underline"
                        onClick={() => {
                          const url = `${portalBase()}/installatie/${editingRow.portal_token}`;
                          void navigator.clipboard.writeText(url).then(
                            () => setOkMsg("Portaallink gekopieerd."),
                            () => setError("Kopiëren mislukt")
                          );
                        }}
                      >
                        Link kopiëren
                      </button>
                    </p>
                  )}
              </section>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="bg-orange px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving
                  ? "Bezig…"
                  : mode === "create"
                    ? "Partner aanmaken"
                    : "Opslaan"}
              </button>
              <button
                type="button"
                onClick={backToList}
                className="border border-line bg-white px-4 py-2 text-sm font-semibold text-muted hover:bg-wash"
              >
                Annuleren
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">
              Partners
            </h2>
            <p className="mt-1 text-sm text-muted">
              Relaties, KvK en creditfacturen
            </p>
          </div>
          {view === "relaties" && (
            <button
              type="button"
              onClick={openCreate}
              className="bg-orange px-4 py-2 text-sm font-semibold text-white"
            >
              + Nieuwe partner
            </button>
          )}
        </div>

        <div className="border-b border-line px-4 py-2 sm:px-5">
          <div className="flex border border-line p-0.5">
            <button
              type="button"
              onClick={() => {
                setView("relaties");
                setMode("list");
              }}
              className={[
                "px-3 py-1.5 text-xs font-semibold",
                view === "relaties"
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              Relaties
            </button>
            <button
              type="button"
              onClick={() => {
                setView("facturen");
                setMode("list");
              }}
              className={[
                "px-3 py-1.5 text-xs font-semibold",
                view === "facturen"
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              Facturen
            </button>
          </div>
        </div>
      </div>

      {view === "facturen" ? (
        <CreditfacturenPanel />
      ) : (
        <div className="border border-line bg-white">
          {(error || okMsg) && (
            <div className="space-y-2 border-b border-line px-4 py-3 sm:px-5">
              {error && (
                <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                  {error}
                </p>
              )}
              {okMsg && (
                <p className="border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
                  {okMsg}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <div className="flex border border-line p-0.5">
              {(
                [
                  ["alle", "Alle"],
                  ["adviseur", "Adviseurs"],
                  ["installatiepartner", "Installatiepartners"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={[
                    "px-3 py-1.5 text-xs font-semibold",
                    filter === id
                      ? "bg-green text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">
              {rows.length} partner{rows.length === 1 ? "" : "s"}
            </p>
          </div>

          {loading ? (
            <p className="px-5 py-10 text-center text-sm text-muted">Laden…</p>
          ) : rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              Nog geen partners. Maak de eerste aan.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={`${r.kind}:${r.id}`}>
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    className="flex w-full flex-wrap items-center gap-3 px-4 py-4 text-left hover:bg-wash sm:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-base font-semibold text-ink">
                          {r.naam}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                          {r.kind === "adviseur"
                            ? "Adviseur"
                            : "Installatiepartner"}
                        </span>
                        {!r.actief && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                            Uit
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        {r.email || "—"}
                        {r.bedrijfsnaam ? ` · ${r.bedrijfsnaam}` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {kvkCompleet(r) ? (
                          <span className="font-semibold text-green-dark">
                            KvK compleet
                          </span>
                        ) : (
                          <span className="font-semibold text-[#C45A12]">
                            KvK incompleet
                          </span>
                        )}
                        {r.contract_bestandsnaam ? (
                          <span className="text-muted">Contract ✓</span>
                        ) : (
                          <span className="text-muted">Geen contract</span>
                        )}
                        {r.factuurCount > 0 && (
                          <span className="text-muted">
                            {r.factuurCount} factuur
                            {r.factuurCount === 1 ? "" : "en"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Totaal commissie
                      </p>
                      <p className="mt-0.5 font-display text-lg font-semibold tabular-nums text-ink">
                        {formatEuro(r.totaalCommissie)}
                      </p>
                      <p className="text-xs text-muted">
                        {r.openCommissie > 0
                          ? `${formatEuro(r.openCommissie)} open`
                          : r.factuurCount > 0
                            ? "Alles betaald"
                            : "Nog geen facturen"}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
