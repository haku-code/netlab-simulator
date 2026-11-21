// Trace 結果から、区間ごとのフレーム（Wireshark 風のキャプチャ）を組み立てる
import { EXTERNAL_TEST_IP, INTERNET_IP, WAN_IPS } from "./net/gateway";
import type { Protocol, Scenario } from "./model";
import { findGateway, ipv6ClientState, resolveClient, type TraceQuery, type TraceResult } from "./net/simulate";
import { INTERNET_IP6, ipv6Gateway, parseIpv6 } from "./net/ipv6";
import { isMeshEdge } from "./net/wifi-radio";
import { clientWifiMode, wifiMode } from "./wifi-security";

export const BROADCAST = "ff:ff:ff:ff:ff:ff";
export { INTERNET_IP } from "./net/gateway";
const ISP_MAC = "00:00:5e:00:01:01";
const meshWifi = { ...wifiMode("wpa2"), label: "メッシュバックホール" };

function frameWifi(edge: string, clientMode: Frame["wifi"]): Frame["wifi"] {
  return isMeshEdge(edge) ? meshWifi : clientMode;
}

export interface Frame {
  no: number;
  kind: "arp-request" | "arp-reply" | "neighbor-solicitation" | "neighbor-advertisement" | "data";
  /** 区間（ノード名） */
  from: string;
  to: string;
  medium: "ethernet" | "wifi" | "wan";
  wifi?: ReturnType<typeof clientWifiMode>;
  ethSrc: string;
  ethDst: string;
  vlan: number | null;
  ipSrc?: string;
  ipDst?: string;
  ttl?: number;
  protocol: "ARP" | "ICMP" | "ICMPv6" | "TCP" | "UDP";
  srcPort?: number;
  dstPort?: number;
  info: string;
  /** 前のデータフレームから変わったフィールド */
  changed: (keyof Frame)[];
  /** 学習用の補足 */
  note?: string;
  dropped?: string;
}

const gwMac = (s: Scenario) => findGateway(s)?.mac ?? "00:00:00:00:00:01";
const wanMac = (mac: string) => mac.replace(/..$/, (h) => ((parseInt(h, 16) + 1) % 256).toString(16).padStart(2, "0"));

function solicitedNodeMac(address: string | undefined) {
  const low = Number((parseIpv6(address ?? "") ?? BigInt(0)) & BigInt(0xffffff));
  const bytes = [low >> 16, (low >> 8) & 255, low & 255];
  return ["33", "33", "ff", ...bytes.map((byte) => byte.toString(16).padStart(2, "0"))].join(":");
}

export function ephemeralPort(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 49152 + (h % 16000);
}

export function nodeName(s: Scenario, id: string) {
  if (id === "internet") return "インターネット";
  if (id.startsWith("c:")) return s.clients.find((c) => c.id === id.slice(2))?.name ?? "?";
  return s.devices.find((d) => d.id === id)?.name ?? "?";
}

