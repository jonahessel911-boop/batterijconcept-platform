"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  FinancialDashboardData,
  FinancialDateRange,
} from "@/lib/financial-dashboard";
import { FinancialDashboard } from "./FinancialDashboard";

export function FinancialPanel() {
  const [range, setRange] = useState<FinancialDateRange>("last_30_days");
  const [data, setData] = useState<FinancialDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (r: FinancialDateRange) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/rapportage?financial_range=${encodeURIComponent(r)}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Laden mislukt"
        );
      }
      setData(
        ((json as { financial?: FinancialDashboardData }).financial ||
          null) as FinancialDashboardData | null
      );
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  return (
    <div>
      {error ? (
        <p className="mb-3 rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
          {error}
        </p>
      ) : null}
      <FinancialDashboard
        data={data}
        range={range}
        onRangeChange={setRange}
        loading={loading}
      />
    </div>
  );
}
