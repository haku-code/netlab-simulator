// 端末エミュレーター用のネットワーク操作（ブラウザ・ping・traceroute）
import { DEFAULT_DHCP_LEASE_TIME, type Client, type Port, type Protocol, type QosPriority, type Scenario, type WanId } from "./model";
import { inSubnet, ipToStr, parseCidr, parseIp } from "./net/ip";
import { formatIpv6, INTERNET_IP6, ipv6Gateway, isGlobalIpv6, parseIpv6, type IpFamily } from "./net/ipv6";
import { inspectDns, normalizeDomain, signatureAddress, type SecurityDecision } from "./net/security";
import { findNetwork, findPort, ipv6ClientState, radioLink, resolveClient, trace, type ClientState, type Hop, type TraceRoute } from "./net/simulate";
import { gatewayRoute, INTERNET_IP, isPrivateIp, wanBandwidth, WAN_IPS, WAN_LATENCY_MS } from "./net/gateway";
import { listensOn } from "./net/services";
import { meshPathRate } from "./net/wifi-radio";
import { GUEST_PORTAL_REQUIRED } from "./wifi";

export { LISTEN } from "./net/services";
export const WAN_IP = WAN_IPS.wan1;

export type Target =
  | { kind: "client"; client: Client; ip: string }
  | { kind: "gateway"; ip: string; networkId: string }
  | { kind: "internet"; host: string; ip: string }
  | { kind: "routed"; ip: string }
  | { kind: "unknown"; ip: string }
  | { kind: "unresolved"; host: string };

/** ホスト名 / IP を宛先に解決する（DNS はゲートウェイが応答する想定） */
export function resolveTarget(s: Scenario, host: string, family?: IpFamily): Target {
  const address6 = parseIpv6(host);
  const ipNum = parseIp(host);
  const ipv6 = address6 !== null || family === "ipv6";
  const stateOf = (id: string) => {
    const state = resolveClient(s, id);
    return ipv6 ? ipv6ClientState(state) : state;
  };
  if (ipNum === null && address6 === null) {
    if (host.includes(":")) return { kind: "unresolved", host };
    const name = normalizeDomain(host);
    const server = s.clients.find((c) => c.kind === "server" && c.webService?.host === name);
    if (!server) return { kind: "internet", host: name, ip: signatureAddress(name, ipv6) ?? (ipv6 ? INTERNET_IP6 : INTERNET_IP) };
    const state = stateOf(server.id);
    return state.ip && !state.error ? { kind: "client", client: server, ip: state.ip } : { kind: "unresolved", host };
  }
  const ip = address6 !== null ? formatIpv6(address6) : ipToStr(ipNum!);
  if (ipv6 && address6 === null) return { kind: "unresolved", host };
  for (const n of s.networks) if ((ipv6 ? ipv6Gateway(n) : n.gatewayIp) === ip) return { kind: "gateway", ip, networkId: n.id };
  for (const c of s.clients) {
    const st = stateOf(c.id);
    if (st.ip === ip && !st.error) return { kind: "client", client: c, ip };
  }
  if (!ipv6 && gatewayRoute(s, ip)) return { kind: "routed", ip };
  if (address6 !== null ? !isGlobalIpv6(address6) : isPrivateIp(ipNum!)) return { kind: "unknown", ip };
  return { kind: "internet", host, ip };
}

export type ProbeResult = (
  | { status: "ok"; hops: Hop[]; routed: boolean; target: Exclude<Target, { kind: "unresolved" }>; route?: TraceRoute }
  | { status: "refused"; hops: Hop[]; routed: boolean; target: Exclude<Target, { kind: "unresolved" }> }
  | { status: "timeout"; hops: Hop[]; summary: string; target: Exclude<Target, { kind: "unresolved" }> }
  | { status: "noip"; message: string }
  | { status: "dns"; message: string }
) & { security?: SecurityDecision[] };

