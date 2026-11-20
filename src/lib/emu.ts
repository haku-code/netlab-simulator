// 端末エミュレーター用のネットワーク操作（ブラウザ・ping・traceroute）
import type { Client, ClientKind, Port, Protocol, Scenario } from "./model";
import { inSubnet, parseCidr, parseIp } from "./net/ip";
import { findNetwork, findPort, radioLink, resolveClient, trace, type ClientState, type Hop } from "./net/simulate";

/** 各種端末が待ち受けているポート（サービス） */
export const LISTEN: Record<ClientKind, number[]> = {
  pc: [],
  phone: [],
  tv: [7000, 8008, 8009],
  iot: [80, 554],
  server: [53, 80, 443, 445, 5000, 8123],
  printer: [80, 443, 631, 9100],
};

export const WAN_IP = "203.0.113.24";

export type Target =
  | { kind: "client"; client: Client; ip: string }
  | { kind: "gateway"; ip: string; networkId: string }
  | { kind: "internet"; host: string }
  | { kind: "unknown"; ip: string };

const isPrivate = (n: number) =>
  (n >>> 24 === 10) || (n >>> 20 === (172 << 4) + 1) || (n >>> 16 === (192 << 8) + 168);

/** ホスト名 / IP を宛先に解決する（DNS はゲートウェイが応答する想定） */
export function resolveTarget(s: Scenario, host: string): Target {
  const ipNum = parseIp(host);
  if (ipNum === null) return { kind: "internet", host };
  for (const n of s.networks) if (n.gatewayIp === host) return { kind: "gateway", ip: host, networkId: n.id };
  for (const c of s.clients) {
    const st = resolveClient(s, c.id);
    if (st.ip === host && !st.error) return { kind: "client", client: c, ip: host };
  }
  if (isPrivate(ipNum)) return { kind: "unknown", ip: host };
  return { kind: "internet", host };
}

export type ProbeResult =
  | { status: "ok"; hops: Hop[]; routed: boolean; target: Target }
  | { status: "refused"; hops: Hop[]; routed: boolean; target: Target }
  | { status: "timeout"; hops: Hop[]; summary: string; target: Target }
  | { status: "noip"; message: string }
  | { status: "dns"; message: string };

/** 送信元端末から宛先へ通信できるか */
export function probe(s: Scenario, srcId: string, host: string, protocol: Protocol, port: number | null): ProbeResult {
  const src = resolveClient(s, srcId);
  if (src.error || !src.ip || !src.network) return { status: "noip", message: src.error ?? "ネットワークに接続されていません。" };
  const isName = parseIp(host) === null;
  if (isName) {
    const dnsErr = dnsReachable(s, srcId);
    if (dnsErr) return { status: "dns", message: dnsErr };
  }

  const target = resolveTarget(s, host);
  if (target.kind === "unknown") {
    const sn = parseCidr(src.network.cidr);
    const same = sn && inSubnet(parseIp(target.ip)!, sn);
    return {
      status: "timeout",
      target,
      summary: same ? `${target.ip} からの ARP 応答がありません（その IP の端末は存在しません）。` : `${target.ip} の端末は見つかりません。`,
      hops: [{ status: "fail", title: same ? "ARP 応答なし" : "宛先ホストなし", detail: "この IP アドレスを使っている端末がネットワーク上にありません。" }],
    };
  }
  if (target.kind === "gateway") {
    const r = src.toGateway!;
    if (!r.ok) return { status: "timeout", target, summary: "ゲートウェイに到達できません。", hops: [{ status: "fail", title: "ゲートウェイに届きません", detail: r.reason }] };
    const listens = protocol === "icmp" || port === 80 || port === 443 || port === 53;
    const hops: Hop[] = [{ status: "ok", title: `ゲートウェイ ${target.ip} に到達` }];
    return { status: listens ? "ok" : "refused", target, hops, routed: target.networkId !== src.network.id };
  }
  const r = trace(s, { srcId, dst: target.kind === "internet" ? "internet" : target.client.id, protocol, port });
  if (!r.ok) return { status: "timeout", target, summary: r.summary, hops: r.hops };
  const routed = target.kind === "internet" || resolveClient(s, target.client.id).network?.id !== src.network.id;
  if (target.kind === "client" && protocol !== "icmp" && port !== null && !LISTEN[target.client.kind].includes(port))
    return { status: "refused", target, hops: r.hops, routed };
  return { status: "ok", target, hops: r.hops, routed };
}

