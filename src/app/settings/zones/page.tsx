"use client";

import clsx from "clsx";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Checkbox, Field, Input, PageHeader, SidePanel, Term, table as t, useDraft } from "@/components/ui";
import { uid, type Zone } from "@/lib/model";
import { zoneDefault } from "@/lib/net/simulate";
import { useStore } from "@/lib/store";

export default function ZonesPage() {
  const s = useStore((x) => x.scenario);
  const router = useRouter();
  const [edit, setEdit] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="ゾーン">
        <Button variant="primary" onClick={() => setEdit("new")}>
          <Plus size={14} /> ゾーンを作成
        </Button>
      </PageHeader>

      <div className="mb-2 flex items-center gap-1 text-[12px] text-muted">
        行が送信元、列が宛先のゾーンです。セルをクリックするとそのゾーン間のポリシーを表示します。 <Term id="zone" />
      </div>
      <div className={clsx(t.wrap, "mb-6")}>
        <table className="w-full text-left">
          <thead>
            <tr>
              <th className={clsx(t.th, "w-32")}>
                <span className="text-faint">送信元 ↓ / 宛先 →</span>
              </th>
              {s.zones.map((z) => (
                <th key={z.id} className={t.th}>
                  {z.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.zones.map((src) => (
              <tr key={src.id}>
                <td className={clsx(t.td, "font-medium")}>{src.name}</td>
                {s.zones.map((dst) => {
                  const def = zoneDefault(src.id, dst.id);
                  const n = s.policies.filter((p) => p.srcZone === src.id && p.dstZone === dst.id).length;
                  return (
                    <td key={dst.id} className="border-b border-l border-line-soft p-0">
                      <button
                        onClick={() => router.push(`/settings/policies?src=${src.id}&dst=${dst.id}`)}
                        className="flex h-11 w-full flex-col justify-center px-3 text-left transition-colors hover:bg-hover"
                      >
                        <span className={clsx("text-[12px] font-medium", def === "allow" ? "text-ok" : "text-err")}>{def === "allow" ? "すべて許可" : "すべて拒否"}</span>
                        {n > 0 && <span className="text-[11px] text-accent">{n} custom</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr>
              <th className={t.th}>ゾーン</th>
              <th className={t.th}>種類</th>
              <th className={t.th}>ネットワーク</th>
            </tr>
          </thead>
          <tbody>
            {s.zones.map((z) => {
              const nets = s.networks.filter((n) => n.zoneId === z.id);
              const fixed = z.id === "external" || z.id === "gateway";
              return (
                <tr key={z.id} className={clsx(!fixed && t.tr)} onClick={() => !fixed && setEdit(z.id)}>
                  <td className={clsx(t.td, "font-medium")}>{z.name}</td>
                  <td className={clsx(t.td, "text-fg-2")}>{z.builtin ? "組み込み" : "カスタム"}</td>
                  <td className={clsx(t.td, "text-fg-2")}>{fixed ? (z.id === "external" ? "WAN" : "ゲートウェイ") : nets.map((n) => n.name).join(", ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {edit && <ZonePanel id={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ZonePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useStore((x) => x.scenario);
  const mutate = useStore((x) => x.mutate);
  const isNew = id === "new";
  const zone = s.zones.find((z) => z.id === id);
  const source = isNew
    ? { zone: { id: uid("zone"), name: "", builtin: false } as Zone, nets: [] as string[] }
    : zone
      ? { zone, nets: s.networks.filter((n) => n.zoneId === id).map((n) => n.id) }
      : undefined;
  const { draft, update, dirty } = useDraft(source, id);
  if (!draft) return null;

  const apply = () => {
    mutate((sc) => {
      const z = { ...draft.zone, name: draft.zone.name.trim() || "新しいゾーン" };
      const i = sc.zones.findIndex((x) => x.id === z.id);
      if (i >= 0) sc.zones[i] = z;
      else sc.zones.push(z);
      for (const n of sc.networks) {
        if (draft.nets.includes(n.id)) n.zoneId = z.id;
        else if (n.zoneId === z.id) n.zoneId = "internal";
      }
    });
    onClose();
  };

  return (
    <SidePanel
      open
      onClose={onClose}
      title={isNew ? "ゾーンを作成" : draft.zone.name}
      subtitle={draft.zone.builtin ? "組み込みゾーン" : "カスタムゾーン"}
      footer={
        <>
          <Button variant="primary" disabled={!isNew && !dirty} onClick={apply}>
            {isNew ? "作成" : "変更を適用"}
          </Button>
          {!isNew && !draft.zone.builtin && (
            <Button
              variant="danger"
              className="ml-auto"
              onClick={() => {
                mutate((sc) => {
                  sc.zones = sc.zones.filter((z) => z.id !== id);
                  for (const n of sc.networks) if (n.zoneId === id) n.zoneId = "internal";
                  sc.policies = sc.policies.filter((p) => p.srcZone !== id && p.dstZone !== id);
                });
                onClose();
              }}
            >
              削除
            </Button>
          )}
        </>
      }
    >
      <Field label="ゾーン名">
        <Input value={draft.zone.name} disabled={draft.zone.builtin} onChange={(e) => update((d) => (d.zone.name = e.target.value))} />
      </Field>
      <Field label="ネットワーク" hint="ネットワークは 1 つのゾーンにだけ所属します。外したネットワークは Internal に戻ります。">
        <div className="rounded border border-line px-3 py-1.5">
          {s.networks.map((n) => {
            const other = n.zoneId !== draft.zone.id && !draft.nets.includes(n.id) ? s.zones.find((z) => z.id === n.zoneId)?.name : null;
            return (
              <Checkbox
                key={n.id}
                checked={draft.nets.includes(n.id)}
                onChange={(on) => update((d) => (d.nets = on ? [...d.nets, n.id] : d.nets.filter((x) => x !== n.id)))}
                label={
                  <>
                    {n.name} {other && <span className="text-muted">(現在: {other})</span>}
                  </>
                }
              />
            );
          })}
        </div>
      </Field>
    </SidePanel>
  );
}