export function buildCapture(s: Scenario, q: TraceQuery, r: TraceResult): Frame[] {
  if (q.srcId === "internet") return buildInboundCapture(s, q, r);
  const ipv6 = q.family === "ipv6" || parseIpv6(q.dstIp ?? "") !== null;
  const stateOf = (id: string) => {
    const state = resolveClient(s, id);
    return ipv6 ? ipv6ClientState(state) : state;
  };
  const src = stateOf(q.srcId);
  if (!src.ip || !src.network || src.error || src.guestPortal) return [];
  const gw = findGateway(s);
  const gwId = gw?.id;
  const route = r.route;
  const dstId = route?.kind === "static" ? route.nextHopId : q.dst !== "internet" ? q.dst : !route ? r.clientIds[1] : undefined;
  const dst = dstId ? stateOf(dstId) : null;
  const srcWifi = clientWifiMode(s, src.client);
  const dstWifi = dst ? clientWifiMode(s, dst.client) : undefined;
  const dstIp = route && route.kind !== "forward" ? route.targetIp : q.dstIp ?? (q.dst === "internet" ? (ipv6 ? INTERNET_IP6 : INTERNET_IP) : dst?.ip);
  if (!dstIp) return [];
  const sameNet = route?.kind !== "static" && dst?.network?.id === src.network.id;
  const proto: Frame["protocol"] = q.protocol === "icmp" ? (ipv6 ? "ICMPv6" : "ICMP") : q.protocol === "tcp" ? "TCP" : "UDP";
  const sport = q.protocol === "icmp" ? undefined : ephemeralPort(q.srcId + q.dst);
  const dport = q.protocol === "icmp" ? undefined : (q.port ?? undefined);
  const info = (p: Protocol) =>
    p === "icmp" ? "エコー要求 (ping)" : p === "tcp" ? `${sport} → ${dport} [SYN] Seq=0` : `${sport} → ${dport} Len=32`;

  const frames: Frame[] = [];
  const push = (f: Omit<Frame, "no" | "changed">) => {
    const prev = [...frames].reverse().find((x) => x.kind === "data");
    const keys = ["ethSrc", "ethDst", "vlan", "ipSrc", "ipDst", "ttl"] as const;
    const changed = f.kind === "data" && prev ? keys.filter((k) => prev[k] !== f[k]) : [];
    frames.push({ ...f, no: frames.length + 1, changed });
  };

  // 区間を「L2 の区切り（ルーターをまたぐまで）」に分ける
  const segs = r.segments;
  const routerIdx = segs.findIndex((x) => x.from === gwId);
  const firstLeg = routerIdx >= 0 ? segs.slice(0, routerIdx) : segs;
  const secondLeg = routerIdx >= 0 ? segs.slice(routerIdx) : [];
  const gatewayIp = (network: NonNullable<typeof src.network>) => ipv6 ? ipv6Gateway(network) : network.gatewayIp;
  const nextHopIp = sameNet ? dstIp : gatewayIp(src.network);
  const requestKind = ipv6 ? "neighbor-solicitation" : "arp-request";
  const replyKind = ipv6 ? "neighbor-advertisement" : "arp-reply";
  const discovery = ipv6 ? "ICMPv6" : "ARP";
  const nextHopMac = sameNet ? dst!.client.mac : gwMac(s);
  const firstVlan = firstLeg.find((x) => x.vlan !== null)?.vlan ?? null;

  // 1) ARP / NDP: 同じサブネットなら宛先、別のサブネットならゲートウェイの MAC を調べる
  const neighborReached = sameNet ? r.ok : !!src.toGateway?.ok;
  push({
    kind: requestKind,
    from: nodeName(s, `c:${src.client.id}`),
    to: ipv6 ? "近隣探索マルチキャスト" : "ブロードキャスト",
    medium: firstLeg[0]?.medium ?? "ethernet",
    wifi: srcWifi,
    ethSrc: src.client.mac,
    ethDst: ipv6 ? solicitedNodeMac(nextHopIp) : BROADCAST,
    vlan: firstVlan,
    protocol: discovery,
    info: ipv6 ? `Neighbor Solicitation · ${nextHopIp}` : `${nextHopIp} の MAC アドレスを ${src.ip} に通知してください`,
    note: sameNet
      ? `宛先は同じサブネットなので、宛先の MAC アドレスを ${ipv6 ? "NDP" : "ARP"} で調べます。`
      : `宛先 ${dstIp} は別のサブネットなので、デフォルトゲートウェイ ${nextHopIp} の MAC アドレスを調べます。`,
  });
  if (neighborReached) {
    push({
      kind: replyKind,
      from: sameNet ? nodeName(s, `c:${dst!.client.id}`) : nodeName(s, gwId ?? ""),
      to: nodeName(s, `c:${src.client.id}`),
      medium: firstLeg[0]?.medium ?? "ethernet",
      wifi: srcWifi,
      ethSrc: nextHopMac,
      ethDst: src.client.mac,
      vlan: firstVlan,
      protocol: discovery,
      info: ipv6 ? `Neighbor Advertisement · ${nextHopIp}` : `${nextHopIp} の MAC アドレスは ${nextHopMac}`,
    });
  } else {
    push({
      kind: replyKind,
      from: "—",
      to: nodeName(s, `c:${src.client.id}`),
      medium: "ethernet",
      ethSrc: "—",
      ethDst: "—",
      vlan: null,
      protocol: discovery,
      info: "応答なし",
      dropped: `${ipv6 ? "NDP" : "ARP"} の応答が返ってきません。`,
    });
  }

  // 2) 送信元 → 次のホップ（L2 区間 1）
  for (const seg of firstLeg) {
    push({
      kind: "data",
      from: nodeName(s, seg.from),
      to: nodeName(s, seg.to),
      medium: seg.medium,
      wifi: seg.medium === "wifi" ? frameWifi(seg.edge, seg.from === `c:${q.srcId}` ? srcWifi : dstWifi) : undefined,
      ethSrc: src.client.mac,
      ethDst: nextHopMac,
      vlan: seg.vlan,
      ipSrc: src.ip,
      ipDst: dstIp,
      ttl: 64,
      protocol: proto,
      srcPort: sport,
      dstPort: dport,
      info: info(q.protocol),
      dropped: seg.fail ? `このリンクで ${seg.label} のため破棄されました。` : undefined,
    });
  }

  // 3) ルーター通過後（L2 区間 2）: MAC は書き換わり、TTL が 1 減る。IP は変わらない
  if (secondLeg.length) {
    const toWan = secondLeg[0].medium === "wan";
    if (!toWan && dst) {
      const address = dst.ip ?? dstIp;
      const dstVlan = secondLeg.find((x) => x.vlan !== null)?.vlan ?? null;
      push({
        kind: requestKind,
        from: nodeName(s, gwId!),
        to: ipv6 ? "近隣探索マルチキャスト" : "ブロードキャスト",
        medium: "ethernet",
        ethSrc: gwMac(s),
        ethDst: ipv6 ? solicitedNodeMac(address) : BROADCAST,
        vlan: dstVlan,
        protocol: discovery,
        info: ipv6 ? `Neighbor Solicitation · ${address}` : `${address} の MAC アドレスを ${dst.network!.gatewayIp} に通知してください`,
        note: ipv6 ? "IPv6 ルーターは NDP で宛先の MAC アドレスを調べます。" : route?.kind === "static" ? "静的ルートの次ホップの MAC アドレスを ARP で調べます。" : "ルーターも、宛先ネットワーク側で宛先の MAC アドレスを ARP で調べます。",
      });
      push({
        kind: replyKind,
        from: nodeName(s, `c:${dst.client.id}`),
        to: nodeName(s, gwId!),
        medium: "ethernet",
        ethSrc: dst.client.mac,
        ethDst: gwMac(s),
        vlan: dstVlan,
        protocol: discovery,
        info: ipv6 ? `Neighbor Advertisement · ${address}` : `${address} の MAC アドレスは ${dst.client.mac}`,
      });
    }
    for (const seg of secondLeg) {
      const wan = seg.medium === "wan";
      const tunnel = wan && route?.kind === "vpn" ? route : undefined;
      push({
        kind: "data",
        from: nodeName(s, seg.from),
        to: nodeName(s, seg.to),
        medium: seg.medium,
        wifi: seg.medium === "wifi" ? frameWifi(seg.edge, dstWifi) : undefined,
        ethSrc: wan ? wanMac(gwMac(s)) : gwMac(s),
        ethDst: wan ? ISP_MAC : dst!.client.mac,
        vlan: seg.vlan,
        ipSrc: wan && !ipv6 && (route?.kind === "wan" || route?.kind === "vpn") ? WAN_IPS[route.wan] : src.ip,
        ipDst: tunnel?.endpoint ?? dstIp,
        ttl: tunnel ? 64 : 63,
        protocol: tunnel ? "UDP" : proto,
        srcPort: sport,
        dstPort: tunnel ? 51820 : dport,
        info: tunnel ? `WireGuard · ${tunnel.name}` : info(q.protocol),
        note:
          tunnel ? `カプセル化: 内側の ${src.ip} → ${dstIp} を仮想 WireGuard データとして運びます。`
          : wan
            ? ipv6 ? "IPv6 ルーティング: 送信元 IP を維持したまま転送します。" : "NAT: 送信元 IP がゲートウェイの WAN アドレスに書き換えられます。"
            : seg === secondLeg[0]
              ? "ルーターを通過: 送信元/宛先 MAC が書き換わり、TTL が 1 減ります。IP アドレスはそのままです。"
              : undefined,
        dropped: seg.fail ? `このリンクで ${seg.label} のため破棄されました。` : undefined,
      });
    }
  } else if (!r.ok && r.failAt === gwId && frames.at(-1)?.kind === "data") {
    frames.at(-1)!.dropped = `ゲートウェイで破棄されました。 ${r.summary}`;
  }
  return frames;
}