/** 端末が使う DNS サーバー（DHCP で配られたもの。手動設定の端末はゲートウェイ） */
export function dnsServerOf(s: Scenario, clientId: string) {
  const st = resolveClient(s, clientId);
  const net = st.client.ipMode === "dhcp" && st.client.lease ? findNetwork(s, st.client.lease.networkId) : st.network;
  return net?.dhcp.dns?.find((d) => d.trim()) ?? net?.gatewayIp;
}

/** DNS サーバーに問い合わせできるか。できなければ理由を返す */
export function dnsReachable(s: Scenario, srcId: string): string | null {
  const src = resolveClient(s, srcId);
  const dns = dnsServerOf(s, srcId);
  if (!dns) return "DNS サーバーが設定されていません。";
  if (s.networks.some((n) => n.gatewayIp === dns)) return src.toGateway?.ok ? null : `DNS サーバー (ゲートウェイ ${dns}) に到達できないため、名前を解決できません。`;
  if (parseIp(dns) === null) return `DNS サーバーの設定 (${dns}) が不正です。`;
  const target = resolveTarget(s, dns);
  if (target.kind === "client") {
    const r = trace(s, { srcId, dst: target.client.id, protocol: "udp", port: 53 });
    if (!r.ok) return `DNS サーバー ${dns} (${target.client.name}) に届きません: ${r.summary}`;
    if (!LISTEN[target.client.kind].includes(53)) return `${target.client.name} (${dns}) は DNS サーバーとして動いていません。`;
    return null;
  }
  if (target.kind === "unknown") return `DNS サーバー ${dns} が見つかりません。`;
  const r = trace(s, { srcId, dst: "internet", protocol: "udp", port: 53 });
  return r.ok ? null : `外部の DNS サーバー ${dns} に届きません: ${r.summary}`;
}

// --- ping / traceroute -------------------------------------------------------

function rnd(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return () => ((h = (h * 1103515245 + 12345) >>> 0) % 1000) / 1000;
}

export function pingLines(s: Scenario, srcId: string, host: string, count = 4): string[] {
  const p = probe(s, srcId, host, "icmp", null);
  if (p.status === "noip") return [`ping: ${host}: ネットワークに到達できません`, p.message];
  if (p.status === "dns") return [`ping: ${host}: 名前を解決できません`, p.message];
  const shown = p.target.kind === "client" ? p.target.ip : p.target.kind === "internet" ? "93.184.216.34" : p.target.ip;
  const out = [`PING ${host}${host !== shown ? ` (${shown})` : ""}: 56 data bytes`];
  if (p.status === "timeout") {
    for (let i = 0; i < count; i++) out.push(`Request timeout for icmp_seq ${i}`);
    out.push("", `--- ${host} ping statistics ---`, `${count} packets transmitted, 0 packets received, 100.0% packet loss`);
    return out;
  }
  const r = rnd(srcId + host);
  const internet = p.target.kind === "internet";
  const ttl = internet ? 54 : p.routed ? 63 : 64;
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = internet ? 8 + r() * 6 : p.routed ? 0.6 + r() * 0.8 : 0.3 + r() * 0.5;
    times.push(t);
    out.push(`64 bytes from ${shown}: icmp_seq=${i} ttl=${ttl} time=${t.toFixed(3)} ms`);
  }
  const avg = times.reduce((a, b) => a + b, 0) / count;
  out.push("", `--- ${host} ping statistics ---`, `${count} packets transmitted, ${count} packets received, 0.0% packet loss`);
  out.push(`round-trip min/avg/max = ${Math.min(...times).toFixed(3)}/${avg.toFixed(3)}/${Math.max(...times).toFixed(3)} ms`);
  return out;
}

