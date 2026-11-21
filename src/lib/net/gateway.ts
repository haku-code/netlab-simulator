import type { QosPriority, Scenario, StaticRoute, VpnTunnel, WanId, WanSettings } from "../model";
import { inSubnet, parseCidr, parseIp } from "./ip";

export const WAN_IDS = ["wan1", "wan2"] as const;
export const WAN_NAMES: Record<WanId, string> = { wan1: "WAN1", wan2: "WAN2" };
export const WAN_IPS: Record<WanId, string> = { wan1: "203.0.113.24", wan2: "198.51.100.24" };
export const WAN_LATENCY_MS: Record<WanId, number> = { wan1: 8, wan2: 14 };
export const INTERNET_IP = "93.184.216.34";
export const EXTERNAL_TEST_IP = "192.0.2.77";

const DEFAULT_WAN: WanSettings = {
  mode: "failover",
  links: {
    wan1: { online: true, downloadMbps: 500, uploadMbps: 100, backgroundFlows: 0 },
    wan2: { online: false, downloadMbps: 200, uploadMbps: 50, backgroundFlows: 0 },
  },
};

export const wanSettings = (s: Scenario) => s.wan ?? DEFAULT_WAN;

export function saveGatewayEntry<T extends { id: string }>(entries: T[] = [], entry: T) {
  return entries.some((e) => e.id === entry.id) ? entries.map((e) => e.id === entry.id ? entry : e) : [...entries, entry];
}

/** 分散時はフロー単位で経路を固定する。停止中の回線は選ばない。 */
export function chooseWan(s: Scenario, flow: string): WanId | undefined {
  const wan = wanSettings(s);
  const online = WAN_IDS.filter((id) => wan.links[id].online);
  if (wan.mode === "failover" || online.length < 2) return online[0];
  let hash = 0;
  for (const character of flow) hash = Math.imul(hash, 31) + character.charCodeAt(0);
  return online[(hash >>> 0) % online.length];
}

export const QOS_LABELS: Record<QosPriority, string> = { high: "高", normal: "標準", low: "低" };
const QOS_WEIGHT: Record<QosPriority, number> = { high: 4, normal: 2, low: 1 };

export function wanBandwidth(s: Scenario, id: WanId, clientId: string) {
  const link = wanSettings(s).links[id];
  const rule = s.qos?.find((q) => q.clientId === clientId);
  const priority = rule?.priority ?? "normal";
  const weight = QOS_WEIGHT[priority];
  const share = weight / (weight + link.backgroundFlows * QOS_WEIGHT.normal);
  return {
    priority,
    backgroundFlows: link.backgroundFlows,
    downloadMbps: Math.min(link.downloadMbps * share, rule?.downloadLimit ?? Infinity),
    uploadMbps: Math.min(link.uploadMbps * share, rule?.uploadLimit ?? Infinity),
    queueDelayMs: Math.round(4 * link.backgroundFlows / weight),
  };
}

export function parseRouteCidr(cidr: string) {
  const [ip, prefix, extra] = cidr.trim().split("/");
  if (prefix === "0" && extra === undefined && parseIp(ip) !== null)
    return { network: 0, broadcast: 0xffffffff, prefix: 0, size: 2 ** 32 };
  return parseCidr(cidr);
}

export const isPrivateIp = (ip: number) =>
  ip >>> 24 === 10 || ip >>> 20 === (172 << 4) + 1 || ip >>> 16 === (192 << 8) + 168;

export type GatewayRoute = { kind: "static"; route: StaticRoute } | { kind: "vpn"; tunnel: VpnTunnel };

/** 最長一致。同じプレフィックス長なら直結、VPN、静的ルート（メトリック順）の順。 */
export function gatewayRoute(s: Scenario, ip: string): GatewayRoute | undefined {
  const address = parseIp(ip);
  if (address === null) return undefined;
  let prefix = -1;
  for (const network of s.networks) {
    const subnet = parseCidr(network.cidr);
    if (subnet && inSubnet(address, subnet)) prefix = Math.max(prefix, subnet.prefix);
  }
  let selected: GatewayRoute | undefined;
  for (const tunnel of s.vpnTunnels ?? []) {
    const subnet = parseRouteCidr(tunnel.remoteCidr);
    if (tunnel.enabled && subnet && subnet.prefix > prefix && inSubnet(address, subnet)) {
      prefix = subnet.prefix;
      selected = { kind: "vpn", tunnel };
    }
  }
  for (const route of s.staticRoutes ?? []) {
    const subnet = parseRouteCidr(route.cidr);
    if (!route.enabled || !subnet || !inSubnet(address, subnet)) continue;
    if (subnet.prefix > prefix || (subnet.prefix === prefix && selected?.kind === "static" && route.metric < selected.route.metric)) {
      prefix = subnet.prefix;
      selected = { kind: "static", route };
    }
  }
  return selected;
}
