// バックアップと復元: サイトの構成を JSON に書き出し、読み込む。

import type { Scenario } from "../model";

export const BACKUP_FORMAT = "netlab-backup";
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  siteName: string;
  scenario: Scenario;
}

export function makeBackup(siteName: string, scenario: Scenario, now = new Date()): BackupFile {
  const copy = structuredClone(scenario);
  // DHCP リースは端末の一時状態なので含めない（復元後に取り直す）
  for (const c of copy.clients) c.lease = null;
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: now.toISOString(), siteName, scenario: copy };
}

export const backupFileName = (b: BackupFile) => `netlab-${b.siteName.replace(/[^\w.-]+/g, "_") || "site"}-${b.createdAt.slice(0, 16).replace(/[-:T]/g, "")}.json`;

const ARRAYS = ["networks", "zones", "devices", "links", "clients", "ssids", "policies"] as const;

/** バックアップファイルを読み込む。不正な場合は理由を返す */
export function parseBackup(text: string): { ok: true; backup: BackupFile } | { ok: false; reason: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "JSON として読み込めません。" };
  }
  if (!data || typeof data !== "object") return { ok: false, reason: "バックアップの形式ではありません。" };
  const b = data as Partial<BackupFile>;
  if (b.format !== BACKUP_FORMAT) return { ok: false, reason: "NetLab のバックアップファイルではありません。" };
  if (typeof b.version !== "number" || b.version > BACKUP_VERSION) return { ok: false, reason: `このバージョン (${String(b.version)}) のバックアップには対応していません。` };
  const s = b.scenario as Partial<Scenario> | undefined;
  if (!s || typeof s !== "object") return { ok: false, reason: "構成データがありません。" };
  const missing = ARRAYS.filter((k) => !Array.isArray(s[k]));
  if (missing.length) return { ok: false, reason: `構成データが壊れています（${missing.join(", ")}）。` };
  if (!s.devices!.some((d) => d?.type === "gateway")) return { ok: false, reason: "ゲートウェイが含まれていません。" };
  return {
    ok: true,
    backup: { format: BACKUP_FORMAT, version: b.version, createdAt: String(b.createdAt ?? ""), siteName: String(b.siteName ?? "Site"), scenario: s as Scenario },
  };
}

export const backupSize = (b: BackupFile) => new Blob([JSON.stringify(b)]).size;
