"use client";

import type { ReactNode } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

export function KpiStat({
  label,
  value,
  hint,
  delta,
  deltaLabel = "Verandering ten opzichte van de vergelijkingsperiode",
  deltaSuffix = "%",
  icon,
  accent = "zinc",
  loading = false,
  onClick,
  active = false,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  deltaLabel?: string;
  deltaSuffix?: string;
  icon?: ReactNode;
  accent?: "zinc" | "emerald" | "sky" | "teal" | "amber" | "rose";
  loading?: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-5 w-40" />
        </CardContent>
      </Card>
    );
  }

  const tone =
    delta == null || delta === 0
      ? "neutral"
      : delta > 0
        ? "positive"
        : "negative";
  const TrendIcon =
    delta == null || delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const sign = delta != null && delta > 0 ? "+" : "";
  const deltaText =
    delta == null
      ? null
      : `${sign}${delta.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}${deltaSuffix}`;

  const accents: Record<string, string> = {
    zinc: "bg-zinc-100 text-zinc-700",
    emerald: "bg-emerald-50 text-emerald-700",
    sky: "bg-sky-50 text-sky-700",
    teal: "bg-teal-50 text-teal-700",
    amber: "bg-amber-50 text-amber-800",
    rose: "bg-rose-50 text-rose-700",
  };

  const body = (
    <CardContent className="flex flex-col gap-3 p-5 text-left">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-zinc-500">{label}</p>
        {icon ? (
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", accents[accent])}>
            {icon}
          </span>
        ) : null}
      </div>
      <p className="text-3xl font-semibold tracking-tight tabular-nums text-zinc-950">{value}</p>
      <div className="flex min-h-5 flex-wrap items-center gap-2">
        {deltaText ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge tone={tone} className="cursor-default rounded-full">
                <TrendIcon className="size-3" />
                {deltaText}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{deltaLabel}</TooltipContent>
          </Tooltip>
        ) : null}
        {hint ? <p className="text-xs leading-relaxed text-zinc-500">{hint}</p> : null}
      </div>
    </CardContent>
  );

  const stripe =
    accent === "emerald"
      ? "border-l-emerald-500"
      : accent === "sky"
        ? "border-l-sky-500"
        : accent === "teal"
          ? "border-l-teal-600"
          : accent === "amber"
            ? "border-l-amber-500"
            : accent === "rose"
              ? "border-l-rose-500"
              : "border-l-zinc-300";

  const shell = cn(
    "overflow-hidden border-l-4 shadow-sm",
    stripe,
    active && "ring-2 ring-zinc-900/15",
    onClick && "transition-all hover:-translate-y-0.5 hover:shadow-md"
  );

  if (!onClick) {
    return <Card className={shell}>{body}</Card>;
  }

  return (
    <Card className={shell}>
      <button type="button" className="w-full rounded-xl text-left" onClick={onClick}>
        {body}
      </button>
    </Card>
  );
}
