"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  REFERRAL_TAK_AUTO_KEY,
  REFERRAL_TAK_TITEL,
} from "@/lib/sales-referral-taak";

type ReferralTaak = {
  id: string;
  titel: string;
  project_id: string;
  projecten?: {
    id: string;
    project_nummer?: string | null;
    lead_id?: string | null;
    leads?:
      | { naam?: string | null; telefoon?: string | null }
      | { naam?: string | null; telefoon?: string | null }[]
      | null;
  } | null;
};

function leadNaam(t: ReferralTaak): string {
  const p = t.projecten;
  const raw = p?.leads;
  const lead = Array.isArray(raw) ? raw[0] : raw;
  return lead?.naam?.trim() || p?.project_nummer || "Klant";
}

function leadId(t: ReferralTaak): string | null {
  return t.projecten?.lead_id || null;
}

export function SalesReferralActies() {
  const [taken, setTaken] = useState<ReferralTaak[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/taken?open=1&auto_key=${encodeURIComponent(REFERRAL_TAK_AUTO_KEY)}&limit=50`
      );
      const data = (await res.json().catch(() => ({}))) as {
        taken?: ReferralTaak[];
        error?: string;
      };
      if (!res.ok) {
        // Optionele banner: stille fail i.p.v. JSON/500-rommel op Leads
        setTaken([]);
        setError(null);
        return;
      }
      setTaken((data.taken || []) as ReferralTaak[]);
      setError(null);
    } catch {
      setTaken([]);
      setError(null);
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  async function afronden(taakId: string) {
    setBusyId(taakId);
    setError(null);
    try {
      const res = await fetch(`/api/taken/${taakId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Afronden mislukt");
      setTaken((prev) => prev.filter((t) => t.id !== taakId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Afronden mislukt");
    } finally {
      setBusyId(null);
    }
  }

  if (taken.length === 0 && !error) return null;

  return (
    <div className="mb-4 space-y-2">
      {error && (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      )}
      {taken.map((t) => {
        const naam = leadNaam(t);
        const lid = leadId(t);
        const href = lid ? `/leads/${lid}` : `/projecten/${t.project_id}`;
        return (
          <div
            key={t.id}
            className="flex flex-wrap items-center justify-between gap-3 border border-orange/40 bg-[#FFF8F3] px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-orange">
                Actie
              </p>
              <p className="mt-0.5 text-sm font-semibold text-ink">
                <Link href={href} className="hover:underline">
                  {naam}
                </Link>
                <span className="font-medium text-muted"> — </span>
                <span className="font-semibold uppercase tracking-wide text-ink">
                  {t.titel || REFERRAL_TAK_TITEL}
                </span>
              </p>
            </div>
            <button
              type="button"
              disabled={busyId === t.id}
              onClick={() => void afronden(t.id)}
              className="shrink-0 bg-orange px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-[#e0651c] disabled:opacity-60"
            >
              {busyId === t.id ? "Bezig…" : "Afronden"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
