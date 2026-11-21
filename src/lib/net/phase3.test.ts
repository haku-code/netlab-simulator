import { describe, expect, it } from "vitest";
import type { Scenario } from "../model";
import { access, link, makeDevice, network, setPort, ssid, trunk, wifi, wired, zones } from "../scenarios/builders";
import { assignLeases, resolveClient, trace } from "./simulate";
import { switchingState } from "./switching";
import { validate } from "./validate";

/** GW — SW1 ⇄ SW2（2 本）。SW2 に PC、SW1 に NAS */
function twoSwitches(): Scenario {
  const gw = setPort(makeDevice("gateway", "gw", "Gateway"), 1, trunk("lan", "all"));
  const sw1 = makeDevice("switch", "sw1", "Core Switch");
  const sw2 = makeDevice("switch", "sw2", "Desk Switch");
  for (const sw of [sw1, sw2]) for (let i = 1; i <= 8; i++) setPort(sw, i, i <= 3 ? trunk("lan", "all") : access("lan"));
  return {
    networks: [network("lan", "Default", 1, 1)],
    zones: zones(),
    devices: [gw, sw1, sw2],
    links: [link(gw, 1, sw1, 1), link(sw1, 2, sw2, 2), link(sw1, 3, sw2, 3)],
    ssids: [],
    clients: [wired("pc", "PC", "pc", sw2, 5), wired("nas", "NAS", "server", sw1, 5, "192.168.1.5")],
    policies: [],
  };
}

const ping = (s: Scenario, a: string, b: string) => trace(s, { srcId: a, dst: b, protocol: "icmp", port: null });

describe("loop and STP", () => {
  it("blocks one of two parallel cables when STP is enabled (default)", () => {
    const s = assignLeases(twoSwitches());
    const st = switchingState(s);
    expect(st.blocked.size).toBe(1);
    expect(st.storm.size).toBe(0);
    expect(ping(s, "pc", "nas").ok).toBe(true);
    expect(ping(s, "pc", "internet").ok).toBe(true);
    // ブロックされるのはルートから遠い Desk Switch 側のポート
    const [, end] = [...st.blocked][0];
    expect(end.deviceId).toBe("sw2");
  });

  it("causes a broadcast storm when STP is disabled on both switches", () => {
    const s = twoSwitches();
    for (const d of s.devices) if (d.type === "switch") d.stp = { enabled: false, priority: 32768 };
    assignLeases(s);
    expect(switchingState(s).storm.has("sw1")).toBe(true);
    expect(resolveClient(s, "pc").error).toMatch(/ブロードキャストストーム/);
    expect(ping(s, "nas", "internet").summary + ping(s, "nas", "internet").hops.map((h) => h.detail).join()).toMatch(/ブロードキャストストーム/);
    expect(validate(s).some((i) => /ブロードキャストストーム/.test(i.message))).toBe(true);
  });

  it("one STP switch in the ring is enough to stop the loop", () => {
    const s = twoSwitches();
    s.devices.find((d) => d.id === "sw2")!.stp = { enabled: false, priority: 32768 };
    assignLeases(s);
    expect(switchingState(s).storm.size).toBe(0);
    expect(switchingState(s).blocked.size).toBe(1);
  });

  it("a lower bridge priority makes the switch the root bridge", () => {
    const s = twoSwitches();
    s.devices.find((d) => d.id === "sw2")!.stp = { enabled: true, priority: 4096 };
    assignLeases(s);
    const st = switchingState(s);
    expect(st.rootId).toBe("sw2");
    expect([...st.blocked.values()][0].deviceId).toBe("sw1");
  });

  it("a triangle of switches blocks exactly one link", () => {
    const s = twoSwitches();
    const sw3 = makeDevice("switch", "sw3", "Lab Switch");
    for (let i = 1; i <= 8; i++) setPort(sw3, i, trunk("lan", "all"));
    s.devices.push(sw3);
    const [sw1, sw2] = [s.devices[1], s.devices[2]];
    s.links = [link(s.devices[0], 1, sw1, 1), link(sw1, 2, sw2, 2), link(sw2, 4, sw3, 1), link(sw3, 2, sw1, 4)];
    assignLeases(s);
    expect(switchingState(s).blocked.size).toBe(1);
    expect(ping(s, "pc", "nas").ok).toBe(true);
  });

  it("disabling a port removes the loop", () => {
    const s = twoSwitches();
    s.devices[1].ports[2].enabled = false;
    assignLeases(s);
    expect(switchingState(s).blocked.size).toBe(0);
  });
});

