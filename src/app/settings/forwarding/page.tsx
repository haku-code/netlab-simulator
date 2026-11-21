"use client";

import { GatewayRules } from "@/components/GatewayRules";
import { Field, Input, PageHeader, Select } from "@/components/ui";
import { uid, type PortForward } from "@/lib/model";
import { saveGatewayEntry, WAN_IDS, WAN_IPS, WAN_NAMES } from "@/lib/net/gateway";
import { ipToStr, parseIp } from "@/lib/net/ip";
import { useScenario, useStore } from "@/lib/store";

const validPort = (port: number) => Number.isInteger(port) && port >= 1 && port <= 65535;

export default function ForwardingPage() {
  const s = useScenario();
  const mutate = useStore((x) => x.mutate);
  const entries = s.portForwards ?? [];
  return (
    <>
      <PageHeader title="ポートフォワード" />
      <p className="mb-4 text-[12px] text-muted">パケットトレースで「外部テスト端末」を送信元に選び、WAN と公開ポートを指定すると着信を確認できます。</p>
      <GatewayRules<PortForward> title="転送ルール" entries={entries}
        create={() => ({ id: uid("forward"), name: "", wan: "wan1", protocol: "tcp", publicPort: 8443, targetIp: "", targetPort: 443, enabled: true })}
        save={(entry) => mutate((sc) => { sc.portForwards = saveGatewayEntry(sc.portForwards, { ...entry, targetIp: ipToStr(parseIp(entry.targetIp)!) }); })}
        remove={(id) => mutate((sc) => { sc.portForwards = sc.portForwards?.filter((f) => f.id !== id); })}
        columns={["着信回線", "公開ポート", "転送先"]}
        row={(f) => [WAN_NAMES[f.wan], `${f.protocol.toUpperCase()}/${f.publicPort}`, `${f.targetIp}:${f.targetPort}`]}
        error={(f) => {
          if (!validPort(f.publicPort) || !validPort(f.targetPort)) return "ポート番号は 1〜65535 の整数を入力してください。";
          if (parseIp(f.targetIp) === null) return "転送先 IPv4 アドレスを入力してください。";
          if (f.enabled && entries.some((e) => e.id !== f.id && e.enabled && e.wan === f.wan && e.protocol === f.protocol && e.publicPort === f.publicPort))
            return "同じ回線・プロトコル・公開ポートの有効な転送ルールがあります。";
          return null;
        }}
        fields={(f, update) => <>
          <Field label="着信回線">
            <Select aria-label="着信回線" value={f.wan} onChange={(v) => update({ wan: v as PortForward["wan"] })}
              options={WAN_IDS.map((id) => ({ value: id, label: `${WAN_NAMES[id]} · ${WAN_IPS[id]}` }))} />
          </Field>
          <Field label="プロトコル">
            <Select aria-label="転送のプロトコル" value={f.protocol} onChange={(v) => update({ protocol: v as PortForward["protocol"] })}
              options={[{ value: "tcp", label: "TCP" }, { value: "udp", label: "UDP" }]} />
          </Field>
          <Field label="公開ポート">
            <Input aria-label="公開ポート" type="number" min={1} max={65535} value={f.publicPort || ""} onChange={(e) => update({ publicPort: Number(e.target.value) })} />
          </Field>
          <Field label="転送先 IPv4" hint="転送先の固定 IP または DHCP 予約を使うと、対象端末が変わりません。">
            <Input aria-label="転送先 IPv4" value={f.targetIp} placeholder="192.168.1.240" onChange={(e) => update({ targetIp: e.target.value })} />
          </Field>
          <Field label="転送先ポート">
            <Input aria-label="転送先ポート" type="number" min={1} max={65535} value={f.targetPort || ""} onChange={(e) => update({ targetPort: Number(e.target.value) })} />
          </Field>
        </>}
      />
    </>
  );
}
