import type {
  Client,
  Device,
  FirewallPolicy,
  Link,
  Network,
  Port,
  Protocol,
  Scenario,
  WanId,
  WifiSsid,
} from "../model";
import { CONNECT_DBM, rssiAt } from "../floor";
import { negotiatedWifiSecurity, wifiAuthError, wifiMode, wifiSupports6GHz } from "../wifi-security";
import { GUEST_PORTAL_REQUIRED, pendingGuestPortal } from "../wifi";
import { apInterference, apRadio, isMeshEdge, meshHop, radioHash, radioRate } from "./wifi-radio";
import { inSubnet, ipToStr, isHostAddr, parseCidr, parseIp } from "./ip";
import { formatIpv6, inIpv6Subnet, INTERNET_IP6, ipv6Gateway, isGlobalIpv6, lanIpv6Prefix, parseIpv6, parseIpv6Cidr, slaacAddress, type IpFamily } from "./ipv6";
import { inspectTraffic, type SecurityDecision } from "./security";
import { EXTERNAL_TEST_IP, INTERNET_IP, WAN_IPS, WAN_NAMES, chooseWan, gatewayRoute, isPrivateIp, QOS_LABELS, wanBandwidth, wanSettings } from "./gateway";
import { listensOn } from "./services";
import { clientPoweredOffReason, linkForwards, poweredOffReason, stormReason, switchingState, syncPortSettings } from "./switching";

// ---------------------------------------------------------------------------
// 基本ヘルパー
// ---------------------------------------------------------------------------

export type Carry = "untagged" | "tagged" | null;

/** ポートがネットワークをどの形で運ぶか */
export function carries(port: Port, netId: string): Carry {
  if (!port.enabled) return null;
  if (port.nativeNetworkId === netId) return "untagged";
  if (port.tagged === "all" || (port.tagged === "custom" && port.taggedNetworkIds.includes(netId))) return "tagged";
  return null;
}

export const findDevice = (s: Scenario, id: string) =>
  s.devices.find((d) => d.id === id);
export const findPort = (s: Scenario, deviceId: string, portId: string) =>
  findDevice(s, deviceId)?.ports.find((p) => p.id === portId);
export const findNetwork = (s: Scenario, id: string | null | undefined) =>
  id ? s.networks.find((n) => n.id === id) : undefined;
export const findGateway = (s: Scenario) =>
  s.devices.find((d) => d.type === "gateway");

export const netLabel = (n: Network) => `${n.name} (VLAN ${n.vlanId})`;

function portLabel(s: Scenario, deviceId: string, portId: string) {
  const d = findDevice(s, deviceId);
  const p = d?.ports.find((x) => x.id === portId);
  return `${d?.name ?? "?"} / ${p?.name ?? "?"}`;
}

// ---------------------------------------------------------------------------
// L2 経路探索
// ---------------------------------------------------------------------------

export type L2Result =
  | { ok: true; deviceIds: string[]; linkIds: string[] }
  | { ok: false; reason: string; failLinkIds: string[]; deviceIds: string[]; linkIds: string[] };

function linkCheck(s: Scenario, link: Link, netId: string | null) {
  const pa = findPort(s, link.a.deviceId, link.a.portId);
  const pb = findPort(s, link.b.deviceId, link.b.portId);
  if (!pa || !pb) return { ok: false, reason: "ポートが存在しません" };
  if (netId === null) return { ok: true, reason: "" };
  const ca = carries(pa, netId);
  const cb = carries(pb, netId);
  if (ca && ca === cb) return { ok: true, reason: "" };
  const net = findNetwork(s, netId);
  const v = net ? `VLAN ${net.vlanId}` : "このネットワーク";
  const la = portLabel(s, link.a.deviceId, link.a.portId);
  const lb = portLabel(s, link.b.deviceId, link.b.portId);
  if (!ca && !cb)
    return { ok: false, reason: `${la} と ${lb} の両方で ${v} が許可されていません。` };
  if (!ca || !cb) {
    const bad = !ca ? la : lb;
    return {
      ok: false,
      reason: `${bad} で ${v} が許可されていません。タグ付き VLAN の管理 に追加するか、ネイティブ VLAN を合わせてください。`,
    };
  }
  return {
    ok: false,
    reason: `タグの不一致: ${la} では ${v} が ${ca === "tagged" ? "タグ付き" : "ネイティブ（タグなし）"}、${lb} では ${cb === "tagged" ? "タグ付き" : "ネイティブ（タグなし）"} です。両端で同じ扱いにする必要があります。`,
  };
}

function bfs(s: Scenario, from: string, to: string, netId: string | null) {
  const meshAps = s.devices.filter((d) => d.type === "ap" && d.meshParentId);
  const meshIds = new Set(meshAps.map((d) => d.id));
  const mesh = meshAps.flatMap((d) => meshHop(s, d) ?? []);
  const prev = new Map<string, { dev: string; link: string } | null>();
  prev.set(from, null);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === to) break;
    for (const l of s.links) {
      // STP でブロックされたリンク・電源の入っていない機器は通れない
      if (!linkForwards(s, l)) continue;
      const other =
        l.a.deviceId === cur ? l.b.deviceId : l.b.deviceId === cur ? l.a.deviceId : null;
      if (!other || prev.has(other)) continue;
      if (meshIds.has(cur) || meshIds.has(other)) continue;
      if (netId === null && meshIds.has(to) && (!findPort(s, l.a.deviceId, l.a.portId)?.enabled || !findPort(s, l.b.deviceId, l.b.portId)?.enabled)) continue;
      if (!linkCheck(s, l, netId).ok) continue;
      prev.set(other, { dev: cur, link: l.id });
      q.push(other);
    }
    for (const l of mesh) {
      const other = l.child.id === cur ? l.parent.id : l.parent.id === cur ? l.child.id : null;
      if (!other || prev.has(other)) continue;
      prev.set(other, { dev: cur, link: l.id });
      q.push(other);
    }
  }
  if (!prev.has(to)) return null;
  const deviceIds: string[] = [];
  const linkIds: string[] = [];
  let cur: string | undefined = to;
  while (cur) {
    deviceIds.unshift(cur);
    const p = prev.get(cur);
    if (!p) break;
    linkIds.unshift(p.link);
    cur = p.dev;
  }
  return { deviceIds, linkIds };
}

/** ゲートウェイからの物理的な経路と、その機器の上流（アップリンク）ポート */
export function uplinkOf(s: Scenario, deviceId: string) {
  const gw = findGateway(s);
  if (!gw) return { online: false as const };
  if (gw.id === deviceId) return { online: true as const };
  const path = bfs(s, gw.id, deviceId, null);
  if (!path) return { online: false as const };
  const ap = findDevice(s, deviceId);
  const wireless = ap?.meshParentId ? meshHop(s, ap) : null;
  if (wireless) return {
    online: true as const,
    parentId: wireless.parent.id,
    parentName: wireless.parent.name,
    parentPort: "メッシュ (5 GHz)",
    ownPort: "メッシュ (5 GHz)",
  };
  const link = s.links.find((l) => l.id === path.linkIds[path.linkIds.length - 1])!;
  const [mine, parent] = link.a.deviceId === deviceId ? [link.a, link.b] : [link.b, link.a];
  return {
    online: true as const,
    parentId: parent.deviceId,
    parentName: findDevice(s, parent.deviceId)?.name ?? "?",
    parentPort: findPort(s, parent.deviceId, parent.portId)?.name ?? "?",
    ownPort: findPort(s, deviceId, mine.portId)?.name ?? "?",
  };
}

