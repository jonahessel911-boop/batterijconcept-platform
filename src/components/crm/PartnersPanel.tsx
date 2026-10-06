"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import type { Adviseur, InstallatiePartner } from "@/types/database";
import { formatEuro } from "@/lib/format";
import { clearCrmShellCache } from "@/lib/crm-shell-cache";
import { RelatieContractUpload } from "./RelatieContractUpload";
import { CreditfacturenPanel } from "./CreditfacturenPanel";
import { PartnerUitbetalingenBlock } from "./PartnerUitbetalingenBlock";
import { InstellingenPanel } from "./InstellingenPanel";

type PartnerKind = "adviseur" | "installatiepartner";
type PartnersView = "relaties" | "facturen" | "team";

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
  const searchParams = useSearchParams();
  const initialView: PartnersView = (() => {
    const p = searchParams.get("partners");
    if (p === "uitbetalingen" || p === "facturen") return "facturen";
    if (p === "team") return "team";
    return "relaties";
  })();
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [advCommissie, setAdvCommissie] = useState<CommissieTotals>({});
  const [partnerCommissie, setPartnerCommissie] = useState<CommissieTotals>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [view, setView] = useState<PartnersView>(initialView);
  const [filter, setFilter] = useState<"alle" | PartnerKind>("alle");
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editKey, setEditKey] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [loginBusyId, setLoginBusyId] = useState<string | null>(null);

  useEffect(() => {
    const p = searchParams.get("partners");
    if (p === "uitbetalingen" || p === "facturen") {
      setView("facturen");
      setMode("list");
    } else if (p === "team") {
      setView("team");
      setMode("list");
    }
  }, [searchParams]);

  async function loginAlsAdviseur(id: string, naam: string) {
    setLoginBusyId(id);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/auth/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adviseur_id: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Login als mislukt"
        );
      }
      clearCrmShellCache();
      setOkMsg(`Ingelogd als ${naam}…`);
      window.location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login als mislukt");
      setLoginBusyId(null);
    }
  }

  function loginAlsPartner(token: string | null | undefined) {
    if (!token) {
      setError("Deze partner heeft nog geen portaallink.");
      return;
    }
    window.open(`${portalBase()}/installatie/${token}`, "_blank", "noopener");
  }

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
                    {isAdviseur ? "Totaal commissie" : "Totaal gefactureerd"}
                  </p>
                  <p className="mt-1 font-display text-xl font-semibold tabular-nums text-ink">
                    {formatEuro(editingRow.totaalCommissie)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {isAdviseur ? "excl. btw (10% omzet)" : "excl. btw"}
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
              <PartnerUitbetalingenBlock
                kind={
                  editingRow.kind === "adviseur" ? "adviseur" : "partner"
                }
                id={editingRow.id}
                naam={editingRow.naam || form.naam}
                onMessage={(msg, isError) => {
                  if (isError) setError(msg);
                  else {
                    setError(null);
                    setOkMsg(msg);
                  }
                }}
              />
            )}

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
                {editingRow.kind === "adviseur" && editingRow.actief ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      disabled={loginBusyId === editingRow.id}
                      onClick={() =>
                        void loginAlsAdviseur(editingRow.id, editingRow.naam)
                      }
                      className="border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-60"
                    >
                      {loginBusyId === editingRow.id
                        ? "Bezig…"
                        : "Login als deze adviseur"}
                    </button>
                  </div>
                ) : null}
                {editingRow.kind === "installatiepartner" &&
                  editingRow.portal_token && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => loginAlsPartner(editingRow.portal_token)}
                        className="border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-wash"
                      >
                        Login als (portaal openen)
                      </button>
                      <button
                        type="button"
                        className="text-xs font-semibold text-green-dark hover:underline"
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
                    </div>
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

  const relatiesStats = useMemo(() => {
    const adviseurCount = rows.filter((r) => r.kind === "adviseur").length;
    const partnerCount = rows.filter(
      (r) => r.kind === "installatiepartner"
    ).length;
    const kvkOpen = rows.filter((r) => !kvkCompleet(r)).length;
    const openEuro = rows.reduce((s, r) => s + r.openCommissie, 0);
    return { adviseurCount, partnerCount, kvkOpen, openEuro };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-white px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-3">
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
              Uitbetalingen
            </button>
            <button
              type="button"
              onClick={() => {
                setView("team");
                setMode("list");
              }}
              className={[
                "px-3 py-1.5 text-xs font-semibold",
                view === "team"
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              Team
            </button>
          </div>
          {view === "relaties" ? (
            <p className="text-xs text-muted">
              {rows.length} relatie{rows.length === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
        {view === "relaties" ? (
          <button
            type="button"
            onClick={openCreate}
            className="bg-orange px-4 py-2 text-sm font-semibold text-white hover:bg-[#e0651c]"
          >
            + Nieuwe partner
          </button>
        ) : null}
      </div>

      {view === "facturen" ? (
        <CreditfacturenPanel />
      ) : view === "team" ? (
        <InstellingenPanel
          teamOnly
          onAdviseursChange={onAdviseursChange}
        />
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

          <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
            {(
              [
                ["Adviseurs", String(relatiesStats.adviseurCount)],
                ["Installateurs", String(relatiesStats.partnerCount)],
                ["KvK incompleet", String(relatiesStats.kvkOpen)],
                ["Open excl.", formatEuro(relatiesStats.openEuro)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="bg-white px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {label}
                </p>
                <p
                  className={[
                    "mt-1 font-display text-lg font-semibold tabular-nums",
                    label === "KvK incompleet" && relatiesStats.kvkOpen > 0
                      ? "text-[#C45A12]"
                      : "text-ink",
                  ].join(" ")}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-5">
            <div className="flex border border-line p-0.5">
              {(
                [
                  ["alle", "Alle"],
                  ["adviseur", "Adviseurs"],
                  ["installatiepartner", "Installateurs"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={[
                    "px-3 py-1.5 text-[11px] font-semibold",
                    filter === id
                      ? "bg-ink text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <p className="px-5 py-10 text-center text-sm text-muted">Laden…</p>
          ) : rows.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-medium text-ink">Nog geen partners</p>
              <p className="mt-1 text-sm text-muted">
                Voeg een adviseur of installatiepartner toe om te beginnen.
              </p>
              <button
                type="button"
                onClick={openCreate}
                className="mt-4 bg-orange px-4 py-2 text-sm font-semibold text-white"
              >
                + Nieuwe partner
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 sm:px-5">Relatie</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-right">Open</th>
                    <th className="px-3 py-2.5 text-right">Totaal</th>
                    <th className="px-4 py-2.5 text-right sm:px-5">Acties</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => {
                    const kvkOk = kvkCompleet(r);
                    const hasContract = Boolean(r.contract_bestandsnaam);
                    return (
                      <tr
                        key={`${r.kind}:${r.id}`}
                        className="group hover:bg-wash/70"
                      >
                        <td className="px-4 py-3.5 sm:px-5">
                          <button
                            type="button"
                            onClick={() => openEdit(r)}
                            className="min-w-0 text-left"
                          >
                            <span className="block font-display text-base font-semibold text-ink group-hover:text-green-deeper">
                              {r.naam}
                              {!r.actief ? (
                                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                                  Uit
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted">
                              {r.email || "Geen e-mail"}
                              {r.bedrijfsnaam ? ` · ${r.bedrijfsnaam}` : ""}
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-3.5">
                          <span
                            className={[
                              "inline-block border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              r.kind === "adviseur"
                                ? "border-line bg-wash text-muted"
                                : "border-green/25 bg-green-soft text-green-dark",
                            ].join(" ")}
                          >
                            {r.kind === "adviseur"
                              ? "Adviseur"
                              : "Installateur"}
                          </span>
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="flex flex-col gap-1">
                            <span
                              className={[
                                "text-xs font-semibold",
                                kvkOk ? "text-green-dark" : "text-[#C45A12]",
                              ].join(" ")}
                            >
                              {kvkOk ? "KvK compleet" : "KvK incompleet"}
                            </span>
                            <span className="text-xs text-muted">
                              {hasContract ? "Contract ✓" : "Geen contract"}
                              {r.factuurCount > 0
                                ? ` · ${r.factuurCount} factuur${r.factuurCount === 1 ? "" : "en"}`
                                : ""}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-right">
                          {r.openCommissie > 0 ? (
                            <span className="font-semibold tabular-nums text-[#854D0E]">
                              {formatEuro(r.openCommissie)}
                            </span>
                          ) : (
                            <span className="tabular-nums text-muted">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5 text-right">
                          <span className="font-semibold tabular-nums text-ink">
                            {r.totaalCommissie > 0
                              ? formatEuro(r.totaalCommissie)
                              : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right sm:px-5">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEdit(r)}
                              className="border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink hover:bg-wash"
                            >
                              Openen
                            </button>
                            {r.kind === "adviseur" && r.actief ? (
                              <button
                                type="button"
                                disabled={loginBusyId === r.id}
                                onClick={() =>
                                  void loginAlsAdviseur(r.id, r.naam)
                                }
                                className="border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-60"
                              >
                                {loginBusyId === r.id ? "…" : "Login als"}
                              </button>
                            ) : null}
                            {r.kind === "installatiepartner" &&
                            r.portal_token ? (
                              <button
                                type="button"
                                onClick={() => loginAlsPartner(r.portal_token)}
                                className="border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink hover:bg-wash"
                              >
                                Login als
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
