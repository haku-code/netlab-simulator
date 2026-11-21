// 運用: イベントログとアラーム。構成の変化（前後のスナップショット）からイベントを作る。

import type { Device, DeviceType, Scenario } from "../model";
import { resolveClient, trace, uplinkOf } from "../net/simulate";
import { switchingState } from "../net/switching";

export type EventCategory = "device" | "client" | "wifi" | "security" | "switching" | "system" | "admin";
export type EventSeverity = "info" | "warning" | "critical";

export interface OpsEvent {
  id: string;
  /** 発生時刻 (ms) */
  time: number;
  /** サイト ID、課題中は "lesson:<課題 ID>" */
  siteId: string;
  category: EventCategory;
  severity: EventSeverity;
  message: string;
  /** 関連する機器 / 端末 */
  targetId?: string;
  /** アラームを確認済みにした */
  archived?: boolean;
}

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  device: "デバイス",
  client: "クライアント",
  wifi: "Wi-Fi",
  security: "セキュリティ",
  switching: "スイッチング",
  system: "システム",
  admin: "管理者",
};

export const SEVERITY_LABEL: Record<EventSeverity, string> = { info: "情報", warning: "警告", critical: "重大" };

// ---------------------------------------------------------------------------
// ファームウェア
// ---------------------------------------------------------------------------

export const LATEST_FIRMWARE: Record<DeviceType, string> = { gateway: "4.1.13", switch: "7.1.26", ap: "6.7.31" };
/** 新しく見つかった機器の出荷時ファームウェア */
export const FACTORY_FIRMWARE: Record<DeviceType, string> = { gateway: "4.0.6", switch: "6.6.65", ap: "6.6.77" };
export const RELEASE_NOTES: Record<DeviceType, string> = {
  gateway: "ファイアウォールの判定速度を改善し、WireGuard の再接続を安定化しました。",
  switch: "RSTP のトポロジー変更時の収束を改善し、PoE の電力表示を修正しました。",
  ap: "ローミング時の再接続を短縮し、WPA3 の互換性を改善しました。",
};

export const firmwareOf = (d: Device) => d.firmware ?? LATEST_FIRMWARE[d.type];

function versionParts(v: string) {
  return v.split(".").map((x) => Number(x) || 0);
}
export function compareVersion(a: string, b: string) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
export const hasUpdate = (d: Device) => !d.state && compareVersion(firmwareOf(d), LATEST_FIRMWARE[d.type]) < 0;

// ---------------------------------------------------------------------------
// スナップショットと差分
// ---------------------------------------------------------------------------

export interface OpsSnapshot {
  devices: Map<string, { name: string; online: boolean; state?: Device["state"]; unpowered: boolean; firmware: string }>;
  clients: Map<string, { name: string; ok: boolean; error?: string; attach?: string; wifi: boolean; internet: boolean; internetBlockedBy?: string }>;
  blocked: Set<string>;
  storm: boolean;
  poeShort: Set<string>;
}

/** ファイアウォールで止まったかどうか（ゲートウェイでの拒否） */
function firewallBlock(summary: string, hops: { status: string; title: string; detail?: string }[]) {
  const text = [summary, ...hops.filter((h) => h.status === "fail").flatMap((h) => [h.title, h.detail ?? ""])].join(" ");
  const m = text.match(/Policy「([^」]+)」/);
  if (m) return `Policy「${m[1]}」`;
  if (/既定.*(拒否|ブロック)|ブロック/.test(text) && !/ブロードキャスト/.test(text)) return "ゾーンの既定の動作";
  return undefined;
}

export function snapshot(s: Scenario): OpsSnapshot {
  const sw = switchingState(s);
  const devices: OpsSnapshot["devices"] = new Map();
  for (const d of s.devices)
    devices.set(d.id, { name: d.name, online: uplinkOf(s, d.id).online && !sw.unpowered.has(d.id), state: d.state, unpowered: sw.unpowered.has(d.id) && !sw.down.has(d.id), firmware: firmwareOf(d) });
  const clients: OpsSnapshot["clients"] = new Map();
  for (const c of s.clients) {
    const st = resolveClient(s, c.id);
    const ok = !st.error;
    let internet = false;
    let internetBlockedBy: string | undefined;
    if (ok && c.kind !== "server") {
      const r = trace(s, { srcId: c.id, dst: "internet", protocol: "tcp", port: 443 });
      internet = r.ok;
      if (!r.ok) internetBlockedBy = firewallBlock(r.summary, r.hops);
    }
    clients.set(c.id, { name: c.name, ok, error: st.error, attach: st.attachDeviceId, wifi: c.connection.type === "wifi", internet, internetBlockedBy });
  }
  const poeShort = new Set<string>();
  for (const [id, ps] of sw.poe) if ([...ps.ports.values()].some((p) => p.reason === "budget")) poeShort.add(id);
  return { devices, clients, blocked: new Set(sw.blocked.keys()), storm: sw.storm.size > 0, poeShort };
}

type Draft = Omit<OpsEvent, "id" | "time" | "siteId">;

