import type { Client, Scenario } from "./model";
import { wifiCredentialsMatch, wifiMode } from "./wifi-security";

export function savedWifiPassword(client: Client, ssidId: string) {
  const password = client.wifiPasswords?.[ssidId];
  return typeof password === "string" ? password : undefined;
}

export function rememberWifiPassword(s: Scenario, client: Client) {
  if (client.connection.type !== "wifi" || !client.connection.ssidId) return;
  const ssidId = client.connection.ssidId;
  const ssid = s.ssids.find((w) => w.id === ssidId);
  const mode = ssid && wifiMode(ssid.security);
  if (ssid && mode && (mode.auth === "shared" || mode.auth === "enterprise" || mode.auth === "ppsk") && wifiCredentialsMatch(ssid, client)) {
    client.wifiPasswords = { ...client.wifiPasswords, [ssidId]: client.wifiPassword };
    if (mode.auth === "enterprise" && client.wifiIdentity) {
      client.wifiIdentities = { ...client.wifiIdentities, [ssidId]: client.wifiIdentity };
    }
  }
}

export const GUEST_PORTAL_REQUIRED = "ゲスト Wi-Fi のログインが必要です。";

export function pendingGuestPortal(s: Scenario, client: Client) {
  const connection = client.connection;
  const ssid = connection.type === "wifi" ? s.ssids.find((w) => w.id === connection.ssidId) : undefined;
  return ssid?.captivePortal && client.guestPortalSession !== ssid.captivePortal.id ? ssid : undefined;
}
