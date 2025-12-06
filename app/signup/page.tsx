"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleYahooSignIn = () => {
    setLoading(true);
    window.location.href = "/api/auth/yahoo/start";
  };

  return (
    <div className="flex min-h-screen items-center justify-center theme-bg-primary">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold theme-text-primary">Create Account</h1>
          <p className="theme-text-secondary">Sign up with your Yahoo account to get started</p>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 theme-bg-secondary p-8 shadow-sm">
          <div className="space-y-4">
            <button
              onClick={handleYahooSignIn}
              disabled={loading}
              className="w-full rounded-md bg-[#6001D2] px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-[#720E9E] disabled:bg-gray-400 dark:disabled:bg-gray-600"
            >
              {loading ? "Connecting..." : "Sign up with Yahoo"}
            </button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300 dark:border-gray-700"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="theme-bg-secondary px-2 theme-text-secondary">Or create account with email</span>
              </div>
            </div>

            <p className="text-center text-sm theme-text-secondary">
              Signing up with Yahoo will automatically link your fantasy leagues and give you instant access to all features.
            </p>
          </div>
        </div>

        <p className="mt-6 text-center text-sm theme-text-secondary">
          Already have an account?{" "}
          <a
            href="/login"
            className="font-semibold text-[#6001D2] hover:text-[#720E9E] dark:text-purple-400 dark:hover:text-purple-300 hover:underline"
          >
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
