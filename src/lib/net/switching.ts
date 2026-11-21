// スイッチング: ループと STP、リンクアグリゲーション (LAG)、PoE の電力予算、ポートプロファイル。
// 物理リンクごとに「使えるか」を決め、L2 経路探索（simulate.ts の bfs）が参照する。

import type { Client, Device, Link, Port, PortProfile, Scenario } from "../model";
import type { Issue } from "./validate";

export const DEFAULT_STP_PRIORITY = 32768;
export const STP_PRIORITIES = Array.from({ length: 16 }, (_, i) => i * 4096);
export const DEFAULT_AP_POE_W = 13;
export const POE_BUDGETS = [0, 30, 60, 130, 250, 400];

export type StpRole = "root" | "designated" | "blocked" | "forwarding";

export interface PoePort {
  /** 受電している機器の ID（端末は "c:<ID>"） */
  loadId: string;
  /** 受電している機器・端末の名前 */
  load: string;
  watts: number;
  powered: boolean;
  /** 給電できない理由 */
  reason?: "off" | "budget" | "disabled";
}

export interface PoeState {
  budget: number;
  used: number;
  /** 予算が足りず給電できなかった分も含めた要求電力 */
  requested: number;
  ports: Map<string, PoePort>;
}

export interface SwitchingState {
  /** PoE の給電がなく電源が入っていない機器（承認待ち・更新中で停止している機器も含む） */
  unpowered: Set<string>;
  /** 承認待ち・更新中などで停止している機器 → 理由 */
  down: Map<string, string>;
  unpoweredClients: Set<string>;
  poe: Map<string, PoeState>;
  /** STP がブロックしたリンク → ブロックしている側のポート */
  blocked: Map<string, { deviceId: string; portId: string }>;
  /** ブロードキャストストームが起きている機器 */
  storm: Set<string>;
  /** ストームの原因になっているループのリンク */
  stormLinks: Set<string>;
  /** `${deviceId}|${portId}` → STP のポート役割 */
  roles: Map<string, StpRole>;
  rootId: string | null;
  /** LAG にまとまった物理リンク → 論理リンクのキー */
  lagOf: Map<string, string>;
  /** 論理リンクのキー → 物理リンク */
  lagMembers: Map<string, string[]>;
}

const portKey = (deviceId: string, portId: string) => `${deviceId}|${portId}`;
const findDev = (s: Scenario, id: string) => s.devices.find((d) => d.id === id);
const findPortOf = (s: Scenario, ref: { deviceId: string; portId: string }) => findDev(s, ref.deviceId)?.ports.find((p) => p.id === ref.portId);

export function stpOf(d: Device) {
  return { enabled: d.stp?.enabled ?? true, priority: d.stp?.priority ?? DEFAULT_STP_PRIORITY };
}
/** STP に参加する機器（スイッチのみ） */
export const runsStp = (d: Device | undefined) => !!d && d.type === "switch" && stpOf(d).enabled;
const bridgeKey = (d: Device) => `${String(stpOf(d).priority).padStart(5, "0")}.${d.mac}`;
export const bridgeId = (d: Device) => `${stpOf(d).priority}.${d.mac}`;

export const poeBudget = (d: Device) => d.poeBudgetW ?? 0;
export const apPoeDraw = (d: Device) => d.poeDrawW ?? DEFAULT_AP_POE_W;

export function portMbps(port: Port | undefined) {
  const m = port?.speed.match(/^(\d+(?:\.\d+)?)\s*([GM])(?:bE|bps)$/i);
  return m ? Number(m[1]) * (m[2].toUpperCase() === "G" ? 1000 : 1) : 1000;
}

/** 802.1t のパスコスト（20 Tbps / 帯域） */
export const pathCost = (mbps: number) => Math.max(1, Math.round(20_000_000 / mbps));

// ---------------------------------------------------------------------------
// ポートプロファイルと LAG の設定同期
// ---------------------------------------------------------------------------

function copyProfile(p: Port, prof: Pick<PortProfile, "nativeNetworkId" | "tagged" | "taggedNetworkIds">) {
  p.nativeNetworkId = prof.nativeNetworkId;
  p.tagged = prof.tagged;
  p.taggedNetworkIds = [...prof.taggedNetworkIds];
}

/**
 * プロファイルを使うポートへ設定を反映し、LAG のメンバーを代表ポート（番号が最小）にそろえる。
 * UniFi と同じく、プロファイルを変えると使用中のポートすべてが追従する。
 */
