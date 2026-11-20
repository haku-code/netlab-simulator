"use client";

import { Clock } from "lucide-react";
import { DEFAULT_CLOCK } from "@/lib/net/simulate";
import { useStore } from "@/lib/store";

export const DAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** シミュレーション上の現在時刻（スケジュール付きポリシーの判定に使う） */
export function ClockControl() {
  const clock = useStore((s) => s.scenario.clock ?? DEFAULT_CLOCK);
  const mutate = useStore((s) => s.mutate);
  const set = (c: typeof clock) => mutate((sc) => (sc.clock = c));
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded border border-line bg-surface px-2 text-[12.5px]" title="シミュレーション上の現在時刻。スケジュール付きのポリシーはこの時刻で判定します。">
      <Clock aria-hidden="true" size={13} className="text-muted" />
      <span>シミュレーション時刻</span>
      <select aria-label="シミュレーションの曜日" value={clock.day} onChange={(e) => set({ ...clock, day: Number(e.target.value) })} className="bg-transparent focus-visible:outline focus-visible:outline-accent">
        {DAYS.map((d, i) => (
          <option key={d} value={i}>
            {d}曜
          </option>
        ))}
      </select>
      <input aria-label="シミュレーションの時刻" type="time" value={clock.time} onInput={(e) => {
        const time = e.currentTarget.value;
        if (time) set({ ...clock, time });
      }} className="tnum bg-transparent focus-visible:outline focus-visible:outline-accent" />
    </span>
  );
}

export function scheduleLabel(sch?: { days: number[]; start: string; end: string }) {
  if (!sch) return "常時";
  const days = sch.days.length === 7 ? "毎日" : sch.days.map((d) => DAYS[d]).join("");
  return `${days} ${sch.start}〜${sch.end}`;
}
