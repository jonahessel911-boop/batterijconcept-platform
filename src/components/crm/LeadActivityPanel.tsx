"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  Afspraak,
  Factuur,
  LeadEvent,
  Offerte,
  Project,
} from "@/types/database";
import { formatDateTimeNl, formatEuro } from "@/lib/format";
import { afspraakSoortLabel, normalizeAfspraakSoort } from "@/lib/afspraak-soort";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";

type ActivityKind =
  | "notitie"
  | "status"
  | "bel"
  | "afspraak"
  | "offerte"
  | "offerte_getekend"
  | "factuur"
  | "schouw"
  | "installatie"
  | "project"
  | "overig";

type ActivityItem = {
  id: string;
  at: string;
  kind: ActivityKind;
  titel: string;
  detail?: string | null;
  action?:
    | { type: "offerte_sign"; href: string; label: string }
    | { type: "offerte_crm"; href: string; label: string }
    | { type: "factuur_pdf"; factuurId: string; filename: string; label: string }
    | { type: "link"; href: string; label: string };
};

const KIND_LABEL: Record<ActivityKind, string> = {
  notitie: "Notitie",
  status: "Status",
  bel: "Bellen",
  afspraak: "Afspraak",
  offerte: "Offerte",
  offerte_getekend: "Offerte getekend",
  factuur: "Factuur",
  schouw: "Schouw",
  installatie: "Installatie",
  project: "Backoffice",
  overig: "Overig",
};

const PROJECT_STATUS_LABEL: Record<string, string> = {
  schouw_aanbetaling: "Schouw + aanbetaling",
  aanbetaling_betaald: "Aanbetaling betaald",
  schouw_in_afwachting: "Schouw in afwachting",
  schouw_voltooid: "Schouw voltooid",
  restfactuur_verstuurd: "Restfactuur verstuurd",
  restfactuur_betaald: "Restfactuur betaald",
  materiaal_installatie: "Materiaal + installatie plannen",
  installatie_voltooid: "Installatie voltooid",
  service: "Service / nazorg",
};

function kindTone(kind: ActivityKind): string {
  if (kind === "offerte_getekend" || kind === "installatie") {
    return "border-green";
  }
  if (kind === "factuur" || kind === "offerte") return "border-orange";
  if (kind === "notitie") return "border-orange";
  if (kind === "schouw" || kind === "afspraak") return "border-green";
  return "border-line";
}

