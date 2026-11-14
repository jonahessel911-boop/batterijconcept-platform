"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  MapPin,
  Zap,
} from "lucide-react";
import type { RecruitmentVacature } from "@/types/database";
import { RECRUITMENT_ROL_LABEL } from "@/lib/recruitment-rollen";
import type { RecruitmentRol } from "@/types/database";
import { formOrDefault } from "@/lib/recruitment-form";
import { WerkenbijShell } from "@/components/werkenbij/WerkenbijShell";
import { Skeleton } from "@/components/ui/skeleton";

function rolLabel(rol: string) {
  if (rol in RECRUITMENT_ROL_LABEL) {
    return RECRUITMENT_ROL_LABEL[rol as RecruitmentRol];
  }
  return rol;
}

export default function WerkenbijVacaturePage() {
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
  const stepsCount = form?.steps.length ?? 0;

  return (
    <WerkenbijShell>
      <Link
        href="/werkenbij"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        Alle vacatures
      </Link>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-14 w-3/4" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : error || !vacature || !form ? (
        <div className="rounded-2xl bg-white px-5 py-10 ring-1 ring-green-deeper/10">
          <p className="font-display text-xl text-ink">
            Vacature niet beschikbaar
          </p>
          <p className="mt-2 text-sm text-muted">
            {error || "Deze vacature is gesloten of bestaat niet."}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Vacature hero */}
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-green">
              Vacature · {rolLabel(vacature.rol)}
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-green-deeper sm:text-5xl">
              {vacature.titel}
            </h1>
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 ring-1 ring-green-deeper/10">
                <MapPin className="size-3.5" />
                Nederland · fulltime
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 ring-1 ring-green-deeper/10">
                <Zap className="size-3.5 text-green" />
                Verduurzaming
              </span>
            </div>
            {(vacature.korte_omschrijving || form.subheadline) && (
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink sm:text-lg">
                {vacature.korte_omschrijving || form.subheadline}
              </p>
            )}
            {form.headline ? (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
                {form.headline}
              </p>
            ) : null}
          </section>

          {/* Snelle check CTA */}
          <section className="overflow-hidden rounded-2xl bg-green-deeper text-white shadow-[0_20px_50px_-28px_rgba(10,71,39,0.55)]">
            <div className="px-5 py-6 sm:px-7 sm:py-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-green-soft/80">
                Snelle check
              </p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                Past deze rol bij jou?
              </h2>
              <p className="mt-2 max-w-xl text-sm text-white/80 sm:text-base">
                Beantwoord {stepsCount} korte vragen. Duurt ongeveer 1 minuut —
                daarna weten we meteen of je in aanmerking komt.
              </p>
              <Link
                href={`/werkenbij/${vacature.id}/check`}
                className="mt-5 inline-flex items-center justify-between gap-3 rounded-full bg-white px-5 py-3.5 text-sm font-semibold text-green-deeper transition hover:bg-green-soft"
              >
                <span>Start snelle check</span>
                <ArrowRight className="size-4" />
              </Link>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-white/65">
                <Clock className="size-3.5" />
                {form.footer || "Meedoen duurt maar 1 minuut"}
              </p>
            </div>
          </section>

          {form.voordelen.length > 0 ? (
            <section className="rounded-2xl bg-white px-5 py-6 ring-1 ring-green-deeper/10 sm:px-7">
              <h2 className="font-display text-xl font-semibold tracking-tight text-ink">
                Wat je krijgt
              </h2>
              <ul className="mt-4 space-y-3">
                {form.voordelen.map((v) => (
                  <li
                    key={v}
                    className="flex items-start gap-3 text-sm leading-relaxed text-ink sm:text-base"
                  >
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-green text-white">
                      <Check className="size-3.5" />
                    </span>
                    <span>{v}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="rounded-2xl bg-white px-5 py-6 ring-1 ring-green-deeper/10 sm:px-7">
            <h2 className="font-display text-xl font-semibold tracking-tight text-ink">
              Wie we zoeken
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
              Echte knallers. Mensen die vol willen vlammen in verduurzaming,
              tempo aankunnen, en mee willen bouwen aan de grootste
              B2C-verduurzamingspartij van Nederland. Ambitie, eigenaarschap en
              resultaat — dat is de bar.
            </p>
            <Link
              href={`/werkenbij/${vacature.id}/check`}
              className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-green-deeper hover:underline"
            >
              Doe de snelle check
              <ArrowRight className="size-4" />
            </Link>
          </section>
        </div>
      )}
    </WerkenbijShell>
  );
}
