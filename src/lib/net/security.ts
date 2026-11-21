import type { Protocol, Scenario } from "../model";
import { ipToStr, parseIp } from "./ip";
import { parseIpv6 } from "./ipv6";

export const APP_SIGNATURES = {
  streaming: { label: "動画ストリーミング", host: "video.example.com", ip: "198.51.100.81", ipv6: "2001:db8:ffff::81" },
  social: { label: "SNS", host: "social.example.test", ip: "198.51.100.82", ipv6: "2001:db8:ffff::82" },
  games: { label: "オンラインゲーム", host: "games.example.test", ip: "198.51.100.83", ipv6: "2001:db8:ffff::83" },
} as const;

export type AppSignature = keyof typeof APP_SIGNATURES;
export type SecuritySettings = {
  intrusion: "off" | "ids" | "ips";
  apps: AppSignature[];
  sites: string[];
  dns: string[];
};
export const DEFAULT_SECURITY: SecuritySettings = { intrusion: "off", apps: [], sites: [], dns: [] };

export const THREAT = { host: "phishing.example.test", ip: "198.51.100.90", ipv6: "2001:db8:ffff::90", label: "フィッシング（実習用）" };

export type SecurityDecision = {
  layer: "IDS" | "IPS" | "アプリ" | "サイト" | "DNS";
  action: "detect" | "block";
  destination: string;
  reason: string;
};

export function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function validDomain(value: string) {
  return value.length <= 253 && value.includes(".") && parseIp(value) === null
    && value.split(".").every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label));
}

function matchesDomain(host: string, domain: string) {
  return !!domain && (host === domain || host.endsWith(`.${domain}`));
}

function matchesSignature(host: string, ipv4: string | undefined, ipv6: bigint | null, signature: { host: string; ip: string; ipv6: string }) {
  return matchesDomain(host, signature.host) || ipv4 === signature.ip || (ipv6 !== null && ipv6 === parseIpv6(signature.ipv6));
}

export function signatureAddress(hostname: string, ipv6: boolean) {
  const host = normalizeDomain(hostname);
  const signature = [THREAT, ...Object.values(APP_SIGNATURES)].find((entry) => matchesDomain(host, entry.host));
  return ipv6 ? signature?.ipv6 : signature?.ip;
}

export function inspectDns(s: Scenario, hostname: string): SecurityDecision | undefined {
  const destination = normalizeDomain(hostname);
  const rule = s.security?.dns.find((domain) => matchesDomain(destination, domain));
  return rule ? { layer: "DNS", action: "block", destination, reason: `DNS フィルター「${rule}」で名前解決を拒否` } : undefined;
}

export function inspectTraffic(s: Scenario, hostname: string | undefined, ip: string | undefined, protocol: Protocol, port: number | null): SecurityDecision[] {
  const settings = s.security;
  const destination = hostname || ip;
  if (!settings || !destination) return [];
  const host = normalizeDomain(hostname ?? "");
  const address = parseIpv6(ip ?? "");
  const address4 = ip ? parseIp(ip) : null;
  const ipv4 = address4 === null ? undefined : ipToStr(address4);
  const events: SecurityDecision[] = [];
  if (settings.intrusion !== "off" && matchesSignature(host, ipv4, address, THREAT)) {
    const block = settings.intrusion === "ips";
    events.push({ layer: block ? "IPS" : "IDS", action: block ? "block" : "detect", destination, reason: `${block ? "IPS でブロック" : "IDS で検知"} · ${THREAT.label}` });
    if (block) return events;
  }
  const app = settings.apps.map((id) => APP_SIGNATURES[id]).find((signature) => signature && matchesSignature(host, ipv4, address, signature));
  if (app && ((protocol === "tcp" && (port === 80 || port === 443)) || (protocol === "udp" && port === 443))) {
    events.push({ layer: "アプリ", action: "block", destination, reason: `アプリ「${app.label}」をブロック` });
    return events;
  }
  const rule = protocol === "tcp" && port !== null && settings.sites.find((domain) => matchesDomain(host, domain));
  if (rule) events.push({ layer: "サイト", action: "block", destination, reason: `サイト「${rule}」をブロック` });
  return events;
}
