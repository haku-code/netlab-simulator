import { describe, expect, it } from "vitest";
import { buildCapture } from "./capture";
import { probe } from "./emu";
import { assignLeases, resolveClient, trace } from "./net/simulate";
import { defaultScenario } from "./scenarios/default";
import { installDemoWebServers, virtualWebCapture, webError, type WebEvent } from "./web";
import { negotiatedWifiSecurity } from "./wifi-security";

const login: WebEvent = { method: "POST", path: "/login", status: "200 OK" };

describe("virtual Web traffic", () => {
  it("shows illustrative HTTP payloads over WEP while keeping HTTPS content encrypted", () => {
    const s = assignLeases(defaultScenario());
    s.ssids.find((w) => w.id === "home")!.security = "wep";
    const http = probe(s, "iphone", "forum.test", "tcp", 80);
    const https = probe(s, "iphone", "forum.test", "tcp", 443);
    expect(http).toMatchObject({ status: "ok", target: { ip: "192.168.1.241" } });
    expect(virtualWebCapture(s, "iphone", "http", 80, http, null, login).airPayload).toContain("POST /login");
    expect(virtualWebCapture(s, "iphone", "https", 443, https, null, login).airPayload).toBe("TLS Application Data（暗号化）");
  });

  it("keeps the radio view encrypted on a protected mode", () => {
    const s = assignLeases(defaultScenario());
    const http = probe(s, "iphone", "forum.test", "tcp", 80);
    const capture = virtualWebCapture(s, "iphone", "http", 80, http, null, login);
    expect(capture.airPayload).toContain("Wi-Fi フレーム本体は暗号化");
    expect(capture.application).toContain("POST /login");
    const query = { srcId: "iphone", dst: "web-forum", protocol: "tcp", port: 80 } as const;
    expect(buildCapture(s, query, trace(s, query)).find((frame) => frame.medium === "wifi" && frame.kind === "data")?.wifi?.radio).toBe("protected");
  });

  it("honors firewall rules and stops after certificate validation fails", () => {
    const s = assignLeases(defaultScenario());
    const forum = s.clients.find((c) => c.webService?.kind === "forum")!.webService!;
    forum.tls = "expired";
    const error = webError(forum, forum.host, "https", 443);
    const result = probe(s, "iphone", forum.host, "tcp", 443);
    expect(error).toContain("有効期限");
    expect(virtualWebCapture(s, "iphone", "https", 443, result, error, login).application).toBe("HTTP データなし");
    expect(probe(s, "guest-phone", forum.host, "tcp", 443).status).toBe("timeout");
    forum.tls = "disabled";
    expect(probe(s, "iphone", forum.host, "tcp", 443).status).toBe("refused");
  });

  it("installs the sample servers without replacing an occupied switch port", () => {
    const s = defaultScenario();
    s.clients = s.clients.filter((c) => !c.webService);
    s.clients.find((c) => c.id === "pc")!.connection = { type: "wired", deviceId: "sw1", portId: "sw1:p6" };
    installDemoWebServers(s);
    installDemoWebServers(s);
    expect(s.clients.flatMap((c) => c.webService ? [c.webService.host] : [])).toEqual(["forum.test"]);
  });
});

describe("Wi-Fi modes", () => {
  it("selects the supported side of transition modes", () => {
    const s = defaultScenario();
    const phone = s.clients.find((c) => c.id === "iphone")!;
    expect(negotiatedWifiSecurity("wpa2-wpa3", phone)).toBe("wpa3");
    phone.wpa3 = false;
    expect(negotiatedWifiSecurity("wpa2-wpa3", phone)).toBe("wpa2");
    phone.wifiLegacyOnly = true;
    expect(negotiatedWifiSecurity("wpa-wpa2", phone)).toBe("wpa");
  });

  it("checks enterprise credentials and simulates registered client certificates", () => {
    const s = assignLeases(defaultScenario());
    const phone = s.clients.find((c) => c.id === "iphone")!;
    const home = s.ssids.find((w) => w.id === "home")!;
    home.security = "wpa2-enterprise";
    expect(resolveClient(s, phone.id).wifiAuthFailed).toBe(true);
    phone.wifiIdentity = "lab-member";
    expect(resolveClient(s, phone.id).error).toBeUndefined();
    home.security = "wpa3-enterprise-192";
    expect(resolveClient(s, phone.id).wifiAuthFailed).toBe(true);
    phone.wifiCertificate = true;
    expect(resolveClient(s, phone.id).error).toBeUndefined();
  });
});
