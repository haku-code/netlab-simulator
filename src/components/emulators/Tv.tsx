"use client";

import clsx from "clsx";
import { ChevronLeft, Clapperboard, Gauge, Settings, Tv as TvIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { probe } from "@/lib/emu";
import { LinkIcon, NetworkSettings, WhyBox, WifiList, useEmu } from "./apps";
import { useClock } from "./Desktop";
import { SpeedTest } from "./SpeedTest";

type Screen = "home" | "video" | "settings" | "speed";

/** スマート TV */
export function Tv({ clientId }: { clientId: string }) {
  const { s, client, info } = useEmu(clientId);
  const [screen, setScreen] = useState<Screen>("home");
  const [focus, setFocus] = useState(0);
  const clock = useClock();
  const stream = useMemo(() => probe(s, clientId, "video.example.com", "tcp", 443), [s, clientId]);

  const tiles = [
    { id: "video" as const, label: "ビデオ", icon: Clapperboard, color: "#e11d48" },
    { id: "settings" as const, label: "ネットワーク設定", icon: Settings, color: "#475569" },
    { id: "speed" as const, label: "スピードテスト", icon: Gauge, color: "#2168d0" },
  ];

  return (
    <div className="bg-[#0b0c0f] p-3">
      <div className="relative aspect-video overflow-hidden rounded-sm bg-[radial-gradient(ellipse_at_top,#1f2a44_0%,#0d111b_70%)] text-white">
        <div className="flex h-9 items-center justify-between px-5 text-[12px] text-white/70">
          <span className="flex items-center gap-1.5">
            <TvIcon size={13} /> {client.name}
          </span>
          <span className="flex items-center gap-2">
            <LinkIcon clientId={clientId} size={13} />
            <span className="tnum">{clock}</span>
          </span>
        </div>

        {screen === "home" && (
          <div className="px-8 pt-6">
            <div className="mb-4 text-[18px] font-semibold">ホーム</div>
            <div className="flex gap-4">
              {tiles.map((t, i) => (
                <button
                  key={t.id}
                  onMouseEnter={() => setFocus(i)}
                  onClick={() => setScreen(t.id)}
                  className={clsx("flex h-28 w-44 flex-col justify-end rounded-lg p-3 text-left transition-transform", focus === i && "scale-105 ring-2 ring-white")}
                  style={{ background: `linear-gradient(150deg, ${t.color}, #111)` }}
                >
                  <t.icon size={22} className="mb-auto" />
                  <span className="text-[13px] font-medium">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {screen !== "home" && (
          <button onClick={() => setScreen("home")} className="absolute top-10 left-4 z-10 flex items-center gap-1 rounded px-2 py-1 text-[12px] text-white/70 hover:bg-white/10">
            <ChevronLeft size={14} /> ホーム
          </button>
        )}

        {screen === "video" &&
          (stream.status === "ok" ? (
            <div className="absolute inset-0 top-9 flex flex-col justify-end bg-[linear-gradient(120deg,#0f4c5c,#1b998b,#e9c46a)] bg-[length:300%_300%] p-6 [animation:tvpan_12s_ease-in-out_infinite_alternate]">
              <style>{`@keyframes tvpan { from { background-position: 0% 50% } to { background-position: 100% 50% } }`}</style>
              <div className="text-[16px] font-semibold drop-shadow">Nature Collection 4K</div>
              <div className="mt-2 h-1 rounded bg-white/30">
                <div className="h-1 w-1/3 rounded bg-white" />
              </div>
            </div>
          ) : (
            <div className="flex h-[calc(100%-2.25rem)] flex-col items-center justify-center gap-2 px-10 text-center">
              <div className="text-[15px] font-semibold">ネットワークに接続できません</div>
              <div className="text-[12px] text-white/60">接続設定を確認してから、もう一度お試しください。（エラーコード: NW-{stream.status === "noip" ? "1-7" : stream.status === "dns" ? "2-5" : "3-1"}）</div>
              <div className="mt-2 w-full max-w-sm text-left text-fg">
                <WhyBox text={stream.status === "timeout" ? stream.summary : stream.status === "noip" || stream.status === "dns" ? stream.message : undefined} />
              </div>
            </div>
          ))}

        {screen === "settings" && (
          <div className="mx-auto mt-6 max-w-md space-y-4 px-6 pb-4 text-[13px]">
            <NetworkSettings clientId={clientId} dark />
            {client.connection.type === "wifi" && <WifiList clientId={clientId} dark />}
          </div>
        )}
        {screen === "speed" && (
          <div className="absolute inset-x-0 top-16 bottom-0 mx-auto max-w-md overflow-y-auto px-6 pb-4">
            <SpeedTest clientId={clientId} />
          </div>
        )}
      </div>
      {info.st.error && screen === "home" && <p className="mt-2 text-center text-[11.5px] text-white/50">ネットワークに問題があります — 設定を確認してください</p>}
    </div>
  );
}
