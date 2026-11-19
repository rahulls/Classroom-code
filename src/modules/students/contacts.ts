import "server-only";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { Contact } from "@prisma/client";
import { UserError } from "@/core/action";
import { blindIndex, decryptOpt, encrypt } from "@/core/crypto";

// All contact PII is encrypted at rest. Phone + WhatsApp share one blind-index purpose
// so an inbound WhatsApp number can be matched against either column.

const P = { phone: "contact.phone", whatsapp: "contact.whatsapp", email: "contact.email" } as const;

export function normalizePhone(raw: string): string {
  const parsed = parsePhoneNumberFromString(raw.trim(), "IN");
  if (!parsed || !parsed.isValid()) throw new UserError(`"${raw}" is not a valid phone number`);
  return parsed.number; // E.164, e.g. +919812345678
}

export const normalizeEmail = (raw: string) => raw.trim().toLowerCase();

export const phoneIndex = (e164: string) => blindIndex("phone", e164);
export const emailIndex = (email: string) => blindIndex("email", normalizeEmail(email));

/** Builds encrypted + indexed columns for a Contact. Pass undefined to leave a column unset. */
export function contactPII(input: { phone?: string; whatsapp?: string; email?: string }) {
  const phone = input.phone ? normalizePhone(input.phone) : undefined;
  const whatsapp = input.whatsapp ? normalizePhone(input.whatsapp) : undefined;
  const email = input.email ? normalizeEmail(input.email) : undefined;
  return {
    phoneEnc: phone ? encrypt(phone, P.phone) : null,
    phoneIdx: phone ? phoneIndex(phone) : null,
    phoneLast4: phone ? phone.slice(-4) : null,
    whatsappEnc: whatsapp ? encrypt(whatsapp, P.whatsapp) : null,
    whatsappIdx: whatsapp ? phoneIndex(whatsapp) : null,
    emailEnc: email ? encrypt(email, P.email) : null,
    emailIdx: email ? emailIndex(email) : null,
  };
}

export type ContactView = {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  emailOptIn: boolean;
  waOptIn: boolean;
  consentAt: Date | null;
  consentSource: string | null;
  preferredChannel: string;
};

const mask = (last4: string | null) => (last4 ? `••••••${last4}` : null);

export function viewContact(c: Contact, opts: { reveal: boolean }): ContactView {
  return {
    id: c.id,
    name: c.name,
    phone: opts.reveal ? decryptOpt(c.phoneEnc, P.phone) : mask(c.phoneLast4),
    whatsapp: opts.reveal ? decryptOpt(c.whatsappEnc, P.whatsapp) : c.whatsappEnc ? "••••••" : null,
    email: opts.reveal ? decryptOpt(c.emailEnc, P.email) : c.emailEnc ? "•••@•••" : null,
    emailOptIn: c.emailOptIn,
    waOptIn: c.waOptIn,
    consentAt: c.consentAt,
    consentSource: c.consentSource,
    preferredChannel: c.preferredChannel,
  };
}

/** Decrypted address for sending (server-side only, never sent to the browser). */
export function contactAddress(c: Pick<Contact, "emailEnc" | "whatsappEnc" | "phoneEnc">, channel: "email" | "whatsapp"): string | null {
  if (channel === "email") return decryptOpt(c.emailEnc, P.email);
  return decryptOpt(c.whatsappEnc, P.whatsapp) ?? decryptOpt(c.phoneEnc, P.phone);
}
