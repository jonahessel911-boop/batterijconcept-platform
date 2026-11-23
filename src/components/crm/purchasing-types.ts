import type {
  InkoopLeverancierStatus,
  InkoopRegelStatus,
} from "@/lib/project-inkoop-checklist";

export type PurchasingOrderLine = {
  key: string;
  label: string;
  sku: string | null;
  aantal: number;
  inkoop_ex_btw: number;
  status: InkoopRegelStatus;
  notitie?: string | null;
};

export type PurchasingSchouwInfo = {
  kind: "voltooid" | "dag" | "week" | "niet";
  at: string | null;
  week_label: string | null;
  formulier_url: string | null;
  formulier_naam: string | null;
};

export type PurchasingOrder = {
  id: string;
  project_nummer: string | null;
  status: string;
  titel: string | null;
  leveradres: string | null;
  leverancier: string;
  klant: string;
  lead_number: string | null;
  offerte_nummer: string | null;
  updated_at: string;
  inkoop_totaal_ex_btw: number;
  te_bestellen_ex_btw?: number;
  besteld_ex_btw?: number;
  inkoop_leverancier_status: InkoopLeverancierStatus;
  inkoop_leverancier_betaald_op: string | null;
  klant_betaling?: {
    pct: number;
    betaald_inc: number;
    order_inc: number;
    volledig: boolean;
  } | null;
  schouw: PurchasingSchouwInfo;
  installatie_at: string | null;
  materiaal_leverdatum: string | null;
  inkoop_extra_notities?: string | null;
  summary: {
    te_kopen: number;
    besteld: number;
    geleverd: number;
    overall: InkoopRegelStatus | "deels";
  };
  items: PurchasingOrderLine[];
};

export type PurchasingDesk =
  | "bestellen"
  | "pipeline"
  | "onderweg"
  | "geleverd"
  | "te_betalen";
