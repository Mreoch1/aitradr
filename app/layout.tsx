import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "AiTradr - Fantasy Hockey Trade Analyzer",
  description: "The ultimate fantasy hockey trade analyzer. Build trades, calculate player values, and dominate your league. Brought to you by The Mooninites! 🏒👽",
  openGraph: {
    title: "AiTradr - Fantasy Hockey Trade Analyzer",
    description: "Build winning trades with AI-powered player valuations. Brought to you by The Mooninites!",
    type: "website",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "AiTradr - Fantasy Hockey Trade Analyzer",
    description: "Build winning trades with AI-powered player valuations. Brought to you by The Mooninites!",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
