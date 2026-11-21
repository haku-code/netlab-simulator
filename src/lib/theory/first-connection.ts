import { probe } from "../emu";
import type { Scenario } from "../model";
import { INTERNET_IP } from "../net/gateway";
import { resolveClient } from "../net/simulate";
import { makeDevice, network, wired, zones } from "../scenarios/builders";

type Setup = { cable: boolean; dhcp: boolean; dns: boolean };

export const FIRST_CONNECTION: Setup = { cable: true, dhcp: true, dns: true };

export function firstConnection({ cable, dhcp, dns }: Setup) {
  const router = makeDevice("gateway", "intro-router", "ルーター", "lan", 1);
  const lan = network("lan", "家庭の LAN", 1, 1);
  lan.dhcp.enabled = dhcp;
  if (!dns) lan.dhcp.dns = ["192.168.1.99"]; // 実習内にこの DNS サーバーは存在しない
  const pc = wired("intro-pc", "PC", "pc", router, 1);
  if (!cable) pc.connection = { type: "wired", deviceId: null, portId: null };
  const scenario: Scenario = { networks: [lan], devices: [router], clients: [pc], links: [], ssids: [], zones: zones(), policies: [] };
  const state = resolveClient(scenario, pc.id);
  const web = probe(scenario, pc.id, "example.com", "tcp", 443);
  const direct = probe(scenario, pc.id, INTERNET_IP, "tcp", 443);
  return { ip: state.ip, gateway: lan.gatewayIp, web, direct, webIp: INTERNET_IP };
}
