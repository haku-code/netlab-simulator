// STP (IEEE 802.1D) のポート役割の計算
export interface StpBridge {
  id: string;
  priority: number;
  mac: string;
  x: number;
  y: number;
}

export interface StpLink {
  id: string;
  a: string;
  b: string;
  /** a 側 / b 側のポート番号 */
  pa: number;
  pb: number;
  cost: number;
  up: boolean;
}

export type PortRole = "root" | "designated" | "blocked";

export const BRIDGES: StpBridge[] = [
  { id: "SW-A", priority: 32768, mac: "00:1a:00:00:00:0a", x: 110, y: 60 },
  { id: "SW-B", priority: 32768, mac: "00:1a:00:00:00:0b", x: 430, y: 60 },
  { id: "SW-C", priority: 32768, mac: "00:1a:00:00:00:0c", x: 110, y: 260 },
  { id: "SW-D", priority: 32768, mac: "00:1a:00:00:00:0d", x: 430, y: 260 },
];

/** 1 Gbps = コスト 4（802.1D-1998） */
export const LINKS: StpLink[] = [
  { id: "ab", a: "SW-A", b: "SW-B", pa: 1, pb: 1, cost: 4, up: true },
  { id: "ac", a: "SW-A", b: "SW-C", pa: 2, pb: 1, cost: 4, up: true },
  { id: "bd", a: "SW-B", b: "SW-D", pa: 2, pb: 1, cost: 4, up: true },
  { id: "cd", a: "SW-C", b: "SW-D", pa: 2, pb: 2, cost: 4, up: true },
  { id: "ad", a: "SW-A", b: "SW-D", pa: 3, pb: 3, cost: 19, up: true },
];

export const bridgeIdStr = (b: StpBridge) => `${b.priority}.${b.mac}`;

/** ブリッジ ID の比較（小さい方が優先）: 優先度 → MAC */
export function cmpBridge(a: StpBridge, b: StpBridge) {
  return a.priority - b.priority || a.mac.localeCompare(b.mac);
}

export interface StpResult {
  root: StpBridge;
  /** 各ブリッジのルートまでのコスト */
  cost: Record<string, number>;
  rootPort: Record<string, { linkId: string; port: number } | null>;
  /** linkId → 各端の役割 */
  roles: Record<string, { a: PortRole; b: PortRole }>;
}

export function computeStp(bridges: StpBridge[], links: StpLink[]): StpResult {
  const byId = Object.fromEntries(bridges.map((b) => [b.id, b]));
  const root = [...bridges].sort(cmpBridge)[0];
  const up = links.filter((l) => l.up);

  // ルートからのパスコスト（ダイクストラ）
  const cost: Record<string, number> = Object.fromEntries(bridges.map((b) => [b.id, Infinity]));
  cost[root.id] = 0;
  const done = new Set<string>();
  while (done.size < bridges.length) {
    const u = bridges.filter((b) => !done.has(b.id) && cost[b.id] < Infinity).sort((a, b) => cost[a.id] - cost[b.id])[0];
    if (!u) break;
    done.add(u.id);
    for (const l of up) {
      const v = l.a === u.id ? l.b : l.b === u.id ? l.a : null;
      if (v && cost[u.id] + l.cost < cost[v]) cost[v] = cost[u.id] + l.cost;
    }
  }

  // ルートポート: ルートへの最小コスト → 隣のブリッジ ID → 隣のポート番号
  const rootPort: StpResult["rootPort"] = {};
  for (const b of bridges) {
    if (b.id === root.id) {
      rootPort[b.id] = null;
      continue;
    }
    const cands = up
      .filter((l) => l.a === b.id || l.b === b.id)
      .map((l) => {
        const nb = l.a === b.id ? l.b : l.a;
        return { l, nb: byId[nb], total: cost[nb] + l.cost, myPort: l.a === b.id ? l.pa : l.pb, nbPort: l.a === b.id ? l.pb : l.pa };
      })
      .filter((c) => c.total < Infinity)
      .sort((x, y) => x.total - y.total || cmpBridge(x.nb, y.nb) || x.nbPort - y.nbPort);
    rootPort[b.id] = cands[0] ? { linkId: cands[0].l.id, port: cands[0].myPort } : null;
  }

  // 各リンク: ルートポートでない側のうち、ルートに近い（同じなら ID が小さい）方が指定ポート
  const roles: StpResult["roles"] = {};
  for (const l of links) {
    if (!l.up) {
      roles[l.id] = { a: "blocked", b: "blocked" };
      continue;
    }
    const aRoot = rootPort[l.a]?.linkId === l.id;
    const bRoot = rootPort[l.b]?.linkId === l.id;
    const aBetter = cost[l.a] < cost[l.b] || (cost[l.a] === cost[l.b] && cmpBridge(byId[l.a], byId[l.b]) < 0);
    roles[l.id] = {
      a: aRoot ? "root" : bRoot || aBetter ? "designated" : "blocked",
      b: bRoot ? "root" : aRoot || !aBetter ? "designated" : "blocked",
    };
  }
  return { root, cost, rootPort, roles };
}
