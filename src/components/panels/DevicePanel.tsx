"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { attachedTo } from "@/lib/model";
import { useStore } from "@/lib/store";
import { poeBudget, stpOf, switchingState } from "@/lib/net/switching";
import { SwitchSettings } from "../switching";
import { uplinkOf } from "@/lib/net/simulate";
import { clientsOf, portPeer } from "@/lib/topo";
import Link from "next/link";
import { findNetwork } from "@/lib/net/simulate";
import { DEVICE_TYPE_LABEL, DeviceGlyph } from "../icons";
import { PortFaceplate } from "../PortFaceplate";
import { Button, Field, Input, KV, Segmented, SidePanel, Status, Tabs, Toggle, useDraft } from "../ui";

type Tab = "overview" | "ports" | "wifi" | "settings";

export function DevicePanel({ deviceId, onClose }: { deviceId: string | null; onClose: () => void }) {
  const s = useStore((x) => x.scenario);
  const mutate = useStore((x) => x.mutate);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const device = s.devices.find((d) => d.id === deviceId);
  const { draft, update, dirty, reset } = useDraft(device ? { name: device.name } : undefined, deviceId ?? undefined);
  useEffect(() => setTab("overview"), [deviceId]);

  if (!device) return null;
  const up = uplinkOf(s, device.id);
  const clients = clientsOf(s, device.id);
  const usedPorts = device.ports.filter((p) => portPeer(s, device.id, p.id)).length;
  const ssids = s.ssids.filter((w) => !w.apIds || w.apIds.includes(device.id)).map((w) => w.name).join(", ");

  return (
    <SidePanel
      open
      onClose={onClose}
      icon={<DeviceGlyph type={device.type} size={40} />}
      title={device.name}
      subtitle={<Status ok={up.online} />}
      tabs={
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "overview", label: "概要" },
            ...(device.type !== "ap" ? [{ value: "ports" as const, label: "ポート" }] : [{ value: "wifi" as const, label: "Wi-Fi" }]),
            { value: "settings", label: "設定" },
          ]}
        />
      }
      footer={
        tab === "settings" ? (
          <>
            <Button variant="primary" disabled={!dirty} onClick={() => mutate((sc) => (sc.devices.find((d) => d.id === device.id)!.name = draft!.name))}>
              変更を適用
            </Button>
            <Button disabled={!dirty} onClick={reset}>
              元に戻す
            </Button>
          </>
        ) : undefined
      }
    >
      {tab === "overview" && (
        <KV
          rows={[
            ["種類", DEVICE_TYPE_LABEL[device.type]],
            ["モデル", device.model],
            ["IP アドレス", <span key="ip" className="tnum">{device.ip}</span>],
            ["MAC アドレス", <span key="mac" className="tnum">{device.mac}</span>],
            ["上流接続", device.type === "gateway" ? "WAN · インターネット" : up.online && "parentName" in up ? `${up.parentName} · ${up.parentPort}` : "—"],
            ...(device.type !== "ap" ? ([["ポート", `${usedPorts} / ${device.ports.length} 使用中`]] as [string, string][]) : []),
            ...(device.type === "switch"
              ? ([["STP", !stpOf(device).enabled ? "無効" : switchingState(s).rootId === device.id ? "ルートブリッジ" : `有効 · 優先度 ${stpOf(device).priority}`]] as [string, string][])
              : []),
            ...(poeBudget(device) > 0 ? ([["PoE", `${switchingState(s).poe.get(device.id)?.used ?? 0} / ${poeBudget(device)} W`]] as [string, string][]) : []),
            ...(device.type === "ap" ? ([["電源", switchingState(s).down.has(device.id) ? "停止中" : switchingState(s).unpowered.has(device.id) ? "給電なし（停止中）" : "PoE / アダプター"]] as [string, string][]) : []),
            ...(device.type === "ap" ? ([["Wi-Fi", ssids || "—"]] as [string, string][]) : []),
            ["クライアント", String(clients.length)],
          ]}
        />
      )}
      {tab === "ports" && (
        <>
          <PortFaceplate s={s} device={device} compact onSelect={(pid) => router.push(`/ports?device=${device.id}&port=${encodeURIComponent(pid)}`)} />
          <p className="text-[12px] text-muted">ポートをクリックするとポートマネージャーで設定を開きます。</p>
          {device.type === "switch" && (
            <div className="border-t border-line pt-4">
              <SwitchSettings deviceId={device.id} />
            </div>
          )}
        </>
      )}
      {tab === "wifi" && <ApWifi apId={device.id} />}
      {tab === "settings" && draft && (
        <>
          <Field label="デバイス名">
            <Input value={draft.name} onChange={(e) => update((d) => (d.name = e.target.value))} />
          </Field>
          {device.type !== "gateway" && (
            <div className="border-t border-line pt-4">
              <Button
                variant="danger"
                onClick={() => {
                  if (!confirm(`${device.name} を削除しますか？ 接続中のケーブルとクライアントも削除されます。`)) return;
                  mutate((sc) => {
                    sc.devices = sc.devices.filter((d) => d.id !== device.id);
                    sc.links = sc.links.filter((l) => l.a.deviceId !== device.id && l.b.deviceId !== device.id);
                    sc.clients = sc.clients.filter((c) => attachedTo(c) !== device.id);
                    for (const w of sc.ssids) if (w.apIds) w.apIds = w.apIds.filter((x) => x !== device.id);
                  });
                  onClose();
                }}
              >
                デバイスを削除
              </Button>
            </div>
          )}
        </>
      )}
    </SidePanel>
  );
}

