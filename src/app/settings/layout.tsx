"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIssues } from "@/lib/hooks";

const GROUPS = [
  {
    items: [
      { href: "/settings/wifi", label: "Wi-Fi", area: "wifi" },
      { href: "/settings/networks", label: "ネットワーク", area: "networks" },
      { href: "/settings/profiles", label: "ポートプロファイル" },
      { href: "/settings/internet", label: "インターネット" },
      { href: "/settings/routing", label: "ルーティング・VPN" },
      { href: "/settings/qos", label: "QoS" },
    ],
  },
  {
    title: "ファイアウォール",
    items: [
      { href: "/settings/zones", label: "ゾーン" },
      { href: "/settings/policies", label: "ポリシー一覧", area: "firewall" },
      { href: "/settings/objects", label: "オブジェクト" },
      { href: "/settings/forwarding", label: "ポートフォワード" },
    ],
  },
  {
    title: "システム",
    items: [
      { href: "/settings/sites", label: "サイト" },
      { href: "/settings/admins", label: "管理者とロール" },
      { href: "/settings/backup", label: "バックアップ" },
    ],
  },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const issues = useIssues();
  return (
    <div className="-mx-4 -my-5 flex min-h-[calc(100%+2.5rem)] md:-mx-6">
      <nav className="w-48 shrink-0 border-r border-line bg-surface px-2 py-4">
        <div className="mb-3 px-3 text-[15px] font-semibold">設定</div>
        {GROUPS.map((g, i) => (
          <div key={i} className="mb-3">
            {g.title && <div className="px-3 pt-2 pb-1 text-[11.5px] font-medium text-muted">{g.title}</div>}
            {g.items.map((it) => {
              const n = "area" in it ? issues.filter((x) => x.area === it.area).length : 0;
              const active = path === it.href;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={clsx(
                    "flex h-8 items-center justify-between rounded px-3 transition-colors",
                    active ? "bg-accent-soft font-medium text-accent" : "text-fg-2 hover:bg-hover hover:text-fg",
                  )}
                >
                  {it.label}
                  {n > 0 && <span className="size-1.5 rounded-full bg-warn" />}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="min-w-0 flex-1 px-4 py-5 md:px-8">{children}</div>
    </div>
  );
}
