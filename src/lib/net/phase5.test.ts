import { describe, expect, it } from "vitest";
import { buildCapture } from "../capture";
import { parseUrl, probe } from "../emu";
import { browserPackets } from "../pc-packets";
import { policy } from "../scenarios/builders";
import { defaultScenario } from "../scenarios/default";
import { formatIpv6, ipv6Gateway, lanIpv6Prefix, parseIpv6 } from "./ipv6";
import { APP_SIGNATURES, DEFAULT_SECURITY, THREAT } from "./security";
import { ipv6ClientState, resolveClient, trace } from "./simulate";

const web = { method: "GET", path: "/", status: "200 OK" } as const;
const wanQuery = { srcId: "pc", dst: "internet", protocol: "icmp", port: null, family: "ipv6" } as const;

function dualStack() {
  const s = defaultScenario();
  s.networks[0].ipv6Prefix = "2001:db8:1::/64";
  s.networks[1].ipv6Prefix = "2001:db8:30::/64";
  s.ipv6Wan = true;
  return s;
}

describe("Security and content filtering", () => {
  it("detects in IDS mode, then rejects the same hostname and literal addresses in IPS mode", () => {
    const s = dualStack();
    s.security = { ...DEFAULT_SECURITY, intrusion: "ids" };
    expect(probe(s, "pc", THREAT.host, "tcp", 443)).toMatchObject({ status: "ok", security: [{ layer: "IDS", action: "detect" }] });
    s.security.intrusion = "ips";
    for (const host of [THREAT.host, THREAT.ip, THREAT.ipv6]) {
      expect(probe(s, "pc", host, "tcp", 443)).toMatchObject({ status: "timeout", security: [{ layer: "IPS", action: "block" }] });
    }
  });

  it("matches only the configured domains or their subdomains and stops DNS before TCP", () => {
    const s = dualStack();
    s.security = { ...DEFAULT_SECURITY, sites: ["blocked.example.test"], dns: ["filtered.example.test"] };
    expect(probe(s, "pc", "sub.BLOCKED.example.test.", "tcp", 443)).toMatchObject({ status: "timeout", security: [{ layer: "サイト" }] });
    expect(probe(s, "pc", "blocked.example.test", "tcp", 8080).status).toBe("timeout");
    expect(probe(s, "pc", "unblocked.example.test", "tcp", 443).status).toBe("ok");
    expect(probe(s, "pc", "sub.filtered.example.test", "tcp", 443, "ipv6")).toMatchObject({ status: "dns", security: [{ layer: "DNS" }] });
    const packets = browserPackets(s, "pc", "https://filtered.example.test", web, true, "ipv6");
    expect(packets.map((packet) => packet.protocol)).toEqual(["DNS", "DNS"]);
    expect(packets.map((packet) => packet.summary)).toEqual(["AAAA 問い合わせ · filtered.example.test", "REFUSED · filtered.example.test"]);
  });

  it("blocks application signatures by host or address without blocking unrelated applications", () => {
    const s = dualStack();
    s.security = { ...DEFAULT_SECURITY, apps: ["streaming"] };
    expect(probe(s, "pc", APP_SIGNATURES.streaming.host, "tcp", 443)).toMatchObject({ status: "timeout", security: [{ layer: "アプリ" }] });
    expect(probe(s, "pc", APP_SIGNATURES.streaming.ipv6, "udp", 443)).toMatchObject({ status: "timeout", security: [{ layer: "アプリ" }] });
    expect(probe(s, "pc", APP_SIGNATURES.social.host, "tcp", 443).status).toBe("ok");
  });
});

describe("IPv6 dual stack", () => {
  it("parses IPv6 and brackets bare literals in URLs", () => {
    expect(formatIpv6(parseIpv6("2001:0db8:0:0:0:0:0000:11")!)).toBe("2001:db8::11");
    expect(formatIpv6(parseIpv6("::ffff:192.0.2.1")!)).toBe("::ffff:c000:201");
    expect(parseIpv6("2001::db8::1")).toBeNull();
    expect(lanIpv6Prefix("fe80::/64")).toBeNull();
    expect(lanIpv6Prefix("2001:db8::/56")).toBeNull();
    expect(parseUrl("2001:db8::11")).toMatchObject({ host: "2001:db8::11", display: "http://[2001:db8::11]" });
  });

  it("uses SLAAC independently of DHCPv4 and preserves the source address at the WAN", () => {
    const s = dualStack();
    s.networks[0].dhcp.enabled = false;
    const state = resolveClient(s, "pc");
    expect(state.ip).toBeUndefined();
    const ipv6 = ipv6ClientState(state);
    expect(ipv6.ip).toMatch(/^2001:db8:1:/);
    expect(probe(s, "pc", ipv6Gateway(s.networks[0])!, "icmp", null).status).toBe("ok");
    const result = trace(s, wanQuery);
    expect(result).toMatchObject({ ok: true, route: { kind: "wan", family: "ipv6" } });
    const frames = buildCapture(s, wanQuery, result);
    expect(frames[0]).toMatchObject({ kind: "neighbor-solicitation", protocol: "ICMPv6", ethDst: "33:33:ff:00:00:01" });
    expect(frames.find((frame) => frame.medium === "wan")).toMatchObject({ ipSrc: ipv6.ip, ttl: 63 });
    s.ipv6Wan = false;
    expect(trace(s, wanQuery).ok).toBe(false);
  });

  it("applies IPv6 CIDR policy objects and respects VLAN isolation", () => {
    const s = dualStack();
    const query = { ...wanQuery, dst: "plug" };
    expect(trace(s, query).ok).toBe(true);
    s.objects = [{ id: "ipv6-iot", name: "IPv6 IoT", kind: "ips", values: ["2001:db8:30::/64"] }];
    s.policies.unshift(policy("ipv6-block", "IPv6 block", "block", "internal", "iot", { dst: "group:ipv6-iot" }));
    expect(trace(s, query).ok).toBe(false);
    expect(trace(s, { ...query, family: "ipv4" }).ok).toBe(true);
    s.policies.shift();
    s.networks[1].isolateNetwork = true;
    expect(trace(s, query).ok).toBe(false);
  });
});
