import { attachedTo, type Client, type Device, type Port, type Scenario } from "./model";

export type PortPeer = { kind: "device"; device: Device; port: Port; linkId: string } | { kind: "client"; client: Client } | null;

export function portPeer(s: Scenario, deviceId: string, portId: string): PortPeer {
  for (const l of s.links) {
    const mine = l.a.deviceId === deviceId && l.a.portId === portId ? l.a : l.b.deviceId === deviceId && l.b.portId === portId ? l.b : null;
    if (!mine) continue;
    const other = mine === l.a ? l.b : l.a;
    const device = s.devices.find((d) => d.id === other.deviceId);
    const port = device?.ports.find((p) => p.id === other.portId);
    if (device && port) return { kind: "device", device, port, linkId: l.id };
  }
  const client = s.clients.find((c) => c.connection.type === "wired" && c.connection.deviceId === deviceId && c.connection.portId === portId);
  return client ? { kind: "client", client } : null;
}

export function portBusy(s: Scenario, deviceId: string, portId: string, except?: { linkId?: string; clientId?: string }) {
  return (
    s.links.some(
      (l) => l.id !== except?.linkId && ((l.a.deviceId === deviceId && l.a.portId === portId) || (l.b.deviceId === deviceId && l.b.portId === portId)),
    ) || s.clients.some((c) => c.id !== except?.clientId && c.connection.type === "wired" && c.connection.deviceId === deviceId && c.connection.portId === portId)
  );
}

export function clientsOf(s: Scenario, deviceId: string) {
  return s.clients.filter((c) => attachedTo(c) === deviceId);
}

export function taggedLabel(s: Scenario, p: Pick<Port, "tagged" | "taggedNetworkIds">) {
  if (p.tagged === "all") return "すべて許可";
  if (p.tagged === "none") return "すべて拒否";
  const names = p.taggedNetworkIds.map((id) => s.networks.find((n) => n.id === id)?.vlanId).filter((x) => x !== undefined);
  return names.length ? `カスタム (${names.join(", ")})` : "カスタム";
}
