import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig = (phase: string): NextConfig => ({
  // 開発時の Next.js バッジがサイドバー下部の「設定」アイコンに重なるため非表示
  devIndicators: false,
  // 起動中の開発サーバーのチャンクを本番ビルドで上書きしない
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  output: process.env.NETLAB_STATIC_EXPORT === "1" ? "export" : undefined,
});

export default nextConfig;
