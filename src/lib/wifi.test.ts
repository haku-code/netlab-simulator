import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCapture } from "./capture";
import { probe } from "./emu";
import { autoFloor } from "./floor";
import { radioLink, resolveClient, trace, uplinkOf } from "./net/simulate";
import { makeDevice } from "./scenarios/builders";
import { defaultScenario } from "./scenarios/default";
import { savedWifiPassword } from "./wifi";

const entries = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  },
});

describe("Phase 4 Wi-Fi", () => {
  it("carries the guest VLAN over a two-hop mesh, while enforcing the root AP trunk", () => {
    const s = defaultScenario();
    const root = s.devices.find((d) => d.id === "ap1")!;
    const relay = { ...makeDevice("ap", "relay", "Relay AP"), meshParentId: root.id };
    const edge = { ...makeDevice("ap", "mesh-edge", "Edge AP"), meshParentId: relay.id };
    const guest = s.clients.find((c) => c.id === "guest-phone")!;
    guest.connection = { type: "wifi", apId: edge.id, ssidId: "guest" };
    s.devices.push(relay, edge);
    expect(uplinkOf(s, edge.id)).toMatchObject({ online: true, parentId: relay.id });
    expect(resolveClient(s, guest.id).ip).toMatch(/^192\.168\.50\./);
    const query = { srcId: guest.id, dst: "internet", protocol: "tcp" as const, port: 443 };
    const result = trace(s, query);
    expect(result.ok).toBe(true);
    expect(result.segments.filter(({ edge }) => edge.startsWith("mesh:")).map(({ edge, medium, vlan }) => [edge, medium, vlan]))
      .toEqual([["mesh:mesh-edge", "wifi", 50], ["mesh:relay", "wifi", 50]]);
    expect(buildCapture(s, query, result).filter((frame) => frame.wifi?.label === "メッシュバックホール")).toHaveLength(2);

    root.ports[0].tagged = "none";
    expect(resolveClient(s, guest.id).toGateway?.ok).toBe(false);
    root.ports[0].enabled = false;
    expect(uplinkOf(s, edge.id).online).toBe(false);
    relay.meshParentId = edge.id;
    expect(resolveClient(s, guest.id).errorStage).toBe("attach");
  });

  it("loses the mesh uplink when the parent is out of range", () => {
    const s = autoFloor(defaultScenario());
    const ap = { ...makeDevice("ap", "far-ap", "Far AP"), meshParentId: "ap1", pos: { x: 100, y: 100 } };
    s.devices.push(ap);
    expect(uplinkOf(s, ap.id).online).toBe(false);
  });

  it("uses the selected band width and reduces radio rate only for overlapping nearby APs", () => {
    const s = autoFloor(defaultScenario());
    const ap = s.devices.find((d) => d.id === "ap1")!;
    const c = s.clients.find((client) => client.id === "iphone")!;
    c.pos = { x: 3, y: 3 };
    ap.pos = c.pos;
    ap.wifiRadios = { "5": { channel: 36, width: 80 } };
    const ssid = s.ssids.find((w) => w.id === "home")!;
    ssid.bands = ["5"];
    const other = { ...makeDevice("ap", "neighbor", "Neighbor"), pos: c.pos, wifiRadios: { "5": { channel: 48, width: 20 } } };
    s.devices.push(other);
    const overlap = radioLink(s, c, ssid, ap.id)!;
    expect(overlap).toMatchObject({ channel: 36, width: 80, neighbors: 1 });
    other.wifiRadios["5"].channel = 149;
    const clear = radioLink(s, c, ssid, ap.id)!;
    expect(clear.neighbors).toBe(0);
    expect(clear.rate).toBeGreaterThan(overlap.rate);
    ap.wifiRadios["5"]!.width = 20;
    expect(radioLink(s, c, ssid, ap.id)!.rate).toBeLessThan(clear.rate);
  });

  it("allows guest DHCP before login, blocks communication, and grants only the correct client session", () => {
    const store = useStore.getState();
    store.mutate((s) => {
      s.ssids.find((w) => w.id === "guest")!.captivePortal = { id: "test-portal", password: "sample-code" };
    });
    const guestId = "guest-phone";
    const query = { srcId: guestId, dst: "internet", protocol: "icmp" as const, port: null };
    expect(resolveClient(scenario(), guestId)).toMatchObject({ ip: expect.any(String), guestPortal: { id: "guest" } });
    expect(probe(scenario(), guestId, "192.168.50.1", "icmp", null).status).not.toBe("ok");
    expect(trace(scenario(), query).ok).toBe(false);
    expect(store.signInGuest(guestId, "wrong")).toBe(false);
    expect(store.signInGuest("iphone", "sample-code")).toBe(false);
    expect(store.signInGuest(guestId, "sample-code")).toBe(true);
    expect(trace(scenario(), query).ok).toBe(true);
    const guest = scenario().clients.find((c) => c.id === guestId)!;
    store.joinWifi(guestId, "guest", guest.wifiPassword);
    expect(trace(scenario(), query).ok).toBe(false);
  });

  it("authenticates Enterprise with RADIUS users, checks server availability and preserves old SSIDs", () => {
    const store = useStore.getState();
    store.mutate((s) => {
      const w = s.ssids.find((w) => w.id === "home")!;
      w.security = "wpa2-enterprise";
      w.password = "legacy-test-pass";
      w.enterpriseIdentity = "legacy-user";
    });
    store.joinWifi("iphone", "home", "legacy-test-pass", "legacy-user");
    expect(resolveClient(scenario(), "iphone").error).toBeUndefined();
    store.mutate((s) => {
      s.ssids.find((w) => w.id === "home")!.radius = {
        online: true,
        users: [{ identity: "user-one", password: "test-pass-one" }, { identity: "user-two", password: "test-pass-two" }],
      };
    });
    store.joinWifi("iphone", "home", "test-pass-one", "user-two");
    expect(resolveClient(scenario(), "iphone").wifiAuthFailed).toBe(true);
    store.joinWifi("iphone", "home", "test-pass-two", "user-two");
    expect(resolveClient(scenario(), "iphone").ip).toBeDefined();
    expect(phone().wifiIdentities?.home).toBe("user-two");
    store.mutate((s) => {
      s.ssids.find((w) => w.id === "home")!.radius!.online = false;
    });
    expect(resolveClient(scenario(), "iphone").error).toContain("RADIUS サーバーが応答しません");
  });

  it("accepts PPSK only for the assigned device and rejects revoked passwords", () => {
    const store = useStore.getState();
    store.mutate((s) => {
      const w = s.ssids.find((w) => w.id === "home")!;
      w.security = "ppsk";
      w.ppsk = { iphone: "test-iphone", "guest-phone": "test-guest" };
    });
    store.joinWifi("iphone", "home", "test-guest");
    expect(resolveClient(scenario(), "iphone").wifiAuthFailed).toBe(true);
    store.joinWifi("iphone", "home", "test-iphone");
    expect(resolveClient(scenario(), "iphone").ip).toBeDefined();
    expect(savedWifiPassword(phone(), "home")).toBe("test-iphone");
    store.mutate((s) => {
      delete s.ssids.find((w) => w.id === "home")!.ppsk!.iphone;
    });
    expect(resolveClient(scenario(), "iphone").wifiAuthFailed).toBe(true);
  });
});
const { useStore } = await import("./store");
const scenario = () => useStore.getState().scenario;
const phone = () => scenario().clients.find((c) => c.id === "iphone")!;

