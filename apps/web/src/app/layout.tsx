import type { Metadata } from "next";
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
          <Sidebar />
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
