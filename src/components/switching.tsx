"use client";

import clsx from "clsx";
import type { Device, Port, Scenario } from "@/lib/model";
import { DEFAULT_STP_PRIORITY, POE_BUDGETS, STP_PRIORITIES, poeBudget, portRole, stpOf, switchingState, type StpRole } from "@/lib/net/switching";
import { useStore } from "@/lib/store";
import { Badge, Field, Select, Toggle } from "./ui";

export const STP_ROLE_LABEL: Record<StpRole, string> = {
  root: "転送 · ルートポート",
  designated: "転送 · 指定ポート",
  blocked: "ブロック (STP)",
  forwarding: "転送",
};

/** ポートの STP / ストーム表示 */
export function portStpState(s: Scenario, deviceId: string, port: Port): { label: string; tone: "ok" | "warn" | "err" | "neutral" } | null {
  const st = switchingState(s);
  const inStorm = st.storm.has(deviceId) && s.links.some((l) => st.stormLinks.has(l.id) && ((l.a.deviceId === deviceId && l.a.portId === port.id) || (l.b.deviceId === deviceId && l.b.portId === port.id)));
  if (inStorm) return { label: "ループ (ストーム)", tone: "err" };
  const role = portRole(s, deviceId, port.id);
  if (!role) return null;
  return { label: STP_ROLE_LABEL[role], tone: role === "blocked" ? "warn" : "neutral" };
}

export function portPoeLabel(s: Scenario, deviceId: string, portId: string) {
  const pp = switchingState(s).poe.get(deviceId)?.ports.get(portId);
  if (!pp) return null;
  if (pp.powered) return { label: `${pp.watts} W`, tone: "ok" as const, detail: `${pp.load} に給電中` };
  const why = pp.reason === "off" ? "PoE オフ" : pp.reason === "disabled" ? "ポート無効" : "電力不足";
  return { label: `0 W · ${why}`, tone: (pp.reason === "budget" ? "err" : "warn") as "err" | "warn", detail: `${pp.load}（${pp.watts} W）に給電していません` };
}

export function PoeBudgetBar({ s, device }: { s: Scenario; device: Device }) {
  const ps = switchingState(s).poe.get(device.id);
  const budget = poeBudget(device);
  if (budget <= 0) return null;
  const used = ps?.used ?? 0;
  const requested = ps?.requested ?? 0;
  const over = requested > budget;
  return (
    <div className="min-w-[220px]">
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-muted">PoE 電力</span>
        <span className={clsx("tnum", over ? "text-err" : "text-fg-2")}>
          {used} / {budget} W{over && ` · 要求 ${requested} W`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line ring-inset">
        <div className={clsx("h-full rounded-full", over ? "bg-err" : used / budget > 0.8 ? "bg-warn" : "bg-ok")} style={{ width: `${Math.min(100, (used / budget) * 100)}%` }} />
      </div>
    </div>
  );
}

export function LagBadge({ port }: { port: Port }) {
  return port.lag !== undefined ? <Badge tone="accent">LAG {port.lag}</Badge> : null;
}

/** スイッチの STP と PoE の設定（即時反映） */
export function SwitchSettings({ deviceId }: { deviceId: string }) {
  const s = useStore((x) => x.scenario);
  const mutate = useStore((x) => x.mutate);
  const device = s.devices.find((d) => d.id === deviceId);
  if (!device || device.type !== "switch") return null;
  const stp = stpOf(device);
  const st = switchingState(s);
  const root = s.devices.find((d) => d.id === st.rootId);
  const set = (fn: (d: Device) => void) => mutate((sc) => fn(sc.devices.find((d) => d.id === deviceId)!));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div>スパニングツリー (RSTP)</div>
          <div className="text-[11.5px] text-muted">
            {!stp.enabled ? "無効: ループしてもポートをブロックしません" : st.rootId === device.id ? "このスイッチがルートブリッジです" : root ? `ルートブリッジ: ${root.name}` : "—"}
          </div>
        </div>
        <Toggle checked={stp.enabled} onChange={(v) => set((d) => (d.stp = { ...stpOf(d), enabled: v }))} />
      </div>
      {stp.enabled && (
        <Field label="ブリッジ優先度" term="stp" hint="小さいほどルートブリッジに選ばれやすくなります。コアスイッチを 4096 などにするのが一般的です。">
          <Select
            aria-label="ブリッジ優先度"
            value={String(stp.priority)}
            onChange={(v) => set((d) => (d.stp = { ...stpOf(d), priority: Number(v) }))}
            options={STP_PRIORITIES.map((p) => ({ value: String(p), label: p === DEFAULT_STP_PRIORITY ? `${p}（既定）` : String(p) }))}
          />
        </Field>
      )}
      <Field label="PoE 電力予算" term="poe" hint="スイッチ全体で給電できる電力です。ポート番号の小さい順に割り当てます。">
        <Select
          aria-label="PoE 電力予算"
          value={String(poeBudget(device))}
          onChange={(v) => set((d) => (Number(v) > 0 ? (d.poeBudgetW = Number(v)) : delete d.poeBudgetW))}
          options={[...new Set([...POE_BUDGETS, poeBudget(device)])].sort((a, b) => a - b).map((w) => ({ value: String(w), label: w ? `${w} W` : "PoE なし" }))}
        />
      </Field>
      <PoeBudgetBar s={s} device={device} />
    </div>
  );
}
