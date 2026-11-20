export function parseIp(s: string): number | null {
  const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

export function ipToStr(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export interface Subnet {
  network: number;
  broadcast: number;
  prefix: number;
  size: number;
}

export function parseCidr(s: string): Subnet | null {
  const [ipPart, prefixPart, extra] = s.trim().split("/");
  if (extra !== undefined || prefixPart === undefined) return null;
  if (!/^\d{1,2}$/.test(prefixPart)) return null;
  const prefix = Number(prefixPart);
  if (prefix < 1 || prefix > 32) return null;
  const base = parseIp(ipPart);
  if (base === null) return null;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const network = (base & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  return { network, broadcast: network + size - 1, prefix, size };
}

export function subnetToStr(sn: Subnet): string {
  return `${ipToStr(sn.network)}/${sn.prefix}`;
}

export function inSubnet(ip: number, sn: Subnet): boolean {
  return ip >= sn.network && ip <= sn.broadcast;
}

/** ホストに割り当て可能なアドレスか（ネットワークアドレス・ブロードキャストを除く） */
export function isHostAddr(ip: number, sn: Subnet): boolean {
  if (!inSubnet(ip, sn)) return false;
  if (sn.prefix >= 31) return true;
  return ip !== sn.network && ip !== sn.broadcast;
}

export function overlaps(a: Subnet, b: Subnet): boolean {
  return a.network <= b.broadcast && b.network <= a.broadcast;
}

export function maskStr(prefix: number): string {
  return ipToStr(prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);
}
