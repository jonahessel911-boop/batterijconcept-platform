"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Adviseur,
  AdviseurCreditFactuur,
  InstallatiePartner,
  PartnerCreditFactuur,
} from "@/types/database";
import { formatDateShort, formatEuro } from "@/lib/format";
import { VERKOPER_AANBETALING_FEE } from "@/lib/adviseur-creditfactuur";

type QueueFilter =
  | "open"
  | "te_versturen"
  | "wacht"
  | "te_betalen"
  | "betaald"
  | "alles";
type TypeFilter = "alles" | "verkopers" | "installateurs";
type CreateKind = "verkoper" | "partner";

type OverviewFactuur = AdviseurCreditFactuur & {
  adviseurs?: {
    id: string;
    naam: string;
    bedrijfsnaam?: string | null;
    kvk_nummer?: string | null;
    iban?: string | null;
  } | null;
};

type PartnerOverview = PartnerCreditFactuur & {
  installatie_partners?: {
    id: string;
    naam: string;
    bedrijfsnaam?: string | null;
    kvk_nummer?: string | null;
    iban?: string | null;
  } | null;
};

type InvoiceKind = "commissie_a" | "commissie_b" | "installatie" | "overig";

type InboxRow = {
  key: string;
  source: "adviseur" | "partner";
  id: string;
  relatieId: string;
  relatieNaam: string;
  kvkOk: boolean;
  nummer: string;
  kind: InvoiceKind;
  kindLabel: string;
  context: string | null;
  bedragEx: number;
  bedragInc: number;
  status: string;
  goedgekeurd_op: string | null;
  betaald_op: string | null;
  factuurdatum: string;
  searchText: string;
};

function kvkIncompleet(r: {
  bedrijfsnaam?: string | null;
  kvk_nummer?: string | null;
  iban?: string | null;
}) {
  return !r.bedrijfsnaam || !r.kvk_nummer || !r.iban;
}

function parseKind(
  source: "adviseur" | "partner",
  nummer: string
): { kind: InvoiceKind; label: string } {
  if (source === "partner") {
    return { kind: "installatie", label: "Installatie" };
  }
  if (/\/AANBETALING\//i.test(nummer)) {
    return { kind: "commissie_a", label: "Commissie A" };
  }
  if (/\/RESTBETALING\//i.test(nummer)) {
    return { kind: "commissie_b", label: "Commissie B" };
  }
  return { kind: "overig", label: "Commissie" };
}

function extractContext(opts: {
  notities?: string | null;
  omschrijving?: string | null;
  offerte_nummer?: string | null;
  project_nummer?: string | null;
}): string | null {
  const parts: string[] = [];
  if (opts.offerte_nummer) parts.push(`Offerte ${opts.offerte_nummer}`);
  if (opts.project_nummer) parts.push(`Project ${opts.project_nummer}`);
  const blob = [opts.omschrijving, opts.notities].filter(Boolean).join(" · ");
  if (blob) {
    const klant = /Klant\s+([^·|]+)/i.exec(blob);
    if (klant?.[1]?.trim() && !parts.some((p) => p.startsWith("Klant"))) {
      parts.unshift(`Klant ${klant[1].trim()}`);
    }
    if (!opts.offerte_nummer) {
      const off = /Offerte\s+([A-Z0-9\-_/]+)/i.exec(blob);
      if (off?.[1]) parts.push(`Offerte ${off[1]}`);
    }
    if (!opts.project_nummer) {
      const prj = /Project\s+([A-Z0-9\-_/]+)/i.exec(blob);
      if (prj?.[1]) parts.push(`Project ${prj[1]}`);
    }
  }
  return parts.length ? parts.join(" · ") : null;
}

function queueOf(status: string): QueueFilter | null {
  if (status === "concept") return "te_versturen";
  if (status === "verzonden") return "wacht";
  if (status === "goedgekeurd") return "te_betalen";
  if (status === "betaald") return "betaald";
  return null;
}

function statusRank(status: string): number {
  switch (status) {
    case "concept":
      return 0;
    case "verzonden":
      return 1;
    case "goedgekeurd":
      return 2;
    case "betaald":
      return 3;
    default:
      return 9;
  }
}

