export type RecruitmentView =
  | "aanmeldingen"
  | "kanban"
  | "agenda"
  | "jobs"
  | "marketing"
  | "kaart"
  | "acties"
  | "trainingen";

export function parseRecruitmentView(
  raw: string | null | undefined
): RecruitmentView {
  if (raw === "kanban") return "kanban";
  if (raw === "agenda") return "agenda";
  if (raw === "jobs") return "jobs";
  if (raw === "marketing") return "marketing";
  if (raw === "kaart") return "kaart";
  if (raw === "acties") return "acties";
  if (raw === "trainingen" || raw === "training") return "trainingen";
  if (raw === "plannen") return "aanmeldingen";
  if (raw === "routes") return "aanmeldingen";
  return "aanmeldingen";
}

export function recruitmentHref(view: RecruitmentView = "aanmeldingen"): string {
  return `/?tab=instroom&rc=${view}`;
}

export const RECRUITMENT_VIEWS: { id: RecruitmentView; label: string }[] = [
  { id: "aanmeldingen", label: "Aanmeldingen" },
  { id: "kanban", label: "Kanban" },
  { id: "agenda", label: "Agenda" },
  { id: "jobs", label: "Jobs" },
  { id: "marketing", label: "Marketing" },
  { id: "kaart", label: "Kaart" },
  { id: "acties", label: "Acties" },
  { id: "trainingen", label: "Training" },
];

export const RECRUITMENT_VIEW_META: Record<
  RecruitmentView,
  { title: string; sub: string }
> = {
  aanmeldingen: {
    title: "Aanmeldingen",
    sub: "Nieuwe kandidaten · status · contact",
  },
  kanban: {
    title: "Kanban",
    sub: "Pipeline per status",
  },
  agenda: {
    title: "Agenda",
    sub: "Sollicitatiegesprekken per dag",
  },
  jobs: {
    title: "Jobs",
    sub: "Vacatures beheren en koppelen aan BANEN-campagnes",
  },
  marketing: {
    title: "Marketing",
    sub: "Ads Manager · BANEN spend, CPL en hires",
  },
  kaart: {
    title: "Kaart",
    sub: "Kandidaten en teams op de kaart",
  },
  acties: {
    title: "Acties",
    sub: "Open taken op kandidaten",
  },
  trainingen: {
    title: "Training",
    sub: "Momenten en deelnemers",
  },
};
