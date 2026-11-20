import { describe, expect, it } from "vitest";
import { buildCapture, BROADCAST } from "./capture";
import { WAN_IP } from "./emu";
import { assignLeases, trace } from "./net/simulate";
import { defaultScenario } from "./scenarios/default";

const run = (src: string, dst: string, protocol: "icmp" | "tcp" = "icmp", port: number | null = null) => {
  const s = assignLeases(defaultScenario());
  const q = { srcId: src, dst, protocol, port };
  return buildCapture(s, q, trace(s, q));
};

describe("packet capture", () => {
  it("routed: ARP for gateway, MAC rewritten, TTL decremented, IP unchanged", () => {
    const f = run("pc", "plug", "tcp", 80);
    expect(f[0].kind).toBe("arp-request");
    expect(f[0].ethDst).toBe(BROADCAST);
    expect(f[0].info).toContain("192.168.1.1");
    const data = f.filter((x) => x.kind === "data");
    const before = data[0];
    const after = data.at(-1)!;
    expect(before.ttl).toBe(64);
    expect(after.ttl).toBe(63);
    expect(after.ethSrc).not.toBe(before.ethSrc);
    expect(after.ipSrc).toBe(before.ipSrc);
    expect(after.ipDst).toBe(before.ipDst);
    // ルーターから IoT へは VLAN 30 タグ付きで出る区間がある
    expect(data.some((x) => x.vlan === 30)).toBe(true);
    // ルーター側の ARP もある
    expect(f.filter((x) => x.kind === "arp-request").length).toBe(2);
  });
  it("same subnet: ARP for the destination itself, TTL stays 64", () => {
    const f = run("pc", "nas");
    expect(f[0].info).toContain("192.168.1.5");
    expect(f.filter((x) => x.kind === "data").every((x) => x.ttl === 64)).toBe(true);
  });
  it("internet: NAT rewrites the source IP", () => {
    const f = run("pc", "internet", "tcp", 443);
    const wan = f.find((x) => x.medium === "wan")!;
    expect(wan.ipSrc).toBe(WAN_IP);
    expect(wan.changed).toContain("ipSrc");
  });
  it("firewall drop is marked on the last frame", () => {
    const f = run("guest-phone", "pc");
    expect(f.at(-1)!.dropped).toMatch(/ゲートウェイで破棄/);
  });
});
