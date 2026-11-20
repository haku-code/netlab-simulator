"use client";

import { useState } from "react";
import { ClientPanel } from "@/components/panels/ClientPanel";
import { DevicePanel } from "@/components/panels/DevicePanel";
import { PortPanel } from "@/components/panels/PortPanel";
import { ClientConnectionPanel } from "@/components/topology/ClientConnectionPanel";
import { TopologyView, type ConnectionSelection } from "@/components/topology/TopologyView";
import { PageHeader } from "@/components/ui";

type Selection = { kind: "device" | "client"; id: string } | ConnectionSelection;

export default function TopologyPage() {
  const [sel, setSel] = useState<Selection | null>(null);
  const close = () => setSel(null);
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="トポロジー">
        <span className="flex items-center gap-4 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-px w-5 bg-faint" /> 有線
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-5 border-t border-dashed border-faint" /> Wi-Fi
          </span>
        </span>
      </PageHeader>
      <p className="mb-3 text-[12px] text-muted">端末横のボタンで有線と Wi-Fi を切り替えます。配線を変えるには、端末のアイコンをスイッチやゲートウェイへドラッグするか、接続線をクリックします。</p>
      <div className="min-h-[520px] flex-1 overflow-hidden rounded-lg border border-line bg-surface">
        <TopologyView selected={sel?.id} onSelect={setSel} onEditConnection={setSel} />
      </div>
      {sel?.kind === "device" && <DevicePanel deviceId={sel.id} onClose={close} />}
      {sel?.kind === "client" && <ClientPanel clientId={sel.id} onClose={close} />}
      {sel?.kind === "client-connection" && (
        <ClientConnectionPanel key={`${sel.id}:${sel.targetDeviceId ?? ""}`} clientId={sel.id} targetDeviceId={sel.targetDeviceId} onClose={close} />
      )}
      {sel?.kind === "port-connection" && <PortPanel key={`${sel.id}:${sel.portId}`} deviceId={sel.id} portId={sel.portId} onClose={close} />}
    </div>
  );
}
