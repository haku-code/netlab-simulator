"use client";

import { useState } from "react";
import { Button, FormRow, FormSection, Input, PageHeader, Select, Toggle } from "@/components/ui";
import { WAN_IDS, WAN_IPS, WAN_NAMES, wanSettings } from "@/lib/net/gateway";
import { useScenario, useStore } from "@/lib/store";
import type { WanSettings } from "@/lib/model";

const STATUS = [{ value: "online", label: "接続済み" }, { value: "offline", label: "停止中" }];

export default function InternetPage() {
  const s = useScenario();
  const mutate = useStore((x) => x.mutate);
  const [pending, setPending] = useState<WanSettings | null>(null);
  const [pendingIpv6, setPendingIpv6] = useState<boolean | null>(null);
  const draft = pending ?? wanSettings(s);
  const update = (fn: (wan: WanSettings) => void) => {
    const next = structuredClone(draft);
    fn(next);
    setPending(next);
  };
  const invalid = Object.values(draft.links).some((l) =>
    !Number.isInteger(l.downloadMbps) || l.downloadMbps < 1 || l.downloadMbps > 100000
    || !Number.isInteger(l.uploadMbps) || l.uploadMbps < 1 || l.uploadMbps > 100000
    || !Number.isInteger(l.backgroundFlows) || l.backgroundFlows < 0 || l.backgroundFlows > 100,
  );
  return (
    <div className="max-w-3xl">
      <PageHeader title="インターネット">
        <Button variant="primary" disabled={(!pending && pendingIpv6 === null) || invalid} onClick={() => {
          mutate((sc) => {
            if (pending) sc.wan = draft;
            if (pendingIpv6 !== null) sc.ipv6Wan = pendingIpv6;
          });
          setPending(null);
          setPendingIpv6(null);
        }}>変更を適用</Button>
      </PageHeader>
      <FormSection title="IPv6">
        <FormRow label="IPv6 インターネット" hint="グローバル IPv6 を持つ VLAN から、接続中の仮想 WAN を通って通信します。">
          <Toggle label="IPv6 インターネット" checked={pendingIpv6 ?? s.ipv6Wan ?? false} onChange={setPendingIpv6} />
        </FormRow>
      </FormSection>
      <FormSection title="マルチ WAN">
        <FormRow label="回線の選択方式" hint={draft.mode === "failover"
          ? "WAN1 が停止したとき、新しい通信は WAN2 に切り替わります。"
          : "接続済みの WAN にフロー単位で振り分けます。同じ送信元・宛先・プロトコル・ポートは同じ回線を使います。"}>
          <Select aria-label="回線の選択方式" value={draft.mode} onChange={(v) => update((w) => (w.mode = v as WanSettings["mode"]))}
            options={[{ value: "failover", label: "フェイルオーバー" }, { value: "balance", label: "ロードバランス" }]} />
        </FormRow>
      </FormSection>
      {WAN_IDS.map((id) => {
        const name = WAN_NAMES[id];
        const link = draft.links[id];
        return (
          <FormSection key={id} title={`${name} · ${WAN_IPS[id]}`}>
            <FormRow label="回線状態">
              <Select aria-label={`${name} の回線状態`} value={link.online ? "online" : "offline"} onChange={(v) => update((w) => (w.links[id].online = v === "online"))} options={STATUS} />
            </FormRow>
            <FormRow label="回線速度（下り / 上り Mbps）" hint="1〜100000 Mbps の整数">
              <div className="flex gap-2">
                <Input aria-label={`${name} の下り速度`} type="number" min={1} max={100000} value={link.downloadMbps || ""} onChange={(e) => update((w) => (w.links[id].downloadMbps = Number(e.target.value)))} />
                <Input aria-label={`${name} の上り速度`} type="number" min={1} max={100000} value={link.uploadMbps || ""} onChange={(e) => update((w) => (w.links[id].uploadMbps = Number(e.target.value)))} />
              </div>
            </FormRow>
            <FormRow label="競合フロー数" hint="同じ回線を同時に使う仮想通信の数（0〜100）。QoS の優先度と合わせて速度と遅延を比較できます。">
              <Input aria-label={`${name} の競合フロー数`} type="number" min={0} max={100} value={link.backgroundFlows} onChange={(e) => update((w) => (w.links[id].backgroundFlows = Number(e.target.value)))} />
            </FormRow>
          </FormSection>
        );
      })}
    </div>
  );
}
