import "server-only";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { randomBytes } from "node:crypto";
import { sha256 } from "../crypto";

authenticator.options = { window: 1, step: 30, digits: 6 };

export const generateTotpSecret = () => authenticator.generateSecret(20);

export async function totpQrDataUrl(email: string, secret: string) {
  const uri = authenticator.keyuri(email, "RSC Classroom", secret);
  return QRCode.toDataURL(uri, { margin: 1, width: 220 });
}

/**
 * Verifies a code and returns its time-step, or null. Callers must reject a step
 * that is <= the last accepted step (prevents replaying an observed code).
 */
export function verifyTotp(code: string, secret: string): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = authenticator.checkDelta(code, secret);
  if (delta === null) return null;
  return Math.floor(Date.now() / 30_000) + delta;
}

/** 10 single-use recovery codes like "k7f3-9qpx-m2dd". Only hashes are stored. */
export function generateRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const plain = Array.from({ length: 10 }, () => {
    const bytes = randomBytes(12);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
  });
  return { plain, hashes: plain.map((c) => sha256(c)) };
}

export const normalizeRecoveryCode = (c: string) => c.trim().toLowerCase().replace(/\s+/g, "");
