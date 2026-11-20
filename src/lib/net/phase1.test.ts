import { describe, expect, it } from "vitest";
import { dnsReachable, probe } from "../emu";
import { policy, wired } from "../scenarios/builders";
import { defaultScenario } from "../scenarios/default";
import { assignLeases, resolveClient, scheduleActive, trace } from "./simulate";
import { validate } from "./validate";

const fresh = () => assignLeases(defaultScenario());
const t = (s: ReturnType<typeof fresh>, src: string, dst: string, protocol: "icmp" | "tcp" | "udp" = "icmp", port: number | null = null) =>
  trace(s, { srcId: src, dst, protocol, port });

describe("return traffic (connection state)", () => {
  it("a Block with state 'all' also blocks replies to connections from the other side", () => {
    const s = fresh(); // Default → IoT は Allow ポリシーあり
    expect(t(s, "pc", "plug", "tcp", 80).ok).toBe(true);
    s.policies.push(policy("b", "Block IoT to Default", "block", "iot", "internal"));
    const r = t(s, "pc", "plug", "tcp", 80);
    expect(r.ok).toBe(false);
    expect(r.hops.at(-1)!.title).toMatch(/戻りの通信/);
  });
  it("making the Block 'new only' lets replies through, still blocks IoT-initiated traffic", () => {
    const s = fresh();
    s.policies.push(policy("b", "Block IoT to Default", "block", "iot", "internal", { connState: "new" }));
    expect(t(s, "pc", "plug", "tcp", 80).ok).toBe(true);
    expect(t(s, "plug", "pc").ok).toBe(false);
  });
});

describe("schedules", () => {
  it("handles ranges crossing midnight", () => {
    const sch = { days: [1], start: "22:00", end: "06:00" };
    expect(scheduleActive(sch, { day: 1, time: "23:00" })).toBe(true);
    expect(scheduleActive(sch, { day: 2, time: "05:00" })).toBe(true);
    expect(scheduleActive(sch, { day: 2, time: "07:00" })).toBe(false);
    expect(scheduleActive(sch, { day: 1, time: "12:00" })).toBe(false);
  });
  it("a scheduled block only applies at that time", () => {
    const s = fresh();
    s.policies.push(policy("night", "夜は禁止", "block", "internal", "external", { src: "client:iphone", schedule: { days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "06:00" } }));
    s.clock = { day: 3, time: "15:00" };
    expect(t(s, "iphone", "internet").ok).toBe(true);
    s.clock = { day: 3, time: "23:30" };
    expect(t(s, "iphone", "internet").ok).toBe(false);
  });
});

describe("objects", () => {
  it("device groups and port lists", () => {
    const s = fresh();
    s.objects = [
      { id: "kids", name: "子どもの端末", kind: "devices", values: ["iphone"] },
      { id: "web", name: "Web", kind: "ports", values: ["80", "443"] },
    ];
    s.policies.push(policy("k", "Kids web only", "allow", "internal", "external", { src: "group:kids", protocol: "tcp", portListId: "web" }));
    s.policies.push(policy("k2", "Kids block rest", "block", "internal", "external", { src: "group:kids" }));
    expect(t(s, "iphone", "internet", "tcp", 443).ok).toBe(true);
    expect(t(s, "iphone", "internet", "tcp", 25).ok).toBe(false);
    expect(t(s, "pc", "internet", "tcp", 25).ok).toBe(true); // グループ外
  });
});

describe("DHCP", () => {
  it("reservation applies at renewal and is excluded from the pool", () => {
    const s = fresh();
    const pc = s.clients.find((c) => c.id === "pc")!;
    pc.reservedIp = "192.168.1.50";
    expect(resolveClient(s, "pc").ip).toBe("192.168.1.6"); // 既存リースのまま
    pc.lease = null;
    assignLeases(s);
    expect(resolveClient(s, "pc").ip).toBe("192.168.1.50");
    s.clients.find((c) => c.id === "nas")!.reservedIp = "192.168.1.50";
    s.clients.find((c) => c.id === "nas")!.ipMode = "dhcp";
    expect(validate(s).some((i) => /DHCP 予約 192.168.1.50 が/.test(i.message))).toBe(true);
  });
  it("DNS through an internal server (Pi-hole) must be reachable", () => {
    const s = fresh();
    const sw = s.devices.find((d) => d.id === "sw1")!;
    s.clients.push(wired("pihole", "Pi-hole", "server", sw, 5, "192.168.1.53"));
    s.networks.find((n) => n.id === "iot")!.dhcp.dns = ["192.168.1.53"];
    assignLeases(s);
    // IoT → Default は IoT ゾーンの既定で Block → DNS が引けない
    expect(dnsReachable(s, "plug")).toMatch(/届きません/);
    expect(probe(s, "plug", "example.com", "tcp", 443).status).toBe("dns");
    s.policies.push(policy("dns", "IoT DNS", "allow", "iot", "internal", { dst: "client:pihole", protocol: "udp", port: 53 }));
    expect(dnsReachable(s, "plug")).toBeNull();
    expect(probe(s, "plug", "example.com", "tcp", 443).status).toBe("ok");
  });
});