function buildFromEntities(opts: {
  events: LeadEvent[];
  offertes: Offerte[];
  facturen: Factuur[];
  projecten: Project[];
  afspraken: Afspraak[];
}): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const ev of opts.events) {
    const soort = (ev.soort || "overig") as ActivityKind;
    const kind: ActivityKind =
      soort === "notitie" ||
      soort === "status" ||
      soort === "bel" ||
      soort === "afspraak"
        ? soort
        : "overig";
    items.push({
      id: `ev-${ev.id}`,
      at: ev.created_at,
      kind,
      titel: ev.titel,
      detail: ev.detail,
    });
  }

  for (const o of opts.offertes) {
    items.push({
      id: `off-create-${o.id}`,
      at: o.created_at,
      kind: "offerte",
      titel: `Offerte ${o.offerte_nummer} aangemaakt`,
      detail: `${formatEuro(o.subtotaal_ex_btw)} excl. btw · ${o.status}`,
      action: o.sign_token
        ? {
            type: "offerte_sign",
            href: `/offerte/${o.sign_token}`,
            label: "Open ondertekenlink",
          }
        : {
            type: "offerte_crm",
            href: `/offertes/${o.id}`,
            label: "Open offerte",
          },
    });

    if (o.status === "ondertekend" && o.ondertekend_op) {
      items.push({
        id: `off-sign-${o.id}`,
        at: o.ondertekend_op,
        kind: "offerte_getekend",
        titel: `Offerte ${o.offerte_nummer} getekend`,
        detail: o.ondertekend_naam
          ? `Getekend door ${o.ondertekend_naam}`
          : null,
        action: {
          type: "offerte_crm",
          href: `/offertes/${o.id}`,
          label: "Bekijk offerte",
        },
      });
    }
  }

  for (const f of opts.facturen) {
    items.push({
      id: `fac-${f.id}`,
      at: f.created_at || `${f.factuurdatum}T12:00:00`,
      kind: "factuur",
      titel: `Factuur ${f.factuur_nummer} aangemaakt`,
      detail: `${formatEuro(f.bedrag_ex_btw)} excl. btw · ${f.status}`,
      action: {
        type: "factuur_pdf",
        factuurId: f.id,
        filename: `${f.factuur_nummer}${f.status === "concept" ? "-concept" : ""}.pdf`,
        label: "Download PDF",
      },
    });
  }

  for (const p of opts.projecten) {
    items.push({
      id: `proj-${p.id}`,
      at: p.created_at,
      kind: "project",
      titel: `Project ${p.project_nummer} aangemaakt`,
      detail: PROJECT_STATUS_LABEL[p.status] || p.status,
      action: {
        type: "link",
        href: `/projecten/${p.id}`,
        label: "Open project",
      },
    });

    if (p.schouw_at || (p.schouw_jaar && p.schouw_week)) {
      const at =
        p.schouw_at ||
        p.updated_at ||
        p.created_at;
      items.push({
        id: `schouw-${p.id}`,
        at,
        kind: "schouw",
        titel: p.schouw_at
          ? "Schouw gepland"
          : `Schouwweek gezet (W${p.schouw_week})`,
        detail: p.schouw_at
          ? formatDateTimeNl(p.schouw_at)
          : p.schouw_jaar && p.schouw_week
            ? `${p.schouw_jaar}-W${String(p.schouw_week).padStart(2, "0")}`
            : null,
        action: {
          type: "link",
          href: `/projecten/${p.id}`,
          label: "Open project",
        },
      });
    }

    if (p.installatie_at || p.status === "materiaal_installatie") {
      items.push({
        id: `inst-${p.id}`,
        at: p.installatie_at || p.updated_at || p.created_at,
        kind: "installatie",
        titel: p.status === "installatie_voltooid"
          ? "Installatie uitgevoerd"
          : "Installatie gepland",
        detail: p.installatie_at
          ? formatDateTimeNl(p.installatie_at)
          : PROJECT_STATUS_LABEL[p.status] || null,
        action: {
          type: "link",
          href: `/projecten/${p.id}`,
          label: "Open project",
        },
      });
    }

    if (p.status === "installatie_voltooid" && !p.installatie_at) {
      // already covered above when status is voltooid with installatie_at missing — ok
    }
  }

  for (const a of opts.afspraken) {
    // Skip if already in lead_events as afspraak to reduce noise? Keep both for clarity on status.
    items.push({
      id: `afs-${a.id}`,
      at: a.created_at || a.start_at,
      kind: "afspraak",
      titel: `Afspraak ${afspraakSoortLabel[normalizeAfspraakSoort(a.soort)]}`,
      detail: `${formatDateTimeNl(a.start_at)} · ${a.status}${
        a.adviseurs?.naam ? ` · ${a.adviseurs.naam}` : ""
      }`,
    });
  }

  // Deduplicate near-identical afspraak events from lead_events vs afspraken:
  // keep entity-based afspraak rows; drop event rows that are pure "Afspraak gepland" duplicates is hard —
  // instead drop lead_events with soort afspraak if we have afspraken loaded.
  const filtered = items.filter((item) => {
    if (item.id.startsWith("ev-") && item.kind === "afspraak" && opts.afspraken.length) {
      return false;
    }
    return true;
  });

  return filtered.sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );
}

