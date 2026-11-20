import { describe, expect, it } from "vitest";
import type { Scenario } from "../model";
import { autoFloor } from "../floor";
import { assignLeases } from "../net/simulate";
import { policy } from "../scenarios/builders";
import { LESSONS, runChecks } from "./index";

/** アプリと同じ流れ: 間取りを作り、開始時にリース確定 → 修正 → 再度リース確定 → 判定 */
function solve(id: string, fix: (s: Scenario) => void) {
  const l = LESSONS.find((x) => x.id === id)!;
  const s = assignLeases(autoFloor(l.scenario()));
  const before = runChecks(l, s).filter((x) => !x.passed).length;
  fix(s);
  assignLeases(s);
  const fails = runChecks(l, s)
    .filter((x) => !x.passed)
    .map((x) => `${x.check.label}: ${x.result.summary}`);
  return { before, fails };
}
const port = (s: Scenario, dev: string, n: number) => s.devices.find((d) => d.id === dev)!.ports[n - 1];
const client = (s: Scenario, id: string) => s.clients.find((c) => c.id === id)!;

describe("lesson list", () => {
  it("has 18 lessons with unique ids", () => {
    expect(LESSONS).toHaveLength(18);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
  });
  for (const l of LESSONS) {
    it(`${l.id}: starts broken (with leases)`, () => {
      expect(runChecks(l, assignLeases(l.scenario())).some((x) => !x.passed)).toBe(true);
    });
    it(`${l.id}: starts broken the same way with a floor plan`, () => {
      const plain = runChecks(l, assignLeases(l.scenario())).map((x) => x.passed);
      const floor = runChecks(l, assignLeases(autoFloor(l.scenario()))).map((x) => x.passed);
      expect(floor).toEqual(plain);
    });
  }
});

describe("new lessons are solvable", () => {
  it("iot-return: prevents new IoT connections while allowing reply traffic", () => {
    expect(solve("iot-return", (s) => (s.policies.find((p) => p.id === "block-iot")!.connState = "new"))).toEqual({ before: 1, fails: [] });
  });
  it("kids-night: requires a targeted schedule spanning midnight, independent of the current clock", () => {
    const addBlock = (s: Scenario, scheduled: boolean) => {
      s.clock = { day: 4, time: "23:30" };
      s.objects = [{ id: "kids", name: "子どもの端末", kind: "devices", values: ["kid-pc", "kid-phone"] }];
      s.policies.push(policy("night", "夜間はインターネットを拒否", "block", "internal", "external", {
        src: "group:kids",
        schedule: scheduled ? { days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "06:00" } : undefined,
      }));
    };
    expect(solve("kids-night", (s) => addBlock(s, false)).fails).toHaveLength(2);
    expect(solve("kids-night", (s) => addBlock(s, true))).toEqual({ before: 3, fails: [] });
  });
  it("dhcp-pool", () => {
    const r = solve("dhcp-pool", (s) => (s.networks[0].dhcp = { enabled: true, start: "192.168.1.6", end: "192.168.1.254" }));
    expect(r.fails).toEqual([]);
  });
  it("static-ip", () => {
    const r = solve("static-ip", (s) => {
      client(s, "printer").staticIp = "192.168.1.21";
      client(s, "cam").staticIp = "192.168.1.50";
    });
    expect(r.fails).toEqual([]);
  });
  it("wifi-change", () => {
    const r = solve("wifi-change", (s) => {
      for (const id of ["iphone", "laptop"]) Object.assign(client(s, id), { wifiPassword: "Sakura-2026", lease: null });
      const tv = client(s, "tv");
      tv.connection = { type: "wifi", apId: "ap1", ssidId: "home-iot" };
      tv.lease = null;
      s.ssids.find((w) => w.id === "home-iot")!.bands = ["2.4", "5"];
    });
    expect(r.fails).toEqual([]);
  });
  it("printer-pc", () => {
    expect(solve("printer-pc", (s) => (port(s, "sw1", 5).nativeNetworkId = "lan")).fails).toEqual([]);
  });
  it("stale-lease: still broken without renew, fixed with renew", () => {
    expect(solve("stale-lease", () => {}).fails.length).toBe(2);
    expect(solve("stale-lease", (s) => (client(s, "laptop").lease = null)).fails).toEqual([]);
  });
  it("cabling", () => {
    const r = solve("cabling", (s) => {
      client(s, "printer").connection = { type: "wired", deviceId: "sw1", portId: "sw1:p4" };
      port(s, "sw1", 3).enabled = true;
      Object.assign(port(s, "sw1", 6), { tagged: "all" });
    });
    expect(r.fails).toEqual([]);
  });
  it("cctv", () => {
    const r = solve("cctv", (s) => {
      s.zones.push({ id: "z-cam", name: "Cameras", builtin: false });
      Object.assign(s.networks.find((n) => n.id === "cams")!, { zoneId: "z-cam", internetAccess: false });
      s.policies.push(policy("p", "Allow RTSP", "allow", "internal", "z-cam", { src: "client:nvr", protocol: "tcp", port: 554 }));
    });
    expect(r.fails).toEqual([]);
  });
  it("cctv: a network-wide allow is not enough (PC would reach RTSP)", () => {
    const r = solve("cctv", (s) => {
      s.zones.push({ id: "z-cam", name: "Cameras", builtin: false });
      Object.assign(s.networks.find((n) => n.id === "cams")!, { zoneId: "z-cam", internetAccess: false });
      s.policies.push(policy("p", "Allow RTSP", "allow", "internal", "z-cam", { src: "lan", protocol: "tcp", port: 554 }));
    });
    expect(r.fails.length).toBe(1);
  });
  it("mdns-cast: needs both the reflector and a firewall allow", () => {
    const reflectorOnly = solve("mdns-cast", (s) => (s.mdns = { enabled: true, networkIds: ["lan", "iot"] }));
    expect(reflectorOnly.fails.length).toBe(2); // 見つかるが接続できない
    const r = solve("mdns-cast", (s) => {
      s.mdns = { enabled: true, networkIds: ["lan", "iot"] };
      s.policies.push(policy("p", "Allow LAN to IoT", "allow", "internal", "iot", { src: "lan" }));
    });
    expect(r.fails).toEqual([]);
  });
  it("ap-groups: guest only on the meeting room AP, staff on all APs", () => {
    const r = solve("ap-groups", (s) => {
      s.ssids.find((w) => w.id === "guest")!.apIds = ["ap2"];
      s.ssids.find((w) => w.id === "staff")!.apIds = undefined;
    });
    expect(r.fails).toEqual([]);
  });
  it("ha-only: narrow the source to the Home Assistant device", () => {
    expect(solve("ha-only", (s) => (s.policies[0].src = "client:ha")).fails).toEqual([]);
  });
  it("final", () => {
    const r = solve("final", (s) => {
      s.networks.find((n) => n.id === "iot")!.dhcp.enabled = true;
      s.ssids.find((w) => w.id === "guest")!.networkId = "guest";
      client(s, "guest-phone").lease = null; // SSID のネットワーク変更で再接続
      port(s, "sw1", 8).taggedNetworkIds = ["iot", "guest"];
      s.policies.reverse();
    });
    expect(r.fails).toEqual([]);
  });
});
