export type BoView =
  | "orders"
  | "agenda"
  | "taken_agenda"
  | "acties"
  | "service";

export function parseBoView(raw: string | null | undefined): BoView {
  if (raw === "agenda") return "agenda";
  if (raw === "taken_agenda" || raw === "taken-agenda") return "taken_agenda";
  if (raw === "acties") return "acties";
  if (raw === "service") return "service";
  // Oude tabs → Projecten / Acties
  if (raw === "schouwweek") return "acties";
  if (raw === "ai") return "orders";
  // Legacy CRM-tab "taken" was admin-agenda, niet BO Taken-agenda
  if (raw === "taken") return "acties";
  return "orders";
}

export function backofficeHref(view: BoView = "orders"): string {
  return `/?tab=projecten&bo=${view}`;
}

export const BO_VIEWS: { id: BoView; label: string }[] = [
  { id: "orders", label: "Projecten" },
  { id: "acties", label: "Acties" },
  { id: "agenda", label: "Planbord" },
  { id: "taken_agenda", label: "Taken agenda" },
  { id: "service", label: "Service" },
];
