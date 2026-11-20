"use client";

import { useEffect, useState } from "react";
import { useClientStates } from "@/lib/hooks";
import type { Client, ClientKind } from "@/lib/model";
import Link from "next/link";
import { netInfo } from "@/lib/emu";
import { ipToStr, parseIp } from "@/lib/net/ip";
import { roomAt } from "@/lib/floor";
import { useStore } from "@/lib/store";
import { useWindows } from "@/lib/windows";
import { rememberWifiPassword, savedWifiPassword } from "@/lib/wifi";
import { portBusy } from "@/lib/topo";
import { CLIENT_KIND_LABEL, ClientIcon } from "../icons";
import { Button, Checkbox, Field, Input, KV, Select, SidePanel, Status, Tabs, Toggle, useDraft } from "../ui";

type Tab = "overview" | "settings";

export function ClientPanel({ clientId, onClose }: { clientId: string | null; onClose: () => void }) {
  const s = useStore((x) => x.scenario);
  const mutate = useStore((x) => x.mutate);
  const st = useClientStates().get(clientId ?? "");
  const [tab, setTab] = useState<Tab>("overview");
  const openWindow = useWindows((w) => w.open);
  const client = s.clients.find((c) => c.id === clientId);
  // リースが変わったとき（Renew 等）も読み直す
  const { draft, update, dirty, reset } = useDraft<Client>(client, `${clientId}:${client?.lease?.ip ?? ""}`);
  useEffect(() => setTab("overview"), [clientId]);

  if (!client || !st || !draft) return null;

  const reservation = draft.reservedIp?.trim();
  const reservedAddress = reservation ? parseIp(reservation) : null;
  const invalidReservation = draft.ipMode === "dhcp" && !!reservation && reservedAddress === null;
  const portOptions = s.devices
    .filter((d) => d.type !== "ap")
    .flatMap((d) => d.ports.filter((p) => !portBusy(s, d.id, p.id, { clientId: client.id })).map((p) => ({ value: `${d.id}|${p.id}`, label: `${d.name} · ${p.name}` })));
  const aps = s.devices.filter((d) => d.type === "ap");

  return (
    <SidePanel
      open
      onClose={onClose}
      icon={
        <span className="flex size-10 items-center justify-center rounded-full border border-line text-fg-2">
          <ClientIcon kind={client.kind} size={18} />
        </span>
      }
      title={client.name}
      subtitle={<Status ok={!st.error} label={st.error ? "接続に問題があります" : "オンライン"} />}
      tabs={
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "overview", label: "概要" },
            { value: "settings", label: "設定" },
          ]}
        />
      }
      footer={
        tab === "settings" ? (
          <>
            <Button variant="primary" disabled={!dirty || invalidReservation} onClick={() =>
                mutate((sc) => {
                  // 接続先や IP 設定が変わったら、端末はつなぎ直して DHCP を取り直す
                  const index = sc.clients.findIndex((c) => c.id === client.id);
                  const previous = sc.clients[index];
                  if (!previous) return;
                  const relinked = JSON.stringify(draft.connection) !== JSON.stringify(previous.connection) || draft.ipMode !== previous.ipMode;
                  const ssidBefore = previous.connection.type === "wifi" ? previous.connection.ssidId : null;
                  const ssidAfter = draft.connection.type === "wifi" ? draft.connection.ssidId : null;
                  rememberWifiPassword(sc, previous);
                  const wifiPassword = ssidBefore === ssidAfter ? previous.wifiPassword : ssidAfter ? savedWifiPassword(previous, ssidAfter) ?? "" : "";
                  const wifiIdentity = ssidBefore === ssidAfter ? previous.wifiIdentity : ssidAfter ? previous.wifiIdentities?.[ssidAfter] : undefined;
                  sc.clients[index] = { ...draft, reservedIp: reservedAddress === null ? undefined : ipToStr(reservedAddress), lease: relinked ? null : previous.lease, wifiPassword, wifiIdentity, wifiPasswords: previous.wifiPasswords, wifiIdentities: previous.wifiIdentities, webService: previous.webService };
                })
              }>
              変更を適用
            </Button>
            <Button disabled={!dirty} onClick={reset}>
              元に戻す
            </Button>
          </>
        ) : undefined
      }
    >
      {tab === "overview" && (
        <>
          <Button variant="primary" className="w-full" onClick={() => openWindow(client.id)}>
            端末を操作する
          </Button>
          {st.error && <div className="rounded border border-err/30 bg-err/5 px-3 py-2.5 text-[12.5px] leading-relaxed text-err">{st.error}</div>}
          <KV
            rows={[
              ["接続方式", client.connection.type === "wired" ? "有線" : "Wi-Fi"],
              ...(client.connection.type === "wifi" ? ([["無線情報", netInfo(s, client.id).radio ?? "—"]] as [string, string][]) : []),
              ["上流接続", st.how ?? "—"],
              ["ネットワーク", st.network ? `${st.network.name}` : "—"],
              ["VLAN", st.network ? String(st.network.vlanId) : "—"],
              ["IP アドレス", <span key="ip" className="tnum">{st.ip ?? "—"}{client.ipMode === "static" && <span className="ml-1.5 text-muted">（固定）</span>}</span>],
              ["DHCP Lease", client.ipMode === "static" ? "—" : client.lease ? (st.staleLease ? <span key="l" className="text-err">古いリース</span> : "有効") : "なし"],
              ["MAC アドレス", <span key="mac" className="tnum">{client.mac}</span>],
              ["メーカー", client.vendor],
              ["種類", CLIENT_KIND_LABEL[client.kind]],
            ]}
          />
        </>
      )}
      {tab === "settings" && (
        <>
          <Field label="表示名">
            <Input value={draft.name} onChange={(e) => update((c) => (c.name = e.target.value))} />
          </Field>
          <Field label="端末の種類">
            <Select value={draft.kind} onChange={(v) => update((c) => (c.kind = v as ClientKind))} options={Object.entries(CLIENT_KIND_LABEL).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="接続方式">
            <Select
              value={draft.connection.type}
              onChange={(v) =>
                update((c) => {
                  if (v === "wired" && portOptions[0]) {
                    const [deviceId, portId] = portOptions[0].value.split("|");
                    c.connection = { type: "wired", deviceId, portId };
                  } else if (v === "wifi" && aps[0] && s.ssids[0]) {
                    c.connection = { type: "wifi", apId: aps[0].id, ssidId: s.ssids[0].id };
                  }
                })
              }
              options={[
                { value: "wired", label: "有線" },
                { value: "wifi", label: "Wi-Fi" },
              ]}
            />
          </Field>
          {draft.connection.type === "wired" ? (
            <Field label="スイッチポート" term="access">
              <Select
                value={draft.connection.deviceId ? `${draft.connection.deviceId}|${draft.connection.portId}` : ""}
                onChange={(v) =>
                  update((c) => {
                    const [deviceId, portId] = v ? v.split("|") : [null, null];
                    c.connection = { type: "wired", deviceId, portId };
                  })
                }
                options={[{ value: "", label: "未接続 (ケーブルを抜く)" }, ...portOptions]}
              />
            </Field>
          ) : (
            <>
              {s.floor && client.pos ? (
                <Field label="場所" hint="端末は、電波が最も強い AP に自動で接続します（ローミング）。">
                  <div className="flex items-center justify-between rounded border border-line bg-surface-2 px-2.5 py-1.5">
                    <span>
                      {roomAt(s.floor, client.pos)?.name ?? "—"}
                      {st.attachDeviceId && <span className="text-muted"> · {s.devices.find((d) => d.id === st.attachDeviceId)?.name}</span>}
                    </span>
                    <Link href={`/floorplan?client=${client.id}`} className="text-[12px] text-accent hover:underline">
                      フロアプランで移動
                    </Link>
                  </div>
                </Field>
              ) : (
                <Field label="アクセスポイント" hint="端末がいる場所の AP。その AP が配信している SSID にだけ接続できます。">
                  <Select value={draft.connection.apId} onChange={(v) => update((c) => c.connection.type === "wifi" && (c.connection.apId = v))} options={aps.map((a) => ({ value: a.id, label: a.name }))} />
                </Field>
              )}
              <Field label="Wi-Fi ネットワーク" term="ssid">
                <Select
                  value={draft.connection.ssidId ?? ""}
                  onChange={(v) => update((c) => c.connection.type === "wifi" && (c.connection.ssidId = v || null))}
                  options={[{ value: "", label: "未接続" }, ...s.ssids.map((w) => ({ value: w.id, label: w.name }))]}
                />
              </Field>
              <Field label="Wi-Fi 互換性">
                <Checkbox checked={!!draft.wifiLegacyOnly} onChange={(v) => update((c) => (c.wifiLegacyOnly = v))} label="旧端末を模擬（WEP / WPA まで）" />
                <Checkbox checked={!!draft.wifiCertificate} onChange={(v) => update((c) => (c.wifiCertificate = v))} label="実習用 Wi-Fi 証明書を登録" />
              </Field>
            </>
          )}
          <div className="flex items-center justify-between">
            <span>固定 IP アドレス</span>
            <Toggle checked={draft.ipMode === "static"} onChange={(v) => update((c) => (c.ipMode = v ? "static" : "dhcp"))} />
          </div>
          {draft.ipMode === "static" && (
            <Field label="IP アドレス" hint={st.network ? `${st.network.name}: ${st.network.cidr}` : undefined}>
              <Input className="tnum" value={draft.staticIp} placeholder="192.168.1.50" onChange={(e) => update((c) => (c.staticIp = e.target.value))} />
            </Field>
          )}
          {draft.ipMode === "dhcp" && (
            <Field label="DHCP 予約 IP アドレス" hint="指定した IP を次回のリース更新で割り当てます。空欄では DHCP の割り当て範囲から取得します。"
              error={invalidReservation ? "有効な IPv4 アドレスを入力してください。" : undefined}>
              <Input aria-label="DHCP 予約 IP アドレス" aria-invalid={invalidReservation} className="tnum"
                value={draft.reservedIp ?? ""} placeholder="192.168.1.50" onChange={(e) => update((c) => (c.reservedIp = e.target.value))} />
            </Field>
          )}
          <div className="border-t border-line pt-4">
            <Button
              variant="danger"
              onClick={() => {
                mutate((sc) => {
                  sc.clients = sc.clients.filter((c) => c.id !== client.id);
                });
                onClose();
              }}
            >
              クライアントを削除
            </Button>
          </div>
        </>
      )}
    </SidePanel>
  );
}
