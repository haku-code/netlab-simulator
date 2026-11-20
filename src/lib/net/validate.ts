import type { FirewallPolicy, Scenario } from "../model";
import { inSubnet, isHostAddr, overlaps, parseCidr, parseIp } from "./ip";
import { CLIENT_REF, clientNetworkId, findNetwork, isClientRef, zoneName, zoneOfNetwork } from "./simulate";

export interface Issue {
  severity: "error" | "warning";
  area: "networks" | "wifi" | "firewall" | "devices" | "clients";
  targetId?: string;
  message: string;
  hint?: string;
}

/** a が b を完全に覆うか（b は a より後ろにあると決して評価されない） */
/** 送信元/宛先の参照のネットワーク（端末ならその端末の所属ネットワーク） */
export function refNetwork(s: Scenario, ref: string): string | null {
  if (!isClientRef(ref)) return ref;
  const c = s.clients.find((x) => x.id === ref.slice(CLIENT_REF.length));
  return c ? clientNetworkId(s, c) : null;
}

/** 参照 a が参照 b を含むか（any ⊃ ネットワーク ⊃ そのネットワークの端末） */
function refCovers(s: Scenario, a: string, b: string) {
  if (a === "any" || a === b) return true;
  return !isClientRef(a) && isClientRef(b) && refNetwork(s, b) === a;
}

export function ruleCovers(a: FirewallPolicy, b: FirewallPolicy, s?: Scenario): boolean {
  if (a.srcZone !== b.srcZone || a.dstZone !== b.dstZone) return false;
  if (s ? !refCovers(s, a.src, b.src) : a.src !== "any" && a.src !== b.src) return false;
  if (s ? !refCovers(s, a.dst, b.dst) : a.dst !== "any" && a.dst !== b.dst) return false;
  if (a.protocol !== "all" && a.protocol !== b.protocol) return false;
  if (a.port !== null && a.port !== b.port) return false;
  return true;
}

