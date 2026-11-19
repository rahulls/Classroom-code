import { notFound } from "next/navigation";
import { examPrepEnabled } from "@/modules/exam-prep/config";

export const metadata = { title: { default: "Exam Prep", template: "%s · Exam Prep" } };
export const dynamic = "force-dynamic";

/** Exam Prep: a separate module (own database, own sign-in). Hidden entirely when the feature flag is off. */
export default function ExamPrepRoot({ children }: { children: React.ReactNode }) {
  if (!examPrepEnabled()) notFound();
  return <div className="min-h-screen bg-[#f4f7fb]">{children}</div>;
}
