"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LESSONS } from "./lessons";
import type { Client, Scenario } from "./model";
import { autoFloor } from "./floor";
import { assignLeases } from "./net/simulate";
import { defaultScenario } from "./scenarios/default";

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
  joinWifi: (clientId: string, ssidId: string, password: string) => void;
  disconnectWifi: (clientId: string) => void;
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
        joinWifi: (id, ssidId, password) =>
          mutateClient(id, (c, s) => {
            const apId = c.connection.type === "wifi" ? c.connection.apId : s.devices.find((d) => d.type === "ap")?.id;
            if (!apId) return;
            c.connection = { type: "wifi", apId, ssidId };
            c.wifiPassword = password;
            c.lease = null;
          }),
        disconnectWifi: (id) =>
          mutateClient(id, (c) => {
            if (c.connection.type === "wifi") c.connection = { ...c.connection, ssidId: null };
            c.lease = null;
          }),
        plugCable: (id, deviceId, portId) =>
          mutateClient(id, (c) => {
            c.connection = { type: "wired", deviceId, portId };
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
      version: 5,
      migrate: (old, version) => {
        const prev = (old ?? {}) as Partial<State>;
        // 端末のリース等を追加した v3 より前の構成データは互換性がないので初期化する
        if (version < 3)
          return { scenario: fresh(defaultScenario()), sandboxBackup: null, activeLessonId: null, completed: prev.completed ?? [], theoryDone: [], theme: "light", lessonPanelOpen: true } as unknown as State;
        // v5: 間取り（フロアプラン）を追加
        const withFloor = (x: Scenario | null | undefined) => (x && !x.floor ? autoFloor(x) : x);
        return { ...prev, theoryDone: prev.theoryDone ?? [], scenario: withFloor(prev.scenario), sandboxBackup: withFloor(prev.sandboxBackup) ?? null } as State;
      },
    },
  ),
);

export const useScenario = () => useStore((s) => s.scenario);
