import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-24 max-w-sm text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="mt-1 text-sm text-muted">It may have moved, or you may not have access.</p>
      <Link href="/today" className="btn mt-4">
        Go to Today
      </Link>
    </div>
  );
}
