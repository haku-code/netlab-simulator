import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Shell } from "@/components/shell/Shell";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NetLab",
  description: "ネットワーク設計を学べる管理画面シミュレーター",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" data-theme="light" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`}>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
