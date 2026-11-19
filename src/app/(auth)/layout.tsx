export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold">RSC Classroom</div>
          <div className="text-xs text-muted">Rahul Shah Classes</div>
        </div>
        <div className="card">{children}</div>
      </div>
    </div>
  );
}
