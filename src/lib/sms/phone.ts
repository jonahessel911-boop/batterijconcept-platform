/**
 * Normaliseer NL-telefoonnummers naar E.164 (+31…).
 */

export function toE164Nl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[\s().-]/g, "");
  if (!s) return null;

  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("+")) {
    const digits = s.slice(1).replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return null;
    return `+${digits}`;
  }

  const digits = s.replace(/\D/g, "");
  if (!digits) return null;

  // 06xxxxxxxx → +316xxxxxxxx
  if (digits.startsWith("0") && digits.length === 10) {
    return `+31${digits.slice(1)}`;
  }
  // 316xxxxxxxx zonder +
  if (digits.startsWith("31") && digits.length === 11) {
    return `+${digits}`;
  }
  // al 9 cijfers mobiel zonder 0
  if (digits.length === 9 && digits.startsWith("6")) {
    return `+31${digits}`;
  }

  return null;
}
