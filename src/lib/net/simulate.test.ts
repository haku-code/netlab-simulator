import { describe, expect, it } from "vitest";
import { LESSONS, runChecks } from "../lessons";
import { policy } from "../scenarios/builders";
import { defaultScenario } from "../scenarios/default";
import { inSubnet, overlaps, parseCidr, parseIp } from "./ip";
import { resolveClient, trace, zoneDefault } from "./simulate";
import { validate } from "./validate";

const t = (s: ReturnType<typeof defaultScenario>, srcId: string, dst: string, protocol: "icmp" | "tcp" = "icmp", port: number | null = null) =>
  trace(s, { srcId, dst, protocol, port });

describe("ip", () => {
  it("parses CIDR and membership", () => {
    const sn = parseCidr("192.168.1.0/24")!;
    expect(inSubnet(parseIp("192.168.1.42")!, sn)).toBe(true);
    expect(inSubnet(parseIp("192.168.2.1")!, sn)).toBe(false);
    expect(parseCidr("10.0.0.0/33")).toBeNull();
    expect(parseIp("256.1.1.1")).toBeNull();
  });
  it("detects overlap", () => {
    expect(overlaps(parseCidr("10.0.0.0/16")!, parseCidr("10.0.5.0/24")!)).toBe(true);
    expect(overlaps(parseCidr("10.0.0.0/24")!, parseCidr("10.0.1.0/24")!)).toBe(false);
  });
});

describe("simulate (default scenario)", () => {
  const s = defaultScenario();

  it("assigns DHCP and static IPs", () => {
    expect(resolveClient(s, "pc").ip).toBe("192.168.1.6");
    expect(resolveClient(s, "nas").ip).toBe("192.168.1.5");
    expect(resolveClient(s, "plug").ip).toBe("192.168.30.6");
  });
  it("same VLAN reaches over L2", () => {
    expect(t(s, "pc", "nas").ok).toBe(true);
    expect(t(s, "iphone", "pc").ok).toBe(true);
  });
  it("custom zone blocks IoT → Internal; policy allows Default → IoT", () => {
    expect(t(s, "plug", "pc").ok).toBe(false);
    expect(t(s, "pc", "plug").ok).toBe(true);
  });
  it("hotspot is blocked from internal but has internet", () => {
    expect(t(s, "guest-phone", "pc").ok).toBe(false);
    expect(t(s, "guest-phone", "internet").ok).toBe(true);
  });
  it("zone defaults", () => {
    expect(zoneDefault("internal", "internal")).toBe("allow");
    expect(zoneDefault("hotspot", "internal")).toBe("block");
    expect(zoneDefault("iot", "external")).toBe("allow");
    expect(zoneDefault("internal", "iot")).toBe("block");
  });
  it("Custom tagged VLANs missing a network blocks", () => {
    const s2 = defaultScenario();
    const p = s2.devices.find((d) => d.id === "sw1")!.ports[7];
    p.tagged = "custom";
    p.taggedNetworkIds = ["iot"];
    const r = t(s2, "guest-phone", "internet");
    expect(r.ok).toBe(false);
    expect(r.failLinkIds.length).toBe(1);
  });
  it("client device isolation blocks same-SSID clients", () => {
    const s2 = defaultScenario();
    s2.clients.push({ ...s2.clients.find((c) => c.id === "guest-phone")!, id: "g2", name: "G2" });
    expect(t(s2, "guest-phone", "g2").ok).toBe(false);
  });
  it("isolate network blocks inter-network even with allow policy", () => {
    const s2 = defaultScenario();
    s2.networks.find((n) => n.id === "iot")!.isolateNetwork = true;
    expect(t(s2, "pc", "plug").ok).toBe(false);
    expect(t(s2, "plug", "internet").ok).toBe(true);
  });
  it("first matching policy wins", () => {
    const s2 = defaultScenario();
    s2.policies.unshift(policy("x", "allow 80", "allow", "iot", "internal", { protocol: "tcp", port: 80 }));
    expect(t(s2, "plug", "pc", "tcp", 80).ok).toBe(true);
    expect(t(s2, "plug", "pc", "tcp", 22).ok).toBe(false);
  });
  it("reuses precomputed endpoint states without changing trace results", () => {
    const s2 = defaultScenario();
    const states = new Map(s2.clients.map((c) => [c.id, resolveClient(s2, c.id)]));
    for (const src of s2.clients) {
      for (const dst of [...s2.clients.map((c) => c.id), "internet"]) {
        const query = { srcId: src.id, dst, protocol: "tcp", port: 443 } as const;
        expect(trace(s2, query, states)).toEqual(trace(s2, query));
      }
    }
  });
  it("default scenario has no errors", () => {
    expect(validate(s).filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("lessons", () => {
  for (const lesson of LESSONS) {
    it(`${lesson.id}: initial state fails at least one check`, () => {
      expect(runChecks(lesson, lesson.scenario()).some((x) => !x.passed)).toBe(true);
    });
  }
  const failures = (id: string, fix: (s: ReturnType<(typeof LESSONS)[number]["scenario"]>) => void) => {
    const l = LESSONS.find((x) => x.id === id)!;
    const s = l.scenario();
    fix(s);
    return runChecks(l, s)
      .filter((x) => !x.passed)
      .map((x) => `${x.check.label}: ${x.result.summary}`);
  };

  it("home-lan solved", () => {
    expect(
      failures("home-lan", (s) => {
        s.networks[0].dhcp = { enabled: true, start: "192.168.1.6", end: "192.168.1.254" };
        s.ssids[0].networkId = "lan";
      }),
    ).toEqual([]);
  });
  it("guest-wifi solved with hotspot zone + client isolation", () => {
    expect(
      failures("guest-wifi", (s) => {
        s.networks.push({ id: "g", name: "Guest", vlanId: 20, cidr: "192.168.20.0/24", gatewayIp: "192.168.20.1", dhcp: { enabled: true, start: "192.168.20.6", end: "192.168.20.254" }, isolateNetwork: false, internetAccess: true, zoneId: "hotspot" });
        const g = s.ssids.find((x) => x.id === "guest")!;
        g.networkId = "g";
        g.clientIsolation = true;
      }),
    ).toEqual([]);
  });
  it("iot-vlan solved with custom zone + allow policy", () => {
    expect(
      failures("iot-vlan", (s) => {
        s.zones.push({ id: "z-iot", name: "IoT", builtin: false });
        s.networks.find((n) => n.id === "iot")!.zoneId = "z-iot";
        s.policies.push(policy("a", "Allow LAN to IoT", "allow", "internal", "z-iot"));
      }),
    ).toEqual([]);
  });
  it("trunk-fix solved by fixing tags", () => {
    expect(
      failures("trunk-fix", (s) => {
        const sw1 = s.devices.find((d) => d.id === "sw1")!;
        const sw2 = s.devices.find((d) => d.id === "sw2")!;
        sw1.ports[7].taggedNetworkIds = ["staff", "guest"];
        Object.assign(sw2.ports[0], { nativeNetworkId: "lan", tagged: "custom", taggedNetworkIds: ["staff"] });
      }),
    ).toEqual([]);
  });
  it("rule-order solved by moving blocks below allows", () => {
    expect(
      failures("rule-order", (s) => {
        const [bl, ipp, bw, https] = s.policies;
        s.policies = [ipp, https, bl, bw];
      }),
    ).toEqual([]);
  });
});
