"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import AttendanceReport from "@/components/AttendanceReport";

export default function ReportPage() {
  const [token, setToken] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem("admin_token");
    const tokenTime = Number(localStorage.getItem("admin_token_time"));
    if (
      savedToken &&
      Number.isFinite(tokenTime) &&
      Date.now() - tokenTime < 30 * 60 * 1000
    ) {
      setToken(savedToken);
    }
    setCheckingSession(false);
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <Link
          href="/"
          className="mb-6 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          ← Back to dashboard
        </Link>
        {checkingSession ? (
          <p className="text-sm text-gray-500">Checking admin session...</p>
        ) : token ? (
          // AttendanceReport reads the URL query (useSearchParams).
          <Suspense fallback={<p className="text-sm text-gray-500">Loading report...</p>}>
            <AttendanceReport token={token} />
          </Suspense>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-bold">Admin sign-in required</h1>
            <p className="mt-2 text-sm text-gray-600">
              Sign in to the dashboard to view attendance and payroll reports.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}