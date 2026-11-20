import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveClient } from "./net/simulate";
import { defaultScenario } from "./scenarios/default";
import { savedWifiPassword } from "./wifi";

const entries = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  },
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
