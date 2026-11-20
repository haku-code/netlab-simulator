"use client";

import clsx from "clsx";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { DEVICE_TYPE_LABEL, DeviceGlyph } from "@/components/icons";
import { DevicePanel } from "@/components/panels/DevicePanel";
import { Button, Notice, PageHeader, SearchInput, Segmented, Status, table as t } from "@/components/ui";
import { useIssues, useQueryId } from "@/lib/hooks";
import { uid, type DeviceType } from "@/lib/model";
import { uplinkOf } from "@/lib/net/simulate";
import { makeDevice } from "@/lib/scenarios/builders";
import { useStore } from "@/lib/store";
import { clientsOf } from "@/lib/topo";

type Filter = "all" | DeviceType;

export default function DevicesPage() {
  const s = useStore((x) => x.scenario);
  const mutate = useStore((x) => x.mutate);
  const issues = useIssues().filter((i) => i.area === "devices");
  const [selId, setSelId] = useQueryId();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const rows = useMemo(
    () => s.devices.filter((d) => (filter === "all" || d.type === filter) && d.name.toLowerCase().includes(q.toLowerCase())),
    [s.devices, filter, q],
  );

  const add = (type: DeviceType) => {
    const id = uid(type === "switch" ? "sw" : "ap");
    const n = s.devices.filter((d) => d.type === type).length + 1;
    mutate((sc) => {
      sc.devices.push(makeDevice(type, id, type === "switch" ? `Switch ${n}` : `AP ${n}`, sc.networks[0]?.id ?? null));
    });
    setAddOpen(false);
    setSelId(id);
  };

  return (
    <>
      <PageHeader title="デバイス" count={s.devices.length}>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "すべて" },
            { value: "gateway", label: "ゲートウェイ" },
            { value: "switch", label: "スイッチ" },
            { value: "ap", label: "Wi-Fi" },
          ]}
        />
        <SearchInput value={q} onChange={setQ} />
        <div className="relative">
          <Button variant="primary" onClick={() => setAddOpen((v) => !v)}>
            <Plus size={14} /> デバイスを追加
          </Button>
          {addOpen && (
            <div className="absolute right-0 z-20 mt-1 w-44 rounded border border-line bg-surface py-1 shadow-lg">
              {(["switch", "ap"] as const).map((type) => (
                <button key={type} onClick={() => add(type)} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-hover">
                  <DeviceGlyph type={type} size={20} /> {DEVICE_TYPE_LABEL[type]}
                </button>
              ))}
            </div>
          )}
        </div>
      </PageHeader>
      <Notice issues={issues} />
      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr>
              <th className={t.th}>名前</th>
              <th className={t.th}>状態</th>
              <th className={t.th}>モデル</th>
              <th className={t.th}>IP アドレス</th>
              <th className={t.th}>MAC アドレス</th>
              <th className={t.th}>上流接続</th>
              <th className={clsx(t.th, "text-right")}>クライアント</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const up = uplinkOf(s, d.id);
              return (
                <tr key={d.id} className={clsx(t.tr, selId === d.id && t.sel)} onClick={() => setSelId(d.id)}>
                  <td className={t.td}>
                    <div className="flex items-center gap-2.5">
                      <DeviceGlyph type={d.type} size={24} />
                      <span className="font-medium">{d.name}</span>
                    </div>
                  </td>
                  <td className={t.td}>
                    <Status ok={up.online} />
                  </td>
                  <td className={clsx(t.td, "text-fg-2")}>{d.model}</td>
                  <td className={clsx(t.td, "tnum")}>{d.ip}</td>
                  <td className={clsx(t.td, "tnum text-fg-2")}>{d.mac}</td>
                  <td className={clsx(t.td, "text-fg-2")}>{d.type === "gateway" ? "WAN" : "parentName" in up ? `${up.parentName} · ${up.parentPort}` : "—"}</td>
                  <td className={clsx(t.td, "tnum text-right")}>{clientsOf(s, d.id).length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <DevicePanel deviceId={selId} onClose={() => setSelId(null)} />
    </>
  );
}
