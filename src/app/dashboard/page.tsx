"use client";

import clsx from "clsx";
import Link from "next/link";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ClientIcon } from "@/components/icons";
import { TopologyView } from "@/components/topology/TopologyView";
import { Card, IssueList, table as t } from "@/components/ui";
import { useClientStates, useIssues } from "@/lib/hooks";
import { broadcasts, clientNetworkId, findNetwork, uplinkOf, zoneName } from "@/lib/net/simulate";
import { WAN_IDS, WAN_LATENCY_MS, WAN_NAMES, wanSettings } from "@/lib/net/gateway";
import { useScenario } from "@/lib/store";

/** 見た目用の擬似データ（学習判定には使わない） */
function rng(seed: number) {
  let x = seed || 1;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
}
function fakeTraffic(seed: number) {
  const r = rng(seed);
  return Array.from({ length: 48 }, (_, i) => {
    const h = i / 2;
    const base = 18 + 70 * Math.max(0, Math.sin(((h - 7) / 24) * Math.PI * 2));
    return { t: `${String(Math.floor(h)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`, down: Math.round(base * (0.75 + r() * 0.5) * 3), up: Math.round(base * (0.15 + r() * 0.2)) };
  });
}
const fmt = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="tnum mt-0.5 text-[20px] font-semibold">{value}</div>
      {sub && <div className="text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const s = useScenario();
  const issues = useIssues();
  const states = useClientStates();
  const wan = wanSettings(s);
  const liveWan = WAN_IDS.filter((id) => wan.links[id].online);
  const activeWan = wan.mode === "failover" ? liveWan.slice(0, 1) : liveWan;
  const latency = activeWan.map((id) => WAN_LATENCY_MS[id]).join("–");
  const capacity = (direction: "downloadMbps" | "uploadMbps") => activeWan.reduce((sum, id) => sum + wan.links[id][direction], 0);
  const online = [...states.values()].filter((x) => !x.error);
  const wired = online.filter((x) => x.client.connection.type === "wired").length;
  const devOnline = s.devices.filter((d) => uplinkOf(s, d.id).online).length;
  const traffic = useMemo(() => fakeTraffic(s.clients.length * 97 + s.networks.length * 13), [s.clients.length, s.networks.length]);
  const top = useMemo(() => {
    const r = rng(s.clients.length * 31 + 7);
    return online
      .map((st) => ({ st, usage: Math.round(80 + r() * 4000) }))
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 5);
  }, [online, s.clients.length]);
  const maxUsage = top[0]?.usage ?? 1;

  return (
    <div className="space-y-4">
      <h1 className="text-[15px] font-semibold">ダッシュボード</h1>
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">インターネット</span>
            <span className={clsx("inline-flex items-center gap-1.5 text-[12px]", activeWan.length ? "text-ok" : "text-err")}>
              <span className="size-2 rounded-full bg-current" /> {activeWan.length ? "接続済み" : "WAN 停止中"}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <Stat label="使用中の回線" value={<span className="text-[14px]">{activeWan.map((id) => WAN_NAMES[id]).join(" / ") || "—"}</span>} sub={wan.mode === "failover" ? "フェイルオーバー" : "ロードバランス"} />
            <Stat label="基準遅延" value={latency ? `${latency} ms` : "—"} />
            <Stat label="下り容量" value={capacity("downloadMbps")} sub="Mbps" />
            <Stat label="上り容量" value={capacity("uploadMbps")} sub="Mbps" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-3 font-semibold">クライアント</div>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="有線" value={wired} />
            <Stat label="Wi-Fi" value={online.length - wired} />
          </div>
          {s.clients.length > online.length && <div className="mt-2 text-[12px] text-err">{s.clients.length - online.length} 台が接続できていません</div>}
        </Card>
        <Card className="p-4">
          <div className="mb-3 font-semibold">デバイス</div>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="オンライン" value={devOnline} />
            <Stat label="オフライン" value={<span className={s.devices.length - devOnline ? "text-err" : ""}>{s.devices.length - devOnline}</span>} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="通信量" action={<span className="text-[12px] text-muted">24 時間 · デモデータ</span>} className="xl:col-span-2">
          <div className="h-[260px] px-2 pb-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={traffic} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gDown" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                <XAxis dataKey="t" tick={{ fill: "var(--muted)", fontSize: 11 }} interval={11} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => `${v} Mbps`} />
                <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 12 }} />
                <Area type="monotone" dataKey="down" name="下り (Mbps)" stroke="var(--accent)" fill="url(#gDown)" strokeWidth={1.5} isAnimationActive={false} />
                <Area type="monotone" dataKey="up" name="上り (Mbps)" stroke="#8b5cf6" fill="transparent" strokeWidth={1.5} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="通信量の多いクライアント" action={<Link href="/clients" className="text-[12px] text-accent hover:underline">すべて表示</Link>}>
          <ul className="px-4 pb-3">
            {top.map(({ st, usage }) => (
              <li key={st.client.id} className="py-2">
                <div className="flex items-center gap-2">
                  <span className="text-muted">
                    <ClientIcon kind={st.client.kind} size={14} />
                  </span>
                  <Link href={`/clients?id=${st.client.id}`} className="flex-1 truncate hover:text-accent">
                    {st.client.name}
                  </Link>
                  <span className="tnum text-[12px] text-fg-2">{fmt(usage)}</span>
                </div>
                <div className="mt-1.5 ml-6 h-1 rounded-full bg-surface-2">
                  <div className="h-1 rounded-full bg-accent" style={{ width: `${(usage / maxUsage) * 100}%` }} />
                </div>
              </li>
            ))}
            {top.length === 0 && <li className="py-6 text-center text-muted">オンラインのクライアントはありません</li>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="トポロジー" action={<Link href="/topology" className="text-[12px] text-accent hover:underline">開く</Link>} className="overflow-hidden xl:col-span-2">
          <div className="h-[300px] border-t border-line-soft">
            <TopologyView interactive={false} />
          </div>
        </Card>
        <div id="notifications">
          <Card title="通知" className="h-full">
            <div className="px-4 pb-2">
              <IssueList issues={issues} empty={<p className="py-6 text-center text-muted">通知はありません</p>} />
            </div>
          </Card>
        </div>
      </div>

      <Card title="Wi-Fi" action={<Link href="/settings/wifi" className="text-[12px] text-accent hover:underline">Wi-Fi 設定（パスワード・ネットワーク）</Link>}>
        <table className={t.table}>
          <thead>
            <tr>
              <th className={t.th}>SSID</th>
              <th className={t.th}>ネットワーク</th>
              <th className={t.th}>配信する AP</th>
              <th className={clsx(t.th, "text-right")}>接続中</th>
            </tr>
          </thead>
          <tbody>
            {s.ssids.map((w) => {
              const net = findNetwork(s, w.networkId);
              const aps = s.devices.filter((d) => d.type === "ap" && broadcasts(w, d.id));
              const connected = [...states.values()].filter((st) => !st.error && st.client.connection.type === "wifi" && st.client.connection.ssidId === w.id).length;
              return (
                <tr key={w.id} className="[&:last-child>td]:border-0">
                  <td className={clsx(t.td, "font-medium")}>
                    <Link href={`/settings/wifi?id=${w.id}`} className="hover:text-accent">
                      {w.name}
                    </Link>
                  </td>
                  <td className={clsx(t.td, "text-fg-2")}>{net ? `${net.name} (VLAN ${net.vlanId})` : "未割当"}</td>
                  <td className={clsx(t.td, "text-fg-2")}>{aps.length ? aps.map((a) => a.name).join(", ") : "なし"}</td>
                  <td className={clsx(t.td, "tnum text-right")}>{connected}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title="ネットワーク">
        <table className={t.table}>
          <thead>
            <tr>
              <th className={t.th}>名前</th>
              <th className={t.th}>VLAN</th>
              <th className={t.th}>サブネット</th>
              <th className={t.th}>ゾーン</th>
              <th className={clsx(t.th, "text-right")}>クライアント</th>
            </tr>
          </thead>
          <tbody>
            {s.networks.map((n) => (
              <tr key={n.id} className="[&:last-child>td]:border-0">
                <td className={clsx(t.td, "font-medium")}>
                  <Link href={`/settings/networks?id=${n.id}`} className="hover:text-accent">
                    {n.name}
                  </Link>
                </td>
                <td className={clsx(t.td, "tnum")}>{n.vlanId}</td>
                <td className={clsx(t.td, "tnum text-fg-2")}>{n.cidr}</td>
                <td className={clsx(t.td, "text-fg-2")}>{zoneName(s, n.zoneId)}</td>
                <td className={clsx(t.td, "tnum text-right")}>{s.clients.filter((c) => clientNetworkId(s, c) === n.id).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
