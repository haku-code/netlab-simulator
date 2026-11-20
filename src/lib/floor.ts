// フロアプラン（間取り）と電波の伝わり方のモデル
import { FLOOR_PRESETS } from "./floor-templates";
import type { Device, Scenario, XY } from "./model";

export interface Room {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FloorTemplate = keyof typeof FLOOR_PRESETS;

export interface FloorLayout {
  name: string;
  width: number;
  height: number;
  rooms: Room[];
  /** 壁 1 枚あたりの減衰 (dB) */
  wallLoss: { "2.4": number; "5": number; "6": number };
  /** 機器（ゲートウェイ・スイッチ）を置く部屋 */
  closet: string;
}

export interface Floor extends FloorLayout {
  template: FloorTemplate;
}

export const TX_DBM = { high: 20, medium: 14, low: 8 } as const;
/** 1 m 地点での損失 (dB) */
const LOSS_1M = { "2.4": 40, "5": 47, "6": 48 } as const;
/** 屋内の距離減衰係数 */
const PATH_EXP = 3.5;
/** これより弱いと接続できない / 一覧に出ない */
export const CONNECT_DBM = -80;
export const VISIBLE_DBM = -85;

export const roomAt = (f: FloorLayout, p: XY) => f.rooms.find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);

/** 2 点の間にある壁の枚数（直線上で部屋が切り替わる回数） */
export function wallsBetween(f: FloorLayout, a: XY, b: XY) {
  let walls = 0;
  let prev = roomAt(f, a)?.id;
  const n = 60;
  for (let i = 1; i <= n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    const cur = roomAt(f, p)?.id;
    if (cur && cur !== prev) {
      walls++;
      prev = cur;
    }
  }
  return walls;
}

export type Band = "2.4" | "5" | "6";

/** 地点 p での AP の受信強度 (dBm) */
export function rssiAt(f: FloorLayout, ap: Device, p: XY, band: Band) {
  if (!ap.pos) return -120;
  const d = Math.max(0.5, Math.hypot(ap.pos.x - p.x, ap.pos.y - p.y));
  const tx = TX_DBM[ap.txPower ?? "high"];
  return Math.round(tx - (LOSS_1M[band] + 10 * PATH_EXP * Math.log10(d)) - wallsBetween(f, ap.pos, p) * f.wallLoss[band]);
}

export function quality(rssi: number) {
  return rssi >= -60 ? { label: "非常に良い", tone: "ok" } : rssi >= -70 ? { label: "良い", tone: "ok" } : rssi >= CONNECT_DBM ? { label: "弱い", tone: "warn" } : { label: "圏外", tone: "err" };
}

// --- 自動配置 ---------------------------------------------------------------------

const center = (r: Room): XY => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const clampTo = (r: Room, p: XY): XY => ({ x: Math.min(r.x + r.w - 0.6, Math.max(r.x + 0.6, p.x)), y: Math.min(r.y + r.h - 0.6, Math.max(r.y + 0.6, p.y)) });

/**
 * 間取りを作り、位置のない機器・端末を部屋に並べる。
 * 無線端末は、いま設定されている AP のすぐ近くに置く（既存の課題の動きを変えないため）。
 */
export function autoFloor(s: Scenario, template?: FloorTemplate): Scenario {
  const office = s.ssids.some((w) => /office/i.test(w.name)) || s.devices.some((d) => /office|meeting/i.test(d.name));
  const t = template ?? s.floor?.template ?? (office ? "office" : "house");
  const preset = FLOOR_PRESETS[t];
  const f: Floor = !template && s.floor ? s.floor : { ...structuredClone(preset.layout), template: t };
  s.floor = f;
  const room = (id: string) => f.rooms.find((r) => r.id === id) ?? f.rooms[0];

  // ゲートウェイ・スイッチは機器置き場に並べる
  const infra = s.devices.filter((d) => d.type !== "ap");
  infra.forEach((d, i) => {
    const r = room(f.closet);
    // 機器置き場の中央付近に横に並べる（入りきらなければ次の段へ）
    const gap = 1.2 * Math.max(1, f.width / 20);
    const perRow = Math.max(1, Math.floor((r.w - 0.6) / gap));
    if (!d.pos || template) d.pos = clampTo(r, { x: r.x + gap * 0.75 + (i % perRow) * gap, y: r.y + r.h / 2 + Math.floor(i / perRow) * gap });
  });
  // AP は部屋の中央（名前に会議室・ロビー等があればその部屋）
  const used = new Set<string>();
  s.devices
    .filter((d) => d.type === "ap")
    .forEach((ap) => {
      if (ap.pos && !template) return;
      const named = /meeting|会議/i.test(ap.name) ? "meeting" : /lobby|ロビー/i.test(ap.name) ? "lobby" : /bed|寝室/i.test(ap.name) ? "bedroom" : /study|書斎/i.test(ap.name) ? "study" : null;
      const id = named && f.rooms.some((r) => r.id === named) ? named : (preset.apRooms.find((r) => !used.has(r) && f.rooms.some((x) => x.id === r)) ?? f.rooms[0].id);
      used.add(id);
      ap.pos = center(room(id));
    });
  // 端末
  const counts = new Map<string, number>();
  for (const c of s.clients) {
    if (c.pos && !template) continue;
    let anchor: XY;
    let r: Room;
    if (c.connection.type === "wifi") {
      const ap = s.devices.find((d) => d.id === (c.connection as { apId: string }).apId);
      anchor = ap?.pos ?? center(f.rooms[0]);
      r = roomAt(f, anchor) ?? f.rooms[0];
    } else {
      r = room(preset.wiredRooms[c.kind] ?? f.rooms[0].id);
      anchor = center(r);
    }
    const key = `${anchor.x},${anchor.y}`;
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    const angle = (n * 2 * Math.PI) / 6 + 0.4;
    // 間取りが広いほど少し離して置く（重なり防止）。AP からの距離は数 m 以内に収める
    const radius = Math.max(1.6, f.width / 12) + Math.floor(n / 6) * 0.9;
    c.pos = clampTo(r, { x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius });
  }
  return s;
}
