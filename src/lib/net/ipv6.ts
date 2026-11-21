import type { Client, Network } from "../model";
import { parseIp } from "./ip";

export type IpFamily = "ipv4" | "ipv6";
export const INTERNET_IP6 = "2001:db8:ffff::10";
const zero = BigInt(0);
const one = BigInt(1);
const word = BigInt(16);

export function parseIpv6(value: string): bigint | null {
  let input = value.trim().replace(/^\[([^\]]+)\]$/, "$1");
  if (!input.includes(":")) return null;
  if (input.includes(".")) {
    const separator = input.lastIndexOf(":");
    const ipv4 = input.slice(separator + 1);
    const address = parseIp(ipv4);
    if (address === null || /\s/.test(ipv4)) return null;
    input = `${input.slice(0, separator + 1)}${(address >>> 16).toString(16)}:${(address & 0xffff).toString(16)}`;
  }
  const sides = input.split("::");
  if (sides.length > 2) return null;
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const count = left.length + right.length;
  const compressed = sides.length === 2;
  if (compressed ? count >= 8 : count !== 8) return null;
  const words = [...left, ...Array<string>(compressed ? 8 - count : 0).fill("0"), ...right];
  if (words.some((part) => !/^[\da-f]{1,4}$/i.test(part))) return null;
  return words.reduce((address, part) => (address << word) | BigInt(parseInt(part, 16)), zero);
}

export function formatIpv6(address: bigint) {
  const words = Array.from({ length: 8 }, (_, i) => Number((address >> BigInt((7 - i) * 16)) & BigInt(0xffff)).toString(16));
  let bestStart = 0;
  let bestLength = 0;
  for (let i = 0; i < words.length; i++) {
    const start = i;
    while (words[i] === "0") i++;
    if (i - start > bestLength) {
      bestStart = start;
      bestLength = i - start;
    }
  }
  if (bestLength < 2) return words.join(":");
  return `${words.slice(0, bestStart).join(":")}::${words.slice(bestStart + bestLength).join(":")}`;
}

export function parseIpv6Cidr(value: string) {
  const match = value.trim().match(/^([^/]+)\/(\d{1,3})$/);
  if (!match) return null;
  const ip = parseIpv6(match[1]);
  const prefix = Number(match[2]);
  if (ip === null || prefix > 128) return null;
  const bits = BigInt(128 - prefix);
  return { network: (ip >> bits) << bits, bits, prefix };
}

export function inIpv6Subnet(ip: bigint, subnet: NonNullable<ReturnType<typeof parseIpv6Cidr>>) {
  return ip >> subnet.bits === subnet.network >> subnet.bits;
}

export const isGlobalIpv6 = (ip: bigint) => ip >> BigInt(125) === one;

export function lanIpv6Prefix(value: string | undefined) {
  const prefix = value ? parseIpv6Cidr(value) : null;
  if (!prefix || prefix.prefix !== 64 || (!isGlobalIpv6(prefix.network) && prefix.network >> BigInt(121) !== BigInt(126))) return null;
  return prefix;
}

export function ipv6Gateway(network: Network) {
  const prefix = lanIpv6Prefix(network.ipv6Prefix);
  return prefix ? formatIpv6(prefix.network | one) : undefined;
}

/** SLAAC で /64 に MAC から作成したインターフェース ID を組み合わせる。 */
export function slaacAddress(network: Network, client: Client) {
  const prefix = lanIpv6Prefix(network.ipv6Prefix);
  const mac = client.mac.match(/^([\da-f]{2}):([\da-f]{2}):([\da-f]{2}):([\da-f]{2}):([\da-f]{2}):([\da-f]{2})$/i);
  if (!prefix || !mac) return undefined;
  const [, first, second, third, fourth, fifth, sixth] = mac;
  const interfaceId = BigInt(`0x${(parseInt(first, 16) ^ 2).toString(16).padStart(2, "0")}${second}${third}fffe${fourth}${fifth}${sixth}`);
  return formatIpv6(prefix.network | interfaceId);
}