/** AP 側から見た Wi-Fi 設定: どの SSID（=どのネットワーク）を配信するか、送信出力 */
export function ApWifi({ apId }: { apId: string }) {
  const s = useStore((x) => x.scenario);
  const mutate = useStore((x) => x.mutate);
  const ap = s.devices.find((d) => d.id === apId)!;
  const allAps = s.devices.filter((d) => d.type === "ap").map((d) => d.id);
  const setBroadcast = (ssidId: string, on: boolean) =>
    mutate((sc) => {
      const w = sc.ssids.find((x) => x.id === ssidId)!;
      const cur = w.apIds ?? allAps;
      const next = on ? [...new Set([...cur, apId])] : cur.filter((x) => x !== apId);
      // すべての AP を含むなら All APs に戻す
      w.apIds = allAps.every((id) => next.includes(id)) ? undefined : next;
    });

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 text-[12px] text-muted">この AP が配信する Wi-Fi</div>
        <ul className="divide-y divide-line-soft rounded border border-line">
          {s.ssids.map((w) => {
            const on = !w.apIds || w.apIds.includes(apId);
            const net = findNetwork(s, w.networkId);
            return (
              <li key={w.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{w.name}</div>
                  <div className="text-[11.5px] text-muted">
                    {net ? `${net.name} (VLAN ${net.vlanId})` : "ネットワーク未割当"} · {w.bands.map((b) => `${b}G`).join("/")}
                  </div>
                </div>
                <Toggle checked={on} onChange={(v) => setBroadcast(w.id, v)} />
              </li>
            );
          })}
        </ul>
        <p className="mt-1.5 text-[11.5px] text-muted">
          SSID ごとのネットワーク・パスワードは{" "}
          <Link href="/settings/wifi" className="text-accent hover:underline">
            設定 → Wi-Fi
          </Link>{" "}
          で設定します。
        </p>
      </div>
      <Field label="送信出力" hint="下げると電波の届く範囲が狭くなります。フロアプランのヒートマップで確認できます。">
        <Segmented<"high" | "medium" | "low">
          value={ap.txPower ?? "high"}
          onChange={(v) => mutate((sc) => (sc.devices.find((d) => d.id === apId)!.txPower = v))}
          options={[
            { value: "high", label: "高" },
            { value: "medium", label: "中" },
            { value: "low", label: "低" },
          ]}
        />
      </Field>
      <Link href={`/floorplan?ap=${apId}`} className="block text-[12.5px] text-accent hover:underline">
        フロアプランで電波の範囲を見る →
      </Link>
    </div>
  );
}