beforeEach(() => useStore.setState({ scenario: defaultScenario() }));
afterAll(() => vi.unstubAllGlobals());

describe("saved Wi-Fi credentials", () => {
  it("retains passwords for separate SSIDs across switching and disconnecting", () => {
    const store = useStore.getState();
    const homePassword = phone().wifiPassword;
    const iotPassword = "lab-other-pass";
    store.mutate((s) => {
      s.ssids.find((w) => w.id === "home-iot")!.password = iotPassword;
    });
    store.joinWifi("iphone", "home-iot", iotPassword);
    store.disconnectWifi("iphone");

    expect(savedWifiPassword(phone(), "home")).toBe(homePassword);
    expect(savedWifiPassword(phone(), "home-iot")).toBe(iotPassword);
    store.joinWifi("iphone", "home", savedWifiPassword(phone(), "home")!);
    expect(resolveClient(scenario(), "iphone").error).toBeUndefined();
  });

  it("reports an outdated password and only replaces it after a correct retry", () => {
    const store = useStore.getState();
    const oldPassword = phone().wifiPassword;
    store.disconnectWifi("iphone");
    store.mutate((s) => {
      s.ssids.find((w) => w.id === "home")!.password = "lab-new-pass";
    });

    store.joinWifi("iphone", "home", oldPassword);
    expect(resolveClient(scenario(), "iphone").wifiAuthFailed).toBe(true);
    expect(savedWifiPassword(phone(), "home")).toBe(oldPassword);
    store.joinWifi("iphone", "home", "lab-new-pass");
    expect(resolveClient(scenario(), "iphone").error).toBeUndefined();
    expect(savedWifiPassword(phone(), "home")).toBe("lab-new-pass");
  });

  it("migrates the selected Wi-Fi password and legacy phone labels without resetting progress", async () => {
    const previous = defaultScenario();
    previous.clients.find((c) => c.id === "guest-phone")!.vendor = "Apple";
    entries.set("netlab-state", JSON.stringify({ version: 5, state: { scenario: previous, completed: ["lesson"] } }));
    await useStore.persist.rehydrate();

    expect(savedWifiPassword(phone(), "home")).toBe(phone().wifiPassword);
    expect(phone().vendor).toBe("Apple");
    expect(scenario().clients.find((c) => c.id === "guest-phone")?.vendor).toBe("Generic");
    expect(useStore.getState().completed).toEqual(["lesson"]);
  });
});
