"use client";

import { Cast, ChevronLeft, Gauge, Globe, House, Network, Settings, Wifi } from "lucide-react";
import { useState } from "react";
import { CAST_TYPES } from "@/lib/mdns";
import { Browser, DiscoveryApp, LinkIcon, MenuRow, NetUtility, NetworkSettings, SmartHome, WifiList, useEmu } from "./apps";
import { useClock } from "./Desktop";
import { SpeedTest } from "./SpeedTest";

type Screen = "home" | "settings" | "wifi" | "details" | "browser" | "smarthome" | "util" | "cast" | "speed";

const TITLES: Record<Exclude<Screen, "home">, string> = {
  settings: "設定",
  wifi: "Wi-Fi",
  details: "ネットワークの詳細",
  browser: "ブラウザ",
  smarthome: "スマートホーム",
  util: "Ping",
  cast: "キャスト",
  speed: "スピードテスト",
};

const BACK: Partial<Record<Screen, Screen>> = { wifi: "settings", details: "settings" };

/** スマートフォン */
export function Phone({ clientId }: { clientId: string }) {
  const { info } = useEmu(clientId);
  const [screen, setScreen] = useState<Screen>("home");
  const clock = useClock();

  const apps = [
    { id: "settings" as const, label: "設定", icon: Settings, color: "#6b7280" },
    { id: "browser" as const, label: "ブラウザ", icon: Globe, color: "#2f7df6" },
    { id: "smarthome" as const, label: "ホーム", icon: House, color: "#f59e0b" },
    { id: "util" as const, label: "Ping", icon: Network, color: "#16a34a" },
    { id: "cast" as const, label: "キャスト", icon: Cast, color: "#7c3aed" },
    { id: "speed" as const, label: "スピードテスト", icon: Gauge, color: "#2168d0" },
  ];

  return (
    <div className="flex justify-center bg-surface-2 p-4">
      <div className="relative h-[580px] w-[272px] overflow-hidden rounded-[38px] border-[7px] border-[#1c1c1e] bg-[#f2f2f7] text-[#111] shadow-xl">
        {/* ステータスバー */}
        <div className="flex h-8 items-center justify-between px-6 text-[12px] font-semibold">
          <span className="tnum">{clock}</span>
          <span className="flex items-center gap-1">
            <LinkIcon clientId={clientId} size={13} />
            <span className="h-2.5 w-5 rounded-[3px] border border-black/60 p-px">
              <span className="block h-full w-3/4 rounded-[1px] bg-black/70" />
            </span>
          </span>
        </div>

        {screen === "home" ? (
          <div className="h-[calc(100%-2rem)] bg-[linear-gradient(170deg,#c7d7ef_0%,#e9e2f3_60%,#f6efe9_100%)] px-5 pt-6">
            <div className="grid grid-cols-4 gap-x-3 gap-y-5">
              {apps.map((a) => (
                <button key={a.id} onClick={() => setScreen(a.id)} className="flex flex-col items-center gap-1">
                  <span className="flex size-12 items-center justify-center rounded-[13px] text-white shadow" style={{ background: a.color }}>
                    <a.icon size={22} />
                  </span>
                  <span className="text-center text-[10.5px]">{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-[calc(100%-2rem)] flex-col">
            <div className="flex h-10 shrink-0 items-center gap-1 px-2">
              <button onClick={() => setScreen(BACK[screen] ?? "home")} className="flex items-center text-[13px] text-[#007aff]">
                <ChevronLeft size={18} /> {BACK[screen] ? "設定" : "ホーム"}
              </button>
              <span className="absolute left-1/2 -translate-x-1/2 text-[13px] font-semibold">{TITLES[screen]}</span>
            </div>
            <div className={screen === "browser" ? "min-h-0 flex-1" : "min-h-0 flex-1 overflow-y-auto px-3 pb-4"}>
              {screen === "settings" && (
                <div className="overflow-hidden rounded-xl bg-white text-[13px]">
                  <MenuRow icon={<Wifi size={16} className="text-[#007aff]" />} label="Wi-Fi" value={info.ssidName ?? "オフ"} onClick={() => setScreen("wifi")} />
                  <div className="ml-10 h-px bg-black/5" />
                  <MenuRow icon={<Network size={16} className="text-[#34c759]" />} label="ネットワークの詳細" value={info.ip} onClick={() => setScreen("details")} />
                </div>
              )}
              {screen === "wifi" && (
                <div className="rounded-xl bg-white p-1 text-[13px]">
                  <WifiList clientId={clientId} />
                </div>
              )}
              {screen === "details" && (
                <div className="rounded-xl bg-white p-3 text-[13px]">
                  <NetworkSettings clientId={clientId} />
                </div>
              )}
              {screen === "browser" && <Browser clientId={clientId} compact />}
              {screen === "smarthome" && <SmartHome clientId={clientId} />}
              {screen === "speed" && (
                <div className="rounded-xl bg-white p-3">
                  <SpeedTest clientId={clientId} />
                </div>
              )}
              {screen === "cast" && (
                <DiscoveryApp
                  clientId={clientId}
                  types={CAST_TYPES}
                  verb="キャスト"
                  success={(n) => `${n} で再生を始めました`}
                  emptyText="キャストできるデバイスが見つかりません。同じ Wi-Fi に接続されているか確認してください。"
                />
              )}
              {screen === "util" && (
                <div className="h-full rounded-xl bg-white p-3 text-[13px]">
                  <NetUtility clientId={clientId} />
                </div>
              )}
            </div>
          </div>
        )}
        <div className="absolute bottom-1.5 left-1/2 h-1 w-24 -translate-x-1/2 rounded-full bg-black/80" />
      </div>
    </div>
  );
}