export function tracerouteLines(s: Scenario, srcId: string, host: string): string[] {
  const src = resolveClient(s, srcId);
  const p = probe(s, srcId, host, "icmp", null);
  if (p.status === "noip") return [`traceroute: ${host}: ネットワークに到達できません`, p.message];
  if (p.status === "dns") return [`traceroute: ${host}: 名前を解決できません`, p.message];
  const dstIp = p.target.kind === "client" ? p.target.ip : p.target.kind === "internet" ? "93.184.216.34" : p.target.ip;
  const out = [`traceroute to ${host} (${dstIp}), 30 hops max, 60 byte packets`];
  const r = rnd(`tr${srcId}${host}`);
  const ms = (base: number) => [0, 1, 2].map(() => `${(base + r() * base * 0.4).toFixed(3)} ms`).join("  ");
  const gw = src.network!.gatewayIp;

  if (p.status === "timeout") {
    // ゲートウェイまでは届いた場合は 1 ホップ目だけ表示される
    const reachedGw = src.toGateway?.ok && (p.target.kind !== "client" || resolveClient(s, p.target.client.id).network?.id !== src.network!.id);
    let n = 1;
    if (reachedGw) out.push(` ${n++}  ${gw}  ${ms(0.5)}`);
    for (let i = 0; i < 3; i++) out.push(` ${n++}  * * *`);
    return out;
  }
  if (p.target.kind === "internet") {
    out.push(` 1  ${gw}  ${ms(0.5)}`, ` 2  ${WAN_IP.replace(/\d+$/, "1")}  ${ms(3)}`, ` 3  198.51.100.9  ${ms(6)}`, ` 4  ${dstIp}  ${ms(9)}`);
    return out;
  }
  if (p.routed) out.push(` 1  ${gw}  ${ms(0.5)}`, ` 2  ${dstIp}  ${ms(0.8)}`);
  else out.push(` 1  ${dstIp}  ${ms(0.4)}`);
  return out;
}

// --- 表示用 -------------------------------------------------------------------

export interface NetInfo {
  st: ClientState;
  connected: boolean;
  ip?: string;
  mask?: string;
  router?: string;
  dns?: string;
  ssidName?: string;
  /** DHCP のリース期間 (秒) */
  leaseTime?: number;
  radio?: string;
  wifi: ReturnType<typeof radioLink>;
  linkLabel: string;
}

export function netInfo(s: Scenario, clientId: string): NetInfo {
  const st = resolveClient(s, clientId);
  const c = st.client;
  const ssid = c.connection.type === "wifi" ? s.ssids.find((w) => w.id === (c.connection as { ssidId: string | null }).ssidId) : undefined;
  // 端末から見えるのは自分の IP とリースで受け取った情報だけ
  const leaseNet = c.ipMode === "dhcp" && c.lease ? findNetwork(s, c.lease.networkId) : st.network;
  const sn = leaseNet ? parseCidr(leaseNet.cidr) : null;
  const mask = sn ? (Array.from({ length: 4 }, (_, i) => (((0xffffffff << (32 - sn.prefix)) >>> 0) >>> (24 - i * 8)) & 255).join(".")) : undefined;
  const linkUp = st.errorStage !== "attach";
  const radio = ssid && c.connection.type === "wifi" && linkUp && st.attachDeviceId ? radioLink(s, c, ssid, st.attachDeviceId) : null;
  const apName = st.attachDeviceId ? s.devices.find((d) => d.id === st.attachDeviceId)?.name : undefined;
  return {
    st,
    connected: !st.error,
    ip: st.ip,
    mask: st.ip ? mask : undefined,
    router: st.ip ? leaseNet?.gatewayIp : undefined,
    dns: st.ip ? (leaseNet?.dhcp.dns?.find((d) => d.trim()) ?? leaseNet?.gatewayIp) : undefined,
    leaseTime: c.ipMode === "dhcp" && st.ip ? (leaseNet?.dhcp.leaseTime ?? 86400) : undefined,
    ssidName: ssid?.name,
    radio: radio ? `${apName} · ${radio.band} GHz · ch ${radio.channel} · ${radio.rssi} dBm · ${radio.rate} Mbps` : undefined,
    wifi: radio,
    linkLabel: c.connection.type === "wired" ? (linkUp ? "Ethernet 接続済み · 1 Gbps" : "Ethernet: ケーブル未接続") : ssid && linkUp ? `Wi-Fi: ${ssid.name}` : "Wi-Fi 未接続",
  };
}

