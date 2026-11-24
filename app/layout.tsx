import type { Metadata } from "next";
import { Archivo, Inter } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Display face: Archivo at 900 + expanded width stands in for Wise Sans (heavy, wide block letters).
const display = Archivo({ subsets: ["latin"], variable: "--font-archivo", axes: ["wdth"], display: "swap" });

export const metadata: Metadata = {
  title: "Undercurrent",
  description: "Find the markets you didn't know you had.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh bg-canvas text-body">{children}</body>
    </html>
  );
}
