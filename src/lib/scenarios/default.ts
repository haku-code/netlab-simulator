import type { Scenario } from "../model";
import { webServer } from "../web";
import { access, link, makeDevice, network, policy, setPort, ssid, trunk, wifi, wired, zones } from "./builders";

/** サンドボックスの初期構成: 家庭 + IoT + ゲスト */
export function defaultScenario(): Scenario {
  const gw = setPort(makeDevice("gateway", "gw", "Gateway"), 1, trunk("lan", "all"));
  const sw = makeDevice("switch", "sw1", "Core Switch");
  sw.poeBudgetW = 60;
  setPort(sw, 1, trunk("lan", "all"));
  setPort(sw, 2, access("lan"));
  setPort(sw, 3, access("lan"));
  setPort(sw, 4, access("iot"));
  setPort(sw, 8, trunk("lan", "all"));
  const ap = setPort(makeDevice("ap", "ap1", "Living Room AP"), 1, trunk("lan", "all"));

  return {
    networks: [
      network("lan", "Default", 1, 1),
      network("iot", "IoT", 30, 30, { zoneId: "iot" }),
      network("guest", "Guest", 50, 50, { zoneId: "hotspot" }),
    ],
    zones: zones({ id: "iot", name: "IoT" }),
    devices: [gw, sw, ap],
    links: [link(gw, 1, sw, 1), link(sw, 8, ap, 1)],
    ssids: [
      ssid("home", "Home", "lan", { security: "wpa3", bands: ["2.4", "5", "6"] }),
      ssid("home-iot", "Home-IoT", "iot", { bands: ["2.4"] }),
      ssid("guest", "Guest", "guest", { clientIsolation: true }),
    ],
    clients: [
      wired("pc", "Desktop PC", "pc", sw, 2),
      wired("nas", "NAS", "server", sw, 3, "192.168.1.5"),
      wired("plug", "Smart Plug", "iot", sw, 4),
      wifi("iphone", "iPhone", "phone", ap, "home"),
      wifi("tv", "Smart TV", "tv", ap, "home-iot"),
      wifi("guest-phone", "Guest Phone", "phone", ap, "guest"),
      webServer("website", sw, 6, 1, "192.168.1.240"),
      webServer("forum", sw, 7, 1, "192.168.1.241"),
    ],
    policies: [policy("p-lan-iot", "Allow Default to IoT", "allow", "internal", "iot", { src: "lan" })],
  };
}
