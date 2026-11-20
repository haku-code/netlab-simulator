// ルーティング: 最長一致 (Longest Prefix Match) とダイクストラ法 (OSPF)
import { inSubnet, parseCidr, parseIp } from "../net/ip";

export interface Route {
  prefix: string;
  nextHop: string;
  iface: string;
}

export const ROUTES: Route[] = [
  { prefix: "0.0.0.0/0", nextHop: "203.0.113.1", iface: "WAN (ISP)" },
  { prefix: "10.0.0.0/8", nextHop: "10.255.0.2", iface: "R2" },
  { prefix: "10.1.0.0/16", nextHop: "10.255.0.6", iface: "R3" },
  { prefix: "10.1.2.0/24", nextHop: "10.255.0.10", iface: "R4" },
  { prefix: "10.1.2.128/25", nextHop: "10.255.0.14", iface: "R5" },
  { prefix: "192.168.1.0/24", nextHop: "直接接続", iface: "LAN" },
  { prefix: "172.16.0.0/12", nextHop: "10.255.0.18", iface: "VPN" },
];

/** 一致するルートと、そのうち最長一致のもの */
export function lookup(routes: Route[], ip: string) {
  const n = parseIp(ip);
  if (n === null) return { matches: [], best: null };
  const matches = routes.filter((r) => {
    const sn = parseCidr(r.prefix)!;
    return r.prefix === "0.0.0.0/0" || inSubnet(n, sn);
  });
  const len = (r: Route) => Number(r.prefix.split("/")[1]);
  const best = matches.reduce<Route | null>((a, b) => (!a || len(b) > len(a) ? b : a), null);
  return { matches, best };
}

const DEST_POOL = ["10.1.2.200", "10.1.2.5", "10.1.9.9", "10.200.3.4", "8.8.8.8", "192.168.1.50", "172.20.1.1", "172.32.0.1", "10.1.2.127", "10.1.3.1"];
export function randomDest(r: () => number = Math.random) {
  return DEST_POOL[Math.floor(r() * DEST_POOL.length)];
}

// --- ダイクストラ法 -------------------------------------------------------------

export interface GNode {
  id: string;
  x: number;
  y: number;
}
export interface GEdge {
  a: string;
  b: string;
  cost: number;
  up: boolean;
}

export const OSPF_NODES: GNode[] = [
  { id: "R1", x: 60, y: 150 },
  { id: "R2", x: 210, y: 50 },
  { id: "R3", x: 210, y: 250 },
  { id: "R4", x: 380, y: 50 },
  { id: "R5", x: 380, y: 250 },
  { id: "R6", x: 530, y: 150 },
];

export const OSPF_EDGES: GEdge[] = [
  { a: "R1", b: "R2", cost: 10, up: true },
  { a: "R1", b: "R3", cost: 5, up: true },
  { a: "R2", b: "R3", cost: 3, up: true },
  { a: "R2", b: "R4", cost: 1, up: true },
  { a: "R3", b: "R5", cost: 9, up: true },
  { a: "R4", b: "R5", cost: 2, up: true },
  { a: "R4", b: "R6", cost: 8, up: true },
  { a: "R5", b: "R6", cost: 4, up: true },
];

export interface DijkstraStep {
  /** このステップで確定したノード */
  settled: string;
  dist: Record<string, number>;
  prev: Record<string, string | null>;
  done: string[];
  /** このステップで距離が更新されたノード */
  relaxed: string[];
}

export function dijkstraSteps(nodes: GNode[], edges: GEdge[], source: string): DijkstraStep[] {
  const dist: Record<string, number> = Object.fromEntries(nodes.map((n) => [n.id, Infinity]));
  const prev: Record<string, string | null> = Object.fromEntries(nodes.map((n) => [n.id, null]));
  dist[source] = 0;
  const done: string[] = [];
  const steps: DijkstraStep[] = [];
  while (done.length < nodes.length) {
    const cand = nodes.filter((n) => !done.includes(n.id) && dist[n.id] < Infinity).sort((a, b) => dist[a.id] - dist[b.id] || a.id.localeCompare(b.id));
    if (!cand.length) break;
    const u = cand[0].id;
    done.push(u);
    const relaxed: string[] = [];
    for (const e of edges) {
      if (!e.up) continue;
      const v = e.a === u ? e.b : e.b === u ? e.a : null;
      if (!v || done.includes(v)) continue;
      if (dist[u] + e.cost < dist[v]) {
        dist[v] = dist[u] + e.cost;
        prev[v] = u;
        relaxed.push(v);
      }
    }
    steps.push({ settled: u, dist: { ...dist }, prev: { ...prev }, done: [...done], relaxed });
  }
  return steps;
}

/** 最短経路木から、送信元のルーティングテーブル（宛先 → 次ホップ） */
export function nextHops(source: string, prev: Record<string, string | null>) {
  const out: Record<string, string | null> = {};
  for (const dest of Object.keys(prev)) {
    if (dest === source) continue;
    let cur: string | null = dest;
    let hop: string | null = null;
    while (cur && prev[cur] !== null) {
      if (prev[cur] === source) hop = cur;
      cur = prev[cur];
    }
    out[dest] = hop;
  }
  return out;
}
