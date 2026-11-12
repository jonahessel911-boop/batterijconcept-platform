"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Briefcase, MapPin } from "lucide-react";
import type { RecruitmentVacature } from "@/types/database";
import { RECRUITMENT_ROL_LABEL } from "@/lib/recruitment-rollen";
import type { RecruitmentRol } from "@/types/database";
import { formOrDefault } from "@/lib/recruitment-form";
import { Skeleton } from "@/components/ui/skeleton";

function rolLabel(rol: string) {
  if (rol in RECRUITMENT_ROL_LABEL) {
    return RECRUITMENT_ROL_LABEL[rol as RecruitmentRol];
  }
  return rol;
}

export function WerkenbijVacaturesList() {
  const [items, setItems] = useState<RecruitmentVacature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/werkenbij/vacatures", {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Laden mislukt");
        if (!cancelled) {
          setItems((data.vacatures || []) as RecruitmentVacature[]);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Laden mislukt");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-44 w-full rounded-2xl" />
        <Skeleton className="h-44 w-full rounded-2xl" />
        <Skeleton className="h-44 w-full rounded-2xl" />
        <Skeleton className="h-44 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl bg-white px-6 py-14 text-center ring-1 ring-green-deeper/10">
        <Briefcase className="mb-3 size-8 text-muted" />
        <p className="font-display text-lg text-ink">Geen open vacatures</p>
        <p className="mt-1 max-w-sm text-sm text-muted">
          Op dit moment zoeken we niet actief. Kom later terug — of stuur een
          open sollicitatie via onze website.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {items.map((v) => {
        const form = formOrDefault(v.form, v.rol);
        const teaser =
          v.korte_omschrijving?.trim() ||
          form.subheadline ||
          form.headline ||
          "";
        return (
          <li key={v.id}>
            <Link
              href={`/werkenbij/${v.id}`}
              className="group flex h-full flex-col rounded-2xl bg-white p-5 ring-1 ring-green-deeper/10 transition hover:-translate-y-0.5 hover:ring-green hover:shadow-[0_12px_40px_-20px_rgba(10,71,39,0.35)]"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-green">
                {rolLabel(v.rol)}
              </p>
              <h3 className="mt-2 font-display text-xl font-semibold tracking-tight text-ink group-hover:text-green-deeper">
                {v.titel}
              </h3>
              {teaser ? (
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted line-clamp-3">
                  {teaser}
                </p>
              ) : (
                <p className="mt-2 flex-1 text-sm text-muted">
                  Bekijk de vacature en doe de snelle check.
                </p>
              )}
              <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
                <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                  <MapPin className="size-3" />
                  Nederland
                </span>
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-deeper">
                  Vacature
                  <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
