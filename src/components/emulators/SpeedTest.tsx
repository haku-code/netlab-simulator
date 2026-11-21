"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Timer } from "lucide-react";
import { speedTest, type SpeedTestResult } from "@/lib/emu";
import { QOS_LABELS, WAN_NAMES } from "@/lib/net/gateway";
import { useStore } from "@/lib/store";

export function SpeedTest({ clientId }: { clientId: string }) {
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const metrics = [
    { label: "下り", icon: ArrowDown, value: result?.ok ? result.downloadMbps : null, unit: "Mbps" },
    { label: "上り", icon: ArrowUp, value: result?.ok ? result.uploadMbps : null, unit: "Mbps" },
    { label: "遅延", icon: Timer, value: result?.ok ? result.latencyMs : null, unit: "ms" },
  ];

  return (
    <div className="@container space-y-4 text-[13px]">
      <p className="opacity-70">NetLab の仮想回線を測定します。</p>
      <div aria-live="polite" className="space-y-3">
        <dl className="grid grid-cols-2 gap-2 @sm:grid-cols-3">
          {metrics.map(({ label, icon: Icon, value, unit }) => (
            <div key={label} className="rounded-lg border border-current/15 p-2.5">
              <dt className="flex items-center gap-1 text-[11px] opacity-70"><Icon size={12} />{label}</dt>
              <dd className="tnum mt-1 text-xl font-semibold">{value ?? "—"} <span className="text-[11px] font-normal opacity-70">{unit}</span></dd>
            </div>
          ))}
        </dl>
        {result && !result.ok && <p>測定できませんでした。{result.reason}</p>}
        {result?.ok && <p className="opacity-70">{WAN_NAMES[result.wan]} · 優先度 {QOS_LABELS[result.priority]} · 競合フロー {result.backgroundFlows}</p>}
      </div>
      <button
        type="button"
        onClick={() => setResult(speedTest(useStore.getState().scenario, clientId))}
        className="rounded-md bg-[#2168d0] px-3 py-2 font-medium text-white hover:bg-[#1855b1]"
      >
        {result ? "もう一度測定" : "測定を開始"}
      </button>
    </div>
  );
}
