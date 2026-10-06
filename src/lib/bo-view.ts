export type BoView =
  | "orders"
  | "agenda"
  | "acties"
  | "schouwweek"
  | "service"
  | "taken"
  | "ai";

export function parseBoView(raw: string | null | undefined): BoView {
  if (raw === "agenda") return "agenda";
  if (raw === "acties") return "acties";
  if (raw === "schouwweek") return "schouwweek";
  if (raw === "service") return "service";
  if (raw === "taken") return "taken";
  if (raw === "ai") return "ai";
  return "orders";
}

export function backofficeHref(view: BoView = "orders"): string {
  return `/?tab=projecten&bo=${view}`;
}

export const BO_VIEWS: { id: BoView; label: string }[] = [
  { id: "orders", label: "Projecten" },
  { id: "acties", label: "Acties" },
  { id: "taken", label: "Toekomstige taken" },
  { id: "schouwweek", label: "Schouwweek" },
  { id: "agenda", label: "Planbord" },
  { id: "service", label: "Service" },
  { id: "ai", label: "AI" },
];
