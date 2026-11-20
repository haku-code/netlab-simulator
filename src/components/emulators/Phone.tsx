"use client";

import clsx from "clsx";
import { BatteryMedium, Cable, Cast, ChevronLeft, Gauge, Globe, House, Network, Settings, WifiOff, Wifi } from "lucide-react";
import { useMemo, useState } from "react";
import { CAST_TYPES } from "@/lib/mdns";
import { netInfo } from "@/lib/emu";
import { useFloorPreview } from "@/lib/floor-preview";
import { isIPhone } from "@/lib/model";
import { Browser, DiscoveryApp, MenuRow, NetUtility, NetworkSettings, SignalBars, SmartHome, WifiList, signalLevel, useEmu } from "./apps";
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
  const { client, info, s } = useEmu(clientId);
  const iphone = isIPhone(client);
  const drag = useFloorPreview(({ drag }) => drag?.moved && (drag.kind === "device" || drag.id === clientId) ? drag : null);
  const wifi = useMemo(() => {
    if (!drag || client.connection.type !== "wifi") return info.wifi;
    const preview = drag.kind === "client"
      ? { ...s, clients: s.clients.map((c) => c.id === drag.id ? { ...c, pos: drag.pos } : c) }
      : { ...s, devices: s.devices.map((d) => d.id === drag.id ? { ...d, pos: drag.pos } : d) };
    return netInfo(preview, clientId).wifi;
  }, [client.connection.type, clientId, drag, info.wifi, s]);
  const [screen, setScreen] = useState<Screen>("home");
  const clock = useClock();
  const back = () => setScreen(BACK[screen] ?? "home");
  const accent = iphone ? "text-[#075fc4]" : "text-[#126653]";

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
      <div
        aria-label={iphone ? "iPhone エミュレーター" : "Android 風スマートフォン"}
        role="group"
        className={clsx("relative flex h-[580px] w-[272px] flex-col overflow-hidden border-[7px] text-[#111] shadow-xl",
          iphone ? "rounded-[38px] border-[#1c1c1e] bg-[#f2f2f7]" : "rounded-[24px] border-[#24332f] bg-[#edf5f1]",
        )}
      >
        {/* ステータスバー */}
        <div className="flex h-9 shrink-0 items-center justify-between px-4 text-[12px] font-semibold">
          <span className="tnum">{clock}</span>
          <span className="flex items-center gap-2">
            {client.connection.type === "wired" ? <Cable size={15} aria-label="有線" /> : wifi ? (
              <span role="img" aria-label={`Wi-Fi 電波 ${signalLevel(wifi.rssi)}/4（${wifi.rssi} dBm）`} className="flex items-center gap-1">
                <SignalBars rssi={wifi.rssi} />
                <span className="tnum text-[10px] font-medium">{wifi.rssi} dBm</span>
              </span>
            ) : (
              <span role="img" aria-label="Wi-Fi 未接続" className="flex items-center gap-1 text-[10px]">
                <WifiOff size={14} /> 未接続
              </span>
            )}
            <BatteryMedium size={16} className="opacity-60" />
          </span>
        </div>

        {screen === "home" ? (
          <div className={clsx("min-h-0 flex-1 px-5 pt-6",
            iphone ? "bg-[linear-gradient(170deg,#c7d7ef_0%,#e9e2f3_60%,#f6efe9_100%)]" : "bg-[linear-gradient(155deg,#e0f4e6_0%,#a4cbb3_52%,#50796a_100%)]",
          )}>
            <div className={clsx("grid gap-x-3 gap-y-5", iphone ? "grid-cols-4" : "mt-12 grid-cols-3")}>
              {apps.map((a) => (
                <button key={a.id} onClick={() => setScreen(a.id)} className="flex flex-col items-center gap-1">
                  <span className={clsx("flex size-12 items-center justify-center shadow", iphone ? "rounded-[13px] text-white" : "rounded-full bg-white/85 text-[#194b3e]")} style={iphone ? { background: a.color } : undefined}>
                    <a.icon size={22} />
                  </span>
                  <span className="text-center text-[10.5px]">{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-1 px-2">
              <button onClick={back} aria-label="前の画面に戻る" className={clsx("flex items-center text-[13px]", accent)}>
                <ChevronLeft size={18} /> {iphone && (BACK[screen] ? "設定" : "ホーム")}
              </button>
              <span className={clsx("text-[13px] font-semibold", iphone ? "absolute left-1/2 -translate-x-1/2" : "ml-2")}>{TITLES[screen]}</span>
            </div>
            <div className={screen === "browser" ? "min-h-0 flex-1" : "min-h-0 flex-1 overflow-y-auto px-3 pb-4"}>
              {screen === "settings" && (
                <div className="overflow-hidden rounded-xl bg-white text-[13px]">
                  <MenuRow icon={<Wifi size={16} className={accent} />} label="Wi-Fi" value={wifi ? info.ssidName : "未接続"} onClick={() => setScreen("wifi")} />
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
        {iphone ? (
          <div className="flex h-4 shrink-0 items-center justify-center">
            <div className="h-1 w-24 rounded-full bg-black/80" />
          </div>
        ) : (
          <nav aria-label="スマートフォンのナビゲーション" className="flex h-9 shrink-0 items-center justify-around border-t border-black/10">
            <button type="button" onClick={back} aria-label="戻る" className="rounded p-1 hover:bg-black/10"><ChevronLeft size={17} /></button>
            <button type="button" onClick={() => setScreen("home")} aria-label="ホーム画面" className="rounded p-1 hover:bg-black/10"><House size={15} /></button>
          </nav>
        )}
      </div>
    </div>
  );
}
