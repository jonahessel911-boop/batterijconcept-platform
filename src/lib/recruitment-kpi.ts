/**
 * Recruitment staffing-KPI's: hoeveel FTE nodig per rol
 * t.o.v. sales-doel, lead-instroom en Warmtefonds-volume.
 */

export const RECRUITMENT_KPI_DEFAULTS = {
  /** Weekdoel sales (getekende deals). */
  targetSalesPerWeek: 50,
  /**
   * Belcapaciteit per appointment setter per werkdag.
   * (leads / belpogingen die één setter aankan)
   */
  setterCallsPerDay: 60,
  workdaysPerWeek: 5,
  /** Warmtefonds: doorgestuurd-dossiers per week per persoon. */
  wfDoorgestuurdPerWeek: 20,
  /** Fallback als er nog geen conversiedata is. */
  fallbackSalesPerAdviseurPerWeek: 2,
  /** Kijkvenster voor conversie / volume. */
  lookbackDays: 14,
  /** Cost per hire-doel (BANEN ad spend ÷ hires) voor adviseur. */
  targetCphAdviseur: 100,
  /** Ad-spend venster voor CPH. */
  cphLookbackDays: 30,
} as const;

export type RecruitmentKpiRoleId =
  | "adviseur"
  | "appointment_setter"
  | "warmtefonds";

export type RecruitmentKpiRoleRow = {
  id: RecruitmentKpiRoleId;
  label: string;
  have: number;
  needed: number;
  gap: number;
  /** 0–100 voor progressbar (have/needed). */
  progressPct: number;
  hint: string;
  detail: string;
};

export type RecruitmentKpiInputs = {
  targetSalesPerWeek: number;
  setterCallsPerDay: number;
  /** Gelopen huisbezoeken in lookback. */
  gelopen: number;
  /** Sales (getekend) in lookback. */
  sales: number;
  lookbackDays: number;
  activeAdviseurs: number;
  activeSetters: number;
  activeWfOperators: number;
  /** Nieuwe leads in lookback. */
  leadsIn: number;
  /** Warmtefonds “Doorgestuurd” in lookback. */
  wfDoorgestuurd: number;
};

function ceilPos(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}

function perWeek(count: number, lookbackDays: number): number {
  if (lookbackDays <= 0) return 0;
  return (count / lookbackDays) * 7;
}

function pct(have: number, needed: number): number {
  if (needed <= 0) return have > 0 ? 100 : 0;
  return Math.min(100, Math.round((have / needed) * 100));
}

/**
 * Bouw de 3 staffing-rijen.
 * Adviseur: sales-doel ÷ (sales/adviseur/week uit gelopen→sale 14d).
 * Setter: lead-instroom/week ÷ belcapaciteit/week.
 * Warmtefonds: doorgestuurd/week ÷ 20.
 */
export function buildRecruitmentKpiRows(
  input: RecruitmentKpiInputs
): RecruitmentKpiRoleRow[] {
  const days = Math.max(1, input.lookbackDays);
  const gelopenPw = perWeek(input.gelopen, days);
  const salesPw = perWeek(input.sales, days);
  const leadsPw = perWeek(input.leadsIn, days);
  const wfPw = perWeek(input.wfDoorgestuurd, days);

  const conv =
    input.gelopen > 0 ? input.sales / input.gelopen : null;

  const salesPerAdviseur =
    input.activeAdviseurs > 0 && salesPw > 0
      ? salesPw / input.activeAdviseurs
      : RECRUITMENT_KPI_DEFAULTS.fallbackSalesPerAdviseurPerWeek;

  const adviseursNeeded = ceilPos(
    input.targetSalesPerWeek / Math.max(salesPerAdviseur, 0.1)
  );

  const setterCapPerWeek =
    Math.max(1, input.setterCallsPerDay) *
    RECRUITMENT_KPI_DEFAULTS.workdaysPerWeek;
  const settersNeeded = ceilPos(leadsPw / setterCapPerWeek);

  const wfNeeded = ceilPos(
    wfPw / RECRUITMENT_KPI_DEFAULTS.wfDoorgestuurdPerWeek
  );

  const leadPressure =
    input.activeSetters > 0
      ? leadsPw / (input.activeSetters * setterCapPerWeek)
      : leadsPw > 0
        ? 2
        : 0;

  return [
    {
      id: "adviseur",
      label: "Adviseur",
      have: input.activeAdviseurs,
      needed: adviseursNeeded,
      gap: Math.max(0, adviseursNeeded - input.activeAdviseurs),
      progressPct: pct(input.activeAdviseurs, adviseursNeeded),
      hint:
        adviseursNeeded > input.activeAdviseurs
          ? `${adviseursNeeded - input.activeAdviseurs} adviseur(s) tekort voor ${input.targetSalesPerWeek} sales/week`
          : adviseursNeeded === 0
            ? "Nog geen sales-doel / data"
            : "Capaciteit dekt het sales-doel",
      detail: [
        `${Math.round(salesPw * 10) / 10} sales/week · ${Math.round(gelopenPw * 10) / 10} gelopen/week (14d)`,
        conv != null
          ? `conversie gelopen→sale ${Math.round(conv * 1000) / 10}%`
          : "nog geen conversiedata",
        `≈ ${Math.round(salesPerAdviseur * 10) / 10} sales/adviseur/week`,
      ].join(" · "),
    },
    {
      id: "appointment_setter",
      label: "Appointment setter",
      have: input.activeSetters,
      needed: settersNeeded,
      gap: Math.max(0, settersNeeded - input.activeSetters),
      progressPct: pct(input.activeSetters, settersNeeded),
      hint:
        leadPressure > 1.15
          ? "Te veel leads t.o.v. belcapaciteit — setters bij"
          : leadPressure < 0.7 && input.activeSetters > 0
            ? "Ruimte in belcapaciteit t.o.v. lead-instroom"
            : settersNeeded > input.activeSetters
              ? `${settersNeeded - input.activeSetters} setter(s) nodig`
              : "Belcapaciteit in balans met lead-instroom",
      detail: [
        `${Math.round(leadsPw * 10) / 10} nieuwe leads/week`,
        `capaciteit ${setterCapPerWeek}/setter/week (${input.setterCallsPerDay}/dag)`,
      ].join(" · "),
    },
    {
      id: "warmtefonds",
      label: "Warmtefonds",
      have: input.activeWfOperators,
      needed: wfNeeded,
      gap: Math.max(0, wfNeeded - input.activeWfOperators),
      progressPct: pct(input.activeWfOperators, wfNeeded),
      hint:
        wfNeeded > input.activeWfOperators
          ? `${wfNeeded - input.activeWfOperators} persoon tekort (@ ${RECRUITMENT_KPI_DEFAULTS.wfDoorgestuurdPerWeek} doorgestuurd/week)`
          : wfNeeded === 0
            ? "Geen Warmtefonds-volume in venster"
            : "Warmtefonds-volume gedekt",
      detail: [
        `${Math.round(wfPw * 10) / 10} doorgestuurd/week`,
        `${RECRUITMENT_KPI_DEFAULTS.wfDoorgestuurdPerWeek}/persoon/week capaciteit`,
      ].join(" · "),
    },
  ];
}