/** 機器 from から to まで、ネットワーク netId のフレームが届くか */
export function l2Path(s: Scenario, netId: string, from: string, to: string): L2Result {
  const off = poweredOffReason(s, from) ?? poweredOffReason(s, to);
  if (off) return { ok: false, reason: off, failLinkIds: [], deviceIds: [from], linkIds: [] };
  const storm = stormReason(s, [from, to]);
  if (storm) return { ok: false, reason: storm, failLinkIds: [...switchingState(s).stormLinks], deviceIds: [from], linkIds: [] };
  const ok = bfs(s, from, to, netId);
  if (ok) return { ok: true, ...ok };
  const phys = bfs(s, from, to, null);
  if (!phys) {
    return {
      ok: false,
      reason: `${findDevice(s, from)?.name} から ${findDevice(s, to)?.name} へのリンク経路がありません。`,
      failLinkIds: [],
      deviceIds: [from],
      linkIds: [],
    };
  }
  // 物理経路上で最初に通れないリンクを探す
  for (let i = 0; i < phys.linkIds.length; i++) {
    const link = s.links.find((l) => l.id === phys.linkIds[i]);
    if (!link) continue; // メッシュは親 AP の Ethernet 側まで VLAN を透過する
    const r = linkCheck(s, link, netId);
    if (!r.ok) {
      return {
        ok: false,
        reason: r.reason,
        failLinkIds: [link.id],
        deviceIds: phys.deviceIds.slice(0, i + 1),
        linkIds: phys.linkIds.slice(0, i),
      };
    }
  }
  return { ok: false, reason: "経路が見つかりません。", failLinkIds: [], deviceIds: [from], linkIds: [] };
}

// ---------------------------------------------------------------------------
// Wi-Fi の無線
// ---------------------------------------------------------------------------

export type Band = "2.4" | "5" | "6";

/** 端末の種類ごとの対応周波数帯 */
export function clientBands(c: Client): Band[] {
  if (c.kind === "iot") return ["2.4"];
  if (c.kind === "phone") return ["2.4", "5", "6"];
  return ["2.4", "5"];
}

function commonWifiBands(c: Client, ssid: WifiSsid) {
  const supported = clientBands(c);
  const allows6GHz = wifiSupports6GHz(negotiatedWifiSecurity(ssid.security, c));
  return (["6", "5", "2.4"] as Band[]).filter((b) => (b !== "6" || allows6GHz) && ssid.bands.includes(b) && supported.includes(b));
}

// --- フロアプラン上の電波 -------------------------------------------------------

export const isPositional = (s: Scenario, c: Client) => !!s.floor && !!c.pos;

function clientSignal(s: Scenario, c: Client, ssid: WifiSsid, ap: Device) {
  const common = commonWifiBands(c, ssid);
  if (!common.length) return null;
  const { floor } = s;
  const { pos } = c;
  if (!floor || !pos || !ap.pos) return syntheticSignal(c, ap.id, common[0]);
  const links = common.map((band) => ({ band, rssi: rssiAt(floor, ap, pos, band) }));
  return links.find((l) => l.rssi >= -70) ?? links.reduce((a, b) => (b.rssi > a.rssi ? b : a));
}

/** 位置と電波から、端末と AP の無線リンクを求める（よい帯域を優先、弱ければ 2.4 GHz に落ちる） */
export function radioLink(s: Scenario, c: Client, ssid: WifiSsid, apId: string) {
  const ap = findDevice(s, apId);
  if (!ap || ap.type !== "ap") return null;
  const signal = clientSignal(s, c, ssid, ap);
  if (!signal) return null;
  const { band, rssi } = signal;
  const radio = apRadio(ap, band);
  const interference = c.pos && ap.pos ? apInterference(s, ap, band, c.pos) : { neighbors: 0, airtime: 1 };
  return { ...signal, ...radio, neighbors: interference.neighbors, rate: radioRate(band, radio.width, rssi, interference.airtime) };
}

/** その SSID を配信している AP のうち、電波が最も強いものを選ぶ */
export function associate(s: Scenario, c: Client, ssid: WifiSsid): { ok: true; ap: Device; rssi: number } | { ok: false; reason: string; best?: { ap: Device; rssi: number } } {
  const aps = s.devices.filter((d) => d.type === "ap" && broadcasts(ssid, d.id) && !switchingState(s).unpowered.has(d.id));
  if (!aps.length) {
    const off = s.devices.find((d) => d.type === "ap" && broadcasts(ssid, d.id));
    if (off) return { ok: false, reason: poweredOffReason(s, off.id) ?? `${off.name} が停止しています。` };
    return { ok: false, reason: `SSID「${ssid.name}」はどの AP からも配信されていません（配信 AP の設定）。` };
  }
  const cands = aps.flatMap((ap) => {
    const l = clientSignal(s, c, ssid, ap);
    if (ap.meshParentId && !uplinkOf(s, ap.id).online) return [];
    return l ? [{ ap, rssi: l.rssi }] : [];
  });
  if (!cands.length && aps.every((ap) => ap.meshParentId && !uplinkOf(s, ap.id).online)) return { ok: false, reason: `SSID「${ssid.name}」を配信する AP のメッシュアップリンクが利用できません。` };
  if (!cands.length) return { ok: false, reason: `この端末は ${clientBands(c).join(" / ")} GHz のみ対応ですが、SSID「${ssid.name}」は ${ssid.bands.join(" / ")} GHz で配信されています。端末から SSID が見えません。` };
  const best = cands.reduce((a, b) => (b.rssi > a.rssi ? b : a));
  if (best.rssi < CONNECT_DBM)
    return { ok: false, best, reason: `SSID「${ssid.name}」の電波が弱すぎて接続できません（最も近い配信元 ${best.ap.name}: ${best.rssi} dBm）。端末を AP に近づけるか、この場所をカバーする AP から配信しましょう。` };
  return { ok: true, ap: best.ap, rssi: best.rssi };
}

/** SSID がその AP から配信されているか（配信 AP） */
export function broadcasts(ssid: WifiSsid, apId: string) {
  return !ssid.apIds || ssid.apIds.includes(apId);
}

function syntheticSignal(c: Client, apId: string, band: Band) {
  const h = radioHash(c.id + apId);
  const rssi = -42 - (h % 24) + (band === "2.4" ? 6 : band === "6" ? -5 : 0);
  return { band, rssi };
}

/** 位置情報がないときの無線リンク。SSID の周波数帯との互換性の判定にも使う。 */
export function wifiLink(c: Client, ssid: WifiSsid, apId: string) {
  const [band] = commonWifiBands(c, ssid);
  if (!band) return null;
  const signal = syntheticSignal(c, apId, band);
  const radio = apRadio({ id: apId }, band);
  return { ...signal, ...radio, neighbors: 0, rate: radioRate(band, radio.width, signal.rssi) };
}

// ---------------------------------------------------------------------------
// クライアントの所属ネットワークと IP
// ---------------------------------------------------------------------------

export interface ClientState {
  client: Client;
  network?: Network;
  /** クライアントが接続している機器 */
  attachDeviceId?: string;
  how?: string;
  ip?: string;
  /** ゲートウェイまでの L2 経路 */
  toGateway?: L2Result;
  error?: string;
  errorStage?: "attach" | "ip";
  wifiAuthFailed?: true;
  guestPortal?: WifiSsid;
  /** 古いネットワークで取得した IP を使い続けている */
  staleLease?: boolean;
}

export function ipv6ClientState(state: ClientState): ClientState {
  if (state.errorStage === "attach" || !state.network) return state;
  const ip = state.toGateway?.ok ? slaacAddress(state.network, state.client) : undefined;
  const error = ip ? undefined : state.toGateway?.ok
    ? `${state.network.name} で IPv6 プレフィックスが設定されていません。`
    : "IPv6 ルーター広告が端末に届きません。";
  return { ...state, ip, error, errorStage: error ? "ip" : undefined, staleLease: undefined };
}

