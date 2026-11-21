"use client";

import clsx from "clsx";
import { Plus } from "lucide-react";
import { BackLink, Button, Checkbox, FormRow, FormSection, Input, Notice, PageHeader, Select, Toggle, table as t, useDraft } from "@/components/ui";
import { useIssues, useQueryId } from "@/lib/hooks";
import { ipToStr, maskStr, parseCidr, parseIp } from "@/lib/net/ip";
import { formatIpv6, ipv6Gateway, lanIpv6Prefix } from "@/lib/net/ipv6";
import { clientNetworkId, zoneName } from "@/lib/net/simulate";
import { DEFAULT_DHCP_LEASE_TIME, uid, type Network, type Scenario } from "@/lib/model";
import { useStore } from "@/lib/store";

export default function NetworksPage() {
  const s = useStore((x) => x.scenario);
  const issues = useIssues().filter((i) => i.area === "networks");
  const [selId, setSelId] = useQueryId();

  if (selId) return <NetworkForm s={s} id={selId} onBack={() => setSelId(null)} />;

  return (
    <>
      <PageHeader title="ネットワーク" count={s.networks.length}>
        <Button variant="primary" onClick={() => setSelId("new")}>
          <Plus size={14} /> 新規作成
        </Button>
      </PageHeader>
      <Notice issues={issues} />
      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr>
              <th className={t.th}>名前</th>
              <th className={t.th}>ルーター</th>
              <th className={t.th}>VLAN ID</th>
              <th className={t.th}>ゲートウェイ IP / サブネット</th>
              <th className={t.th}>ゾーン</th>
              <th className={t.th}>DHCP</th>
              <th className={clsx(t.th, "text-right")}>クライアント</th>
            </tr>
          </thead>
          <tbody>
            {s.networks.map((n) => (
              <tr key={n.id} className={t.tr} onClick={() => setSelId(n.id)}>
                <td className={clsx(t.td, "font-medium")}>{n.name}</td>
                <td className={clsx(t.td, "text-fg-2")}>ゲートウェイ</td>
                <td className={clsx(t.td, "tnum")}>{n.vlanId}</td>
                <td className={clsx(t.td, "tnum")}>
                  {n.gatewayIp}/{parseCidr(n.cidr)?.prefix ?? "?"}
                  {n.ipv6Prefix !== undefined && <div className="text-muted">{n.ipv6Prefix}</div>}
                </td>
                <td className={t.td}>{zoneName(s, n.zoneId)}</td>
                <td className={clsx(t.td, "tnum text-fg-2")}>{n.dhcp.enabled ? `${n.dhcp.start} - ${n.dhcp.end}` : "なし"}</td>
                <td className={clsx(t.td, "tnum text-right")}>{s.clients.filter((c) => clientNetworkId(s, c) === n.id).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <GlobalSettings s={s} />
    </>
  );
}

/** Global Network Settings: Multicast DNS（mDNS リフレクター） */
function GlobalSettings({ s }: { s: Scenario }) {
  const mutate = useStore((x) => x.mutate);
  const mdns = s.mdns ?? { enabled: false, networkIds: [] };
  const set = (next: typeof mdns) => mutate((sc) => (sc.mdns = next));
  return (
    <div className="mt-6 max-w-3xl">
      <h2 className="mb-1 text-[13px] font-semibold">ネットワーク共通設定</h2>
      <FormRow label="マルチキャスト DNS (mDNS)" term="mdns" hint="選んだネットワーク間で、TV・プリンターなどのサービス広告 (Bonjour / mDNS) をゲートウェイが中継します。">
        <div className="flex h-8 items-center">
          <Toggle checked={mdns.enabled} onChange={(v) => set({ ...mdns, enabled: v })} />
        </div>
        {mdns.enabled && (
          <div className="mt-2 rounded border border-line bg-surface px-3 py-1.5">
            {s.networks.map((n) => (
              <Checkbox
                key={n.id}
                checked={mdns.networkIds.includes(n.id)}
                onChange={(on) => set({ ...mdns, networkIds: on ? [...mdns.networkIds, n.id] : mdns.networkIds.filter((x) => x !== n.id) })}
                label={
                  <>
                    {n.name} <span className="text-muted">({n.vlanId})</span>
                  </>
                }
              />
            ))}
          </div>
        )}
      </FormRow>
    </div>
  );
}

function blankNetwork(s: Scenario): Network {
  const used = new Set(s.networks.map((n) => n.vlanId));
  let vlan = 10;
  while (used.has(vlan)) vlan += 10;
  const o = Math.min(vlan, 254);
  return {
    id: uid("net"),
    name: "",
    vlanId: vlan,
    cidr: `192.168.${o}.0/24`,
    gatewayIp: `192.168.${o}.1`,
    dhcp: { enabled: true, start: `192.168.${o}.6`, end: `192.168.${o}.254` },
    isolateNetwork: false,
    internetAccess: true,
    zoneId: "internal",
  };
}

function NetworkForm({ s, id, onBack }: { s: Scenario; id: string; onBack: () => void }) {
  const mutate = useStore((x) => x.mutate);
  const issues = useIssues().filter((i) => i.targetId === id);
  const isNew = id === "new";
  const existing = s.networks.find((n) => n.id === id);
  const { draft, update, dirty, reset } = useDraft<Network>(isNew ? blankNetwork(s) : existing, id);
  if (!draft) return <BackLink onClick={onBack}>ネットワーク</BackLink>;

  // UniFi と同じく「ゲートウェイ IP/プレフィックス」を 1 つの欄で編集する
  const gwCidr = `${draft.gatewayIp}/${parseCidr(draft.cidr)?.prefix ?? 24}`;
  const setGwCidr = (v: string) =>
    update((n) => {
      const [ip, prefix] = v.split("/");
      n.gatewayIp = ip ?? "";
      const sn = parseCidr(`${ip}/${prefix ?? ""}`);
      n.cidr = sn ? `${ipToStr(sn.network)}/${sn.prefix}` : `${ip}/${prefix ?? ""}`;
    });
  const sn = parseCidr(draft.cidr);
  const gwOk = parseIp(draft.gatewayIp) !== null && !!sn;
  const leaseTime = draft.dhcp.leaseTime;
  const invalidLease = leaseTime !== undefined && (!Number.isSafeInteger(leaseTime) || leaseTime < 1);
  const dns = (draft.dhcp.dns ?? []).flatMap((entry) => entry.trim().split(/\s+/)).filter(Boolean);
  const invalidDns = dns.some((entry) => parseIp(entry) === null);
  const ipv6Enabled = draft.ipv6Prefix !== undefined;
  const ipv6 = lanIpv6Prefix(draft.ipv6Prefix);
  const ipv6Error = !ipv6Enabled ? undefined : !ipv6 ? "グローバルまたは ULA の /64 を入力してください。"
    : s.networks.some((n) => n.id !== draft.id && lanIpv6Prefix(n.ipv6Prefix)?.network === ipv6.network)
      ? "別のネットワークと IPv6 プレフィックスが重複しています。" : undefined;

  const save = () => {
    mutate((sc) => {
      const dnsServers = dns.map(parseIp).filter((ip) => ip !== null).map(ipToStr);
      const n = {
        ...draft,
        ipv6Prefix: ipv6 ? `${formatIpv6(ipv6.network)}/64` : undefined,
        name: draft.name.trim() || `VLAN${draft.vlanId}`,
        dhcp: { ...draft.dhcp, dns: dnsServers.length ? [...new Set(dnsServers)] : undefined },
      };
      const i = sc.networks.findIndex((x) => x.id === n.id);
      if (i >= 0) sc.networks[i] = n;
      else sc.networks.push(n);
    });
    onBack();
  };

  const remove = () => {
    if (!existing || !confirm(`${existing.name} を削除しますか？ ポート・SSID・ポリシーの参照は解除されます。`)) return;
    mutate((sc) => {
      sc.networks = sc.networks.filter((n) => n.id !== id);
      for (const d of sc.devices)
        for (const p of d.ports) {
          if (p.nativeNetworkId === id) p.nativeNetworkId = null;
          p.taggedNetworkIds = p.taggedNetworkIds.filter((x) => x !== id);
        }
      for (const w of sc.ssids) if (w.networkId === id) w.networkId = null;
      sc.policies = sc.policies.filter((r) => r.src !== id && r.dst !== id);
    });
    onBack();
  };

  return (
    <div className="max-w-3xl">
      <BackLink onClick={onBack}>ネットワーク</BackLink>
      <h1 className="mb-2 text-[15px] font-semibold">{isNew ? "ネットワークを新規作成" : existing?.name}</h1>
      <Notice issues={issues} />
      <FormSection title="基本設定">
        <FormRow label="ネットワーク名">
          <Input value={draft.name} placeholder="例: IoT" onChange={(e) => update((n) => (n.name = e.target.value))} />
        </FormRow>
        <FormRow label="ルーター">
          <Select value="gw" onChange={() => {}} options={[{ value: "gw", label: "ゲートウェイ" }]} disabled />
        </FormRow>
        <FormRow
          label="ゲートウェイ IP / サブネット"
          term="subnet"
          error={gwOk ? null : "例: 192.168.10.1/24"}
          hint={sn ? `Subnet ${ipToStr(sn.network)}/${sn.prefix} · Mask ${maskStr(sn.prefix)} · ${Math.max(sn.size - 2, 0)} hosts` : undefined}
        >
          <Input className="tnum" value={gwCidr} onChange={(e) => setGwCidr(e.target.value)} />
        </FormRow>
        <FormRow label="VLAN ID" term="vlan">
          <Input type="number" min={1} max={4094} className="tnum" value={draft.vlanId} onChange={(e) => update((n) => (n.vlanId = Number(e.target.value)))} />
        </FormRow>
        <FormRow label="ゾーン" term="zone">
          <Select value={draft.zoneId} onChange={(v) => update((n) => (n.zoneId = v))} options={s.zones.filter((z) => !["external", "gateway"].includes(z.id)).map((z) => ({ value: z.id, label: z.name }))} />
        </FormRow>
      </FormSection>
      <FormSection title="DHCP">
        <FormRow label="DHCP モード" term="dhcp">
          <Select
            value={draft.dhcp.enabled ? "server" : "none"}
            onChange={(v) => update((n) => (n.dhcp.enabled = v === "server"))}
            options={[
              { value: "server", label: "DHCP サーバー" },
              { value: "none", label: "なし" },
            ]}
          />
        </FormRow>
        {draft.dhcp.enabled && (
          <>
            <FormRow label="DHCP の割り当て範囲">
              <div className="flex items-center gap-2">
                <Input className="tnum" value={draft.dhcp.start} onChange={(e) => update((n) => (n.dhcp.start = e.target.value))} />
                <span className="text-muted">–</span>
                <Input className="tnum" value={draft.dhcp.end} onChange={(e) => update((n) => (n.dhcp.end = e.target.value))} />
              </div>
            </FormRow>
            <FormRow label="DHCP リース期間（秒）" hint="空欄では 86400 秒（24 時間）です。"
              error={invalidLease ? "1 秒以上の整数を入力してください。" : undefined}>
              <Input aria-label="DHCP リース期間（秒）" aria-invalid={invalidLease} type="number" min={1} step={1}
                className="tnum" placeholder={String(DEFAULT_DHCP_LEASE_TIME)} value={leaseTime ?? ""}
                onChange={(e) => update((n) => (n.dhcp.leaseTime = e.target.value === "" ? undefined : e.target.valueAsNumber))} />
            </FormRow>
            <FormRow label="DNS サーバー" hint="IPv4 をカンマ区切りで入力します。先頭のサーバーを使い、空欄ではゲートウェイを使います。"
              error={invalidDns ? "DNS サーバーの IPv4 アドレスを確認してください。" : undefined}>
              <Input aria-label="DNS サーバー" aria-invalid={invalidDns} className="tnum" placeholder={draft.gatewayIp}
                value={draft.dhcp.dns?.join(",") ?? ""}
                onChange={(e) => update((n) => (n.dhcp.dns = e.target.value.split(/[,、]/)))} />
            </FormRow>
          </>
        )}
      </FormSection>
      <FormSection title="IPv6">
        <FormRow label="IPv6 アドレスの自動設定 (SLAAC)" hint="ルーター広告でこの VLAN の端末にプレフィックスを配ります。">
          <Toggle label="IPv6 アドレスの自動設定" checked={ipv6Enabled} onChange={(enabled) => update((n) => {
            n.ipv6Prefix = enabled ? `2001:db8:1:${n.vlanId.toString(16)}::/64` : undefined;
          })} />
        </FormRow>
        {ipv6Enabled && (
          <FormRow label="IPv6 プレフィックス" error={ipv6Error} hint={ipv6 ? `ゲートウェイ ${ipv6Gateway(draft)}` : undefined}>
            <Input aria-label="IPv6 プレフィックス" aria-invalid={!!ipv6Error} value={draft.ipv6Prefix} placeholder="2001:db8:1:1::/64"
              onChange={(e) => update((n) => (n.ipv6Prefix = e.target.value))} />
          </FormRow>
        )}
      </FormSection>
      <FormSection title="詳細設定">
        <FormRow label="インターネット接続を許可" term="nat">
          <div className="flex h-8 items-center">
            <Toggle checked={draft.internetAccess} onChange={(v) => update((n) => (n.internetAccess = v))} />
          </div>
        </FormRow>
        <FormRow label="ネットワークを分離" term="isolate-network">
          <div className="flex h-8 items-center">
            <Toggle checked={draft.isolateNetwork} onChange={(v) => update((n) => (n.isolateNetwork = v))} />
          </div>
        </FormRow>
      </FormSection>
      <div className="sticky bottom-0 -mx-1 flex gap-2 border-t border-line bg-bg px-1 py-3">
        <Button variant="primary" disabled={(!isNew && !dirty) || !!ipv6Error || (draft.dhcp.enabled && (invalidLease || invalidDns))} onClick={save}>
          {isNew ? "ネットワークを追加" : "変更を適用"}
        </Button>
        {!isNew && (
          <Button disabled={!dirty} onClick={reset}>
            元に戻す
          </Button>
        )}
        {!isNew && (
          <Button variant="danger" className="ml-auto" onClick={remove}>
            削除
          </Button>
        )}
      </div>
    </div>
  );
}
