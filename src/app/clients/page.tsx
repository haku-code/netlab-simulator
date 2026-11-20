"use client";

import clsx from "clsx";
import { Cable, MonitorPlay, Plus, Server, Wifi } from "lucide-react";
import { useMemo, useState } from "react";
import { ClientIcon } from "@/components/icons";
import { ClientPanel } from "@/components/panels/ClientPanel";
import { Button, PageHeader, SearchInput, Segmented, Status, table as t } from "@/components/ui";
import { useClientStates, useQueryId } from "@/lib/hooks";
import { randomMac, uid, type Client, type WebService } from "@/lib/model";
import { useStore } from "@/lib/store";
import { useWindows } from "@/lib/windows";
import { portBusy } from "@/lib/topo";
import { webServer } from "@/lib/web";

type Filter = "all" | "wired" | "wifi";

export default function ClientsPage() {
  const s = useStore((x) => x.scenario);
  const mutate = useStore((x) => x.mutate);
  const states = useClientStates();
  const [selId, setSelId] = useQueryId();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [serverError, setServerError] = useState("");
  const openWindow = useWindows((w) => w.open);

  const rows = useMemo(
    () => s.clients.filter((c) => (filter === "all" || c.connection.type === filter) && c.name.toLowerCase().includes(q.toLowerCase())),
    [s.clients, filter, q],
  );

  const add = () => {
    const sw = s.devices.find((d) => d.type === "switch");
    const ap = s.devices.find((d) => d.type === "ap");
    const free = sw?.ports.find((p) => !portBusy(s, sw.id, p.id));
    let connection: Client["connection"] | null = null;
    if (sw && free) connection = { type: "wired", deviceId: sw.id, portId: free.id };
    else if (ap && s.ssids[0]) connection = { type: "wifi", apId: ap.id, ssidId: s.ssids[0].id };
    if (!connection) return alert("空いているポートか SSID がありません。");
    const id = uid("client");
    mutate((sc) => {
      sc.clients.push({ id, name: `Client ${sc.clients.length + 1}`, kind: "pc", vendor: "Generic", mac: randomMac(id), connection: connection!, ipMode: "dhcp", staticIp: "", lease: null, wifiPassword: "", wpa3: true });
    });
    setSelId(id);
  };

  const wiredCount = s.clients.filter((c) => c.connection.type === "wired").length;
  const addServer = (kind: WebService["kind"]) => {
    const available = s.devices
      .filter((d) => d.type !== "ap")
      .flatMap((device) => device.ports.filter((p) => p.enabled && p.nativeNetworkId && !portBusy(s, device.id, p.id)).map((port) => ({ device, port })))[0];
    if (!available) {
      setServerError("サーバー用に、ネイティブ VLAN を持つ空きポートを用意してください。");
      return;
    }
    let index = 1;
    let server = webServer(kind, available.device, available.port.idx, index);
    while (s.clients.some((c) => c.id === server.id || c.webService?.host === server.webService?.host)) {
      server = webServer(kind, available.device, available.port.idx, ++index);
    }
    mutate((sc) => sc.clients.push(server));
    setServerError("");
    setSelId(server.id);
  };

  return (
    <>
      <PageHeader title="クライアント" count={s.clients.length}>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "すべて" },
            { value: "wired", label: `有線 ${wiredCount}` },
            { value: "wifi", label: `Wi-Fi ${s.clients.length - wiredCount}` },
          ]}
        />
        <SearchInput value={q} onChange={setQ} />
        <Button variant="primary" onClick={add}>
          <Plus size={14} /> クライアントを追加
        </Button>
      </PageHeader>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => addServer("website")}><Server size={14} /> Web サーバーを追加</Button>
        <Button onClick={() => addServer("forum")}><Server size={14} /> 会員制掲示板を追加</Button>
        {serverError && <span role="status" className="text-err">{serverError}</span>}
      </div>
      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr>
              <th className={t.th}>名前</th>
              <th className={t.th}>状態</th>
              <th className={t.th}>接続方式</th>
              <th className={t.th}>ネットワーク</th>
              <th className={t.th}>IP アドレス</th>
              <th className={t.th}>MAC アドレス</th>
              <th className={t.th}>メーカー</th>
              <th className={t.th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const st = states.get(c.id)!;
              return (
                <tr key={c.id} className={clsx(t.tr, selId === c.id && t.sel)} onClick={() => setSelId(c.id)}>
                  <td className={t.td}>
                    <div className="flex items-center gap-2.5">
                      <span className="text-fg-2">
                        <ClientIcon kind={c.kind} />
                      </span>
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </td>
                  <td className={t.td}>
                    <span title={st.error}>
                      <Status ok={!st.error} label={st.error ? (st.errorStage === "ip" ? "IP 未取得" : "未接続") : "オンライン"} />
                    </span>
                  </td>
                  <td className={clsx(t.td, "text-fg-2")}>
                    <span className="inline-flex items-center gap-1.5">
                      {c.connection.type === "wired" ? <Cable size={14} className="text-muted" /> : <Wifi size={14} className="text-muted" />}
                      {st.how ?? <span className="text-muted">未接続</span>}
                    </span>
                  </td>
                  <td className={t.td}>
                    {st.network ? (
                      <>
                        {st.network.name} <span className="text-muted">({st.network.vlanId})</span>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className={clsx(t.td, "tnum")}>{st.ip ?? <span className="text-muted">—</span>}</td>
                  <td className={clsx(t.td, "tnum text-fg-2")}>{c.mac}</td>
                  <td className={clsx(t.td, "text-fg-2")}>{c.vendor}</td>
                  <td className={clsx(t.td, "w-10 text-right")}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openWindow(c.id);
                      }}
                      className="rounded p-1 text-muted hover:bg-accent-soft hover:text-accent"
                      title="端末を操作する"
                    >
                      <MonitorPlay size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ClientPanel clientId={selId} onClose={() => setSelId(null)} />
    </>
  );
}
