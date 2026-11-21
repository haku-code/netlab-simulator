"use client";

// 運用の状態（イベント・アラーム・サイト・管理者・バックアップ）。構成ストアとは別に保存する。
// 構成ストアの変更を購読してイベントを作り、表示のみの管理者による変更を止める。

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { autoFloor } from "../floor";
import type { Scenario } from "../model";
import { assignLeases, type TraceQuery, type TraceResult } from "../net/simulate";
import { defaultScenario } from "../scenarios/default";
import { useStore } from "../store";
import { makeBackup, type BackupFile } from "./backup";
import { LATEST_FIRMWARE, diffEvents, snapshot, summarize, traceBlockEvent, type EventCategory, type OpsEvent, type OpsSnapshot } from "./events";

export type AdminRole = "super" | "admin" | "viewer";
export const ROLE_LABEL: Record<AdminRole, string> = { super: "スーパー管理者", admin: "サイト管理者", viewer: "表示のみ" };
export const ROLE_HINT: Record<AdminRole, string> = {
  super: "すべてのサイトの設定、管理者の追加、バックアップの復元ができます。",
  admin: "担当サイトの設定を変更できます。管理者の管理と復元はできません。",
  viewer: "画面を見るだけで、設定は変更できません。",
};

export interface Admin {
  id: string;
  name: string;
  role: AdminRole;
  /** サイト管理者・表示のみが扱えるサイト。未指定はすべて */
  siteIds?: string[];
}

export interface Site {
  id: string;
  name: string;
  /** 選択中でないサイトの構成。選択中のサイトは構成ストアにある */
  scenario: Scenario | null;
}

export interface StoredBackup {
  id: string;
  time: number;
  label: string;
  auto?: boolean;
  file: BackupFile;
}

const MAX_EVENTS = 500;
const MAX_BACKUPS = 8;
export const ADOPT_MS = 2500;
export const UPGRADE_MS = 4000;

const DEFAULT_RULES: Record<EventCategory, boolean> = {
  device: true,
  client: false,
  wifi: true,
  security: true,
  switching: true,
  system: false,
  admin: true,
};

interface OpsState {
  events: OpsEvent[];
  alarmRules: Record<EventCategory, boolean>;
  sites: Site[];
  activeSiteId: string;
  admins: Admin[];
  currentAdminId: string;
  backups: StoredBackup[];

  log: (drafts: Omit<OpsEvent, "id" | "time" | "siteId">[]) => void;
  archive: (id: string) => void;
  archiveAll: () => void;
  clearEvents: () => void;
  setAlarmRule: (c: EventCategory, on: boolean) => void;

  addSite: (name: string, from: "default" | "copy") => string | null;
  renameSite: (id: string, name: string) => void;
  deleteSite: (id: string) => void;
  switchSite: (id: string) => void;

  saveAdmin: (a: Admin) => void;
  removeAdmin: (id: string) => void;
  loginAs: (id: string) => void;

  backupNow: (label?: string, auto?: boolean) => void;
  restore: (file: BackupFile, label: string) => void;
  deleteBackup: (id: string) => void;

  adopt: (deviceId: string) => void;
  upgrade: (deviceIds: string[]) => void;
}

const rid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fresh = (s: Scenario) => assignLeases(autoFloor(s));

/** 承認中・更新中のまま保存された機器を完了状態にする（再読み込みやサイト切り替えの後） */
export function finalizeStates(s: Scenario) {
  for (const d of s.devices) {
    if (d.state === "adopting") delete d.state;
    if (d.state === "upgrading") {
      delete d.state;
      d.firmware = LATEST_FIRMWARE[d.type];
    }
  }
  return s;
}

/** 権限の確認をしない変更（タイマーで進む承認・更新の完了用） */
let rawMutate: (fn: (s: Scenario) => void) => void = (fn) => useStore.getState().mutate(fn);
/** サイト切り替えなど、差分をイベントにしない構成の入れ替え中 */
let suppress = false;

