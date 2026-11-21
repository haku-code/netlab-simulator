"use client";

import clsx from "clsx";
import { Cable } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ClientIcon, DeviceGlyph } from "@/components/icons";
import { DND_CLIENT, PortFaceplate } from "@/components/PortFaceplate";
import { PortPanel } from "@/components/panels/PortPanel";
import { LagBadge, PoeBudgetBar, portPoeLabel, portStpState } from "@/components/switching";
import { Notice, PageHeader, table as t, vlanColor } from "@/components/ui";
import { useIssues } from "@/lib/hooks";
import { findNetwork, resolveClient } from "@/lib/net/simulate";
import { useStore } from "@/lib/store";
import { portPeer, taggedLabel } from "@/lib/topo";

interface PlugEvent {
  tone: "ok" | "warn" | "err" | "info";
  text: string;
}

export default function PortsPage() {
  const s = useStore((x) => x.scenario);
  const plug = useStore((x) => x.plugCable);
  const issues = useIssues().filter((i) => i.area === "devices");
  const wiredDevices = s.devices.filter((d) => d.type !== "ap");
  const [devId, setDevId] = useState<string | null>(null);
  const [portId, setPortId] = useState<string | null>(null);
  const [negotiating, setNegotiating] = useState<string | null>(null);
  const [events, setEvents] = useState<PlugEvent[]>([]);
  const [trayOver, setTrayOver] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setDevId(p.get("device") ?? wiredDevices[0]?.id ?? null);
    setPortId(p.get("port"));
    // 初回のみ URL から読む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const device = s.devices.find((d) => d.id === devId) ?? wiredDevices[0];
  const wiredClients = s.clients.filter((c) => c.connection.type === "wired");
  const log = (e: PlugEvent) => setEvents((x) => [e, ...x].slice(0, 4));

  const onDropClient = (pid: string, clientId: string) => {
    if (!device) return;
    const c = s.clients.find((x) => x.id === clientId);
    const peer = portPeer(s, device.id, pid);
    const port = device.ports.find((p) => p.id === pid)!;
    if (!c) return;
    if (peer && !(peer.kind === "client" && peer.client.id === clientId)) {
      log({ tone: "err", text: `${device.name} ${port.name} は使用中です（${peer.kind === "client" ? peer.client.name : peer.device.name}）。` });
      return;
    }
    plug(clientId, device.id, pid);
    if (!port.enabled) {
      log({ tone: "warn", text: `${c.name} を ${device.name} ${port.name} に挿しましたが、ポートが無効のためリンクが上がりません。` });
      return;
    }
    // リンクのネゴシエーション → DHCP の順に進む
    setNegotiating(pid);
    log({ tone: "info", text: `${c.name} を ${device.name} ${port.name} に接続 — リンクのネゴシエーション中…` });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setNegotiating(null);
      const st = resolveClient(useStore.getState().scenario, clientId);
      if (!st.error) log({ tone: "ok", text: `リンク確立 (${port.speed}) → ${st.network?.name} (VLAN ${st.network?.vlanId}) · DHCP: ${st.ip}` });
      else log({ tone: "warn", text: `リンク確立 (${port.speed}) → ${st.error}` });
    }, 1400);
  };

  return (
    <>
      <PageHeader title="ポートマネージャー" />
      <div className="mb-4 flex flex-wrap gap-2">
        {wiredDevices.map((d) => (
          <button
            key={d.id}
            onClick={() => {
              setDevId(d.id);
              setPortId(null);
            }}
            className={clsx(
              "flex h-10 items-center gap-2 rounded border px-3 transition-colors",
              device?.id === d.id ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-hover",
            )}
          >
            <DeviceGlyph type={d.type} size={22} />
            <span className="font-medium">{d.name}</span>
            <span className="text-[12px] text-muted">{d.ports.length} ports</span>
          </button>
        ))}
      </div>
      <Notice issues={issues} />
      {device && (
        <>
          <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-lg border border-line bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
                <span className="font-medium text-fg">{device.name}</span>
                <span className="ml-auto order-last w-full sm:order-none sm:w-auto"><PoeBudgetBar s={s} device={device} /></span>
                {s.networks.map((n, i) => (
                  <span key={n.id} className="inline-flex items-center gap-1.5">
                    <span className="h-[3px] w-3 rounded-full" style={{ background: vlanColor(i) }} />
                    {n.name} ({n.vlanId})
                  </span>
                ))}
              </div>
              <PortFaceplate s={s} device={device} selected={portId} onSelect={setPortId} negotiating={negotiating} onDropClient={onDropClient} />
              <ul className="mt-3 min-h-[1.5rem] space-y-1 text-[12px]">
                {events.map((e, i) => (
                  <li
                    key={i}
                    className={clsx(
                      i > 0 && "opacity-50",
                      e.tone === "ok" ? "text-ok" : e.tone === "warn" ? "text-warn" : e.tone === "err" ? "text-err" : "text-fg-2",
                    )}
                  >
                    {e.text}
                  </li>
                ))}
              </ul>
            </div>

            {/* ケーブルトレイ: 端末をポートへドラッグして挿す / ポートからここへドラッグして抜く */}
            <div
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DND_CLIENT)) return;
                e.preventDefault();
                setTrayOver(true);
              }}
              onDragLeave={() => setTrayOver(false)}
              onDrop={(e) => {
                setTrayOver(false);
                const id = e.dataTransfer.getData(DND_CLIENT);
                const c = s.clients.find((x) => x.id === id);
                if (!c || (c.connection.type === "wired" && !c.connection.deviceId)) return;
                plug(id, null, null);
                log({ tone: "info", text: `${c.name} のケーブルを抜きました — リンク切断` });
              }}
              className={clsx("rounded-lg border bg-surface p-4 transition-colors", trayOver ? "border-accent bg-accent-soft" : "border-line")}
            >
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <Cable size={15} className="text-muted" /> 有線の端末
              </div>
              <p className="mb-3 text-[12px] text-muted">端末をポートへドラッグして挿します。ポートからここへドラッグすると抜けます。</p>
              <ul className="space-y-1.5">
                {wiredClients.map((c) => {
                  const conn = c.connection.type === "wired" ? c.connection : null;
                  const at = conn?.deviceId ? s.devices.find((d) => d.id === conn.deviceId) : null;
                  const port = at?.ports.find((p) => p.id === conn?.portId);
                  return (
                    <li
                      key={c.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_CLIENT, c.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className="flex cursor-grab items-center gap-2.5 rounded border border-line bg-surface px-2.5 py-1.5 hover:border-faint active:cursor-grabbing"
                    >
                      <span className="text-fg-2">
                        <ClientIcon kind={c.kind} size={15} />
                      </span>
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className={clsx("text-[11.5px]", port ? "text-muted" : "text-warn")}>{port ? `${at!.name} · ${port.name}` : "未接続"}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className={t.wrap}>
            <table className={t.table}>
              <thead>
                <tr>
                  <th className={t.th}>ポート</th>
                  <th className={t.th}>名前</th>
                  <th className={t.th}>状態</th>
                  <th className={t.th}>STP</th>
                  <th className={t.th}>PoE</th>
                  <th className={t.th}>ネイティブ VLAN</th>
                  <th className={t.th}>タグ付き VLAN の管理</th>
                  <th className={t.th}>接続先</th>
                </tr>
              </thead>
              <tbody>
                {device.ports.map((p) => {
                  const peer = portPeer(s, device.id, p.id);
                  const ni = s.networks.findIndex((n) => n.id === p.nativeNetworkId);
                  const stp = portStpState(s, device.id, p);
                  const poe = portPoeLabel(s, device.id, p.id);
                  const profile = s.portProfiles?.find((x) => x.id === p.profileId);
                  return (
                    <tr key={p.id} className={clsx(t.tr, portId === p.id && t.sel)} onClick={() => setPortId(p.id)}>
                      <td className={clsx(t.td, "tnum")}>{p.idx}</td>
                      <td className={t.td}>
                        <span className="inline-flex items-center gap-1.5">
                          {p.name}
                          <LagBadge port={p} />
                          {profile && <span className="text-[11.5px] text-muted">{profile.name}</span>}
                        </span>
                      </td>
                      <td className={t.td}>
                        {!p.enabled ? (
                          <span className="text-muted">無効</span>
                        ) : peer ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 rounded-full bg-ok" />
                            {p.speed}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-muted">
                            <span className="size-2 rounded-full bg-faint" />
                            リンクなし
                          </span>
                        )}
                      </td>
                      <td className={clsx(t.td, stp?.tone === "err" ? "text-err" : stp?.tone === "warn" ? "text-warn" : "text-fg-2")}>{stp?.label ?? "—"}</td>
                      <td className={clsx(t.td, "tnum", !poe ? "text-muted" : poe.tone === "ok" ? "text-fg-2" : poe.tone === "err" ? "text-err" : "text-warn")} title={poe?.detail}>
                        {poe?.label ?? "—"}
                      </td>
                      <td className={t.td}>
                        {ni >= 0 ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-[3px] w-3 rounded-full" style={{ background: vlanColor(ni) }} />
                            {findNetwork(s, p.nativeNetworkId)?.name}
                          </span>
                        ) : (
                          <span className="text-muted">なし</span>
                        )}
                      </td>
                      <td className={clsx(t.td, "text-fg-2")}>{taggedLabel(s, p)}</td>
                      <td className={clsx(t.td, "text-fg-2")}>{peer ? (peer.kind === "device" ? `${peer.device.name} · ${peer.port.name}` : peer.client.name) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {portId && <PortPanel deviceId={device.id} portId={portId} onClose={() => setPortId(null)} />}
        </>
      )}
    </>
  );
}
