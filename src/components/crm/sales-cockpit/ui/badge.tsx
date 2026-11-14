import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums",
  {
    variants: {
      tone: {
        neutral: "border-transparent bg-zinc-100 text-zinc-600",
        positive: "border-transparent bg-emerald-50 text-emerald-700",
        negative: "border-transparent bg-rose-50 text-rose-700",
        accent: "border-transparent bg-zinc-900 text-white",
        info: "border-transparent bg-sky-50 text-sky-700",
        warn: "border-transparent bg-amber-50 text-amber-800",
        teal: "border-transparent bg-teal-50 text-teal-700",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
);

export function Badge({
  className,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props} />
  );
}
