"use client";

import { useState } from "react";
import { GatewayRules } from "@/components/GatewayRules";
import { Field, Input, PageHeader, Select, Tabs } from "@/components/ui";
import { uid, type StaticRoute, type VpnTunnel } from "@/lib/model";
import { chooseWan, parseRouteCidr, saveGatewayEntry, WAN_NAMES } from "@/lib/net/gateway";
import { isHostAddr, ipToStr, overlaps, parseCidr, parseIp, subnetToStr } from "@/lib/net/ip";
import { useScenario, useStore } from "@/lib/store";

export default function RoutingPage() {
  const s = useScenario();
  const mutate = useStore((x) => x.mutate);
  const [tab, setTab] = useState<"routes" | "vpn">("routes");
  const routes = s.staticRoutes ?? [];
  const tunnels = s.vpnTunnels ?? [];
  return (
    <>
      <PageHeader title="ルーティング・VPN" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "routes", label: "静的ルート" }, { value: "vpn", label: "拠点間 VPN" }]} />
      <p className="my-4 text-[12px] text-muted">パケットトレースの宛先で「IPv4 アドレスを指定」を選ぶと、選択された経路と通信結果を確認できます。</p>
      {tab === "routes" ? (
        <GatewayRules<StaticRoute> title="静的ルート" entries={routes}
          create={() => ({ id: uid("route"), name: "", cidr: "", nextHop: "", metric: 10, enabled: true })}
          save={(entry) => mutate((sc) => { sc.staticRoutes = saveGatewayEntry(sc.staticRoutes, {
            ...entry, cidr: subnetToStr(parseRouteCidr(entry.cidr)!), nextHop: ipToStr(parseIp(entry.nextHop)!),
          }); })}
          remove={(id) => mutate((sc) => { sc.staticRoutes = sc.staticRoutes?.filter((r) => r.id !== id); })}
          columns={["宛先", "次ホップ", "メトリック"]}
          row={(r) => [r.cidr, r.nextHop, r.metric]}
          error={(r) => {
            const prefix = parseRouteCidr(r.cidr);
            if (!prefix) return "宛先を IPv4 CIDR で入力してください。";
            const nextHop = parseIp(r.nextHop);
            if (nextHop === null) return "次ホップ IPv4 アドレスを入力してください。";
            if (!s.networks.some((n) => {
              const subnet = parseCidr(n.cidr);
              return subnet && isHostAddr(nextHop, subnet) && parseIp(n.gatewayIp) !== nextHop;
            })) return "次ホップはゲートウェイ以外の直結ネットワーク内のアドレスを指定してください。";
            if (!Number.isInteger(r.metric) || r.metric < 1 || r.metric > 65535) return "メトリックは 1〜65535 の整数を入力してください。";
            if (routes.some((other) => r.enabled && other.enabled && other.id !== r.id && other.cidr === subnetToStr(prefix) && other.metric === r.metric))
              return "同じ宛先とメトリックの有効なルートがあります。";
            return null;
          }}
          fields={(r, update) => <>
            <Field label="宛先 CIDR" hint="例 10.20.0.0/24。0.0.0.0/0 は既定経路です。">
              <Input aria-label="宛先 CIDR" value={r.cidr} onChange={(e) => update({ cidr: e.target.value })} />
            </Field>
            <Field label="次ホップ IPv4" hint="指定 IP の端末を仮想の次ホップとして扱います。その端末まで実際に届く必要があります。">
              <Input aria-label="次ホップ IPv4" value={r.nextHop} placeholder="192.168.1.5" onChange={(e) => update({ nextHop: e.target.value })} />
            </Field>
            <Field label="メトリック" hint="同じ宛先プレフィックスでは、小さい値を優先します。">
              <Input aria-label="メトリック" type="number" min={1} max={65535} value={r.metric || ""} onChange={(e) => update({ metric: Number(e.target.value) })} />
            </Field>
          </>}
        />
      ) : (
        <GatewayRules<VpnTunnel> key="vpn" title="VPN トンネル" entries={tunnels}
          create={() => ({ id: uid("vpn"), name: "", remoteCidr: "", endpoint: "", enabled: true, peerOnline: true })}
          save={(entry) => mutate((sc) => { sc.vpnTunnels = saveGatewayEntry(sc.vpnTunnels, {
            ...entry, remoteCidr: subnetToStr(parseCidr(entry.remoteCidr)!), endpoint: ipToStr(parseIp(entry.endpoint)!),
          }); })}
          remove={(id) => mutate((sc) => { sc.vpnTunnels = sc.vpnTunnels?.filter((t) => t.id !== id); })}
          columns={["対向ネットワーク", "対向エンドポイント", "トンネル"]}
          row={(t) => {
            const wan = chooseWan(s, `vpn:${t.endpoint}`);
            return [t.remoteCidr, `${t.endpoint}:51820`, t.enabled && t.peerOnline && wan ? `接続可能 · ${WAN_NAMES[wan]}` : "停止中"];
          }}
          error={(t) => {
            const remote = parseCidr(t.remoteCidr);
            if (!remote) return "対向ネットワークを IPv4 CIDR（/1〜/32）で入力してください。";
            if (parseIp(t.endpoint) === null) return "対向エンドポイントの IPv4 アドレスを入力してください。";
            if (s.networks.some((n) => {
              const local = parseCidr(n.cidr);
              return local && overlaps(local, remote);
            })) return "対向ネットワークがローカルネットワークと重複しています。";
            if (t.enabled && tunnels.some((other) => other.enabled && other.id !== t.id && other.remoteCidr === subnetToStr(remote)))
              return "同じ対向ネットワークの有効な VPN トンネルがあります。";
            return null;
          }}
          fields={(t, update) => <>
            <Field label="対向ネットワーク CIDR">
              <Input aria-label="対向ネットワーク CIDR" value={t.remoteCidr} placeholder="10.30.0.0/24" onChange={(e) => update({ remoteCidr: e.target.value })} />
            </Field>
            <Field label="対向エンドポイント IPv4" hint="WireGuard の仮想対向です（UDP/51820）。VPN ゾーンのポリシーが内部パケットに適用されます。">
              <Input aria-label="対向エンドポイント IPv4" value={t.endpoint} placeholder="192.0.2.42" onChange={(e) => update({ endpoint: e.target.value })} />
            </Field>
            <Field label="対向の状態">
              <Select aria-label="対向の状態" value={t.peerOnline ? "up" : "down"} onChange={(v) => update({ peerOnline: v === "up" })}
                options={[{ value: "up", label: "応答する" }, { value: "down", label: "応答しない" }]} />
            </Field>
          </>}
        />
      )}
    </>
  );
}
