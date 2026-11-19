import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { decrypt } from "../config";
import type { Settings } from "../settings";

// AI-assisted marking behind an interface (R5, R11). A request carries ONLY: the answer-sheet file
// (image or PDF), the question's marking scheme and marks, and the student's code (EP-0001). Never a
// name, phone number, email or school: assertRedacted() refuses a request that has any other field or
// anything that looks like a phone number or email address.

export type MarkRequest = {
  studentCode: string;
  questionId: string;
  questionNumber: number;
  questionText: string;
  maxMarks: number;
  markingScheme: { step: string; marks: number }[];
  /** CBSE internal choice: the (B) alternative; the student answers one of the two */
  alternativeText?: string;
  alternativeScheme?: { step: string; marks: number }[];
  sheet: { mediaType: "application/pdf" | "image/jpeg" | "image/png"; base64: string };
};

export type MarkProposal = { marks: number; confidence: number; reasoning: string; errorTag: "concept" | "calculation" | "missing_steps" | "misread" | "none"; blank: boolean; unreadable: boolean };

export interface AiMarker {
  propose(r: MarkRequest, s: Settings): Promise<MarkProposal>;
}

const ALLOWED = new Set(["studentCode", "questionId", "questionNumber", "questionText", "maxMarks", "markingScheme", "alternativeText", "alternativeScheme", "sheet"]);
const PHONE = /(\+?\d[\d\s-]{8,}\d)/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;

/** Throws if the request could carry personal data. Also used by the privacy tests. */
export function assertRedacted(r: Record<string, unknown>, forbidden: string[] = []) {
  for (const k of Object.keys(r)) if (!ALLOWED.has(k)) throw new Error(`AI request has a field that is not allowed: ${k}`);
  if (!/^EP-\d{4,}$/.test(String(r.studentCode))) throw new Error("AI request must identify the student by code only");
  const text = JSON.stringify({ ...r, sheet: undefined });
  if (PHONE.test(text) || EMAIL.test(text)) throw new Error("AI request contains a phone number or email");
  for (const f of forbidden) if (f && f.length > 2 && text.toLowerCase().includes(f.toLowerCase())) throw new Error("AI request contains personal data");
}

/** What is logged about a request (no image). */
export const requestSummary = (r: MarkRequest) => ({ ...r, sheet: { mediaType: r.sheet.mediaType, bytes: Math.round((r.sheet.base64.length * 3) / 4) } });

/** Test stub: deterministic proposals; flags about one in four answers for review. */
const stubMarker: AiMarker = {
  async propose(r) {
    const h = [...`${r.studentCode}${r.questionId}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const marks = Math.round(((h % 100) / 100) * r.maxMarks * 2) / 2;
    const confidence = 0.5 + ((h >>> 7) % 50) / 100;
    const lost = r.maxMarks - marks;
    return { marks, confidence, reasoning: "Stub proposal for tests.", errorTag: lost <= 0 ? "none" : h % 2 ? "calculation" : "missing_steps", blank: false, unreadable: false };
  },
};

const claudeMarker: AiMarker = {
  async propose(r, s) {
    const key = s["marking.aiKey"] ? decrypt(s["marking.aiKey"]) : process.env.EXAM_PREP_ANTHROPIC_KEY;
    if (!key) throw new Error("Add a Claude API key in Exam Prep settings first.");
    const client = new Anthropic({ apiKey: key });
    const fmt = (sch: { step: string; marks: number }[]) => sch.map((st, i) => `${i + 1}. ${st.step} (${st.marks} mark${st.marks === 1 ? "" : "s"})`).join("\n");
    const scheme = r.alternativeText
      ? `(A) ${fmt(r.markingScheme)}\n\nThis question has an internal choice. The student answers EITHER (A) above OR (B):\n(B) ${r.alternativeText}\nMarking scheme for (B):\n${fmt(r.alternativeScheme ?? [])}\n\nFind which one the student attempted and mark it by its own scheme.`
      : fmt(r.markingScheme);
    const sheetBlock =
      r.sheet.mediaType === "application/pdf"
        ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: r.sheet.base64 } } as const)
        : ({ type: "image", source: { type: "base64", media_type: r.sheet.mediaType, data: r.sheet.base64 } } as const);
    const msg = await client.messages.create({
      model: s["marking.aiModel"],
      max_tokens: 1200,
      system:
        "You propose marks for one question on a school student's handwritten answer sheet, strictly by the marking scheme. A teacher reviews every proposal. Find the answer to the given question number on the sheet. Answer only with JSON.",
      messages: [
        {
          role: "user",
          content: [
            sheetBlock,
            {
              type: "text",
              text: `Question ${r.questionNumber} (max ${r.maxMarks} marks): ${r.questionText}\n\nMarking scheme:\n${scheme}\n\nReply with JSON only: {"marks": number (0-${r.maxMarks}, halves allowed), "confidence": number 0-1, "reasoning": "one or two sentences: which steps earned marks", "errorTag": "concept"|"calculation"|"missing_steps"|"misread"|"none", "blank": boolean, "unreadable": boolean}`,
            },
          ],
        },
      ],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Partial<MarkProposal>;
    const marks = Math.max(0, Math.min(r.maxMarks, Number(j.marks) || 0));
    return {
      marks,
      confidence: Math.max(0, Math.min(1, Number(j.confidence) || 0)),
      reasoning: String(j.reasoning ?? "").slice(0, 600),
      errorTag: (["concept", "calculation", "missing_steps", "misread", "none"] as const).includes(j.errorTag as never) ? (j.errorTag as MarkProposal["errorTag"]) : "none",
      blank: !!j.blank,
      unreadable: !!j.unreadable,
    };
  },
};

let current: AiMarker = process.env.EXAM_PREP_AI_ADAPTER === "stub" ? stubMarker : claudeMarker;

/** The active marker. Tests swap in their own with setAiMarker (never a real AI service in tests). */
export const aiMarker: AiMarker = { propose: (r, s) => current.propose(r, s) };
export function setAiMarker(m: AiMarker | null) {
  current = m ?? (process.env.EXAM_PREP_AI_ADAPTER === "stub" ? stubMarker : claudeMarker);
}
