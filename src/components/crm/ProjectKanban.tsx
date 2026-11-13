"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, Info } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  Factuur,
  InstallatiePartner,
  Offerte,
  OfferteRegel,
  Project,
  ProjectStatus,
  ProjectTaak,
} from "@/types/database";
import {
  PROJECT_STATUSES,
  projectStatusLabel,
  resolveDisplayProjectStatus,
} from "@/lib/labels";
import {
  PROJECT_STATUS_DEFS,
  PROJECT_STATUS_FASE_ORDER,
  faseLabelFor,
  type Betaalwijze,
  type ProjectStatusFase,
  type ProjectStatusKey,
} from "@/lib/project-status-config";
import {
  FINANCIERING_PIPELINE,
  FINANCIERING_STATUS_LABEL,
  FINANCIERING_STATUS_LABEL_KORT,
  normalizeFinancieringStatus,
  resolveFinancieringStatus,
  type FinancieringStatus,
} from "@/lib/financiering-status";
import {
  isWarmtefondsGoedgekeurd,
  isWarmtefondsProject,
} from "@/lib/backoffice-acties";
import { resolveProjectVolgendeStap } from "@/lib/project-volgende-stap";
import { contextVoorOpenTaak } from "@/lib/project-taak-context";
import { formatDateNl, formatDateTimeNl, formatEuro } from "@/lib/format";
import {
  formatSchouwWeekLabel,
  parseSchouwWeekValue,
  upcomingSchouwWeekOptions,
} from "@/lib/schouw-week";
import { buildProjectBetalingCash } from "@/lib/project-betaling-cash";
import {
  buildInkoopChecklist,
  batterijPurchasingStatus,
  getInkoopExtraNotities,
  inkoopChecklistTotaalExBtw,
  isInkoopItemBesteld,
  parseInkoopLeverancierStatus,
  parseInkoopRegelStatus,
  INKOOP_LEVERANCIER_STATUS_LABEL,
  INKOOP_NOTE_PREFIX,
  type MateriaalChecks,
} from "@/lib/project-inkoop-checklist";
import {
  bestelDeadlineVoorInstallatie,
  INKOOP_DAGEN_VOOR_INSTALLATIE,
  materiaalNogTeBestellen,
} from "@/lib/inkoop-sla";
import type { ProductInkoop } from "@/lib/inkoop";
import { telefoonMatch } from "@/lib/rollen";
import { rememberCrmReturnUrl } from "./DetailChrome";

const COLUMN_ACCENT: Partial<Record<ProjectStatus, string>> = {
  schouwweek_inplannen: "#1A4A6E",
  aanbetaling_verstuurd: "#C9A227",
  aanbetaling_betaald: "#0D7A6F",
  warmtefonds_afspraak_ingepland: "#1A4A6E",
  warmtefonds_aangevraagd: "#1A4A6E",
  warmtefonds_in_behandeling: "#CA8A04",
  warmtefonds_afgewezen: "#C62828",
  warmtefonds_goedgekeurd: "#0D5C32",
  opstarten_voltooid_afwachten_wf: "#CA8A04",
  schouwdag_ingepland: "#1565C0",
  schouw_voltooid: "#1565C0",
  restfactuur_verstuurd: "#C45A12",
  restfactuur_betaald: "#C9A227",
  materiaal_besteld: "#7C3AED",
  installatie_ingepland: "#C45A12",
  installatie_voltooid: "#0D5C32",
  review_gevraagd: "#0D7A6F",
  afgerond: "#0D5C32",
  service: "#00695C",
  annulering: "#C62828",
  hold_sales_actie: "#5A4A6E",
};

/** Compacte “i” met uitleg op hover (native title + focusable). */
function RowInfoTip({ text }: { text: string }) {
  return (
    <span
      className="group relative inline-flex shrink-0 align-middle"
      title={text}
    >
      <button
        type="button"
        aria-label={text}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line bg-wash text-muted hover:border-muted hover:text-ink"
      >
        <Info className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 hidden w-56 border border-line bg-white px-2.5 py-2 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-ink shadow-sm group-hover:block group-focus-within:block"
      >
        {text}
      </span>
    </span>
  );
}

function adresRegel(p: Project): string {
  const l = p.leads;
  if (!l) return "—";
  const parts = [
    l.straat,
    [l.huisnummer, l.toevoeging].filter(Boolean).join(""),
  ].filter(Boolean);
  const line = parts.length
    ? parts.join(" ")
    : [l.postcode, l.huisnummer].filter(Boolean).join(" ");
  return [line, l.plaats].filter(Boolean).join(", ") || "—";
}

