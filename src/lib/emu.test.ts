import { describe, expect, it } from "vitest";
import { netInfo, pingLines, probe, speedTest } from "./emu";
import { autoFloor } from "./floor";
import { assignLeases, resolveClient, trace } from "./net/simulate";
import { defaultScenario } from "./scenarios/default";

const fresh = () => assignLeases(defaultScenario());

describe("DHCP leases", () => {
  it("assigns leases on start", () => {
    const s = fresh();
    expect(s.clients.find((c) => c.id === "pc")!.lease).toEqual({ ip: "192.168.1.6", networkId: "lan" });
  });
  it("keeps a stale lease after the port VLAN changes until renewed", () => {
    const s = fresh();
    s.devices.find((d) => d.id === "sw1")!.ports[1].nativeNetworkId = "iot"; // PC のポート
    assignLeases(s);
    const st = resolveClient(s, "pc");
    expect(st.staleLease).toBe(true);
    expect(st.ip).toBe("192.168.1.6");
    s.clients.find((c) => c.id === "pc")!.lease = null; // renew
    assignLeases(s);
    expect(resolveClient(s, "pc").ip).toMatch(/^192\.168\.30\./);
  });
  it("new leases do not collide with existing ones", () => {
    const s = fresh();
    const ips = s.clients.map((c) => resolveClient(s, c.id).ip);
    expect(new Set(ips).size).toBe(ips.length);
  });
});

describe("Wi-Fi", () => {
  it("wrong password fails authentication", () => {
    const s = fresh();
    s.ssids.find((w) => w.id === "home")!.password = "changed";
    expect(resolveClient(s, "iphone").error).toMatch(/認証/);
  });
  it("WPA3-only SSID rejects non-WPA3 devices", () => {
    const s = fresh();
    const tv = s.clients.find((c) => c.id === "tv")!;
    if (tv.connection.type === "wifi") tv.connection.ssidId = "home"; // Home は WPA3
    expect(resolveClient(s, "tv").error).toMatch(/WPA3/);
  });
});

describe("browser / ping", () => {
  it("distinguishes refused from timeout", () => {
    const s = fresh();
    expect(probe(s, "pc", "192.168.1.5", "tcp", 445).status).toBe("ok"); // NAS SMB
    expect(probe(s, "pc", "192.168.1.5", "tcp", 22).status).toBe("refused");
    expect(probe(s, "guest-phone", "192.168.1.5", "tcp", 445).status).toBe("timeout");
    expect(probe(s, "pc", "192.168.1.99", "tcp", 80).status).toBe("timeout");
    expect(probe(s, "pc", "example.com", "tcp", 443).status).toBe("ok");
  });
  it("ping TTL reflects routing", () => {
    const s = fresh();
    expect(pingLines(s, "pc", "192.168.1.5")[1]).toContain("ttl=64");
    expect(pingLines(s, "pc", "192.168.30.6")[1]).toContain("ttl=63");
    expect(pingLines(s, "plug", "192.168.1.6").join("\n")).toContain("100.0% packet loss");
  });
});

describe("speed test", () => {
  it("uses the negotiated path and respects HTTPS firewall rules", () => {
    const s = fresh();
    expect(speedTest(s, "pc")).toMatchObject({ ok: true, downloadMbps: 500, uploadMbps: 100 });

    const uplink = resolveClient(s, "pc").toGateway!.linkIds[0];
    const { deviceId, portId } = s.links.find((l) => l.id === uplink)!.a;
    s.devices.find((d) => d.id === deviceId)!.ports.find((p) => p.id === portId)!.speed = "100 Mbps";
    expect(speedTest(s, "pc")).toMatchObject({ ok: true, downloadMbps: 100 });

    s.policies.unshift({ id: "deny-test", name: "HTTPS を拒否", action: "block", srcZone: "internal", src: "any", dstZone: "external", dst: "any", protocol: "tcp", port: 443, enabled: true });
    expect(speedTest(s, "pc")).toMatchObject({ ok: false, reason: expect.stringContaining("ポリシー") });
  });

  it("uses the phone's current signal and fails when it goes out of range", () => {
    const s = autoFloor(fresh(), "house");
    const phone = s.clients.find((c) => c.id === "iphone")!;
    const ap = s.devices.find((d) => d.id === "ap1")!;
    const strong = netInfo(s, phone.id).wifi?.rssi ?? 0;
    const fast = speedTest(s, phone.id);
    expect(fast.ok).toBe(true);

    ap.txPower = "low";
    phone.pos = { x: 13, y: 9 };
    expect(netInfo(s, phone.id).wifi?.rssi).toBeLessThan(strong);
    const slow = speedTest(s, phone.id);
    expect(slow.ok).toBe(true);
    if (fast.ok && slow.ok) {
      expect(slow.downloadMbps).toBeLessThan(fast.downloadMbps);
      expect(slow.uploadMbps).toBeLessThan(fast.uploadMbps);
      expect(slow.latencyMs).toBeGreaterThan(fast.latencyMs);
    }

    s.floor!.wallLoss = { "2.4": 25, "5": 25, "6": 25 };
    expect(netInfo(s, phone.id).wifi).toBeNull();
    expect(speedTest(s, phone.id)).toMatchObject({ ok: false, reason: expect.stringContaining("電波が弱すぎ") });
  });
});


describe("packet segments", () => {
  it("routed path goes up in the source VLAN and down tagged in the destination VLAN", () => {
    const s = fresh();
    const r = trace(s, { srcId: "pc", dst: "plug", protocol: "icmp", port: null });
    expect(r.segments.map((x) => `${x.from}>${x.to}:${x.label}`)).toEqual([
      "c:pc>sw1:タグなし",
      "sw1>gw:タグなし (VLAN 1)",
      "gw>sw1:VLAN 30 · タグ付き",
      "sw1>c:plug:タグなし",
    ]);
    expect(r.failAt).toBeNull();
  });
  it("firewall block stops at the gateway", () => {
    const s = fresh();
    const r = trace(s, { srcId: "guest-phone", dst: "pc", protocol: "icmp", port: null });
    expect(r.failAt).toBe("gw");
    expect(r.segments.at(-1)!.to).toBe("gw");
  });
});
