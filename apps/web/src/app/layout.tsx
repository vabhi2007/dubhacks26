import type { Metadata } from "next";
import { Suspense } from "react";
import { DM_Serif_Display, Geist, Geist_Mono, Inter_Tight } from "next/font/google";
import { Toaster } from "sonner";
import { APP_NAME, TAGLINE } from "@alfred/shared";
import { Sidebar } from "../components/Sidebar";
import { SavingsCounter } from "../components/SavingsCounter";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// DM Serif Display — headings; Inter Tight — money/numbers (.num). DESIGN.md §6.
const dmSerif = DM_Serif_Display({ variable: "--font-dm-serif", subsets: ["latin"], weight: "400" });
const interTight = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"] });

export const metadata: Metadata = { title: APP_NAME, description: TAGLINE };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} ${dmSerif.variable} ${interTight.variable} h-full antialiased`}
    >
      <body className="h-full">
        <div className="flex h-full">
          {/* usePathname() in Sidebar needs a Suspense boundary so dynamic routes (e.g. /wishlist/[productId]) can prerender. */}
          <Suspense fallback={<aside className="w-56 shrink-0 border-r border-border bg-surface" />}>
            <Sidebar />
          </Suspense>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
              <p className="hidden text-sm text-text-muted sm:block">{TAGLINE}</p>
              <SavingsCounter />
            </header>
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
        <Toaster theme="dark" position="bottom-right" richColors />
      </body>
    </html>
  );
}
