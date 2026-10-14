import bankQuartersRaw from "@/data/bank-quarters.json";

export type BankTransaction = {
  date: string;
  amount: number;
  name: string;
  description: string;
  counterparty?: string;
  isBtw: boolean;
};

export type BankQuarterMeta = {
  key: string;
  year: number;
  quarter: number;
  label: string;
  account?: string;
  sourceFile?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  transactions: BankTransaction[];
};

export type BankMonthKasstroom = {
  monthKey: string; // yyyy-MM
  label: string;
  inkomsten: number;
  uitgavenExBtw: number;
  btwUitgaven: number;
  netto: number;
  inkomstenCount: number;
  uitgavenCount: number;
};

export type BankQuarterKasstroom = {
  key: string;
  label: string;
  year: number;
  quarter: number;
  periodStart: string | null;
  periodEnd: string | null;
  account: string | null;
  inkomsten: number;
  uitgavenExBtw: number;
  btwUitgaven: number;
  netto: number;
  inkomstenLines: BankTransaction[];
  uitgavenLines: BankTransaction[];
  btwLines: BankTransaction[];
  months: BankMonthKasstroom[];
};

const MONTH_NL = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const raw = bankQuartersRaw as { quarters: BankQuarterMeta[] };

export function listBankQuarters(): {
  key: string;
  label: string;
  year: number;
  quarter: number;
  hasData: boolean;
}[] {
  return (raw.quarters || []).map((q) => ({
    key: q.key,
    label: q.label,
    year: q.year,
    quarter: q.quarter,
    hasData: (q.transactions || []).length > 0,
  }));
}

export function getBankQuarter(key: string): BankQuarterMeta | null {
  return (raw.quarters || []).find((q) => q.key === key) || null;
}

/** Default: laatste kwartaal mét data, anders eerste. */
export function defaultBankQuarterKey(): string {
  const withData = listBankQuarters().filter((q) => q.hasData);
  if (withData.length > 0) return withData[withData.length - 1]!.key;
  return listBankQuarters()[0]?.key || "2026-Q3";
}

export function buildBankQuarterKasstroom(
  key: string
): BankQuarterKasstroom | null {
  const q = getBankQuarter(key);
  if (!q) return null;

  const txns = [...(q.transactions || [])].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  const inkomstenLines = txns.filter((t) => t.amount > 0);
  const uitgavenAll = txns.filter((t) => t.amount < 0);
  const btwLines = uitgavenAll.filter((t) => t.isBtw);
  const uitgavenLines = uitgavenAll.filter((t) => !t.isBtw);

  const inkomsten = round2(
    inkomstenLines.reduce((s, t) => s + t.amount, 0)
  );
  const uitgavenExBtw = round2(
    uitgavenLines.reduce((s, t) => s + Math.abs(t.amount), 0)
  );
  const btwUitgaven = round2(
    btwLines.reduce((s, t) => s + Math.abs(t.amount), 0)
  );
  const netto = round2(inkomsten - uitgavenExBtw);

  const byMonth = new Map<
    string,
    {
      inkomsten: number;
      uitgavenExBtw: number;
      btwUitgaven: number;
      inkomstenCount: number;
      uitgavenCount: number;
    }
  >();

  for (const t of txns) {
    const mk = t.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mk)) continue;
    let bucket = byMonth.get(mk);
    if (!bucket) {
      bucket = {
        inkomsten: 0,
        uitgavenExBtw: 0,
        btwUitgaven: 0,
        inkomstenCount: 0,
        uitgavenCount: 0,
      };
      byMonth.set(mk, bucket);
    }
    if (t.amount > 0) {
      bucket.inkomsten = round2(bucket.inkomsten + t.amount);
      bucket.inkomstenCount += 1;
    } else {
      const abs = Math.abs(t.amount);
      if (t.isBtw) {
        bucket.btwUitgaven = round2(bucket.btwUitgaven + abs);
      } else {
        bucket.uitgavenExBtw = round2(bucket.uitgavenExBtw + abs);
        bucket.uitgavenCount += 1;
      }
    }
  }

  const months: BankMonthKasstroom[] = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, b]) => {
      const [y, m] = monthKey.split("-").map(Number);
      const label = `${MONTH_NL[(m || 1) - 1] || monthKey} ${y}`;
      return {
        monthKey,
        label,
        inkomsten: b.inkomsten,
        uitgavenExBtw: b.uitgavenExBtw,
        btwUitgaven: b.btwUitgaven,
        netto: round2(b.inkomsten - b.uitgavenExBtw),
        inkomstenCount: b.inkomstenCount,
        uitgavenCount: b.uitgavenCount,
      };
    });

  return {
    key: q.key,
    label: q.label,
    year: q.year,
    quarter: q.quarter,
    periodStart: q.periodStart || txns[0]?.date || null,
    periodEnd: q.periodEnd || txns[txns.length - 1]?.date || null,
    account: q.account || null,
    inkomsten,
    uitgavenExBtw,
    btwUitgaven,
    netto,
    inkomstenLines,
    uitgavenLines,
    btwLines,
    months,
  };
}
