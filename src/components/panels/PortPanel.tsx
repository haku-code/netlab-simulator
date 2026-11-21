"use client";

import { useMemo } from "react";
import { networkOptions } from "@/lib/hooks";
import { uid, type Port, type TaggedMode } from "@/lib/model";
import { findNetwork } from "@/lib/net/simulate";
import { useStore } from "@/lib/store";
import { portBusy, portPeer, taggedLabel } from "@/lib/topo";
import { lagPorts, poeBudget } from "@/lib/net/switching";
import { portPoeLabel, portStpState } from "../switching";
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
      // LAG のメンバーは 1 本のリンクとして同じ設定にそろえる
      if (draft.port.lag !== undefined)
        for (const m of dev.ports)
          if (m.id !== port.id && m.lag === draft.port.lag)
            Object.assign(m, {
              nativeNetworkId: d.nativeNetworkId,
              tagged: d.tagged,
              taggedNetworkIds: [...d.taggedNetworkIds],
              enabled: d.enabled,
              profileId: d.profileId,
            });
      if (!draft.port.profileId) delete draft.port.profileId;
      if (peer?.kind !== "client") {
        sc.links = sc.links.filter((l) => !(peer?.kind === "device" && l.id === peer.linkId));
        if (draft.cable) {
          const [od, op] = draft.cable.split("|");
          sc.links.push({ id: uid("link"), a: { deviceId, portId: port.id }, b: { deviceId: od, portId: op } });
        }
      }
    });

  const peerPort = peer?.kind === "device" ? peer.port : null;
  const stpState = portStpState(s, deviceId, port);
  const poe = portPoeLabel(s, deviceId, port.id);
  const profile = s.portProfiles?.find((x) => x.id === d.profileId);
  const members = lagPorts(device, port);
  const applyProfile = (id: string) =>
    set((p) => {
      const prof = s.portProfiles?.find((x) => x.id === id);
      if (!prof) {
        delete p.profileId;
        return;
      }
      p.profileId = prof.id;
      p.nativeNetworkId = prof.nativeNetworkId;
      p.tagged = prof.tagged;
      p.taggedNetworkIds = [...prof.taggedNetworkIds];
      p.poe = prof.poe;
    });

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
          ...(stpState ? ([["STP", <span key="stp" className={stpState.tone === "err" ? "text-err" : stpState.tone === "warn" ? "text-warn" : undefined}>{stpState.label}</span>]] as [string, React.ReactNode][]) : []),
          ...(port.lag !== undefined ? ([["LAG", `LAG ${port.lag} · ${members.map((m) => m.idx).join(", ")} 番`]] as [string, string][]) : []),
          ...(poe ? ([["PoE", <span key="poe" title={poe.detail} className={poe.tone === "ok" ? undefined : poe.tone === "err" ? "text-err" : "text-warn"}>{poe.label}</span>]] as [string, React.ReactNode][]) : []),
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
      <Field label="ポートプロファイル" term="port-profile" hint={profile ? "VLAN と PoE はプロファイルの設定に従います。個別に変えるには「なし」に戻します。" : undefined}>
        <Select
          aria-label="ポートプロファイル"
          value={d.profileId ?? ""}
          onChange={applyProfile}
          options={[{ value: "", label: "なし（ポートごとに設定）" }, ...(s.portProfiles ?? []).map((x) => ({ value: x.id, label: x.name }))]}
        />
      </Field>
      {profile ? (
        <div className="rounded border border-line bg-surface-2 px-3 py-2 text-[12px] text-fg-2">
          ネイティブ VLAN: {findNetwork(s, d.nativeNetworkId)?.name ?? "なし"} · タグ付き: {taggedLabel(s, d)} · PoE: {d.poe === "off" ? "オフ" : "自動"}
        </div>
      ) : (
        <>
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
      {poeBudget(device) > 0 && (
        <Field label="PoE" term="poe" hint={poe?.detail}>
          <Segmented<"auto" | "off">
            value={d.poe ?? "auto"}
            onChange={(v) => set((p) => (p.poe = v))}
            options={[
              { value: "auto", label: "PoE+（自動）" },
              { value: "off", label: "オフ" },
            ]}
          />
        </Field>
      )}
        </>
      )}
      {device.type === "switch" && (
        <Field label="リンクアグリゲーション (LAG)" term="lag" hint="同じ番号のポートを 1 本の論理リンクに束ねます。対向スイッチでも同じポートを束ねてください。メンバーは番号が最小のポートの設定に揃います。">
          <Select
            aria-label="リンクアグリゲーション"
            value={d.lag === undefined ? "" : String(d.lag)}
            onChange={(v) => set((p) => (v ? (p.lag = Number(v)) : delete p.lag))}
            options={[{ value: "", label: "なし" }, ...[1, 2, 3, 4].map((n) => ({ value: String(n), label: `LAG ${n}` }))]}
          />
        </Field>
      )}
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
