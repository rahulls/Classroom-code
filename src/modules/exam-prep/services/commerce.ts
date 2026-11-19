import "server-only";
import { EpError } from "../errors";
import { pdf } from "../adapters/pdf";
import { storage } from "../adapters/storage";
import { audit } from "../audit";
import { epdb } from "../db";
import { offerDue, priceFor, receiptNo } from "../domain/commerce";
import { mostImproved } from "../domain/ranking";
import { getSettings } from "../settings";
import { studentHistory } from "./analytics";
import { esc, pageHtml } from "./html";
import { draft, renderTemplate, setLabel } from "./messaging";
import { parentReachable } from "./people";

// R10 paid plans, offers and teaching add-ons. Prices come from settings; payments are teacher-only.
// Offer messages never mention ranks (this file does not read RankRecord).

/** After two reports, a repeating weak chapter becomes a suggested Offer with a drafted parent message. */
export async function suggestOffers() {
  const s = await getSettings();
  const students = await epdb.student.findMany({ where: { status: { in: ["free"] }, isDemo: false }, include: { parents: true } });
  let created = 0;
  for (const st of students) {
    for (const subject of st.subjects) {
      const hist = await studentHistory(st.id, subject);
      const subjectReports = await epdb.reportCard.count({ where: { studentId: st.id, audience: "student", status: { in: ["ready", "sent"] }, paperId: { in: hist.papers.map((p) => p.paperId) } } });
      if (!offerDue(subjectReports, hist.repeatingGaps, s["analytics.offerAfterReports"])) continue;
      for (const chapter of hist.repeatingGaps) {
        if (await epdb.offer.findUnique({ where: { studentId_subject_chapter: { studentId: st.id, subject, chapter } } })) continue;
        const offer = await epdb.offer.create({ data: { studentId: st.id, subject, chapter, reason: `${chapter} below ${s["analytics.gapBelow"]}% in ${s["analytics.gapPapers"]} papers` } });
        const parent = st.parents.find((p) => parentReachable(p));
        if (parent) {
          const body = await renderTemplate("paid_offer", { parent: parent.name, student: st.name.split(" ")[0], subject, chapter, tier: s["commercial.tiers"].paid1 }, parent.language as "en" | "hi");
          const m = await draft({ dedupeKey: `offer:${offer.id}`, templateKey: "paid_offer", audience: "parent", body, studentId: st.id, parentId: parent.id, to: parent.whatsapp });
          if (m) await epdb.offer.update({ where: { id: offer.id }, data: { messageId: m.id } });
        }
        await audit({ action: "offer.suggested", entity: "Offer", entityId: offer.id, new: { subject, chapter } });
        created++;
      }
    }
  }
  return { created };
}

export async function setOfferStatus(id: string, status: "sent" | "accepted" | "declined") {
  const o = await epdb.offer.findUniqueOrThrow({ where: { id } });
  await epdb.offer.update({ where: { id }, data: { status } });
  if (status === "sent" && o.messageId) await epdb.message.update({ where: { id: o.messageId }, data: { status: "sent", sentAt: new Date() } });
  await audit({ action: "offer.status", entity: "Offer", entityId: id, old: { status: o.status }, new: { status } });
}

/** Starts a plan; the family discount applies automatically for 2+ subjects. */
export async function startPlan(o: { studentId: string; tier: "free_report" | "paid1" | "paid2"; subjects: number; isTrial?: boolean; startedAt?: Date; endsAt?: Date }) {
  const s = await getSettings();
  const base = o.tier === "paid1" ? s["commercial.prices"].paid1 : o.tier === "paid2" ? s["commercial.prices"].paid2 : 0;
  const price = o.isTrial ? { gross: 0, discount: 0, net: 0 } : priceFor({ base, subjects: o.subjects, familyDiscountPct: s["commercial.familyDiscountPct"] });
  const plan = await epdb.plan.create({ data: { studentId: o.studentId, tier: o.tier, subjects: o.subjects, startedAt: o.startedAt ?? new Date(), endsAt: o.endsAt, price: price.gross, discount: price.discount, isTrial: !!o.isTrial } });
  if (o.tier !== "free_report") {
    const old = await epdb.student.findUniqueOrThrow({ where: { id: o.studentId } });
    await epdb.student.update({ where: { id: o.studentId }, data: { status: o.tier } });
    await setLabel(o.studentId, o.tier === "paid1" ? "Paid 1" : "Paid 2");
    await audit({ action: "payment_status.changed", entity: "Student", entityId: o.studentId, old: { status: old.status }, new: { status: o.tier, planId: plan.id } });
  }
  return { plan, price };
}

