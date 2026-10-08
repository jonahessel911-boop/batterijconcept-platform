"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { InstallatiePartner, ServiceVerzoek } from "@/types/database";
import { adresRegel, formatDateTimeNl, formatTimeNl } from "@/lib/format";
import { projectStatusLabel } from "@/lib/labels";

type Filter = "open" | "afgehandeld" | "alles";

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dagenOpen(iso: string): number {
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 86_400_000));
}

function partnerNaam(p: ServiceVerzoek["projecten"]): string | null {
  if (!p?.installatie_partners) return null;
  const raw = p.installatie_partners;
  const one = Array.isArray(raw) ? raw[0] : raw;
  return one?.naam || null;
}

function leadAdres(lead: ServiceVerzoek["leads"]): string | null {
  if (!lead) return null;
  return adresRegel(lead) || null;
}

/** Notitie van monteur na service (planbord) of algemene installateursnotitie. */
function monteurNotities(v: ServiceVerzoek): {
  service: string | null;
  algemeen: string | null;
  door: string | null;
} {
  const service = v.projecten?.service_notities?.trim() || null;
  const algemeen = v.projecten?.installateur_notitie?.trim() || null;
  const door = v.projecten?.installateur_notitie_door?.trim() || null;
  return { service, algemeen, door };
}

