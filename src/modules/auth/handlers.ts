import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, UserError } from "@/core/action";
import { audit } from "@/core/audit";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { decrypt, encrypt, safeEqual, sha256 } from "@/core/crypto";
import { requestMeta } from "@/core/request";
import { fakeVerify, hashPassword, passwordSchema, verifyPassword } from "@/core/auth/password";
import { isRateLimited, recordAttempt } from "@/core/auth/rate-limit";
import { clearSessionCookie, createSession, getSession, revokeAllSessions, revokeSession } from "@/core/auth/session";
import { generateRecoveryCodes, generateTotpSecret, normalizeRecoveryCode, verifyTotp } from "@/core/auth/totp";

const GENERIC_LOGIN_ERROR = "Email or password is incorrect.";
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
const TOTP_PURPOSE = "user.totp";

// ─────────────── First-run setup (creates the Owner; only possible while no user exists) ───────────────

export const setupOwnerAction = defineAction({
  public: true,
  schema: z
    .object({
      setupToken: z.string().min(1, "Setup token is required").max(200),
      name: z.string().trim().min(2, "Name is required").max(100),
      email: z.email("Enter a valid email").max(254),
      password: passwordSchema,
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" }),
  run: async (input) => {
    const { ip } = await requestMeta();
    if (await isRateLimited("setup", ip ?? "unknown")) throw new UserError("Too many attempts. Try again later.");
    if (!safeEqual(input.setupToken.trim(), env.SETUP_TOKEN)) {
      await recordAttempt("setup", ip ?? "unknown", false);
      await audit({ action: "auth.setup.bad_token" });
      throw new UserError("Setup token is incorrect.");
    }

    const passwordHash = await hashPassword(input.password);
    const user = await db.$transaction(
      async (tx) => {
        if ((await tx.user.count()) > 0) throw new UserError("Setup has already been completed.");
        const ownerRole = await tx.role.findFirst({ where: { name: "Owner", isSystem: true } });
        const created = await tx.user.create({
          data: { email: input.email.toLowerCase(), name: input.name, passwordHash, isOwner: true },
        });
        if (ownerRole) await tx.userRole.create({ data: { userId: created.id, roleId: ownerRole.id } });
        await audit({ action: "auth.setup.owner_created", actor: created, entity: "user", entityId: created.id }, tx);
        return created;
      },
      { isolationLevel: "Serializable" },
    );
    await recordAttempt("setup", ip ?? "unknown", true);
    void user;
    redirect("/login?setup=done");
  },
});

// ─────────────── Login ───────────────

export const loginAction = defineAction({
  public: true,
  schema: z.object({
    email: z.email(GENERIC_LOGIN_ERROR).max(254),
    password: z.string().min(1, "Password is required").max(128),
  }),
  run: async ({ email, password }) => {
    const normalized = email.toLowerCase();
    const { ip } = await requestMeta();

    if ((await isRateLimited("email", normalized)) || (await isRateLimited("ip", ip))) {
      await audit({ action: "auth.login.rate_limited" });
      throw new UserError("Too many attempts. Please wait 15 minutes and try again.");
    }

    const user = await db.user.findUnique({ where: { email: normalized } });
    const fail = async (reason: string) => {
      await recordAttempt("email", normalized, false);
      await recordAttempt("ip", ip, false);
      await audit({ action: "auth.login.failed", entity: "user", entityId: user?.id, after: { reason } });
      throw new UserError(GENERIC_LOGIN_ERROR);
    };

    if (!user) {
      await fakeVerify(password);
      return fail("unknown_email");
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await fakeVerify(password);
      return fail("locked");
    }
    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid || user.status !== "ACTIVE") {
      const count = user.failedLoginCount + 1;
      await db.user.update({
        where: { id: user.id },
        data: { failedLoginCount: count, lockedUntil: count >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      return fail(valid ? "disabled" : "bad_password");
    }

    await recordAttempt("email", normalized, true);
    await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });

    const needsMfa = user.totpEnabledAt !== null;
    await createSession(user.id, { mfaPending: needsMfa });
    if (needsMfa) {
      await audit({ action: "auth.login.password_ok_mfa_pending", actor: user, entity: "user", entityId: user.id });
      redirect("/login/2fa");
    }
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit({ action: "auth.login.success", actor: user, entity: "user", entityId: user.id });
    redirect("/today");
  },
});

// ─────────────── Second factor ───────────────

export const verifyMfaAction = defineAction({
  public: true,
  schema: z.object({ code: z.string().trim().min(6, "Enter the 6-digit code").max(20) }),
  run: async ({ code }) => {
    const session = await getSession();
    if (!session || !session.mfaPending) redirect("/login");
    const user = session.user;

    if (await isRateLimited("mfa", user.id)) {
      await revokeSession(session.id);
      await clearSessionCookie();
      throw new UserError("Too many wrong codes. Sign in again in 15 minutes.");
    }

    let ok = false;
    let usedRecovery = false;
    if (/^\d{6}$/.test(code) && user.totpSecretEnc) {
      const step = verifyTotp(code, decrypt(user.totpSecretEnc, TOTP_PURPOSE));
      if (step !== null && step > (user.totpLastStep ?? -1)) {
        ok = true;
        await db.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
      }
    } else {
      const hash = sha256(normalizeRecoveryCode(code));
      const used = await db.recoveryCode.updateMany({ where: { userId: user.id, codeHash: hash, usedAt: null }, data: { usedAt: new Date() } });
      ok = used.count === 1;
      usedRecovery = ok;
    }

    await recordAttempt("mfa", user.id, ok);
    if (!ok) {
      await audit({ action: "auth.mfa.failed", actor: user, entity: "user", entityId: user.id });
      throw new UserError("That code isn't valid. Try again.");
    }

    // Rotate: drop the half-authenticated session, issue a fresh full one.
    await revokeSession(session.id);
    await createSession(user.id, { mfaPending: false });
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit({ action: usedRecovery ? "auth.login.success_recovery_code" : "auth.login.success", actor: user, entity: "user", entityId: user.id });
    redirect("/today");
  },
});

// ─────────────── Logout ───────────────

export const logoutAction = defineAction({
  public: true,
  schema: z.object({}),
  run: async () => {
    const session = await getSession();
    if (session) {
      await revokeSession(session.id);
      await audit({ action: "auth.logout", actor: session.user, entity: "user", entityId: session.user.id });
    }
    await clearSessionCookie();
    redirect("/login");
  },
});

// ─────────────── Account security (signed-in) ───────────────

export const changePasswordAction = defineAction({
  schema: z
    .object({ current: z.string().min(1, "Required").max(128), password: passwordSchema, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" })
    .refine((v) => v.password !== v.current, { path: ["password"], message: "Choose a different password" }),
  run: async (input, { user }) => {
    if (!(await verifyPassword(user.passwordHash, input.current))) throw new UserError("Current password is incorrect.");
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.password), passwordChangedAt: new Date() } });
    // All existing sessions are now invalid (created before passwordChangedAt); start a fresh one.
    await revokeAllSessions(user.id);
    await createSession(user.id, { mfaPending: false });
    await audit({ action: "auth.password.changed", actor: user, entity: "user", entityId: user.id });
    return { ok: true, message: "Password changed. Other devices have been signed out." };
  },
});