/** Records a payment with the next receipt number (unique, sequential) and makes the receipt PDF. */
export async function recordPayment(o: { studentId: string; planId?: string; amount: number; method: "UPI" | "cash" | "bank"; reference?: string; paidAt?: Date }) {
  if (!(o.amount > 0)) throw new EpError("Amount must be more than 0.");
  const s = await getSettings();
  const paidAt = o.paidAt ?? new Date();
  const pay = await epdb.$transaction(async (tx) => {
    const c = await tx.receiptCounter.upsert({ where: { id: "receipt" }, create: { id: "receipt", next: 2 }, update: { next: { increment: 1 } } });
    const seq = c.next - 1;
    return tx.payment.create({ data: { studentId: o.studentId, planId: o.planId, amount: o.amount, method: o.method, reference: o.reference, receiptNo: receiptNo(s["commercial.receiptPrefix"], paidAt.getFullYear(), seq), paidAt } });
  });
  await audit({ action: "payment.recorded", entity: "Payment", entityId: pay.id, new: { amount: pay.amount, method: pay.method, receiptNo: pay.receiptNo } });
  await receiptPdf(pay.id);
  return pay;
}

export async function receiptPdf(paymentId: string) {
  const s = await getSettings();
  const p = await epdb.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { student: true, plan: true } });
  const html = pageHtml({
    title: `Receipt ${p.receiptNo}`,
    onePage: true,
    body: `<h1>Receipt ${esc(p.receiptNo)}</h1><p class="muted">${esc(s["brand.tuitionName"])} · ${esc(s["brand.tutorName"])}</p>
<table><tr><th>Student</th><td>${esc(p.student.name)} (${esc(p.student.code)}), Class ${p.student.klass}</td></tr>
<tr><th>Plan</th><td>${esc(p.plan ? s["commercial.tiers"][p.plan.tier as "paid1"] ?? p.plan.tier : "-")}${p.plan?.discount ? ` (family discount ₹${p.plan.discount})` : ""}</td></tr>
<tr><th>Amount</th><td>₹${p.amount.toFixed(2)}</td></tr><tr><th>Method</th><td>${esc(p.method)}${p.reference ? ` · ref ${esc(p.reference)}` : ""}</td></tr>
<tr><th>Date</th><td>${p.paidAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long" })}</td></tr></table>
${s["commercial.refundLine"] ? `<p class="muted">${esc(s["commercial.refundLine"])}</p>` : ""}`,
  });
  const rel = `receipts/${p.receiptNo}.pdf`;
  await storage.save(rel, await pdf.fromHtml(html));
  return rel;
}

// ------------------------------ sessions, doubts, recognition ------------------------------

export async function createSession(o: { type: string; klass: number; board: string; subject: string; chapter?: string; offerId?: string; startsAt: Date; capacity: number; notes?: string }) {
  if (o.capacity < 1) throw new EpError("Capacity must be at least 1.");
  return epdb.teachingSession.create({ data: o });
}

export async function addAttendee(sessionId: string, studentId: string) {
  const s = await epdb.teachingSession.findUniqueOrThrow({ where: { id: sessionId }, include: { attendees: true } });
  if (s.attendees.some((a) => a.studentId === studentId)) return;
  if (s.attendees.length >= s.capacity) throw new EpError("The session is full.");
  await epdb.sessionAttendee.create({ data: { sessionId, studentId } });
}

export const setAttendance = (sessionId: string, studentId: string, attended: boolean) => epdb.sessionAttendee.update({ where: { sessionId_studentId: { sessionId, studentId } }, data: { attended } });

/** Doubt form: a photo of a question attached to a weekly doubt window. */
export async function addDoubt(o: { studentId: string; sessionId?: string; note?: string; file?: { name: string; bytes: Uint8Array } }) {
  let filePath: string | undefined;
  if (o.file) {
    if (!/\.(jpe?g|png|pdf)$/i.test(o.file.name)) throw new EpError("Attach a JPG, PNG or PDF.");
    const st = await epdb.student.findUniqueOrThrow({ where: { id: o.studentId } });
    filePath = `doubts/${st.code}/${Date.now()}-${o.file.name.replace(/[^\w.]+/g, "_")}`;
    await storage.save(filePath, o.file.bytes);
  }
  return epdb.doubt.create({ data: { studentId: o.studentId, sessionId: o.sessionId, note: o.note, filePath } });
}

export const answerDoubt = (id: string, response: string, status: "answered" | "closed" = "answered") => epdb.doubt.update({ where: { id }, data: { response, status } });

/** Most improved (teacher-only list, by improvement, never rank; never published). */
export async function mostImprovedList(klass: number, subject: string) {
  const subs = await epdb.submission.findMany({ where: { isCurrent: true, paper: { klass, subject, kind: "paper", number: { gt: 0 } } }, select: { studentId: true } });
  const series: Record<string, { pct: number }[]> = {};
  for (const id of new Set(subs.map((x) => x.studentId))) series[id] = (await studentHistory(id, subject)).papers.map((p) => ({ pct: p.pct }));
  const top = mostImproved(series);
  const students = await epdb.student.findMany({ where: { id: { in: top.map((t) => t.id) } } });
  return top.map((t) => ({ student: students.find((x) => x.id === t.id)!, change: Math.round(t.change) }));
}