/** 2 つのスナップショットの差からイベントを作る */
export function diffEvents(prev: OpsSnapshot, next: OpsSnapshot, s: Scenario): Draft[] {
  const out: Draft[] = [];
  const devName = (id: string | undefined) => (id ? (s.devices.find((d) => d.id === id)?.name ?? id) : "?");

  // --- デバイス ---
  for (const [id, n] of next.devices) {
    const p = prev.devices.get(id);
    if (!p) {
      out.push(n.state === "pending"
        ? { category: "device", severity: "info", message: `${n.name} を検出しました（承認待ち）`, targetId: id }
        : { category: "device", severity: "info", message: `${n.name} を追加しました`, targetId: id });
      continue;
    }
    if (p.state === "adopting" && !n.state) out.push({ category: "device", severity: "info", message: `${n.name} を承認しました`, targetId: id });
    if (p.state === "upgrading" && !n.state) out.push({ category: "device", severity: "info", message: `${n.name} のファームウェアを ${n.firmware} に更新しました`, targetId: id });
    if (!p.state && n.state === "upgrading") out.push({ category: "device", severity: "info", message: `${n.name} のファームウェア更新を開始しました（${p.firmware} → 再起動中）`, targetId: id });
    if (p.state || n.state) continue;
    if (p.unpowered !== n.unpowered)
      out.push(n.unpowered
        ? { category: "switching", severity: "critical", message: `${n.name} への PoE 給電が止まりました`, targetId: id }
        : { category: "switching", severity: "info", message: `${n.name} への PoE 給電が再開しました`, targetId: id });
    else if (p.online !== n.online)
      out.push(n.online
        ? { category: "device", severity: "info", message: `${n.name} がオンラインになりました`, targetId: id }
        : { category: "device", severity: "critical", message: `${n.name} がオフラインになりました（上流との接続がありません）`, targetId: id });
  }
  for (const [id, p] of prev.devices) if (!next.devices.has(id)) out.push({ category: "device", severity: "warning", message: `${p.name} を削除しました`, targetId: id });

  // --- クライアント ---
  for (const [id, n] of next.clients) {
    const p = prev.clients.get(id);
    if (!p) {
      out.push({ category: "client", severity: "info", message: `${n.name} を追加しました`, targetId: id });
      continue;
    }
    if (p.ok !== n.ok) {
      const where = n.wifi ? "Wi-Fi" : "有線";
      out.push(n.ok
        ? { category: n.wifi ? "wifi" : "client", severity: "info", message: `${n.name} が接続しました（${where} · ${devName(n.attach)}）`, targetId: id }
        : { category: n.wifi ? "wifi" : "client", severity: "warning", message: `${n.name} が切断されました: ${n.error ?? "原因不明"}`, targetId: id });
    } else if (n.ok && n.wifi && p.wifi && p.attach && n.attach && p.attach !== n.attach) {
      out.push({ category: "wifi", severity: "info", message: `${n.name} がローミングしました（${devName(p.attach)} → ${devName(n.attach)}）`, targetId: id });
    }
    if (p.ok && n.ok && p.internet && !n.internet && n.internetBlockedBy)
      out.push({ category: "security", severity: "warning", message: `${n.name} からインターネット (TCP/443) への通信を${n.internetBlockedBy}がブロックしました`, targetId: id });
    if (p.ok && n.ok && !p.internet && n.internet && p.internetBlockedBy)
      out.push({ category: "security", severity: "info", message: `${n.name} のインターネット通信が許可されるようになりました`, targetId: id });
  }
  for (const [id, p] of prev.clients) if (!next.clients.has(id)) out.push({ category: "client", severity: "info", message: `${p.name} を削除しました`, targetId: id });

  // --- スイッチング ---
  if (!prev.storm && next.storm) out.push({ category: "switching", severity: "critical", message: "ループを検出しました: ブロードキャストストームでネットワークが停止しています" });
  if (prev.storm && !next.storm) out.push({ category: "switching", severity: "info", message: "ブロードキャストストームが解消しました" });
  const linkName = (id: string) => {
    const l = s.links.find((x) => x.id === id);
    return l ? `${devName(l.a.deviceId)} ⇄ ${devName(l.b.deviceId)}` : id;
  };
  const newBlocks = [...next.blocked].filter((id) => !prev.blocked.has(id));
  if (newBlocks.length) out.push({ category: "switching", severity: "warning", message: `ループを検出し、STP がポートをブロックしました（${newBlocks.map(linkName).join("、")}）` });
  for (const id of next.poeShort)
    if (!prev.poeShort.has(id)) out.push({ category: "switching", severity: "critical", message: `${devName(id)} の PoE 電力予算が不足しています`, targetId: id });
  return out;
}

/** 防御的に: 1 回の変更で大量に出た場合はまとめる（構成の読み込みなど） */
export function summarize(drafts: Draft[], limit = 12): Draft[] {
  if (drafts.length <= limit) return drafts;
  const critical = drafts.filter((d) => d.severity === "critical").slice(0, 3);
  return [{ category: "system", severity: "info", message: `構成が大きく変わりました（${drafts.length} 件の変化）` }, ...critical];
}

/** パケットトレースで止まった通信をセキュリティイベントにする */
export function traceBlockEvent(s: Scenario, srcId: string, dst: string, result: ReturnType<typeof trace>): Draft | null {
  if (result.ok) return null;
  const by = firewallBlock(result.summary, result.hops);
  if (!by) return null;
  const name = (id: string) => (id === "internet" ? "インターネット" : (s.clients.find((c) => c.id === id)?.name ?? id));
  return { category: "security", severity: "warning", message: `${name(srcId)} → ${name(dst)} の通信を${by}がブロックしました`, targetId: srcId };
}