export function validate(s: Scenario): Issue[] {
  const out: Issue[] = [];

  // --- ネットワーク ---
  const seenVlan = new Map<number, string>();
  const subnets: { id: string; name: string; sn: NonNullable<ReturnType<typeof parseCidr>> }[] = [];
  for (const n of s.networks) {
    const add = (severity: Issue["severity"], message: string, hint?: string) =>
      out.push({ severity, area: "networks", targetId: n.id, message: `${n.name}: ${message}`, hint });

    if (!Number.isInteger(n.vlanId) || n.vlanId < 1 || n.vlanId > 4094)
      add("error", `VLAN ID ${n.vlanId} は範囲外です`, "VLAN ID は 1〜4094 の整数です。");
    else if (seenVlan.has(n.vlanId))
      add("error", `VLAN ID ${n.vlanId} が「${seenVlan.get(n.vlanId)}」と重複しています`, "VLAN ID はネットワークごとに一意にします。");
    else seenVlan.set(n.vlanId, n.name);

    const sn = parseCidr(n.cidr);
    if (!sn) {
      add("error", `サブネット「${n.cidr}」が不正です`, "例: 192.168.10.0/24 のように「アドレス/プレフィックス長」で書きます。");
      continue;
    }
    for (const o of subnets) {
      if (overlaps(o.sn, sn))
        add("error", `サブネットが「${o.name}」と重複しています`, "サブネットが重なるとルーターがどちらに送るか決められません。");
    }
    subnets.push({ id: n.id, name: n.name, sn });

    const gw = parseIp(n.gatewayIp);
    if (gw === null || !isHostAddr(gw, sn))
      add("error", `ゲートウェイ IP ${n.gatewayIp} がサブネット内の有効なホストアドレスではありません`, "通常はサブネットの最初のアドレス (例: .1) を使います。");

    for (const d of n.dhcp.dns ?? [])
      if (d.trim() && parseIp(d) === null) add("error", `DNS サーバー「${d}」が IP アドレスの形式ではありません`);
    if (n.dhcp.enabled) {
      const st = parseIp(n.dhcp.start);
      const en = parseIp(n.dhcp.end);
      if (st === null || en === null || !inSubnet(st, sn) || !inSubnet(en, sn))
        add("error", "DHCP 範囲がサブネットの外です", `範囲は ${n.cidr} の中にする必要があります。`);
      else if (st > en) add("error", "DHCP の開始アドレスが終了アドレスより後です");
      else if (gw !== null && gw >= st && gw <= en)
        add("warning", "DHCP 範囲にゲートウェイ IP が含まれています", "ゲートウェイは自動的に除外されますが、範囲から外しておくのが一般的です。");
    }
  }

  // --- 参照切れ ---
  for (const d of s.devices) {
    for (const p of d.ports) {
      const refs = [p.nativeNetworkId, ...(p.tagged === "custom" ? p.taggedNetworkIds : [])];
      if (refs.some((r) => r && !findNetwork(s, r)))
        out.push({ severity: "warning", area: "devices", targetId: d.id, message: `${d.name} / ${p.name}: 存在しないネットワークを参照しています` });
      if (p.tagged === "custom" && p.taggedNetworkIds.length === 0)
        out.push({ severity: "warning", area: "devices", targetId: d.id, message: `${d.name} / ${p.name}: タグ付き VLAN の管理が「カスタム」ですが、VLAN が選択されていません`, hint: "ネイティブ VLAN のみ通す場合は「すべて拒否」を選びます。" });
    }
  }

  // --- ポートの多重使用 ---
  const used = new Map<string, string>();
  const claim = (key: string, who: string, area: Issue["area"], id: string) => {
    if (used.has(key))
      out.push({ severity: "error", area, targetId: id, message: `${who} と ${used.get(key)} が同じポートに接続されています`, hint: "1 つのポートには 1 本のケーブルしか挿せません。" });
    else used.set(key, who);
  };
  for (const l of s.links) {
    claim(`${l.a.deviceId}:${l.a.portId}`, "リンク", "devices", l.a.deviceId);
    claim(`${l.b.deviceId}:${l.b.portId}`, "リンク", "devices", l.b.deviceId);
  }
  for (const c of s.clients) {
    if (c.connection.type === "wired") claim(`${c.connection.deviceId}:${c.connection.portId}`, c.name, "clients", c.id);
  }

  // --- Wi-Fi ---
  for (const w of s.ssids) {
    if (!findNetwork(s, w.networkId))
      out.push({ severity: "error", area: "wifi", targetId: w.id, message: `SSID「${w.name}」にネットワークが割り当てられていません` });
    if (w.apIds && !w.apIds.some((id) => s.devices.some((d) => d.id === id && d.type === "ap")))
      out.push({ severity: "warning", area: "wifi", targetId: w.id, message: `SSID「${w.name}」はどの AP からも配信されていません`, hint: "配信 AP で配信する AP を選びます。" });
    if (w.security === "open")
      out.push({ severity: "warning", area: "wifi", targetId: w.id, message: `SSID「${w.name}」は暗号化なし (オープン) です`, hint: "ゲスト用でも WPA2/WPA3 を推奨します。" });
  }

  // --- DHCP 予約 ---
  const resSeen = new Map<string, string>();
  for (const c of s.clients) {
    if (c.ipMode !== "dhcp" || !c.reservedIp) continue;
    const key = c.reservedIp.trim();
    if (resSeen.has(key))
      out.push({ severity: "error", area: "clients", targetId: c.id, message: `${c.name}: DHCP 予約 ${key} が「${resSeen.get(key)}」と重複しています` });
    else resSeen.set(key, c.name);
  }

  // --- クライアント ---
  const staticSeen = new Map<string, string>();
  for (const c of s.clients) {
    if (c.ipMode !== "static") continue;
    const key = c.staticIp.trim();
    if (staticSeen.has(key))
      out.push({ severity: "error", area: "clients", targetId: c.id, message: `${c.name}: 固定 IP ${key} が「${staticSeen.get(key)}」と重複しています` });
    else staticSeen.set(key, c.name);
  }

  // --- ファイアウォール ---
  s.policies.forEach((r, i) => {
    if (!r.enabled) return;
    for (let j = 0; j < i; j++) {
      const a = s.policies[j];
      if (a.enabled && ruleCovers(a, r, s)) {
        out.push({
          severity: "warning",
          area: "firewall",
          targetId: r.id,
          message: `Policy「${r.name}」は上にある「${a.name}」に完全に覆われており、評価されません`,
          hint: "ポリシーは上から順に評価されます。より具体的なポリシーを上に置きましょう。",
        });
        break;
      }
    }
    for (const [side, zone] of [[r.src, r.srcZone], [r.dst, r.dstZone]] as const) {
      if (side === "any") continue;
      const netId = refNetwork(s, side);
      const label = isClientRef(side) ? (s.clients.find((c) => `${CLIENT_REF}${c.id}` === side)?.name ?? "端末") : findNetwork(s, side)?.name;
      if (!netId || !findNetwork(s, netId))
        out.push({ severity: "warning", area: "firewall", targetId: r.id, message: `Policy「${r.name}」が存在しない${isClientRef(side) ? "端末" : "ネットワーク"}を参照しています` });
      else if (zoneOfNetwork(s, netId) !== zone)
        out.push({ severity: "warning", area: "firewall", targetId: r.id, message: `Policy「${r.name}」: ${label} はゾーン ${zoneName(s, zone)} に属していないため一致しません` });
    }
  });

  return out;
}