/** Zoekbaar klant-/projectveld — alle tokens moeten matchen. */
function projectMatchesSearch(p: Project, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const l = p.leads;
  const hay = [
    p.project_nummer,
    p.titel,
    p.monteur,
    p.notities,
    p.backoffice_notitie,
    p.leveradres,
    p.betaalwijze,
    l?.naam,
    l?.email,
    l?.telefoon,
    l?.lead_number,
    l?.plaats,
    l?.postcode,
    l?.straat,
    l?.huisnummer,
    l?.toevoeging,
    l?.notities,
    l?.adviseurs?.naam,
    p.installatie_partners?.naam,
    p.installatie_partners?.email,
    p.installatie_partners?.telefoon,
    p.installatie_teamgenoot?.naam,
    p.installatie_teamgenoot?.email,
    p.installatie_teamgenoot?.telefoon,
    p.verantwoordelijke?.naam,
    p.verantwoordelijke?.email,
    p.offertes?.offerte_nummer,
    adresRegel(p),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every((token) => {
    if (hay.includes(token)) return true;
    if (telefoonMatch(l?.telefoon, token)) return true;
    if (telefoonMatch(p.installatie_partners?.telefoon, token)) return true;
    if (telefoonMatch(p.installatie_teamgenoot?.telefoon, token)) return true;
    return false;
  });
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type PendingMove =
  | { type: "schouwweek"; project: Project }
  | { type: "schouwdag"; project: Project }
  | { type: "materiaal"; project: Project };

type KanbanTrack =
  | "alles"
  | "opstarten_wf"
  | "opstarten_em"
  | "wf_doorgestuurd"
  | "wf_contact_verstuurd"
  | "wf_in_behandeling"
  | "wf_afspraak_ingepland"
  | "financiering"
  | "schouw"
  | "eindafrekening"
  | "uitvoering"
  | "afronding"
  | "overig";

type WfSpecialKind =
  | "wf_doorgestuurd"
  | "wf_contact_verstuurd"
  | "wf_in_behandeling"
  | "wf_afspraak_ingepland";

function isParkedStatus(status: ProjectStatus): boolean {
  return status === "annulering" || status === "hold_sales_actie";
}

/** WF-rijen op de Financiering-tab (echte parallelle fase). */
const FINANCIERING_KANBAN_ROWS: FinancieringStatus[] = [
  ...FINANCIERING_PIPELINE,
  "afgewezen",
];

/**
 * Orderroute EM vs WF — project.betaalwijze is leidend (de route van de order).
 * Daarna lead-sale / offerte via isWarmtefondsProject.
 */
function projectBetaalwijze(p: Project): Betaalwijze {
  if (p.betaalwijze === "warmtefonds" || p.betaalwijze === "eigen_middelen") {
    return p.betaalwijze;
  }
  return isWarmtefondsProject(p) ? "warmtefonds" : "eigen_middelen";
}

/**
 * Opstarten WF = kickoff, nog geen WF-financieringsfase.
 * Zodra er een WF-fase is → uit Opstarten (hoort o.a. bij WF in behandeling).
 */
function isWfNogInOpstarten(p: Project): boolean {
  const n = normalizeFinancieringStatus(resolveFinancieringStatus(p));
  if (!n) return true;
  // Elke financieringsfase = uit Opstarten WF
  return false;
}

function wfFinancieringNorm(p: Project): FinancieringStatus | null {
  if (isParkedStatus(resolveDisplayProjectStatus(p))) return null;
  if (projectBetaalwijze(p) !== "warmtefonds") return null;
  return normalizeFinancieringStatus(resolveFinancieringStatus(p));
}

/**
 * Order al in schouw/declaratie/installatie/… → hoort daar, niet dubbel
 * onder WF doorgestuurd / in behandeling.
 */
function isOrderVoorbijOpstarten(p: Project): boolean {
  const s = resolveDisplayProjectStatus(p);
  if (isParkedStatus(s)) return false;
  const fase = faseForStatus(s);
  return (
    fase === "schouw" ||
    fase === "eindafrekening" ||
    fase === "uitvoering" ||
    fase === "afronding" ||
    fase === "nazorg"
  );
}

function heeftWfAfspraak(p: Project): boolean {
  return Boolean(p.warmtefonds_afspraak_at);
}

function wfContactPogingen(p: Project): number {
  const n = Number(p.warmtefonds_contact_pogingen || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Geannuleerd / HOLD: nooit in actieve WF-rijen. */
function isWfParked(p: Project): boolean {
  return isParkedStatus(resolveDisplayProjectStatus(p));
}

/** WF doorgestuurd (+ documenten) — ná Opstarten, vóór contact. */
function isWfDoorgestuurd(p: Project): boolean {
  if (isWfParked(p) || isOrderVoorbijOpstarten(p)) return false;
  if (heeftWfAfspraak(p)) return false;
  const n = wfFinancieringNorm(p);
  return n === "doorgestuurd_naar_edwin" || n === "documenten_aanleveren";
}

/** WF contact verstuurd — ná doorgestuurd, vóór afspraak / in behandeling. */
function isWfContactVerstuurd(p: Project): boolean {
  if (isWfParked(p) || isOrderVoorbijOpstarten(p)) return false;
  if (heeftWfAfspraak(p)) return false;
  return wfFinancieringNorm(p) === "contact_verstuurd";
}

/** WF in behandeling — ná contact / afspraak (alleen WF-route). */
function isWfInBehandeling(p: Project): boolean {
  if (isWfParked(p) || isOrderVoorbijOpstarten(p)) return false;
  return wfFinancieringNorm(p) === "in_behandeling";
}

/**
 * WF-afspraak ingepland — heeft datum, nog niet in behandeling of verder.
 * Kaarten links → rechts: eerstvolgende afspraak eerst.
 */
function isWfAfspraakIngepland(p: Project): boolean {
  if (isWfParked(p) || isOrderVoorbijOpstarten(p)) return false;
  if (!heeftWfAfspraak(p)) return false;
  const n = wfFinancieringNorm(p);
  if (!n) return false;
  if (
    n === "in_behandeling" ||
    n === "aanbod_ondertekenen" ||
    n === "declaratie_indienen" ||
    n === "wacht_op_betaling" ||
    n === "uitbetaald" ||
    n === "afgewezen"
  ) {
    return false;
  }
  return true;
}

function sortByWfAfspraakAsc(a: Project, b: Project): number {
  const at = a.warmtefonds_afspraak_at
    ? new Date(a.warmtefonds_afspraak_at).getTime()
    : Number.POSITIVE_INFINITY;
  const bt = b.warmtefonds_afspraak_at
    ? new Date(b.warmtefonds_afspraak_at).getTime()
    : Number.POSITIVE_INFINITY;
  return at - bt;
}

/**
 * Op een verdere orderstap: korte hint wat je met WF nog moet.
 * Null als EM, of WF al goedgekeurd / klaar.
 */
function wfNogAfrondenHint(p: Project): string | null {
  if (projectBetaalwijze(p) !== "warmtefonds") return null;
  if (!isOrderVoorbijOpstarten(p)) return null;
  if (isWarmtefondsGoedgekeurd(p)) return null;
  const n = wfFinancieringNorm(p);
  if (!n || n === "uitbetaald") return null;
  if (n === "afgewezen") return "WF afgewezen";
  const kort =
    FINANCIERING_STATUS_LABEL_KORT[n] || n.replaceAll("_", " ");
  return `WF nog: ${kort}`;
}

const OPSTARTEN_EM_STATUSES: ProjectStatus[] = [
  "schouwweek_inplannen",
  "aanbetaling_verstuurd",
  "aanbetaling_betaald",
];

const OPSTARTEN_WF_STATUSES: ProjectStatus[] = [
  "schouwweek_inplannen",
  "opstarten_voltooid_afwachten_wf",
];

/** Volledige rijtekst + korte toelichting (geen truncate). */
function kanbanStatusCopy(
  status: ProjectStatus,
  _fase?: ProjectStatusFase,
  betaalwijze?: Betaalwijze
): { label: string; hint?: string | null } {
  switch (status) {
    case "schouwweek_inplannen":
      if (betaalwijze === "eigen_middelen") {
        return {
          label: "Opstarten · afwachten aanbetaling",
          hint: "Na betaling: direct schouwdag inplannen (geen WF)",
        };
      }
      if (betaalwijze === "warmtefonds") {
        return {
          label: "Opstarten · kickoff / indicatie",
          hint: "Schouwweek = indicatie voor de klant · daarna afwachten WF",
        };
      }
      return { label: "Opstarten" };
    case "aanbetaling_verstuurd":
      return {
        label: "Aanbetaling verstuurd",
        hint: "Eigen middelen · wacht op betaling",
      };
    case "aanbetaling_betaald":
      return {
        label: "Aanbetaling betaald → schouw",
        hint: "Plan nu de exacte schouwdag",
      };
    case "opstarten_voltooid_afwachten_wf":
      return {
        label: "Afwachten WF (kickoff klaar)",
        hint: "Volgende: WF-declaratie + schouwdag ná goedkeuring",
      };
    case "restfactuur_verstuurd":
      if (betaalwijze === "eigen_middelen") {
        return {
          label: "Restfactuur verstuurd",
          hint: "Eigen middelen · restfactuur volgt in het pad (betaling pas ná opleverformulier)",
        };
      }
      if (betaalwijze === "warmtefonds") {
        return {
          label: "WF declaratie ingediend",
          hint: "Warmtefonds · declaratie doorsturen na goedkeuring",
        };
      }
      return {
        label: "WF declaratie / Restfactuur verstuurd",
        hint: "WF: declaratie · EM: restfactuur (betaling pas ná opleverformulier)",
      };
    case "restfactuur_betaald":
      if (betaalwijze === "eigen_middelen") {
        return {
          label: "Klaar voor installatie plannen",
          hint: "EM: klant betaalt restant pas ná opleverformulier — nu wel installatie plannen",
        };
      }
      if (betaalwijze === "warmtefonds") {
        return {
          label: "Klaar voor installatie plannen",
          hint: "WF: declaratie betaald · plan de installatiedatum",
        };
      }
      return {
        label: "Klaar voor installatie plannen",
        hint: "WF: na declaratie-betaling · EM: restant pas ná opleverformulier",
      };
    case "materiaal_besteld":
      return {
        label: "Materiaal ingekocht — wachten op levering",
        hint: "Purchasing afgevinkt · levering / installatie volgt",
      };
    case "installatie_ingepland":
      return {
        label: "Installatie ingepland",
        hint:
          betaalwijze === "eigen_middelen"
            ? "EM: betaling restant pas ná opleverformulier"
            : "Datum staat · monteur / klant",
      };
    case "installatie_voltooid":
      return {
        label: "Installatie voltooid",
        hint: "(Restfactuur bij EM versturen)",
      };
    case "schouwdag_ingepland":
      return {
        label: "Schouw gepland",
        hint: "Exacte schouwdag staat",
      };
    case "schouw_voltooid":
      return {
        label: "Schouw voltooid",
        hint:
          betaalwijze === "eigen_middelen"
            ? "Door naar installatiepad · restfactuur later (ná oplevering)"
            : "Schouwformulier / vervolg WF-declaratie of installatie",
      };
    default:
      return { label: projectStatusLabel[status] || status };
  }
}

const KANBAN_TRACKS: { id: KanbanTrack; label: string; hint: string }[] = [
  {
    id: "alles",
    label: "Overzicht",
    hint: "Opstarten: Opstarten WF + Opstarten EM. Daarna (WF-route): doorgestuurd → contact → in behandeling → afspraak · schouw. EM: Opstarten EM → schouw.",
  },
  {
    id: "opstarten_wf",
    label: "Opstarten WF",
    hint: "Kickoff WF · nog geen financieringsfase.",
  },
  {
    id: "opstarten_em",
    label: "Opstarten EM",
    hint: "Eigen middelen · afwachten aanbetaling → schouw.",
  },
  {
    id: "wf_doorgestuurd",
    label: "WF doorgestuurd",
    hint: "Ná Opstarten WF · doorgestuurd / documenten · vóór contact.",
  },
  {
    id: "wf_contact_verstuurd",
    label: "WF contact",
    hint: "Contact via WF-portaal · toont ×1 / ×2 / … pogingen.",
  },
  {
    id: "wf_afspraak_ingepland",
    label: "WF afspraak",
    hint: "WF-afspraak gezet · links eerstvolgende, rechts later.",
  },
  {
    id: "wf_in_behandeling",
    label: "WF in behandeling",
    hint: "Alleen WF-route · Warmtefonds beoordeelt.",
  },
  {
    id: "financiering",
    label: "Financiering",
    hint: "Volledig WF-financieringspad (doorgestuurd → contact → …). Annulering/HOLD horen niet hier.",
  },
  {
    id: "eindafrekening",
    label: "WF declaratie",
    hint: "Na WF-goedkeuring: declaratie doorsturen (vóór/naast schouwdag). EM: restfactuur ná schouw — geen WF-stap.",
  },
  {
    id: "schouw",
    label: "Schouw",
    hint: "EM: direct na aanbetaling schouwdag inplannen. WF: ná goedkeuring, naast WF-declaratie.",
  },
  {
    id: "uitvoering",
    label: "Installatie",
    hint: "Materiaal → gepland → voltooid. EM: restantbetaling pas ná opleverformulier. WF: na declaratie-betaling.",
  },
  {
    id: "afronding",
    label: "Afronding",
    hint: "Review · afgerond · service",
  },
  {
    id: "overig",
    label: "Annuleringen",
    hint: "Annuleringen + HOLD SALES · onderaan Overzicht",
  },
];

function statusDef(status: ProjectStatus) {
  return PROJECT_STATUS_DEFS.find(
    (d) => d.key === (status as ProjectStatusKey)
  );
}

const FASE_ORDER: ProjectStatusFase[] = PROJECT_STATUS_FASE_ORDER;

function faseForStatus(status: ProjectStatus): ProjectStatusFase {
  const def = PROJECT_STATUS_DEFS.find((d) => d.key === (status as ProjectStatusKey));
  return def?.fase || "overig";
}

function financieringKort(
  raw: string | null | undefined
): string | null {
  if (!raw) return null;
  const map = FINANCIERING_STATUS_LABEL_KORT as Record<string, string>;
  return map[raw] || raw.replaceAll("_", " ");
}

export function ProjectKanban({
  projecten,
  facturen = [],
  onProjectUpdated,
}: {
  projecten: Project[];
  facturen?: Factuur[];
  onProjectUpdated?: (project: Project) => void;
}) {
  const router = useRouter();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<ProjectStatus | null>(null);
  const [overFs, setOverFs] = useState<FinancieringStatus | "geen" | null>(
    null
  );
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<KanbanTrack>("alles");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const selectedProject = useMemo(
    () => projecten.find((p) => p.id === selectedId) || null,
    [projecten, selectedId]
  );

  const filteredProjecten = useMemo(
    () => projecten.filter((p) => projectMatchesSearch(p, search)),
    [projecten, search]
  );

  const byStatus = useMemo(() => {
    const map = new Map<ProjectStatus, Project[]>();
    for (const s of PROJECT_STATUSES) map.set(s, []);
    for (const p of filteredProjecten) {
      const key = resolveDisplayProjectStatus(p);
      const list = map.get(key) || map.get("schouwweek_inplannen")!;
      list.push(p);
    }
    return map;
  }, [filteredProjecten]);

  const wfProjecten = useMemo(
    () =>
      filteredProjecten.filter(
        (p) =>
          isWarmtefondsProject(p) &&
          !isParkedStatus(resolveDisplayProjectStatus(p))
      ),
    [filteredProjecten]
  );

  const byFinanciering = useMemo(() => {
    const map = new Map<FinancieringStatus | "geen", Project[]>();
    for (const s of FINANCIERING_KANBAN_ROWS) map.set(s, []);
    map.set("geen", []);
    for (const p of wfProjecten) {
      const raw = resolveFinancieringStatus(p);
      const key =
        (raw ? normalizeFinancieringStatus(raw) : null) || ("geen" as const);
      const bucket = key === "geen" ? "geen" : key;
      const list = map.get(bucket) || map.get("geen")!;
      list.push(p);
    }
    return map;
  }, [wfProjecten]);

  const rows = useMemo(() => {
    if (track === "financiering") return [];

    type RowGroup = {
      key: string;
      fase: ProjectStatusFase;
      label: string;
      statuses: ProjectStatus[];
      /** Filter kaarten op betaalwijze (opstarten EM/WF gesplitst). */
      betaalwijze?: Betaalwijze;
      /** Speciale WF-financieringsrijen in Overzicht */
      kind?: WfSpecialKind;
    };

    const grouped: RowGroup[] = [];

    function pushFaseStatuses(
      key: string,
      fase: ProjectStatusFase,
      label: string,
      statuses: ProjectStatus[],
      betaalwijze?: Betaalwijze
    ) {
      const cleaned = statuses.filter((s) => {
        const def = statusDef(s);
        if (
          (track === "alles" ||
            track === "opstarten_em" ||
            track === "opstarten_wf") &&
          def &&
          !def.inPipeline &&
          (byStatus.get(s)?.length || 0) === 0
        ) {
          return false;
        }
        return true;
      });
      if (cleaned.length === 0) return;
      grouped.push({ key, fase, label, statuses: cleaned, betaalwijze });
    }

    if (track === "opstarten_em") {
      pushFaseStatuses(
        "opstarten_em",
        "voorbereiding",
        "Opstarten EM",
        OPSTARTEN_EM_STATUSES,
        "eigen_middelen"
      );
      return grouped;
    }

    if (track === "opstarten_wf") {
      pushFaseStatuses(
        "opstarten_wf",
        "voorbereiding",
        "Opstarten WF",
        OPSTARTEN_WF_STATUSES,
        "warmtefonds"
      );
      return grouped;
    }

    if (track === "wf_doorgestuurd") {
      grouped.push({
        key: "wf_doorgestuurd",
        fase: "financiering",
        label: "WF — doorgestuurd",
        statuses: [],
        kind: "wf_doorgestuurd",
      });
      return grouped;
    }

    if (track === "wf_contact_verstuurd") {
      grouped.push({
        key: "wf_contact_verstuurd",
        fase: "financiering",
        label: "WF — Contact verstuurd",
        statuses: [],
        kind: "wf_contact_verstuurd",
      });
      return grouped;
    }

    if (track === "wf_in_behandeling") {
      grouped.push({
        key: "wf_in_behandeling",
        fase: "financiering",
        label: "WF — in behandeling",
        statuses: [],
        kind: "wf_in_behandeling",
      });
      return grouped;
    }

    if (track === "wf_afspraak_ingepland") {
      grouped.push({
        key: "wf_afspraak_ingepland",
        fase: "financiering",
        label: "WF — Afspraak ingepland",
        statuses: [],
        kind: "wf_afspraak_ingepland",
      });
      return grouped;
    }

    if (track === "alles") {
      for (const fase of FASE_ORDER) {
        if (fase === "overig") continue;
        if (fase === "voorbereiding") {
          // Opstarten = alleen deze twee rijen
          pushFaseStatuses(
            "opstarten_wf",
            "voorbereiding",
            "Opstarten WF",
            OPSTARTEN_WF_STATUSES,
            "warmtefonds"
          );
          pushFaseStatuses(
            "opstarten_em",
            "voorbereiding",
            "Opstarten EM",
            OPSTARTEN_EM_STATUSES,
            "eigen_middelen"
          );
          continue;
        }
        if (fase === "financiering") {
          // Ná Opstarten: doorgestuurd → contact → afspraak → in behandeling
          grouped.push({
            key: "wf_doorgestuurd",
            fase: "financiering",
            label: "WF — doorgestuurd",
            statuses: [],
            kind: "wf_doorgestuurd",
          });
          grouped.push({
            key: "wf_contact_verstuurd",
            fase: "financiering",
            label: "WF — Contact verstuurd",
            statuses: [],
            kind: "wf_contact_verstuurd",
          });
          grouped.push({
            key: "wf_afspraak_ingepland",
            fase: "financiering",
            label: "WF — Afspraak ingepland",
            statuses: [],
            kind: "wf_afspraak_ingepland",
          });
          grouped.push({
            key: "wf_in_behandeling",
            fase: "financiering",
            label: "WF — in behandeling",
            statuses: [],
            kind: "wf_in_behandeling",
          });
          continue;
        }
        const inFase = PROJECT_STATUSES.filter((s) => {
          if (isParkedStatus(s)) return false;
          if (faseForStatus(s) !== fase) return false;
          const def = statusDef(s);
          if (def && !def.inPipeline && (byStatus.get(s)?.length || 0) === 0) {
            return false;
          }
          return true;
        });
        pushFaseStatuses(fase, fase, faseLabelFor(fase), inFase);
      }
      // Altijd onderaan: Annuleringen + HOLD SALES
      grouped.push({
        key: "annuleringen",
        fase: "overig",
        label: "Annuleringen",
        statuses: ["annulering", "hold_sales_actie"],
      });
      return grouped;
    }

    // Overige fase-tabs (schouw, WF declaratie, installatie, Annuleringen, …)
    if (track === "overig") {
      grouped.push({
        key: "annuleringen",
        fase: "overig",
        label: "Annuleringen",
        statuses: ["annulering", "hold_sales_actie"],
      });
      return grouped;
    }
    const inFase = PROJECT_STATUSES.filter(
      (s) => faseForStatus(s) === (track as ProjectStatusFase)
    );
    pushFaseStatuses(track, track as ProjectStatusFase, faseLabelFor(track as ProjectStatusFase), inFase);
    return grouped;
  }, [track, byStatus]);

  async function patchStatus(project: Project, status: ProjectStatus) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Status bijwerken mislukt");
      onProjectUpdated?.(data.project as Project);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  async function patchFinanciering(
    project: Project,
    financiering_status: FinancieringStatus
  ) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ financiering_status }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Financieringsfase bijwerken mislukt");
      onProjectUpdated?.(data.project as Project);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  function handleDrop(status: ProjectStatus) {
    if (!dragId) return;
    const project = projecten.find((p) => p.id === dragId);
    setDragId(null);
    setOverStatus(null);
    if (!project) return;
    const current = resolveDisplayProjectStatus(project);
    if (current === status) return;
    if (
      status === "annulering" &&
      !window.confirm(
        "Weet je zeker dat je deze order definitief wilt annuleren?"
      )
    ) {
      return;
    }
    void patchStatus(project, status);
  }

  function handleFinancieringDrop(next: FinancieringStatus) {
    if (!dragId) return;
    const project = projecten.find((p) => p.id === dragId);
    setDragId(null);
    setOverFs(null);
    if (!project) return;
    const current =
      normalizeFinancieringStatus(resolveFinancieringStatus(project)) || null;
    if (current === next) return;
    void patchFinanciering(project, next);
  }

  function trackCount(t: KanbanTrack): number {
    if (t === "alles") {
      return filteredProjecten.filter(
        (p) => !isParkedStatus(resolveDisplayProjectStatus(p))
      ).length;
    }
    if (t === "financiering") return wfProjecten.length;
    if (t === "opstarten_em") {
      return filteredProjecten.filter(
        (p) =>
          !isParkedStatus(resolveDisplayProjectStatus(p)) &&
          projectBetaalwijze(p) === "eigen_middelen" &&
          OPSTARTEN_EM_STATUSES.includes(resolveDisplayProjectStatus(p))
      ).length;
    }
    if (t === "opstarten_wf") {
      return filteredProjecten.filter(
        (p) =>
          !isParkedStatus(resolveDisplayProjectStatus(p)) &&
          projectBetaalwijze(p) === "warmtefonds" &&
          OPSTARTEN_WF_STATUSES.includes(resolveDisplayProjectStatus(p)) &&
          isWfNogInOpstarten(p)
      ).length;
    }
    if (t === "wf_doorgestuurd") {
      return filteredProjecten.filter(isWfDoorgestuurd).length;
    }
    if (t === "wf_contact_verstuurd") {
      return filteredProjecten.filter(isWfContactVerstuurd).length;
    }
    if (t === "wf_in_behandeling") {
      return filteredProjecten.filter(isWfInBehandeling).length;
    }
    if (t === "wf_afspraak_ingepland") {
      return filteredProjecten.filter(isWfAfspraakIngepland).length;
    }
    return PROJECT_STATUSES.filter((s) => faseForStatus(s) === t).reduce(
      (n, s) => n + (byStatus.get(s)?.length || 0),
      0
    );
  }

  function itemsForRow(
    status: ProjectStatus,
    betaalwijze?: Betaalwijze
  ): Project[] {
    let items = byStatus.get(status) || [];
    if (betaalwijze) {
      items = items.filter((p) => projectBetaalwijze(p) === betaalwijze);
    }
    // WF in behandeling+ hoort op Financiering, niet in Opstarten WF
    if (betaalwijze === "warmtefonds") {
      items = items.filter(isWfNogInOpstarten);
    }
    return items;
  }

  function opstartenItems(betaalwijze: Betaalwijze): Project[] {
    const statuses =
      betaalwijze === "warmtefonds"
        ? OPSTARTEN_WF_STATUSES
        : OPSTARTEN_EM_STATUSES;
    const seen = new Set<string>();
    const out: Project[] = [];
    for (const s of statuses) {
      for (const p of itemsForRow(s, betaalwijze)) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(p);
      }
    }
    return out;
  }

  function renderCard(
    p: Project,
    opts?: {
      showOrderStatus?: boolean;
      materiaalAction?: boolean;
      showChevron?: boolean;
      showContactPogingen?: boolean;
      showAfspraakAt?: boolean;
    }
  ) {
    const fs = financieringKort(
      normalizeFinancieringStatus(resolveFinancieringStatus(p)) ||
        p.financiering_status ||
        null
    );
    const orderLabel =
      projectStatusLabel[resolveDisplayProjectStatus(p)] || p.status;
    const wfHint = wfNogAfrondenHint(p);
    const showChevron = opts?.showChevron !== false;
    const pogingen = wfContactPogingen(p);
    const afspraakLabel =
      opts?.showAfspraakAt && p.warmtefonds_afspraak_at
        ? formatDateTimeNl(p.warmtefonds_afspraak_at)
        : null;
    return (
      <article
        key={p.id}
        draggable={!busy}
        onDragStart={() => setDragId(p.id)}
        onDragEnd={() => {
          setDragId(null);
          setOverStatus(null);
          setOverFs(null);
        }}
        className={[
          "relative h-12 shrink-0 cursor-grab active:cursor-grabbing",
          afspraakLabel ? "w-[16.5rem]" : "w-[13.5rem]",
          dragId === p.id ? "z-10 opacity-60" : "",
        ].join(" ")}
        title={afspraakLabel ? `WF-afspraak ${afspraakLabel}` : undefined}
      >
        <div
          className={[
            "absolute inset-y-0 left-0 right-2.5 border",
            selectedId === p.id
              ? "border-green bg-green-soft"
              : "border-line bg-[#FAFBFA]",
            dragId === p.id ? "ring-2 ring-green" : "",
          ].join(" ")}
        />
        {/* Driehoek die doorloopt naar de volgende kaart */}
        {showChevron ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-0 z-[1] -translate-y-1/2"
            style={{
              width: 0,
              height: 0,
              borderTop: "24px solid transparent",
              borderBottom: "24px solid transparent",
              borderLeft: "12px solid #E5E8E5",
            }}
          />
        ) : null}
        {showChevron ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-[1px] z-[1] -translate-y-1/2"
            style={{
              width: 0,
              height: 0,
              borderTop: "22px solid transparent",
              borderBottom: "22px solid transparent",
              borderLeft: `11px solid ${
                selectedId === p.id ? "#E8F3EC" : "#FAFBFA"
              }`,
            }}
          />
        ) : null}
        <button
          type="button"
          className="relative z-[2] flex h-full w-[calc(100%-0.65rem)] items-center gap-2 px-2.5 text-left"
          onClick={() => setSelectedId(p.id)}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight text-ink">
              {p.leads?.naam || "—"}
            </p>
            <p className="truncate font-mono text-[11px] leading-tight text-muted">
              {p.project_nummer}
              {afspraakLabel
                ? ` · ${afspraakLabel}`
                : wfHint
                  ? ` · ${wfHint}`
                  : fs && !opts?.showOrderStatus
                    ? ` · ${fs}`
                    : ""}
              {!afspraakLabel && !wfHint && opts?.showOrderStatus
                ? ` · ${orderLabel}`
                : ""}
            </p>
          </div>
          {opts?.showContactPogingen && pogingen > 0 ? (
            <span
              className="shrink-0 rounded-sm bg-[#0F766E] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white"
              title={`${pogingen}× contact geprobeerd`}
            >
              ×{pogingen}
            </span>
          ) : null}
          {opts?.materiaalAction ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setPending({ type: "materiaal", project: p });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setPending({ type: "materiaal", project: p });
                }
              }}
              className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-[#5B21B6]"
              title="Materiaal / offerte PDF"
            >
              PDF
            </span>
          ) : null}
        </button>
      </article>
    );
  }

  function renderStatusRow(
    status: ProjectStatus,
    items: Project[],
    label: string,
    rowKey?: string,
    hint?: string | null
  ) {
    const accent = COLUMN_ACCENT[status] || "#5A6B5E";
    const isOver = overStatus === status;
    const def = statusDef(status);
    const sub =
      hint ||
      (def && !def.inPipeline ? "Legacy · tab Financiering" : null);
    return (
      <div
        key={rowKey || status}
        className={[
          "grid grid-cols-1 border bg-white md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]",
          isOver ? "border-green ring-2 ring-green/25" : "border-line",
        ].join(" ")}
        onDragOver={(e) => {
          e.preventDefault();
          setOverStatus(status);
        }}
        onDragLeave={() => {
          if (overStatus === status) setOverStatus(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          handleDrop(status);
        }}
      >
        <div
          className="flex items-center justify-between gap-2.5 border-b border-line px-3 py-2 md:border-b-0 md:border-r"
          style={{ borderLeft: `4px solid ${accent}` }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <p className="truncate text-[14px] font-semibold leading-snug text-ink">
              {label}
            </p>
            {sub ? <RowInfoTip text={sub} /> : null}
          </div>
          <span
            className="inline-flex min-w-[1.5rem] shrink-0 items-center justify-center px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-white"
            style={{ background: accent }}
          >
            {items.length}
          </span>
        </div>
        <div className="flex min-h-12 items-center gap-0 overflow-x-auto px-2 py-1.5">
          {items.length === 0 ? (
            <p className="px-1.5 text-[13px] text-muted">—</p>
          ) : (
            items.map((p, i) =>
              renderCard(p, {
                materiaalAction: status === "materiaal_besteld",
                // HOLD/annulering is geen orderpad — geen chevron-flow
                showChevron:
                  !isParkedStatus(status) && i < items.length - 1,
              })
            )
          )}
        </div>
      </div>
    );
  }

  const searchActive = search.trim().length > 0;

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex flex-col gap-3 border-b border-line px-5 pb-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-lg">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted/50">
            ⌕
          </span>
          <input
            type="search"
            inputMode="search"
            placeholder="Zoek naam, plaats, e-mail, tel, projectnr, postcode, straat…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-line bg-white py-2.5 pl-8 pr-3 text-sm outline-none transition placeholder:text-muted/60 focus:border-green"
            aria-label="Zoek in projecten"
          />
        </div>
        <p className="shrink-0 text-xs text-muted">
          {searchActive ? (
            <>
              {filteredProjecten.length} van {projecten.length} project
              {projecten.length === 1 ? "" : "en"}
            </>
          ) : (
            <>
              {projecten.length} project{projecten.length === 1 ? "" : "en"}
            </>
          )}
        </p>
      </div>
      <div className="border-b border-line px-5">
        <div className="flex gap-0 overflow-x-auto">
          {KANBAN_TRACKS.map((t) => {
            const active = track === t.id;
            const count = trackCount(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTrack(t.id)}
                className={[
                  "relative shrink-0 px-3.5 py-3 text-sm font-semibold uppercase tracking-wide transition-colors",
                  active ? "text-green-deeper" : "text-muted hover:text-ink",
                ].join(" ")}
              >
                {t.label}
                <span className="ml-1.5 tabular-nums text-[12px] opacity-70">
                  ({count})
                </span>
                {active ? (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 bg-green" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      {error && (
        <p className="mx-5 border border-[#C45A12]/30 bg-[#FFF0E6] px-3.5 py-2.5 text-sm text-[#C45A12]">
          {error}
        </p>
      )}

      {track === "financiering" ? (
        <>
          <p className="mx-5 border border-[#E8D48B] bg-[#FFFBEB] px-3.5 py-2.5 text-sm text-[#92400E]">
            Dit is het <span className="font-semibold">parallelle WF-pad</span>.
            De orderstatus blijft vaak op{" "}
            <span className="font-semibold">Afwachten WF</span> (tab Opstarten)
            terwijl je hier de financieringsfase verschuift. Sleep omhoog/omlaag
            om de fase te zetten.
          </p>
          <div className="space-y-2 px-5">
            {(
              (byFinanciering.get("geen")?.length || 0) > 0
                ? (["geen", ...FINANCIERING_KANBAN_ROWS] as const)
                : FINANCIERING_KANBAN_ROWS
            ).map((rowKey) => {
              const items = byFinanciering.get(rowKey) || [];
              const isGeen = rowKey === "geen";
              const accent = isGeen
                ? "#6B7C72"
                : rowKey === "afgewezen"
                  ? "#C62828"
                  : rowKey === "uitbetaald"
                    ? "#0D5C32"
                    : "#1A4A6E";
              const label = isGeen
                ? "Nog geen WF-fase"
                : FINANCIERING_STATUS_LABEL[rowKey];
              const isOver = overFs === rowKey;
              return (
                <div
                  key={rowKey}
                  className={[
                    "grid grid-cols-1 border bg-white md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]",
                    isOver
                      ? "border-green ring-2 ring-green/25"
                      : "border-line",
                  ].join(" ")}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverFs(rowKey);
                  }}
                  onDragLeave={() => {
                    if (overFs === rowKey) setOverFs(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (isGeen) {
                      setDragId(null);
                      setOverFs(null);
                      return;
                    }
                    handleFinancieringDrop(rowKey);
                  }}
                >
                  <div
                    className="flex items-center justify-between gap-2.5 border-b border-line px-3 py-2 md:border-b-0 md:border-r"
                    style={{ borderLeft: `4px solid ${accent}` }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <p className="truncate text-[14px] font-semibold leading-snug text-ink">
                        {label}
                      </p>
                      {isGeen ? (
                        <RowInfoTip text="Sleep naar een fase" />
                      ) : null}
                    </div>
                    <span
                      className="inline-flex min-w-[1.5rem] shrink-0 items-center justify-center px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-white"
                      style={{ background: accent }}
                    >
                      {items.length}
                    </span>
                  </div>
                  <div className="flex min-h-12 items-center gap-0 overflow-x-auto px-2 py-1.5">
                    {items.length === 0 ? (
                      <p className="px-1.5 text-[13px] text-muted">—</p>
                    ) : (
                      items.map((p, i) =>
                        renderCard(p, {
                          showOrderStatus: true,
                          showChevron: i < items.length - 1,
                          showContactPogingen: rowKey === "contact_verstuurd",
                        })
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="space-y-4 px-5">
          {rows.map((group) => {
            if (
              group.kind === "wf_doorgestuurd" ||
              group.kind === "wf_contact_verstuurd" ||
              group.kind === "wf_in_behandeling" ||
              group.kind === "wf_afspraak_ingepland"
            ) {
              const wfMeta =
                group.kind === "wf_doorgestuurd"
                  ? {
                      match: isWfDoorgestuurd,
                      dropFs: "doorgestuurd_naar_edwin" as FinancieringStatus | null,
                      accent: "#1A4A6E",
                      hint: "Ná Opstarten WF · doorgestuurd / documenten · daarna: contact",
                      sort: null as ((a: Project, b: Project) => number) | null,
                      showContactPogingen: false,
                      showAfspraakAt: false,
                    }
                  : group.kind === "wf_contact_verstuurd"
                    ? {
                        match: isWfContactVerstuurd,
                        dropFs: "contact_verstuurd" as FinancieringStatus | null,
                        accent: "#0F766E",
                        hint: "Contact via WF-portaal · badge ×1 / ×2 = aantal pogingen",
                        sort: null as ((a: Project, b: Project) => number) | null,
                        showContactPogingen: true,
                        showAfspraakAt: false,
                      }
                    : group.kind === "wf_in_behandeling"
                      ? {
                          match: isWfInBehandeling,
                          dropFs: "in_behandeling" as FinancieringStatus | null,
                          accent: "#CA8A04",
                          hint: "Alleen WF-route · Warmtefonds beoordeelt",
                          sort: null as ((a: Project, b: Project) => number) | null,
                          showContactPogingen: false,
                          showAfspraakAt: false,
                        }
                      : {
                          match: isWfAfspraakIngepland,
                          dropFs: null as FinancieringStatus | null,
                          accent: "#1D4ED8",
                          hint: "WF-afspraak gezet · links eerstvolgende, rechts later in de tijd",
                          sort: sortByWfAfspraakAsc,
                          showContactPogingen: false,
                          showAfspraakAt: true,
                        };
              const items = filteredProjecten
                .filter(wfMeta.match)
                .slice()
                .sort(wfMeta.sort || (() => 0));
              const dropFs = wfMeta.dropFs;
              const accent = wfMeta.accent;
              const hint = wfMeta.hint;
              const isOver = dropFs != null && overFs === dropFs;
              const financieringCount =
                filteredProjecten.filter(isWfDoorgestuurd).length +
                filteredProjecten.filter(isWfContactVerstuurd).length +
                filteredProjecten.filter(isWfInBehandeling).length +
                filteredProjecten.filter(isWfAfspraakIngepland).length;
              return (
                <section key={group.key} className="space-y-2.5">
                  {track === "alles" && group.kind === "wf_doorgestuurd" ? (
                    <div className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
                      <h3 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted">
                        Financiering
                      </h3>
                      <span className="text-[13px] tabular-nums text-muted">
                        {financieringCount}
                      </span>
                    </div>
                  ) : null}
                  <div
                    className={[
                      "grid grid-cols-1 border bg-white md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]",
                      isOver
                        ? "border-green ring-2 ring-green/25"
                        : "border-line",
                    ].join(" ")}
                    onDragOver={(e) => {
                      if (!dropFs) return;
                      e.preventDefault();
                      setOverFs(dropFs);
                    }}
                    onDragLeave={() => {
                      if (dropFs && overFs === dropFs) setOverFs(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!dropFs) {
                        setDragId(null);
                        setOverFs(null);
                        return;
                      }
                      handleFinancieringDrop(dropFs);
                    }}
                  >
                    <div
                      className="flex items-center justify-between gap-2.5 border-b border-line px-3 py-2 md:border-b-0 md:border-r"
                      style={{ borderLeft: `4px solid ${accent}` }}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <p className="truncate text-[14px] font-semibold leading-snug text-ink">
                          {group.label}
                        </p>
                        <RowInfoTip text={hint} />
                      </div>
                      <span
                        className="inline-flex min-w-[1.5rem] shrink-0 items-center justify-center px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-white"
                        style={{ background: accent }}
                      >
                        {items.length}
                      </span>
                    </div>
                    <div className="flex min-h-12 items-center gap-0 overflow-x-auto px-2 py-1.5">
                      {items.length === 0 ? (
                        <p className="px-1.5 text-[13px] text-muted">—</p>
                      ) : (
                        items.map((p, i) =>
                          renderCard(p, {
                            showOrderStatus: true,
                            showChevron: i < items.length - 1,
                            showContactPogingen: wfMeta.showContactPogingen,
                            showAfspraakAt: wfMeta.showAfspraakAt,
                          })
                        )
                      )}
                    </div>
                  </div>
                </section>
              );
            }

            const isOpstartenSplit =
              group.key === "opstarten_em" || group.key === "opstarten_wf";

            // Eén rij per opstart-pad — altijd tonen in Overzicht (ook leeg)
            if (isOpstartenSplit && group.betaalwijze) {
              const items = opstartenItems(group.betaalwijze);
              const hint =
                group.betaalwijze === "warmtefonds"
                  ? "Kickoff · nog geen WF-fase · daarna: WF doorgestuurd → contact"
                  : "Afwachten aanbetaling → daarna schouwdag (geen WF)";
              return (
                <section key={group.key} className="space-y-2">
                  {renderStatusRow(
                    "schouwweek_inplannen",
                    items,
                    group.label,
                    group.key,
                    hint
                  )}
                </section>
              );
            }

            const groupCount = group.statuses.reduce(
              (n, s) => n + itemsForRow(s, group.betaalwijze).length,
              0
            );
            return (
              <section key={group.key} className="space-y-2.5">
                {track === "alles" ? (
                  <div className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
                    <h3 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted">
                      {group.label}
                    </h3>
                    <span className="text-[13px] tabular-nums text-muted">
                      {groupCount}
                    </span>
                  </div>
                ) : null}

                <div className="space-y-2">
                  {group.statuses.map((status) => {
                    const items = itemsForRow(status, group.betaalwijze);
                    const { label, hint } = kanbanStatusCopy(
                      status,
                      group.fase,
                      group.betaalwijze
                    );
                    return renderStatusRow(
                      status,
                      items,
                      label,
                      undefined,
                      hint
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {selectedProject ? (
        <KanbanActieDrawer
          project={selectedProject}
          facturen={facturen}
          onClose={() => setSelectedId(null)}
          onProjectUpdated={onProjectUpdated}
          onOpenProject={() => {
            rememberCrmReturnUrl();
            router.push(`/projecten/${selectedProject.id}?from=kanban`);
          }}
          onStatusChange={(status) => {
            void patchStatus(selectedProject, status);
          }}
          onPlanSchouwdag={() => {
            setPending({ type: "schouwdag", project: selectedProject });
          }}
        />
      ) : null}

      {pending?.type === "schouwweek" && (
        <SchouwweekModal
          project={pending.project}
          busy={busy}
          onClose={() => setPending(null)}
          onSave={async (jaar, week) => {
            setBusy(true);
            setError(null);
            try {
              const res = await fetch(`/api/projecten/${pending.project.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  status: "schouwweek_inplannen",
                  schouw_jaar: jaar,
                  schouw_week: week,
                }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
              onProjectUpdated?.(data.project as Project);
              setPending(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Fout");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {pending?.type === "schouwdag" && (
        <SchouwdagModal
          project={pending.project}
          busy={busy}
          onClose={() => setPending(null)}
          onSave={async (payload) => {
            setBusy(true);
            setError(null);
            try {
              const res = await fetch(
                `/api/projecten/${pending.project.id}/schouw`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(payload),
                }
              );
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Schouw plannen mislukt");
              if (data.project) onProjectUpdated?.(data.project as Project);
              setPending(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Fout");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {pending?.type === "materiaal" && (
        <MateriaalModal
          project={pending.project}
          onClose={() => setPending(null)}
          onUpdated={(p) => {
            onProjectUpdated?.(p);
            setPending({ type: "materiaal", project: p });
          }}
        />
      )}
    </div>
  );
}

function KanbanActieDrawer({
  project,
  facturen,
  onClose,
  onProjectUpdated,
  onOpenProject,
  onStatusChange,
  onPlanSchouwdag,
}: {
  project: Project;
  facturen: Factuur[];
  onClose: () => void;
  onProjectUpdated?: (project: Project) => void;
  onOpenProject: () => void;
  onStatusChange: (status: ProjectStatus) => void;
  onPlanSchouwdag: () => void;
}) {
  const [taken, setTaken] = useState<ProjectTaak[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyTaakId, setBusyTaakId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const relatedFacturen = useMemo(
    () =>
      facturen.filter(
        (f) =>
          f.project_id === project.id ||
          (!f.project_id && f.lead_id === project.lead_id)
      ),
    [facturen, project.id, project.lead_id]
  );

  const stap = useMemo(
    () => resolveProjectVolgendeStap(project, new Date(), relatedFacturen),
    [project, relatedFacturen]
  );

  const orderStatus = resolveDisplayProjectStatus(project);
  const isParked = isParkedStatus(orderStatus);
  const isAnnulering = orderStatus === "annulering";
  const parkedFacturen = useMemo(() => {
    if (!isParked) return [];
    return relatedFacturen.filter((f) => {
      const st = (f.status || "").toLowerCase();
      return st === "verzonden" || st === "betaald" || st === "deels_betaald";
    });
  }, [isParked, relatedFacturen]);
  const fs =
    normalizeFinancieringStatus(resolveFinancieringStatus(project)) || null;
  const fsLabel = fs ? FINANCIERING_STATUS_LABEL[fs] : null;

  const showPurchasingInfo =
    orderStatus === "installatie_ingepland" ||
    orderStatus === "materiaal_besteld";

  const batterijStatus = useMemo(
    () => batterijPurchasingStatus(project.materiaal_checks),
    [project.materiaal_checks]
  );
  const purchasingMeta = useMemo(() => {
    if (!showPurchasingInfo) return null;
    const installAt = project.installatie_at
      ? new Date(project.installatie_at)
      : null;
    const bestelDeadline =
      installAt && !Number.isNaN(installAt.getTime())
        ? bestelDeadlineVoorInstallatie(installAt)
        : null;
    const bestelOverdue = bestelDeadline
      ? bestelDeadline.getTime() < Date.now()
      : false;
    const nogTeBestellen = materiaalNogTeBestellen(project);
    const checks = project.materiaal_checks || {};
    const productEntries = Object.entries(checks).filter(([key]) => {
      if (key.startsWith("__")) return false;
      if (key.startsWith(INKOOP_NOTE_PREFIX)) return false;
      return true;
    });
    const activeStatuses = productEntries
      .map(([, v]) => parseInkoopRegelStatus(v))
      .filter((s) => s !== "geannuleerd");
    const afgevinktCount = activeStatuses.filter(
      (s) => s === "besteld" || s === "geleverd"
    ).length;
    const alleProductenAfgevinkt =
      activeStatuses.length > 0 && afgevinktCount === activeStatuses.length;
    const leverancier = parseInkoopLeverancierStatus(
      project.inkoop_leverancier_status
    );
    const extra = getInkoopExtraNotities(project.materiaal_checks);
    return {
      installLabel: installAt ? formatDateTimeNl(installAt) : null,
      bestelLabel: bestelDeadline ? formatDateNl(bestelDeadline) : null,
      bestelOverdue,
      nogTeBestellen,
      alleProductenAfgevinkt,
      afgevinktLabel:
        activeStatuses.length === 0
          ? "geen producten"
          : `${afgevinktCount}/${activeStatuses.length}`,
      leverancierLabel: INKOOP_LEVERANCIER_STATUS_LABEL[leverancier],
      leveradres: (project.leveradres || adresRegel(project) || "").trim(),
      partner:
        project.installatie_partners?.naam || project.monteur || null,
      extra,
    };
  }, [showPurchasingInfo, project]);

  const loadTaken = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await fetch(`/api/taken/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: project.id }),
      }).catch(() => null);
      const res = await fetch(`/api/taken?project_id=${project.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Taken laden mislukt"
        );
      }
      setTaken(((data as { taken?: ProjectTaak[] }).taken || []).filter(
        (t) => t.status !== "done"
      ));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void loadTaken();
  }, [loadTaken]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function completeTaak(taak: ProjectTaak) {
    setBusyTaakId(taak.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/taken/${taak.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Taak afronden mislukt"
        );
      }
      setTaken((prev) => prev.filter((t) => t.id !== taak.id));
      const updated = (data as { project?: Project }).project;
      if (updated) {
        onProjectUpdated?.(updated);
        setMsg(
          updated.financiering_status === "in_behandeling"
            ? "Afspraak voltooid — WF staat op in behandeling."
            : "Actie afgerond."
        );
      } else {
        setMsg("Actie afgerond.");
      }
      void loadTaken();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Fout");
    } finally {
      setBusyTaakId(null);
    }
  }

  async function handleStapActie() {
    if (!stap?.actie) return;
    if (stap.actie.kind === "status") {
      onStatusChange(stap.actie.status as ProjectStatus);
      return;
    }
    if (stap.actie.kind === "financiering") {
      setBusyTaakId("__financiering__");
      setMsg(null);
      try {
        const res = await fetch(`/api/projecten/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            financiering_status: stap.actie.financiering_status,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error ||
              "Financieringsfase bijwerken mislukt"
          );
        }
        if ((data as { project?: Project }).project) {
          onProjectUpdated?.((data as { project: Project }).project);
        }
        setMsg(
          stap.actie.financiering_status === "in_behandeling"
            ? "WF-afspraak voltooid — fase staat op in behandeling."
            : "Financieringsfase bijgewerkt."
        );
        void loadTaken();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Fout");
      } finally {
        setBusyTaakId(null);
      }
      return;
    }
    if (stap.actie.kind === "anchor") {
      if (stap.actie.openSoort === "schouwdag") {
        onPlanSchouwdag();
        return;
      }
      if (stap.actie.href.includes("tab=purchasing")) {
        window.location.assign(stap.actie.href);
        return;
      }
    }
    onOpenProject();
  }

  const isWachten =
    Boolean(stap) &&
    (stap!.eyebrow === "Wachten" || Boolean(stap!.wachtOp && !stap!.actie));

  const leadPlaats = project.leads?.plaats?.trim() || null;
  const leadEmail = project.leads?.email?.trim() || null;
  const leadTel = project.leads?.telefoon?.trim() || null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Sluiten"
        className="absolute inset-0 bg-black/25"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-white shadow-xl">
        <div
          className={[
            "flex items-start justify-between gap-3 border-b px-4 py-3",
            isAnnulering
              ? "border-[#FECACA] bg-[#FEF2F2]"
              : isParked
                ? "border-[#DDD6FE] bg-[#F5F3FF]"
                : "border-line bg-white",
          ].join(" ")}
        >
          <div className="min-w-0">
            <p
              className={[
                "font-mono text-[10px] font-semibold",
                isAnnulering
                  ? "text-[#991B1B]"
                  : isParked
                    ? "text-[#5B21B6]"
                    : "text-green-dark",
              ].join(" ")}
            >
              {project.project_nummer}
            </p>
            <h2 className="truncate text-base font-semibold text-ink">
              {project.leads?.naam || "—"}
            </h2>
            {leadPlaats || leadEmail || leadTel ? (
              <div className="mt-1 space-y-0.5 text-[11px] text-muted">
                {leadPlaats ? (
                  <p className="truncate">
                    <span className="text-muted/70">Plaats · </span>
                    {leadPlaats}
                  </p>
                ) : null}
                {leadEmail ? (
                  <p className="truncate">
                    <span className="text-muted/70">E-mail · </span>
                    <a
                      href={`mailto:${leadEmail}`}
                      className="text-ink hover:text-green-dark hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {leadEmail}
                    </a>
                  </p>
                ) : null}
                {leadTel ? (
                  <p className="truncate">
                    <span className="text-muted/70">Tel · </span>
                    <a
                      href={`tel:${leadTel.replace(/\s/g, "")}`}
                      className="text-ink hover:text-green-dark hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {leadTel}
                    </a>
                  </p>
                ) : null}
              </div>
            ) : null}
            <p
              className={[
                "mt-0.5 truncate text-[11px] font-medium",
                isAnnulering
                  ? "text-[#B91C1C]"
                  : isParked
                    ? "text-[#6D28D9]"
                    : "text-muted",
              ].join(" ")}
            >
              {isAnnulering
                ? "Geannuleerd · geen orderpad"
                : isParked
                  ? "HOLD · buiten orderpad"
                  : `${projectStatusLabel[orderStatus] || project.status}${
                      fsLabel ? ` · WF ${fsLabel}` : ""
                    }`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 border border-line bg-white px-2.5 py-1.5 text-sm text-muted hover:bg-wash"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {isParked ? (
            <section
              className={[
                "border px-3.5 py-3",
                isAnnulering
                  ? "border-[#FECACA] bg-[#FEF2F2]"
                  : "border-[#DDD6FE] bg-[#F5F3FF]",
              ].join(" ")}
            >
              <p
                className={[
                  "text-[10px] font-semibold uppercase tracking-[0.1em]",
                  isAnnulering ? "text-[#B91C1C]" : "text-[#6D28D9]",
                ].join(" ")}
              >
                {isAnnulering ? "Annulering" : "HOLD sales actie"}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {isAnnulering
                  ? "Order gestopt — alleen afronden wat nog open staat"
                  : "Order geparkeerd — wacht op sales"}
              </p>
              <p className="mt-1.5 text-xs text-ink/85">
                {isAnnulering
                  ? "Geen volgende installatie- of schouwstap. Check open taken (bijv. creditfactuur) en sluit het dossier af."
                  : "Geen BO-orderstappen tot sales de HOLD opheft. Open taken hieronder blijven wel zichtbaar."}
              </p>
              {fsLabel ? (
                <p className="mt-2 text-[11px] text-muted">
                  WF-status bij annulering/HOLD: {fsLabel}
                </p>
              ) : null}
              {parkedFacturen.length > 0 ? (
                <div className="mt-3 border-t border-black/10 pt-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Facturen om te checken
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {parkedFacturen.slice(0, 4).map((f) => (
                      <li
                        key={f.id}
                        className="flex items-baseline justify-between gap-2 text-xs"
                      >
                        <span className="truncate font-mono text-ink">
                          {f.factuur_nummer || f.id.slice(0, 8)}
                        </span>
                        <span className="shrink-0 text-muted">
                          {f.status}
                          {typeof f.bedrag_inc_btw === "number"
                            ? ` · ${formatEuro(f.bedrag_inc_btw)}`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : (
            <section
              className={[
                "border px-3.5 py-3",
                stap?.overdue
                  ? "border-[#FDBA74]/70 bg-[#FFF7ED]"
                  : isWachten
                    ? "border-[#94A3B8]/50 bg-[#F8FAFC]"
                    : stap?.urgent
                      ? "border-[#0D9488]/30 bg-[#F0FDFA]"
                      : stap
                        ? "border-line bg-white"
                        : "border-dashed border-line bg-wash/40",
              ].join(" ")}
            >
              <div className="flex items-start gap-2.5">
                {isWachten ? (
                  <span
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-[#CBD5E1] bg-white text-[#64748B]"
                    aria-hidden
                  >
                    <Clock className="h-4 w-4" strokeWidth={2.25} />
                  </span>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p
                    className={[
                      "text-[10px] font-semibold uppercase tracking-[0.1em]",
                      stap?.overdue
                        ? "text-[#C45A12]"
                        : isWachten
                          ? "text-[#64748B]"
                          : stap?.urgent
                            ? "text-[#0F766E]"
                            : "text-muted",
                    ].join(" ")}
                  >
                    {isWachten
                      ? "Afwachten — geen actie nu"
                      : stap?.eyebrow || "Volgende actie"}
                  </p>
                  {stap ? (
                    <>
                      <p className="mt-1 text-sm font-semibold text-ink">
                        {stap.titel}
                      </p>
                      {isWachten ? (
                        <p className="mt-1.5 text-[11px] font-medium text-[#64748B]">
                          Niets te doen tot de voorwaarde klaar is.
                        </p>
                      ) : null}
                      {stap.parallel && stap.parallel.length > 0 ? (
                        <div className="mt-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                            Parallel
                          </p>
                          <ul className="mt-1 space-y-0.5 text-xs">
                            {stap.parallel.map((row) => (
                              <li
                                key={row.label}
                                className={
                                  row.ok
                                    ? "font-medium text-green-dark"
                                    : "text-ink/85"
                                }
                              >
                                {row.ok ? "✓" : "○"} {row.label}
                                {row.ok ? " — gedaan" : " — nog open"}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {stap.voorwaarden && stap.voorwaarden.length > 0 ? (
                        <div className="mt-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                            Voorwaarden
                          </p>
                          <ul className="mt-1 space-y-0.5 text-xs">
                            {stap.voorwaarden.map((row) => (
                              <li
                                key={row.label}
                                className={
                                  row.ok
                                    ? "font-medium text-green-dark"
                                    : "font-medium text-[#C45A12]"
                                }
                              >
                                {row.ok ? "✓" : "○"} {row.label}
                                {row.ok ? " — bereikt" : " — nog niet"}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {stap.wachtOp || stap.volgendeDaarna ? (
                        <dl className="mt-2 space-y-1.5 text-xs">
                          {stap.wachtOp ? (
                            <div>
                              <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                                Nodig voor volgende stap
                              </dt>
                              <dd className="mt-0.5 text-ink/90">
                                {stap.wachtOp}
                              </dd>
                            </div>
                          ) : null}
                          {stap.volgendeDaarna ? (
                            <div>
                              <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                                Volgende stap daarna
                              </dt>
                              <dd className="mt-0.5 font-medium text-ink">
                                {stap.volgendeDaarna}
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                      ) : null}
                      {stap.actie ? (
                        <button
                          type="button"
                          disabled={busyTaakId === "__financiering__"}
                          onClick={() => void handleStapActie()}
                          className={[
                            "mt-3 px-3 py-2 text-xs font-semibold disabled:opacity-50",
                            stap.overdue
                              ? "bg-[#C45A12] text-white hover:bg-[#A84A0E]"
                              : stap.urgent
                                ? "bg-[#0D9488] text-white hover:bg-[#0F766E]"
                                : "border border-[#0D9488] bg-[#F0FDFA] text-[#115E59] hover:bg-[#CCFBF1]",
                          ].join(" ")}
                        >
                          {busyTaakId === "__financiering__"
                            ? "Bezig…"
                            : stap.actie.label}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-muted">
                      Geen openstaande volgende stap voor dit project.
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Extra toelichting onder Volgende actie */}
          {!isParked && stap ? (
            <section className="border border-line bg-wash/30 px-3.5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                Toelichting
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink/90">
                {stap.reden}
              </p>
              <p
                className={[
                  "mt-2 text-xs font-medium",
                  stap.overdue ? "text-[#C45A12]" : "text-muted",
                ].join(" ")}
              >
                Uiterlijk · {stap.uiterlijkLabel}
              </p>
              <dl className="mt-3 space-y-1.5 border-t border-line pt-2.5 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Orderstatus</dt>
                  <dd className="text-right font-medium text-ink">
                    {projectStatusLabel[orderStatus] || project.status}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Route</dt>
                  <dd className="text-right font-medium text-ink">
                    {projectBetaalwijze(project) === "eigen_middelen"
                      ? "Eigen middelen"
                      : "Warmtefonds"}
                  </dd>
                </div>
                {fsLabel ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">WF-fase</dt>
                    <dd className="text-right font-medium text-ink">
                      {fsLabel}
                    </dd>
                  </div>
                ) : null}
                {project.schouw_at ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Schouwdag</dt>
                    <dd className="text-right font-medium text-ink">
                      {formatDateTimeNl(project.schouw_at)}
                    </dd>
                  </div>
                ) : null}
                {project.schouw_jaar && project.schouw_week ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Schouwweek (indicatie)</dt>
                    <dd className="text-right font-medium text-ink">
                      {formatSchouwWeekLabel(
                        project.schouw_jaar,
                        project.schouw_week
                      ) || `Week ${project.schouw_week}`}
                    </dd>
                  </div>
                ) : null}
                {project.installatie_at ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Installatie</dt>
                    <dd className="text-right font-medium text-ink">
                      {formatDateTimeNl(project.installatie_at)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null}

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                {isParked
                  ? `Nog afronden${taken.length > 0 ? ` (${taken.length})` : ""}`
                  : `Open taken${taken.length > 0 ? ` (${taken.length})` : ""}`}
              </h3>
              <button
                type="button"
                onClick={() => void loadTaken()}
                className="text-[10px] font-semibold text-green-dark hover:underline"
              >
                Vernieuwen
              </button>
            </div>
            {loading ? (
              <p className="text-xs text-muted">Taken laden…</p>
            ) : loadError ? (
              <p className="text-xs text-[#C45A12]">{loadError}</p>
            ) : taken.length === 0 ? (
              <p className="border border-dashed border-line bg-wash/40 px-3 py-3 text-xs text-muted">
                {isParked
                  ? isAnnulering
                    ? "Geen open cleanup-taken — dossier kan dicht."
                    : "Geen open taken tijdens HOLD."
                  : "Geen openstaande taken."}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {taken.map((t) => {
                  const overdue =
                    t.due_at && new Date(t.due_at).getTime() < Date.now();
                  const ctx = contextVoorOpenTaak(t, project, facturen);
                  return (
                    <li
                      key={t.id}
                      className="border border-line bg-[#FAFBFA] px-3 py-2.5"
                    >
                      <p className="text-sm font-semibold text-ink">
                        {t.titel}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted">
                        {t.afdeling}
                        {t.due_at
                          ? ` · ${formatDateTimeNl(t.due_at)}`
                          : ""}
                        {overdue ? " · te laat" : ""}
                      </p>
                      {ctx.parallel.length > 0 ? (
                        <div className="mt-2 border-t border-line/80 pt-2">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                            Parallel
                          </p>
                          <ul className="mt-1 space-y-0.5 text-[11px]">
                            {ctx.parallel.map((row) => (
                              <li
                                key={row.label}
                                className={
                                  row.ok
                                    ? "text-green-dark"
                                    : "text-ink/80"
                                }
                              >
                                {row.ok ? "✓" : "○"} {row.label}
                                {row.ok ? " — gedaan" : " — nog open"}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {ctx.voorwaarden.length > 0 ? (
                        <div
                          className={
                            ctx.parallel.length > 0
                              ? "mt-2"
                              : "mt-2 border-t border-line/80 pt-2"
                          }
                        >
                          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                            Voorwaarden
                          </p>
                          <ul className="mt-1 space-y-0.5 text-[11px]">
                            {ctx.voorwaarden.map((row) => (
                              <li
                                key={row.label}
                                className={
                                  row.ok
                                    ? "text-green-dark"
                                    : "font-medium text-[#C45A12]"
                                }
                              >
                                {row.ok ? "✓" : "○"} {row.label}
                                {row.ok ? " — bereikt" : " — nog niet"}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        disabled={busyTaakId === t.id}
                        onClick={() => void completeTaak(t)}
                        className="mt-2 border border-green bg-green-soft px-2.5 py-1 text-[11px] font-semibold text-green-dark hover:bg-[#d8ebe0] disabled:opacity-60"
                      >
                        {busyTaakId === t.id ? "Bezig…" : "Afronden"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {msg ? (
              <p className="mt-2 text-xs text-muted">{msg}</p>
            ) : null}
          </section>

          {showPurchasingInfo && purchasingMeta ? (
            <section className="border border-line bg-white px-3.5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                Purchasing info
              </p>
              <dl className="mt-2 space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Alle producten afgevinkt</dt>
                  <dd
                    className={[
                      "text-right font-semibold",
                      purchasingMeta.alleProductenAfgevinkt
                        ? "text-green-dark"
                        : "text-[#C45A12]",
                    ].join(" ")}
                  >
                    {purchasingMeta.alleProductenAfgevinkt
                      ? "ja"
                      : `nee · ${purchasingMeta.afgevinktLabel}`}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Installatie</dt>
                  <dd className="text-right font-medium text-ink">
                    {purchasingMeta.installLabel || "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">
                    Bestellen vóór ({INKOOP_DAGEN_VOOR_INSTALLATIE} wd)
                  </dt>
                  <dd
                    className={[
                      "text-right font-medium",
                      purchasingMeta.bestelOverdue &&
                      purchasingMeta.nogTeBestellen
                        ? "text-[#C45A12]"
                        : "text-ink",
                    ].join(" ")}
                  >
                    {purchasingMeta.bestelLabel || "—"}
                    {purchasingMeta.bestelOverdue &&
                    purchasingMeta.nogTeBestellen
                      ? " · te laat"
                      : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Batterij besteld</dt>
                  <dd
                    className={[
                      "text-right font-semibold",
                      batterijStatus.besteld
                        ? "text-green-dark"
                        : "text-[#C45A12]",
                    ].join(" ")}
                  >
                    {batterijStatus.besteld ? "ja" : "nee"}
                    {purchasingMeta.nogTeBestellen && !batterijStatus.besteld
                      ? " · nog te bestellen"
                      : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Batterij geleverd</dt>
                  <dd
                    className={[
                      "text-right font-semibold",
                      batterijStatus.geleverd
                        ? "text-green-dark"
                        : "text-muted",
                    ].join(" ")}
                  >
                    {batterijStatus.geleverd ? "ja" : "nee"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Leverancierbetaling</dt>
                  <dd className="text-right font-medium text-ink">
                    {purchasingMeta.leverancierLabel}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Partner</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {purchasingMeta.partner || "Nog geen partner"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Leveradres</dt>
                  <dd className="mt-0.5 whitespace-pre-line font-medium text-ink">
                    {purchasingMeta.leveradres || "—"}
                  </dd>
                </div>
                {purchasingMeta.extra ? (
                  <div>
                    <dt className="text-muted">Inkoopnotities</dt>
                    <dd className="mt-0.5 whitespace-pre-line text-ink">
                      {purchasingMeta.extra}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <a
                href="/?tab=purchasing"
                className="mt-3 inline-block text-[11px] font-semibold text-green-dark hover:underline"
              >
                Open Purchasing →
              </a>
            </section>
          ) : null}
        </div>

        <div className="flex gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onOpenProject}
            className="flex-1 bg-orange px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c]"
          >
            Open dossier
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-line px-3 py-2.5 text-sm font-semibold text-muted hover:bg-wash"
          >
            Sluiten
          </button>
        </div>
      </aside>
    </div>
  );
}

function SchouwweekModal({
  project,
  busy,
  onClose,
  onSave,
}: {
  project: Project;
  busy: boolean;
  onClose: () => void;
  onSave: (jaar: number, week: number) => void;
}) {
  const options = useMemo(() => upcomingSchouwWeekOptions(52), []);
  const [value, setValue] = useState(() => {
    if (project.schouw_jaar && project.schouw_week) {
      return `${project.schouw_jaar}-W${String(project.schouw_week).padStart(2, "0")}`;
    }
    return options[0]?.value || "";
  });

  return (
    <ModalShell title="Schouwweek kiezen" onClose={onClose}>
      <p className="text-sm text-muted">
        {project.leads?.naam || project.project_nummer} — kies de week voor de
        schouw. Vanaf 7 dagen vóór die week komt het project automatisch in
        “Schouwdag plannen”.
      </p>
      <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-muted">
        Schouwweek
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const p = parseSchouwWeekValue(value);
            if (p) onSave(p.jaar, p.week);
          }}
          className="flex-1 bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
        >
          Opslaan
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 border border-line px-4 py-2.5 text-sm font-semibold text-muted hover:bg-wash"
        >
          Annuleren
        </button>
      </div>
    </ModalShell>
  );
}

function SchouwdagModal({
  project,
  busy,
  onClose,
  onSave,
}: {
  project: Project;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: {
    schouw_at: string;
    installatie_partner_id: string;
    schouw_notities?: string;
  }) => void;
}) {
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [partnerId, setPartnerId] = useState(
    project.installatie_partner_id || ""
  );
  const [schouwAt, setSchouwAt] = useState(
    toDatetimeLocalValue(project.schouw_at)
  );
  const [notities, setNotities] = useState(project.schouw_notities || "");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/installatie-partners");
        const data = await res.json();
        if (!cancelled) setPartners(data.partners || data.items || []);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ModalShell title="Schouwdag plannen + mail" onClose={onClose}>
      <p className="text-sm text-muted">
        Zet datum/tijd voor de schouw. De klant (en partner) krijgen een mail
        met de afspraak.
      </p>
      <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-muted">
        Datum & tijd
        <input
          type="datetime-local"
          value={schouwAt}
          onChange={(e) => setSchouwAt(e.target.value)}
          className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
        />
      </label>
      <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-muted">
        Installatiepartner
        <select
          value={partnerId}
          onChange={(e) => setPartnerId(e.target.value)}
          className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
        >
          <option value="">Kies partner…</option>
          {partners
            .filter((p) => p.actief !== false)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.naam}
              </option>
            ))}
        </select>
      </label>
      <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-muted">
        Notitie (optioneel)
        <textarea
          value={notities}
          onChange={(e) => setNotities(e.target.value)}
          rows={2}
          className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
        />
      </label>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          disabled={busy || !schouwAt || !partnerId}
          onClick={() => {
            const d = new Date(schouwAt);
            if (Number.isNaN(d.getTime())) return;
            onSave({
              schouw_at: d.toISOString(),
              installatie_partner_id: partnerId,
              schouw_notities: notities.trim() || undefined,
            });
          }}
          className="flex-1 bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
        >
          Plannen & mailen
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 border border-line px-4 py-2.5 text-sm font-semibold text-muted hover:bg-wash"
        >
          Annuleren
        </button>
      </div>
    </ModalShell>
  );
}

function MateriaalModal({
  project,
  onClose,
  onUpdated,
}: {
  project: Project;
  onClose: () => void;
  onUpdated: (p: Project) => void;
}) {
  const [regels, setRegels] = useState<OfferteRegel[]>([]);
  const [offerteMeta, setOfferteMeta] = useState<{
    subtotaal_ex_btw: number;
    btw_bedrag: number;
    totaal_inc_btw: number;
  } | null>(null);
  const [producten, setProducten] = useState<ProductInkoop[]>([]);
  const [facturen, setFacturen] = useState<Factuur[]>([]);
  const [checks, setChecks] = useState<MateriaalChecks>(
    () => project.materiaal_checks || {}
  );
  const [leveradres, setLeveradres] = useState(
    () => project.leveradres || adresRegel(project)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offerteId = project.offerte_id || project.offertes?.id;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [offRes, inkRes, facRes] = await Promise.all([
          offerteId
            ? fetch(`/api/offertes/${offerteId}`)
            : Promise.resolve(null),
          fetch("/api/inkoop"),
          fetch(`/api/projecten/${project.id}/facturen`),
        ]);
        if (cancelled) return;
        if (offRes) {
          const data = await offRes.json();
          const o = data.offerte as Offerte | undefined;
          const regelsList = (o?.offerte_regels || []) as OfferteRegel[];
          setRegels(regelsList);
          if (o) {
            let ex = Number(o.subtotaal_ex_btw) || 0;
            let btw = Number(o.btw_bedrag) || 0;
            let inc = Number(o.totaal_inc_btw) || 0;
            if (!(ex > 0)) {
              ex = Math.round(
                regelsList.reduce(
                  (s, r) => s + (Number(r.totaal_ex_btw) || 0),
                  0
                ) * 100
              ) / 100;
            }
            if (!(inc > 0) && ex > 0) {
              if (!(btw > 0)) btw = Math.round(ex * 0.21 * 100) / 100;
              inc = Math.round((ex + btw) * 100) / 100;
            }
            setOfferteMeta({
              subtotaal_ex_btw: ex,
              btw_bedrag: btw,
              totaal_inc_btw: inc,
            });
          }
        }
        const ink = await inkRes.json().catch(() => ({}));
        setProducten((ink.producten as ProductInkoop[]) || []);
        const fac = await facRes.json().catch(() => ({}));
        setFacturen((fac.facturen as Factuur[]) || []);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [offerteId, project.id]);

  const items = useMemo(
    () =>
      buildInkoopChecklist(
        regels.map((r) => ({
          id: r.id,
          omschrijving: r.omschrijving,
          aantal: r.aantal,
          product_id: r.product_id,
        })),
        producten,
        checks
      ),
    [regels, producten, checks]
  );

  const inkoopTotaal = useMemo(
    () => inkoopChecklistTotaalExBtw(items, checks),
    [items, checks]
  );

  const cash = useMemo(
    () =>
      buildProjectBetalingCash({
        orderExBtw: offerteMeta?.subtotaal_ex_btw || 0,
        orderBtw: offerteMeta?.btw_bedrag,
        orderIncBtw: offerteMeta?.totaal_inc_btw,
        facturen,
        inkoopExBtw: inkoopTotaal,
      }),
    [offerteMeta, facturen, inkoopTotaal]
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const wasVolledig =
        items.length > 0 &&
        items.every((i) =>
          isInkoopItemBesteld(i, project.materiaal_checks || {})
        );
      const nuVolledig =
        items.length > 0 && items.every((i) => isInkoopItemBesteld(i, checks));
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leveradres,
          materiaal_checks: checks,
          ...(nuVolledig && !wasVolledig
            ? { materiaal_volledig_afgevinkt: true }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      onUpdated(data.project as Project);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setSaving(false);
    }
  }, [project.id, project.materiaal_checks, leveradres, checks, items, onUpdated]);

  return (
    <ModalShell title="Materiaal inkopen" onClose={onClose} wide>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">
            {project.leads?.naam || project.project_nummer}
          </p>
          <p className="mt-0.5 text-sm text-muted">
            Partner:{" "}
            {project.installatie_partners?.naam ||
              project.monteur ||
              "Nog geen partner"}
          </p>
        </div>
        {offerteId ? (
          <a
            href={`/api/offertes/${offerteId}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="border border-orange bg-orange px-3 py-2 text-xs font-semibold text-white hover:bg-[#e0651c]"
          >
            Offerte downloaden (PDF)
          </a>
        ) : (
          <span className="text-xs text-muted">Geen offerte gekoppeld</span>
        )}
      </div>

      {offerteMeta && offerteMeta.totaal_inc_btw > 0 ? (
        <div className="mt-4">
          <div className="flex justify-between text-sm">
            <span className="font-semibold text-ink">
              Betaald {formatEuro(cash.ontvangenIncBtw)} van{" "}
              {formatEuro(cash.orderIncBtw)}
            </span>
            <span className="font-semibold tabular-nums">
              {cash.betaaldPct.toFixed(0)}%
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden bg-wash">
            <div
              className={
                cash.volledigBetaald ? "h-full bg-green" : "h-full bg-orange"
              }
              style={{ width: `${Math.min(100, cash.betaaldPct)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Inkoop:{" "}
            {cash.inkoopUnlocked ? (
              <span className="font-semibold text-green">vrijgegeven</span>
            ) : (
              <span className="font-semibold text-orange">geblokkeerd</span>
            )}
            {" · "}
            btw-reserve {formatEuro(cash.btwReserve)} · vrij{" "}
            {formatEuro(cash.vrijBesteedbaar)}
          </p>
        </div>
      ) : null}

      <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-muted">
        Leveradres
        <textarea
          value={leveradres}
          onChange={(e) => setLeveradres(e.target.value)}
          rows={2}
          className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-green"
        />
      </label>

      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Producten ({formatEuro(inkoopTotaal)} ex. btw)
      </p>
      {!cash.inkoopUnlocked ? (
        <p className="mt-2 text-xs text-muted">
          Vinkjes zijn pas actief als de order 100% betaald is.
        </p>
      ) : null}
      <ul className="mt-2 divide-y divide-line border border-line">
        {items.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted">
            Geen inkoopproducten…
          </li>
        ) : (
          items.map((item) => {
            const besteld = isInkoopItemBesteld(item, checks);
            return (
              <li key={item.key}>
                <label
                  className={[
                    "flex items-center gap-2 px-2.5 py-1.5",
                    !cash.inkoopUnlocked
                      ? "cursor-not-allowed opacity-55"
                      : "cursor-pointer hover:bg-wash",
                  ].join(" ")}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{item.label}</p>
                    <p className="text-[11px] text-muted">
                      {formatEuro(item.inkoopExBtw)} ex. btw
                      {item.sku ? ` · ${item.sku}` : ""}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={besteld}
                    disabled={!cash.inkoopUnlocked}
                    onChange={(e) =>
                      setChecks((prev) => ({
                        ...prev,
                        [item.key]: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 shrink-0"
                  />
                </label>
              </li>
            );
          })
        )}
      </ul>

      {error && (
        <p className="mt-3 text-xs text-[#C45A12]">{error}</p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-60"
        >
          Opslaan
        </button>
        <Link
          href={`/projecten/${project.id}?from=orders`}
          className="border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-wash"
        >
          Naar project
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="border border-line px-4 py-2.5 text-sm font-semibold text-muted hover:bg-wash"
        >
          Sluiten
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className={[
          "max-h-[90vh] w-full overflow-y-auto border border-line bg-white p-5 shadow-xl",
          wide ? "max-w-lg" : "max-w-md",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-semibold text-ink">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 text-xl text-muted hover:bg-wash"
            aria-label="Sluiten"
          >
            ×
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
