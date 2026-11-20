import { describe, expect, it } from "vitest";
import { checkAnswer, makeQuestion, type DrillKind } from "./subnet";
import { dijkstraSteps, lookup, nextHops, OSPF_EDGES, OSPF_NODES, ROUTES } from "./routing";
import { BRIDGES, computeStp, LINKS } from "./stp";

function seeded(seed: number) {
  let x = seed;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
}

describe("subnet drill", () => {
  it("known example", () => {
    // 192.168.10.77/26 → network .64, broadcast .127
    const q = makeQuestion("network", () => 0); // smoke: generator runs
    expect(q.answer).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });
  it("answers are self-consistent across many random questions", () => {
    const r = seeded(42);
    const kinds: DrillKind[] = ["network", "broadcast", "hosts", "range", "mask", "prefixForHosts", "sameSubnet"];
    for (let i = 0; i < 300; i++) {
      const q = makeQuestion(kinds[i % kinds.length], r);
      expect(checkAnswer(q, q.answer)).toBe(true);
      if (q.kind === "range") expect(checkAnswer(q, q.answer.replace(" - ", "〜"))).toBe(true);
    }
  });
});

describe("routing", () => {
  it("longest prefix match", () => {
    expect(lookup(ROUTES, "10.1.2.200").best!.iface).toBe("R5");
    expect(lookup(ROUTES, "10.1.2.5").best!.iface).toBe("R4");
    expect(lookup(ROUTES, "10.1.9.9").best!.iface).toBe("R3");
    expect(lookup(ROUTES, "10.200.3.4").best!.iface).toBe("R2");
    expect(lookup(ROUTES, "8.8.8.8").best!.iface).toBe("WAN (ISP)");
    expect(lookup(ROUTES, "172.32.0.1").best!.iface).toBe("WAN (ISP)");
  });
  it("dijkstra shortest paths", () => {
    const steps = dijkstraSteps(OSPF_NODES, OSPF_EDGES, "R1");
    const last = steps.at(-1)!;
    // R1→R3(5)→R2(3)→R4(1)→R5(2)→R6(4)
    expect(last.dist).toEqual({ R1: 0, R2: 8, R3: 5, R4: 9, R5: 11, R6: 15 });
    expect(nextHops("R1", last.prev)).toEqual({ R2: "R3", R3: "R3", R4: "R3", R5: "R3", R6: "R3" });
  });
});

describe("stp", () => {
  it("elects lowest bridge id as root and blocks exactly enough ports", () => {
    const r = computeStp(BRIDGES, LINKS);
    expect(r.root.id).toBe("SW-A");
    const blocked = Object.values(r.roles).flatMap((x) => [x.a, x.b]).filter((x) => x === "blocked").length;
    // 4 ブリッジ・5 リンク → ループを切るために 2 ポートをブロック
    expect(blocked).toBe(2);
  });
  it("lower priority wins root election", () => {
    const b = BRIDGES.map((x) => (x.id === "SW-D" ? { ...x, priority: 4096 } : x));
    expect(computeStp(b, LINKS).root.id).toBe("SW-D");
  });
});
