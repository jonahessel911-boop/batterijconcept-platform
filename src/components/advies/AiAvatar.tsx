"use client";

export function AiAvatar({
  speaking,
  label = "Batterijconcept AI",
}: {
  speaking?: boolean;
  label?: string;
}) {
  return (
    <div className="text-center">
      <div className="relative mx-auto flex h-28 w-28 items-center justify-center sm:h-36 sm:w-36">
        <div
          className={[
            "absolute inset-0 rounded-full bg-green/15",
            speaking ? "animate-pulse" : "",
          ].join(" ")}
        />
        <div className="relative flex h-24 w-24 flex-col items-center justify-center rounded-full bg-gradient-to-b from-green to-green-dark shadow-lg shadow-green/25 sm:h-28 sm:w-28">
          <div className="flex gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-white" />
            <span className="h-2.5 w-2.5 rounded-full bg-white" />
          </div>
          <div className="mt-2 h-1.5 w-6 rounded-full bg-white/90" />
          <span className="absolute -top-1 right-3 flex h-4 w-4 items-center justify-center rounded-full bg-[#9dffc4] text-[8px] font-bold text-green-dark">
            AI
          </span>
        </div>
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-green">
        {label}
      </p>
    </div>
  );
}
