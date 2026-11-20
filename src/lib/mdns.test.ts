import { describe, expect, it } from "vitest";
import { CAST_TYPES, discover } from "./mdns";
import { assignLeases, trace } from "./net/simulate";
import { validate } from "./net/validate";
import { policy } from "./scenarios/builders";
import { defaultScenario } from "./scenarios/default";

const fresh = () => assignLeases(defaultScenario());
const seen = (s: ReturnType<typeof fresh>, src: string, dst: string) => discover(s, src, CAST_TYPES).some((d) => d.client.id === dst && d.visible);

describe("mDNS", () => {
  it("does not cross VLANs without the reflector", () => {
    const s = fresh(); // iPhone は Default、Smart TV は IoT
    expect(seen(s, "iphone", "tv")).toBe(false);
    s.mdns = { enabled: true, networkIds: ["lan", "iot"] };
    expect(seen(s, "iphone", "tv")).toBe(true);
  });
  it("is visible within the same VLAN", () => {
    const s = fresh();
    const tv = s.clients.find((c) => c.id === "tv")!;
    tv.connection = { type: "wifi", apId: "ap1", ssidId: "home" };
    tv.wpa3 = true;
    tv.lease = null;
    assignLeases(s);
    expect(seen(s, "iphone", "tv")).toBe(true);
  });
  it("reflector must include both networks", () => {
    const s = fresh();
    s.mdns = { enabled: true, networkIds: ["lan"] };
    expect(seen(s, "iphone", "tv")).toBe(false);
  });
});

describe("device-level policies", () => {
  it("matches only the named device", () => {
    const s = fresh();
    s.policies = [policy("p", "NAS only", "allow", "internal", "iot", { src: "client:nas" })];
    expect(trace(s, { srcId: "nas", dst: "plug", protocol: "icmp", port: null }).ok).toBe(true);
    expect(trace(s, { srcId: "pc", dst: "plug", protocol: "icmp", port: null }).ok).toBe(false);
  });
  it("device as destination", () => {
    const s = fresh();
    s.policies = [policy("p", "to plug", "allow", "internal", "iot", { dst: "client:plug" })];
    expect(trace(s, { srcId: "pc", dst: "plug", protocol: "icmp", port: null }).ok).toBe(true);
    expect(trace(s, { srcId: "pc", dst: "tv", protocol: "icmp", port: null }).ok).toBe(false);
  });
  it("a network-wide rule above shadows a device rule", () => {
    const s = fresh();
    s.policies = [
      policy("a", "Block LAN to IoT", "block", "internal", "iot", { src: "lan" }),
      policy("b", "Allow NAS to IoT", "allow", "internal", "iot", { src: "client:nas" }),
    ];
    expect(validate(s).some((i) => i.targetId === "b" && /覆われ/.test(i.message))).toBe(true);
  });
});

describe("broadcasting APs", () => {
  it("a client cannot join an SSID its AP does not broadcast", () => {
    const s = fresh();
    s.ssids.find((w) => w.id === "guest")!.apIds = [];
    expect(trace(s, { srcId: "guest-phone", dst: "internet", protocol: "icmp", port: null }).ok).toBe(false);
    expect(validate(s).some((i) => /どの AP からも配信されていません/.test(i.message))).toBe(true);
  });
});
