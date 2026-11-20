// mDNS (Bonjour) によるサービス探索のシミュレーション
import type { Client, ClientKind, Scenario } from "./model";
import { findNetwork, l2Path, resolveClient } from "./net/simulate";

export interface Service {
  type: string;
  label: string;
  port: number;
}

/** 端末の種類ごとに広告するサービス */
export const SERVICES: Partial<Record<ClientKind, Service[]>> = {
  tv: [
    { type: "_googlecast._tcp", label: "Cast", port: 8009 },
    { type: "_airplay._tcp", label: "AirPlay", port: 7000 },
  ],
  printer: [{ type: "_ipp._tcp", label: "IPP プリンター", port: 631 }],
  server: [{ type: "_smb._tcp", label: "ファイル共有", port: 445 }],
  iot: [{ type: "_hap._tcp", label: "スマートホーム", port: 80 }],
};

export interface Discovery {
  client: Client;
  service: Service;
  visible: boolean;
  /** 見えた経路 / 見えない理由 */
  reason: string;
  ip?: string;
}

/** 送信元端末から、指定した種類のサービスが見えるか */
export function discover(s: Scenario, srcId: string, types: string[]): Discovery[] {
  const src = resolveClient(s, srcId);
  const out: Discovery[] = [];
  const reflect = s.mdns?.enabled ? s.mdns.networkIds : [];

  for (const c of s.clients) {
    if (c.id === srcId) continue;
    for (const service of SERVICES[c.kind] ?? []) {
      if (!types.includes(service.type)) continue;
      const dst = resolveClient(s, c.id);
      const push = (visible: boolean, reason: string) => out.push({ client: c, service, visible, reason, ip: dst.ip });

      if (src.error || !src.network) {
        push(false, "この端末がネットワークに接続されていないため、探索パケットを送れません。");
        continue;
      }
      if (dst.error || !dst.network) {
        push(false, `${c.name} がネットワークに接続されていません。`);
        continue;
      }
      if (src.network.id === dst.network.id) {
        // 同じ VLAN: マルチキャストがそのまま届く
        const bothWifi = src.client.connection.type === "wifi" && c.connection.type === "wifi";
        const iso = bothWifi && s.ssids.find((w) => [src.client, c].some((x) => x.connection.type === "wifi" && x.connection.ssidId === w.id) && w.clientIsolation);
        if (iso) {
          push(false, `SSID「${iso.name}」の Client Device Isolation により、無線端末同士のマルチキャストも届きません。`);
          continue;
        }
        const r = l2Path(s, src.network.id, src.attachDeviceId!, dst.attachDeviceId!);
        push(r.ok, r.ok ? `同じネットワーク (${src.network.name}) なのでマルチキャストが直接届きます。` : r.reason);
        continue;
      }
      // 別の VLAN: リフレクターがなければ届かない
      const dstNet = findNetwork(s, dst.network.id)!;
      if (!reflect.includes(src.network.id) || !reflect.includes(dstNet.id)) {
        push(
          false,
          `${c.name} は別のネットワーク (${dstNet.name} / VLAN ${dstNet.vlanId}) にいます。mDNS はマルチキャストなのでルーターを越えません。Settings > Networks の Multicast DNS で ${src.network.name} と ${dstNet.name} を中継する必要があります。`,
        );
        continue;
      }
      if (!src.toGateway?.ok || !dst.toGateway?.ok) {
        push(false, "ゲートウェイ (mDNS リフレクター) まで届かないため中継されません。");
        continue;
      }
      push(true, `ゲートウェイの mDNS リフレクターが ${dstNet.name} → ${src.network.name} に広告を中継しています。`);
    }
  }
  return out;
}

export const CAST_TYPES = ["_googlecast._tcp", "_airplay._tcp"];
export const PRINT_TYPES = ["_ipp._tcp"];
