import "server-only";
import crypto from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt, encrypt, examPrepEnabled } from "./config";
import { epdb } from "./db";

// Exam Prep sign-in: one teacher account in Exam Prep's own database, its own cookie (scoped to
// /exam-prep), its own optional two-step code. Nothing is shared with the classroom's login.

export const EP_COOKIE = "ep_session";
const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60_000;
authenticator.options = { window: 1, step: 30, digits: 6 };

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export const hasAccount = async () => (await epdb.teacherAccount.count()) > 0;

export async function createAccount(username: string, password: string) {
  if (await hasAccount()) throw new Error("The teacher account already exists.");
  return epdb.teacherAccount.create({ data: { username: username.trim().toLowerCase(), passwordHash: await hash(password) } });
}

/** Too many failed sign-ins in the last 15 minutes. */
async function rateLimited() {
  const fails = await epdb.signInLog.count({ where: { ok: false, at: { gte: new Date(Date.now() - FAIL_WINDOW_MS) } } });
  return fails >= MAX_FAILS;
}

export async function signIn(username: string, password: string, code?: string) {
  if (await rateLimited()) {
    await epdb.signInLog.create({ data: { ok: false, reason: "rate_limited" } });
    return { ok: false as const, error: "Too many tries. Wait 15 minutes and try again." };
  }
  const acc = await epdb.teacherAccount.findUnique({ where: { username: username.trim().toLowerCase() } });
  const passOk = acc ? await verify(acc.passwordHash, password).catch(() => false) : false;
  if (!acc || !passOk) {
    await epdb.signInLog.create({ data: { ok: false, reason: "bad_password" } });
    return { ok: false as const, error: "Wrong username or password." };
  }
  if (acc.totpSecret) {
    if (!code || !authenticator.check(code.replace(/\s/g, ""), decrypt(acc.totpSecret))) {
      await epdb.signInLog.create({ data: { ok: false, reason: "bad_code" } });
      return { ok: false as const, error: code ? "That code didn't work." : "Enter the 6-digit code from your authenticator app.", needCode: true };
    }
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  await epdb.authSession.create({ data: { id: sha(token), accountId: acc.id, expiresAt, twoStepOk: !!acc.totpSecret } });
  await epdb.signInLog.create({ data: { ok: true } });
  (await cookies()).set(EP_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: false, path: "/exam-prep", expires: expiresAt });
  return { ok: true as const };
}

export async function signOut() {
  const jar = await cookies();
  const t = jar.get(EP_COOKIE)?.value;
  if (t) await epdb.authSession.deleteMany({ where: { id: sha(t) } });
  jar.delete({ name: EP_COOKIE, path: "/exam-prep" });
}

export type Teacher = { id: string; username: string; twoStep: boolean };

/** The signed-in teacher, or null. */
export async function currentTeacher(): Promise<Teacher | null> {
  if (!examPrepEnabled()) return null;
  const t = (await cookies()).get(EP_COOKIE)?.value;
  if (!t) return null;
  const s = await epdb.authSession.findUnique({ where: { id: sha(t) } });
  if (!s || s.expiresAt < new Date()) return null;
  const acc = await epdb.teacherAccount.findUnique({ where: { id: s.accountId } });
  if (!acc) return null;
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) await epdb.authSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
  return { id: acc.id, username: acc.username, twoStep: !!acc.totpSecret };
}

/** Pages: the teacher or a redirect to the sign-in page. */
export async function requireTeacher(): Promise<Teacher> {
  const t = await currentTeacher();
  if (!t) redirect((await hasAccount()) ? "/exam-prep/login" : "/exam-prep/setup");
  return t;
}

// ------------------------------ two-step verification ------------------------------

export async function startTwoStep(accountId: string) {
  const secret = authenticator.generateSecret(20);
  const acc = await epdb.teacherAccount.findUniqueOrThrow({ where: { id: accountId } });
  const qr = await QRCode.toDataURL(authenticator.keyuri(acc.username, "Exam Prep", secret), { margin: 1, width: 200 });
  return { secret, qr };
}

export async function confirmTwoStep(accountId: string, secret: string, code: string) {
  if (!authenticator.check(code.replace(/\s/g, ""), secret)) return false;
  await epdb.teacherAccount.update({ where: { id: accountId }, data: { totpSecret: encrypt(secret) } });
  return true;
}

export async function changePassword(accountId: string, current: string, next: string) {
  const acc = await epdb.teacherAccount.findUniqueOrThrow({ where: { id: accountId } });
  if (!(await verify(acc.passwordHash, current).catch(() => false))) return false;
  await epdb.teacherAccount.update({ where: { id: accountId }, data: { passwordHash: await hash(next) } });
  await epdb.authSession.deleteMany({ where: { accountId } });
  return true;
}
