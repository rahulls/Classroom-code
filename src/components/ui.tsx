import Link from "next/link";
import type { ReactNode } from "react";

export type Crumb = { label: string; href?: string };

/**
 * Breadcrumb trail + Back button. The last crumb is the current page (no href);
 * Back goes to the nearest crumb before it, so it always lands on a predictable parent page.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const back = [...items].reverse().find((c) => c.href);
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-3 text-xs">
      {back?.href && (
        <Link href={back.href} className="btn px-2 py-1 text-xs" aria-label={`Back to ${back.label}`}>
          ← Back
        </Link>
      )}
      <ol className="flex flex-wrap items-center gap-1 text-muted">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden>›</span>}
            {c.href ? (
              <Link href={c.href} className="hover:text-ink hover:underline">
                {c.label}
              </Link>
            ) : (
              <span className="font-medium text-ink" aria-current="page">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Small marker shown next to controls that only exist in Edit mode. */
export function EditTag() {
  return <span className="ml-1 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn">edit mode</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const TONES = { neutral: "border-line text-muted", ok: "border-ok/40 text-ok", warn: "border-warn/40 text-warn", bad: "border-bad/40 text-bad", accent: "border-accent/40 text-accent" };

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${TONES[tone]}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">{children}</div>;
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "";
  return (
    <div className="card">
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

export const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "neutral"> = { ACTIVE: "ok", ON_HOLD: "warn", ALUMNI: "neutral", DROPPED: "bad" };
export const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", ON_HOLD: "On hold", ALUMNI: "Alumni", DROPPED: "Dropped" };