export type SpeedTestResult =
  | { ok: true; downloadMbps: number; uploadMbps: number; latencyMs: number }
  | { ok: false; reason: string };

// NetLab の仮想 ISP 回線。実測用の外部通信は行わない。
const SPEED_TEST_WAN = { downloadMbps: 500, uploadMbps: 100, latencyMs: 8 };

function portMbps(port: Port | undefined) {
  const speed = port?.speed.match(/^(\d+(?:\.\d+)?)\s*([GM])(?:bE|bps)$/i);
  return speed ? Number(speed[1]) * (speed[2].toUpperCase() === "G" ? 1000 : 1) : 1000;
}

export function speedTest(s: Scenario, clientId: string): SpeedTestResult {
  const { st, wifi } = netInfo(s, clientId);
  if (st.error) return { ok: false, reason: st.error };

  const route = trace(s, { srcId: clientId, dst: "internet", protocol: "tcp", port: 443 });
  if (!route.ok) {
    return { ok: false, reason: route.hops.findLast((hop) => hop.status === "fail")?.detail ?? route.summary };
  }

  const connection = st.client.connection;
  const accessMbps = connection.type === "wired" && connection.deviceId && connection.portId
    ? portMbps(findPort(s, connection.deviceId, connection.portId))
    : Infinity;
  const uplinks = st.toGateway?.linkIds ?? [];
  const rates = uplinks.flatMap((id) => {
    const link = s.links.find((l) => l.id === id);
    return link ? [link.a, link.b].map(({ deviceId, portId }) => portMbps(findPort(s, deviceId, portId))) : [];
  });
  const wiredMbps = Math.min(accessMbps, ...rates);
  const download = Math.min(wiredMbps, wifi ? wifi.rate * 0.65 : Infinity);
  const upload = Math.min(wiredMbps, wifi ? wifi.rate * 0.55 : Infinity);
  return {
    ok: true,
    downloadMbps: Math.min(SPEED_TEST_WAN.downloadMbps, Math.round(download)),
    uploadMbps: Math.min(SPEED_TEST_WAN.uploadMbps, Math.round(upload)),
    latencyMs: SPEED_TEST_WAN.latencyMs + uplinks.length + (wifi ? 2 + Math.round(Math.max(0, -55 - wifi.rssi) * 0.75) : 0),
  };
}

/** URL を host / port に分解する */
export function parseUrl(raw: string): { host: string; port: number; scheme: "http" | "https"; path: string; display: string } | null {
  let v = raw.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  try {
    const u = new URL(v);
    const scheme = u.protocol === "https:" ? "https" : "http";
    const port = u.port ? Number(u.port) : scheme === "https" ? 443 : 80;
    return { host: u.hostname, port, scheme, path: u.pathname, display: `${scheme}://${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname === "/" ? "" : u.pathname}` };
  } catch {
    return null;
  }
}