function StatusBadge({
  status,
  goedgekeurd_op,
  betaald_op,
}: {
  status: string;
  goedgekeurd_op: string | null;
  betaald_op: string | null;
}) {
  if (status === "betaald") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-dark">
        <span aria-hidden>✓</span>
        Betaald
        {betaald_op ? (
          <span className="font-normal text-muted">
            {formatDateShort(betaald_op)}
          </span>
        ) : null}
      </span>
    );
  }
  if (status === "goedgekeurd") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-dark">
        <span aria-hidden>✓</span>
        Te betalen
        {goedgekeurd_op ? (
          <span className="font-normal text-muted">
            {formatDateShort(goedgekeurd_op)}
          </span>
        ) : null}
      </span>
    );
  }
  if (status === "verzonden") {
    return (
      <span className="text-xs font-semibold text-[#854D0E]">
        Wacht op goedkeuring
      </span>
    );
  }
  if (status === "concept") {
    return (
      <span className="text-xs font-semibold text-muted">Te versturen</span>
    );
  }
  return <span className="text-xs capitalize text-muted">{status}</span>;
}

function KindBadge({ kind, label }: { kind: InvoiceKind; label: string }) {
  const cls =
    kind === "installatie"
      ? "border-green/25 bg-green-soft text-green-dark"
      : kind === "commissie_b"
        ? "border-green/25 bg-green-soft text-green-dark"
        : "border-line bg-wash text-muted";
  return (
    <span
      className={`border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

export function CreditfacturenPanel() {
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState<QueueFilter>("open");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("alles");

  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [allAdvFacturen, setAllAdvFacturen] = useState<OverviewFactuur[]>([]);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [allPartnerFacturen, setAllPartnerFacturen] = useState<
    PartnerOverview[]
  >([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [createKind, setCreateKind] = useState<CreateKind>("verkoper");
  const [createMode, setCreateMode] = useState<"handmatig" | "deal">(
    "handmatig"
  );
  const [createTranche, setCreateTranche] = useState<"a" | "b">("a");
  const [createAdviseurId, setCreateAdviseurId] = useState("");
  const [createPartnerId, setCreatePartnerId] = useState("");
  const [createBedrag, setCreateBedrag] = useState(
    String(VERKOPER_AANBETALING_FEE)
  );
  const [createOmschrijving, setCreateOmschrijving] = useState("");
  const [dealQuery, setDealQuery] = useState("");
  const [dealOptions, setDealOptions] = useState<
    {
      offerte_id: string;
      klant_naam: string;
      adviseur_id: string | null;
      adviseur_naam: string | null;
      offerte_nummer: string | null;
      bedrag_ex_btw: number;
      creditfactuur_id: string | null;
    }[]
  >([]);
  const [selectedOfferteId, setSelectedOfferteId] = useState("");
  const [dealsLoading, setDealsLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [advRes, partRes] = await Promise.all([
        fetch("/api/adviseurs/creditfacturen"),
        fetch("/api/partners/creditfacturen"),
      ]);
      const advData = await advRes.json().catch(() => ({}));
      const partData = await partRes.json().catch(() => ({}));
      if (!advRes.ok) {
        throw new Error(
          (advData as { error?: string }).error || "Adviseurs laden mislukt"
        );
      }
      if (!partRes.ok) {
        throw new Error(
          (partData as { error?: string }).error || "Partners laden mislukt"
        );
      }
      setAllAdvFacturen(
        ((advData as { facturen?: OverviewFactuur[] }).facturen ||
          []) as OverviewFactuur[]
      );
      setAdviseurs(
        ((advData as { adviseurs?: Adviseur[] }).adviseurs || []) as Adviseur[]
      );
      setAllPartnerFacturen(
        ((partData as { facturen?: PartnerOverview[] }).facturen ||
          []) as PartnerOverview[]
      );
      setPartners(
        ((partData as { partners?: InstallatiePartner[] }).partners ||
          []) as InstallatiePartner[]
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const loadDeals = useCallback(async (q: string) => {
    setDealsLoading(true);
    try {
      const sp = new URLSearchParams({ status: "alles" });
      if (q.trim()) sp.set("q", q.trim());
      const res = await fetch(`/api/netto-boord?${sp.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Deals laden mislukt"
        );
      }
      const items = (
        (data as {
          items?: {
            offerte_id: string;
            klant_naam: string;
            adviseur_id: string | null;
            adviseur_naam: string | null;
            offerte_nummer: string | null;
            bedrag_ex_btw: number;
            creditfactuur_id: string | null;
            geannuleerd?: boolean;
          }[];
        }).items || []
      ).filter((r) => !r.geannuleerd);
      setDealOptions(items.slice(0, 40));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deals laden mislukt");
    } finally {
      setDealsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showCreate || createKind !== "verkoper" || createMode !== "deal") {
      return;
    }
    const t = setTimeout(() => void loadDeals(dealQuery), 200);
    return () => clearTimeout(t);
  }, [showCreate, createKind, createMode, dealQuery, loadDeals]);

  const rows = useMemo((): InboxRow[] => {
    const out: InboxRow[] = [];

    for (const f of allAdvFacturen) {
      if (f.status === "geannuleerd") continue;
      const { kind, label } = parseKind("adviseur", f.factuur_nummer);
      const naam = f.adviseurs?.naam || "Onbekend";
      const context = extractContext({ notities: f.notities });
      out.push({
        key: `a:${f.id}`,
        source: "adviseur",
        id: f.id,
        relatieId: f.adviseur_id,
        relatieNaam: naam,
        kvkOk: !kvkIncompleet(f.adviseurs || {}),
        nummer: f.factuur_nummer,
        kind,
        kindLabel: label,
        context,
        bedragEx: Number(f.bedrag_ex_btw || 0),
        bedragInc: Number(f.bedrag_inc_btw || 0),
        status: f.status,
        goedgekeurd_op: f.goedgekeurd_op ?? null,
        betaald_op: f.betaald_op ?? null,
        factuurdatum: f.factuurdatum,
        searchText: [
          naam,
          f.factuur_nummer,
          f.notities,
          context,
          label,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      });
    }

    for (const f of allPartnerFacturen) {
      if (f.status === "geannuleerd") continue;
      const { kind, label } = parseKind("partner", f.factuur_nummer);
      const naam = f.installatie_partners?.naam || "Onbekend";
      const context = extractContext({
        notities: f.notities,
        omschrijving: f.omschrijving,
        offerte_nummer: f.offerte_nummer,
        project_nummer: f.project_nummer,
      });
      out.push({
        key: `p:${f.id}`,
        source: "partner",
        id: f.id,
        relatieId: f.partner_id,
        relatieNaam: naam,
        kvkOk: !kvkIncompleet(f.installatie_partners || {}),
        nummer: f.factuur_nummer,
        kind,
        kindLabel: label,
        context,
        bedragEx: Number(f.bedrag_ex_btw || 0),
        bedragInc: Number(f.bedrag_inc_btw || 0),
        status: f.status,
        goedgekeurd_op: f.goedgekeurd_op ?? null,
        betaald_op: f.betaald_op ?? null,
        factuurdatum: f.factuurdatum,
        searchText: [
          naam,
          f.factuur_nummer,
          f.notities,
          f.omschrijving,
          f.offerte_nummer,
          f.project_nummer,
          context,
          label,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      });
    }

    out.sort((a, b) => {
      const sr = statusRank(a.status) - statusRank(b.status);
      if (sr !== 0) return sr;
      return (b.factuurdatum || "").localeCompare(a.factuurdatum || "");
    });
    return out;
  }, [allAdvFacturen, allPartnerFacturen]);

  const kpis = useMemo(() => {
    const teVersturen = rows.filter((r) => r.status === "concept");
    const wacht = rows.filter((r) => r.status === "verzonden");
    const teBetalen = rows.filter((r) => r.status === "goedgekeurd");
    const open = [...teVersturen, ...wacht, ...teBetalen];
    return {
      teVersturen: teVersturen.length,
      wacht: wacht.length,
      teBetalen: teBetalen.length,
      openEuro: open.reduce((s, r) => s + r.bedragEx, 0),
    };
  }, [rows]);

  const q = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (typeFilter === "verkopers" && r.source !== "adviseur") return false;
      if (typeFilter === "installateurs" && r.source !== "partner") return false;

      if (queue === "open") {
        if (
          r.status !== "concept" &&
          r.status !== "verzonden" &&
          r.status !== "goedgekeurd"
        ) {
          return false;
        }
      } else if (queue === "te_versturen" && r.status !== "concept") {
        return false;
      } else if (queue === "wacht" && r.status !== "verzonden") {
        return false;
      } else if (queue === "te_betalen" && r.status !== "goedgekeurd") {
        return false;
      } else if (queue === "betaald" && r.status !== "betaald") {
        return false;
      }

      if (q && !r.searchText.includes(q) && !r.relatieNaam.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [rows, typeFilter, queue, q]);

  function resetCreateForm() {
    setCreateKind("verkoper");
    setCreateMode("handmatig");
    setCreateTranche("a");
    setCreateAdviseurId("");
    setCreatePartnerId("");
    setCreateBedrag(String(VERKOPER_AANBETALING_FEE));
    setCreateOmschrijving("");
    setDealQuery("");
    setSelectedOfferteId("");
    setDealOptions([]);
  }

  async function submitCreate() {
    setCreating(true);
    setError(null);
    setOkMsg(null);
    try {
      if (createKind === "partner") {
        if (!createPartnerId) throw new Error("Kies een installatiepartner.");
        const bedrag = Number(createBedrag.replace(",", "."));
        if (!Number.isFinite(bedrag) || bedrag <= 0) {
          throw new Error("Vul een geldig bedrag excl. btw in.");
        }
        const res = await fetch("/api/partners/creditfacturen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partner_id: createPartnerId,
            bedrag_ex_btw: bedrag,
            omschrijving: createOmschrijving.trim() || undefined,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (json as { error?: string }).error || "Aanmaken mislukt"
          );
        }
        const nummer =
          (json as { factuur?: { factuur_nummer?: string } }).factuur
            ?.factuur_nummer || "concept";
        setOkMsg(`Concept ${nummer} aangemaakt.`);
      } else if (createMode === "deal") {
        if (!selectedOfferteId) throw new Error("Selecteer een deal.");
        const bedragRaw = createBedrag.trim();
        const bedrag = Number(bedragRaw.replace(",", "."));
        let body: Record<string, unknown>;
        if (bedragRaw && Number.isFinite(bedrag) && bedrag > 0) {
          const deal = dealOptions.find(
            (d) => d.offerte_id === selectedOfferteId
          );
          const adviseurId = createAdviseurId || deal?.adviseur_id;
          if (!adviseurId) {
            throw new Error(
              "Deal heeft geen adviseur — kies er handmatig een."
            );
          }
          body = {
            offerte_id: selectedOfferteId,
            adviseur_id: adviseurId,
            bedrag_ex_btw: bedrag,
            omschrijving: createOmschrijving.trim() || undefined,
          };
        } else {
          body = { offerte_id: selectedOfferteId, tranche: createTranche };
        }
        const res = await fetch("/api/adviseurs/creditfacturen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (json as { error?: string }).error || "Aanmaken mislukt"
          );
        }
        const nummer =
          (json as { factuur?: { factuur_nummer?: string } }).factuur
            ?.factuur_nummer || "concept";
        const created = (json as { created?: boolean }).created !== false;
        const label =
          createTranche === "b" ? "Rest-commissie (B)" : "Aanbetalingscommissie (A)";
        setOkMsg(
          created
            ? `${label} ${nummer} aangemaakt.`
            : `${label} ${nummer} bestond al voor deze deal.`
        );
      } else {
        if (!createAdviseurId) throw new Error("Kies een verkoper.");
        const bedrag = Number(createBedrag.replace(",", "."));
        if (!Number.isFinite(bedrag) || bedrag <= 0) {
          throw new Error("Vul een geldig bedrag excl. btw in.");
        }
        const res = await fetch("/api/adviseurs/creditfacturen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adviseur_id: createAdviseurId,
            bedrag_ex_btw: bedrag,
            omschrijving: createOmschrijving.trim() || undefined,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (json as { error?: string }).error || "Aanmaken mislukt"
          );
        }
        const nummer =
          (json as { factuur?: { factuur_nummer?: string } }).factuur
            ?.factuur_nummer || "concept";
        setOkMsg(`Concept ${nummer} aangemaakt.`);
      }
      setShowCreate(false);
      resetCreateForm();
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aanmaken mislukt");
    } finally {
      setCreating(false);
    }
  }

  async function patchStatus(
    row: InboxRow,
    status: "verzonden" | "betaald"
  ) {
    setBusyId(row.key);
    setError(null);
    setOkMsg(null);
    try {
      const url =
        row.source === "adviseur"
          ? "/api/adviseurs/creditfacturen"
          : "/api/partners/creditfacturen";
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Bijwerken mislukt");
      if (status === "verzonden") {
        setOkMsg(`Factuur ${json.factuur.factuur_nummer} verstuurd.`);
      } else {
        setOkMsg(
          `Factuur ${json.factuur.factuur_nummer} gemarkeerd als betaald.`
        );
      }
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bijwerken mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function downloadPdf(row: InboxRow) {
    setBusyId(`pdf-${row.key}`);
    try {
      const url =
        row.source === "adviseur"
          ? `/api/adviseurs/creditfacturen/${row.id}/pdf`
          : `/api/partners/creditfacturen/${row.id}/pdf`;
      const res = await fetch(url);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string }).error || "PDF download mislukt"
        );
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${row.nummer.replace(/\//g, "-")}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download mislukt");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">
              Uitbetalingen
            </h2>
            <p className="mt-1 text-sm text-muted">
              Versturen, goedkeuring en betalen — verkopers &amp;
              installatiepartners
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowCreate((v) => !v);
              setError(null);
              setOkMsg(null);
              if (showCreate) resetCreateForm();
            }}
            className="bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-deeper"
          >
            {showCreate ? "Sluiten" : "Nieuwe factuur"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
          {(
            [
              ["Te versturen", String(kpis.teVersturen), "te_versturen"],
              ["Wacht goedkeuring", String(kpis.wacht), "wacht"],
              ["Te betalen", String(kpis.teBetalen), "te_betalen"],
              ["Open excl.", formatEuro(kpis.openEuro), "open"],
            ] as const
          ).map(([label, value, qId]) => (
            <button
              key={qId}
              type="button"
              onClick={() => setQueue(qId)}
              className={[
                "bg-white px-4 py-3 text-left transition",
                queue === qId ? "ring-2 ring-inset ring-green" : "hover:bg-wash",
              ].join(" ")}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                {label}
              </p>
              <p className="mt-1 font-display text-lg font-semibold tabular-nums text-ink">
                {value}
              </p>
            </button>
          ))}
        </div>

        {showCreate ? (
          <div className="space-y-3 border-b border-line bg-wash/40 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreateKind("verkoper");
                  setCreateMode("handmatig");
                  setCreateBedrag(String(VERKOPER_AANBETALING_FEE));
                }}
                className={[
                  "px-3 py-1.5 text-xs font-semibold",
                  createKind === "verkoper"
                    ? "bg-ink text-white"
                    : "border border-line bg-white text-muted hover:bg-wash",
                ].join(" ")}
              >
                Verkoper
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateKind("partner");
                  setCreateBedrag("");
                }}
                className={[
                  "px-3 py-1.5 text-xs font-semibold",
                  createKind === "partner"
                    ? "bg-ink text-white"
                    : "border border-line bg-white text-muted hover:bg-wash",
                ].join(" ")}
              >
                Installatiepartner
              </button>
            </div>

            {createKind === "verkoper" ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCreateMode("handmatig");
                      setCreateBedrag(String(VERKOPER_AANBETALING_FEE));
                    }}
                    className={[
                      "px-3 py-1.5 text-xs font-semibold",
                      createMode === "handmatig"
                        ? "bg-green text-white"
                        : "border border-line bg-white text-muted hover:bg-wash",
                    ].join(" ")}
                  >
                    Handmatig
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreateMode("deal");
                      setCreateBedrag("");
                    }}
                    className={[
                      "px-3 py-1.5 text-xs font-semibold",
                      createMode === "deal"
                        ? "bg-green text-white"
                        : "border border-line bg-white text-muted hover:bg-wash",
                    ].join(" ")}
                  >
                    Vanuit deal
                  </button>
                </div>

                {createMode === "handmatig" ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Verkoper
                      <select
                        value={createAdviseurId}
                        onChange={(e) => setCreateAdviseurId(e.target.value)}
                        className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                      >
                        <option value="">Kies…</option>
                        {adviseurs.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.naam}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Bedrag excl. btw
                      <input
                        type="text"
                        inputMode="decimal"
                        value={createBedrag}
                        onChange={(e) => setCreateBedrag(e.target.value)}
                        className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                      />
                    </label>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted sm:col-span-2">
                      Omschrijving (optioneel)
                      <input
                        type="text"
                        value={createOmschrijving}
                        onChange={(e) => setCreateOmschrijving(e.target.value)}
                        className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Zoek deal
                      <input
                        type="search"
                        value={dealQuery}
                        onChange={(e) => setDealQuery(e.target.value)}
                        placeholder="Klant, plaats of offertenr…"
                        className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green sm:max-w-md"
                      />
                    </label>
                    <div className="max-h-48 overflow-y-auto border border-line bg-white">
                      {dealsLoading ? (
                        <p className="px-3 py-4 text-sm text-muted">Laden…</p>
                      ) : dealOptions.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-muted">
                          Geen deals gevonden.
                        </p>
                      ) : (
                        <ul className="divide-y divide-line">
                          {dealOptions.map((d) => {
                            const selected =
                              selectedOfferteId === d.offerte_id;
                            return (
                              <li key={d.offerte_id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedOfferteId(d.offerte_id);
                                    if (d.adviseur_id) {
                                      setCreateAdviseurId(d.adviseur_id);
                                    }
                                  }}
                                  className={[
                                    "flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-sm",
                                    selected
                                      ? "bg-green-soft"
                                      : "hover:bg-wash",
                                  ].join(" ")}
                                >
                                  <span>
                                    <span className="font-medium text-ink">
                                      {d.klant_naam}
                                    </span>
                                    <span className="mt-0.5 block text-xs text-muted">
                                      {d.offerte_nummer || "Offerte"}
                                      {d.adviseur_naam
                                        ? ` · ${d.adviseur_naam}`
                                        : ""}
                                      {` · ${formatEuro(d.bedrag_ex_btw)} excl.`}
                                    </span>
                                  </span>
                                  {selected ? (
                                    <span className="shrink-0 text-xs font-semibold text-green-dark">
                                      Gekozen
                                    </span>
                                  ) : null}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <div className="sm:max-w-xs">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Soort commissie
                      </p>
                      <div className="mt-1 inline-flex border border-line">
                        <button
                          type="button"
                          onClick={() => setCreateTranche("a")}
                          className={[
                            "px-3 py-1.5 text-xs font-semibold",
                            createTranche === "a"
                              ? "bg-ink text-white"
                              : "bg-white text-muted hover:bg-wash",
                          ].join(" ")}
                        >
                          A · aanbetaling
                        </button>
                        <button
                          type="button"
                          onClick={() => setCreateTranche("b")}
                          className={[
                            "px-3 py-1.5 text-xs font-semibold",
                            createTranche === "b"
                              ? "bg-ink text-white"
                              : "bg-white text-muted hover:bg-wash",
                          ].join(" ")}
                        >
                          B · rest / netto
                        </button>
                      </div>
                    </div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted sm:max-w-xs">
                      Bedrag excl. (leeg = automatisch)
                      <input
                        type="text"
                        inputMode="decimal"
                        value={createBedrag}
                        onChange={(e) => setCreateBedrag(e.target.value)}
                        placeholder={
                          createTranche === "b"
                            ? "10% − €250"
                            : `€${VERKOPER_AANBETALING_FEE}`
                        }
                        className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                      />
                    </label>
                  </div>
                )}
              </>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Installatiepartner
                  <select
                    value={createPartnerId}
                    onChange={(e) => setCreatePartnerId(e.target.value)}
                    className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                  >
                    <option value="">Kies…</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.naam}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Bedrag excl. btw
                  <input
                    type="text"
                    inputMode="decimal"
                    value={createBedrag}
                    onChange={(e) => setCreateBedrag(e.target.value)}
                    className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                  />
                </label>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Omschrijving (optioneel)
                  <input
                    type="text"
                    value={createOmschrijving}
                    onChange={(e) => setCreateOmschrijving(e.target.value)}
                    className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink outline-none focus:border-green"
                  />
                </label>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={creating}
                onClick={() => void submitCreate()}
                className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-50"
              >
                {creating ? "Bezig…" : "Maak concept"}
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => {
                  setShowCreate(false);
                  resetCreateForm();
                }}
                className="border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50"
              >
                Annuleren
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="relative w-full sm:max-w-md">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted/50">
              ⌕
            </span>
            <input
              type="search"
              inputMode="search"
              placeholder="Zoek relatie, factuurnr, klant, project…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-line bg-white py-2.5 pl-8 pr-3 text-sm outline-none transition placeholder:text-muted/60 focus:border-green"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex border border-line p-0.5">
              {(
                [
                  ["open", "Open"],
                  ["te_versturen", "Te versturen"],
                  ["wacht", "Wacht"],
                  ["te_betalen", "Te betalen"],
                  ["betaald", "Betaald"],
                  ["alles", "Alles"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setQueue(id)}
                  className={[
                    "px-2.5 py-1.5 text-[11px] font-semibold",
                    queue === id
                      ? "bg-green text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex border border-line p-0.5">
              {(
                [
                  ["alles", "Alles"],
                  ["verkopers", "Verkopers"],
                  ["installateurs", "Installateurs"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTypeFilter(id)}
                  className={[
                    "px-2.5 py-1.5 text-[11px] font-semibold",
                    typeFilter === id
                      ? "bg-ink text-white"
                      : "bg-white text-muted hover:bg-wash",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
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

        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-muted">Laden…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            {q || queue !== "open" || typeFilter !== "alles"
              ? "Geen facturen voor deze filter."
              : "Geen openstaande uitbetalingen. Concepten worden woensdag verstuurd (vorige week: aanbetalingen + netto sales)."}
          </p>
        ) : (
          <>
            <div className="border-b border-line px-4 py-2 text-xs text-muted sm:px-5">
              {filtered.length} factuur{filtered.length === 1 ? "" : "en"}
              {q ? ` · zoek: “${search.trim()}”` : ""}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 sm:px-5">Relatie</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="px-3 py-2.5">Deal / project</th>
                    <th className="px-3 py-2.5 text-right">Excl.</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right sm:px-5">Acties</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((r) => {
                    const busy = busyId === r.key || busyId === `pdf-${r.key}`;
                    return (
                      <tr key={r.key} className="hover:bg-wash/60">
                        <td className="px-4 py-3 sm:px-5">
                          <p className="font-medium text-ink">
                            {r.relatieNaam}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted">
                            {r.nummer}
                            {!r.kvkOk ? (
                              <span className="ml-2 font-semibold text-[#C45A12]">
                                KvK incompleet
                              </span>
                            ) : null}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <KindBadge kind={r.kind} label={r.kindLabel} />
                        </td>
                        <td className="max-w-[14rem] px-3 py-3 text-xs text-muted">
                          {r.context || "—"}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <p className="font-semibold tabular-nums text-ink">
                            {formatEuro(r.bedragEx)}
                          </p>
                          <p className="text-[10px] tabular-nums text-muted">
                            {formatEuro(r.bedragInc)} inc.
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge
                            status={r.status}
                            goedgekeurd_op={r.goedgekeurd_op}
                            betaald_op={r.betaald_op}
                          />
                        </td>
                        <td className="px-4 py-3 text-right sm:px-5">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void downloadPdf(r)}
                              className="border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-60"
                            >
                              PDF
                            </button>
                            {r.status === "concept" ||
                            r.status === "verzonden" ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void patchStatus(r, "verzonden")}
                                className="bg-orange px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                              >
                                {r.status === "verzonden"
                                  ? "Opnieuw"
                                  : "Verstuur"}
                              </button>
                            ) : null}
                            {r.status === "goedgekeurd" ||
                            r.status === "verzonden" ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void patchStatus(r, "betaald")}
                                className="bg-green px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                              >
                                Betaald
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
          </>
        )}
      </div>
    </div>
  );
}