export function resolveClient(s: Scenario, clientId: string): ClientState {
  const client = s.clients.find((c) => c.id === clientId);
  if (!client) throw new Error(`client ${clientId} not found`);
  const st: ClientState = { client };
  const c = client.connection;

  if (c.type === "wired") {
    if (!c.deviceId || !c.portId) return { ...st, error: "LAN ケーブルが接続されていません。", errorStage: "attach" };
    const dev = findDevice(s, c.deviceId);
    const port = dev?.ports.find((p) => p.id === c.portId);
    if (!dev || !port) {
      return { ...st, error: "接続先のポートが存在しません。", errorStage: "attach" };
    }
    if (!port.enabled) {
      st.attachDeviceId = dev.id;
      return { ...st, error: `${dev.name} / ${port.name} が無効化されています。`, errorStage: "attach" };
    }
    st.attachDeviceId = dev.id;
    const off = clientPoweredOffReason(s, client.id);
    if (off) return { ...st, error: off, errorStage: "attach" };
    const net = findNetwork(s, port.nativeNetworkId);
    if (!net) {
      return {
        ...st,
        error: `${dev.name} / ${port.name} に ネイティブ VLAN が設定されていません。端末はタグなしフレームを送るため、どの VLAN にも入れません。`,
        errorStage: "attach",
      };
    }
    st.network = net;
    st.how = `${dev.name} / ${port.name}`;
  } else {
    if (c.ssidId === null) return { ...st, error: "Wi-Fi に接続していません。", errorStage: "attach" };
    const ssid = s.ssids.find((x) => x.id === c.ssidId);
    if (!ssid) return { ...st, error: "接続先の SSID が存在しません。", errorStage: "attach" };
    let ap: Device | undefined;
    if (isPositional(s, client)) {
      // フロアプランあり: 電波が最も強い AP に接続する（ローミング）
      const as = associate(s, client, ssid);
      if (!as.ok) return { ...st, error: as.reason, errorStage: "attach" };
      ap = as.ap;
    } else {
      ap = findDevice(s, c.apId);
      if (!ap || ap.type !== "ap") return { ...st, error: "接続先の AP が存在しません。", errorStage: "attach" };
      if (ap.meshParentId && !uplinkOf(s, ap.id).online) return { ...st, error: `${ap.name} のメッシュアップリンクが利用できません。`, errorStage: "attach" };
      if (!broadcasts(ssid, ap.id)) {
        return { ...st, error: `${ap.name} は SSID「${ssid.name}」を配信していません（配信 AP の設定）。`, errorStage: "attach" };
      }
    }
    const apOff = poweredOffReason(s, ap.id);
    if (apOff) return { ...st, error: apOff, errorStage: "attach" };
    if (!wifiLink(client, ssid, ap.id)) {
      return {
        ...st,
        error: `この端末は ${clientBands(client).join(" / ")} GHz のみ対応ですが、SSID「${ssid.name}」は ${ssid.bands.join(" / ")} GHz で配信されています。端末から SSID が見えません。`,
        errorStage: "attach",
      };
    }
    const mode = negotiatedWifiSecurity(ssid.security, client);
    if (wifiMode(mode).requiresWpa3 && !client.wpa3) {
      return { ...st, error: `この端末は WPA3 に対応していないため、SSID「${ssid.name}」に接続できません。`, errorStage: "attach" };
    }
    if (client.wifiLegacyOnly && !["open", "wep", "wpa", "wpa-enterprise"].includes(mode)) {
      return { ...st, error: "この端末は WEP / 初代 WPA まで対応します。", errorStage: "attach" };
    }
    const reason = wifiAuthError(ssid, client);
    if (reason) {
      return { ...st, error: `SSID「${ssid.name}」の認証に失敗しました（${reason}）。`, errorStage: "attach", wifiAuthFailed: true };
    }
    st.attachDeviceId = ap.id;
    const net = findNetwork(s, ssid.networkId);
    if (!net) {
      return { ...st, error: `SSID「${ssid.name}」にネットワークが割り当てられていません。`, errorStage: "attach" };
    }
    st.network = net;
    st.how = `${ap.name} · ${ssid.name}`;
    st.guestPortal = pendingGuestPortal(s, client);
  }

  const net = st.network!;
  const sn = parseCidr(net.cidr);
  const gw = findGateway(s);
  st.toGateway = gw
    ? l2Path(s, net.id, st.attachDeviceId!, gw.id)
    : { ok: false, reason: "ゲートウェイがありません。", failLinkIds: [], deviceIds: [], linkIds: [] };

  if (!sn) return { ...st, error: `${net.name} のサブネット (${net.cidr}) が不正です。`, errorStage: "ip" };

  if (client.ipMode === "static") {
    const ip = parseIp(client.staticIp);
    if (ip === null) return { ...st, error: `固定 IP「${client.staticIp}」が不正な形式です。`, errorStage: "ip" };
    if (!isHostAddr(ip, sn)) {
      return {
        ...st,
        ip: client.staticIp,
        error: `固定 IP ${client.staticIp} は ${net.name} のサブネット ${net.cidr} の範囲外（またはネットワーク/ブロードキャストアドレス）です。`,
        errorStage: "ip",
      };
    }
    if (ipToStr(ip) === net.gatewayIp) {
      return { ...st, ip: client.staticIp, error: `固定 IP がゲートウェイ ${net.gatewayIp} と重複しています。`, errorStage: "ip" };
    }
    const mine = client.staticIp.trim();
    const dup = s.clients.find(
      (o) => o.id !== client.id && ((o.ipMode === "static" && o.staticIp.trim() === mine) || (o.ipMode === "dhcp" && o.lease?.ip === mine)),
    );
    if (dup) return { ...st, ip: client.staticIp, error: `固定 IP が「${dup.name}」と重複しています。`, errorStage: "ip" };
    return { ...st, ip: ipToStr(ip) };
  }

  // DHCP: すでにリースを持っていれば、再接続するまでそれを使い続ける
  if (client.lease) {
    const leased = parseIp(client.lease.ip);
    if (client.lease.networkId === net.id && leased !== null && inSubnet(leased, sn)) return { ...st, ip: client.lease.ip };
    const prev = findNetwork(s, client.lease.networkId);
    return {
      ...st,
      ip: client.lease.ip,
      staleLease: true,
      error: `IP ${client.lease.ip} は以前のネットワーク${prev ? ` ${prev.name}` : ""} で取得したリースです。現在は ${net.name} (${net.cidr}) につながっているため通信できません。DHCP を更新 (Renew) するか、接続し直してください。`,
      errorStage: "ip",
    };
  }
  if (!net.dhcp.enabled) {
    return { ...st, error: `${net.name} で DHCP サーバーが無効です。IP アドレスを取得できません。`, errorStage: "ip" };
  }
  if (!st.toGateway.ok) {
    return {
      ...st,
      error: `DHCP 要求がゲートウェイ (DHCP サーバー) に届きません: ${st.toGateway.reason}`,
      errorStage: "ip",
    };
  }
  const start = parseIp(net.dhcp.start);
  const end = parseIp(net.dhcp.end);
  if (start === null || end === null || start > end || !inSubnet(start, sn) || !inSubnet(end, sn)) {
    return { ...st, error: `${net.name} の DHCP 範囲 (${net.dhcp.start} - ${net.dhcp.end}) が不正です。`, errorStage: "ip" };
  }
  const reserved = new Set<number>();
  const gwIp = parseIp(net.gatewayIp);
  if (gwIp !== null) reserved.add(gwIp);
  for (const o of s.clients) {
    if (o.id === client.id) continue;
    const n = o.ipMode === "static" ? parseIp(o.staticIp) : o.lease ? parseIp(o.lease.ip) : null;
    if (n !== null) reserved.add(n);
    // 他の端末の DHCP 予約もプールから除外する
    const r = o.ipMode === "dhcp" && o.reservedIp ? parseIp(o.reservedIp) : null;
    if (r !== null) reserved.add(r);
  }
  // DHCP 予約: この端末には常に決まった IP を配る
  if (client.reservedIp) {
    const r = parseIp(client.reservedIp);
    if (r === null || !isHostAddr(r, sn) || r === gwIp)
      return { ...st, error: `DHCP 予約の IP ${client.reservedIp} は ${net.name} (${net.cidr}) で使えません。`, errorStage: "ip" };
    if (reserved.has(r)) return { ...st, error: `DHCP 予約の IP ${client.reservedIp} は他の端末が使用中です。`, errorStage: "ip" };
    return { ...st, ip: ipToStr(r) };
  }
  // まだリースを持たない端末同士で、順番にプールから割り当てる
  const sameNetDhcp = s.clients.filter((o) => {
    if (o.ipMode !== "dhcp" || o.lease) return false;
    if (o.id === client.id) return true;
    return clientNetworkId(s, o) === net.id;
  });
  const idx = sameNetDhcp.findIndex((o) => o.id === client.id);
  let n = 0;
  for (let ip = start; ip <= end; ip++) {
    if (reserved.has(ip) || !isHostAddr(ip, sn)) continue;
    if (n === idx) return { ...st, ip: ipToStr(ip) };
    n++;
  }
  return { ...st, error: `${net.name} の DHCP プールが枯渇しています（範囲が狭すぎます）。`, errorStage: "ip" };
}

