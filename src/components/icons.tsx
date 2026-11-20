import { Cctv, Monitor, Plug, Printer, Server, Smartphone, Tv } from "lucide-react";
import type { ClientKind, DeviceType } from "@/lib/model";

/** ハードウェアの外観を模したシンプルなグリフ（白い筐体 + ポート / LED） */
export function DeviceGlyph({ type, size = 32 }: { type: DeviceType; size?: number }) {
  const body = "var(--surface)";
  const edge = "var(--faint)";
  const port = "var(--muted)";
  if (type === "ap") {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="13" fill={body} stroke={edge} strokeWidth="1.2" />
        <circle cx="16" cy="16" r="5.5" fill="none" stroke="var(--accent)" strokeWidth="1.4" opacity="0.85" />
      </svg>
    );
  }
  if (type === "switch") {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect x="1.5" y="10" width="29" height="12" rx="2" fill={body} stroke={edge} strokeWidth="1.2" />
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x={5 + i * 2.9} y="14" width="2" height="2.6" rx="0.4" fill={port} />
        ))}
        <circle cx="4" cy="19" r="0.9" fill="var(--accent)" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="4" y="8" width="24" height="16" rx="3" fill={body} stroke={edge} strokeWidth="1.2" />
      <rect x="8" y="17" width="16" height="3" rx="1" fill="none" stroke={port} strokeWidth="0.9" />
      <rect x="8" y="12" width="5" height="2" rx="0.6" fill="var(--accent)" opacity="0.85" />
    </svg>
  );
}

export function ClientIcon({ kind, size = 16 }: { kind: ClientKind; size?: number }) {
  const I = { pc: Monitor, phone: Smartphone, iot: Plug, server: Server, printer: Printer, tv: Tv }[kind] ?? Cctv;
  return <I size={size} strokeWidth={1.6} />;
}

export const CLIENT_KIND_LABEL: Record<ClientKind, string> = {
  pc: "Computer",
  phone: "Smartphone",
  iot: "Smart Home",
  server: "Server / NAS",
  printer: "Printer",
  tv: "TV",
};

export const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
  gateway: "Gateway",
  switch: "Switch",
  ap: "Access Point",
};
