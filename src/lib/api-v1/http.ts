import { NextResponse } from "next/server";

export function jsonOk(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function jsonErr(
  error: string,
  status = 400,
  extra?: Record<string, unknown>
) {
  return NextResponse.json({ error, ...extra }, { status });
}

export function pickStr(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function parseNum(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n =
    typeof raw === "string"
      ? Number(raw.trim().replace(/\s/g, "").replace(",", "."))
      : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseBool(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") {
    if (raw === 1) return true;
    if (raw === 0) return false;
  }
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    if (["1", "true", "ja", "yes", "y"].includes(v)) return true;
    if (["0", "false", "nee", "no", "n"].includes(v)) return false;
  }
  return undefined;
}
