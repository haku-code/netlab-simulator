"use client";

import clsx from "clsx";
import { Activity, Gauge, Globe, Network, Printer, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PRINT_TYPES } from "@/lib/mdns";
import { Browser, DiscoveryApp, LinkIcon, NetUtility, NetworkSettings, WifiList, useEmu } from "./apps";
import { SpeedTest } from "./SpeedTest";

type App = "net" | "browser" | "util" | "printers" | "speed";

const APPS: { id: App; label: string; icon: typeof Globe; color: string }[] = [
  { id: "browser", label: "ブラウザ", icon: Globe, color: "#2f7df6" },
  { id: "net", label: "ネットワーク設定", icon: Network, color: "#5b6b7f" },
  { id: "util", label: "ネットワークユーティリティ", icon: Activity, color: "#16a34a" },
  { id: "printers", label: "プリンター", icon: Printer, color: "#b45309" },
  { id: "speed", label: "スピードテスト", icon: Gauge, color: "#2168d0" },
];

export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

/** PC のデスクトップ */
export function Desktop({ clientId }: { clientId: string }) {
  const { client, info } = useEmu(clientId);
  const [app, setApp] = useState<App | null>(null);
  const clock = useClock();
  const current = APPS.find((a) => a.id === app);

  return (
    <div className="relative flex h-[480px] flex-col bg-[linear-gradient(160deg,#2c3e57_0%,#1c2738_55%,#16202d_100%)] text-white">
      <div className="relative min-h-0 flex-1">
        {/* デスクトップアイコン */}
        <div className="flex w-28 flex-col gap-3 p-4">
          {APPS.map((a) => (
            <button key={a.id} onDoubleClick={() => setApp(a.id)} onClick={() => setApp(a.id)} className="group flex flex-col items-center gap-1.5 rounded p-1.5 hover:bg-white/10">
              <span className="flex size-11 items-center justify-center rounded-xl shadow-md" style={{ background: a.color }}>
                <a.icon size={22} />
              </span>
              <span className="text-center text-[11px] leading-tight drop-shadow">{a.label}</span>
            </button>
          ))}
        </div>

        {current && (
          <div className="absolute inset-3 left-28 flex flex-col overflow-hidden rounded-md bg-surface text-fg shadow-2xl">
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3">
              <current.icon size={13} className="text-muted" />
              <span className="text-[12.5px] font-medium">{current.label}</span>
              <button onClick={() => setApp(null)} className="ml-auto rounded p-0.5 text-muted hover:bg-hover hover:text-fg" aria-label="閉じる">
                <X size={13} />
              </button>
            </div>
            <div className={clsx("min-h-0 flex-1", app !== "browser" && "overflow-y-auto p-4")}>
              {app === "browser" && <Browser clientId={clientId} />}
              {app === "net" && (
                <div className="space-y-5">
                  <NetworkSettings clientId={clientId} />
                  {client.connection.type === "wifi" && (
                    <div>
                      <div className="mb-2 text-[12px] font-medium text-muted">Wi-Fi</div>
                      <WifiList clientId={clientId} />
                    </div>
                  )}
                </div>
              )}
              {app === "util" && <NetUtility clientId={clientId} />}
              {app === "speed" && <SpeedTest clientId={clientId} />}
              {app === "printers" && (
                <DiscoveryApp
                  clientId={clientId}
                  types={PRINT_TYPES}
                  verb="テスト印刷"
                  success={(n) => `${n} でテストページを印刷しました`}
                  emptyText="プリンターが見つかりません。"
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* タスクバー */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-t border-white/10 bg-black/35 px-2 backdrop-blur">
        <span className="mr-1 flex size-7 items-center justify-center rounded bg-white/10 text-[10px] font-bold">NL</span>
        {APPS.map((a) => (
          <button
            key={a.id}
            onClick={() => setApp(a.id)}
            title={a.label}
            className={clsx("flex size-8 items-center justify-center rounded hover:bg-white/10", app === a.id && "bg-white/15")}
          >
            <a.icon size={16} />
          </button>
        ))}
        <button onClick={() => setApp("net")} className="ml-auto flex items-center gap-1.5 rounded px-2 py-1 text-[11.5px] hover:bg-white/10" title={info.linkLabel}>
          <LinkIcon clientId={clientId} size={14} />
          {!info.connected && <span className="text-[#ffb4a9]">!</span>}
        </button>
        <span className="tnum px-2 text-[11.5px]">{clock}</span>
      </div>
    </div>
  );
}
