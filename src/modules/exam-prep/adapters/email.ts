import "server-only";
import nodemailer from "nodemailer";
import { decrypt } from "../config";
import type { Settings } from "../settings";

// Email behind an interface. The SMTP adapter uses Exam Prep's own SMTP settings (default: the local
// Mailpit, so nothing reaches a real inbox until the teacher sets a real server). Tests use the stub.

export type Mail = { to: string; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] };

export interface Mailer {
  send(m: Mail, s: Settings): Promise<void>;
}

export const stubOutbox: Mail[] = [];

const stubMailer: Mailer = {
  async send(m) {
    stubOutbox.push(m);
  },
};

const smtpMailer: Mailer = {
  async send(m, s) {
    const c = s["delivery.smtp"];
    const pass = c.pass ? (c.pass.startsWith("v1.") ? decrypt(c.pass) : c.pass) : "";
    const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass } : undefined });
    await t.sendMail({ from: c.from, to: m.to, subject: m.subject, text: m.text, attachments: m.attachments });
  },
};

export const mailer: Mailer = process.env.EXAM_PREP_EMAIL_ADAPTER === "stub" ? stubMailer : smtpMailer;