export function ServiceVerzoekenPanel() {
  const [verzoeken, setVerzoeken] = useState<ServiceVerzoek[]>([]);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planAt, setPlanAt] = useState("");
  const [planPartnerId, setPlanPartnerId] = useState("");
  const [planNotes, setPlanNotes] = useState("");
  const [afhandelNotitie, setAfhandelNotitie] = useState("");
  const [showReplan, setShowReplan] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [vRes, pRes] = await Promise.all([
        fetch("/api/service-verzoeken"),
        fetch("/api/installatie-partners"),
      ]);
      const vData = await vRes.json().catch(() => ({}));
      const pData = await pRes.json().catch(() => ({}));
      if (!vRes.ok) throw new Error(vData.error || "Laden mislukt");
      const list = (vData.verzoeken as ServiceVerzoek[]) || [];
      setVerzoeken(list);
      setPartners(
        ((pData.partners as InstallatiePartner[]) || []).filter(
          (p) => p.actief !== false
        )
      );
      setSelectedId((prev) => {
        if (prev && list.some((v) => v.id === prev)) return prev;
        const firstOpen = list.find((v) => v.status === "open");
        return firstOpen?.id || list[0]?.id || null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setVerzoeken([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return verzoeken.filter((v) => {
      if (filter === "open" && v.status !== "open") return false;
      if (filter === "afgehandeld" && v.status !== "afgehandeld") return false;
      if (!needle) return true;
      const hay = [
        v.onderwerp,
        v.omschrijving,
        v.klant_email,
        v.leads?.naam,
        v.leads?.lead_number,
        v.leads?.plaats,
        v.leads?.telefoon,
        v.projecten?.project_nummer,
        v.projecten?.titel,
        v.projecten?.service_notities,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [verzoeken, filter, q]);

  const counts = useMemo(() => {
    const open = verzoeken.filter((v) => v.status === "open");
    const urgent = open.filter((v) => dagenOpen(v.created_at) >= 3).length;
    const gepland = open.filter((v) => Boolean(v.projecten?.service_at)).length;
    return {
      open: open.length,
      urgent,
      gepland,
      afgehandeld: verzoeken.filter((v) => v.status === "afgehandeld").length,
      alles: verzoeken.length,
    };
  }, [verzoeken]);

  const selected = useMemo(
    () => filtered.find((v) => v.id === selectedId) || null,
    [filtered, selectedId]
  );

  useEffect(() => {
    if (!selected) return;
    const existingAt = selected.projecten?.service_at;
    if (existingAt) {
      setPlanAt(toDatetimeLocalValue(new Date(existingAt)));
      setShowReplan(false);
    } else {
      const d = new Date();
      d.setHours(9, 0, 0, 0);
      if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
      setPlanAt(toDatetimeLocalValue(d));
      setShowReplan(true);
    }
    setPlanPartnerId(selected.projecten?.installatie_partner_id || "");
    setPlanNotes(
      selected.projecten?.service_notities?.trim() ||
        selected.onderwerp ||
        ""
    );
    setAfhandelNotitie(selected.interne_notitie || "");
    setOkMsg(null);
    setError(null);
  }, [selected?.id]);

  async function submitPlan(v: ServiceVerzoek) {
    if (!planAt.trim()) {
      setError("Kies datum + tijd");
      return;
    }
    if (!planPartnerId) {
      setError("Kies een installatiepartner");
      return;
    }
    const parsed = new Date(planAt);
    if (Number.isNaN(parsed.getTime())) {
      setError("Ongeldige datum");
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/projecten/${v.project_id}/service`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_at: parsed.toISOString(),
          installatie_partner_id: planPartnerId,
          service_notities: planNotes.trim() || null,
          service_verzoek_id: v.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Inplannen mislukt");
      setOkMsg(
        `Ingepland · ${formatDateTimeNl(parsed.toISOString())} · zichtbaar op Planbord`
      );
      setShowReplan(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inplannen mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function afhandelen(id: string) {
    const note = afhandelNotitie.trim();
    if (!note) {
      setError("Notitie is verplicht bij afhandelen");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-verzoeken/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "afgehandeld",
          interne_notitie: note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Afhandelen mislukt");
      setOkMsg("Ticket afgehandeld.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Afhandelen mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            { label: "Open", value: counts.open, tone: "text-ink" },
            {
              label: "Urgent (≥3d)",
              value: counts.urgent,
              tone: counts.urgent > 0 ? "text-[#C45A12]" : "text-ink",
            },
            {
              label: "Ingepland",
              value: counts.gepland,
              tone: "text-[#C45A12]",
            },
            {
              label: "Afgehandeld",
              value: counts.afgehandeld,
              tone: "text-[#0D5C32]",
            },
          ] as const
        ).map((kpi) => (
          <div key={kpi.label} className="border border-line bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              {kpi.label}
            </p>
            <p
              className={`mt-1 font-display text-2xl font-semibold tabular-nums ${kpi.tone}`}
            >
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex border border-line bg-white">
          {(
            [
              ["open", "Wachtrij", counts.open],
              ["afgehandeld", "Klaar", counts.afgehandeld],
              ["alles", "Alles", counts.alles],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={[
                "px-3.5 py-2 text-xs font-semibold",
                filter === id
                  ? "bg-[#0a4727] text-white"
                  : "text-muted hover:bg-wash hover:text-ink",
              ].join(" ")}
            >
              {label}
              <span
                className={[
                  "ml-1.5 tabular-nums",
                  filter === id ? "text-white/70" : "text-muted",
                ].join(" ")}
              >
                {n}
              </span>
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Zoek klant, project, plaats, onderwerp…"
          className="w-full max-w-sm border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green sm:w-80"
        />
      </div>

      {error ? (
        <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {okMsg ? (
        <p className="border border-green/30 bg-green-soft px-3 py-2 text-sm text-green-dark">
          {okMsg}
        </p>
      ) : null}

      <div className="grid min-h-[28rem] gap-3 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.2fr)]">
        {/* Lijst */}
        <div className="flex min-h-0 flex-col border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              Tickets
            </p>
            <p className="text-[11px] tabular-nums text-muted">
              {filtered.length}
            </p>
          </div>

          {loading ? (
            <p className="px-5 py-16 text-center text-sm text-muted">Laden…</p>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="font-display text-base font-semibold text-ink">
                Geen tickets
              </p>
              <p className="mt-1 text-sm text-muted">
                {filter === "open"
                  ? "Wachtrij is leeg."
                  : "Geen resultaten in deze filter."}
              </p>
            </div>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
              {filtered.map((v) => {
                const days = dagenOpen(v.created_at);
                const active = selectedId === v.id;
                const lead = v.leads;
                const project = v.projecten;
                const urgent = v.status === "open" && days >= 3;
                const gepland = Boolean(project?.service_at);
                const monteur = monteurNotities(v);
                const heeftMonteurNote = Boolean(
                  monteur.service || monteur.algemeen
                );
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(v.id);
                        setError(null);
                      }}
                      className={[
                        "flex w-full gap-3 px-4 py-3 text-left transition-colors",
                        active
                          ? "bg-[#0a4727]/[0.05] ring-inset ring-1 ring-[#0a4727]/25"
                          : "hover:bg-wash/80",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "mt-1 h-10 w-1 shrink-0",
                          v.status === "afgehandeld"
                            ? "bg-[#0D5C32]"
                            : urgent
                              ? "bg-[#C45A12]"
                              : gepland
                                ? "bg-[#EA580C]"
                                : "bg-line",
                        ].join(" ")}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-sm font-semibold text-ink">
                            {v.onderwerp}
                          </p>
                          {v.status === "afgehandeld" ? (
                            <span className="shrink-0 bg-[#E8F6EC] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0D5C32]">
                              Klaar
                            </span>
                          ) : urgent ? (
                            <span className="shrink-0 bg-[#C45A12] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                              {days}d
                            </span>
                          ) : gepland ? (
                            <span className="shrink-0 bg-[#FFF0E6] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#C45A12]">
                              Gepland
                            </span>
                          ) : (
                            <span className="shrink-0 bg-wash px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                              Nieuw
                            </span>
                          )}
                          {heeftMonteurNote ? (
                            <span className="shrink-0 bg-[#E8F5EE] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0D5C32]">
                              Monteur
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-sm text-ink/80">
                          {lead?.naam || "Onbekende klant"}
                          {lead?.plaats ? ` · ${lead.plaats}` : ""}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {project?.project_nummer || "—"}
                          {gepland && project?.service_at
                            ? ` · ${formatDateTimeNl(project.service_at)}`
                            : ` · ${formatDateTimeNl(v.created_at)}`}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Detail */}
        <div className="border border-line bg-white lg:sticky lg:top-20 lg:self-start">
          {!selected ? (
            <div className="px-5 py-16 text-center">
              <p className="font-display text-base font-semibold text-ink">
                Selecteer een ticket
              </p>
              <p className="mt-1 text-sm text-muted">
                Plan in, bekijk monteur-notitie, rond af.
              </p>
            </div>
          ) : (
            <DetailPanel
              selected={selected}
              partners={partners}
              planAt={planAt}
              setPlanAt={setPlanAt}
              planPartnerId={planPartnerId}
              setPlanPartnerId={setPlanPartnerId}
              planNotes={planNotes}
              setPlanNotes={setPlanNotes}
              afhandelNotitie={afhandelNotitie}
              setAfhandelNotitie={setAfhandelNotitie}
              showReplan={showReplan}
              setShowReplan={setShowReplan}
              busy={busy}
              onPlan={() => void submitPlan(selected)}
              onAfhandelen={() => void afhandelen(selected.id)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function DetailPanel({
  selected,
  partners,
  planAt,
  setPlanAt,
  planPartnerId,
  setPlanPartnerId,
  planNotes,
  setPlanNotes,
  afhandelNotitie,
  setAfhandelNotitie,
  showReplan,
  setShowReplan,
  busy,
  onPlan,
  onAfhandelen,
}: {
  selected: ServiceVerzoek;
  partners: InstallatiePartner[];
  planAt: string;
  setPlanAt: (v: string) => void;
  planPartnerId: string;
  setPlanPartnerId: (v: string) => void;
  planNotes: string;
  setPlanNotes: (v: string) => void;
  afhandelNotitie: string;
  setAfhandelNotitie: (v: string) => void;
  showReplan: boolean;
  setShowReplan: (v: boolean) => void;
  busy: boolean;
  onPlan: () => void;
  onAfhandelen: () => void;
}) {
  const gepland = Boolean(selected.projecten?.service_at);
  const monteur = monteurNotities(selected);
  const heeftMonteurNote = Boolean(monteur.service || monteur.algemeen);
  const isOpen = selected.status === "open";
  const canClose = afhandelNotitie.trim().length > 0;

  return (
    <div className="flex flex-col">
      <div className="border-b border-line bg-[#0a4727] px-5 py-4 text-white">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
              Service-ticket
            </p>
            <h3 className="mt-1 font-display text-lg font-semibold leading-snug">
              {selected.onderwerp}
            </h3>
            <p className="mt-1 text-sm text-white/75">
              {selected.leads?.naam || "Klant"}
              {selected.projecten?.project_nummer
                ? ` · ${selected.projecten.project_nummer}`
                : ""}
            </p>
          </div>
          <span
            className={[
              "shrink-0 px-2 py-1 text-[10px] font-bold uppercase tracking-wide",
              !isOpen
                ? "bg-white/15 text-white"
                : gepland
                  ? "bg-[#EA580C] text-white"
                  : "bg-white/20 text-white",
            ].join(" ")}
          >
            {!isOpen ? "Afgehandeld" : gepland ? "Ingepland" : "Te plannen"}
          </span>
        </div>

        {/* Status-stappen */}
        <ol className="mt-4 grid grid-cols-3 gap-1 text-[10px] font-semibold uppercase tracking-wide">
          {(
            [
              { label: "Ticket", done: true },
              { label: "Gepland", done: gepland || !isOpen },
              {
                label: "Afgerond",
                done: !isOpen || heeftMonteurNote,
              },
            ] as const
          ).map((step, i) => (
            <li
              key={step.label}
              className={[
                "px-2 py-1.5 text-center",
                step.done ? "bg-white/15 text-white" : "bg-black/20 text-white/50",
              ].join(" ")}
            >
              {i + 1}. {step.label}
            </li>
          ))}
        </ol>
      </div>

      <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
        {/* Klant + project compact */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="border border-line bg-wash/40 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              Klant
            </p>
            <p className="mt-1 text-sm font-semibold text-ink">
              {selected.leads?.naam || "—"}
            </p>
            {leadAdres(selected.leads) ? (
              <p className="mt-0.5 text-xs leading-snug text-muted">
                {leadAdres(selected.leads)}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {selected.leads?.telefoon ? (
                <a
                  href={`tel:${selected.leads.telefoon}`}
                  className="bg-[#0D9488] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0F766E]"
                >
                  Bel
                </a>
              ) : null}
              {(selected.leads?.email || selected.klant_email) && (
                <a
                  href={`mailto:${selected.leads?.email || selected.klant_email}`}
                  className="border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                >
                  Mail
                </a>
              )}
              <Link
                href={`/projecten/${selected.project_id}?from=orders`}
                className="border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
              >
                Project
              </Link>
            </div>
          </div>
          <div className="border border-line bg-wash/40 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              Project
            </p>
            <p className="mt-1 text-sm font-semibold text-ink">
              {selected.projecten?.project_nummer || "—"}
            </p>
            {selected.projecten?.status ? (
              <p className="mt-0.5 text-xs text-muted">
                {projectStatusLabel[selected.projecten.status] ||
                  selected.projecten.status}
              </p>
            ) : null}
            {partnerNaam(selected.projecten) ? (
              <p className="mt-0.5 text-xs text-muted">
                Partner · {partnerNaam(selected.projecten)}
              </p>
            ) : null}
            {gepland && selected.projecten?.service_at ? (
              <p className="mt-2 text-xs font-semibold text-[#C45A12]">
                Service · {formatDateTimeNl(selected.projecten.service_at)}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted">Nog niet ingepland</p>
            )}
          </div>
        </div>

        {/* Melding klant */}
        {selected.omschrijving ? (
          <section className="border border-line px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              Melding van de klant
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {selected.omschrijving}
            </p>
          </section>
        ) : null}

        {/* Notitie installateur — prominent */}
        <section
          className={[
            "border px-3 py-3",
            heeftMonteurNote
              ? "border-[#B7D9C4] bg-[#F4FBF7]"
              : "border-dashed border-line bg-wash/30",
          ].join(" ")}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              Notitie van de installateur
            </p>
            {heeftMonteurNote ? (
              <span className="text-[10px] font-bold uppercase tracking-wide text-[#0D5C32]">
                Ontvangen
              </span>
            ) : (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Nog leeg
              </span>
            )}
          </div>
          {monteur.service ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {monteur.service}
            </p>
          ) : null}
          {monteur.algemeen && monteur.algemeen !== monteur.service ? (
            <div className="mt-2 border-t border-[#B7D9C4]/60 pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Installateursnotitie
                {monteur.door ? ` · ${monteur.door}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {monteur.algemeen}
              </p>
            </div>
          ) : null}
          {!heeftMonteurNote ? (
            <p className="mt-2 text-sm text-muted">
              Na de service vinkt de monteur af op het Planbord — dan verschijnt
              hier de notitie.
            </p>
          ) : null}
        </section>

        {/* Planning */}
        {isOpen ? (
          <section className="border border-line px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Inplannen op planbord
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Verschijnt als terracotta service-blok
                </p>
              </div>
              {gepland && !showReplan ? (
                <button
                  type="button"
                  onClick={() => setShowReplan(true)}
                  className="text-xs font-semibold text-[#C45A12] hover:underline"
                >
                  Herplannen
                </button>
              ) : null}
            </div>

            {gepland && !showReplan ? (
              <div className="mt-3 border border-[#FDBA74]/50 bg-[#FFF7ED] px-3 py-2.5">
                <p className="text-sm font-semibold text-[#9A4510]">
                  {formatDateTimeNl(selected.projecten!.service_at!)}
                </p>
                <p className="mt-0.5 text-xs text-[#9A4510]/90">
                  {partnerNaam(selected.projecten) || "Partner"}
                  {selected.projecten?.service_notities
                    ? ` · ${selected.projecten.service_notities}`
                    : ""}
                </p>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Datum + tijd
                    </span>
                    <input
                      type="datetime-local"
                      value={planAt}
                      onChange={(e) => setPlanAt(e.target.value)}
                      className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Installatiepartner
                    </span>
                    <select
                      value={planPartnerId}
                      onChange={(e) => setPlanPartnerId(e.target.value)}
                      className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                    >
                      <option value="">Kies partner…</option>
                      {partners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.naam}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Werkbon voor monteur
                  </span>
                  <textarea
                    value={planNotes}
                    onChange={(e) => setPlanNotes(e.target.value)}
                    rows={2}
                    placeholder="Wat moet de monteur doen…"
                    className="mt-1.5 w-full resize-y border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || !planAt || !planPartnerId}
                    onClick={onPlan}
                    className="flex-1 bg-[#C45A12] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#9A4510] disabled:opacity-50"
                  >
                    {busy
                      ? "Bezig…"
                      : planAt
                        ? `${gepland ? "Herplan" : "Plan in"} · ${formatTimeNl(new Date(planAt).toISOString())}`
                        : "Plan in"}
                  </button>
                  {gepland && showReplan ? (
                    <button
                      type="button"
                      onClick={() => setShowReplan(false)}
                      className="border border-line px-3 py-2.5 text-sm font-semibold text-muted hover:bg-wash"
                    >
                      Annuleer
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </section>
        ) : null}

        {/* Afhandelen */}
        <section className="border border-line px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            {isOpen ? "Afhandelen" : "Afgehandeld"}
          </p>
          {isOpen ? (
            <>
              <label className="mt-2 block">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Interne notitie *
                </span>
                <textarea
                  value={afhandelNotitie}
                  onChange={(e) => setAfhandelNotitie(e.target.value)}
                  rows={2}
                  placeholder={
                    heeftMonteurNote
                      ? "Bevestig of vul aan wat er gedaan is…"
                      : "Wat is gedaan / bevindingen…"
                  }
                  className="mt-1.5 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                />
              </label>
              {!canClose ? (
                <p className="mt-1.5 text-xs text-muted">
                  Vul een notitie in om af te handelen.
                </p>
              ) : null}
              <button
                type="button"
                disabled={busy || !canClose}
                onClick={onAfhandelen}
                className="mt-3 w-full bg-[#0D5C32] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0a4727] disabled:opacity-50"
              >
                {busy ? "Bezig…" : "Markeer afgehandeld"}
              </button>
            </>
          ) : (
            <div className="mt-2">
              <p className="text-xs font-semibold text-[#0D5C32]">
                Afgehandeld
                {selected.afgehandeld_op
                  ? ` · ${formatDateTimeNl(selected.afgehandeld_op)}`
                  : ""}
              </p>
              {selected.interne_notitie ? (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {selected.interne_notitie}
                </p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
