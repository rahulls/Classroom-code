// Fixture A (spec section 8): Class 10 CBSE Maths, Paper 1, 40 marks, three students.
// Minimum cohort size is 3 for this fixture. Demo names only: no real student data.

export const FIXTURE_A_CHAPTERS = ["Real Numbers", "Polynomials", "Quadratic Equations", "Trigonometry", "Statistics"];
export const FIXTURE_A_MAX: Record<string, number> = { "Real Numbers": 6, Polynomials: 6, "Quadratic Equations": 10, Trigonometry: 10, Statistics: 8 };
export const FIXTURE_A_MARKS: Record<string, Record<string, number>> = {
  Aarav: { "Real Numbers": 5, Polynomials: 5, "Quadratic Equations": 4, Trigonometry: 9, Statistics: 3 },
  Diya: { "Real Numbers": 3, Polynomials: 4, "Quadratic Equations": 8, Trigonometry: 5, Statistics: 7 },
  Kabir: { "Real Numbers": 6, Polynomials: 2, "Quadratic Equations": 3, Trigonometry: 4, Statistics: 2 },
};

/**
 * One question per 2 marks keeps it realistic: each chapter's max is split into questions of 2 marks
 * (Real Numbers 6 → three 2-mark questions), and a student's chapter marks fill them in order.
 */
export function fixtureAQuestions() {
  const qs: { id: string; chapter: string; marks: number; type: string }[] = [];
  for (const ch of FIXTURE_A_CHAPTERS) {
    const max = FIXTURE_A_MAX[ch]!;
    for (let i = 0; i < max / 2; i++) qs.push({ id: `${ch}#${i + 1}`, chapter: ch, marks: 2, type: "short" });
  }
  return qs;
}

export function fixtureAMarksFor(student: string) {
  const out: Record<string, number> = {};
  for (const ch of FIXTURE_A_CHAPTERS) {
    let left = FIXTURE_A_MARKS[student]![ch]!;
    for (const q of fixtureAQuestions().filter((q) => q.chapter === ch)) {
      const m = Math.min(q.marks, left);
      out[q.id] = m;
      left -= m;
    }
  }
  return out;
}

/** Aarav's 6 marks lost in Quadratic Equations: 4 calculation, 2 missing steps. */
export const AARAV_QE_ERRORS = [
  { chapter: "Quadratic Equations", marks: 2, awarded: 0, errorTag: "calculation" },
  { chapter: "Quadratic Equations", marks: 2, awarded: 0, errorTag: "calculation" },
  { chapter: "Quadratic Equations", marks: 2, awarded: 0, errorTag: "missing_steps" },
  { chapter: "Quadratic Equations", marks: 2, awarded: 2, errorTag: "none" },
  { chapter: "Quadratic Equations", marks: 2, awarded: 2, errorTag: "none" },
];
