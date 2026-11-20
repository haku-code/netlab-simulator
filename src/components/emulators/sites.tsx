"use client";

import { Ban, Clock, Folder, SearchX, WifiOff, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { ProbeResult } from "@/lib/emu";
import { TraceDetails } from "./apps";

/** ブラウザに表示するページ（エラーページ / 各機器の Web 画面 / インターネット） */
export function SitePage({ result, url, host, port }: { result: ProbeResult; url: string; host: string; port: number }) {
  if (result.status === "noip")
    return <ErrorPage icon={WifiOff} title="インターネットに接続されていません" code="ERR_INTERNET_DISCONNECTED" body="ネットワーク接続を確認してください。" why={result.message} />;
  if (result.status === "dns")
    return <ErrorPage icon={SearchX} title="このサイトにアクセスできません" code="DNS_PROBE_FINISHED_NO_INTERNET" body={`${host} のサーバーの IP アドレスが見つかりませんでした。`} why={result.message} />;
  if (result.status === "timeout")
    return (
      <ErrorPage
        icon={Clock}
        title="このサイトにアクセスできません"
        code="ERR_CONNECTION_TIMED_OUT"
        body={`${host} からの応答時間が長すぎます。`}
        why={result.summary}
        hops={result.hops}
      />
    );
  if (result.status === "refused")
    return (
      <ErrorPage
        icon={Ban}
        title="このサイトにアクセスできません"
        code="ERR_CONNECTION_REFUSED"
        body={`${host} で接続が拒否されました。`}
        why={`宛先の機器までは届きましたが、ポート ${port} で待ち受けているサービスがありません（タイムアウトとの違いに注目）。`}
        hops={result.hops}
      />
    );

  const t = result.target;
  if (t.kind === "internet") return <InternetSite host={host} />;
  if (t.kind === "gateway") return <GatewayPage ip={t.ip} />;
  if (t.kind === "client") {
    const name = t.client.name;
    if (t.client.kind === "printer") return <PrinterPage name={name} ip={t.ip} port={port} />;
    if (t.client.kind === "server") return <NasPage name={name} ip={t.ip} />;
    if (t.client.kind === "iot") return <PlugPage name={name} ip={t.ip} />;
    if (t.client.kind === "tv") return <pre className="p-4 font-mono text-[12px]">{JSON.stringify({ name, ip: t.ip, cast_version: 2, setup: "ok" }, null, 2)}</pre>;
  }
  return <div className="p-6 text-[12.5px]">{url}</div>;
}

function ErrorPage({ icon: Icon, title, code, body, why, hops }: { icon: LucideIcon; title: string; code: string; body: string; why: string; hops?: Parameters<typeof TraceDetails>[0]["hops"] }) {
  return (
    <div className="px-8 py-10 text-[#3c4043]">
      <Icon size={32} strokeWidth={1.5} className="mb-4 text-black/40" />
      <h1 className="mb-2 text-[18px] font-medium text-[#202124]">{title}</h1>
      <p className="mb-3 text-[13px]">{body}</p>
      <p className="font-mono text-[11px] text-black/40">{code}</p>
      <div className="mt-6 rounded border border-dashed border-[#f5a524]/70 bg-[#f5a524]/5 px-3 py-2 text-[12px] leading-relaxed">
        <span className="font-medium text-[#b26a00]">学習用:</span> {why}
      </div>
      {hops && hops.length > 0 && <TraceDetails hops={hops} />}
    </div>
  );
}

function InternetSite({ host }: { host: string }) {
  return (
    <div className="mx-auto max-w-xl px-8 py-10">
      <div className="mb-6 h-1.5 w-16 rounded-full bg-[#006fff]" />
      <h1 className="mb-3 text-[22px] font-semibold">{host}</h1>
      <p className="mb-4 text-[13px] leading-relaxed text-black/70">インターネット上のサイトに接続できました。通信はゲートウェイで NAT され、WAN 側の IP アドレスから送信されています。</p>
      <div className="space-y-2">
        {[80, 64, 72].map((w, i) => (
          <div key={i} className="h-2.5 rounded bg-black/[0.06]" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

function GatewayPage({ ip }: { ip: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="text-[16px] font-semibold">NetLab Gateway</div>
      <div className="tnum text-[12px] text-black/50">{ip}</div>
      <p className="mt-2 max-w-xs text-[12.5px] text-black/60">ゲートウェイには到達できています。ネットワークの管理はこのアプリの各画面から行います。</p>
    </div>
  );
}

function Frame({ title, ip, children, accent = "#006fff" }: { title: string; ip: string; children: React.ReactNode; accent?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between px-5 py-3 text-white" style={{ background: accent }}>
        <span className="font-semibold">{title}</span>
        <span className="tnum text-[12px] opacity-80">{ip}</span>
      </div>
      <div className="p-5 text-[13px]">{children}</div>
    </div>
  );
}

function PrinterPage({ name, ip, port }: { name: string; ip: string; port: number }) {
  const [printed, setPrinted] = useState(0);
  return (
    <Frame title={`${name} — Web 設定`} ip={ip} accent="#3b4a5a">
      <div className="mb-4 flex items-center gap-2">
        <span className="size-2.5 rounded-full bg-[#34c759]" /> 待機中 (Ready)
      </div>
      <div className="mb-4 space-y-2">
        {[
          ["Black", 72],
          ["Cyan", 45],
          ["Magenta", 58],
          ["Yellow", 31],
        ].map(([c, v]) => (
          <div key={c} className="flex items-center gap-3">
            <span className="w-16 text-[12px] text-black/60">{c}</span>
            <div className="h-2 flex-1 rounded bg-black/[0.07]">
              <div className="h-2 rounded bg-black/50" style={{ width: `${v}%` }} />
            </div>
            <span className="tnum w-8 text-right text-[12px]">{v}%</span>
          </div>
        ))}
      </div>
      <button onClick={() => setPrinted((n) => n + 1)} className="rounded bg-[#3b4a5a] px-3 py-1.5 text-[12.5px] text-white">
        テストページを印刷
      </button>
      {printed > 0 && <p className="mt-2 text-[12px] text-black/60">印刷しました（{printed} 枚）</p>}
      <p className="mt-4 text-[11.5px] text-black/40">ポート {port} で応答 · 印刷は 631 (IPP) / 9100 (RAW) を使用</p>
    </Frame>
  );
}

function NasPage({ name, ip }: { name: string; ip: string }) {
  return (
    <Frame title={`${name} — ストレージ`} ip={ip} accent="#2b6cb0">
      <div className="mb-3 text-[12px] text-black/60">ボリューム 1 · 正常</div>
      <div className="mb-1 h-3 rounded bg-black/[0.07]">
        <div className="h-3 w-[54%] rounded bg-[#2b6cb0]" />
      </div>
      <div className="mb-4 text-[12px] text-black/60">2.1 TB / 3.9 TB 使用</div>
      <ul className="divide-y divide-black/5 text-[12.5px]">
        {["Photos", "Documents", "Backup"].map((f) => (
          <li key={f} className="flex items-center gap-2 py-1.5">
            <Folder size={14} className="text-[#2b6cb0]" /> {f}
          </li>
        ))}
      </ul>
    </Frame>
  );
}

function PlugPage({ name, ip }: { name: string; ip: string }) {
  const [on, setOn] = useState(false);
  return (
    <Frame title={name} ip={ip} accent="#0f766e">
      <div className="flex items-center gap-4">
        <button onClick={() => setOn(!on)} className={`size-16 rounded-full text-[13px] font-semibold text-white ${on ? "bg-[#0f766e]" : "bg-black/30"}`}>
          {on ? "ON" : "OFF"}
        </button>
        <div className="text-[12.5px] text-black/60">ローカル Web API (HTTP:80) から操作しています。</div>
      </div>
    </Frame>
  );
}
