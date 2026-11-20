import {
  BUILTIN_ZONES,
  isIPhone,
  randomMac,
  type Client,
  type ClientKind,
  type Device,
  type DeviceType,
  type FirewallPolicy,
  type Link,
  type Network,
  type Port,
  type WifiSsid,
} from "../model";

export function newPort(type: DeviceType, deviceId: string, idx: number, net: string | null): Port {
  return {
    id: `${deviceId}:p${idx}`,
    idx,
    name: type === "ap" ? "Uplink" : `Port ${idx}`,
    nativeNetworkId: net,
    tagged: "all",
    taggedNetworkIds: [],
    enabled: true,
    speed: type === "gateway" && idx === 0 ? "2.5 GbE" : "1 GbE",
  };
}

const MODEL: Record<DeviceType, (n: number) => string> = {
  gateway: () => "Cloud Gateway",
  switch: (n) => `Switch ${n}`,
  ap: () => "Access Point",
};

export function makeDevice(type: DeviceType, id: string, name: string, defaultNet: string | null = "lan", portCount?: number): Device {
  const n = portCount ?? (type === "gateway" ? 4 : type === "switch" ? 8 : 1);
  return {
    id,
    type,
    name,
    model: MODEL[type](n),
    mac: randomMac(id),
    ip: type === "gateway" ? "192.168.1.1" : `192.168.1.${2 + (parseInt(randomMac(id).slice(-2), 16) % 3)}`,
    ports: Array.from({ length: n }, (_, i) => newPort(type, id, i + 1, defaultNet)),
  };
}

/** ポート番号 (1 始まり) で設定を上書き */
export function setPort(d: Device, n: number, cfg: Partial<Port>) {
  Object.assign(d.ports[n - 1], cfg);
  return d;
}

/** Allow All (trunk) / Custom */
export const trunk = (native: string | null, tagged: string[] | "all"): Partial<Port> => ({
  nativeNetworkId: native,
  tagged: tagged === "all" ? "all" : "custom",
  taggedNetworkIds: tagged === "all" ? [] : tagged,
});

/** Block All (access) */
export const access = (net: string | null): Partial<Port> => ({
  nativeNetworkId: net,
  tagged: "none",
  taggedNetworkIds: [],
});

export function link(a: Device, ap: number, b: Device, bp: number): Link {
  return {
    id: `link-${a.id}-${ap}-${b.id}-${bp}`,
    a: { deviceId: a.id, portId: a.ports[ap - 1].id },
    b: { deviceId: b.id, portId: b.ports[bp - 1].id },
  };
}

export function network(id: string, name: string, vlanId: number, thirdOctet: number, opts: Partial<Network> = {}): Network {
  const base = `192.168.${thirdOctet}`;
  return {
    id,
    name,
    vlanId,
    cidr: `${base}.0/24`,
    gatewayIp: `${base}.1`,
    dhcp: { enabled: true, start: `${base}.6`, end: `${base}.254` },
    isolateNetwork: false,
    internetAccess: true,
    zoneId: "internal",
    ...opts,
  };
}

export const DEFAULT_WIFI_PASSWORD = "netlab-pass";

export function ssid(id: string, name: string, networkId: string | null, opts: Partial<WifiSsid> = {}): WifiSsid {
  return { id, name, networkId, security: "wpa2", password: DEFAULT_WIFI_PASSWORD, clientIsolation: false, bands: ["2.4", "5"], ...opts };
}

const VENDOR: Record<ClientKind, string> = {
  pc: "Dell",
  phone: "Generic",
  iot: "Espressif",
  server: "Synology",
  printer: "Brother",
  tv: "Sony",
};

export function wired(id: string, name: string, kind: ClientKind, dev: Device, port: number, staticIp?: string): Client {
  return {
    id,
    name,
    kind,
    vendor: kind === "phone" && isIPhone({ id, name }) ? "Apple" : VENDOR[kind],
    mac: randomMac(id),
    connection: { type: "wired", deviceId: dev.id, portId: dev.ports[port - 1].id },
    ipMode: staticIp ? "static" : "dhcp",
    staticIp: staticIp ?? "",
    lease: null,
    wifiPassword: "",
    wpa3: kind !== "iot" && kind !== "tv",
  };
}

export function wifi(id: string, name: string, kind: ClientKind, apDev: Device, ssidId: string): Client {
  return {
    id,
    name,
    kind,
    vendor: kind === "phone" && isIPhone({ id, name }) ? "Apple" : VENDOR[kind],
    mac: randomMac(id),
    connection: { type: "wifi", apId: apDev.id, ssidId },
    ipMode: "dhcp",
    staticIp: "",
    lease: null,
    wifiPassword: DEFAULT_WIFI_PASSWORD,
    wpa3: kind !== "iot" && kind !== "tv",
  };
}

export function policy(
  id: string,
  name: string,
  action: FirewallPolicy["action"],
  srcZone: string,
  dstZone: string,
  opts: Partial<FirewallPolicy> = {},
): FirewallPolicy {
  return { id, name, action, srcZone, src: "any", dstZone, dst: "any", protocol: "all", port: null, enabled: true, ...opts };
}

export const zones = (...custom: { id: string; name: string }[]) => [...BUILTIN_ZONES, ...custom.map((z) => ({ ...z, builtin: false }))];