export const useOps = create<OpsState>()(
  persist(
    (set, get) => ({
      events: [],
      alarmRules: DEFAULT_RULES,
      sites: [{ id: "default", name: "Default", scenario: null }],
      activeSiteId: "default",
      admins: [
        { id: "owner", name: "Owner", role: "super" },
        { id: "viewer", name: "Viewer", role: "viewer" },
      ],
      currentAdminId: "owner",
      backups: [],

      log: (drafts) => {
        if (!drafts.length) return;
        const siteId = currentSiteKey();
        const now = Date.now();
        const add = drafts.map((d, i) => ({ ...d, id: rid("ev"), time: now + i, siteId }));
        set({ events: [...add.reverse(), ...get().events].slice(0, MAX_EVENTS) });
      },
      archive: (id) => set({ events: get().events.map((e) => (e.id === id ? { ...e, archived: true } : e)) }),
      archiveAll: () => {
        const key = currentSiteKey();
        set({ events: get().events.map((e) => (e.siteId === key ? { ...e, archived: true } : e)) });
      },
      clearEvents: () => {
        const key = currentSiteKey();
        set({ events: get().events.filter((e) => e.siteId !== key) });
      },
      setAlarmRule: (c, on) => set({ alarmRules: { ...get().alarmRules, [c]: on } }),

      addSite: (name, from) => {
        if (!canManage()) return null;
        const id = rid("site");
        const scenario = from === "copy" ? structuredClone(useStore.getState().activeLessonId ? (useStore.getState().sandboxBackup ?? defaultScenario()) : useStore.getState().scenario) : defaultScenario();
        for (const c of scenario.clients) c.lease = null;
        set({ sites: [...get().sites, { id, name, scenario }] });
        get().log([{ category: "admin", severity: "info", message: `${adminName()} がサイト「${name}」を作成しました` }]);
        return id;
      },
      renameSite: (id, name) => {
        if (!canManage()) return;
        set({ sites: get().sites.map((x) => (x.id === id ? { ...x, name } : x)) });
      },
      deleteSite: (id) => {
        const site = get().sites.find((x) => x.id === id);
        if (!canManage() || !site || id === get().activeSiteId || get().sites.length <= 1) return;
        set({
          sites: get().sites.filter((x) => x.id !== id),
          admins: get().admins.map((a) => (a.siteIds ? { ...a, siteIds: a.siteIds.filter((x) => x !== id) } : a)),
        });
        get().log([{ category: "admin", severity: "warning", message: `${adminName()} がサイト「${site.name}」を削除しました` }]);
      },
      switchSite: (id) => {
        const { sites, activeSiteId } = get();
        const target = sites.find((x) => x.id === id);
        const main = useStore.getState();
        if (!target || id === activeSiteId || main.activeLessonId || !siteAllowed(id)) return;
        const current = structuredClone(main.scenario);
        suppress = true;
        set({
          sites: sites.map((x) => (x.id === activeSiteId ? { ...x, scenario: current } : x.id === id ? { ...x, scenario: null } : x)),
          activeSiteId: id,
        });
        useStore.setState({ scenario: fresh(finalizeStates(target.scenario ?? defaultScenario())) });
        suppress = false;
        resetBaseline();
        get().log([{ category: "system", severity: "info", message: `サイト「${target.name}」に切り替えました` }]);
      },

      saveAdmin: (a) => {
        if (!canManage()) return;
        const exists = get().admins.some((x) => x.id === a.id);
        const admins = exists ? get().admins.map((x) => (x.id === a.id ? a : x)) : [...get().admins, a];
        if (!admins.some((x) => x.role === "super")) return;
        set({ admins });
        get().log([{ category: "admin", severity: "info", message: `${adminName()} が管理者「${a.name}」を${exists ? "更新" : "追加"}しました（${ROLE_LABEL[a.role]}）` }]);
      },
      removeAdmin: (id) => {
        const a = get().admins.find((x) => x.id === id);
        if (!canManage() || !a || id === get().currentAdminId) return;
        if (a.role === "super" && get().admins.filter((x) => x.role === "super").length <= 1) return;
        set({ admins: get().admins.filter((x) => x.id !== id) });
        get().log([{ category: "admin", severity: "warning", message: `${adminName()} が管理者「${a.name}」を削除しました` }]);
      },
      loginAs: (id) => {
        const a = get().admins.find((x) => x.id === id);
        if (!a) return;
        set({ currentAdminId: id });
        get().log([{ category: "admin", severity: "info", message: `${a.name}（${ROLE_LABEL[a.role]}）がログインしました` }]);
        // 担当外のサイトを開いていたら、担当サイトへ移る
        if (!siteAllowed(get().activeSiteId)) {
          const next = get().sites.find((x) => siteAllowed(x.id));
          if (next) get().switchSite(next.id);
        }
      },

      backupNow: (label, auto) => {
        const main = useStore.getState();
        if (main.activeLessonId || (!auto && !canEdit())) return;
        const site = get().sites.find((x) => x.id === get().activeSiteId);
        const file = makeBackup(site?.name ?? "Site", main.scenario);
        const entry: StoredBackup = { id: rid("bk"), time: Date.now(), label: label ?? "手動バックアップ", auto, file };
        let list = [entry, ...get().backups];
        // 上限を超えたら、古い自動バックアップから消す
        while (list.length > MAX_BACKUPS) {
          const i = list.map((b) => !!b.auto).lastIndexOf(true);
          list = list.filter((_, j) => j !== (i > 0 ? i : list.length - 1));
        }
        set({ backups: list });
        if (!auto) get().log([{ category: "admin", severity: "info", message: `${adminName()} がバックアップを作成しました（${site?.name}）` }]);
      },
      restore: (file, label) => {
        if (!canManage() || useStore.getState().activeLessonId) return;
        get().backupNow("復元前の自動バックアップ", true);
        suppress = true;
        useStore.setState({ scenario: fresh(finalizeStates(structuredClone(file.scenario))) });
        suppress = false;
        resetBaseline();
        get().log([{ category: "admin", severity: "warning", message: `${adminName()} が「${label}」から構成を復元しました` }]);
      },
      deleteBackup: (id) => {
        if (!canManage()) return;
        set({ backups: get().backups.filter((b) => b.id !== id) });
      },

      adopt: (deviceId) => {
        if (!canEdit()) return denied();
        rawMutate((s) => {
          const d = s.devices.find((x) => x.id === deviceId);
          if (d?.state === "pending") d.state = "adopting";
        });
        setTimeout(() => rawMutate((s) => {
          const d = s.devices.find((x) => x.id === deviceId);
          if (d?.state === "adopting") delete d.state;
        }), ADOPT_MS);
      },
      upgrade: (deviceIds) => {
        if (!canEdit()) return denied();
        rawMutate((s) => {
          for (const d of s.devices) if (deviceIds.includes(d.id) && !d.state) d.state = "upgrading";
        });
        setTimeout(() => rawMutate((s) => {
          for (const d of s.devices)
            if (deviceIds.includes(d.id) && d.state === "upgrading") {
              delete d.state;
              d.firmware = LATEST_FIRMWARE[d.type];
            }
        }), UPGRADE_MS);
      },
    }),
    { name: "netlab-ops", version: 1 },
  ),
);