export function LeadActivityPanel({
  leadId,
  refreshKey = 0,
}: {
  leadId: string;
  refreshKey?: number;
}) {
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [offertes, setOffertes] = useState<Offerte[]>([]);
  const [facturen, setFacturen] = useState<Factuur[]>([]);
  const [projecten, setProjecten] = useState<Project[]>([]);
  const [afspraken, setAfspraken] = useState<Afspraak[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [evRes, sbData] = await Promise.all([
        fetch(`/api/leads/${leadId}/events`).then((r) => r.json()),
        (async () => {
          if (!hasSupabaseConfig()) {
            return { offertes: [], facturen: [], projecten: [], afspraken: [] };
          }
          const sb = getSupabaseBrowser();
          const [o, f, p, a] = await Promise.all([
            sb
              .from("offertes")
              .select(
                "id, offerte_nummer, status, created_at, ondertekend_op, ondertekend_naam, sign_token, subtotaal_ex_btw"
              )
              .eq("lead_id", leadId)
              .order("created_at", { ascending: false }),
            sb
              .from("facturen")
              .select(
                "id, factuur_nummer, status, created_at, factuurdatum, bedrag_ex_btw"
              )
              .eq("lead_id", leadId)
              .order("created_at", { ascending: false }),
            sb
              .from("projecten")
              .select(
                "id, project_nummer, status, created_at, updated_at, schouw_at, schouw_jaar, schouw_week, installatie_at"
              )
              .eq("lead_id", leadId)
              .order("created_at", { ascending: false }),
            sb
              .from("afspraken")
              .select(
                "id, start_at, created_at, status, soort, adviseurs(naam)"
              )
              .eq("lead_id", leadId)
              .order("start_at", { ascending: false })
              .limit(30),
          ]);
          return {
            offertes: (o.data as Offerte[]) || [],
            facturen: (f.data as Factuur[]) || [],
            projecten: (p.data as Project[]) || [],
            afspraken: ((a.data || []) as unknown as Afspraak[]) || [],
          };
        })(),
      ]);

      setEvents((evRes.events as LeadEvent[]) || []);
      setOffertes(sbData.offertes);
      setFacturen(sbData.facturen);
      setProjecten(sbData.projecten);
      setAfspraken(sbData.afspraken);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const items = useMemo(
    () =>
      buildFromEntities({
        events,
        offertes,
        facturen,
        projecten,
        afspraken,
      }),
    [events, offertes, facturen, projecten, afspraken]
  );

  async function downloadFactuurPdf(
    factuurId: string,
    filename: string,
    itemId: string
  ) {
    setBusyId(itemId);
    setMsg(null);
    try {
      const res = await fetch(`/api/facturen/${factuurId}/pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "PDF downloaden mislukt");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg("Factuur-PDF gedownload.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "PDF mislukt");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-4 border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
          Activiteit
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs font-semibold text-muted hover:text-ink"
        >
          Vernieuwen
        </button>
      </div>

      <div className="px-4 py-4 sm:px-5">
        {msg && (
          <p className="mb-3 border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
            {msg}
          </p>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-muted">
            Activiteit laden…
          </p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            Nog geen activiteit. Offertes, facturen, schouw, installatie en
            notities verschijnen hier.
          </p>
        ) : (
          <ol className="relative space-y-0 border-l border-line pl-4">
            {items.map((item) => (
              <li key={item.id} className="relative pb-4 last:pb-0">
                <span
                  className={[
                    "absolute -left-[1.28rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 bg-white",
                    kindTone(item.kind),
                  ].join(" ")}
                />
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {formatDateTimeNl(item.at)}
                  {" · "}
                  {KIND_LABEL[item.kind]}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-ink">
                  {item.titel}
                </p>
                {item.detail?.trim() && (
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">
                    {item.detail}
                  </p>
                )}
                {item.action && (
                  <div className="mt-2">
                    {item.action.type === "factuur_pdf" ? (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => {
                          const act = item.action;
                          if (!act || act.type !== "factuur_pdf") return;
                          void downloadFactuurPdf(
                            act.factuurId,
                            act.filename,
                            item.id
                          );
                        }}
                        className="inline-flex items-center bg-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
                      >
                        {busyId === item.id
                          ? "Downloaden…"
                          : item.action.label}
                      </button>
                    ) : item.action.type === "offerte_sign" ? (
                      <a
                        href={item.action.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-dark"
                      >
                        {item.action.label}
                      </a>
                    ) : (
                      <Link
                        href={item.action.href}
                        className="inline-flex items-center border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                      >
                        {item.action.label}
                      </Link>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