export function syncPortSettings(s: Scenario) {
  const profiles = new Map((s.portProfiles ?? []).map((p) => [p.id, p]));
  for (const d of s.devices) {
    for (const p of d.ports) {
      if (!p.profileId) continue;
      const prof = profiles.get(p.profileId);
      if (!prof) {
        delete p.profileId;
        continue;
      }
      copyProfile(p, prof);
      p.poe = prof.poe;
    }
    const groups = new Map<number, Port[]>();
    for (const p of d.ports) if (p.lag !== undefined) groups.set(p.lag, [...(groups.get(p.lag) ?? []), p]);
    for (const members of groups.values()) {
      const [primary, ...rest] = [...members].sort((a, b) => a.idx - b.idx);
      for (const m of rest) {
        copyProfile(m, primary);
        m.enabled = primary.enabled;
        if (primary.profileId) m.profileId = primary.profileId;
        else delete m.profileId;
      }
    }
  }
  invalidateSwitching(s);
  return s;
}

/** 同じ LAG のポート（自分を含む、番号順） */
export function lagPorts(d: Device, port: Port) {
  return port.lag === undefined ? [port] : d.ports.filter((p) => p.lag === port.lag).sort((a, b) => a.idx - b.idx);
}

// ---------------------------------------------------------------------------
// 計算本体
// ---------------------------------------------------------------------------

const cache = new WeakMap<Scenario, SwitchingState>();

/** 構成をその場で書き換えたあとに呼ぶ（assignLeases から呼ばれる） */
export function invalidateSwitching(s: Scenario) {
  cache.delete(s);
}

export function switchingState(s: Scenario): SwitchingState {
  let st = cache.get(s);
  if (!st) {
    st = compute(s);
    cache.set(s, st);
  }
  return st;
}

function peerOf(s: Scenario, deviceId: string, portId: string): { device: Device; port: Port } | { client: Client } | null {
  for (const l of s.links) {
    const other = l.a.deviceId === deviceId && l.a.portId === portId ? l.b : l.b.deviceId === deviceId && l.b.portId === portId ? l.a : null;
    if (!other) continue;
    const device = findDev(s, other.deviceId);
    const port = device?.ports.find((p) => p.id === other.portId);
    if (device && port) return { device, port };
  }
  const client = s.clients.find((c) => c.connection.type === "wired" && c.connection.deviceId === deviceId && c.connection.portId === portId);
  return client ? { client } : null;
}

function computePoe(s: Scenario, st: SwitchingState) {
  // 受電機器ごとに「給電あり」「給電なし」のポート数を数える。1 本でも給電されれば動く
  const fed = new Map<string, { ok: number; ng: number }>();
  const mark = (id: string, ok: boolean) => {
    const v = fed.get(id) ?? { ok: 0, ng: 0 };
    if (ok) v.ok++;
    else v.ng++;
    fed.set(id, v);
  };
  for (const d of s.devices) {
    const budget = poeBudget(d);
    if (budget <= 0) continue;
    const ps: PoeState = { budget, used: 0, requested: 0, ports: new Map() };
    // ポート番号が小さい順に電力を割り当てる（多くのスイッチの既定の優先順位）
    for (const p of [...d.ports].sort((a, b) => a.idx - b.idx)) {
      const peer = peerOf(s, d.id, p.id);
      if (!peer) continue;
      let load: { id: string; name: string; watts: number } | null = null;
      if ("client" in peer) {
        if (peer.client.poeW) load = { id: `c:${peer.client.id}`, name: peer.client.name, watts: peer.client.poeW };
      } else if (peer.device.type === "ap") {
        load = { id: peer.device.id, name: peer.device.name, watts: apPoeDraw(peer.device) };
      } else if (peer.device.poeDrawW) {
        load = { id: peer.device.id, name: peer.device.name, watts: peer.device.poeDrawW };
      }
      if (!load) continue;
      ps.requested += load.watts;
      const reason: PoePort["reason"] = !p.enabled ? "disabled" : p.poe === "off" ? "off" : ps.used + load.watts > budget ? "budget" : undefined;
      if (!reason) ps.used += load.watts;
      ps.ports.set(p.id, { loadId: load.id, load: load.name, watts: load.watts, powered: !reason, reason });
      mark(load.id, !reason);
    }
    st.poe.set(d.id, ps);
  }
  // PoE 非対応のスイッチにつながる受電機器は AC アダプターで動いているものとする
  const externallyPowered = (id: string) => {
    if (id.startsWith("c:")) return false;
    return s.links.some((l) => {
      const [mine, other] = l.a.deviceId === id ? [l.a, l.b] : l.b.deviceId === id ? [l.b, l.a] : [null, null];
      if (!mine || !other) return false;
      const od = findDev(s, other.deviceId);
      return !!od && poeBudget(od) <= 0;
    });
  };
  for (const [id, v] of fed) {
    if (v.ok > 0 || externallyPowered(id)) continue;
    if (id.startsWith("c:")) st.unpoweredClients.add(id.slice(2));
    else st.unpowered.add(id);
  }
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    const p = this.parent.get(x) ?? x;
    if (p === x) return x;
    const r = this.find(p);
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent.set(ra, rb);
    return true;
  }
}

