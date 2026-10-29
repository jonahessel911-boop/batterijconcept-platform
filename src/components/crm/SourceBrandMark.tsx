"use client";

import Image from "next/image";

type Props = {
  source: string;
  className?: string;
};

/** Logo / mark voor bekende leadbronnen (Meta, TikTok, Native, …). */
export function SourceBrandMark({
  source,
  className = "h-4 w-4",
}: Props) {
  const key = source.trim().toLowerCase();
  if (key === "meta") {
    return (
      <Image
        src="/brands/meta.svg"
        alt="Meta"
        width={20}
        height={14}
        className={className}
        unoptimized
      />
    );
  }
  if (key === "tiktok") {
    return (
      <Image
        src="/brands/tiktok.svg"
        alt="TikTok"
        width={16}
        height={16}
        className={className}
        unoptimized
      />
    );
  }
  if (key === "native") {
    return (
      <Image
        src="/brands/native.svg"
        alt="Native"
        width={16}
        height={16}
        className={className}
        unoptimized
      />
    );
  }
  if (key === "google") {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-sm bg-[#4285F4]/15 text-[9px] font-bold text-[#4285F4] ${className}`}
        aria-hidden
      >
        G
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-wash text-[9px] font-bold text-muted ${className}`}
      aria-hidden
    >
      {source.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
