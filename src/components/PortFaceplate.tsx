"use client";

import clsx from "clsx";
import { useState } from "react";
import type { Device, Scenario } from "@/lib/model";
import { portPeer } from "@/lib/topo";
import { vlanColor } from "./ui";

export const DND_CLIENT = "application/x-netlab-client";

/** スイッチ前面パネル風のポート表示。端末のケーブルをドラッグ＆ドロップで抜き挿しできる */
export function PortFaceplate({
  s,
  device,
  selected,
  onSelect,
  compact,
  negotiating,
  onDropClient,
}: {
  s: Scenario;
  device: Device;
  selected?: string | null;
  onSelect?: (portId: string) => void;
  compact?: boolean;
  /** リンクのネゴシエーション中（LED 点滅）のポート */
  negotiating?: string | null;
  onDropClient?: (portId: string, clientId: string) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const netIndex = (id: string | null) => s.networks.findIndex((n) => n.id === id);
  return (
    <div className={clsx("inline-flex flex-wrap gap-1.5 rounded-md border border-line bg-surface-2", compact ? "p-2" : "p-3")}>
      {device.ports.map((p) => {
        const peer = portPeer(s, device.id, p.id);
        const up = !!peer && p.enabled;
        const blinking = negotiating === p.id;
        const ni = netIndex(p.nativeNetworkId);
        const draggable = !!onDropClient && peer?.kind === "client";
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect?.(p.id)}
            draggable={draggable}
            onDragStart={(e) => {
              if (peer?.kind !== "client") return;
              e.dataTransfer.setData(DND_CLIENT, peer.client.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (!onDropClient || !e.dataTransfer.types.includes(DND_CLIENT)) return;
              e.preventDefault();
              setOver(p.id);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              setOver(null);
              const id = e.dataTransfer.getData(DND_CLIENT);
              if (id && onDropClient) onDropClient(p.id, id);
            }}
            title={`${p.name}${peer ? ` → ${peer.kind === "device" ? `${peer.device.name} ${peer.port.name}` : peer.client.name}` : ""}`}
            className={clsx(
              "group flex flex-col items-center rounded px-1 pt-1 pb-1.5 transition-colors",
              selected === p.id ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-hover",
              over === p.id && (peer ? "bg-err/10 ring-1 ring-err" : "bg-accent-soft ring-2 ring-accent"),
              draggable && "cursor-grab active:cursor-grabbing",
              !onSelect && !onDropClient && "cursor-default",
            )}
          >
            <span className="tnum mb-1 text-[10.5px] text-muted">{device.type === "ap" ? "↑" : p.idx}</span>
            <span
              className={clsx(
                "relative flex items-end justify-center rounded-[3px] border",
                compact ? "h-[22px] w-[26px]" : "h-[28px] w-[32px]",
                !p.enabled ? "border-line bg-surface-2" : up ? "border-ok/60 bg-ok/10" : "border-faint/60 bg-surface",
              )}
            >
              {/* リンク / アクティビティ LED */}
              {p.enabled && peer && (
                <span className={clsx("absolute top-[3px] left-[3px] size-[5px] rounded-full", blinking ? "animate-pulse bg-warn" : "bg-ok")} />
              )}
              {/* RJ45 の切り欠き */}
              <span className={clsx("mb-[3px] h-[5px] w-[45%] rounded-[1px]", !p.enabled ? "bg-line" : up ? "bg-ok/70" : "bg-faint/50")} />
              {!p.enabled && <span className="absolute inset-0 m-auto h-px w-[70%] rotate-[-30deg] bg-faint" />}
            </span>
            <span className="mt-1 h-[3px] w-full rounded-full" style={{ background: ni >= 0 ? vlanColor(ni) : "var(--line)" }} />
          </button>
        );
      })}
    </div>
  );
}