interface Logical {
  key: string;
  a: string;
  b: string;
  links: Link[];
  mbps: number;
  cost: number;
}

function compute(s: Scenario): SwitchingState {
  const st: SwitchingState = {
    unpowered: new Set(),
    down: new Map(),
    unpoweredClients: new Set(),
    poe: new Map(),
    blocked: new Map(),
    storm: new Set(),
    stormLinks: new Set(),
    roles: new Map(),
    rootId: null,
    lagOf: new Map(),
    lagMembers: new Map(),
  };
  computePoe(s, st);
  for (const d of s.devices) {
    if (!d.state) continue;
    const why =
      d.state === "pending"
        ? `${d.name} は承認待ちです。デバイス画面で承認すると設定が配信され、ネットワークに参加します。`
        : d.state === "adopting"
          ? `${d.name} は承認中（設定を配信中）です。`
          : `${d.name} はファームウェアを更新中のため再起動しています。`;
    st.down.set(d.id, why);
    st.unpowered.add(d.id);
  }

  // --- 有効なリンクを論理リンク（LAG は 1 本）にまとめる ---
  const logical = new Map<string, Logical>();
  for (const l of s.links) {
    if (l.a.deviceId === l.b.deviceId) continue;
    const pa = findPortOf(s, l.a);
    const pb = findPortOf(s, l.b);
    if (!pa || !pb || !pa.enabled || !pb.enabled) continue;
    if (st.unpowered.has(l.a.deviceId) || st.unpowered.has(l.b.deviceId)) continue;
    // 両端で LAG が設定されているときだけ束ねる（片側だけでは別々のリンク = ループ）
    const key =
      pa.lag !== undefined && pb.lag !== undefined
        ? [`${l.a.deviceId}#${pa.lag}`, `${l.b.deviceId}#${pb.lag}`].sort().join("=")
        : l.id;
    const g = logical.get(key);
    const mbps = Math.min(portMbps(pa), portMbps(pb));
    if (g) {
      // LAG は束ねた帯域の合計でコストを決める
      g.mbps += mbps;
      g.cost = pathCost(g.mbps);
      g.links.push(l);
    } else logical.set(key, { key, a: l.a.deviceId, b: l.b.deviceId, links: [l], mbps, cost: pathCost(mbps) });
  }
  for (const g of logical.values()) {
    if (g.links.length < 2) continue;
    st.lagMembers.set(g.key, g.links.map((l) => l.id));
    for (const l of g.links) st.lagOf.set(l.id, g.key);
  }
  const groups = [...logical.values()];

  // --- ルートブリッジとルートまでのコスト（STP を使わない機器はそのまま転送する） ---
  const bridges = s.devices.filter(runsStp);
  const root = bridges.reduce<Device | null>((a, b) => (!a || bridgeKey(b) < bridgeKey(a) ? b : a), null);
  st.rootId = root?.id ?? null;
  const dist = new Map<string, number>();
  const parentLink = new Map<string, string>();
  if (root) {
    dist.set(root.id, 0);
    const done = new Set<string>();
    const tieKey = (id: string) => {
      const d = findDev(s, id);
      return d ? bridgeKey(d) : id;
    };
    for (;;) {
      let cur: string | null = null;
      for (const [id, v] of dist) if (!done.has(id) && (cur === null || v < dist.get(cur)!)) cur = id;
      if (cur === null) break;
      done.add(cur);
      for (const g of groups) {
        const other = g.a === cur ? g.b : g.b === cur ? g.a : null;
        if (!other || done.has(other)) continue;
        const nd = dist.get(cur)! + g.cost;
        const prevLink = parentLink.get(other);
        const prevVia = prevLink ? logical.get(prevLink) : undefined;
        const prevFrom = prevVia ? (prevVia.a === other ? prevVia.b : prevVia.a) : null;
        const better =
          !dist.has(other) ||
          nd < dist.get(other)! ||
          (nd === dist.get(other)! && prevFrom !== null && tieKey(cur) < tieKey(prevFrom));
        if (better) {
          dist.set(other, nd);
          parentLink.set(other, g.key);
        }
      }
    }
  }
  const treeKeys = new Set(parentLink.values());

  // --- ループの検出: 先に「どちらの端も STP を使わない」リンクを入れ、輪になったら STP がブロックする ---
  const stpEnd = (g: Logical) => runsStp(findDev(s, g.a)) || runsStp(findDev(s, g.b));
  const rank = (g: Logical) => (!stpEnd(g) ? 0 : treeKeys.has(g.key) ? 1 : 2);
  const minDist = (g: Logical) => Math.min(dist.get(g.a) ?? Infinity, dist.get(g.b) ?? Infinity);
  groups.sort((x, y) => rank(x) - rank(y) || minDist(x) - minDist(y) || x.cost - y.cost || (x.key < y.key ? -1 : 1));
  const uf = new UnionFind();
  const stormKeys: Logical[] = [];
  const blockedKeys = new Set<string>();
  for (const g of groups) {
    if (uf.union(g.a, g.b)) continue;
    if (!stpEnd(g)) {
      stormKeys.push(g);
      continue;
    }
    // ルートから遠い側（同じなら Bridge ID が大きい側）のポートが代替ポートとしてブロックされる
    const ends = [g.a, g.b].filter((id) => runsStp(findDev(s, id)));
    const far = ends.reduce((a, b) => {
      const da = dist.get(a) ?? Infinity;
      const db = dist.get(b) ?? Infinity;
      if (da !== db) return db > da ? b : a;
      return bridgeKey(findDev(s, b)!) > bridgeKey(findDev(s, a)!) ? b : a;
    });
    blockedKeys.add(g.key);
    for (const l of g.links) st.blocked.set(l.id, l.a.deviceId === far ? l.a : l.b);
  }

  // --- ストーム: ループを含む（ブロックされていないリンクでつながる）範囲全体 ---
  if (stormKeys.length) {
    const live = groups.filter((g) => !blockedKeys.has(g.key));
    const seeds = stormKeys.map((g) => g.a);
    const seen = new Set<string>(seeds);
    const q = [...seeds];
    while (q.length) {
      const cur = q.shift()!;
      for (const g of live) {
        const other = g.a === cur ? g.b : g.b === cur ? g.a : null;
        if (other && !seen.has(other)) {
          seen.add(other);
          q.push(other);
        }
      }
    }
    st.storm = seen;
    // ループを構成するリンク（輪の上にあるもの）: 両端がストーム範囲で、木に入れても輪になるもの
    const uf2 = new UnionFind();
    for (const g of live) if (!stormKeys.includes(g)) uf2.union(g.a, g.b);
    for (const g of stormKeys) for (const l of g.links) st.stormLinks.add(l.id);
    for (const g of live) {
      if (stormKeys.includes(g) || !seen.has(g.a)) continue;
      // 輪の一部か: このリンクを外しても両端がつながっていれば輪の上にある
      const uf3 = new UnionFind();
      for (const h of live) if (h !== g) uf3.union(h.a, h.b);
      if (uf3.find(g.a) === uf3.find(g.b)) for (const l of g.links) st.stormLinks.add(l.id);
    }
  }

  // --- ポートの役割 ---
  for (const g of groups) {
    for (const l of g.links) {
      for (const end of [l.a, l.b]) {
        const dev = findDev(s, end.deviceId);
        let role: StpRole = "forwarding";
        if (st.blocked.get(l.id)?.deviceId === end.deviceId && st.blocked.get(l.id)?.portId === end.portId) role = "blocked";
        else if (runsStp(dev)) role = parentLink.get(end.deviceId) === g.key ? "root" : "designated";
        st.roles.set(portKey(end.deviceId, end.portId), role);
      }
    }
  }
  return st;
}

