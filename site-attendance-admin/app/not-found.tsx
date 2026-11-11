import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
      <div className="bg-rose-50 text-rose-600 p-4 rounded-2xl mb-4">
        <AlertTriangle size={36} />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Page Not Found</h2>
      <p className="text-sm text-gray-500 max-w-sm mb-6">
        The page you are looking for doesn't exist or has been moved.
      </p>
      <Link
        href="/"
        className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 py-2.5 rounded-xl text-sm transition-all shadow-sm"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
