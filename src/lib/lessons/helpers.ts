import type { TraceQuery } from "../net/simulate";
import { access, link, makeDevice, setPort, trunk } from "../scenarios/builders";

export const q = (srcId: string, dst: string, protocol: TraceQuery["protocol"] = "icmp", port: number | null = null): TraceQuery => ({
  srcId,
  dst,
  protocol,
  port,
});

/** 多くの課題で共通の「GW — SW — AP」構成。家庭の課題は AP 名を家庭向けにする */
export function baseTopology(site: "home" | "office" = "office") {
  const gw = setPort(makeDevice("gateway", "gw", "Gateway"), 1, trunk("lan", "all"));
  const sw = setPort(makeDevice("switch", "sw1", "Core Switch"), 1, trunk("lan", "all"));
  for (let i = 2; i <= 7; i++) setPort(sw, i, access("lan"));
  setPort(sw, 8, trunk("lan", "all"));
  const ap = setPort(makeDevice("ap", "ap1", site === "home" ? "Living Room AP" : "Office AP"), 1, trunk("lan", "all"));
  return { gw, sw, ap, links: [link(gw, 1, sw, 1), link(sw, 8, ap, 1)] };
}