export const startTotpSetupAction = defineAction({
  schema: z.object({}),
  run: async (_input, { user }) => {
    if (user.totpEnabledAt) throw new UserError("Two-factor authentication is already on.");
    await db.user.update({ where: { id: user.id }, data: { totpPendingEnc: encrypt(generateTotpSecret(), TOTP_PURPOSE) } });
    revalidatePath("/settings/security");
  },
});

export const confirmTotpSetupAction = defineAction({
  schema: z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }),
  run: async ({ code }, { user }) => {
    if (!user.totpPendingEnc) throw new UserError("Start setup first.");
    const step = verifyTotp(code, decrypt(user.totpPendingEnc, TOTP_PURPOSE));
    if (step === null) throw new UserError("That code isn't valid. Check your phone's time and try again.");
    const { plain, hashes } = generateRecoveryCodes();
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { totpSecretEnc: user.totpPendingEnc, totpPendingEnc: null, totpEnabledAt: new Date(), totpLastStep: step },
      }),
      db.recoveryCode.deleteMany({ where: { userId: user.id } }),
      db.recoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: user.id, codeHash })) }),
    ]);
    await audit({ action: "auth.mfa.enabled", actor: user, entity: "user", entityId: user.id });
    // No revalidatePath here: the client shows the one-time recovery codes, then refreshes itself.
    return { ok: true, message: "Two-factor authentication is on.", data: { recoveryCodes: plain } };
  },
});

export const disableTotpAction = defineAction({
  schema: z.object({ password: z.string().min(1).max(128), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }),
  run: async ({ password, code }, { user }) => {
    if (env.REQUIRE_2FA) throw new UserError("Two-factor authentication is required and can't be turned off.");
    if (!user.totpSecretEnc) throw new UserError("Two-factor authentication is not on.");
    const step = verifyTotp(code, decrypt(user.totpSecretEnc, TOTP_PURPOSE));
    if (!(await verifyPassword(user.passwordHash, password)) || step === null || step <= (user.totpLastStep ?? -1)) {
      throw new UserError("Password or code is incorrect.");
    }
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null } }),
      db.recoveryCode.deleteMany({ where: { userId: user.id } }),
    ]);
    await audit({ action: "auth.mfa.disabled", actor: user, entity: "user", entityId: user.id });
    revalidatePath("/settings/security");
    return { ok: true, message: "Two-factor authentication turned off." };
  },
});

export const revokeSessionAction = defineAction({
  schema: z.object({ sessionId: z.uuid() }),
  run: async ({ sessionId }, { user }) => {
    const current = await getSession();
    if (sessionId === current?.id) throw new UserError("Use Sign out to end this session.");
    const res = await db.session.updateMany({ where: { id: sessionId, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (res.count) await audit({ action: "auth.session.revoked", actor: user, entity: "session", entityId: sessionId });
    revalidatePath("/settings/security");
  },
});

export const revokeOtherSessionsAction = defineAction({
  schema: z.object({}),
  run: async (_i, { user }) => {
    const current = await getSession();
    await revokeAllSessions(user.id, current?.id);
    await audit({ action: "auth.session.revoked_all_others", actor: user, entity: "user", entityId: user.id });
    revalidatePath("/settings/security");
    return { ok: true, message: "All other sessions signed out." };
  },
});
