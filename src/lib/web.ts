import type { Client, Device, Scenario, WebService } from "./model";
import type { ProbeResult } from "./emu";
import { resolveClient } from "./net/simulate";
import { wired } from "./scenarios/builders";
import { portBusy } from "./topo";
import { clientWifiMode } from "./wifi-security";

export const WEB_TLS = {
  trusted: "信頼済み",
  expired: "期限切れ",
  untrusted: "信頼できない発行元",
  disabled: "HTTPS 無効",
} satisfies Record<WebService["tls"], string>;

export function webServer(kind: WebService["kind"], dev: Device, port: number, index = 1, ip?: string): Client {
  const name = kind === "website" ? "Web サーバー" : "会員制掲示板";
  const host = kind === "website" ? "web" : "forum";
  const suffix = index === 1 ? "" : `-${index}`;
  return {
    ...wired(`web-${host}${suffix}`, index === 1 ? name : `${name} ${index}`, "server", dev, port, ip),
    vendor: "NetLab",
    webService: { kind, host: `${host}${suffix}.test`, tls: "trusted" },
  };
}

/** 保存済みのサンドボックスでは、配線の変更なしに置ける初期ポートだけを使う。 */
export function installDemoWebServers(s: Scenario) {
  const sw = s.devices.find((d) => d.id === "sw1" && d.type === "switch");
  if (!sw || !s.networks.some((n) => n.id === "lan")) return;
  for (const [kind, idx] of [["website", 6], ["forum", 7]] as const) {
    const port = sw.ports.find((p) => p.idx === idx);
    if (!port?.enabled || port.nativeNetworkId !== "lan" || portBusy(s, sw.id, port.id)) continue;
    const server = webServer(kind, sw, idx);
    if (!s.clients.some((c) => c.id === server.id || c.webService?.kind === kind)) s.clients.push(server);
  }
}

export function webError(service: WebService, host: string, scheme: "http" | "https", port: number) {
  if (scheme === "http") return port === 80 ? null : "このポートは HTTPS 用です。";
  if (port !== 443 || service.tls === "disabled") return "このポートでは TLS が使えません。";
  if (service.tls === "expired") return "サーバー証明書の有効期限が切れています。";
  if (service.tls === "untrusted") return "サーバー証明書の発行元を信頼できません。";
  if (host !== service.host) return `サーバー証明書の名前（${service.host}）と URL が一致しません。`;
  return null;
}

export type WebEvent = { method: "GET" | "POST"; path: "/" | "/login" | "/posts"; status: "200 OK" | "201 Created" | "401 Unauthorized" };

export function virtualWebCapture(
  s: Scenario,
  clientId: string,
  scheme: "http" | "https",
  port: number,
  result: ProbeResult,
  tlsError: string | null,
  event: WebEvent,
) {
  const { client, ip, attachDeviceId } = resolveClient(s, clientId);
  const radio = attachDeviceId ? clientWifiMode(s, client) : undefined;
  const transport = result.status === "ok" ? ["SYN", "SYN-ACK", "ACK"]
    : result.status === "refused" ? ["SYN", "RST"]
      : result.status === "timeout" ? ["SYN · 応答なし"] : [];
  const handshake = result.status === "ok" && scheme === "https"
    ? tlsError && port !== 443 ? ["TLS 接続を確立できません"]
      : ["ClientHello", "ServerHello", "サーバー認証と Finished（暗号化）", tlsError ? "証明書検証失敗 · 接続終了" : "TLS 1.3 確立"]
    : [];
  const exchanged = result.status === "ok" && !tlsError;
  const request = event.method === "GET" ? `GET ${event.path}` : `POST ${event.path}\n${event.path === "/login" ? "user=sample-member&password=sample-value" : "body=サンプルの投稿"}`;
  const application = exchanged
    ? scheme === "https" ? "TLS Application Data（暗号化）" : `${request}\nHTTP/1.1 ${event.status}`
    : "HTTP データなし";
  return {
    ip, radio, transport, handshake, application, exchanged, request,
    airPayload: radio?.radio === "protected" ? "Wi-Fi フレーム本体は暗号化されています。" : application,
  };
}
