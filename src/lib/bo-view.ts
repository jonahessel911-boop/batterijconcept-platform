export type BoView =
  | "orders"
  | "agenda"
  | "acties"
  | "schouwweek"
  | "service";

export function parseBoView(raw: string | null | undefined): BoView {
  if (raw === "agenda") return "agenda";
  if (raw === "acties") return "acties";
  if (raw === "schouwweek") return "schouwweek";
  if (raw === "service") return "service";
  // Oude tabs → Projecten / Acties
  if (raw === "ai") return "orders";
  if (raw === "taken") return "acties";
  return "orders";
}

export function backofficeHref(view: BoView = "orders"): string {
  return `/?tab=projecten&bo=${view}`;
}

export const BO_VIEWS: { id: BoView; label: string }[] = [
  { id: "orders", label: "Projecten" },
  { id: "acties", label: "Acties" },
  { id: "schouwweek", label: "Schouwweek" },
  { id: "agenda", label: "Planbord" },
  { id: "service", label: "Service" },
];
