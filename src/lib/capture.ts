// Trace 結果から、区間ごとのフレーム（Wireshark 風のキャプチャ）を組み立てる
import { WAN_IP } from "./emu";
import type { Protocol, Scenario } from "./model";
import { findGateway, resolveClient, type TraceQuery, type TraceResult } from "./net/simulate";
import { clientWifiMode } from "./wifi-security";

export const BROADCAST = "ff:ff:ff:ff:ff:ff";
export const INTERNET_IP = "93.184.216.34";
const ISP_MAC = "00:00:5e:00:01:01";

export interface Frame {
  no: number;
  kind: "arp-request" | "arp-reply" | "data";
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
  protocol: "ARP" | "ICMP" | "TCP" | "UDP";
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
  const src = resolveClient(s, q.srcId);
  if (!src.ip || !src.network || src.error) return [];
  const gw = findGateway(s);
  const gwId = gw?.id;
  const internet = q.dst === "internet";
  const dst = internet ? null : resolveClient(s, q.dst);
  const srcWifi = clientWifiMode(s, src.client);
  const dstWifi = dst ? clientWifiMode(s, dst.client) : undefined;
  const dstIp = internet ? INTERNET_IP : dst?.ip;
  if (!dstIp) return [];
  const sameNet = !internet && dst?.network?.id === src.network.id;
  const proto: Frame["protocol"] = q.protocol === "icmp" ? "ICMP" : q.protocol === "tcp" ? "TCP" : "UDP";
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
  const nextHopIp = sameNet ? dstIp : src.network.gatewayIp;
  const nextHopMac = sameNet ? dst!.client.mac : gwMac(s);
  const firstVlan = firstLeg.find((x) => x.vlan !== null)?.vlan ?? null;

  // 1) 送信元の ARP: 同じサブネットなら宛先、違えばゲートウェイの MAC を調べる
  // 同じサブネットで失敗した場合（L2 不通 / 無線分離）は ARP も返ってこない
  const arpOk = sameNet ? r.ok : !!src.toGateway?.ok;
  push({
    kind: "arp-request",
    from: nodeName(s, `c:${src.client.id}`),
    to: "ブロードキャスト",
    medium: firstLeg[0]?.medium ?? "ethernet",
    wifi: srcWifi,
    ethSrc: src.client.mac,
    ethDst: BROADCAST,
    vlan: firstVlan,
    protocol: "ARP",
    info: `${nextHopIp} の MAC アドレスを ${src.ip} に通知してください`,
    note: sameNet
      ? "宛先は同じサブネットなので、宛先そのものの MAC アドレスを ARP で調べます。"
      : `宛先 ${dstIp} は別のサブネットなので、デフォルトゲートウェイ ${nextHopIp} の MAC アドレスを調べます。`,
  });
  if (arpOk) {
    push({
      kind: "arp-reply",
      from: sameNet ? nodeName(s, `c:${dst!.client.id}`) : nodeName(s, gwId ?? ""),
      to: nodeName(s, `c:${src.client.id}`),
      medium: firstLeg[0]?.medium ?? "ethernet",
      wifi: srcWifi,
      ethSrc: nextHopMac,
      ethDst: src.client.mac,
      vlan: firstVlan,
      protocol: "ARP",
      info: `${nextHopIp} の MAC アドレスは ${nextHopMac}`,
    });
  } else {
    push({
      kind: "arp-reply",
      from: "—",
      to: nodeName(s, `c:${src.client.id}`),
      medium: "ethernet",
      ethSrc: "—",
      ethDst: "—",
      vlan: null,
      protocol: "ARP",
      info: "応答なし",
      dropped: "ARP の応答が返ってきません（L2 で届いていない）。",
    });
  }

  // 2) 送信元 → 次のホップ（L2 区間 1）
  for (const seg of firstLeg) {
    push({
      kind: "data",
      from: nodeName(s, seg.from),
      to: nodeName(s, seg.to),
      medium: seg.medium,
      wifi: seg.medium === "wifi" ? (seg.from === `c:${q.srcId}` ? srcWifi : dstWifi) : undefined,
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
      const dstVlan = secondLeg.find((x) => x.vlan !== null)?.vlan ?? null;
      push({
        kind: "arp-request",
        from: nodeName(s, gwId!),
        to: "ブロードキャスト",
        medium: "ethernet",
        ethSrc: gwMac(s),
        ethDst: BROADCAST,
        vlan: dstVlan,
        protocol: "ARP",
        info: `${dstIp} の MAC アドレスを ${dst.network!.gatewayIp} に通知してください`,
        note: "ルーターも、宛先ネットワーク側で宛先の MAC アドレスを ARP で調べます。",
      });
      push({
        kind: "arp-reply",
        from: nodeName(s, `c:${dst.client.id}`),
        to: nodeName(s, gwId!),
        medium: "ethernet",
        ethSrc: dst.client.mac,
        ethDst: gwMac(s),
        vlan: dstVlan,
        protocol: "ARP",
        info: `${dstIp} の MAC アドレスは ${dst.client.mac}`,
      });
    }
    for (const seg of secondLeg) {
      push({
        kind: "data",
        from: nodeName(s, seg.from),
        to: nodeName(s, seg.to),
        medium: seg.medium,
        wifi: seg.medium === "wifi" ? dstWifi : undefined,
        ethSrc: seg.medium === "wan" ? wanMac(gwMac(s)) : gwMac(s),
        ethDst: seg.medium === "wan" ? ISP_MAC : dst!.client.mac,
        vlan: seg.vlan,
        ipSrc: seg.medium === "wan" ? WAN_IP : src.ip,
        ipDst: dstIp,
        ttl: 63,
        protocol: proto,
        srcPort: sport,
        dstPort: dport,
        info: info(q.protocol),
        note:
          seg.medium === "wan"
            ? "NAT: 送信元 IP がゲートウェイの WAN アドレスに書き換えられます。"
            : seg === secondLeg[0]
              ? "ルーターを通過: 送信元/宛先 MAC が書き換わり、TTL が 1 減ります。IP アドレスはそのままです。"
              : undefined,
        dropped: seg.fail ? `このリンクで ${seg.label} のため破棄されました。` : undefined,
      });
    }
  } else if (!r.ok && r.failAt === gwId && frames.at(-1)?.kind === "data") {
    frames.at(-1)!.dropped = "ゲートウェイで破棄されました（ファイアウォール、ネットワーク分離、インターネット接続の設定を確認してください）。";
  }
  return frames;
}
