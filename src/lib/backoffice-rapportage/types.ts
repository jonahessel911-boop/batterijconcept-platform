export type BackofficeRapportagePeriod =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_7_days"
  | "last_14_days"
  | "last_30_days"
  | "this_quarter";

export type TtfcStats = {
  count: number;
  medianMinutes: number | null;
  p90Minutes: number | null;
  avgMinutes: number | null;
};

export type MedewerkerTakenStats = {
  adviseurId: string;
  naam: string;
  voltooid: number;
  metDeadline: number;
  voorDeadline: number;
  onTimePct: number | null;
};

export type MedewerkerActieStats = {
  adviseurId: string;
  naam: string;
  voltooid: number;
  metDeadline: number;
  voorDeadline: number;
  onTimePct: number | null;
};

export type TeamSlaStats = {
  eligible: number;
  onTime: number;
  pct: number | null;
};

/** Acties t.o.v. deadline: voltooid vóór/ná + open snapshot. */
export type ActieDeadlineSla = {
  /** Voltooide acties met deadline in de periode */
  voltooid: number;
  voorDeadline: number;
  naDeadline: number;
  voorPct: number | null;
  naPct: number | null;
  /** Huidige openstaande acties */
  open: number;
  openOpTijd: number;
  openOverdue: number;
  openOpTijdPct: number | null;
  openOverduePct: number | null;
};

export type OpenWorkload = {
  openActies: number;
  overdueActies: number;
  openTaken: number;
  overdueTaken: number;
};

export type BackofficeRapportageData = {
  period: {
    preset: BackofficeRapportagePeriod;
    label: string;
    start: string;
    end: string;
  };
  ttfc: TtfcStats;
  ttfcPerBeller: Array<TtfcStats & { adviseurId: string; naam: string }>;
  takenPerMedewerker: MedewerkerTakenStats[];
  actiesPerMedewerker: MedewerkerActieStats[];
  /** Primair: % acties vóór vs ná deadline */
  actieDeadline: ActieDeadlineSla;
  teamSla: {
    schouw: TeamSlaStats;
    aanbetaling: TeamSlaStats;
  };
  workload: OpenWorkload;
};
