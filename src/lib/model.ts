import type { WifiSecurity } from "./wifi-security";
import type { SecuritySettings } from "./net/security";
// ネットワーク構成のデータモデル。すべてブラウザ内で完結する仮想ネットワーク。

import type { Band, Floor } from "./floor";

export interface XY {
  x: number;
  y: number;
}

export type DeviceType = "gateway" | "switch" | "ap";
export type Protocol = "icmp" | "tcp" | "udp";

/** Tagged VLAN Management: Allow All = trunk(全VLAN) / Block All = access / Custom = 指定VLANのみ */
export type TaggedMode = "all" | "none" | "custom";

export interface Port {
  id: string;
  /** 1 始まりのポート番号 */
  idx: number;
  name: string;
  /** Native VLAN (タグなしで流れるネットワーク) */
  nativeNetworkId: string | null;
  tagged: TaggedMode;
  /** tagged === "custom" のときに許可するネットワーク */
  taggedNetworkIds: string[];
  enabled: boolean;
  speed: string;
}

export interface Device {
  id: string;
  type: DeviceType;
  name: string;
  model: string;
  mac: string;
  ip: string;
  ports: Port[];
  /** フロアプラン上の位置 (m) */
  pos?: XY;
  /** AP の送信出力 */
  txPower?: "high" | "medium" | "low";
  wifiRadios?: Partial<Record<Band, { channel: number; width: number }>>;
  meshParentId?: string;
}

export interface PortRef {
  deviceId: string;
  portId: string;
}

/** 機器同士のケーブル接続 */
export interface Link {
  id: string;
  a: PortRef;
  b: PortRef;
}

export const DEFAULT_DHCP_LEASE_TIME = 86400;

export interface Network {
  id: string;
  name: string;
  vlanId: number;
  /** 例: 192.168.1.0/24 */
  cidr: string;
  gatewayIp: string;
  dhcp: {
    enabled: boolean;
    start: string;
    end: string;
    /** リース期間 (秒)。未指定は 86400 */
    leaseTime?: number;
    /** 配る DNS サーバー。未指定・空ならゲートウェイ */
    dns?: string[];
  };
  /** Isolate Network: 他の内部ネットワークとの通信を遮断 */
  isolateNetwork: boolean;
  internetAccess: boolean;
  zoneId: string;
  ipv6Prefix?: string;
}

export interface Zone {
  id: string;
  name: string;
  builtin: boolean;
}

export interface WifiSsid {
  id: string;
  name: string;
  networkId: string | null;
  security: WifiSecurity;
  enterpriseIdentity?: string;
  radius?: { online: boolean; users: { identity: string; password: string }[] };
  ppsk?: Record<string, string>;
  captivePortal?: { id: string; password: string };
  password: string;
  /** Client Device Isolation: 同じ SSID の無線クライアント同士の通信を遮断 */
  clientIsolation: boolean;
  /** Broadcasting APs: 配信する AP の ID。未指定 = すべての AP */
  apIds?: string[];
  bands: ("2.4" | "5" | "6")[];
}

/** 接続状態: all = 新規も戻りも / new = 新規の接続だけ / established = 確立済み（戻りの通信）だけ */
export type ConnState = "all" | "new" | "established";

/** 曜日 (0=日〜6=土) と時刻の範囲。end < start なら日をまたぐ */
export interface Schedule {
  days: number[];
  start: string;
  end: string;
}

export interface FirewallPolicy {
  id: string;
  name: string;
  action: "allow" | "block";
  srcZone: string;
  /** "any" / ネットワーク ID / "client:<端末 ID>" / "group:<オブジェクト ID>" */
  src: string;
  dstZone: string;
  dst: string;
  protocol: "all" | Protocol;
  port: number | null;
  /** ポートリスト（オブジェクト）。指定すると port より優先 */
  portListId?: string;
  enabled: boolean;
  /** 未指定は "all" */
  connState?: ConnState;
  /** 未指定は常時 */
  schedule?: Schedule;
}

/** ポリシーで使うオブジェクト（端末グループ / IP グループ / ポートリスト） */
export interface PolicyObject {
  id: string;
  name: string;
  kind: "devices" | "ips" | "ports";
  /** 端末 ID / IP・CIDR / ポート番号 */
  values: string[];
}

export type ClientKind = "pc" | "phone" | "iot" | "server" | "printer" | "tv";

