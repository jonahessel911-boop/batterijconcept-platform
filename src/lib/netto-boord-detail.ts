import { formatDateTimeNl, formatEuro } from "@/lib/format";
import { isSchouwFormulier } from "@/lib/project-documenten";
import { normalizeProjectStatus, projectStatusLabel } from "@/lib/labels";
import { afspraakSoortLabel, normalizeAfspraakSoort } from "@/lib/afspraak-soort";
import { isAanbetalingFactuurOmschrijving } from "@/lib/aanbetaling";

export type NettoTimelineKind =
  | "notitie"
  | "status"
  | "bel"
  | "afspraak"
  | "offerte"
  | "offerte_getekend"
  | "factuur"
  | "betaling"
  | "inkoop"
  | "schouw"
  | "installatie"
  | "service"
  | "taak"
  | "document"
  | "backoffice"
  | "project"
  | "overig";

export type NettoTimelineAction =
  | { type: "link"; href: string; label: string }
  | { type: "factuur_pdf"; factuurId: string; filename: string; label: string }
  | { type: "download_url"; url: string; filename: string; label: string }
  | { type: "offerte"; href: string; label: string };

export type NettoTimelineItem = {
  id: string;
  at: string;
  kind: NettoTimelineKind;
  titel: string;
  detail?: string | null;
  action?: NettoTimelineAction | null;
};

export type NettoOpenTaak = {
  id: string;
  titel: string;
  status: string;
  afdeling: string;
  due_at: string | null;
  auto_key: string | null;
  notities: string | null;
  verantwoordelijke_naam: string | null;
  created_at: string;
  updated_at: string;
};

/** Handmatige actie voor/van adviseur (incl. afgeronde). */
export type NettoAdviseurActie = {
  id: string;
  titel: string;
  status: string;
  due_at: string | null;
  notities: string | null;
  aangemaakt_door_naam: string | null;
  created_at: string;
  updated_at: string;
};

export type NettoSchouwDoc = {
  id: string;
  bestandsnaam: string | null;
  omschrijving: string | null;
  created_at: string;
  url: string | null;
};

export const NETTO_TIMELINE_KIND_LABEL: Record<NettoTimelineKind, string> = {
  notitie: "Notitie",
  status: "Status",
  bel: "Bellen",
  afspraak: "Afspraak",
  offerte: "Offerte",
  offerte_getekend: "Offerte getekend",
  factuur: "Factuur",
  betaling: "Betaling",
  inkoop: "Inkoop",
  schouw: "Schouw",
  installatie: "Installatie",
  service: "Service",
  taak: "Taak",
  document: "Document",
  backoffice: "Backoffice",
  project: "Project",
  overig: "Overig",
};

const EVENT_KINDS = new Set<NettoTimelineKind>([
  "notitie",
  "status",
  "bel",
  "afspraak",
  "betaling",
  "factuur",
  "inkoop",
  "installatie",
  "schouw",
  "service",
]);

const BACKOFFICE_SOORT_LABEL: Record<string, string> = {
  bel_schouw_aanbetaling: "Bel schouw / aanbetaling",
  schakel_financiering: "Schakel financiering",
  nabellen_factuur: "Nabellen factuur",
  herplan_afspraak: "Herplan afspraak",
};

type BuildInput = {
  events: Array<{
    id: string;
    soort: string;
    titel: string;
    detail: string | null;
    created_at: string;
    meta?: { factuur_id?: string } | null;
  }>;
  offertes: Array<{
    id: string;
    offerte_nummer: string | null;
    status: string;
    created_at: string;
    ondertekend_op: string | null;
    ondertekend_naam: string | null;
    subtotaal_ex_btw: number | null;
    sign_token: string | null;
  }>;
  facturen: Array<{
    id: string;
    factuur_nummer: string | null;
    status: string;
    omschrijving: string | null;
    created_at: string | null;
    factuurdatum: string | null;
    betaald_op: string | null;
    bedrag_ex_btw: number | null;
    bedrag_inc_btw: number | null;
  }>;
  projecten: Array<{
    id: string;
    project_nummer: string | null;
    status: string;
    created_at: string;
    updated_at: string | null;
    schouw_at: string | null;
    schouw_jaar: number | null;
    schouw_week: number | null;
    installatie_at: string | null;
  }>;
  afspraken: Array<{
    id: string;
    start_at: string;
    created_at: string | null;
    status: string;
    soort: string | null;
    adviseur_naam?: string | null;
  }>;
  taken: Array<{
    id: string;
    titel: string;
    status: string;
    afdeling: string | null;
    due_at: string | null;
    auto_key: string | null;
    notities: string | null;
    created_at: string;
    updated_at: string;
    verantwoordelijke_naam?: string | null;
  }>;
  fotos: Array<{
    id: string;
    bestandsnaam: string | null;
    omschrijving: string | null;
    created_at: string;
    url: string | null;
  }>;
  backofficeEvents: Array<{
    id: string;
    soort: string;
    completed_at: string;
    on_time: boolean | null;
    adviseur_naam?: string | null;
  }>;
  fonioCalls: Array<{
    id: string;
    status: string;
    started_at: string;
    ended_at: string | null;
    outcome: string | null;
  }>;
};

