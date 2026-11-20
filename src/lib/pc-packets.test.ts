import { describe, expect, it, vi } from "vitest";
import { usePcCapture } from "./pc-capture";
import { browserPackets, pingPackets, type PcPacket } from "./pc-packets";
import { assignLeases } from "./net/simulate";
import { defaultScenario } from "./scenarios/default";

const page = { method: "GET", path: "/", status: "200 OK" } as const;
const login = { method: "POST", path: "/login", status: "200 OK" } as const;

describe("PC packet analyzer", () => {
  it("records DNS, a TCP exchange, and distinct HTTP request and response frames", () => {
    const packets = browserPackets(assignLeases(defaultScenario()), "pc", "http://web.test", page);
    expect(packets.map((p) => p.protocol)).toEqual(["DNS", "DNS", "TCP", "TCP", "TCP", "HTTP", "HTTP"]);
    expect(packets.at(-2)).toMatchObject({ destinationPort: 80, sample: "GET /" });
    expect(packets.at(-1)).toMatchObject({ sourcePort: 80, sample: "HTTP/1.1 200 OK" });
  });

  it("keeps HTTPS opaque and reports certificate failure without application data", () => {
    const s = assignLeases(defaultScenario());
    const address = "https://forum.test";
    const followUp = browserPackets(s, "pc", address, login, false);
    expect(followUp).toHaveLength(2);
    expect(followUp.every((p) => p.protocol === "TLS" && p.sample === undefined)).toBe(true);

    s.clients.find((c) => c.id === "web-forum")!.webService!.tls = "expired";
    const failed = browserPackets(s, "pc", address, page);
    expect(failed.at(-1)?.summary).toContain("証明書検証失敗");
    expect(failed.some((p) => p.summary.includes("Application Data"))).toBe(false);
  });

  it("records replies only for reachable ping targets", () => {
    const s = assignLeases(defaultScenario());
    expect(pingPackets(s, "pc", "192.168.1.5")).toHaveLength(8);
    const blocked = pingPackets(s, "plug", "192.168.1.5");
    expect(blocked).toHaveLength(4);
    expect(blocked.every((p) => p.summary.includes("Echo Request"))).toBe(true);
  });

  it("records only for the enabled PC and freezes packet numbering on stop", () => {
    const { start, stop, record } = usePcCapture.getState();
    const make = vi.fn(() => [{ protocol: "TCP", source: "192.168.1.2", destination: "192.168.1.3", summary: "SYN" }] satisfies PcPacket[]);
    start("pc-capture-test");
    record("different-pc", make);
    record("pc-capture-test", make);
    stop("pc-capture-test");
    record("pc-capture-test", make);
    expect(make).toHaveBeenCalledTimes(1);
    const session = usePcCapture.getState().sessions["pc-capture-test"];
    expect(session.running).toBe(false);
    expect(session.frames.map((f) => f.no)).toEqual([1]);
  });

  it("observes an iPhone on the selected SSID without leaking protected headers or payloads", () => {
    const s = assignLeases(defaultScenario());
    const { start, stop, record } = usePcCapture.getState();
    const generate = () => browserPackets(s, "iphone", "http://web.test", page);
    start("home-monitor", "home");
    start("guest-monitor", "guest");
    record("iphone", generate, s);
    const first = usePcCapture.getState().sessions["home-monitor"].frames;
    expect(first).toHaveLength(7);
    expect(first[0]).toMatchObject({ protocol: "802.11", radio: { ssid: "Home", station: "iPhone", visibility: "protected" } });
    expect(first[0].source).toBe(s.clients.find((c) => c.id === "iphone")!.mac);
    expect(first.every((f) => !f.sample && !f.sourcePort && !f.destinationPort)).toBe(true);
    expect(usePcCapture.getState().sessions["guest-monitor"].frames).toEqual([]);
    stop("home-monitor");
    stop("guest-monitor");
  });

  it("displays illustrative WEP HTTP frames and keeps the HTTPS payload encrypted", () => {
    const s = assignLeases(defaultScenario());
    s.ssids.find((w) => w.id === "home")!.security = "wep";
    const { start, stop, record } = usePcCapture.getState();
    start("legacy-monitor", "home");
    record("iphone", () => browserPackets(s, "iphone", "http://web.test", page), s);
    record("iphone", () => browserPackets(s, "iphone", "https://web.test", page), s);
    const frames = usePcCapture.getState().sessions["legacy-monitor"].frames;
    expect(frames.find((f) => f.protocol === "HTTP")).toMatchObject({ sample: "GET /", radio: { visibility: "legacy" } });
    expect(frames.filter((f) => f.summary.startsWith("Application Data"))).toHaveLength(2);
    expect(frames.filter((f) => f.protocol === "TLS").every((f) => !f.sample)).toBe(true);
    stop("legacy-monitor");
  });
});
