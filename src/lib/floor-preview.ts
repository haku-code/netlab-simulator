"use client";

import { create } from "zustand";
import type { XY } from "./model";

type FloorDrag = { kind: "client" | "device"; id: string; pos: XY; moved: boolean };

export const useFloorPreview = create<{
  drag: FloorDrag | null;
  setDrag: (drag: FloorDrag | null) => void;
}>((set) => ({
  drag: null,
  setDrag: (drag) => set({ drag }),
}));
