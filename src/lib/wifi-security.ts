import type { Client, Scenario, WifiSsid } from "./model";

type Mode = {
  label: string;
  auth: "none" | "shared" | "enterprise" | "certificate";
  radio: "open" | "legacy" | "protected";
  requiresWpa3?: true;
  protection: string;
  risk: string;
};

const sharedRisk = "共有パスワードの管理が必要です。";
const enterpriseRisk = "端末ごとの認証情報と認証サーバーの信頼設定を管理します。";
const legacyRisk = "無線区間の暗号化が弱いため、現在のネットワークでは使用を避けます。";

export const WIFI_SECURITY = {
  open: { label: "認証・暗号化なし", auth: "none", radio: "open", protection: "無線区間は平文です。", risk: "周囲に暗号化されていない通信が見えるおそれがあります。HTTPS は別に通信内容を保護します。" },
  owe: { label: "Enhanced Open（OWE）", auth: "none", radio: "protected", protection: "パスワードなしで、端末ごとに無線区間を暗号化します。", risk: "接続先の AP の身元を認証しません。" },
  wep: { label: "WEP", auth: "shared", radio: "legacy", protection: "古い共有キーで無線フレームを暗号化します。", risk: legacyRisk },
  wpa: { label: "WPA-Personal（TKIP）", auth: "shared", radio: "legacy", protection: "共有パスワードと TKIP を使います。", risk: legacyRisk },
  wpa2: { label: "WPA2-Personal（AES）", auth: "shared", radio: "protected", protection: "共有パスワードと AES-CCMP で無線区間を保護します。", risk: "オフラインでのパスワード推測に備え、長く推測されにくいパスワードを使います。" },
  "wpa2-tkip": { label: "WPA2-Personal（TKIP・旧互換）", auth: "shared", radio: "legacy", protection: "共有パスワードと旧互換の TKIP を使います。", risk: legacyRisk },
  wpa3: { label: "WPA3-Personal", auth: "shared", radio: "protected", requiresWpa3: true, protection: "SAE と管理フレーム保護（PMF）を使います。SAE はオフラインでのパスワード推測に強い方式です。", risk: sharedRisk },
  "wpa-wpa2": { label: "WPA/WPA2-Personal 移行", auth: "shared", radio: "protected", protection: "WPA2 対応端末は AES-CCMP を使います。", risk: "WPA 側の接続には TKIP の弱点が残ります。" },
  "wpa2-wpa3": { label: "WPA2/WPA3-Personal 移行", auth: "shared", radio: "protected", protection: "WPA3 対応端末は SAE、旧端末は WPA2 を使います。", risk: "WPA2 側の接続には、オフラインでのパスワード推測への弱さが残ります。" },
  "wpa-enterprise": { label: "WPA-Enterprise（TKIP）", auth: "enterprise", radio: "legacy", protection: "802.1X で利用者を認証し、TKIP を使います。", risk: legacyRisk },
  "wpa2-enterprise": { label: "WPA2-Enterprise", auth: "enterprise", radio: "protected", protection: "802.1X で利用者ごとに認証し、AES-CCMP を使います。", risk: enterpriseRisk },
  "wpa2-enterprise-tkip": { label: "WPA2-Enterprise（TKIP・旧互換）", auth: "enterprise", radio: "legacy", protection: "802.1X と旧互換の TKIP を使います。", risk: legacyRisk },
  "wpa3-enterprise": { label: "WPA3-Enterprise", auth: "enterprise", radio: "protected", requiresWpa3: true, protection: "802.1X と管理フレーム保護（PMF）を使います。", risk: enterpriseRisk },
  "wpa-wpa2-enterprise": { label: "WPA/WPA2-Enterprise 移行", auth: "enterprise", radio: "protected", protection: "802.1X を使い、WPA2 対応端末は AES-CCMP で通信します。", risk: "WPA 側の TKIP の弱点が残ります。" },
  "wpa2-wpa3-enterprise": { label: "WPA2/WPA3-Enterprise 移行", auth: "enterprise", radio: "protected", protection: "802.1X を使い、端末が対応する WPA2 または WPA3 で接続します。", risk: enterpriseRisk },
  "wpa3-enterprise-192": { label: "WPA3-Enterprise 192-bit", auth: "certificate", radio: "protected", requiresWpa3: true, protection: "EAP-TLS と 192-bit セキュリティスイートを使います。NetLab では端末の実習用証明書登録で表します。", risk: "証明書の発行・有効期限・失効の管理が必要です。" },
} satisfies Record<string, Mode>;

export type WifiSecurity = keyof typeof WIFI_SECURITY;
export const DEFAULT_ENTERPRISE_USER = "lab-member";

export function wifiMode(security: WifiSecurity): Mode {
  return WIFI_SECURITY[security];
}

export function wifiCredentialsMatch(ssid: WifiSsid, client: Client) {
  switch (wifiMode(ssid.security).auth) {
    case "none": return true;
    case "certificate": return client.wifiCertificate === true;
    case "enterprise":
      return client.wifiIdentity === (ssid.enterpriseIdentity || DEFAULT_ENTERPRISE_USER)
        && Boolean(ssid.password) && client.wifiPassword === ssid.password;
    case "shared": return Boolean(ssid.password) && client.wifiPassword === ssid.password;
  }
}

export function negotiatedWifiSecurity(security: WifiSecurity, client: Client): WifiSecurity {
  switch (security) {
    case "wpa-wpa2": return client.wifiLegacyOnly ? "wpa" : "wpa2";
    case "wpa-wpa2-enterprise": return client.wifiLegacyOnly ? "wpa-enterprise" : "wpa2-enterprise";
    case "wpa2-wpa3": return client.wpa3 ? "wpa3" : "wpa2";
    case "wpa2-wpa3-enterprise": return client.wpa3 ? "wpa3-enterprise" : "wpa2-enterprise";
    default: return security;
  }
}

export function clientWifiMode(s: Scenario, client: Client) {
  const connection = client.connection;
  const ssid = connection.type === "wifi" ? s.ssids.find((w) => w.id === connection.ssidId) : undefined;
  return ssid ? wifiMode(negotiatedWifiSecurity(ssid.security, client)) : undefined;
}

export function wifiSupports6GHz(security: WifiSecurity) {
  return security === "owe" || security.startsWith("wpa3") || security.startsWith("wpa2-wpa3");
}