/**
 * DHCP の再試行: リースを持たない DHCP 端末が IP を取得できる状態なら、リースを確定させる。
 * 実機の DHCP クライアントが定期的に再要求するのと同じ振る舞い。
 */
export function assignLeases(s: Scenario): Scenario {
  // ポートプロファイル・LAG の設定をポートへ反映し、STP / PoE を計算し直す
  syncPortSettings(s);
  for (const c of s.clients) {
    if (c.ipMode !== "dhcp") {
      c.lease = null;
      continue;
    }
    if (c.lease) continue;
    const st = resolveClient(s, c.id);
    if (st.ip && !st.error && st.network) c.lease = { ip: st.ip, networkId: st.network.id };
  }
  return s;
}

/** IP 解決をしない軽量版: クライアントのネットワーク ID */
export function clientNetworkId(s: Scenario, c: Client): string | null {
  if (c.connection.type === "wired") {
    const conn = c.connection;
    return conn.deviceId && conn.portId ? (findPort(s, conn.deviceId, conn.portId)?.nativeNetworkId ?? null) : null;
  }
  const conn = c.connection;
  return conn.ssidId ? (s.ssids.find((x) => x.id === conn.ssidId)?.networkId ?? null) : null;
}

// ---------------------------------------------------------------------------
// ファイアウォール (ゾーンベース)
// ---------------------------------------------------------------------------

/** 宛先。clientId があれば端末単位のポリシーにも一致させる */
export type Dest = { kind: "network"; id: string; clientId?: string } | { kind: "internet" | "vpn" };

/** ポリシーの送信元/宛先: "any" / ネットワーク ID / "client:<端末 ID>" */
export const CLIENT_REF = "client:";
export const isClientRef = (ref: string) => ref.startsWith(CLIENT_REF);
export const clientRef = (id: string) => `${CLIENT_REF}${id}`;

export const zoneOfNetwork = (s: Scenario, netId: string) => findNetwork(s, netId)?.zoneId ?? "internal";
export const zoneName = (s: Scenario, id: string) => s.zones.find((z) => z.id === id)?.name ?? id;

/** ゾーン間の既定ポリシー（ユーザー定義のポリシーに一致しなかったとき） */
export function zoneDefault(srcZone: string, dstZone: string): "allow" | "block" {
  if (srcZone === "external") return "block";
  if (srcZone === "gateway") return "allow";
  if (dstZone === "gateway" || dstZone === "external") return "allow";
  if (srcZone === "internal" || srcZone === "vpn") return ["internal", "vpn", "dmz"].includes(dstZone) ? "allow" : "block";
  if (srcZone === "dmz") return dstZone === "dmz" ? "allow" : "block";
  return "block";
}

/** ポリシー判定の対象となる 1 つの通信 */
export interface Flow {
  srcZone: string;
  srcNetId: string | null;
  srcClientId: string | null;
  srcIp: string | null;
  dstZone: string;
  dstNetId: string | null;
  dstClientId: string | null;
  dstIp: string | null;
  protocol: Protocol;
  port: number | null;
  /** new = 新規の接続 / established = 確立済み接続の戻りの通信 */
  state: "new" | "established";
}

export const GROUP_REF = "group:";
export const isGroupRef = (ref: string) => ref.startsWith(GROUP_REF);
export const findObject = (s: Scenario, ref: string) => s.objects?.find((o) => `${GROUP_REF}${o.id}` === ref);

/** 送信元/宛先の参照が通信の端点に一致するか */
function refMatches(s: Scenario, ref: string, netId: string | null, clientId: string | null, ip: string | null) {
  if (ref === "any") return true;
  if (isClientRef(ref)) return !!clientId && ref === clientRef(clientId);
  if (isGroupRef(ref)) {
    const o = findObject(s, ref);
    if (!o) return false;
    if (o.kind === "devices") return !!clientId && o.values.includes(clientId);
    if (o.kind === "ips" && ip) {
      const ipv6 = parseIpv6(ip);
      if (ipv6 !== null) return o.values.some((value) => {
        const prefix = parseIpv6Cidr(value);
        return prefix ? inIpv6Subnet(ipv6, prefix) : ipv6 === parseIpv6(value);
      });
      const n = parseIp(ip);
      return n !== null && o.values.some((v) => (v.includes("/") ? !!parseCidr(v) && inSubnet(n, parseCidr(v)!) : v.trim() === ip));
    }
    return false;
  }
  return ref === netId;
}

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const DEFAULT_CLOCK = { day: 1, time: "12:00" };

/** スケジュールが現在時刻（シミュレーション上）に有効か。日をまたぐ範囲にも対応 */
export function scheduleActive(sch: FirewallPolicy["schedule"], clock = DEFAULT_CLOCK) {
  if (!sch) return true;
  const now = toMin(clock.time);
  const start = toMin(sch.start);
  const end = toMin(sch.end);
  if (start === end) return sch.days.includes(clock.day);
  if (start < end) return sch.days.includes(clock.day) && now >= start && now < end;
  // 22:00〜06:00 のように日をまたぐ: 開始日の夜 or 翌日の朝
  return (sch.days.includes(clock.day) && now >= start) || (sch.days.includes((clock.day + 6) % 7) && now < end);
}

export function policyMatches(s: Scenario, p: FirewallPolicy, f: Flow): boolean {
  if (!p.enabled) return false;
  if (p.srcZone !== f.srcZone || p.dstZone !== f.dstZone) return false;
  const st = p.connState ?? "all";
  if (st !== "all" && st !== f.state) return false;
  if (!scheduleActive(p.schedule, s.clock ?? DEFAULT_CLOCK)) return false;
  if (!refMatches(s, p.src, f.srcNetId, f.srcClientId, f.srcIp)) return false;
  if (!refMatches(s, p.dst, f.dstNetId, f.dstClientId, f.dstIp)) return false;
  if (p.protocol !== "all" && p.protocol !== f.protocol) return false;
  if (p.portListId) {
    const list = s.objects?.find((o) => o.id === p.portListId);
    if (f.protocol === "icmp" || f.port === null || !list?.values.includes(String(f.port))) return false;
  } else if (p.port !== null && (f.protocol === "icmp" || f.port !== p.port)) return false;
  return true;
}

export interface FirewallVerdict {
  allowed: boolean;
  policy?: FirewallPolicy;
  index: number;
  srcZone: string;
  dstZone: string;
}

/** 通信を評価: 上から順に最初に一致したポリシー。なければ新規はゾーン既定、戻りは許可（ステートフル） */
export function evalFlow(s: Scenario, f: Flow): FirewallVerdict {
  const index = s.policies.findIndex((p) => policyMatches(s, p, f));
  if (index >= 0) return { allowed: s.policies[index].action === "allow", policy: s.policies[index], index, srcZone: f.srcZone, dstZone: f.dstZone };
  return { allowed: f.state === "established" ? true : zoneDefault(f.srcZone, f.dstZone) === "allow", index: -1, srcZone: f.srcZone, dstZone: f.dstZone };
}

