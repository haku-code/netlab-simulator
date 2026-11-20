"use client";

import { useSearchParams } from "next/navigation";
import type { Scenario } from "./model";
import { resolveClient, type ClientState } from "./net/simulate";
import { validate, type Issue } from "./net/validate";
import { useScenario } from "./store";

// Zustand は更新のたびに新しいシナリオを公開する。同じスナップショットを読む画面間で計算を共有する。
const issuesByScenario = new WeakMap<Scenario, Issue[]>();
const clientsByScenario = new WeakMap<Scenario, ReadonlyMap<string, ClientState>>();

export function useIssues() {
  const s = useScenario();
  const cached = issuesByScenario.get(s);
  if (cached) return cached;
  const issues = validate(s);
  issuesByScenario.set(s, issues);
  return issues;
}

export function useClientStates(): ReadonlyMap<string, ClientState> {
  const s = useScenario();
  const cached = clientsByScenario.get(s);
  if (cached) return cached;
  const states = new Map(s.clients.map((c) => [c.id, resolveClient(s, c.id)]));
  clientsByScenario.set(s, states);
  return states;
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