/** 送信元端末から宛先へ通信できるか */
export function probe(s: Scenario, srcId: string, host: string, protocol: Protocol, port: number | null, family?: IpFamily): ProbeResult {
  const ipv6 = parseIpv6(host) !== null || family === "ipv6";
  const ipFamily = ipv6 ? "ipv6" : "ipv4";
  const state = resolveClient(s, srcId);
  const src = ipv6 ? ipv6ClientState(state) : state;
  if (src.error || !src.ip || !src.network) return { status: "noip", message: src.error ?? "ネットワークに接続されていません。" };
  if (src.guestPortal) return { status: "noip", message: GUEST_PORTAL_REQUIRED };
  const isName = !host.includes(":") && parseIp(host) === null;
  if (isName) {
    const dnsErr = ipv6 ? (src.toGateway?.ok ? null : "IPv6 DNS サーバーに到達できません。") : dnsReachable(s, srcId);
    if (dnsErr) return { status: "dns", message: dnsErr };
    const blocked = inspectDns(s, host);
    if (blocked) return { status: "dns", message: blocked.reason, security: [blocked] };
  }

  const target = resolveTarget(s, host, ipFamily);
  if (target.kind === "unresolved") return { status: "dns", message: `${host} に有効な IP アドレスがありません。` };
  if (target.kind === "unknown" && !ipv6) {
    const sn = parseCidr(src.network.cidr);
    const same = sn && inSubnet(parseIp(target.ip)!, sn);
    return {
      status: "timeout",
      target,
      summary: same ? `${target.ip} からの ARP 応答がありません（その IP の端末は存在しません）。` : `${target.ip} の端末は見つかりません。`,
      hops: [{ status: "fail", title: same ? "ARP 応答なし" : "宛先ホストなし", detail: "この IP アドレスを使っている端末がネットワーク上にありません。" }],
    };
  }
  if (target.kind === "gateway" && !ipv6) {
    const r = src.toGateway!;
    if (!r.ok) return { status: "timeout", target, summary: "ゲートウェイに到達できません。", hops: [{ status: "fail", title: "ゲートウェイに届きません", detail: r.reason }] };
    const listens = protocol === "icmp" || port === 80 || port === 443 || port === 53;
    const hops: Hop[] = [{ status: "ok", title: `ゲートウェイ ${target.ip} に到達` }];
    return { status: listens ? "ok" : "refused", target, hops, routed: target.networkId !== src.network.id };
  }
  const r = trace(s, {
    srcId, dst: target.kind === "client" ? target.client.id : "internet",
    dstIp: target.ip, dstHost: isName ? normalizeDomain(host) : undefined, protocol, port, family: ipFamily,
  });
  const security = r.security ? { security: r.security } : {};
  if (!r.ok) return { status: "timeout", target, summary: r.summary, hops: r.hops, ...security };
  const routed = target.kind === "gateway" ? target.networkId !== src.network.id : target.kind !== "client" || resolveClient(s, target.client.id).network?.id !== src.network.id;
  if (target.kind === "gateway" && protocol !== "icmp" && ![53, 80, 443].includes(port ?? 0)
    || target.kind === "client" && protocol !== "icmp" && port !== null && !listensOn(target.client, protocol, port))
    return { status: "refused", target, hops: r.hops, routed, ...security };
  return { status: "ok", target, hops: r.hops, routed, ...(r.route ? { route: r.route } : {}), ...security };
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
  if (src.guestPortal) return GUEST_PORTAL_REQUIRED;
  const dns = dnsServerOf(s, srcId);
  if (!dns) return "DNS サーバーが設定されていません。";
  if (s.networks.some((n) => n.gatewayIp === dns)) return src.toGateway?.ok ? null : `DNS サーバー (ゲートウェイ ${dns}) に到達できないため、名前を解決できません。`;
  if (parseIp(dns) === null) return `DNS サーバーの設定 (${dns}) が不正です。`;
  const target = resolveTarget(s, dns);
  if (target.kind === "client") {
    const r = trace(s, { srcId, dst: target.client.id, protocol: "udp", port: 53 });
    if (!r.ok) return `DNS サーバー ${dns} (${target.client.name}) に届きません: ${r.summary}`;
    if (!listensOn(target.client, "udp", 53)) return `${target.client.name} (${dns}) は DNS サーバーとして動いていません。`;
    return null;
  }
  if (target.kind === "unknown") return `DNS サーバー ${dns} が見つかりません。`;
  const r = trace(s, { srcId, dst: "internet", dstIp: dns, protocol: "udp", port: 53 });
  return r.ok ? null : `外部の DNS サーバー ${dns} に届きません: ${r.summary}`;
}

