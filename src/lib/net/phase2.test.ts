import { describe, expect, it } from "vitest";
import { buildCapture } from "../capture";
import { probe, speedTest } from "../emu";
import type { PortForward } from "../model";
import { policy } from "../scenarios/builders";
import { defaultScenario } from "../scenarios/default";
import { assignLeases, trace, type TraceQuery } from "./simulate";
import { chooseWan, INTERNET_IP, WAN_IPS, wanSettings } from "./gateway";

const fresh = () => assignLeases(defaultScenario());
const outgoing: TraceQuery = { srcId: "pc", dst: "internet", protocol: "tcp", port: 443 };
const incoming: TraceQuery = { srcId: "internet", dst: "wan1", protocol: "tcp", port: 8080 };
const routeTo = (dstIp: string): TraceQuery => ({ ...outgoing, dstIp });
const webForward = (): PortForward => ({
  id: "web", name: "Web", wan: "wan1", protocol: "tcp", publicPort: 8080, targetIp: "192.168.1.240", targetPort: 80, enabled: true,
});

describe("gateway configuration", () => {
  it("translates inbound IP and port, requires a listening service, and honors explicit policy", () => {
    const s = fresh();
    expect(trace(s, incoming).summary).toContain("一致するポートフォワードがありません");
    s.portForwards = [webForward()];
    const provisioned = trace(s, incoming);
    expect(provisioned.ok).toBe(true);
    expect(trace(s, { ...incoming, protocol: "udp" }).ok).toBe(false);
    expect(trace(s, { ...incoming, port: 8081 }).ok).toBe(false);
    const frames = buildCapture(s, incoming, provisioned);
    expect(frames[0]).toMatchObject({ ipDst: WAN_IPS.wan1, dstPort: 8080, medium: "wan" });
    expect(frames.at(-1)).toMatchObject({ ipDst: "192.168.1.240", dstPort: 80, ttl: 63 });
    s.portForwards[0].targetPort = 22;
    expect(trace(s, incoming).summary).toContain("受け付けていません");
    s.portForwards[0].targetPort = 80;
    s.policies.unshift(policy("b", "Block Web", "block", "external", "internal", { protocol: "tcp", port: 80 }));
    expect(trace(s, incoming).summary).toContain("Block Web");
  });

  it("uses WAN2 for new outbound traffic when WAN1 stops, and keeps forwards tied to their own WAN", () => {
    const s = fresh();
    s.portForwards = [webForward()];
    expect(trace(s, outgoing).route).toMatchObject({ kind: "wan", wan: "wan1" });
    s.wan = structuredClone(wanSettings(s));
    s.wan.links.wan1.online = false;
    s.wan.links.wan2.online = true;
    expect(trace(s, incoming).summary).toContain("WAN1 は接続されていません");
    expect(trace(s, { ...incoming, dst: "wan2" }).summary).toContain("一致するポートフォワードがありません");
    const outbound = trace(s, outgoing);
    expect(outbound.route).toMatchObject({ kind: "wan", wan: "wan2" });
    expect(buildCapture(s, outgoing, outbound).at(-1)?.ipSrc).toBe(WAN_IPS.wan2);
    expect(speedTest(s, "pc")).toMatchObject({ ok: true, wan: "wan2", downloadMbps: 200 });
    s.wan.links.wan2.online = false;
    expect(trace(s, outgoing).ok).toBe(false);
  });

  it("balances connections stably across available WAN links", () => {
    const s = fresh();
    s.wan = structuredClone(wanSettings(s));
    s.wan.mode = "balance";
    s.wan.links.wan2.online = true;
    const flows = Array.from({ length: 10 }, (_, i) => `pc:${INTERNET_IP}:tcp:${443 + i}`);
    const selected = flows.map((flow) => chooseWan(s, flow));
    expect(new Set(selected)).toEqual(new Set(["wan1", "wan2"]));
    expect(flows.map((flow) => chooseWan(s, flow))).toEqual(selected);
  });

  it("selects the longest static prefix before metric, ARPs for the next hop, and fails if that hop disappears", () => {
    const s = fresh();
    s.staticRoutes = [
      { id: "default", name: "既定", cidr: "0.0.0.0/0", nextHop: "192.168.1.5", metric: 1, enabled: true },
      { id: "slow", name: "予備", cidr: "10.20.0.0/24", nextHop: "192.168.1.240", metric: 20, enabled: true },
      { id: "fast", name: "主経路", cidr: "10.20.0.0/24", nextHop: "192.168.1.5", metric: 10, enabled: true },
    ];
    const q = routeTo("10.20.0.13");
    const result = trace(s, q);
    expect(result).toMatchObject({ ok: true, route: { kind: "static", nextHopId: "nas" } });
    expect(result.hops.some((h) => h.title.includes("主経路"))).toBe(true);
    expect(probe(s, "pc", q.dstIp!, "icmp", null).status).toBe("ok");
    expect(trace(s, routeTo("192.168.1.5")).route).toBeUndefined();
    const frames = buildCapture(s, q, result);
    expect(frames.some((f) => f.kind === "arp-request" && f.info.includes("192.168.1.5"))).toBe(true);
    expect(frames.at(-1)).toMatchObject({ ipSrc: "192.168.1.6", ipDst: q.dstIp, medium: "ethernet" });
    s.clients = s.clients.filter((c) => c.id !== "nas");
    expect(trace(s, q).summary).toContain("次ホップに到達できません");
  });

  it("encapsulates traffic for the VPN peer, evaluates the VPN zone, and models a stopped peer", () => {
    const s = fresh();
    const q = routeTo("10.30.0.10");
    expect(trace(s, q).ok).toBe(false);
    s.vpnTunnels = [{ id: "site", name: "拠点", remoteCidr: "10.30.0.0/24", endpoint: "192.0.2.42", enabled: true, peerOnline: true }];
    const result = trace(s, q);
    expect(result).toMatchObject({ ok: true, route: { kind: "vpn", wan: "wan1" } });
    expect(buildCapture(s, q, result).at(-1)).toMatchObject({ protocol: "UDP", dstPort: 51820, ipDst: "192.0.2.42" });
    expect(trace(s, outgoing).route?.kind).toBe("wan"); // スプリットトンネル
    s.policies.unshift(policy("b", "Block VPN", "block", "internal", "vpn"));
    expect(trace(s, q).summary).toContain("拒否");
    s.vpnTunnels[0].peerOnline = false;
    expect(trace(s, q).summary).toContain("対向が応答しません");
  });

  it("applies QoS priority under congestion and preserves upload/download caps", () => {
    const s = fresh();
    s.wan = structuredClone(wanSettings(s));
    s.wan.links.wan1.backgroundFlows = 4;
    expect(speedTest(s, "pc")).toMatchObject({ ok: true, priority: "normal", downloadMbps: 100, uploadMbps: 20 });
    s.qos = [{ clientId: "pc", priority: "high" }];
    expect(speedTest(s, "pc")).toMatchObject({ ok: true, priority: "high", downloadMbps: 167, uploadMbps: 33 });
    s.qos[0].downloadLimit = 75;
    s.qos[0].uploadLimit = 15;
    expect(speedTest(s, "pc")).toMatchObject({ ok: true, downloadMbps: 75, uploadMbps: 15 });
    expect(trace(s, outgoing).hops.some((h) => h.title === "QoS · 優先度 高")).toBe(true);
  });
});
