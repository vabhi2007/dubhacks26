import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { APP_NAME, TAGLINE } from "@alfred/shared";
import { Sidebar } from "../components/Sidebar";
import { SavingsCounter } from "../components/SavingsCounter";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = { title: APP_NAME, description: TAGLINE };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
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