function buildInboundCapture(s: Scenario, q: TraceQuery, r: TraceResult): Frame[] {
  const route = r.route;
  if (route?.kind !== "forward") return [];
  const target = route.targetId ? s.clients.find((c) => c.id === route.targetId) : undefined;
  const publicIp = WAN_IPS[route.wan];
  return r.segments.map((seg, i) => {
    const wan = seg.medium === "wan";
    const dstPort = wan ? q.port ?? undefined : route.targetPort;
    return {
      no: i + 1, kind: "data",
      from: nodeName(s, seg.from), to: nodeName(s, seg.to), medium: seg.medium, vlan: seg.vlan,
      wifi: target && seg.medium === "wifi" ? frameWifi(seg.edge, clientWifiMode(s, target)) : undefined,
      ethSrc: wan ? ISP_MAC : gwMac(s),
      ethDst: wan ? wanMac(gwMac(s)) : target?.mac ?? "—",
      ipSrc: EXTERNAL_TEST_IP,
      ipDst: wan ? publicIp : route.targetIp,
      ttl: wan ? 64 : 63,
      protocol: q.protocol === "tcp" ? "TCP" : q.protocol === "udp" ? "UDP" : "ICMP",
      srcPort: q.protocol === "icmp" ? undefined : ephemeralPort(EXTERNAL_TEST_IP + q.dst),
      dstPort,
      info: q.protocol === "icmp" ? "エコー要求 (ping)" : q.protocol === "tcp" ? `着信 TCP/${dstPort} [SYN]` : `着信 UDP/${dstPort}`,
      changed: i === 1 ? ["ethSrc", "ethDst", "ipDst", "ttl", ...(q.port !== dstPort ? ["dstPort" as const] : [])] : [],
      note: i === 1 ? `DNAT: ${publicIp}:${q.port} → ${route.targetIp}:${route.targetPort}` : undefined,
      dropped: seg.fail || (!r.ok && r.segments.length === 1) ? r.summary : undefined,
    };
  });
}
