import "server-only";
import crypto from "node:crypto";

/** Random string of `length` easy-to-read characters (no 0/O, 1/l/I). */
export function randomToken(length: number): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(length), (b) => alphabet[b % alphabet.length]).join("");
}

export const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

/** Constant-time comparison of two strings (tokens, signatures). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