// --- ping / traceroute -------------------------------------------------------

function rnd(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return () => ((h = (h * 1103515245 + 12345) >>> 0) % 1000) / 1000;
}

export function pingLines(s: Scenario, srcId: string, host: string, count = 4, p = probe(s, srcId, host, "icmp", null)): string[] {
  if (p.status === "noip") return [`ping: ${host}: ネットワークに到達できません`, p.message];
  if (p.status === "dns") return [`ping: ${host}: 名前を解決できません`, p.message];
  const shown = p.target.ip;
  const out = [`PING ${host}${host !== shown ? ` (${shown})` : ""}: 56 data bytes`];
  if (p.status === "timeout") {
    for (let i = 0; i < count; i++) out.push(`Request timeout for icmp_seq ${i}`);
    out.push("", `--- ${host} ping statistics ---`, `${count} packets transmitted, 0 packets received, 100.0% packet loss`);
    if (p.security?.some((event) => event.action === "block")) out.push(p.summary);
    return out;
  }
  const r = rnd(srcId + host);
  const internet = p.target.kind === "internet";
  const ttl = internet ? 54 : p.routed ? 63 : 64;
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = internet ? 8 + r() * 6 : p.routed ? 0.6 + r() * 0.8 : 0.3 + r() * 0.5;
    times.push(t);
    out.push(`64 bytes from ${shown}: icmp_seq=${i} ${parseIpv6(shown) !== null ? "hlim" : "ttl"}=${ttl} time=${t.toFixed(3)} ms`);
  }
  const avg = times.reduce((a, b) => a + b, 0) / count;
  out.push("", `--- ${host} ping statistics ---`, `${count} packets transmitted, ${count} packets received, 0.0% packet loss`);
  out.push(`round-trip min/avg/max = ${Math.min(...times).toFixed(3)}/${avg.toFixed(3)}/${Math.max(...times).toFixed(3)} ms`);
  return out;
}

