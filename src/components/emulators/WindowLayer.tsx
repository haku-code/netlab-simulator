"use client";

import { X } from "lucide-react";
import { useRef } from "react";
import { isIPhone } from "@/lib/model";
import { useStore } from "@/lib/store";
import { useWindows, type EmuWindow } from "@/lib/windows";
import { CLIENT_KIND_LABEL, ClientIcon } from "../icons";
import { Appliance } from "./Appliance";
import { Desktop } from "./Desktop";
import { Phone } from "./Phone";
import { Tv } from "./Tv";

/** 端末エミュレーターのウィンドウを重ねて表示するレイヤー */
export function WindowLayer() {
  const windows = useWindows((w) => w.windows);
  const clients = useStore((s) => s.scenario.clients);
  return (
    <>
      {windows.map((w) => {
        const c = clients.find((x) => x.id === w.clientId);
        return c ? <EmuFrame key={w.clientId} win={w} /> : null;
      })}
    </>
  );
}

const SIZE = {
  pc: "w-[min(780px,calc(100vw-2rem))]",
  server: "w-[380px]",
  printer: "w-[380px]",
  iot: "w-[360px]",
  phone: "w-[312px]",
  tv: "w-[min(720px,calc(100vw-2rem))]",
} as const;

function EmuFrame({ win }: { win: EmuWindow }) {
  const client = useStore((s) => s.scenario.clients.find((c) => c.id === win.clientId))!;
  const { close, focus, move } = useWindows();
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const onDown = (e: React.PointerEvent) => {
    focus(win.clientId);
    drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    move(win.clientId, Math.max(0, e.clientX - drag.current.dx), Math.max(48, e.clientY - drag.current.dy));
  };

  return (
    <div
      className={`fixed overflow-hidden rounded-lg border border-line bg-surface shadow-[0_16px_48px_rgba(0,0,0,0.22)] ${SIZE[client.kind]}`}
      style={{ left: win.x, top: win.y, zIndex: 50 + win.z }}
      onPointerDown={() => focus(win.clientId)}
    >
      <div
        className="flex h-9 cursor-grab touch-none items-center gap-2 border-b border-line bg-surface-2 px-3 select-none active:cursor-grabbing"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
      >
        <span className="text-muted">
          <ClientIcon kind={client.kind} size={14} />
        </span>
        <span className="font-medium">{client.name}</span>
        <span className="text-[12px] text-muted">{client.kind === "phone" ? (isIPhone(client) ? "iPhone" : "Android 風") : CLIENT_KIND_LABEL[client.kind]}</span>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => close(win.clientId)}
          className="ml-auto rounded p-1 text-muted hover:bg-hover hover:text-fg"
          aria-label="閉じる"
        >
          <X size={14} />
        </button>
      </div>
      {client.kind === "pc" ? (
        <Desktop clientId={client.id} />
      ) : client.kind === "phone" ? (
        <Phone clientId={client.id} />
      ) : client.kind === "tv" ? (
        <Tv clientId={client.id} />
      ) : (
        <Appliance clientId={client.id} />
      )}
    </div>
  );
}
