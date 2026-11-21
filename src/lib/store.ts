"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LESSONS } from "./lessons";
import { isIPhone, type Client, type Scenario } from "./model";
import { autoFloor } from "./floor";
import { assignLeases, resolveClient } from "./net/simulate";
import { defaultScenario } from "./scenarios/default";
import { rememberWifiPassword } from "./wifi";
import { installDemoWebServers } from "./web";

interface State {
  scenario: Scenario;
  /** 課題中のみ: 課題開始前のサンドボックス */
  sandboxBackup: Scenario | null;
  activeLessonId: string | null;
  completed: string[];
  /** 基礎理論コースで確認問題に全問正解したユニット */
  theoryDone: string[];
  theme: "dark" | "light";
  lessonPanelOpen: boolean;

  /** 構成を変更する。変更後、IP を持たない DHCP 端末は自動で再要求する */
  mutate: (fn: (s: Scenario) => void) => void;
  /** DHCP リースを破棄して取り直す（ipconfig /renew 相当） */
  renewLease: (clientId: string) => void;
  joinWifi: (clientId: string, ssidId: string, password: string, identity?: string) => void;
  disconnectWifi: (clientId: string) => void;
  signInGuest: (clientId: string, password: string) => boolean;
  /** LAN ケーブルを挿す / 抜く（port が null なら抜く） */
  plugCable: (clientId: string, deviceId: string | null, portId: string | null) => void;
  resetScenario: () => void;
  startLesson: (id: string) => void;
  exitLesson: () => void;
  completeLesson: (id: string) => void;
  completeTheory: (id: string) => void;
  toggleTheme: () => void;
  setLessonPanelOpen: (open: boolean) => void;
}

/** 構成の初期化: 間取りがなければ作り、DHCP 端末に IP を割り当てる */
const fresh = (s: Scenario) => assignLeases(autoFloor(s));
/** 位置のない機器・端末（追加直後など）を間取りに置く */
const placeMissing = (s: Scenario) => (s.floor && (s.devices.some((d) => !d.pos) || s.clients.some((c) => !c.pos)) ? autoFloor(s) : s);

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const mutateClient = (id: string, fn: (c: Client, s: Scenario) => void) =>
        get().mutate((s) => {
          const c = s.clients.find((x) => x.id === id);
          if (c) fn(c, s);
        });

      return {
        scenario: fresh(defaultScenario()),
        sandboxBackup: null,
        activeLessonId: null,
        completed: [],
        theoryDone: [],
        theme: "light",
        lessonPanelOpen: true,

        mutate: (fn) => {
          const next = structuredClone(get().scenario);
          fn(next);
          set({ scenario: assignLeases(placeMissing(next)) });
        },
        renewLease: (id) => mutateClient(id, (c) => (c.lease = null)),
        joinWifi: (id, ssidId, password, identity) =>
          mutateClient(id, (c, s) => {
            const apId = c.connection.type === "wifi" ? c.connection.apId : s.devices.find((d) => d.type === "ap")?.id;
            if (!apId || !s.ssids.some((w) => w.id === ssidId)) return;
            rememberWifiPassword(s, c);
            c.connection = { type: "wifi", apId, ssidId };
            c.wifiPassword = password;
            c.wifiIdentity = identity;
            c.guestPortalSession = undefined;
            rememberWifiPassword(s, c);
            c.lease = null;
          }),
        disconnectWifi: (id) =>
          mutateClient(id, (c, s) => {
            rememberWifiPassword(s, c);
            if (c.connection.type === "wifi") c.connection = { ...c.connection, ssidId: null };
            c.wifiPassword = "";
            c.wifiIdentity = undefined;
            c.guestPortalSession = undefined;
            c.lease = null;
          }),
        signInGuest: (id, password) => {
          const s = get().scenario;
          if (!s.clients.some((c) => c.id === id)) return false;
          const state = resolveClient(s, id);
          const portal = state.guestPortal?.captivePortal;
          if (state.error || !state.ip || !state.toGateway?.ok || !portal?.password || portal.password !== password) return false;
          mutateClient(id, (c) => (c.guestPortalSession = portal.id));
          return true;
        },
        plugCable: (id, deviceId, portId) =>
          mutateClient(id, (c, s) => {
            rememberWifiPassword(s, c);
            c.connection = { type: "wired", deviceId, portId };
            c.wifiPassword = "";
            c.wifiIdentity = undefined;
            c.guestPortalSession = undefined;
            c.lease = null;
          }),
        resetScenario: () => {
          const lesson = LESSONS.find((l) => l.id === get().activeLessonId);
          set({ scenario: fresh(lesson ? lesson.scenario() : defaultScenario()) });
        },
        startLesson: (id) => {
          const lesson = LESSONS.find((l) => l.id === id);
          if (!lesson) return;
          const { activeLessonId, scenario, sandboxBackup } = get();
          set({
            scenario: fresh(lesson.scenario()),
            activeLessonId: id,
            lessonPanelOpen: true,
            sandboxBackup: activeLessonId ? sandboxBackup : scenario,
          });
        },
        exitLesson: () => {
          const { sandboxBackup } = get();
          set({ scenario: sandboxBackup ?? fresh(defaultScenario()), sandboxBackup: null, activeLessonId: null });
        },
        completeLesson: (id) => {
          if (!get().completed.includes(id)) set({ completed: [...get().completed, id] });
        },
        completeTheory: (id) => {
          if (!get().theoryDone.includes(id)) set({ theoryDone: [...get().theoryDone, id] });
        },
        toggleTheme: () => set({ theme: get().theme === "dark" ? "light" : "dark" }),
        setLessonPanelOpen: (lessonPanelOpen) => set({ lessonPanelOpen }),
      };
    },
    {
      name: "netlab-state",
      version: 7,
      migrate: (old, version) => {
        const prev = (old ?? {}) as Partial<State>;
        // 端末のリース等を追加した v3 より前の構成データは互換性がないので初期化する
        if (version < 3)
          return { scenario: fresh(defaultScenario()), sandboxBackup: null, activeLessonId: null, completed: prev.completed ?? [], theoryDone: [], theme: "light", lessonPanelOpen: true } as unknown as State;
        const migrateScenario = (s: Scenario | null | undefined, sandbox: boolean) => {
          if (!s) return s;
          if (version < 6) {
            for (const client of s.clients) {
              rememberWifiPassword(s, client);
              if (client.kind === "phone" && client.vendor === "Apple" && !isIPhone(client)) client.vendor = "Generic";
            }
          }
          if (!s.floor) autoFloor(s);
          if (version < 7 && sandbox) {
            installDemoWebServers(s);
            assignLeases(placeMissing(s));
          }
          return s;
        };
        return { ...prev, theoryDone: prev.theoryDone ?? [], scenario: migrateScenario(prev.scenario, !prev.activeLessonId), sandboxBackup: migrateScenario(prev.sandboxBackup, true) ?? null } as State;
      },
    },
  ),
);

export const useScenario = () => useStore((s) => s.scenario);