export type ClientConnection =
  /** deviceId/portId が null = LAN ケーブルが抜けている */
  | { type: "wired"; deviceId: string | null; portId: string | null }
  /** ssidId が null = どの Wi-Fi にも接続していない */
  | { type: "wifi"; apId: string; ssidId: string | null };

/** DHCP で受け取った IP。端末は再接続/更新するまでこれを使い続ける */
export interface Lease {
  ip: string;
  networkId: string;
}

export type WebService = {
  kind: "website" | "forum";
  host: string;
  tls: "trusted" | "expired" | "untrusted" | "disabled";
  posts?: { id: string; author: string; body: string }[];
};

export interface Client {
  id: string;
  name: string;
  kind: ClientKind;
  vendor: string;
  mac: string;
  connection: ClientConnection;
  ipMode: "dhcp" | "static";
  staticIp: string;
  lease: Lease | null;
  /** 現在選択している Wi-Fi の認証情報 */
  wifiPassword: string;
  /** 接続済み Wi-Fi の認証情報（SSID ID ごと） */
  wifiPasswords?: Record<string, string>;
  wifiIdentities?: Record<string, string>;
  wifiIdentity?: string;
  wifiCertificate?: boolean;
  wifiLegacyOnly?: boolean;
  guestPortalSession?: string;
  webService?: WebService;
  /** WPA3 に対応しているか（古い TV や IoT 機器は非対応） */
  wpa3: boolean;
  /** DHCP 予約: DHCP で常にこの IP を割り当てる（UniFi の Fixed IP Address） */
  reservedIp?: string;
  /** フロアプラン上の位置 (m) */
  pos?: XY;
}

export function isIPhone(client: Pick<Client, "id" | "name">) {
  return client.id === "iphone" || /\biphone\b/i.test(client.name);
}

export type WanId = "wan1" | "wan2";

export interface WanLink {
  online: boolean;
  downloadMbps: number;
  uploadMbps: number;
  backgroundFlows: number;
}

export interface WanSettings {
  mode: "failover" | "balance";
  links: Record<WanId, WanLink>;
}

export interface PortForward {
  id: string;
  name: string;
  wan: WanId;
  protocol: "tcp" | "udp";
  publicPort: number;
  targetIp: string;
  targetPort: number;
  enabled: boolean;
}

export interface VpnTunnel {
  id: string;
  name: string;
  remoteCidr: string;
  endpoint: string;
  enabled: boolean;
  peerOnline: boolean;
}

export interface StaticRoute {
  id: string;
  name: string;
  cidr: string;
  nextHop: string;
  metric: number;
  enabled: boolean;
}

export type QosPriority = "high" | "normal" | "low";

export interface QosRule {
  clientId: string;
  priority: QosPriority;
  downloadLimit?: number;
  uploadLimit?: number;
}

export interface Scenario {
  networks: Network[];
  zones: Zone[];
  devices: Device[];
  links: Link[];
  clients: Client[];
  ssids: WifiSsid[];
  security?: SecuritySettings;
  ipv6Wan?: boolean;
  /** ゾーンの組ごとに上から順に評価される */
  policies: FirewallPolicy[];
  /** mDNS リフレクター: 指定したネットワーク間でサービス広告 (Bonjour) を中継する */
  mdns?: { enabled: boolean; networkIds: string[] };
  /** 間取り。あると無線は位置と電波強度で AP を選ぶ */
  floor?: Floor;
  objects?: PolicyObject[];
  /** シミュレーション上の現在時刻（スケジュール付きポリシーの判定に使う） */
  clock?: { day: number; time: string };
  wan?: WanSettings;
  portForwards?: PortForward[];
  vpnTunnels?: VpnTunnel[];
  staticRoutes?: StaticRoute[];
  qos?: QosRule[];
}

export const BUILTIN_ZONES: Zone[] = [
  { id: "internal", name: "Internal", builtin: true },
  { id: "external", name: "External", builtin: true },
  { id: "gateway", name: "Gateway", builtin: true },
  { id: "hotspot", name: "Hotspot", builtin: true },
  { id: "dmz", name: "DMZ", builtin: true },
  { id: "vpn", name: "VPN", builtin: true },
];

/** 端末がつながっている機器（スイッチ/AP）の ID */
export const attachedTo = (c: Client): string | null => (c.connection.type === "wired" ? c.connection.deviceId : c.connection.apId);

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

export function randomMac(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const b = [0x74, 0xac, 0xb9, (h >>> 16) & 255, (h >>> 8) & 255, h & 255];
  return b.map((x) => x.toString(16).padStart(2, "0")).join(":");
}