/** 互換用: ネットワーク間の新規通信を評価 */
export function evalFirewall(
  s: Scenario, srcNetId: string, dst: Dest, protocol: Protocol, port: number | null, srcClientId?: string,
  endpoints?: { srcIp: string | null; dstIp: string | null },
): FirewallVerdict {
  return evalFlow(s, {
    srcZone: zoneOfNetwork(s, srcNetId),
    srcNetId,
    srcClientId: srcClientId ?? null,
    srcIp: endpoints ? endpoints.srcIp : srcClientId && s.clients.some((c) => c.id === srcClientId) ? resolveClient(s, srcClientId).ip ?? null : null,
    dstZone: dst.kind === "network" ? zoneOfNetwork(s, dst.id) : dst.kind === "vpn" ? "vpn" : "external",
    dstNetId: dst.kind === "network" ? dst.id : null,
    dstClientId: dst.kind === "network" ? dst.clientId ?? null : null,
    dstIp: endpoints ? endpoints.dstIp : dst.kind === "network" && dst.clientId && s.clients.some((c) => c.id === dst.clientId) ? resolveClient(s, dst.clientId).ip ?? null : null,
    protocol,
    port,
    state: "new",
  });
}

// ---------------------------------------------------------------------------
// トレース
// ---------------------------------------------------------------------------

export interface Hop {
  status: "ok" | "fail" | "info";
  title: string;
  detail?: string;
}

export interface TraceQuery {
  /** クライアント ID または外部テスト端末 "internet" */
  srcId: string;
  /** クライアント ID、"internet"、外部テスト端末からなら WAN ID */
  dst: string;
  dstIp?: string;
  dstHost?: string;
  family?: IpFamily;
  protocol: Protocol;
  port: number | null;
}

/** パケットが通る 1 区間（トポロジーのエッジ単位、順番どおり） */
export interface Segment {
  /** トポロジー上のエッジ ID（リンク ID / ce:<clientId> / wan） */
  edge: string;
  /** ノード ID（機器 ID / c:<clientId> / internet） */
  from: string;
  to: string;
  /** この区間でのフレームの状態（例: VLAN 30 · タグ付き） */
  label: string;
  fail?: boolean;
  /** 線上の 802.1Q タグ（null = タグなし） */
  vlan: number | null;
  medium: "ethernet" | "wifi" | "wan";
}

export interface TraceResult {
  ok: boolean;
  summary: string;
  hops: Hop[];
  deviceIds: string[];
  linkIds: string[];
  clientIds: string[];
  failLinkIds: string[];
  segments: Segment[];
  /** パケットが止められたノード */
  failAt: string | null;
  route?: TraceRoute;
  security?: SecurityDecision[];
}

export type TraceRoute =
  | { kind: "wan"; wan: WanId; targetIp: string; family?: "ipv6" }
  | { kind: "vpn"; wan: WanId; targetIp: string; endpoint: string; name: string }
  | { kind: "static"; targetIp: string; nextHopId: string }
  | { kind: "forward"; wan: WanId; targetId?: string; targetIp?: string; targetPort?: number };

function protoLabel(p: Protocol, port: number | null) {
  return p === "icmp" ? "ICMP (ping)" : `${p.toUpperCase()}${port !== null ? `/${port}` : ""}`;
}

