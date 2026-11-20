"use client";

import { useMemo } from "react";
import { networkOptions } from "@/lib/hooks";
import { uid, type Port, type TaggedMode } from "@/lib/model";
import { findNetwork } from "@/lib/net/simulate";
import { useStore } from "@/lib/store";
import { portBusy, portPeer, taggedLabel } from "@/lib/topo";
import { Button, Checkbox, Field, Input, KV, Segmented, Select, SidePanel, Toggle, useDraft } from "../ui";

export function PortPanel({ deviceId, portId, onClose }: { deviceId: string; portId: string | null; onClose: () => void }) {
  const s = useStore((x) => x.scenario);
  const mutate = useStore((x) => x.mutate);
  const device = s.devices.find((d) => d.id === deviceId);
  const port = device?.ports.find((p) => p.id === portId);
  const peer = port ? portPeer(s, deviceId, port.id) : null;

  const source = useMemo(
    () => (port ? { port, cable: peer?.kind === "device" ? `${peer.device.id}|${peer.port.id}` : "" } : undefined),
    [port, peer],
  );
  const { draft, update, dirty, reset } = useDraft(source, `${deviceId}/${portId}`);

  if (!device || !port || !draft) return null;
  const d = draft.port;
  const set = (fn: (p: Port) => void) => update((x) => fn(x.port));

  const cableOptions = [
    { value: "", label: "未接続" },
    ...s.devices
      .filter((o) => o.id !== deviceId)
      .flatMap((o) =>
        o.ports
          .filter((p) => !portBusy(s, o.id, p.id, { linkId: peer?.kind === "device" ? peer.linkId : undefined }))
          .map((p) => ({ value: `${o.id}|${p.id}`, label: `${o.name} · ${p.name}` })),
      ),
  ];

  const apply = () =>
    mutate((sc) => {
      const dev = sc.devices.find((x) => x.id === deviceId)!;
      const i = dev.ports.findIndex((p) => p.id === port.id);
      dev.ports[i] = draft.port;
      if (peer?.kind !== "client") {
        sc.links = sc.links.filter((l) => !(peer?.kind === "device" && l.id === peer.linkId));
        if (draft.cable) {
          const [od, op] = draft.cable.split("|");
          sc.links.push({ id: uid("link"), a: { deviceId, portId: port.id }, b: { deviceId: od, portId: op } });
        }
      }
    });

  const peerPort = peer?.kind === "device" ? peer.port : null;

  return (
    <SidePanel
      open
      onClose={onClose}
      title={`${device.name} · ${port.name}`}
      subtitle={`${port.speed} · ${!port.enabled ? "無効" : peer ? "リンクあり" : "リンクなし"}`}
      footer={
        <>
          <Button variant="primary" disabled={!dirty} onClick={apply}>
            変更を適用
          </Button>
          <Button disabled={!dirty} onClick={reset}>
            元に戻す
          </Button>
        </>
      }
    >
      <KV
        rows={[
          ["接続先", peer ? (peer.kind === "device" ? `${peer.device.name} · ${peer.port.name}` : peer.client.name) : "—"],
          ["ネイティブ VLAN", findNetwork(s, port.nativeNetworkId)?.name ?? "なし"],
          ["タグ付き VLAN", taggedLabel(s, port)],
        ]}
      />
      <div className="h-px bg-line" />
      <Field label="ポート名">
        <Input value={d.name} onChange={(e) => set((p) => (p.name = e.target.value))} />
      </Field>
      <div className="flex items-center justify-between">
        <span>ポートを有効にする</span>
        <Toggle checked={d.enabled} onChange={(v) => set((p) => (p.enabled = v))} />
      </div>
      <Field label="ネイティブ VLAN / ネットワーク" term="native">
        <Select value={d.nativeNetworkId ?? ""} onChange={(v) => set((p) => (p.nativeNetworkId = v || null))} options={networkOptions(s, { none: "なし" })} />
      </Field>
      <Field label="タグ付き VLAN の管理" term="trunk">
        <Segmented<TaggedMode>
          value={d.tagged}
          onChange={(v) => set((p) => (p.tagged = v))}
          options={[
            { value: "all", label: "すべて許可" },
            { value: "none", label: "すべて拒否" },
            { value: "custom", label: "カスタム" },
          ]}
        />
        {d.tagged === "custom" && (
          <div className="mt-2 rounded border border-line px-3 py-1.5">
            {s.networks
              .filter((n) => n.id !== d.nativeNetworkId)
              .map((n) => (
                <Checkbox
                  key={n.id}
                  checked={d.taggedNetworkIds.includes(n.id)}
                  onChange={(v) => set((p) => (p.taggedNetworkIds = v ? [...p.taggedNetworkIds, n.id] : p.taggedNetworkIds.filter((x) => x !== n.id)))}
                  label={
                    <>
                      {n.name} <span className="text-muted">({n.vlanId})</span>
                    </>
                  }
                />
              ))}
          </div>
        )}
      </Field>
      {peer?.kind === "client" ? (
        <Field label="接続中のクライアント">
          <div className="text-fg-2">{peer.client.name}</div>
        </Field>
      ) : (
        <Field label="ケーブル" hint="ケーブルでつなぐ対向ポート">
          <Select aria-label="対向ポート" value={draft.cable} onChange={(v) => update((x) => (x.cable = v))} options={cableOptions} />
        </Field>
      )}
      {peerPort && (
        <div className="rounded border border-line bg-surface-2 px-3 py-2 text-[12px] text-fg-2">
          <div className="mb-0.5 font-medium text-fg">対向ポート ({peer?.kind === "device" ? peer.device.name : ""} · {peerPort.name})</div>
          ネイティブ VLAN: {findNetwork(s, peerPort.nativeNetworkId)?.name ?? "なし"} · {taggedLabel(s, peerPort)}
        </div>
      )}
    </SidePanel>
  );
}
