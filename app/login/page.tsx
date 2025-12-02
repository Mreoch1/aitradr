"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleYahooSignIn = () => {
    setLoading(true);
    window.location.href = "/api/auth/yahoo/start";
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold text-gray-900">Sign In</h1>
          <p className="text-gray-600">Sign in with your Yahoo account to access your fantasy leagues</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
          <div className="space-y-4">
            <button
              onClick={handleYahooSignIn}
              disabled={loading}
              className="w-full rounded-md bg-[#6001D2] px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-[#720E9E] disabled:bg-gray-400"
            >
              {loading ? "Connecting..." : "Sign in with Yahoo"}
            </button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-2 text-gray-500">Or continue with email</span>
              </div>
            </div>

            <p className="text-center text-sm text-gray-600">
              For the best experience, we recommend signing in with your Yahoo account to automatically access your fantasy leagues.
            </p>
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-gray-600">
          Don't have an account?{" "}
          <a
            href="/signup"
            className="font-semibold text-[#6001D2] hover:text-[#720E9E] hover:underline"
          >
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}