// ---------------------------------------------------------------------------
// 権限
// ---------------------------------------------------------------------------

export const currentAdmin = (st: Pick<OpsState, "admins" | "currentAdminId"> = useOps.getState()) =>
  st.admins.find((a) => a.id === st.currentAdminId) ?? st.admins[0];
const adminName = () => currentAdmin()?.name ?? "管理者";

export function siteAllowed(siteId: string, st: Pick<OpsState, "admins" | "currentAdminId"> = useOps.getState()) {
  const a = currentAdmin(st);
  return !a || a.role === "super" || !a.siteIds || a.siteIds.includes(siteId);
}
/** 構成を変更できるか（課題中は誰でも変更できる） */
export function canEdit(st: Pick<OpsState, "admins" | "currentAdminId" | "activeSiteId"> = useOps.getState()) {
  if (useStore.getState().activeLessonId) return true;
  const a = currentAdmin(st);
  return !a || (a.role !== "viewer" && siteAllowed(st.activeSiteId, st));
}
export const canManage = (st: Pick<OpsState, "admins" | "currentAdminId"> = useOps.getState()) => currentAdmin(st)?.role === "super";

export function useCanEdit() {
  const st = useOps();
  const lesson = useStore((x) => x.activeLessonId);
  return !!lesson || canEdit(st);
}
export const useCanManage = () => canManage(useOps());

