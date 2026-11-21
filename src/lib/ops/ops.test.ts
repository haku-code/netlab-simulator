import { describe, expect, it } from "vitest";
import type { Scenario } from "../model";
import { assignLeases, resolveClient, trace } from "../net/simulate";
import { link, makeDevice, policy, setPort, trunk } from "../scenarios/builders";
import { defaultScenario } from "../scenarios/default";
import { backupFileName, makeBackup, parseBackup } from "./backup";
import { compareVersion, diffEvents, FACTORY_FIRMWARE, hasUpdate, LATEST_FIRMWARE, snapshot, summarize, traceBlockEvent } from "./events";

const base = () => assignLeases(defaultScenario());
const change = (fn: (s: Scenario) => void) => {
  const prev = base();
  const next = structuredClone(prev);
  fn(next);
  assignLeases(next);
  return diffEvents(snapshot(prev), snapshot(next), next);
};

describe("event log", () => {
  it("reports nothing when nothing changed", () => {
    expect(change(() => {})).toEqual([]);
  });

  it("logs client disconnects and reconnects", () => {
    const ev = change((s) => {
      const pc = s.clients.find((c) => c.id === "pc")!;
      pc.connection = { type: "wired", deviceId: null, portId: null };
    });
    expect(ev).toContainEqual(expect.objectContaining({ category: "client", severity: "warning", targetId: "pc" }));
    expect(ev[0].message).toMatch(/切断/);
  });

  it("logs a device going offline as critical", () => {
    const ev = change((s) => (s.links = s.links.filter((l) => !l.id.includes("ap1"))));
    expect(ev).toContainEqual(expect.objectContaining({ category: "device", severity: "critical", targetId: "ap1" }));
  });

  it("logs Wi-Fi roaming between APs", () => {
    const prev = base();
    const ap2 = setPort(makeDevice("ap", "ap2", "Bedroom AP"), 1, trunk("lan", "all"));
    prev.devices.push(ap2);
    prev.links.push(link(prev.devices.find((d) => d.id === "sw1")!, 5, ap2, 1));
    assignLeases(prev);
    const next = structuredClone(prev);
    const iphone = next.clients.find((c) => c.id === "iphone")!;
    if (iphone.connection.type === "wifi") iphone.connection.apId = "ap2";
    assignLeases(next);
    expect(resolveClient(next, "iphone").attachDeviceId).toBe("ap2");
    const ev = diffEvents(snapshot(prev), snapshot(next), next);
    expect(ev).toContainEqual(expect.objectContaining({ category: "wifi", message: expect.stringMatching(/ローミング.*Living Room AP → Bedroom AP/) }));
  });

  it("logs firewall blocks of internet traffic", () => {
    const ev = change((s) => s.policies.unshift(policy("deny-pc", "PC のインターネットを拒否", "block", "internal", "external", { src: "client:pc" })));
    expect(ev).toContainEqual(expect.objectContaining({ category: "security", message: expect.stringMatching(/Policy「PC のインターネットを拒否」がブロック/) }));
  });

  it("logs loops blocked by STP and broadcast storms", () => {
    const loop = (stp: boolean) =>
      change((s) => {
        const sw = s.devices.find((d) => d.id === "sw1")!;
        const sw2 = setPort(makeDevice("switch", "sw2", "Desk Switch"), 1, trunk("lan", "all"));
        setPort(sw2, 2, trunk("lan", "all"));
        s.devices.push(sw2);
        setPort(sw, 5, trunk("lan", "all"));
        s.links.push(link(sw, 5, sw2, 1), link(sw, 6, sw2, 2));
        s.clients = s.clients.filter((c) => c.connection.type !== "wired" || c.connection.portId !== sw.ports[5].id);
        if (!stp) for (const d of s.devices) if (d.type === "switch") d.stp = { enabled: false, priority: 32768 };
      });
    expect(loop(true)).toContainEqual(expect.objectContaining({ category: "switching", message: expect.stringMatching(/STP がポートをブロック/) }));
    expect(loop(false)).toContainEqual(expect.objectContaining({ category: "switching", severity: "critical", message: expect.stringMatching(/ブロードキャストストーム/) }));
  });

  it("collapses very large changes into one summary", () => {
    const drafts = Array.from({ length: 20 }, (_, i) => ({ category: "client" as const, severity: "info" as const, message: `x${i}` }));
    expect(summarize(drafts)).toHaveLength(1);
  });

  it("turns a blocked packet trace into a security event", () => {
    const s = base();
    s.policies.unshift(policy("deny", "IoT を拒否", "block", "internal", "iot"));
    const r = trace(s, { srcId: "pc", dst: "plug", protocol: "icmp", port: null });
    expect(traceBlockEvent(s, "pc", "plug", r)?.message).toMatch(/Desktop PC → Smart Plug.*Policy「IoT を拒否」/);
    const ok = trace(s, { srcId: "pc", dst: "nas", protocol: "icmp", port: null });
    expect(traceBlockEvent(s, "pc", "nas", ok)).toBeNull();
  });
});

