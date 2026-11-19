"use client";

import { AppError } from "@/components/app-error";
import "./globals.css";

export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="bg-bg text-ink">
        <AppError {...props} />
      </body>
    </html>
  );
}
