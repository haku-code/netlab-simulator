"use client";

import { useState } from "react";
import { ClientPanel } from "@/components/panels/ClientPanel";
import { DevicePanel } from "@/components/panels/DevicePanel";
import { TopologyView } from "@/components/topology/TopologyView";
import { PageHeader } from "@/components/ui";

export default function TopologyPage() {
  const [sel, setSel] = useState<{ kind: "device" | "client"; id: string } | null>(null);
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
      <div className="min-h-[520px] flex-1 overflow-hidden rounded-lg border border-line bg-surface">
        <TopologyView selected={sel?.id} onSelect={setSel} />
      </div>
      {sel?.kind === "device" && <DevicePanel deviceId={sel.id} onClose={() => setSel(null)} />}
      {sel?.kind === "client" && <ClientPanel clientId={sel.id} onClose={() => setSel(null)} />}
    </div>
  );
}
