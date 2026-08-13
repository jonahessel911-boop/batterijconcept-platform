import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/** Alleen in Node API-routes (niet in Edge middleware) */

export function generatePassword(length = 12): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i]! % chars.length];
  }
  return out;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const test = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    if (test.length !== expected.length) return false;
    return timingSafeEqual(test, expected);
  } catch {
    return false;
  }
}