// ---------------------------------------------------------------------------
// simulate.ts から使う問い合わせ
// ---------------------------------------------------------------------------

/** L2 フレームがこの物理リンクを通れるか（STP ブロック・電源断を除外） */
export function linkForwards(s: Scenario, l: Link) {
  const st = switchingState(s);
  return !st.blocked.has(l.id) && !st.unpowered.has(l.a.deviceId) && !st.unpowered.has(l.b.deviceId);
}

export const portRole = (s: Scenario, deviceId: string, portId: string) => switchingState(s).roles.get(portKey(deviceId, portId));

/** ストームが起きている範囲での通信失敗の理由 */
export function stormReason(s: Scenario, deviceIds: string[]): string | null {
  const st = switchingState(s);
  if (!deviceIds.some((id) => st.storm.has(id))) return null;
  const names = [...new Set(
    [...st.stormLinks].flatMap((id) => {
      const l = s.links.find((x) => x.id === id);
      return l ? [l.a.deviceId, l.b.deviceId] : [];
    }),
  )].map((id) => findDev(s, id)?.name ?? id);
  return `ブロードキャストストーム: ${names.join("・")} の間のケーブルがループしています。STP が無効なためフレームが回り続け、この範囲の通信がすべて止まっています。STP を有効にするか、余分なケーブルを外すか、LAG にまとめてください。`;
}

