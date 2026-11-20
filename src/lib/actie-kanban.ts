import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  isBackofficeActieWachtExtern,
  isMonteurBeoordelingGezet,
  type BackofficeActie,
} from "@/lib/backoffice-acties";

export type ActieKanbanLaneId =
  | "opstarten"
  | "edwin"
  | "wacht_wf"
  | "schouw"
  | "inkoop"
  | "factuur"
  | "eindafrekening"
  | "after_sale"
  | "service_vervolg"
  | "hold"
  | "aangetekend"
  | "volgende";

export type ActieKanbanCard = {
  id: string;
  lane: ActieKanbanLaneId;
  actie: BackofficeActie;
  titel: string;
  /** Openstaande substappen (After sale). */
  rest?: string;
};

export const ACTIE_KANBAN_LANES: {
  id: ActieKanbanLaneId;
  label: string;
  accent: string;
}[] = [
  { id: "opstarten", label: "Opstarten", accent: "#0D5C32" },
  { id: "edwin", label: "Edwin / WF doorzetten", accent: "#1A4A6E" },
  { id: "wacht_wf", label: "Wachten op WF", accent: "#3730A3" },
  { id: "schouw", label: "Schouw inplannen", accent: "#1565C0" },
  { id: "inkoop", label: "Inkoop", accent: "#8A6D00" },
  { id: "factuur", label: "Factuur", accent: "#C45A12" },
  { id: "eindafrekening", label: "Eindafrekening / WF-declaratie", accent: "#C45A12" },
  { id: "after_sale", label: "After sale", accent: "#0D7A6F" },
  { id: "service_vervolg", label: "Vervolg Backoffice", accent: "#C45A12" },
  { id: "hold", label: "HOLD sales", accent: "#4A3A5C" },
  { id: "aangetekend", label: "Bedenktijd", accent: "#9A3B1A" },
  { id: "volgende", label: "Installatie / volgende stap", accent: "#2E7D32" },
];

export function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

export function shiftDayKey(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const base = new Date(y!, m! - 1, d!, 12, 0, 0);
  return ymdAmsterdam(addDays(base, delta));
}

function calendarDaysUntil(dueAt: string, now: Date): number {
  const dueYmd = ymdAmsterdam(new Date(dueAt));
  const nowYmd = ymdAmsterdam(now);
  const due = new Date(`${dueYmd}T12:00:00`);
  const today = new Date(`${nowYmd}T12:00:00`);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/** Zelfde dag-regel als Acties-focus: die dag, of (op vandaag) te laat. */
export function actieKanbanMatchesDay(
  actie: BackofficeActie,
  dayKey: string | null,
  now = new Date()
): boolean {
  if (!dayKey) return true;
  const dueYmd = ymdAmsterdam(new Date(actie.deadlineAt));
  if (dueYmd === dayKey) return true;
  const todayKey = ymdAmsterdam(now);
  if (dayKey !== todayKey) return false;
  if (
    isBackofficeActieWachtExtern(actie) &&
    !actie.overdue &&
    !actie.vastgelopen
  ) {
    return false;
  }
  const days = calendarDaysUntil(actie.deadlineAt, now);
  return days < 0 || Boolean(actie.overdue) || Boolean(actie.vastgelopen);
}

function laneFromVolgendeTitel(titel: string): ActieKanbanLaneId {
  if (/materiaal|inkoop|bestel/i.test(titel)) return "inkoop";
  if (/overstap|btw|review|nazorg|after.?sale/i.test(titel)) return "after_sale";
  if (/schouw/i.test(titel)) return "schouw";
  return "volgende";
}

function afterSaleRest(project: BackofficeActie["project"]): string {
  if (!project) return "Overstap · BTW · Review · First Contact";
  const open: string[] = [];
  if (!project.overstap_dynamische_leverancier_at) open.push("Overstap");
  if (!project.btw_terugvragen_aangevraagd_at) open.push("BTW");
  if (!project.review_gevraagd_at) open.push("Review");
  if (!isMonteurBeoordelingGezet(project)) open.push("First Contact");
  return open.join(" · ");
}

function pushCard(
  out: ActieKanbanCard[],
  lane: ActieKanbanLaneId,
  actie: BackofficeActie,
  titel: string,
  rest?: string
) {
  out.push({
    id: `${actie.id}:${lane}`,
    lane,
    actie,
    titel,
    rest,
  });
}

/** Eén kaart per actie. After sale blijft één actie tot alle stappen af zijn. */
export function actieKanbanCardsFromActies(
  acties: BackofficeActie[]
): ActieKanbanCard[] {
  const out: ActieKanbanCard[] = [];
  const afterSaleProject = new Set<string>();
  for (const actie of acties) {
    if (actie.soort === "after_sale") {
      if (actie.projectId) afterSaleProject.add(actie.projectId);
      pushCard(
        out,
        "after_sale",
        actie,
        "After sale",
        afterSaleRest(actie.project)
      );
      continue;
    }
    switch (actie.soort) {
      case "bel_schouw_aanbetaling":
        pushCard(out, "opstarten", actie, "Opstarten");
        break;
      case "schakel_financiering":
        pushCard(out, "edwin", actie, actie.titel || "Edwin / WF");
        break;
      case "wacht_warmtefonds":
        pushCard(out, "wacht_wf", actie, actie.titel || "Wachten op WF");
        break;
      case "schouw_inplannen":
        pushCard(out, "schouw", actie, actie.titel || "Schouw inplannen");
        break;
      case "bestel_materiaal":
        pushCard(out, "inkoop", actie, actie.titel || "Batterij bestellen");
        break;
      case "nabellen_factuur":
      case "wf_aanbetaling_herinnering":
        pushCard(out, "factuur", actie, actie.titel);
        break;
      case "eindafrekening":
        pushCard(out, "eindafrekening", actie, actie.titel);
        break;
      case "service_vervolg":
        pushCard(out, "service_vervolg", actie, "Vervolg Backoffice");
        break;
      case "hold_sales_verlopen":
      case "hold_sales_terug":
        pushCard(out, "hold", actie, actie.titel);
        break;
      case "aangetekende_brief":
      case "annulering_keuze_controle":
        pushCard(out, "aangetekend", actie, actie.titel);
        break;
      case "volgende_stap": {
        const lane = laneFromVolgendeTitel(actie.titel);
        if (
          lane === "after_sale" &&
          actie.projectId &&
          afterSaleProject.has(actie.projectId)
        ) {
          break;
        }
        pushCard(
          out,
          lane,
          actie,
          lane === "after_sale" ? "After sale" : actie.titel,
          lane === "after_sale" ? afterSaleRest(actie.project) : undefined
        );
        break;
      }
      default:
        pushCard(out, "volgende", actie, actie.titel);
    }
  }
  return out.sort(
    (a, b) =>
      Number(b.actie.vastgelopen) - Number(a.actie.vastgelopen) ||
      Number(b.actie.overdue) - Number(a.actie.overdue) ||
      Number(b.actie.prio) - Number(a.actie.prio) ||
      new Date(a.actie.deadlineAt).getTime() -
        new Date(b.actie.deadlineAt).getTime()
  );
}
