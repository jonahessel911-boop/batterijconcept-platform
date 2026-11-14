"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { RecruitmentVacature } from "@/types/database";
import { formOrDefault } from "@/lib/recruitment-form";
import { WerkenbijQuiz } from "@/components/werkenbij/WerkenbijQuiz";
import { Skeleton } from "@/components/ui/skeleton";

export default function WerkenbijCheckPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const [vacature, setVacature] = useState<RecruitmentVacature | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/werkenbij/vacatures/${id}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Niet gevonden");
        if (!cancelled) setVacature(data.vacature as RecruitmentVacature);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Niet gevonden");
          setVacature(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const form = vacature
    ? formOrDefault(vacature.form, vacature.rol)
    : null;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#F2F7F3] text-ink">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[22rem] bg-[radial-gradient(ellipse_at_top,_rgba(26,138,62,0.12),_transparent_55%)]"
      />
      <div className="relative z-10 mx-auto max-w-lg px-4 py-6 sm:py-10">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-72 w-full rounded-2xl" />
          </div>
        ) : error || !vacature || !form ? (
          <div className="rounded-2xl bg-white px-5 py-10 ring-1 ring-green-deeper/10">
            <p className="font-display text-lg text-ink">
              Check niet beschikbaar
            </p>
            <p className="mt-1 text-sm text-muted">
              {error || "Deze vacature is gesloten of bestaat niet."}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-green">
                Snelle check · {vacature.titel}
              </p>
              <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                Beantwoord een paar korte vragen
              </h1>
              <p className="mt-2 text-sm text-muted">
                Daarna weten we meteen of je in aanmerking komt.
              </p>
            </div>
            <WerkenbijQuiz
              vacatureId={vacature.id}
              vacatureTitel={vacature.titel}
              form={form}
            />
          </div>
        )}
      </div>
    </div>
  );
}