describe("adoption and firmware", () => {
  it("pending devices do not join the network until adopted", () => {
    const s = base();
    s.devices.find((d) => d.id === "ap1")!.state = "pending";
    assignLeases(s);
    expect(resolveClient(s, "iphone").error).toMatch(/承認待ち/);
    delete s.devices.find((d) => d.id === "ap1")!.state;
    assignLeases(s);
    expect(resolveClient(s, "iphone").error).toBeUndefined();
  });

  it("an upgrading switch reboots and drops its clients", () => {
    const s = base();
    s.devices.find((d) => d.id === "sw1")!.state = "upgrading";
    assignLeases(s);
    expect(trace(s, { srcId: "pc", dst: "internet", protocol: "icmp", port: null }).ok).toBe(false);
  });

  it("logs adoption and upgrade completion", () => {
    const prev = base();
    prev.devices[1].state = "upgrading";
    prev.devices[1].firmware = FACTORY_FIRMWARE.switch;
    const next = structuredClone(prev);
    delete next.devices[1].state;
    next.devices[1].firmware = LATEST_FIRMWARE.switch;
    expect(diffEvents(snapshot(prev), snapshot(next), next)).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/ファームウェアを 7\.1\.26 に更新/) }));
  });

  it("compares versions numerically", () => {
    expect(compareVersion("6.6.65", "7.1.26")).toBeLessThan(0);
    expect(compareVersion("7.10.0", "7.9.9")).toBeGreaterThan(0);
    const d = makeDevice("switch", "x", "X");
    expect(hasUpdate(d)).toBe(false);
    d.firmware = FACTORY_FIRMWARE.switch;
    expect(hasUpdate(d)).toBe(true);
    d.state = "upgrading";
    expect(hasUpdate(d)).toBe(false);
  });
});

describe("backup and restore", () => {
  it("round-trips a scenario without DHCP leases", () => {
    const s = base();
    const b = makeBackup("Home", s, new Date("2026-11-21T10:30:00Z"));
    const parsed = parseBackup(JSON.stringify(b));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.scenario.devices).toHaveLength(s.devices.length);
    expect(parsed.backup.scenario.clients.every((c) => c.lease === null)).toBe(true);
    expect(s.clients.some((c) => c.lease)).toBe(true);
    expect(backupFileName(b)).toBe("netlab-Home-202611211030.json");
  });

  it("rejects broken files with a reason", () => {
    expect(parseBackup("{")).toEqual({ ok: false, reason: expect.stringMatching(/JSON/) });
    expect(parseBackup(JSON.stringify({ format: "other" }))).toEqual({ ok: false, reason: expect.stringMatching(/NetLab/) });
    const b = makeBackup("Home", base());
    (b.scenario as Partial<Scenario>).links = undefined;
    expect(parseBackup(JSON.stringify(b))).toEqual({ ok: false, reason: expect.stringMatching(/links/) });
    const future = { ...makeBackup("Home", base()), version: 99 };
    expect(parseBackup(JSON.stringify(future)).ok).toBe(false);
  });
});
