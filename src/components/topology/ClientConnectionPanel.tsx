"use client";

import { useState } from "react";
import { WifiList } from "@/components/emulators/apps";
import { ClientIcon } from "@/components/icons";
import { Button, Field, KV, Select, SidePanel, Tabs } from "@/components/ui";
import { useClientStates } from "@/lib/hooks";
import { useScenario, useStore } from "@/lib/store";
import { portBusy } from "@/lib/topo";

type Mode = "wired" | "wifi";

export function ClientConnectionPanel({ clientId, targetDeviceId, onClose }: {
  clientId: string;
  targetDeviceId?: string;
  onClose: () => void;
}) {
  const s = useScenario();
  const plugCable = useStore((x) => x.plugCable);
  const st = useClientStates().get(clientId);
  const client = st?.client;
  const wired = client?.connection.type === "wired" ? client.connection : null;
  const [mode, setMode] = useState<Mode>(targetDeviceId ? "wired" : client?.connection.type ?? "wired");
  const [deviceId, setDeviceId] = useState(targetDeviceId ?? wired?.deviceId ?? "");
  const [portId, setPortId] = useState(targetDeviceId && targetDeviceId !== wired?.deviceId ? "" : wired?.portId ?? "");

  if (!client || !st) return null;
  const wiredDevices = s.devices.filter((d) => d.type !== "ap" && d.ports.length > 0);
  const device = wiredDevices.find((d) => d.id === deviceId);
  const ports = device?.ports.filter((p) => !portBusy(s, device.id, p.id, { clientId })) ?? [];
  const port = ports.find((p) => p.id === portId);
  const connectedPort = s.devices.find((d) => d.id === wired?.deviceId);
  const currentPort = connectedPort?.ports.find((p) => p.id === wired?.portId);
  const connection = client.connection;
  const ssid = connection.type === "wifi" ? s.ssids.find((w) => w.id === connection.ssidId) : undefined;
  const current = st.how ?? (currentPort ? `${connectedPort?.name} · ${currentPort.name}` : ssid?.name ?? "未接続");
  const alreadyConnected = !!port && wired?.deviceId === deviceId && wired.portId === port.id;
  const wifiShowsError = mode === "wifi" && connection.type === "wifi" && !!connection.ssidId && st.errorStage === "attach";

  return (
    <SidePanel
      open
      onClose={onClose}
      icon={<span className="flex size-9 items-center justify-center rounded-full border border-line"><ClientIcon kind={client.kind} size={17} /></span>}
      title={`${client.name}の接続を変更`}
      tabs={<Tabs value={mode} onChange={setMode} tabs={[{ value: "wired", label: "有線" }, { value: "wifi", label: "Wi-Fi" }]} />}
    >
      <div role="status">
        <KV rows={[["現在の接続", current], ["IP アドレス", st.ip ?? "—"]]} />
        {st.error && !wifiShowsError && <p className="mt-2 text-[12px] text-err">{st.error}</p>}
      </div>
      {mode === "wired" ? (
        <>
          <Field label="接続先の機器">
            <Select aria-label="接続先の機器" value={device?.id ?? ""} onChange={(id) => {
              setDeviceId(id);
              setPortId(id === wired?.deviceId ? wired?.portId ?? "" : "");
            }} options={[{ value: "", label: "機器を選択" }, ...wiredDevices.map((d) => ({ value: d.id, label: d.name }))]} />
          </Field>
          <Field label="接続先のポート" hint={device && !ports.length ? "この機器には空きポートがありません。" : undefined}>
            <Select aria-label="接続先のポート" value={port?.id ?? ""} disabled={!ports.length} onChange={setPortId}
              options={[{ value: "", label: "ポートを選択" }, ...ports.map((p) => {
                const net = s.networks.find((n) => n.id === p.nativeNetworkId);
                return { value: p.id, label: `${p.name} · ${net ? `${net.name} (VLAN ${net.vlanId})` : "ネイティブ VLAN なし"}${p.enabled ? "" : " · 無効"}` };
              })]} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!device || !port || alreadyConnected} onClick={() => {
              if (device && port) plugCable(clientId, device.id, port.id);
            }}>このポートに接続</Button>
            {wired?.deviceId && <Button onClick={() => {
              plugCable(clientId, null, null);
              setPortId("");
            }}>ケーブルを抜く</Button>}
          </div>
        </>
      ) : <WifiList clientId={clientId} />}
    </SidePanel>
  );
}
