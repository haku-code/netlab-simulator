import type { Scenario } from "./model";
import { INTERNET_IP, ephemeralPort } from "./capture";
import { dnsServerOf, parseUrl, probe, type ProbeResult } from "./emu";
import { parseIp } from "./net/ip";
import { resolveClient } from "./net/simulate";
import { virtualWebCapture, webError, type WebEvent } from "./web";
import { clientWifiMode } from "./wifi-security";

export const PACKET_PROTOCOLS = ["802.11", "DNS", "TCP", "TLS", "HTTP", "ICMP"] as const;
export type PacketProtocol = (typeof PACKET_PROTOCOLS)[number];

export type PcPacket = {
  protocol: PacketProtocol;
  source: string;
  destination: string;
  sourcePort?: number;
  destinationPort?: number;
  summary: string;
  sample?: string;
  radio?: {
    ssid: string;
    station: string;
    security: string;
    transmitter: string;
    receiver: string;
    visibility: "open" | "legacy" | "protected";
  };
};

export function wifiPacketContext(s: Scenario, id: string) {
  const client = s.clients.find((c) => c.id === id);
  if (client?.connection.type !== "wifi" || !client.connection.ssidId) return null;
  const ssidId = client.connection.ssidId;
  const ssid = s.ssids.find((w) => w.id === ssidId);
  const mode = clientWifiMode(s, client);
  if (!ssid || !mode) return null;
  const { ip, attachDeviceId } = resolveClient(s, id);
  const ap = s.devices.find((d) => d.id === attachDeviceId);
  return ap && ip ? { ssid, mode, station: client, ap, ip } : null;
}

export function observeWifiPackets(packets: PcPacket[], context: NonNullable<ReturnType<typeof wifiPacketContext>>): PcPacket[] {
  const { ssid, mode, station, ap, ip } = context;
  return packets.map((packet) => {
    const outgoing = packet.source === ip;
    const transmitter = outgoing ? station.mac : ap.mac;
    const receiver = outgoing ? ap.mac : station.mac;
    const radio = { ssid: ssid.name, station: station.name, security: mode.label, visibility: mode.radio, transmitter, receiver };
    if (mode.radio === "protected") {
      return { protocol: "802.11", source: transmitter, destination: receiver, summary: `${station.name} · 暗号化データ`, radio };
    }
    return { ...packet, radio };
  });
}

function targetIp(result: ProbeResult) {
  if (!("target" in result)) return undefined;
  return result.target.kind === "internet" ? INTERNET_IP : result.target.ip;
}

function dnsPackets(s: Scenario, clientId: string, source: string, host: string, result: ProbeResult): PcPacket[] {
  if (parseIp(host) !== null || result.status === "noip") return [];
  const dns = dnsServerOf(s, clientId);
  if (!dns || parseIp(dns) === null) return [];
  const clientPort = ephemeralPort(clientId + host + "dns");
  const query: PcPacket = { protocol: "DNS", source, destination: dns, sourcePort: clientPort, destinationPort: 53, summary: `A 問い合わせ · ${host}` };
  const ip = targetIp(result);
  if (result.status === "dns" || !ip || ("target" in result && result.target.kind === "unknown")) return [query];
  return [query, { protocol: "DNS", source: dns, destination: source, sourcePort: 53, destinationPort: clientPort, summary: `A 応答 · ${host} → ${ip}` }];
}

export function browserPackets(s: Scenario, clientId: string, address: string, event: WebEvent, newConnection = true): PcPacket[] {
  const parsed = parseUrl(address);
  if (!parsed) return [];
  const { host, scheme, port } = parsed;
  const result = probe(s, clientId, host, "tcp", port);
  const service = result.status === "ok" && result.target.kind === "client" && result.target.client.kind === "server" ? result.target.client.webService : undefined;
  const problem = service ? webError(service, host, scheme, port) : null;
  const capture = virtualWebCapture(s, clientId, scheme, port, result, problem, event);
  if (!capture.ip || result.status === "noip") return [];

  const packets = newConnection ? dnsPackets(s, clientId, capture.ip, host, result) : [];
  const ip = targetIp(result);
  if (!ip || ("target" in result && result.target.kind === "unknown")) return packets;

  const from = capture.ip;
  const clientPort = ephemeralPort(clientId + host + port);
  const send = (protocol: PacketProtocol, summary: string, reply = false, sample?: string) => {
    packets.push({
      protocol, summary, sample,
      source: reply ? ip : from,
      destination: reply ? from : ip,
      sourcePort: reply ? port : clientPort,
      destinationPort: reply ? clientPort : port,
    });
  };

  if (newConnection) {
    capture.transport.forEach((step, i) => send("TCP", step, i === 1));
    capture.handshake.forEach((step, i) => {
      if (step === "TLS 1.3 確立") send("TLS", "Client Finished · TLS 1.3 確立");
      else send("TLS", step, i === 1 || i === 2);
    });
  }
  if (!capture.exchanged) return packets;

  if (scheme === "https") {
    send("TLS", "Application Data · 暗号化された要求");
    send("TLS", "Application Data · 暗号化された応答", true);
  } else {
    send("HTTP", `${event.method} ${event.path}`, false, capture.request);
    send("HTTP", `HTTP/1.1 ${event.status}`, true, `HTTP/1.1 ${event.status}`);
  }
  return packets;
}

export function pingPackets(s: Scenario, clientId: string, host: string): PcPacket[] {
  const source = resolveClient(s, clientId).ip;
  if (!source) return [];
  const result = probe(s, clientId, host, "icmp", null);
  const packets = dnsPackets(s, clientId, source, host, result);
  const ip = targetIp(result);
  if (!ip || ("target" in result && result.target.kind === "unknown")) return packets;
  for (let seq = 0; seq < 4; seq++) {
    packets.push({ protocol: "ICMP", source, destination: ip, summary: `Echo Request · seq=${seq}` });
    if (result.status === "ok") packets.push({ protocol: "ICMP", source: ip, destination: source, summary: `Echo Reply · seq=${seq}` });
  }
  return packets;
}
