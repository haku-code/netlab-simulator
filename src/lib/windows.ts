"use client";

import { create } from "zustand";

export interface EmuWindow {
  clientId: string;
  x: number;
  y: number;
  z: number;
}

interface WindowState {
  windows: EmuWindow[];
  open: (clientId: string) => void;
  close: (clientId: string) => void;
  focus: (clientId: string) => void;
  move: (clientId: string, x: number, y: number) => void;
}

let zTop = 1;

export const useWindows = create<WindowState>()((set, get) => ({
  windows: [],
  open: (clientId) => {
    const existing = get().windows.find((w) => w.clientId === clientId);
    if (existing) return get().focus(clientId);
    const n = get().windows.length;
    set({ windows: [...get().windows, { clientId, x: 120 + n * 32, y: 70 + n * 28, z: ++zTop }] });
  },
  close: (clientId) => set({ windows: get().windows.filter((w) => w.clientId !== clientId) }),
  focus: (clientId) => set({ windows: get().windows.map((w) => (w.clientId === clientId ? { ...w, z: ++zTop } : w)) }),
  move: (clientId, x, y) => set({ windows: get().windows.map((w) => (w.clientId === clientId ? { ...w, x, y } : w)) }),
}));
