"use client";

import clsx from "clsx";
import {
  Bell,
  Cable,
  Map as MapIcon,
  GraduationCap,
  LayoutGrid,
  MonitorSmartphone,
  Moon,
  Network,
  Radar,
  RotateCcw,
  ScrollText,
  Search,
  Server,
  Settings,
  Sun,
  Wifi,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useIssues } from "@/lib/hooks";
import { LESSONS } from "@/lib/lessons";
import { useStore } from "@/lib/store";
import { useWindows } from "@/lib/windows";
import { ClientIcon, DeviceGlyph } from "../icons";
import { AdminMenu, AlarmBell, SiteSwitcher, ViewOnlyBadge } from "../ops";
import { LessonPanel } from "./LessonPanel";
import { Terminal } from "./Terminal";

const WindowLayer = dynamic(() => import("../emulators/WindowLayer").then((module) => module.WindowLayer), {
  ssr: false,
  loading: () => <div role="status" className="fixed top-14 right-4 z-50 rounded border border-line bg-surface px-3 py-2 text-[12px] shadow">端末を読み込み中…</div>,
});

function EmulatorWindows() {
  const hasWindows = useWindows((s) => s.windows.length > 0);
  return hasWindows ? <WindowLayer /> : null;
}

const SETTING_PAGES = [
  { href: "/settings/wifi", label: "Wi-Fi 設定", words: ["wifi", "wi-fi", "ssid", "パスワード", "password", "無線", "ワイファイ"] },
  { href: "/settings/networks", label: "ネットワーク設定", words: ["network", "ネットワーク", "vlan", "dhcp", "サブネット", "mdns"] },
  { href: "/settings/zones", label: "ゾーン", words: ["zone", "ゾーン", "ファイアウォール", "firewall"] },
  { href: "/settings/policies", label: "ポリシー一覧", words: ["policy", "ポリシー", "ファイアウォール", "firewall", "ルール"] },
  { href: "/settings/security", label: "セキュリティとコンテンツ", words: ["ids", "ips", "dns フィルター", "セキュリティ", "ブロック"] },
  { href: "/ports", label: "ポートマネージャー", words: ["port", "ポート", "trunk", "トランク", "ケーブル", "配線"] },
  { href: "/floorplan", label: "フロアプラン", words: ["floor", "フロア", "間取り", "電波", "ヒートマップ", "部屋"] },
];

const NAV = [
  { href: "/dashboard", label: "ダッシュボード", icon: LayoutGrid },
  { href: "/topology", label: "トポロジー", icon: Network },
  { href: "/floorplan", label: "フロアプラン", icon: MapIcon },
  { href: "/devices", label: "デバイス", icon: Server },
  { href: "/ports", label: "ポートマネージャー", icon: Cable },
  { href: "/clients", label: "クライアント", icon: MonitorSmartphone },
  { href: "/diagnostics", label: "パケットトレース", icon: Radar },
  { href: "/logs", label: "ログ", icon: ScrollText },
  { href: "/learn", label: "学習", icon: GraduationCap },
];

export function Shell({ children, version, repositoryUrl }: { children: ReactNode; version: string; repositoryUrl: string }) {
  const [mounted, setMounted] = useState(false);
  const path = usePathname();
  const learningPage = path === "/lessons" || path === "/theory" || path.startsWith("/learn");
  const theme = useStore((s) => s.theme);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {mounted ? <Header learningPage={learningPage} /> : <div className="h-12 border-b border-line bg-chrome" />}
      <div className="flex min-h-0 flex-1">
        <Sidebar version={version} repositoryUrl={repositoryUrl} />
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
          <Suspense>{mounted ? children : null}</Suspense>
        </main>
      </div>
      {mounted && !learningPage && <LessonPanel />}
      {mounted && <EmulatorWindows />}
    </div>
  );
}

function NavItem({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof LayoutGrid; active: boolean }) {
  return (
    <Link
      href={href}
      title={label}
      className={clsx(
        "group relative flex size-9 items-center justify-center rounded-md transition-colors",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-fg",
      )}
    >
      <Icon size={19} strokeWidth={1.6} />
      <span className="pointer-events-none absolute left-full z-50 ml-2 hidden rounded bg-fg px-2 py-1 text-[12px] whitespace-nowrap text-surface group-hover:block">
        {label}
      </span>
    </Link>
  );
}

function Sidebar({ version, repositoryUrl }: { version: string; repositoryUrl: string }) {
  const path = usePathname();
  return (
    <nav className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-line bg-chrome py-2">
      {NAV.map((n) => (
        <NavItem key={n.href} {...n} active={path.startsWith(n.href) || (n.href === "/learn" && (path.startsWith("/theory") || path.startsWith("/lessons")))} />
      ))}
      <div className="mt-auto flex flex-col items-center gap-1">
        <NavItem href="/settings/networks" label="設定" icon={Settings} active={path.startsWith("/settings")} />
        <a href={repositoryUrl} target="_blank" rel="noreferrer" className="rounded px-1 py-0.5 text-[10px] text-fg-2 hover:bg-hover hover:underline"
          aria-label="NetLab の GitHub リポジトリ">GitHub</a>
        <span className="font-mono text-[10px] text-muted" aria-label={`NetLab バージョン ${version}`}>v{version}</span>
      </div>
    </nav>
  );
}