describe("link aggregation", () => {
  it("bundles two cables into one logical link: no STP block, survives one cable failure", () => {
    const s = twoSwitches();
    for (const id of ["sw1", "sw2"]) {
      const d = s.devices.find((x) => x.id === id)!;
      d.ports[1].lag = 1;
      d.ports[2].lag = 1;
    }
    assignLeases(s);
    const st = switchingState(s);
    expect(st.blocked.size).toBe(0);
    expect(st.lagMembers.size).toBe(1);
    expect(ping(s, "pc", "nas").ok).toBe(true);
    // 1 本抜けても通信は続く
    s.links = s.links.filter((l) => !l.id.includes("sw1-2"));
    assignLeases(s);
    expect(ping(s, "pc", "nas").ok).toBe(true);
  });

  it("one-sided LAG is treated as separate cables and warned", () => {
    const s = twoSwitches();
    const d = s.devices.find((x) => x.id === "sw1")!;
    d.ports[1].lag = 1;
    d.ports[2].lag = 1;
    assignLeases(s);
    expect(switchingState(s).blocked.size).toBe(1);
    expect(validate(s).some((i) => /LAG/.test(i.message))).toBe(true);
  });

  it("LAG members follow the primary port's VLAN settings", () => {
    const s = twoSwitches();
    const d = s.devices.find((x) => x.id === "sw1")!;
    d.ports[1].lag = 1;
    d.ports[2].lag = 1;
    Object.assign(d.ports[1], access("lan"));
    assignLeases(s);
    expect(d.ports[2].tagged).toBe("none");
  });
});

describe("port profiles", () => {
  it("syncs every port that uses the profile, and follows profile edits", () => {
    const s = twoSwitches();
    s.networks.push(network("cam", "Camera", 40, 40));
    s.portProfiles = [{ id: "pp-cam", name: "Camera", nativeNetworkId: "cam", tagged: "none", taggedNetworkIds: [], poe: "auto" }];
    const sw1 = s.devices[1];
    sw1.ports[5].profileId = "pp-cam";
    sw1.ports[6].profileId = "pp-cam";
    assignLeases(s);
    expect(sw1.ports[5].nativeNetworkId).toBe("cam");
    expect(sw1.ports[6].nativeNetworkId).toBe("cam");
    s.portProfiles[0].nativeNetworkId = "lan";
    assignLeases(s);
    expect(sw1.ports[6].nativeNetworkId).toBe("lan");
  });

  it("drops references to deleted profiles", () => {
    const s = twoSwitches();
    s.devices[1].ports[5].profileId = "gone";
    assignLeases(s);
    expect(s.devices[1].ports[5].profileId).toBeUndefined();
  });
});

describe("PoE budget", () => {
  function poeSite(): Scenario {
    const gw = setPort(makeDevice("gateway", "gw", "Gateway"), 1, trunk("lan", "all"));
    const sw = makeDevice("switch", "sw1", "PoE Switch");
    sw.poeBudgetW = 30;
    setPort(sw, 1, trunk("lan", "all"));
    for (let i = 2; i <= 8; i++) setPort(sw, i, i <= 3 ? trunk("lan", "all") : access("lan"));
    const ap1 = setPort(makeDevice("ap", "ap1", "AP 1"), 1, trunk("lan", "all"));
    const ap2 = setPort(makeDevice("ap", "ap2", "AP 2"), 1, trunk("lan", "all"));
    const cam = { ...wired("cam", "Camera", "iot", sw, 4), poeW: 6 };
    return {
      networks: [network("lan", "Default", 1, 1)],
      zones: zones(),
      devices: [gw, sw, ap1, ap2],
      links: [link(gw, 1, sw, 1), link(sw, 2, ap1, 1), link(sw, 3, ap2, 1)],
      ssids: [ssid("home", "Home", "lan")],
      clients: [cam, wifi("phone", "Phone", "phone", ap1, "home"), wired("pc", "PC", "pc", sw, 5)],
      policies: [],
    };
  }

  it("allocates power by port order and stops when the budget runs out", () => {
    const s = assignLeases(poeSite());
    const ps = switchingState(s).poe.get("sw1")!;
    expect(ps.used).toBe(26);
    expect(ps.requested).toBe(32);
    expect(switchingState(s).unpoweredClients.has("cam")).toBe(true);
    expect(resolveClient(s, "cam").error).toMatch(/PoE/);
    expect(ping(s, "pc", "internet").ok).toBe(true);
    expect(validate(s).some((i) => /PoE の電力が足りず/.test(i.message))).toBe(true);
  });

  it("turning PoE off on a port powers off that AP and frees budget", () => {
    const s = poeSite();
    s.devices[1].ports[2].poe = "off";
    assignLeases(s);
    expect(switchingState(s).unpowered.has("ap2")).toBe(true);
    expect(switchingState(s).unpoweredClients.has("cam")).toBe(false);
    expect(resolveClient(s, "cam").error).toBeUndefined();
  });

  it("an unpowered AP drops its Wi-Fi clients", () => {
    const s = poeSite();
    s.devices[1].ports[1].poe = "off";
    assignLeases(s);
    expect(resolveClient(s, "phone").error).toMatch(/電源が入っていません/);
  });

  it("switches without a PoE budget assume external power", () => {
    const s = poeSite();
    delete s.devices[1].poeBudgetW;
    assignLeases(s);
    expect(switchingState(s).unpowered.size).toBe(0);
    expect(switchingState(s).unpoweredClients.size).toBe(0);
  });
});
