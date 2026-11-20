"use client";

import { create } from "zustand";
import type { Scenario } from "./model";
import { observeWifiPackets, wifiPacketContext, type PcPacket } from "./pc-packets";

export type CapturedPacket = PcPacket & { no: number; time: number };
const LIMIT = 500;
const EMPTY: CapturedPacket[] = [];
const emptySession = { running: false, startedAt: 0, frames: EMPTY, nextNumber: 1, ssidId: null as string | null };

type CaptureSession = typeof emptySession;

export const usePcCapture = create<{
  sessions: Record<string, CaptureSession>;
  start: (id: string, ssidId?: string | null) => void;
  stop: (id: string) => void;
  record: (id: string, build: () => PcPacket[], scenario?: Scenario) => void;
}>((set, get) => ({
  sessions: {},
  start: (id, ssidId = null) => set(({ sessions }) => ({
    sessions: { ...sessions, [id]: { ...emptySession, ssidId, running: true, startedAt: performance.now() } },
  })),
  stop: (id) => {
    const session = get().sessions[id];
    if (session?.running) set(({ sessions }) => ({ sessions: { ...sessions, [id]: { ...session, running: false } } }));
  },
  record: (id, build, scenario) => {
    const sessions = get().sessions;
    const active = Object.entries(sessions).filter(([, session]) => session.running);
    const source = scenario?.clients.find((c) => c.id === id)?.connection;
    const ssidId = source?.type === "wifi" ? source.ssidId : null;
    const listeners = active.filter(([, session]) => !!ssidId && session.ssidId === ssidId);
    const context = scenario && listeners.length ? wifiPacketContext(scenario, id) : null;
    const local = active.some(([owner, session]) => owner === id && !session.ssidId);
    if (!local && !context) return;
    const generated = build();
    if (!generated.length) return;
    const observed = context ? observeWifiPackets(generated, context) : [];
    const next = { ...sessions };
    for (const [owner, session] of active) {
      const packets = session.ssidId ? (session.ssidId === ssidId ? observed : []) : owner === id ? generated : [];
      if (!packets.length) continue;
      const time = Math.max(performance.now() - session.startedAt, (session.frames.at(-1)?.time ?? -1) + 1);
      const burst = packets.map((packet, i) => ({ ...packet, no: session.nextNumber + i, time: time + i }));
      next[owner] = { ...session, frames: [...session.frames, ...burst].slice(-LIMIT), nextNumber: session.nextNumber + burst.length };
    }
    set({ sessions: next });
  },
}));
