"use client";

import { useRouter } from "next/navigation";
import { signout } from "@/lib/auth/client";

export function SignOutButton() {
  const router = useRouter();

  const handleSignOut = async () => {
    await signout();
    router.push("/login");
  };

  return (
    <button
      onClick={handleSignOut}
      className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
    >
      Sign out
    </button>
  );
}