let lastDenied = 0;
function denied() {
  if (Date.now() - lastDenied < 3000) return;
  lastDenied = Date.now();
  useOps.getState().log([{ category: "admin", severity: "warning", message: `${adminName()}（${ROLE_LABEL[currentAdmin()?.role ?? "viewer"]}）による変更を拒否しました` }]);
}

/** イベントの所属: 課題中は課題、それ以外は選択中のサイト */
export function currentSiteKey() {
  const lesson = useStore.getState().activeLessonId;
  return lesson ? `lesson:${lesson}` : useOps.getState().activeSiteId;
}

// ---------------------------------------------------------------------------
// 構成ストアへの接続（ブラウザのみ）
// ---------------------------------------------------------------------------

let baseline: OpsSnapshot | null = null;
let baselineKey = "";
let timer: ReturnType<typeof setTimeout> | undefined;

function resetBaseline() {
  baseline = snapshot(useStore.getState().scenario);
  baselineKey = currentSiteKey();
}

function flush() {
  timer = undefined;
  const s = useStore.getState().scenario;
  const key = currentSiteKey();
  if (!baseline || key !== baselineKey) {
    if (baseline && key !== baselineKey) {
      const lesson = useStore.getState().activeLessonId;
      useOps.getState().log([{ category: "system", severity: "info", message: lesson ? "課題を開始しました" : "サンドボックスに戻りました" }]);
    }
    resetBaseline();
    return;
  }
  const next = snapshot(s);
  const drafts = summarize(diffEvents(baseline, next, s));
  baseline = next;
  useOps.getState().log(drafts);
}

/** パケットトレースで止まった通信を記録する（同じ内容は 10 秒に 1 回） */
let lastTrace = { msg: "", at: 0 };
export function logTraceBlock(s: Scenario, q: TraceQuery, result: TraceResult) {
  const ev = traceBlockEvent(s, q.srcId, q.dst, result);
  if (!ev || (ev.message === lastTrace.msg && Date.now() - lastTrace.at < 10_000)) return;
  lastTrace = { msg: ev.message, at: Date.now() };
  useOps.getState().log([ev]);
}

const INSTALLED = Symbol.for("netlab.ops.installed");
if (typeof window !== "undefined" && !(globalThis as Record<symbol, unknown>)[INSTALLED]) {
  (globalThis as Record<symbol, unknown>)[INSTALLED] = true;
  const base = useStore.getState().mutate;
  rawMutate = base;
  // 表示のみの管理者は構成を変えられない（端末の操作を含む、すべての変更は mutate を通る）
  useStore.setState({
    mutate: (fn) => {
      if (!canEdit()) return denied();
      base(fn);
    },
  });
  // 承認中・更新中のまま閉じた場合は完了させる
  if (useStore.getState().scenario.devices.some((d) => d.state === "adopting" || d.state === "upgrading")) base(finalizeStates);
  resetBaseline();
  useStore.subscribe((state, prev) => {
    if (suppress || state.scenario === prev.scenario) return;
    clearTimeout(timer);
    timer = setTimeout(flush, 150);
  });
}