function statusLabel(status: string): string {
  const st = normalizeProjectStatus(status);
  return projectStatusLabel[st] || status;
}

export function buildNettoTimeline(input: BuildInput): NettoTimelineItem[] {
  const items: NettoTimelineItem[] = [];

  const loggedSendIds = new Set<string>();
  const loggedPaidIds = new Set<string>();
  for (const ev of input.events) {
    const fid = ev.meta?.factuur_id;
    if (!fid) continue;
    if (ev.soort === "factuur") loggedSendIds.add(fid);
    if (ev.soort === "betaling") loggedPaidIds.add(fid);
  }

  const schouwWeekEvByProject = new Map<
    string,
    { created_at: string; detail: string | null }
  >();
  for (const ev of input.events) {
    if (ev.soort !== "schouw" || !/Schouwweek gezet/i.test(ev.titel || "")) {
      continue;
    }
    const meta = (ev.meta || {}) as {
      project_id?: string;
      schouw_week?: number;
      schouw_jaar?: number;
    };
    const pid = meta.project_id;
    if (!pid) continue;
    const prev = schouwWeekEvByProject.get(pid);
    if (!prev || ev.created_at < prev.created_at) {
      schouwWeekEvByProject.set(pid, {
        created_at: ev.created_at,
        detail: ev.detail,
      });
    }
  }

  for (const ev of input.events) {
    const soort = (ev.soort || "overig") as NettoTimelineKind;
    const kind: NettoTimelineKind = EVENT_KINDS.has(soort) ? soort : "overig";
    if (soort === "schouw" && /Schouwweek gezet/i.test(ev.titel || "")) {
      continue;
    }
    items.push({
      id: `ev-${ev.id}`,
      at: ev.created_at,
      kind,
      titel: ev.titel,
      detail: ev.detail,
    });
  }

  for (const o of input.offertes) {
    items.push({
      id: `off-create-${o.id}`,
      at: o.created_at,
      kind: "offerte",
      titel: `Offerte ${o.offerte_nummer || ""} aangemaakt`.trim(),
      detail: `${formatEuro(o.subtotaal_ex_btw)} excl. btw · ${o.status}`,
      action: {
        type: "offerte",
        href: `/offertes/${o.id}`,
        label: "Bekijk offerte",
      },
    });

    if (o.status === "ondertekend" && o.ondertekend_op) {
      items.push({
        id: `off-sign-${o.id}`,
        at: o.ondertekend_op,
        kind: "offerte_getekend",
        titel: `Offerte ${o.offerte_nummer || ""} getekend`.trim(),
        detail: o.ondertekend_naam
          ? `Getekend door ${o.ondertekend_naam}`
          : null,
        action: {
          type: "offerte",
          href: `/offertes/${o.id}`,
          label: "Bekijk offerte",
        },
      });
    }

    if (o.status === "afgewezen") {
      items.push({
        id: `off-afw-${o.id}`,
        at: o.ondertekend_op || o.created_at,
        kind: "status",
        titel: `Offerte ${o.offerte_nummer || ""} afgewezen`.trim(),
        detail: null,
      });
    }
  }

  for (const f of input.facturen) {
    const isAanb = isAanbetalingFactuurOmschrijving(f.omschrijving);
    const soortLabel = isAanb ? "Aanbetalingsfactuur" : "Factuur";
    const nr = f.factuur_nummer || "";

    items.push({
      id: `fac-create-${f.id}`,
      at: f.created_at || `${f.factuurdatum || ""}T12:00:00`,
      kind: "factuur",
      titel: `${soortLabel} ${nr} aangemaakt`.trim(),
      detail: [
        f.bedrag_ex_btw != null ? `${formatEuro(f.bedrag_ex_btw)} excl. btw` : null,
        f.omschrijving,
        f.status,
      ]
        .filter(Boolean)
        .join(" · "),
      action: {
        type: "factuur_pdf",
        factuurId: f.id,
        filename: `${nr || "factuur"}.pdf`,
        label: "Download factuur-PDF",
      },
    });

    if (
      !loggedSendIds.has(f.id) &&
      (f.status === "verzonden" || f.status === "betaald" || f.status === "deels_betaald") &&
      f.factuurdatum
    ) {
      items.push({
        id: `fac-send-${f.id}`,
        at: `${f.factuurdatum}T12:00:00`,
        kind: "factuur",
        titel: `${soortLabel} ${nr} verstuurd`.trim(),
        detail: f.omschrijving || null,
        action: {
          type: "factuur_pdf",
          factuurId: f.id,
          filename: `${nr || "factuur"}.pdf`,
          label: "Download factuur-PDF",
        },
      });
    }

    if (!loggedPaidIds.has(f.id) && f.status === "betaald" && f.betaald_op) {
      items.push({
        id: `fac-paid-${f.id}`,
        at: `${f.betaald_op}T12:00:00`,
        kind: "betaling",
        titel: `${soortLabel} ${nr} betaald`.trim(),
        detail: [
          f.bedrag_inc_btw != null
            ? `${formatEuro(f.bedrag_inc_btw)} incl. btw`
            : null,
          f.omschrijving,
        ]
          .filter(Boolean)
          .join(" · "),
        action: {
          type: "factuur_pdf",
          factuurId: f.id,
          filename: `${nr || "factuur"}.pdf`,
          label: "Download factuur-PDF",
        },
      });
    }
  }

  for (const p of input.projecten) {
    items.push({
      id: `proj-${p.id}`,
      at: p.created_at,
      kind: "project",
      titel: `Project ${p.project_nummer || ""} aangemaakt`.trim(),
      detail: statusLabel(p.status),
      action: {
        type: "link",
        href: `/projecten/${p.id}`,
        label: "Open project",
      },
    });

    if (p.schouw_jaar && p.schouw_week) {
      const weekEv = schouwWeekEvByProject.get(p.id);
      items.push({
        id: `schouw-week-${p.id}`,
        at: weekEv?.created_at || p.updated_at || p.created_at,
        kind: "schouw",
        titel: `Schouwweek gezet (W${p.schouw_week})`,
        detail:
          weekEv?.detail ||
          `${p.schouw_jaar}-W${String(p.schouw_week).padStart(2, "0")}`,
        action: {
          type: "link",
          href: `/projecten/${p.id}`,
          label: "Open project",
        },
      });
    }

    if (p.schouw_at) {
      items.push({
        id: `schouw-datum-${p.id}`,
        at: p.schouw_at,
        kind: "schouw",
        titel: "Schouwdatum gepland",
        detail: formatDateTimeNl(p.schouw_at),
        action: {
          type: "link",
          href: `/projecten/${p.id}`,
          label: "Open project",
        },
      });
    }

    const schouwFormulieren = input.fotos.filter((f) =>
      isSchouwFormulier(f.omschrijving)
    );
    if (schouwFormulieren.length > 0) {
      const eerste = [...schouwFormulieren].sort((a, b) =>
        a.created_at.localeCompare(b.created_at)
      )[0];
      items.push({
        id: `schouw-done-${p.id}`,
        at: eerste?.created_at || p.updated_at || p.created_at,
        kind: "schouw",
        titel: "Schouw uitgevoerd",
        detail: "Schouwformulier geüpload",
        action: {
          type: "link",
          href: `/projecten/${p.id}`,
          label: "Open project",
        },
      });
    }

    const st = normalizeProjectStatus(p.status);

    if (p.installatie_at || st === "installatie_ingepland" || st === "installatie_voltooid") {
      items.push({
        id: `inst-plan-${p.id}`,
        at: p.installatie_at || p.updated_at || p.created_at,
        kind: "installatie",
        titel:
          st === "installatie_voltooid"
            ? "Installatie uitgevoerd"
            : "Installatie gepland",
        detail: p.installatie_at
          ? formatDateTimeNl(p.installatie_at)
          : statusLabel(p.status),
        action: {
          type: "link",
          href: `/projecten/${p.id}`,
          label: "Open project",
        },
      });
    }

    if (st === "annulering") {
      items.push({
        id: `annul-${p.id}`,
        at: p.updated_at || p.created_at,
        kind: "status",
        titel: "Project geannuleerd",
        detail: null,
      });
    }
  }

  for (const a of input.afspraken) {
    items.push({
      id: `afs-${a.id}`,
      at: a.created_at || a.start_at,
      kind: "afspraak",
      titel: `Afspraak ${afspraakSoortLabel[normalizeAfspraakSoort(a.soort)] || a.soort || ""}`.trim(),
      detail: [
        formatDateTimeNl(a.start_at),
        a.status,
        a.adviseur_naam,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  for (const t of input.taken) {
    if (t.status === "done") {
      items.push({
        id: `taak-done-${t.id}`,
        at: t.updated_at || t.created_at,
        kind: "taak",
        titel: `Taak afgerond: ${t.titel}`,
        detail: [
          t.afdeling,
          t.verantwoordelijke_naam,
          t.notities,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
  }

  for (const f of input.fotos) {
    const isSchouw = isSchouwFormulier(f.omschrijving);
    items.push({
      id: `foto-${f.id}`,
      at: f.created_at,
      kind: "document",
      titel: isSchouw
        ? "Schouwformulier geüpload"
        : `Document: ${f.bestandsnaam || f.omschrijving || "bestand"}`,
      detail: f.omschrijving || f.bestandsnaam,
      action: f.url
        ? {
            type: "download_url",
            url: f.url,
            filename: f.bestandsnaam || "document",
            label: isSchouw ? "Download schouwformulier" : "Download",
          }
        : null,
    });
  }

  for (const b of input.backofficeEvents) {
    items.push({
      id: `bo-${b.id}`,
      at: b.completed_at,
      kind: "backoffice",
      titel: BACKOFFICE_SOORT_LABEL[b.soort] || b.soort,
      detail: [
        b.adviseur_naam,
        b.on_time === true ? "Op tijd" : b.on_time === false ? "Te laat" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  for (const c of input.fonioCalls) {
    items.push({
      id: `fonio-${c.id}`,
      at: c.started_at,
      kind: "bel",
      titel: `Telefoongesprek (${c.status})`,
      detail: [c.outcome, c.ended_at ? `Einde ${formatDateTimeNl(c.ended_at)}` : null]
        .filter(Boolean)
        .join(" · "),
    });
  }

  // Dedup: drop lead_events afspraak als we entity-afspraken hebben
  const filtered = items.filter((item) => {
    if (
      item.id.startsWith("ev-") &&
      item.kind === "afspraak" &&
      input.afspraken.length
    ) {
      return false;
    }
    return true;
  });

  return filtered.sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );
}

export function mapOpenTaken(
  taken: BuildInput["taken"]
): NettoOpenTaak[] {
  return taken
    .filter((t) => t.status !== "done")
    .map((t) => ({
      id: t.id,
      titel: t.titel,
      status: t.status,
      afdeling: t.afdeling || "—",
      due_at: t.due_at,
      auto_key: t.auto_key,
      notities: t.notities,
      verantwoordelijke_naam: t.verantwoordelijke_naam || null,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }))
    .sort((a, b) => {
      const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return da - db;
    });
}

export function mapAdviseurActies(
  taken: Array<{
    id: string;
    titel: string;
    status: string;
    due_at: string | null;
    auto_key: string | null;
    notities: string | null;
    aangemaakt_door_id?: string | null;
    aangemaakt_door_naam?: string | null;
    created_at: string;
    updated_at: string;
  }>
): NettoAdviseurActie[] {
  return taken
    .filter((t) => !t.auto_key && t.aangemaakt_door_id)
    .map((t) => ({
      id: t.id,
      titel: t.titel,
      status: t.status,
      due_at: t.due_at,
      notities: t.notities,
      aangemaakt_door_naam: t.aangemaakt_door_naam || null,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }))
    .sort((a, b) => {
      // Open eerst, daarna nieuwste
      if (a.status === "done" && b.status !== "done") return 1;
      if (a.status !== "done" && b.status === "done") return -1;
      return (
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    });
}

export function mapSchouwDocs(
  fotos: BuildInput["fotos"]
): NettoSchouwDoc[] {
  return fotos
    .filter((f) => isSchouwFormulier(f.omschrijving))
    .map((f) => ({
      id: f.id,
      bestandsnaam: f.bestandsnaam,
      omschrijving: f.omschrijving,
      created_at: f.created_at,
      url: f.url,
    }));
}
