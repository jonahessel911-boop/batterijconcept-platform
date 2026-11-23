export type OpvolgingFlow = "legacy" | "intensief" | "rustig";

export type OpvolgingAbSettings = {
  enabled: boolean;
  started_at: string | null;
  updated_at: string | null;
};

export type AgendaProviderCounts = {
  google: number;
  outlook_live: number;
  outlook_office: number;
  ics: number;
};

export type OpvolgingFlowMetrics = {
  flow: "intensief" | "rustig";
  label: string;
  /** Afspraken toegewezen aan deze flow (sinds A/B start, of alles met deze flow) */
  ingepland: number;
  /** Nog open (gepland/bevestigd/verzet, start in toekomst of vandaag) */
  openstaand: number;
  /** status = geannuleerd */
  geannuleerd: number;
  /** Afspraak is geweest zonder annulering (voltooid of start_at voorbij) */
  doorgegaan: number;
  mails_verstuurd: number;
  sms_verstuurd: number;
  /** Afspraken waarbij agenda-landing is geopend */
  agenda_opened: number;
  /** Afspraken waarbij een agenda-provider is gekozen */
  agenda_added: number;
  agenda_providers: AgendaProviderCounts;
};

export const OPVOLGING_FLOW_LABELS: Record<"intensief" | "rustig", string> = {
  intensief: "Intensief",
  rustig: "Rustig",
};
