"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SecurityDecision } from "./net/security";

type SecurityEvent = SecurityDecision & { at: number; client: string };

export const useSecurityLog = create<{
  events: SecurityEvent[];
  record: (client: string, decisions: SecurityDecision[] | undefined) => void;
}>()(persist((set) => ({
  events: [],
  record: (client, decisions) => {
    if (!decisions?.length) return;
    const at = Date.now();
    set(({ events }) => ({ events: [...decisions.map((decision) => ({ ...decision, at, client })), ...events].slice(0, 200) }));
  },
}), { name: "netlab-security-events" }));
