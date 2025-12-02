import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { SignOutButton } from "./components/SignOutButton";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fantasy Sports",
  description: "Fantasy Sports Trading Platform",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {session && (
          <nav className="border-b border-gray-200 bg-white">
            <div className="container mx-auto flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-6">
                <Link
                  href="/leagues"
                  className="text-lg font-semibold text-gray-900 hover:text-[#6001D2]"
                >
                  Fantasy Sports
                </Link>
              </div>
              <SignOutButton />
            </div>
          </nav>
        )}
        {children}
      </body>
    </html>
  );
}
