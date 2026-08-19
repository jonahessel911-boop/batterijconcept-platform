export function appendLeadNotitie(
  existing: string | null | undefined,
  line: string
): string {
  const extra = line.trim();
  const base = existing?.trim() || "";
  if (!extra) return base;
  return base ? `${base}\n\n${extra}` : extra;
}