function Header({ learningPage }: { learningPage: boolean }) {
  const { theme, toggleTheme, activeLessonId, resetScenario, setLessonPanelOpen } = useStore();
  const issues = useIssues();
  const lesson = LESSONS.find((l) => l.id === activeLessonId);
  const errors = issues.filter((i) => i.severity === "error").length;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-chrome pr-3">
      <Link href="/dashboard" className="flex h-full w-[52px] items-center justify-center border-r border-line">
        <span className="flex size-7 items-center justify-center rounded-md bg-accent text-white">
          <Network size={15} strokeWidth={2} />
        </span>
      </Link>
      <span className="font-semibold">NetLab</span>
      <span className="flex h-7 items-center rounded px-2 text-fg-2">
        {lesson ? (
          learningPage
            ? <Link href="/diagnostics" className="text-accent hover:underline">{lesson.title}</Link>
            : <button onClick={() => setLessonPanelOpen(true)} className="text-accent hover:underline">{lesson.title}</button>
        ) : (
          "サンドボックス"
        )}
      </span>
      {!lesson && <SiteSwitcher />}
      <ViewOnlyBadge />
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-1">
        <Terminal />
        <AlarmBell />
        <Link href="/dashboard#notifications" className="relative rounded p-1.5 text-muted hover:bg-hover hover:text-fg" title="通知">
          <Bell size={17} strokeWidth={1.6} />
          {issues.length > 0 && <span className={clsx("absolute top-1 right-1 size-2 rounded-full ring-2 ring-chrome", errors ? "bg-err" : "bg-warn")} />}
        </Link>
        <button
          onClick={() => confirm(lesson ? "課題を初期状態に戻しますか？" : "サンドボックスを初期構成に戻しますか？") && resetScenario()}
          className="rounded p-1.5 text-muted hover:bg-hover hover:text-fg"
          title="初期状態に戻す"
        >
          <RotateCcw size={16} strokeWidth={1.6} />
        </button>
        <button onClick={toggleTheme} className="rounded p-1.5 text-muted hover:bg-hover hover:text-fg" title="テーマ切替">
          {theme === "dark" ? <Sun size={16} strokeWidth={1.6} /> : <Moon size={16} strokeWidth={1.6} />}
        </button>
        <AdminMenu />
      </div>
    </header>
  );
}

function GlobalSearch() {
  const s = useStore((x) => x.scenario);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, []);

  const results = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return [];
    // ID はネットワークと SSID で重なることがある（例: guest）ので、key には種類を付ける
    return [
      ...s.devices.filter((d) => d.name.toLowerCase().includes(k)).map((d) => ({ key: `device:${d.id}`, label: d.name, sub: d.model, href: `/devices?id=${d.id}`, icon: <DeviceGlyph type={d.type} size={20} /> })),
      ...s.clients.filter((c) => c.name.toLowerCase().includes(k)).map((c) => ({ key: `client:${c.id}`, label: c.name, sub: c.vendor, href: `/clients?id=${c.id}`, icon: <ClientIcon kind={c.kind} /> })),
      ...s.networks.filter((n) => n.name.toLowerCase().includes(k)).map((n) => ({ key: `network:${n.id}`, label: n.name, sub: `VLAN ${n.vlanId}`, href: `/settings/networks?id=${n.id}`, icon: <Network size={16} /> })),
      ...s.ssids.filter((w) => w.name.toLowerCase().includes(k)).map((w) => ({ key: `ssid:${w.id}`, label: w.name, sub: "Wi-Fi (SSID)", href: `/settings/wifi?id=${w.id}`, icon: <Wifi size={16} /> })),
      // 設定ページへのショートカット（「パスワード」「VLAN」などでも探せる）
      ...SETTING_PAGES.filter((p) => p.words.some((w) => w.toLowerCase().includes(k) || k.includes(w.toLowerCase()))).map((p) => ({ key: `page:${p.href}`, label: p.label, sub: "設定", href: p.href, icon: <Settings size={16} /> })),
    ].slice(0, 10);
  }, [q, s]);

  return (
    <div ref={ref} className="relative ml-4 hidden w-72 md:block">
      <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="デバイス、クライアント、ネットワークを検索"
        className="h-8 w-full rounded bg-surface-2 pr-2 pl-8 text-[13px] outline-none ring-1 ring-transparent placeholder:text-faint focus:bg-surface focus:ring-accent"
      />
      {open && results.length > 0 && (
        <ul className="absolute top-9 left-0 z-50 w-full overflow-hidden rounded border border-line bg-surface py-1 shadow-lg">
          {results.map((r) => (
            <li key={r.key}>
              <button
                onClick={() => {
                  setOpen(false);
                  setQ("");
                  router.push(r.href);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-hover"
              >
                <span className="flex w-5 justify-center text-muted">{r.icon}</span>
                <span className="flex-1 truncate">{r.label}</span>
                <span className="text-[12px] text-muted">{r.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
