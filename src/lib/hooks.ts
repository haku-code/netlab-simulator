"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import type { Scenario } from "./model";
import { resolveClient, type ClientState } from "./net/simulate";
import { validate } from "./net/validate";
import { useScenario } from "./store";

export function useIssues() {
  const s = useScenario();
  return useMemo(() => validate(s), [s]);
}

export function useClientStates(): Map<string, ClientState> {
  const s = useScenario();
  return useMemo(() => new Map(s.clients.map((c) => [c.id, resolveClient(s, c.id)])), [s]);
}

export function networkOptions(s: Scenario, opts: { none?: string } = {}) {
  return [
    ...(opts.none ? [{ value: "", label: opts.none }] : []),
    ...s.networks.map((n) => ({ value: n.id, label: `${n.name} (${n.vlanId})` })),
  ];
}

export function useQueryId(): [string | null, (id: string | null) => void] {
  const id = useSearchParams().get("id");
  const update = (v: string | null) => {
    const url = new URL(window.location.href);
    if (v) url.searchParams.set("id", v);
    else url.searchParams.delete("id");
    window.history.replaceState(null, "", url);
  };
  return [id, update];
}
