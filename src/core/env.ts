import "server-only";
import { z } from "zod";

// Validated, typed environment. The app refuses to start with weak or missing
// secrets, and refuses insecure settings in production.

const key32 = z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 random bytes, base64-encoded");
const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: key32,
  BLIND_INDEX_KEY: key32,
  SETUP_TOKEN: z.string().min(32, "must be at least 32 characters"),
  SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  COOKIE_SECURE: bool.default(false),
  REQUIRE_2FA: bool.default(false),
  // Comma-separated emails allowed to switch on "Edit mode" (modify every record). Must also be the Owner.
  FULL_EDIT_EMAILS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)),
  // Outgoing email. Default: the local Mailpit test inbox. Live: Gmail (smtp.gmail.com, 465, secure, app password).
  MAIL_HOST: z.string().default("127.0.0.1"),
  MAIL_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  MAIL_SECURE: bool.default(false),
  MAIL_USER: z.string().optional(),
  MAIL_PASSWORD: z.string().optional(),
  MAIL_FROM_NAME: z.string().default("Rahul Shah Classes"),
  MAIL_FROM_ADDRESS: z.email().optional(),
  SMTP_PORT: z.coerce.number().int().optional(), // Mailpit's local port (docker-compose)
  // WhatsApp: "test" logs messages without sending; "manual" prepares each message for you to send from
  // your own WhatsApp with one click (no Meta setup); "cloud" sends through the official WhatsApp Business Cloud API.
  WHATSAPP_MODE: z.enum(["test", "manual", "cloud"]).default("test"),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/, "must be the numeric Phone number ID from Meta").optional(),
  WHATSAPP_TEMPLATE: z.string().regex(/^[a-z0-9_]+$/).default("timetable_update"),
  WHATSAPP_TEMPLATE_LANG: z.string().default("en"),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v23.0"),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment (run \`npm run setup\`): ${issues}`);
  }
  const e = parsed.data;
  if (e.ENCRYPTION_KEY === e.BLIND_INDEX_KEY) throw new Error("ENCRYPTION_KEY and BLIND_INDEX_KEY must differ");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(e.APP_URL).hostname);
  // A production build served only on this computer (npm run app) can't use HTTPS. Every
  // other production deployment must pass the strict checks below.
  if (e.NODE_ENV === "production" && !loopback) {
    if (!e.APP_URL.startsWith("https://")) throw new Error("APP_URL must be https in production");
    if (!e.COOKIE_SECURE) throw new Error("COOKIE_SECURE must be true in production");
    if (!e.REQUIRE_2FA) throw new Error("REQUIRE_2FA must be true in production");
  }
  const mailLoopback = ["localhost", "127.0.0.1", "::1"].includes(e.MAIL_HOST);
  if (!mailLoopback && (!e.MAIL_USER || !e.MAIL_PASSWORD)) throw new Error("MAIL_USER and MAIL_PASSWORD are required when MAIL_HOST is a real mail server");
  if (e.WHATSAPP_MODE === "cloud" && (!e.WHATSAPP_TOKEN || !e.WHATSAPP_PHONE_NUMBER_ID)) throw new Error("WHATSAPP_MODE=cloud needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID");
  return {
    ...e,
    MAIL_PORT: e.MAIL_PORT ?? (mailLoopback ? (e.SMTP_PORT ?? 10250) : e.MAIL_SECURE ? 465 : 587),
    // Gmail shows app passwords in groups of four ("abcd efgh ijkl mnop"); the spaces aren't part of it
    MAIL_PASSWORD: e.MAIL_HOST.endsWith("gmail.com") ? e.MAIL_PASSWORD?.replace(/\s+/g, "") : e.MAIL_PASSWORD,
    MAIL_LOOPBACK: mailLoopback,
  };
}

export const env = load();