export function poweredOffReason(s: Scenario, deviceId: string): string | null {
  const down = switchingState(s).down.get(deviceId);
  if (down) return down;
  if (!switchingState(s).unpowered.has(deviceId)) return null;
  const d = findDev(s, deviceId);
  return `${d?.name ?? deviceId} の電源が入っていません（PoE 給電なし）。${poeHint(s, deviceId)}`;
}

export function clientPoweredOffReason(s: Scenario, clientId: string): string | null {
  if (!switchingState(s).unpoweredClients.has(clientId)) return null;
  const c = s.clients.find((x) => x.id === clientId);
  return `${c?.name ?? clientId} は PoE の給電がないため起動していません。${poeHint(s, `c:${clientId}`)}`;
}

function poeHint(s: Scenario, loadId: string) {
  const st = switchingState(s);
  for (const [devId, ps] of st.poe) {
    const d = findDev(s, devId)!;
    for (const [portId, pp] of ps.ports) {
      if (pp.powered || pp.loadId !== loadId) continue;
      const port = d.ports.find((p) => p.id === portId);
      if (pp.reason === "off") return `${d.name} / ${port?.name} の PoE がオフです。`;
      if (pp.reason === "disabled") return `${d.name} / ${port?.name} が無効です。`;
      return `${d.name} の PoE 電力予算 ${ps.budget} W を使い切っています（要求 ${ps.requested} W）。不要なポートの PoE をオフにしてください。`;
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// 設定の注意点
// ---------------------------------------------------------------------------

export function switchingIssues(s: Scenario): Issue[] {
  const out: Issue[] = [];
  const st = switchingState(s);
  const storm = stormReason(s, [...st.storm]);
  if (storm) {
    const first = [...st.stormLinks][0];
    out.push({
      severity: "error",
      area: "devices",
      targetId: s.links.find((l) => l.id === first)?.a.deviceId,
      message: "ネットワークのループでブロードキャストストームが発生しています",
      hint: storm.replace(/^ブロードキャストストーム: /, ""),
    });
  }
  for (const [devId, ps] of st.poe) {
    const d = findDev(s, devId)!;
    const short = [...ps.ports.values()].filter((p) => p.reason === "budget");
    if (short.length)
      out.push({
        severity: "error",
        area: "devices",
        targetId: devId,
        message: `${d.name}: PoE の電力が足りず ${short.map((p) => p.load).join("・")} に給電できません（${ps.used} / ${ps.budget} W 使用中、要求 ${ps.requested} W）`,
        hint: "PoE が不要なポートを「オフ」にするか、電力予算の大きいスイッチに替えます。",
      });
  }
  // LAG が片側だけ: 別々のリンクとして扱われ、STP がブロックする（またはループする）
  for (const l of s.links) {
    const pa = findPortOf(s, l.a);
    const pb = findPortOf(s, l.b);
    if (!pa || !pb || (pa.lag === undefined) === (pb.lag === undefined)) continue;
    const [lagDev, lagPort, other] = pa.lag !== undefined ? [l.a.deviceId, pa, l.b.deviceId] : [l.b.deviceId, pb, l.a.deviceId];
    out.push({
      severity: "warning",
      area: "devices",
      targetId: lagDev,
      message: `${findDev(s, lagDev)?.name} / ${lagPort.name} は LAG ですが、対向の ${findDev(s, other)?.name} 側は LAG になっていません`,
      hint: "LAG は両端で同じ本数のポートを束ねます。片側だけでは別々のケーブルとして扱われ、ループになります。",
    });
  }
  return out;
}