/** states は同一スナップショットの複数のトレースで共有できる。 */
export function trace(s: Scenario, q: TraceQuery, states?: ReadonlyMap<string, ClientState>): TraceResult {
  const ipv6 = q.family === "ipv6" || parseIpv6(q.dstIp ?? "") !== null;
  const hops: Hop[] = [];
  const devs = new Set<string>();
  const links = new Set<string>();
  const failLinks = new Set<string>();
  const clientIds = q.srcId === "internet" ? [] : [q.srcId];
  const gw = findGateway(s);
  const gwId = gw?.id;
  let route: TraceRoute | undefined;
  let security: SecurityDecision[] | undefined;
  const addPath = (r: L2Result) => {
    r.deviceIds.forEach((d) => devs.add(d));
    r.linkIds.forEach((l) => links.add(l));
    if (!r.ok) r.failLinkIds.forEach((l) => failLinks.add(l));
  };
  const segs: Segment[] = [];
  let failAt: string | null = null;
  const done = (ok: boolean, summary: string): TraceResult => ({
    ok,
    summary,
    hops,
    deviceIds: [...devs],
    linkIds: [...links],
    clientIds,
    failLinkIds: [...failLinks],
    segments: segs,
    failAt,
    ...(route ? { route } : {}),
    ...(security?.length ? { security } : {}),
  });
  const tagInfo = (linkId: string, fromDev: string, netId: string) => {
    const vlan = findNetwork(s, netId)?.vlanId ?? null;
    if (isMeshEdge(linkId)) return { label: `メッシュ · VLAN ${vlan ?? "?"}`, vlan, medium: "wifi" as const };
    const l = s.links.find((x) => x.id === linkId);
    const end = l ? (l.a.deviceId === fromDev ? l.a : l.b) : null;
    const port = end ? findPort(s, end.deviceId, end.portId) : undefined;
    const c = port ? carries(port, netId) : null;
    return {
      label: c === "tagged" ? `VLAN ${vlan} · タグ付き` : c === "untagged" ? `タグなし (VLAN ${vlan})` : `VLAN ${vlan} 不許可`,
      vlan: c === "tagged" ? vlan : null,
      medium: "ethernet" as const,
    };
  };
  /** L2 経路を区間に変換（失敗した場合は止まったリンクを fail として追加） */
  const l2Segs = (r: L2Result, netId: string) => {
    r.linkIds.forEach((lid, i) => segs.push({ edge: lid, from: r.deviceIds[i], to: r.deviceIds[i + 1], ...tagInfo(lid, r.deviceIds[i], netId) }));
    if (!r.ok && r.failLinkIds[0]) {
      const l = s.links.find((x) => x.id === r.failLinkIds[0])!;
      const from = r.deviceIds[r.deviceIds.length - 1];
      segs.push({ edge: l.id, from, to: l.a.deviceId === from ? l.b.deviceId : l.a.deviceId, ...tagInfo(l.id, from, netId), fail: true });
    }
  };
  const clientSeg = (st: ClientState, outbound: boolean) => {
    if (!st.attachDeviceId) return;
    const c = st.client;
    const label = c.connection.type === "wired" ? "タグなし" : `Wi-Fi${st.network ? ` → VLAN ${st.network.vlanId}` : ""}`;
    const node = `c:${c.id}`;
    segs.push({
      edge: `ce:${c.id}`,
      from: outbound ? node : st.attachDeviceId,
      to: outbound ? st.attachDeviceId : node,
      label,
      vlan: null,
      medium: c.connection.type === "wired" ? "ethernet" : "wifi",
    });
  };

  const stateOf = (id: string) => {
    const state = states?.get(id) ?? resolveClient(s, id);
    return ipv6 ? ipv6ClientState(state) : state;
  };
  const hostAt = (ip: string) => {
    const address6 = ipv6 ? parseIpv6(ip) : null;
    const address = parseIp(ip);
    if (address === null && address6 === null) return undefined;
    for (const client of s.clients) {
      const state = stateOf(client.id);
      if (state.ip && (ipv6 ? parseIpv6(state.ip) === address6 : parseIp(state.ip) === address)) return state;
    }
    return undefined;
  };
  const wanSegment = (label: string, inbound = false) => {
    if (gwId) segs.push({ edge: "wan", from: inbound ? "internet" : gwId, to: inbound ? gwId : "internet", label, vlan: null, medium: "wan" });
  };
  const stopAtGateway = (title: string, detail?: string) => {
    failAt = gwId ?? null;
    hops.push({ status: "fail", title, detail });
    return done(false, title);
  };

  if (q.srcId === "internet") {
    if (ipv6) return stopAtGateway("外部テスト端末からのポートフォワードは IPv4 用です。");
    if (q.dst !== "wan1" && q.dst !== "wan2") return stopAtGateway("着信先の WAN を選んでください。");
    const wan = q.dst;
    const publicIp = WAN_IPS[wan];
    route = { kind: "forward", wan };
    if (!gwId || !wanSettings(s).links[wan].online) return stopAtGateway(`${WAN_NAMES[wan]} は接続されていません。`);
    devs.add(gwId);
    wanSegment(`${WAN_NAMES[wan]} → ゲートウェイ`, true);
    hops.push({ status: "ok", title: `外部端末 ${EXTERNAL_TEST_IP} → ${WAN_NAMES[wan]} (${publicIp})` });
    const forward = s.portForwards?.find((f) => f.enabled && f.wan === wan && f.protocol === q.protocol && f.publicPort === q.port);
    if (!forward) return stopAtGateway("一致するポートフォワードがありません。", "WAN、プロトコル、公開ポートを確認してください。");
    const target = hostAt(forward.targetIp);
    route = { ...route, targetId: target?.client.id, targetIp: forward.targetIp, targetPort: forward.targetPort };
    hops.push({ status: "ok", title: `DNAT「${forward.name}」`, detail: `${publicIp}:${q.port} → ${forward.targetIp}:${forward.targetPort}` });
    if (!target || !target.network || !target.attachDeviceId || target.error) return stopAtGateway("転送先 IP を使う到達可能な端末が見つかりません。");
    if (target.guestPortal) return stopAtGateway(GUEST_PORTAL_REQUIRED);
    const flow: Flow = {
      srcZone: "external", srcNetId: null, srcClientId: null, srcIp: EXTERNAL_TEST_IP,
      dstZone: target.network.zoneId, dstNetId: target.network.id, dstClientId: target.client.id, dstIp: forward.targetIp,
      protocol: q.protocol, port: forward.targetPort, state: "new",
    };
    const fw = evalFlow(s, flow);
    if (fw.policy && !fw.allowed) return stopAtGateway(`Policy「${fw.policy.name}」で着信を拒否しました。`);
    hops.push({ status: "ok", title: fw.policy ? `Policy「${fw.policy.name}」で着信を許可` : "ポートフォワードに一致する着信を許可" });
    const path = l2Path(s, target.network.id, gwId, target.attachDeviceId);
    clientIds.push(target.client.id);
    addPath(path);
    l2Segs(path, target.network.id);
    if (!path.ok) return stopAtGateway("転送先への L2 経路がありません。", path.reason);
    clientSeg(target, false);
    if (!listensOn(target.client, q.protocol, forward.targetPort)) {
      failAt = `c:${target.client.id}`;
      hops.push({ status: "fail", title: `${target.client.name} の ${protoLabel(q.protocol, forward.targetPort)} は待ち受けていません` });
      return done(false, "転送先ポートで接続を受け付けていません。");
    }
    const reply = evalFlow(s, {
      srcZone: flow.dstZone, srcNetId: flow.dstNetId, srcClientId: flow.dstClientId, srcIp: flow.dstIp,
      dstZone: flow.srcZone, dstNetId: null, dstClientId: null, dstIp: flow.srcIp,
      protocol: flow.protocol, port: null, state: "established",
    });
    if (!reply.allowed) return stopAtGateway(`戻りの通信が Policy「${reply.policy?.name}」でブロックされました。`);
    hops.push({ status: "ok", title: "応答は逆変換して同じ WAN から返送", detail: `送信元 ${forward.targetIp}:${forward.targetPort} → ${publicIp}:${q.port}` });
    return done(true, `${WAN_NAMES[wan]} → ${target.client.name} (${protoLabel(q.protocol, forward.targetPort)}) に転送できました。`);
  }

  const src = stateOf(q.srcId);
  const proto = ipv6 && q.protocol === "icmp" ? "ICMPv6 (ping)" : protoLabel(q.protocol, q.port);

  // 1. 所属ネットワーク
  if (!src.network) {
    failAt = `c:${src.client.id}`;
    hops.push({ status: "fail", title: `${src.client.name} はどのネットワークにも所属できません`, detail: src.error });
    return done(false, "送信元がネットワークに接続できていません。");
  }
  if (src.attachDeviceId) devs.add(src.attachDeviceId);
  clientSeg(src, true);
  hops.push({
    status: "ok",
    title: `${src.client.name} は ${netLabel(src.network)} に所属`,
    detail: src.how,
  });

  // 2. IP アドレス
  if (src.errorStage === "ip") {
    if (src.toGateway) {
      addPath(src.toGateway);
      if (!src.staleLease) l2Segs(src.toGateway, src.network.id);
    }
    // 古いリース → 端末自身 / L2 で止まった → 赤いリンクで表示 / DHCP 無効・枯渇 → ゲートウェイ
    if (src.staleLease) failAt = `c:${src.client.id}`;
    else if (src.toGateway?.ok) failAt = gwId ?? null;
    hops.push({ status: "fail", title: "IP アドレスを取得できません", detail: src.error });
    return done(false, "送信元に有効な IP アドレスがありません。");
  }
  hops.push({
    status: "ok",
    title: `IP アドレス ${src.ip}`,
    detail: ipv6 ? "ルーター広告を受けて SLAAC で設定" : src.client.ipMode === "dhcp" ? "ゲートウェイの DHCP サーバーから取得" : "固定 IP",
  });

  const srcNet = src.network;
  if (src.guestPortal) {
    failAt = `c:${src.client.id}`;
    hops.push({ status: "fail", title: GUEST_PORTAL_REQUIRED });
    return done(false, GUEST_PORTAL_REQUIRED);
  }

  const reachGateway = (st: ClientState, label: string): boolean => {
    const r = st.toGateway!;
    addPath(r);
    l2Segs(r, st.network!.id);
    if (!r.ok) {
      hops.push({ status: "fail", title: `${label}からゲートウェイへ届きません`, detail: r.reason });
      return false;
    }
    hops.push({
      status: "ok",
      title: `ゲートウェイ ${gw?.name} へ到達 (${st.network!.name} VLAN ${st.network!.vlanId})`,
      detail: `経路: ${r.deviceIds.map((d) => findDevice(s, d)?.name).join(" → ")}`,
    });
    return true;
  };

  const firewall = (dst: Dest, dstLabel: string, dstIp: string | null = null): boolean => {
    const fw = evalFirewall(s, srcNet.id, dst, q.protocol, q.port, q.srcId, { srcIp: src.ip ?? null, dstIp });
    const pair = `${zoneName(s, fw.srcZone)} → ${zoneName(s, fw.dstZone)}`;
    if (fw.policy) {
      hops.push({
        status: fw.allowed ? "ok" : "fail",
        title: `Policy「${fw.policy.name}」に一致 → ${fw.allowed ? "Allow" : "Block"}`,
        detail: `ゾーン ${pair} / ${srcNet.name} → ${dstLabel} (${proto})。ポリシーは ポリシー一覧 の上から順に評価され、最初に一致したもので決まります。`,
      });
    } else {
      hops.push({
        status: fw.allowed ? "ok" : "fail",
        title: `ゾーン ${pair} の既定ポリシー → ${fw.allowed ? "すべて許可" : "すべて拒否"}`,
        detail: `一致するカスタムポリシーがないため、ゾーンマトリクスの既定動作が適用されました。`,
      });
    }
    return fw.allowed;
  };

  /** 戻りの通信（確立済み接続）の判定。既定はステートフルに許可、接続状態「すべて」のブロックには引っかかる */
  const returnTraffic = (from: { zone: string; netId: string | null; clientId: string | null; ip: string | null; label: string }): boolean => {
    const fw = evalFlow(s, {
      srcZone: from.zone,
      srcNetId: from.netId,
      srcClientId: from.clientId,
      srcIp: from.ip,
      dstZone: srcNet.zoneId,
      dstNetId: srcNet.id,
      dstClientId: src.client.id,
      dstIp: src.ip ?? null,
      protocol: q.protocol,
      port: null,
      state: "established",
    });
    if (fw.policy && !fw.allowed) {
      failAt = gwId ?? null;
      hops.push({
        status: "fail",
        title: `戻りの通信が Policy「${fw.policy.name}」でブロック`,
        detail: `${from.label} → ${src.client.name} の応答が、接続状態「${(fw.policy.connState ?? "all") === "all" ? "すべて" : "確立済み"}」のブロックポリシーに一致しました。行きは届いても応答が返らないので通信は成立しません。ブロックの接続状態を「新規のみ」にすると戻りの通信は通ります。`,
      });
      return false;
    }
    hops.push({
      status: "ok",
      title: fw.policy ? `戻りの通信: Policy「${fw.policy.name}」で許可` : "戻りの通信: 確立済みの接続なので自動で許可 (ステートフル)",
      detail: "ファイアウォールは行きの通信を覚えていて、その応答は既定で通します。",
    });
    return true;
  };

  // 3. IP アドレスで指定した端末、静的経路、VPN、WAN
  const address = q.dst === "internet" ? q.dstIp ?? (ipv6 ? INTERNET_IP6 : INTERNET_IP) : undefined;
  const sourceSubnet = q.dstIp ? parseCidr(srcNet.cidr) : null;
  const addressNumber = address ? parseIp(address) : null;
  const address6 = address && ipv6 ? parseIpv6(address) : null;
  const sourcePrefix = ipv6 ? lanIpv6Prefix(srcNet.ipv6Prefix) : null;
  const onLocalLink = ipv6
    ? sourcePrefix && address6 !== null && inIpv6Subnet(address6, sourcePrefix)
    : sourceSubnet && addressNumber !== null && inSubnet(addressNumber, sourceSubnet);
  const nextRoute = address && !ipv6 ? gatewayRoute(s, address) : undefined;
  const direct = (!nextRoute || onLocalLink) && q.dstIp && q.dst === "internet" ? hostAt(q.dstIp) : undefined;
  const destination = direct?.client.id ?? q.dst;
  const contentGate = (ip: string | undefined) => {
    security = inspectTraffic(s, q.dstHost, ip, q.protocol, q.port);
    security.forEach((event) => hops.push({ status: event.action === "block" ? "fail" : "info", title: event.reason, detail: event.destination }));
    return security.find((event) => event.action === "block");
  };
  if (destination === "internet") {
    const targetIp = address ?? INTERNET_IP;
    if (ipv6 ? address6 === null : addressNumber === null) return done(false, `宛先 ${ipv6 ? "IPv6" : "IPv4"} アドレスが不正です。`);
    if (ipv6 && address6 !== null) {
      const gateway = s.networks.find((network) => ipv6Gateway(network) === formatIpv6(address6));
      if (gateway) {
        if (!reachGateway(src, "送信元")) return done(false, "ゲートウェイに到達できません。");
        const flow: Flow = {
          srcZone: srcNet.zoneId, srcNetId: srcNet.id, srcClientId: src.client.id, srcIp: src.ip ?? null,
          dstZone: "gateway", dstNetId: gateway.id, dstClientId: null, dstIp: targetIp, protocol: q.protocol, port: q.port, state: "new",
        };
        const verdict = evalFlow(s, flow);
        return verdict.allowed ? done(true, `IPv6 ゲートウェイ ${targetIp} に到達できます。`) : stopAtGateway("ファイアウォールで拒否されました。");
      }
    }
    if (onLocalLink) {
      failAt = `c:${src.client.id}`;
      hops.push({ status: "fail", title: `${targetIp} の ${ipv6 ? "NDP" : "ARP"} 応答がありません` });
      return done(false, "同じサブネットに宛先端末が見つかりません。");
    }
    if (!reachGateway(src, "送信元")) return done(false, "ゲートウェイに到達できません。");
    const blocked = contentGate(targetIp);
    if (blocked) {
      failAt = gwId ?? null;
      return done(false, blocked.reason);
    }

    if (nextRoute?.kind === "static") {
      const entry = nextRoute.route;
      hops.push({ status: "info", title: `静的ルート「${entry.name}」に一致`, detail: `${entry.cidr} → ${entry.nextHop}（メトリック ${entry.metric}）` });
      const next = hostAt(entry.nextHop);
      if (!next?.network || !next.attachDeviceId || next.error || !gwId)
        return stopAtGateway("静的ルートの次ホップに到達できません。", `次ホップ ${entry.nextHop} に接続済みの端末が必要です。`);
      if (next.guestPortal) return stopAtGateway(GUEST_PORTAL_REQUIRED, `次ホップ ${entry.nextHop}`);
      const net = next.network;
      route = { kind: "static", targetIp, nextHopId: next.client.id };
      if (net.id !== srcNet.id && (net.isolateNetwork || srcNet.isolateNetwork)) return stopAtGateway("ネットワークを分離 で遮断されました。");
      if (!firewall({ kind: "network", id: net.id }, entry.cidr, targetIp)) {
        failAt = gwId;
        return done(false, "ファイアウォールで拒否されました。");
      }
      const path = l2Path(s, net.id, gwId, next.attachDeviceId);
      addPath(path);
      l2Segs(path, net.id);
      if (!path.ok) return stopAtGateway("静的ルートの次ホップに到達できません。", path.reason);
      clientIds.push(next.client.id);
      clientSeg(next, false);
      if (!returnTraffic({ zone: net.zoneId, netId: net.id, clientId: null, ip: targetIp, label: entry.cidr })) return done(false, "戻りの通信がブロックされました。");
      hops.push({ status: "ok", title: `次ホップ ${entry.nextHop} へ転送`, detail: `${targetIp} は次ホップの先にある仮想宛先として応答します。NAT は行いません。` });
      return done(true, `静的ルートで ${targetIp} に到達できます。`);
    }

    if (nextRoute?.kind === "vpn") {
      const tunnel = nextRoute.tunnel;
      const wan = chooseWan(s, `vpn:${tunnel.endpoint}`);
      if (!wan) return stopAtGateway("VPN を運ぶ WAN 回線がありません。");
      if (!tunnel.peerOnline) return stopAtGateway(`VPN「${tunnel.name}」の対向が応答しません。`);
      if (!firewall({ kind: "vpn" }, tunnel.remoteCidr, targetIp)) {
        failAt = gwId ?? null;
        return done(false, "ファイアウォールで拒否されました。");
      }
      route = { kind: "vpn", wan, targetIp, endpoint: tunnel.endpoint, name: tunnel.name };
      hops.push({ status: "ok", title: `VPN「${tunnel.name}」で仮想トンネル確立`, detail: `${tunnel.remoteCidr} 宛をカプセル化し、${WAN_NAMES[wan]} から対向 ${tunnel.endpoint} へ送ります。` });
      wanSegment(`VPN · ${WAN_NAMES[wan]}`);
      if (!returnTraffic({ zone: "vpn", netId: null, clientId: null, ip: targetIp, label: tunnel.remoteCidr })) return done(false, "戻りの通信がブロックされました。");
      return done(true, `VPN 経由で ${targetIp} に到達できます。`);
    }

    if (ipv6 && address6 !== null) {
      const onLan = s.networks.some((network) => {
        const prefix = lanIpv6Prefix(network.ipv6Prefix);
        return prefix && inIpv6Subnet(address6, prefix);
      });
      if (!isGlobalIpv6(address6) || onLan) return stopAtGateway(`${targetIp} の IPv6 宛先が見つかりません。`);
      if (!s.ipv6Wan || !srcNet.internetAccess) return stopAtGateway("IPv6 のインターネット接続が無効です。");
      const source = parseIpv6(src.ip ?? "");
      if (source === null || !isGlobalIpv6(source)) return stopAtGateway("インターネット接続にはグローバル IPv6 プレフィックスが必要です。");
    }
    if (!ipv6 && addressNumber !== null && (isPrivateIp(addressNumber) || s.networks.some((n) => {
      const subnet = parseCidr(n.cidr);
      return subnet && inSubnet(addressNumber, subnet);
    }))) return stopAtGateway(`${targetIp} に到達する経路または端末がありません。`);
    if (!srcNet.internetAccess) {
      failAt = gwId ?? null;
      hops.push({
        status: "fail",
        title: `${srcNet.name} のインターネット接続が無効`,
        detail: "ネットワーク設定の「インターネット接続を許可」がオフになっています。",
      });
      return done(false, "インターネットアクセスが無効です。");
    }
    if (!firewall({ kind: "internet" }, "インターネット", targetIp)) {
      failAt = gwId ?? null;
      return done(false, "ファイアウォールで拒否されました。");
    }
    const wan = chooseWan(s, `${q.srcId}:${targetIp}:${q.protocol}:${q.port}`);
    if (!wan) return stopAtGateway("利用できる WAN 回線がありません。");
    route = { kind: "wan", wan, targetIp, ...(ipv6 ? { family: "ipv6" } : {}) };
    wanSegment(`${ipv6 ? "IPv6 ルーティング" : "NAT"} → ${WAN_NAMES[wan]}`);
    if (!returnTraffic({ zone: "external", netId: null, clientId: null, ip: targetIp, label: "インターネット" })) return done(false, "戻りの通信がブロックされました。");
    hops.push({ status: "ok", title: ipv6 ? `IPv6 を ${WAN_NAMES[wan]} から転送` : `NAT して ${WAN_NAMES[wan]} からインターネットへ`, detail: ipv6 ? `送信元 ${src.ip} を維持します。` : `送信元 IP を ${WAN_IPS[wan]} に変換します。` });
    const qos = wanBandwidth(s, wan, q.srcId);
    if (qos.backgroundFlows || s.qos?.some((rule) => rule.clientId === q.srcId))
      hops.push({ status: "info", title: `QoS · 優先度 ${QOS_LABELS[qos.priority]}`, detail: `WAN の推定配分 下り ${Math.round(qos.downloadMbps)} / 上り ${Math.round(qos.uploadMbps)} Mbps（競合フロー ${qos.backgroundFlows}）` });
    return done(true, `${src.client.name} → インターネット (${proto}) は到達できます。`);
  }

  // 4. クライアント宛
  if (destination === q.srcId) {
    hops.push({ status: "info", title: "送信元と宛先が同じです" });
    return done(true, "自分自身です。");
  }
  const dst = stateOf(destination);
  clientIds.push(dst.client.id);
  if (!dst.network || !dst.ip || dst.error) {
    failAt = `c:${dst.client.id}`;
    hops.push({
      status: "fail",
      title: `宛先 ${dst.client.name} が通信できる状態ではありません`,
      detail: dst.error,
    });
    return done(false, "宛先に有効な IP アドレスがありません。");
  }
  const dstNet = dst.network;
  if (dst.guestPortal) {
    failAt = `c:${dst.client.id}`;
    hops.push({ status: "fail", title: GUEST_PORTAL_REQUIRED, detail: dst.client.name });
    return done(false, GUEST_PORTAL_REQUIRED);
  }
  const blocked = contentGate(dst.ip);
  if (blocked) {
    failAt = `c:${src.client.id}`;
    return done(false, blocked.reason);
  }

  if (dstNet.id === srcNet.id) {
    hops.push({
      status: "info",
      title: `同じネットワーク (${netLabel(srcNet)}) 内の通信`,
      detail: "宛先は同じサブネットなので、ルーター/ファイアウォールを通らず L2 (スイッチ) で直接届きます。",
    });
    // クライアント間の分離 は AP 上で無線クライアント同士の通信だけを止める
    const bothWifi = src.client.connection.type === "wifi" && dst.client.connection.type === "wifi";
    const isoSsid = bothWifi
      ? [src.client, dst.client]
          .map((c) => s.ssids.find((w) => w.id === (c.connection as { ssidId: string | null }).ssidId))
          .find((w) => w?.clientIsolation)
      : undefined;
    if (isoSsid) {
      failAt = src.attachDeviceId ?? null;
      hops.push({
        status: "fail",
        title: "クライアント間の分離 で遮断",
        detail: `SSID「${isoSsid.name}」は クライアント間の分離 が有効なため、無線クライアント同士は通信できません。`,
      });
      return done(false, "クライアント間の分離 で遮断されました。");
    }
    const r = l2Path(s, srcNet.id, src.attachDeviceId!, dst.attachDeviceId!);
    addPath(r);
    l2Segs(r, srcNet.id);
    if (!r.ok) {
      hops.push({ status: "fail", title: "L2 で宛先まで届きません", detail: r.reason });
      return done(false, "L2 経路がありません。");
    }
    clientSeg(dst, false);
    hops.push({
      status: "ok",
      title: `${dst.client.name} (${dst.ip}) に到達`,
      detail: `経路: ${r.deviceIds.map((d) => findDevice(s, d)?.name).join(" → ")}`,
    });
    return done(true, `${src.client.name} → ${dst.client.name} (${proto}) は到達できます。`);
  }

  // 異なるネットワーク: ゲートウェイでルーティング
  hops.push({
    status: "info",
    title: `別ネットワーク (${netLabel(dstNet)}) 宛なのでゲートウェイでルーティング`,
    detail: `宛先 ${dst.ip} は ${srcNet.cidr} の外なので、デフォルトゲートウェイ ${srcNet.gatewayIp} に送られます。`,
  });
  if (!reachGateway(src, "送信元")) return done(false, "ゲートウェイに到達できません。");
  const isolated = [srcNet, dstNet].find((n) => n.isolateNetwork);
  if (isolated) {
    failAt = gwId ?? null;
    hops.push({
      status: "fail",
      title: `ネットワークを分離 で遮断 (${isolated.name})`,
      detail: `${isolated.name} は「ネットワークを分離」が有効なため、他のネットワークとの通信はポリシーに関係なく遮断されます。`,
    });
    return done(false, "ネットワークを分離 で遮断されました。");
  }
  if (!firewall({ kind: "network", id: dstNet.id, clientId: dst.client.id }, dst.client.name, dst.ip)) {
    failAt = gwId ?? null;
    return done(false, "ファイアウォールで拒否されました。");
  }
  // ゲートウェイから宛先へ（宛先 VLAN で）
  const back = gwId ? l2Path(s, dstNet.id, gwId, dst.attachDeviceId!) : dst.toGateway!;
  addPath(back);
  l2Segs(back, dstNet.id);
  if (!back.ok) {
    hops.push({ status: "fail", title: `ゲートウェイから ${dst.client.name} へ届きません`, detail: back.reason });
    return done(false, "宛先側の L2 経路がありません。");
  }
  clientSeg(dst, false);
  hops.push({
    status: "ok",
    title: `${dst.client.name} (${dst.ip}) に到達`,
    detail: `経路: ${back.deviceIds.map((d) => findDevice(s, d)?.name).join(" → ")}`,
  });
  if (!returnTraffic({ zone: dstNet.zoneId, netId: dstNet.id, clientId: dst.client.id, ip: dst.ip ?? null, label: dst.client.name }))
    return done(false, "戻りの通信がブロックされました。");
  return done(true, `${src.client.name} → ${dst.client.name} (${proto}) は到達できます。`);
}

export function deviceTypeLabel(d: Device) {
  return d.type === "gateway" ? "ゲートウェイ" : d.type === "switch" ? "スイッチ" : "アクセスポイント";
}