export function tracerouteLines(s: Scenario, srcId: string, host: string, p = probe(s, srcId, host, "icmp", null)): string[] {
  const src = resolveClient(s, srcId);
  if (p.status === "noip") return [`traceroute: ${host}: ネットワークに到達できません`, p.message];
  if (p.status === "dns") return [`traceroute: ${host}: 名前を解決できません`, p.message];
  const dstIp = p.target.ip;
  const out = [`traceroute to ${host} (${dstIp}), 30 hops max, 60 byte packets`];
  const r = rnd(`tr${srcId}${host}`);
  const ms = (base: number) => [0, 1, 2].map(() => `${(base + r() * base * 0.4).toFixed(3)} ms`).join("  ");
  const ipv6 = parseIpv6(dstIp) !== null;
  const gw = ipv6 ? ipv6Gateway(src.network!) : src.network!.gatewayIp;

  if (p.status === "timeout") {
    // ゲートウェイまでは届いた場合は 1 ホップ目だけ表示される
    const reachedGw = src.toGateway?.ok && (p.target.kind !== "client" || resolveClient(s, p.target.client.id).network?.id !== src.network!.id);
    let n = 1;
    if (reachedGw) out.push(` ${n++}  ${gw}  ${ms(0.5)}`);
    for (let i = 0; i < 3; i++) out.push(` ${n++}  * * *`);
    return out;
  }
  if (p.status === "ok" && p.route?.kind === "wan") {
    if (ipv6) return [...out, ` 1  ${gw}  ${ms(0.5)}`, ` 2  ${dstIp}  ${ms(9)}`];
    const isp = WAN_IPS[p.route.wan].replace(/\d+$/, "1");
    out.push(` 1  ${gw}  ${ms(0.5)}`, ` 2  ${isp}  ${ms(3)}`, ` 3  198.51.100.9  ${ms(6)}`, ` 4  ${dstIp}  ${ms(9)}`);
    return out;
  }
  if (p.status === "ok" && p.route?.kind === "static") {
    out.push(` 1  ${gw}  ${ms(0.5)}`, ` 2  ${resolveClient(s, p.route.nextHopId).ip}  ${ms(0.8)}`, ` 3  ${dstIp}  ${ms(1)}`);
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
  ipv6?: string;
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
  const radio = ssid && st.attachDeviceId ? radioLink(s, c, ssid, st.attachDeviceId) : null;
  const apName = st.attachDeviceId ? s.devices.find((d) => d.id === st.attachDeviceId)?.name : undefined;
  return {
    st,
    connected: !st.error,
    ip: st.ip,
    mask: st.ip ? mask : undefined,
    router: st.ip ? leaseNet?.gatewayIp : undefined,
    dns: st.ip ? (leaseNet?.dhcp.dns?.find((d) => d.trim()) ?? leaseNet?.gatewayIp) : undefined,
    leaseTime: c.ipMode === "dhcp" && st.ip ? (leaseNet?.dhcp.leaseTime ?? DEFAULT_DHCP_LEASE_TIME) : undefined,
    ssidName: ssid?.name,
    radio: radio ? `${apName} · ${radio.band} GHz · ch ${radio.channel} / ${radio.width} MHz · ${radio.rssi} dBm · ${radio.rate} Mbps${radio.neighbors ? ` · 干渉 AP ${radio.neighbors} 台` : ""}` : undefined,
    wifi: radio,
    ipv6: ipv6ClientState(st).ip,
    linkLabel: c.connection.type === "wired" ? (linkUp ? "Ethernet 接続済み · 1 Gbps" : "Ethernet: ケーブル未接続") : ssid && radio ? `Wi-Fi: ${ssid.name}` : "Wi-Fi 未接続",
  };
}

export type SpeedTestResult =
  | { ok: true; downloadMbps: number; uploadMbps: number; latencyMs: number; wan: WanId; priority: QosPriority; backgroundFlows: number }
  | { ok: false; reason: string };

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
  if (route.route?.kind !== "wan" && route.route?.kind !== "vpn")
    return { ok: false, reason: "測定先への経路が仮想 WAN 回線を通っていません。" };
  const { wan } = route.route;
  const bandwidth = wanBandwidth(s, wan, clientId);

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
  const meshRates = st.toGateway?.deviceIds.flatMap((id) => meshPathRate(s, id) ?? []) ?? [];
  const radioMbps = Math.min(wifi?.rate ?? Infinity, ...meshRates);
  const download = Math.min(wiredMbps, radioMbps * 0.65);
  const upload = Math.min(wiredMbps, radioMbps * 0.55);
  return {
    ok: true,
    downloadMbps: Math.round(Math.min(bandwidth.downloadMbps, download)),
    uploadMbps: Math.round(Math.min(bandwidth.uploadMbps, upload)),
    latencyMs: WAN_LATENCY_MS[wan] + bandwidth.queueDelayMs + uplinks.length + meshRates.length * 2 + (wifi ? 2 + Math.round(Math.max(0, -55 - wifi.rssi) * 0.75) : 0),
    wan,
    priority: bandwidth.priority,
    backgroundFlows: bandwidth.backgroundFlows,
  };
}

/** URL を host / port に分解する */
export function parseUrl(raw: string): { host: string; port: number; scheme: "http" | "https"; path: string; display: string } | null {
  let v = raw.trim();
  if (!v) return null;
  const ipv6 = parseIpv6(v);
  if (ipv6 !== null) v = `[${formatIpv6(ipv6)}]`;
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  try {
    const u = new URL(v);
    if (!["http:", "https:"].includes(u.protocol) || !u.hostname || u.username || u.password) return null;
    const scheme = u.protocol === "https:" ? "https" : "http";
    const port = u.port ? Number(u.port) : scheme === "https" ? 443 : 80;
    return { host: u.hostname.replace(/^\[|\]$/g, ""), port, scheme, path: u.pathname, display: `${scheme}://${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname === "/" ? "" : u.pathname}` };
  } catch {
    return null;
  }
}
