"use client";

import { create } from "zustand";
import type { PcPacket } from "./pc-packets";

export type CapturedPacket = PcPacket & { no: number; time: number };
const LIMIT = 500;
const EMPTY: CapturedPacket[] = [];
const emptySession = { running: false, startedAt: 0, frames: EMPTY, nextNumber: 1 };

type CaptureSession = typeof emptySession;

export const usePcCapture = create<{
  sessions: Record<string, CaptureSession>;
  start: (id: string) => void;
  stop: (id: string) => void;
  record: (id: string, build: () => PcPacket[]) => void;
}>((set, get) => ({
  sessions: {},
  start: (id) => set(({ sessions }) => ({
    sessions: { ...sessions, [id]: { ...emptySession, running: true, startedAt: performance.now() } },
  })),
  stop: (id) => {
    const session = get().sessions[id];
    if (session?.running) set(({ sessions }) => ({ sessions: { ...sessions, [id]: { ...session, running: false } } }));
  },
  record: (id, build) => {
    const session = get().sessions[id];
    if (!session?.running) return;
    const time = Math.max(performance.now() - session.startedAt, (session.frames.at(-1)?.time ?? -1) + 1);
    const burst = build().map((packet, i) => ({ ...packet, no: session.nextNumber + i, time: time + i }));
    if (!burst.length) return;
    set(({ sessions }) => ({
      sessions: {
        ...sessions,
        [id]: { ...session, frames: [...session.frames, ...burst].slice(-LIMIT), nextNumber: session.nextNumber + burst.length },
      },
    }));
  },
}));
